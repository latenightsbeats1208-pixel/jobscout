// ============================================================================
// installer/assemble.mjs
//
// Assemble la charge utile de l'installeur dans installer/dist/JobScout :
//
//   JobScout/
//     JobScout.exe        launcher natif (compilé depuis launcher/)
//     jobscout.ico        icône (raccourcis + zone de notification)
//     LISEZ-MOI.txt
//     runtime/node.exe    Node 22 LTS officiel, SHA256 vérifié
//     app/                sortie « standalone » de Next + statiques + prompts
//       data/             VIDE — les données réelles vivent dans %LOCALAPPDATA%
//
// Trois points de vigilance, tous automatisés ici :
//
//  1. `next build --output standalone` recopie `.env` (donc la clé API du
//     poste de développement) et tout ce que le traceur croise sous `data/`.
//     L'assemblage n'est donc PAS une copie brute : `.env*` et `data/` sont
//     exclus explicitement, en plus des exclusions de next.config.ts.
//
//  2. Le traceur ne garde de `playwright-core` que ce qu'importe le serveur —
//     `cli.js` manque, or c'est lui qui télécharge Chromium à la demande. On
//     recopie donc les deux paquets en entier.
//
//  3. Webpack inscrit le chemin absolu du projet dans les identifiants de
//     modules (`.next/server/**/page.js` et les manifests de références
//     client). Aucune option de build ne les supprime : on les réécrit ici,
//     de façon uniforme sur toute l'arborescence, vers une racine neutre.
//     Voir rewriteAbsolutePaths().
// ============================================================================
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ensureNodeRuntime } from "./fetch-node.mjs";
import { buildLauncher } from "./launcher/build-launcher.mjs";
import { makeIcon } from "./make-icon.mjs";
import { signingEnabled } from "./sign.mjs";
import { VARIANTS, asVariant, resolveVariant } from "./variant.mjs";
import {
  INFO_FILE_NAME,
  ENGINE_DOWNLOAD_LABEL,
  ENGINE_DISK_LABEL,
  writeInstallInfo,
} from "./install-info.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.dirname(HERE);
const DIST = path.join(HERE, "dist");
const PAYLOAD = path.join(DIST, "JobScout");
const APP = path.join(PAYLOAD, "app");

/** Racine neutre substituée aux chemins absolus du poste de développement. */
const NEUTRAL_ROOT = "C:\\JobScout\\build";

const log = (m) => process.stdout.write(`[assemble] ${m}\n`);

// ---------------------------------------------------------------- utilitaires
function rmrf(p) {
  fs.rmSync(p, { recursive: true, force: true });
}

function copyDir(src, dest, { skip = () => false } = {}) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (skip(entry.name, s)) continue;
    if (entry.isDirectory()) copyDir(s, d, { skip });
    else if (entry.isFile()) fs.copyFileSync(s, d);
  }
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else if (entry.isFile()) out.push(p);
  }
  return out;
}

function dirSize(dir) {
  return walk(dir).reduce((n, f) => n + fs.statSync(f).size, 0);
}

const mb = (bytes) => (bytes / 1024 / 1024).toFixed(1) + " Mo";

// ------------------------------------------------- réécriture des chemins abs
/**
 * Webpack sérialise le chemin absolu du projet dans les bundles serveur :
 *
 *   {layout:[()=>…,"C:\\Users\\<user>\\…\\app\\layout.tsx"]}
 *   "clientModules":{"C:\\Users\\<user>\\…\\node_modules\\next\\…"}
 *
 * Ce sont des IDENTIFIANTS, pas des chemins ouverts à l'exécution : la seule
 * contrainte est qu'ils restent cohérents entre le bundle serveur et le
 * manifest de références client. Une substitution uniforme sur toute
 * l'arborescence les neutralise sans rien casser — et c'est vérifié par le
 * test de bout en bout (l'app rend ses pages après réécriture).
 *
 * Aucune option de build ne fait mieux : `outputFileTracingRoot` ne corrige
 * que l'arborescence de sortie, et `serverMinification` conserve ces chaînes.
 */
