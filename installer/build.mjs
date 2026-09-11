// ============================================================================
// installer/build.mjs — chaîne de release complète, rejouable.
//
//   npm run package                 build Next + assemblage + anti-fuite + ISCC
//   node installer/build.mjs --no-next-build   réutilise le .next existant
//   node installer/build.mjs --assemble-only   s'arrête avant Inno Setup
//   node installer/build.mjs --variant test    installeur de TEST « JobScout
//                                              Test » (voir variant.mjs)
//
// Sans --variant, le build standard est strictement inchangé. SEUL ce flag
// sélectionne le variant : la variable d'environnement JOBSCOUT_BUILD_VARIANT
// est ignorée, avec un avertissement en tête de build si elle est présente
// (un build standard ne doit jamais devenir « test » en silence).
//
// Le contrôle anti-fuite est un VERROU : si un seul terme personnel subsiste
// dans la charge utile, l'installeur n'est pas compilé.
// ============================================================================
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync, spawn } from "node:child_process";
import { assemble } from "./assemble.mjs";
import { checkLeaks } from "./check-leaks.mjs";
import { resolveVariant } from "./variant.mjs";
import {
  signingEnabled,
  signingDescription,
  signFile,
  verifyAuthenticode,
  reportSignature,
} from "./sign.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.dirname(HERE);
const OUTPUT = path.join(HERE, "output");

const log = (m) => process.stdout.write(`[build] ${m}\n`);

function findIscc() {
  const candidates = [
    path.join(
      process.env.LOCALAPPDATA || "",
      "Programs",
      "Inno Setup 6",
      "ISCC.exe"
    ),
    "C:\\Program Files (x86)\\Inno Setup 6\\ISCC.exe",
    "C:\\Program Files\\Inno Setup 6\\ISCC.exe",
  ];
  const found = candidates.find((p) => p && fs.existsSync(p));
  if (!found) throw new Error("ISCC.exe (Inno Setup 6) introuvable.");
  return found;
}

/**
 * Toutes les routes du build, déduites du manifeste de Next. On les balaie une
 * par une au démarrage à blanc : un module manquant dans la sortie tracée ne se
 * voit qu'au CHARGEMENT de la route concernée (un 500 « Cannot find module »),
 * jamais sur la page d'accueil. C'est ce balayage qui a rattrapé
 * css-tree/data/patch.json, sans lequel tout scan renvoyait 500.
 */
function allRoutes(payload) {
  const manifestPath = path.join(
    payload,
    "app",
    ".next",
    "app-path-routes-manifest.json"
  );
  if (!fs.existsSync(manifestPath)) return ["/"];
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
  return [
    ...new Set(
      Object.values(manifest)
        .filter((r) => typeof r === "string" && !r.startsWith("/_"))
        // Segments dynamiques : une valeur factice suffit à charger le module.
        .map((r) => r.replace(/\[[^\]]+\]/g, "1"))
    ),
  ].sort();
}

/**
 * Démarrage à blanc de la charge utile, avec un PATH MINIMAL et une base
 * jetable : prouve que le runtime embarqué suffit et que la sortie standalone
 * est complète — AVANT de passer vingt minutes à compresser un installeur.
 */
async function smokeTest(payload) {
  const port = 3919;
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "jobscout-smoke-"));
  const winDir = process.env.WINDIR || "C:\\Windows";
  const child = spawn(
    path.join(payload, "runtime", "node.exe"),
    ["server.js"],
    {
      cwd: path.join(payload, "app"),
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        SystemRoot: winDir,
        windir: winDir,
        TEMP: sandbox,
        TMP: sandbox,
        PATH: `${winDir}\\system32;${winDir}`,
        NODE_ENV: "production",
        HOSTNAME: "127.0.0.1",
        PORT: String(port),
        JOBSCOUT_DATA_DIR: sandbox,
        JOBSCOUT_DISABLE_UPDATE_CHECK: "1",
      },
    }
  );
  const out = [];
  child.stdout.on("data", (b) => out.push(b.toString()));
  child.stderr.on("data", (b) => out.push(b.toString()));

  try {
    const base = `http://127.0.0.1:${port}`;
    let rootStatus = null;
    const deadline = Date.now() + 90000;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) break;
      try {
        const res = await fetch(base + "/", { redirect: "manual" });
        if (res.status > 0) {
          rootStatus = res.status;
          break;
        }
      } catch {
        /* pas encore prêt */
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    if (rootStatus === null) {
      throw new Error(
        "le serveur assemblé n'a pas démarré :\n" + out.join("").slice(-2500)
      );
    }

    const routes = allRoutes(payload);
    const broken = [];
    for (const route of routes) {
      let status = 0;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 20000);
      try {
        const res = await fetch(base + route, {
          redirect: "manual",
          signal: ctrl.signal,
        });
        status = res.status;
        // On libère la connexion : /api/scan/start est un flux SSE.
        try { await res.body?.cancel(); } catch {}
      } catch {
        status = 0;
      } finally {
        clearTimeout(timer);
      }
      // 4xx est normal (méthode non autorisée, paramètre absent) ; 5xx signale
      // un module manquant ou une route cassée dans le paquet.
      if (status === 0 || status >= 500) broken.push(`${route} → ${status || "pas de réponse"}`);
    }
    if (broken.length) {
      const missing = (out.join("").match(/Cannot find module '[^']+'/g) || [])
        .filter((v, i, a) => a.indexOf(v) === i)
        .join(", ");
      throw new Error(
        `routes en échec dans le paquet :\n  ${broken.join("\n  ")}` +
          (missing ? `\nmodules manquants : ${missing}` : "")
      );
    }
    return { port, status: rootStatus, routes: routes.length };
  } finally {
    try { child.kill(); } catch {}
    await new Promise((r) => setTimeout(r, 800));
    try { fs.rmSync(sandbox, { recursive: true, force: true }); } catch {}
  }
}