function rewriteAbsolutePaths(root, projectRoot) {
  const bs = projectRoot.replace(/\//g, "\\");
  const forms = [
    // Ordre important : la forme échappée d'abord.
    [bs.replace(/\\/g, "\\\\"), NEUTRAL_ROOT.replace(/\\/g, "\\\\")],
    [bs, NEUTRAL_ROOT],
    [bs.replace(/\\/g, "/"), NEUTRAL_ROOT.replace(/\\/g, "/")],
  ];

  let filesTouched = 0;
  let replacements = 0;
  const binaryHits = [];

  for (const file of walk(root)) {
    let buf;
    try {
      buf = fs.readFileSync(file);
    } catch {
      continue;
    }
    let text = buf.toString("latin1");
    if (!forms.some(([from]) => text.includes(from))) continue;

    const ext = path.extname(file).toLowerCase();
    if (![".js", ".mjs", ".cjs", ".json", ".map", ".txt", ".html", ".css", ".ts"].includes(ext)) {
      binaryHits.push(path.relative(root, file));
      continue;
    }

    let count = 0;
    for (const [from, to] of forms) {
      const parts = text.split(from);
      count += parts.length - 1;
      text = parts.join(to);
    }
    fs.writeFileSync(file, Buffer.from(text, "latin1"));
    filesTouched++;
    replacements += count;
  }

  if (binaryHits.length) {
    throw new Error(
      "Chemin absolu trouvé dans des fichiers non textuels (réécriture impossible " +
        "sans les corrompre) :\n  " + binaryHits.slice(0, 10).join("\n  ")
    );
  }
  return { filesTouched, replacements };
}

/**
 * Complète les sous-arbres du runtime Next dans la sortie tracée : n'ajoute
 * QUE les fichiers absents, sans jamais écraser ceux produits par le build.
 * Les sourcemaps et déclarations de types sont écartées (inutiles à
 * l'exécution, et elles doubleraient le poids).
 */
const NEXT_RUNTIME_SUBTREES = ["lib", "shared", "server", "client"];

function completeNextRuntime() {
  const from = path.join(PROJECT, "node_modules", "next", "dist");
  const to = path.join(APP, "node_modules", "next", "dist");
  if (!fs.existsSync(to)) return 0;
  let added = 0;
  for (const sub of NEXT_RUNTIME_SUBTREES) {
    const src = path.join(from, sub);
    if (!fs.existsSync(src)) continue;
    for (const file of walk(src)) {
      if (/\.(map)$/.test(file) || file.endsWith(".d.ts")) continue;
      const rel = path.relative(from, file);
      const dest = path.join(to, rel);
      if (fs.existsSync(dest)) continue;
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(file, dest);
      added++;
    }
  }
  return added;
}

// --------------------------------------------------------------- assemblage
/**
 * @param variant  « prod » (défaut, strictement le build d'aujourd'hui) ou
 *                 « test » (voir variant.mjs) — identifiant ou objet.
 * @param signed   la charge utile sera-t-elle signée ? Ne sert qu'à la page
 *                 d'information du variant de test (« signé / non signé »).
 */
export async function assemble({
  skipNode = false,
  variant = VARIANTS.prod,
  signed = false,
} = {}) {
  variant = asVariant(variant);
  const isProd = variant.id === "prod";
  const version = JSON.parse(
    fs.readFileSync(path.join(PROJECT, "version.json"), "utf-8")
  ).version;
  log(`version ${version}`);
  if (!isProd) log(`variant ${variant.id} → « ${variant.appName} »`);

  const standalone = path.join(PROJECT, ".next", "standalone");
  const staticDir = path.join(PROJECT, ".next", "static");
  if (!fs.existsSync(standalone)) {
    throw new Error(
      "`.next/standalone` absent — lancez `npx next build` (output: 'standalone')."
    );
  }

  log("nettoyage de installer/dist");
  rmrf(DIST);
  fs.mkdirSync(APP, { recursive: true });

  // 1. Sortie standalone, SANS .env ni data/ (voir en-tête).
  log("copie de .next/standalone → app/");
  copyDir(standalone, APP, {
    skip: (name, full) => {
      if (/^\.env(\..*)?$/i.test(name)) return true;
      if (name === "data" && path.dirname(full) === standalone) return true;
      return false;
    },
  });

  // 1 bis. Les manifests de traçage `*.nft.json` listent TOUS les fichiers que
  // le traceur a croisés — y compris les documents générés sous data/ (donc
  // des noms de CV réels). Ce sont des artefacts de build, jamais lus à
  // l'exécution : on les supprime.
  let pruned = 0;
  for (const f of walk(APP)) {
    if (f.endsWith(".nft.json")) {
      fs.rmSync(f);
      pruned++;
    }
  }
  log(`${pruned} manifests de traçage (*.nft.json) supprimés`);

  // 2. Statiques client + public (le standalone ne les inclut jamais).
  log("copie de .next/static → app/.next/static");
  copyDir(staticDir, path.join(APP, ".next", "static"));
  const publicDir = path.join(PROJECT, "public");
  if (fs.existsSync(publicDir)) {
    log("copie de public/ → app/public");
    copyDir(publicDir, path.join(APP, "public"));
  } else {
    log("public/ absent dans le projet — rien à copier");
  }

  // 3. Paquets Playwright complets (cli.js absent de la sortie tracée).
  for (const pkg of ["playwright", "playwright-core"]) {
    const src = path.join(PROJECT, "node_modules", pkg);
    if (!fs.existsSync(src)) throw new Error(`node_modules/${pkg} introuvable.`);
    const dest = path.join(APP, "node_modules", pkg);
    rmrf(dest);
    copyDir(src, dest);
  }
  log("paquets playwright / playwright-core recopiés en entier");

  // 3 bis. Le traceur de Next rate certains de ses PROPRES modules internes
  // chargés par require dynamique — `next/dist/lib/metadata/get-metadata-route`
  // manque, et le serveur standalone refuse alors de démarrer. Plutôt que de
  // rattraper module par module, on complète les quatre sous-arbres du runtime
  // de Next (~8 Mo sans les sourcemaps ni les .d.ts) ; `dist/compiled` (56 Mo)
  // et `dist/build` restent à la charge du traceur, qui les couvre bien.
  const completed = completeNextRuntime();
  log(`runtime Next complété : ${completed} fichiers internes ajoutés`);

  // 3 ter. Fichiers chargés par import dynamique calculé, que le traceur ne
  // peut pas voir. pdf.worker.mjs est le « faux worker » que pdfjs charge en
  // Node : sans lui, la lecture structurée des CV PDF (multi-colonnes) échoue
  // et l'extraction retombe silencieusement sur pdf-parse.
  // css-tree/data/patch.json est requis par `data-patch.cjs` de css-tree, que
  // jsdom charge — donc TOUS les scrapers. Le traceur ne le suit pas et
  // /api/scan/start renvoyait 500 sans lui.
  const RUNTIME_EXTRAS = [
    "pdfjs-dist/legacy/build/pdf.worker.mjs",
    "css-tree/data/patch.json",
  ];
  for (const rel of RUNTIME_EXTRAS) {
    const src = path.join(PROJECT, "node_modules", ...rel.split("/"));
    if (!fs.existsSync(src)) throw new Error(`Fichier attendu absent : ${rel}`);
    const dest = path.join(APP, "node_modules", ...rel.split("/"));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
  log(`${RUNTIME_EXTRAS.length} fichier(s) d'exécution ajouté(s) hors traçage`);

  // 4. version.json — RÉDUIT. Le serveur n'a besoin que du numéro de version
  // pour la vérification de mise à jour ; le changelog complet reste dans le
  // dépôt (il cite les profils de démonstration, sans intérêt pour l'utilisateur
  // final et inutilement bruyant pour le contrôle anti-fuite).
  const versionMeta = JSON.parse(
    fs.readFileSync(path.join(PROJECT, "version.json"), "utf-8")
  );
  const reduced = { version: versionMeta.version, build_date: versionMeta.build_date };
  // Variant de test : l'application lit ce champ (lib/update/check.ts ›
  // currentVariant) pour afficher « JobScout Test ». Absent du build standard.
  if (!isProd) reduced.variant = variant.id;
  fs.writeFileSync(
    path.join(APP, "version.json"),
    JSON.stringify(reduced, null, 2) + "\n"
  );

  // 5. data/ VIERGE. Les vraies données vivent dans %LOCALAPPDATA%\JobScout
  // (ou %LOCALAPPDATA%\JobScout Test pour le variant de test).
  const dataDir = path.join(APP, "data");
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(
    path.join(dataDir, "LISEZ-MOI.txt"),
    "Ce dossier est volontairement vide.\r\n\r\n" +
      `${variant.appName} ecrit toutes vos donnees (base, documents generes, moteur\r\n` +
      `LinkedIn) dans %LOCALAPPDATA%\\${variant.dataDirName}, jamais dans le repertoire\r\n` +
      `d'installation. Desinstaller ${variant.appName} ne supprime pas ces donnees.\r\n`,
    "utf-8"
  );

  // 6. Neutralisation des chemins absolus.
  log("réécriture des chemins absolus du poste de développement");
  const { filesTouched, replacements } = rewriteAbsolutePaths(PAYLOAD, PROJECT);
  log(`  ${replacements} occurrences réécrites dans ${filesTouched} fichiers → ${NEUTRAL_ROOT}`);

  // 7. Runtime Node embarqué.
  if (!skipNode) {
    const { exe, version: nodeVersion } = await ensureNodeRuntime();
    const runtimeDir = path.join(PAYLOAD, "runtime");
    fs.mkdirSync(runtimeDir, { recursive: true });
    fs.copyFileSync(exe, path.join(runtimeDir, "node.exe"));
    log(`runtime Node ${nodeVersion} embarqué`);
  }

  // 8. Icône + launcher natif.
  const ico = makeIcon(path.join(HERE, "assets", "jobscout.ico"));
  fs.copyFileSync(ico, path.join(PAYLOAD, "jobscout.ico"));
  // Le variant est une constante de compilation du launcher (nom affiché,
  // dossier de données, mutex) et, avec la version, alimente sa ressource de
  // version Win32 (FileVersion, ProductName…) — voir launcher/build-launcher.mjs.
  buildLauncher({ outDir: PAYLOAD, icon: ico, variant, version });
  log(
    `launcher JobScout.exe compilé${isProd ? "" : ` (variant ${variant.id})`} — ` +
      `ressource de version ${variant.appName} ${version}`
  );

  // 9. Note utilisateur.
  const readme = [
    `${variant.appName} ${version}`,
    "",
    "Lancez JobScout.exe : le serveur local demarre et votre navigateur",
    "s'ouvre sur l'application. Une icone reste dans la zone de notification",
    `(pres de l'horloge) : clic droit > Quitter ${variant.appName} pour tout arreter.`,
    "",
    "Vos donnees (base, CV et lettres generes) sont dans :",
    `  %LOCALAPPDATA%\\${variant.dataDirName}`,
    "Elles ne sont PAS supprimees par la desinstallation.",
    "",
    `${variant.appName} n'ecoute que sur 127.0.0.1 : rien n'est expose au reseau.`,
    "",
  ];
  if (isProd) {
    readme.push(
      "La source LinkedIn necessite un moteur Chromium (~100 Mo) qui n'est pas",
      "fourni : activez LinkedIn dans Profil > Sources pour le telecharger.",
      ""
    );
  } else {
    readme.push(
      `La source LinkedIn necessite un moteur Chromium (${ENGINE_DOWNLOAD_LABEL} a telecharger,`,
      `${ENGINE_DISK_LABEL} sur le disque une fois decompresse) qui n'est pas fourni :`,
      "activez LinkedIn dans Profil > Sources pour le telecharger.",
      "",
      `Build de TEST${signed ? "" : " non signe"} : le detail de ce qui est installe (tailles`,
      "mesurees), l'emplacement des donnees, ce qui n'est pas installe et les",
      `prerequis sont dans ${INFO_FILE_NAME}, a cote de ce fichier.`,
      ""
    );
  }
  fs.writeFileSync(path.join(PAYLOAD, "LISEZ-MOI.txt"), readme.join("\r\n"), "utf-8");

  // 10. Variant de test : page d'information « ce que cet installeur va
  // faire », avec les tailles MESURÉES sur la charge utile finale. Livrée
  // dans le paquet et branchée par build.mjs en InfoBeforeFile (JobScout.iss)
  // pour s'afficher AVANT l'installation.
  let info = null;
  if (!isProd) {
    info = writeInstallInfo(PAYLOAD, {
      appName: variant.appName,
      dataDirName: variant.dataDirName,
      version,
      signed,
    });
    const s = info.sizes;
    log(
      `${INFO_FILE_NAME} : lanceur ${mb(s.launcher)} + runtime ${mb(s.runtime)} ` +
        `+ app ${mb(s.app)} (mesurés sur le dist) + désinstalleur ${mb(s.uninstaller)} ` +
        `(estimé, écrit par Inno à l'installation) = ${mb(s.total)} sur le disque`
    );
  }

  const size = dirSize(PAYLOAD);
  log(`charge utile assemblée : ${mb(size)} → ${PAYLOAD}`);
  return { payload: PAYLOAD, version, size, variant, info };
}

const isMain =
  !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  assemble({
    skipNode: process.argv.includes("--skip-node"),
    variant: resolveVariant(),
    signed: signingEnabled(),
  }).catch((e) => {
    console.error(`[assemble] ÉCHEC : ${e.message}`);
    process.exit(1);
  });
}