async function main() {
  const args = process.argv.slice(2);
  // --variant test → « JobScout Test » : AppId, dossier, raccourcis, mutex,
  // dossier de données et fichier de sortie distincts, page d'information
  // avant installation. Sans option : prod. JOBSCOUT_BUILD_VARIANT n'est pas
  // lue (resolveVariant l'ignore et l'annonce en tête de build).
  const variant = resolveVariant(args);
  if (variant.id !== "prod") log(`variant de build : ${variant.id} (${variant.appName})`);

  if (!args.includes("--no-next-build")) {
    log("next build (output: standalone)…");
    // On appelle le binaire Next via node plutôt que npx : sur Windows,
    // execFile refuse désormais de lancer un .cmd sans shell.
    const nextBin = path.join(PROJECT, "node_modules", "next", "dist", "bin", "next");
    if (!fs.existsSync(nextBin)) throw new Error("CLI Next introuvable — npm install ?");
    execFileSync(process.execPath, [nextBin, "build"], {
      cwd: PROJECT,
      stdio: "inherit",
    });
  } else {
    log("build Next réutilisé (--no-next-build)");
  }

  // La page d'information du variant de test dit « signé / non signé » : on
  // lui transmet la décision de signature (prise ici, nulle part ailleurs).
  const { payload, version, size, info } = await assemble({
    variant,
    signed: signingEnabled(),
  });

  log("contrôle anti-fuite de données personnelles…");
  const { findings, scanned, needleCount } = checkLeaks([payload]);
  log(`  ${scanned} fichiers scannés, ${needleCount} termes recherchés`);
  if (findings.length) {
    console.error(`[build] BLOQUÉ — ${findings.length} fuite(s) dans la charge utile :`);
    for (const f of findings.slice(0, 40)) {
      console.error(`  - ${f.file} :: ${f.kind}`);
    }
    process.exit(1);
  }
  log("  0 occurrence — charge utile propre");

  log("démarrage à blanc de la charge utile (PATH minimal, sans Node système)…");
  const smoke = await smokeTest(payload);
  log(
    `  serveur assemblé opérationnel (HTTP ${smoke.status} sur /), ` +
      `${smoke.routes} routes chargées sans erreur 5xx`
  );

  // Signature Authenticode du launcher — APRÈS le contrôle anti-fuite et le
  // démarrage à blanc (ils valident le binaire tel que compilé), AVANT la
  // compression par Inno Setup : c'est ce JobScout.exe signé qui sera posé
  // sur la machine de l'utilisateur. Le certificat vient de l'environnement
  // uniquement (voir sign.mjs) — jamais du dépôt.
  const signed = signingEnabled();
  if (signed) {
    log(`signature du launcher (${signingDescription()})…`);
    const launcherExe = path.join(payload, "JobScout.exe");
    signFile(launcherExe);
    reportSignature(launcherExe, verifyAuthenticode(launcherExe));
  } else {
    log(
      "AVERTISSEMENT : build NON SIGNÉ — SmartScreen affichera « Éditeur\n" +
        "        inconnu ». Pour signer : JOBSCOUT_SIGN_PFX + " +
        "JOBSCOUT_SIGN_PFX_PASSWORD (voir installer/sign.mjs)."
    );
  }

  if (args.includes("--assemble-only")) {
    log(`arrêt avant Inno Setup (--assemble-only). Charge utile : ${payload}`);
    return;
  }

  fs.mkdirSync(OUTPUT, { recursive: true });
  const iscc = findIscc();
  log(`compilation de l'installeur (${path.basename(iscc)})…`);
  const isccArgs = [
    `/DMyAppVersion=${version}`,
    `/DPayloadDir=${payload}`,
    `/DOutDir=${OUTPUT}`,
  ];
  if (variant.id !== "prod") {
    isccArgs.push(`/DVariant=${variant.id}`);
    // Page « ce que cet installeur va faire », affichée AVANT l'installation
    // (InfoBeforeFile) : générée par assemble.mjs avec les tailles mesurées.
    if (info) isccArgs.push(`/DInfoFile=${info.file}`);
  }
  if (signed) {
    // Inno signe l'installeur ET le désinstalleur (SignedUninstaller=yes dans
    // le .iss) en appelant notre CLI : le mot de passe reste dans
    // l'environnement hérité, jamais sur une ligne de commande.
    isccArgs.push(
      "/DSignBuild=1",
      `/SJobScoutSign=$q${process.execPath}$q $q${path.join(HERE, "sign.mjs")}$q $f`
    );
  }
  isccArgs.push(path.join(HERE, "JobScout.iss"));
  execFileSync(iscc, isccArgs, { cwd: HERE, stdio: "inherit" });

  const setup = path.join(OUTPUT, `${variant.setupBaseName(version)}.exe`);
  if (!fs.existsSync(setup)) throw new Error("Installeur non produit par ISCC.");

  // Vérification finale : les DEUX binaires distribués doivent être signés et
  // horodatés (Get-AuthenticodeSignature) — sans horodatage, les signatures
  // expireraient avec le certificat.
  if (signed) {
    log("vérification des signatures (Get-AuthenticodeSignature)…");
    reportSignature(setup, verifyAuthenticode(setup));
    const payloadExe = path.join(payload, "JobScout.exe");
    reportSignature(payloadExe, verifyAuthenticode(payloadExe));
  }

  const setupSize = fs.statSync(setup).size;
  log(
    `OK — ${setup} (${(setupSize / 1024 / 1024).toFixed(1)} Mo, ` +
      `charge utile ${(size / 1024 / 1024).toFixed(1)} Mo)`
  );
  log(
    "Rappel : l'exécutable Inno compresse sa charge utile en LZMA. Le contrôle\n" +
      "        anti-fuite probant est celui de la charge utile ci-dessus et celui\n" +
      "        de l'arborescence installée (installer/test-install.mjs)."
  );
}

const isMain =
  !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((e) => {
    console.error(`[build] ÉCHEC : ${e.message}`);
    process.exit(1);
  });
}
