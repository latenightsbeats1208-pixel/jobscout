// ============================================================================
// installer/mac/bundle.mjs
//
// Arborescence de JobScout.app, Info.plist (depuis mac.json + version.json),
// PkgInfo, droits, et contrôles des interdits du paquet :
//   - aucun binaire exécutable (Mach-O, PE, ELF, détectés par le CONTENU)
//     ailleurs que Contents/MacOS/JobScout et Contents/MacOS/node ;
//   - aucun lien symbolique, aucun nom non ASCII, ni .DS_Store ni ._* ;
//   - aucun attribut étendu (xattr -cr avant le scellement).
//
// C'est aussi la bibliothèque commune de la chaîne Mac (annotations GitHub,
// exécution de commandes, lecture de mac.json, minos des Mach-O), utilisée par
// build-mac.mjs, fetch-node-mac.mjs, make-icns.mjs, make-dmg.mjs et
// sign-mac.mjs. Aucun effet de bord à l'import : les tests Vitest l'importent
// sous Windows.
//
//   node installer/mac/bundle.mjs --check [chemin.app]   contrôles seuls (macOS)
// ============================================================================
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const INSTALLER = path.dirname(HERE);
export const PROJECT = path.dirname(INSTALLER);
export const OUTPUT_MAC = path.join(INSTALLER, "output", "mac");
export const MAC_JSON = path.join(HERE, "mac.json");

// ------------------------------------------------------------ annotations
const inActions = () => process.env.GITHUB_ACTIONS === "true";
const escData = (s) =>
  String(s).replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
const escProp = (s) => escData(s).replace(/:/g, "%3A").replace(/,/g, "%2C");
const LABELS = { error: "ERREUR", warning: "AVERTISSEMENT", notice: "NOTE" };

/** `::error|warning|notice title=…::message` dans GitHub Actions, texte lisible ailleurs. */
export function annotate(level, title, message) {
  if (inActions()) {
    process.stdout.write(`::${level} title=${escProp(title)}::${escData(message)}\n`);
  } else {
    const stream = level === "error" ? process.stderr : process.stdout;
    stream.write(`[mac] ${LABELS[level] ?? level} — ${title} : ${message}\n`);
  }
}
export const notice = (title, message) => annotate("notice", title, message);
export const warning = (title, message) => annotate("warning", title, message);

/** Ajoute du Markdown au résumé de l'étape GitHub ($GITHUB_STEP_SUMMARY). */
export function stepSummary(markdown) {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (!file) return;
  fs.appendFileSync(file, markdown.endsWith("\n") ? markdown : markdown + "\n");
}

/** Erreur d'étape : son titre devient celui de l'annotation `::error`. */
export class StepError extends Error {
  constructor(title, message) {
    super(message);
    this.title = title;
  }
}
export function fail(title, message) {
  throw new StepError(title, message);
}

/**
 * Point d'entrée commun des scripts : toute exception devient `::error` puis
 * code 1. exitCode plutôt que process.exit() : sur macOS l'écriture vers un
 * tube est asynchrone, une sortie brutale tronquerait le journal.
 */
export async function runMain(name, fn) {
  try {
    await fn();
  } catch (e) {
    annotate("error", e?.title || name, e?.message || String(e));
    process.exitCode = 1;
    setTimeout(() => process.exit(1), 3000).unref();
  }
}

export const isMainModule = (metaUrl) =>
  !!process.argv[1] && metaUrl === pathToFileURL(process.argv[1]).href;

export function requireDarwin(title) {
  if (process.platform !== "darwin") {
    fail(title, `macOS requis (plateforme actuelle : ${process.platform}). Cette étape tourne sur les runners macOS de GitHub Actions.`);
  }
}

// ------------------------------------------------------------- commandes
/**
 * Lance une commande sans shell. Code non nul → exception avec la fin de
 * stderr. `secrets` : valeurs remplacées par *** dans tout ce qui est renvoyé
 * ou affiché, et arguments jamais recopiés dans le message d'erreur.
 */
export function run(cmd, args = [], opts = {}) {
  const { cwd, env, input, timeout, allowFail = false, secrets = [] } = opts;
  const r = spawnSync(cmd, args, {
    cwd,
    env,
    input,
    timeout,
    encoding: "utf8",
    maxBuffer: 512 * 1024 * 1024,
  });
  const hidden = secrets.filter((s) => typeof s === "string" && s.length > 0);
  const scrub = (s) => hidden.reduce((acc, sec) => acc.split(sec).join("***"), s ?? "");
  const res = {
    status: r.status,
    signal: r.signal,
    stdout: scrub(r.stdout),
    stderr: scrub(r.stderr),
    error: r.error,
  };
  if (!allowFail && (r.error || r.status !== 0)) {
    const tail = (res.stderr.trim() || res.stdout.trim())
      .split("\n")
      .slice(-15)
      .join("\n");
    const what = hidden.length
      ? `${path.basename(cmd)} ${args[0] ?? ""} (arguments masqués)`
      : `${path.basename(cmd)} ${args.join(" ")}`;
    const why = r.error
      ? scrub(r.error.message)
      : `code ${r.status}${r.signal ? ` (${r.signal})` : ""}`;
    throw new Error(`${what} : ${why}${tail ? `\n${tail}` : ""}`);
  }
  return res;
}

/** L'outil est-il présent dans le PATH ? */
export function hasTool(name) {
  return run("/usr/bin/which", [name], { allowFail: true }).status === 0;
}

// --------------------------------------------------------- configuration
const VERSION_RE = /^\d+\.\d+\.\d+$/;

/** Version du projet (version.json), au format CFBundleShortVersionString. */
export function readProjectVersion(project = PROJECT) {
  const v = JSON.parse(fs.readFileSync(path.join(project, "version.json"), "utf-8")).version;
  if (typeof v !== "string" || !VERSION_RE.test(v)) {
    throw new Error(`version.json : version « ${v} » invalide (attendu : X.Y.Z).`);
  }
  return v;
}

/** Contrôle la forme de mac.json ; renvoie la liste des problèmes (vide si correct). */
export function macConfigProblems(cfg) {
  const p = [];
  const str = (k, v) => {
    if (typeof v !== "string" || !v.trim()) p.push(`${k} : chaîne non vide attendue`);
  };
  if (!cfg || typeof cfg !== "object") return ["mac.json : objet attendu"];
  for (const k of [
    "bundleIdentifier", "bundleName", "displayName", "executableName", "iconName",
    "developmentRegion", "minimumSystemVersion", "applicationCategory", "copyright",
    "dataDirName", "dmgName", "sumsName", "reportName",
  ]) str(k, cfg[k]);
  if (typeof cfg.bundleIdentifier === "string" && !/^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/.test(cfg.bundleIdentifier)) {
    p.push("bundleIdentifier : lettres ASCII, chiffres, tirets et points seulement (domaine inversé)");
  }
  for (const k of ["bundleName", "executableName", "iconName", "dataDirName"]) {
    if (typeof cfg[k] === "string" && !/^[A-Za-z0-9][A-Za-z0-9 ._-]*$/.test(cfg[k])) {
      p.push(`${k} : nom ASCII simple attendu`);
    }
  }
  if (typeof cfg.minimumSystemVersion === "string" && !/^\d+\.\d+(\.\d+)?$/.test(cfg.minimumSystemVersion)) {
    p.push("minimumSystemVersion : X.Y attendu");
  }
  const ports = cfg.ports ?? {};
  if (!Number.isInteger(ports.first) || !Number.isInteger(ports.last) ||
      ports.first < 1024 || ports.last > 65535 || ports.first > ports.last) {
    p.push("ports : entiers first ≤ last entre 1024 et 65535 attendus");
  }
  const urls = cfg.urls ?? {};
  for (const k of ["releases", "download", "guide"]) {
    if (typeof urls[k] !== "string" || !urls[k].startsWith("https://github.com/")) {
      p.push(`urls.${k} : URL https://github.com/… attendue`);
    }
  }
  if (typeof urls.download === "string" && typeof cfg.dmgName === "string" &&
      !urls.download.endsWith(`/${cfg.dmgName}`)) {
    p.push("urls.download : doit se terminer par /<dmgName>");
  }
  const u = cfg.usageDescriptions ?? {};
  for (const k of ["localNetwork", "documentsFolder", "desktopFolder"]) str(`usageDescriptions.${k}`, u[k]);
  return p;
}

export function loadMacConfig(file = MAC_JSON) {
  const cfg = JSON.parse(fs.readFileSync(file, "utf-8"));
  const problems = macConfigProblems(cfg);
  if (problems.length) throw new Error(`mac.json invalide :\n  ${problems.join("\n  ")}`);
  return cfg;
}

export const bundlePathFor = (cfg, outDir = OUTPUT_MAC) => path.join(outDir, `${cfg.bundleName}.app`);

// ------------------------------------------------------------- Info.plist
/** Clés volontairement absentes d'Info.plist (voir la conception, §3.3). */
export const FORBIDDEN_INFO_KEYS = [
  "LSUIElement",
  "LSMultipleInstancesProhibited",
  "LSFileQuarantineEnabled",
  "NSSupportsSuddenTermination",
];

/** Dictionnaire Info.plist, dans l'ordre d'écriture. */
export function infoPlistDict(cfg, version) {
  if (typeof version !== "string" || !VERSION_RE.test(version)) {
    throw new Error(`version « ${version} » invalide pour CFBundleShortVersionString (attendu : X.Y.Z).`);
  }
  return {
    CFBundleDevelopmentRegion: cfg.developmentRegion,
    CFBundleDisplayName: cfg.displayName,
    CFBundleExecutable: cfg.executableName,
    CFBundleIconFile: cfg.iconName,
    CFBundleIdentifier: cfg.bundleIdentifier,
    CFBundleInfoDictionaryVersion: "6.0",
    CFBundleName: cfg.bundleName,
    CFBundlePackageType: "APPL",
    CFBundleShortVersionString: version,
    CFBundleVersion: version,
    LSApplicationCategoryType: cfg.applicationCategory,
    LSMinimumSystemVersion: cfg.minimumSystemVersion,
    NSHighResolutionCapable: true,
    NSHumanReadableCopyright: cfg.copyright,
    NSAppTransportSecurity: { NSAllowsLocalNetworking: true },
    NSLocalNetworkUsageDescription: cfg.usageDescriptions.localNetwork,
    NSDocumentsFolderUsageDescription: cfg.usageDescriptions.documentsFolder,
    NSDesktopFolderUsageDescription: cfg.usageDescriptions.desktopFolder,
    JobScoutDataDirName: cfg.dataDirName,
    JobScoutReleasesURL: cfg.urls.releases,
    JobScoutPortFirst: cfg.ports.first,
    JobScoutPortLast: cfg.ports.last,
  };
}

// Caractères interdits en XML 1.0 (hors tabulation et fins de ligne).
const XML_FORBIDDEN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/;

/** Échappement du contenu d'un élément XML : &, < et >. */
export function escapeXml(value) {
  const s = String(value);
  if (XML_FORBIDDEN.test(s)) {
    throw new Error(`caractère de contrôle interdit dans un plist : ${JSON.stringify(s)}`);
  }
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function plistValue(v, indent) {
  if (typeof v === "string") return `${indent}<string>${escapeXml(v)}</string>`;
  if (typeof v === "boolean") return `${indent}<${v ? "true" : "false"}/>`;
  if (typeof v === "number") {
    if (!Number.isInteger(v)) throw new Error(`plist : entier attendu, reçu ${v}`);
    return `${indent}<integer>${v}</integer>`;
  }
  if (Array.isArray(v)) {
    if (!v.length) return `${indent}<array/>`;
    return `${indent}<array>\n${v.map((x) => plistValue(x, indent + "\t")).join("\n")}\n${indent}</array>`;
  }
  if (v && typeof v === "object") {
    const keys = Object.keys(v);
    if (!keys.length) return `${indent}<dict/>`;
    const inner = keys
      .map((k) => {
        if (v[k] === undefined || v[k] === null) throw new Error(`plist : valeur absente pour « ${k} »`);
        return `${indent}\t<key>${escapeXml(k)}</key>\n${plistValue(v[k], indent + "\t")}`;
      })
      .join("\n");
    return `${indent}<dict>\n${inner}\n${indent}</dict>`;
  }
  throw new Error(`plist : type non pris en charge (${typeof v})`);
}

/** Plist XML (UTF-8) d'un dictionnaire de chaînes, entiers, booléens, tableaux et dictionnaires. */
export function plistXml(dict) {
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n' +
    '<plist version="1.0">\n' +
    plistValue(dict, "") +
    "\n</plist>\n"
  );
}

export const infoPlistXml = (cfg, version) => plistXml(infoPlistDict(cfg, version));
export const PKGINFO = "APPL????";

/** Plist RELU sur le disque par plutil (converti en JSON). macOS seulement. */
export function readPlist(file) {
  return JSON.parse(run("plutil", ["-convert", "json", "-o", "-", file]).stdout);
}

// ------------------------------------------------------- minos et lipo
/**
 * Lit la sortie de `xcrun vtool -show-build` : une entrée par tranche
 * (architecture), minos de LC_BUILD_VERSION ou version de
 * LC_VERSION_MIN_MACOSX. Tableau vide si rien n'est trouvé : à traiter comme
 * un échec, jamais comme un succès.
 */
export function parseVtoolMinos(text) {
  const out = [];
  let arch = null;
  let cmd = null;
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    const a = /\(architecture ([A-Za-z0-9_]+)\):$/.exec(line);
    if (a) {
      arch = a[1];
      cmd = null;
      continue;
    }
    const c = /^cmd (LC_[A-Z0-9_]+)$/.exec(line);
    if (c) {
      cmd = c[1];
      continue;
    }
    if (cmd === "LC_BUILD_VERSION") {
      const m = /^minos (\d+(?:\.\d+)*)$/.exec(line);
      if (m) out.push({ arch, minos: m[1], cmd });
    } else if (cmd === "LC_VERSION_MIN_MACOSX") {
      const m = /^version (\d+(?:\.\d+)*)$/.exec(line);
      if (m) out.push({ arch, minos: m[1], cmd });
    }
  }
  return out;
}

/** a ≤ b, versions numériques pointées (« 10.15 » ≤ « 11.0 », « 11 » = « 11.0 »). */
export function versionAtMost(a, b) {
  const pa = String(a).split(".").map((x) => parseInt(x, 10) || 0);
  const pb = String(b).split(".").map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x < y;
  }
  return true;
}

export const UNIVERSAL_ARCHS = "x86_64 arm64";

/**
 * Binaire universel : `lipo -archs` exactement « x86_64 arm64 », et minos de
 * chaque tranche ≤ minimum déclaré (LSMinimumSystemVersion). macOS seulement.
 */
export function checkUniversal(file, { minimum, label = path.basename(file) } = {}) {
  const archs = run("lipo", ["-archs", file]).stdout.trim();
  if (archs !== UNIVERSAL_ARCHS) {
    throw new Error(`${label} : lipo -archs affiche « ${archs} », attendu exactement « ${UNIVERSAL_ARCHS} ».`);
  }
  const entries = parseVtoolMinos(run("xcrun", ["vtool", "-show-build", file]).stdout);
  const seen = new Set(entries.map((e) => e.arch));
  if (!entries.length || !seen.has("x86_64") || !seen.has("arm64")) {
    throw new Error(`${label} : minos introuvable pour les deux tranches dans « vtool -show-build ».`);
  }
  const over = entries.filter((e) => !versionAtMost(e.minos, minimum));
  if (over.length) {
    throw new Error(
      `${label} : minos ${over.map((e) => `${e.minos} (${e.arch})`).join(", ")} > ${minimum} déclaré ` +
        "dans LSMinimumSystemVersion. Jamais de décalage silencieux : relevez le minimum dans mac.json ou recompilez."
    );
  }
  const minos = {};
  for (const e of entries) minos[e.arch] = e.minos;
  return { archs, minos };
}

// ----------------------------------------------------------- arborescence
/** Chemins relatifs en « / » : identiques sous Windows (tests) et macOS. */
const join = (a, b) => (a ? `${a}/${b}` : b);
const PRINTABLE_ASCII = /^[\x20-\x7e]+$/;

/**
 * Inventaire d'un dossier, sans suivre les liens : fichiers, dossiers, liens
 * symboliques, noms non ASCII, .DS_Store, ._* (AppleDouble), autres types.
 */
export function inspectTree(root) {
  const r = { files: [], dirs: [], symlinks: [], nonAscii: [], dsStore: [], appleDouble: [], others: [] };
  const stack = [""];
  while (stack.length) {
    const rel = stack.pop();
    const abs = rel ? path.join(root, ...rel.split("/")) : root;
    for (const ent of fs.readdirSync(abs, { withFileTypes: true })) {
      const p = join(rel, ent.name);
      if (!PRINTABLE_ASCII.test(ent.name)) r.nonAscii.push(p);
      if (ent.name === ".DS_Store") r.dsStore.push(p);
      if (ent.name.startsWith("._")) r.appleDouble.push(p);
      if (ent.isSymbolicLink()) r.symlinks.push(p);
      else if (ent.isDirectory()) {
        r.dirs.push(p);
        stack.push(p);
      } else if (ent.isFile()) r.files.push(p);
      else r.others.push(p);
    }
  }
  for (const k of Object.keys(r)) r[k].sort();
  return r;
}

/** Problèmes d'arborescence interdits partout (app/ et .app). */
export function treeProblems(tree) {
  const p = [];
  const list = (label, items) => {
    if (items.length) p.push(`${items.length} ${label} : ${items.slice(0, 10).join(", ")}${items.length > 10 ? ", …" : ""}`);
  };
  list("lien(s) symbolique(s)", tree.symlinks);
  list("nom(s) non ASCII", tree.nonAscii);
  list(".DS_Store", tree.dsStore);
  list("fichier(s) ._* (AppleDouble)", tree.appleDouble);
  list("entrée(s) ni fichier ni dossier", tree.others);
  return p;
}

let machoModule = null;
/** installer/macho.mjs (partagé) : détection Mach-O, PE et ELF par le contenu. */
async function loadMacho() {
  if (machoModule) return machoModule;
  let mod;
  try {
    mod = await import(pathToFileURL(path.join(INSTALLER, "macho.mjs")).href);
  } catch (e) {
    throw new Error(`installer/macho.mjs illisible : ${e.message}`);
  }
  if (typeof mod.fileBinaryKind !== "function") {
    throw new Error("installer/macho.mjs n'exporte pas fileBinaryKind(fichier).");
  }
  machoModule = mod;
  return mod;
}

/**
 * Fichiers dont le CONTENU est un binaire exécutable (Mach-O fin ou fat, PE,
 * ELF), jamais déduits du nom. `detect(cheminAbsolu)` remplace le détecteur
 * partagé (tests) ; par défaut fileBinaryKind() de installer/macho.mjs.
 */
export async function findExecutableBinaries(root, { files, detect } = {}) {
  let isBin = detect;
  if (!isBin) {
    const { fileBinaryKind } = await loadMacho();
    isBin = (abs) => fileBinaryKind(abs) !== null;
  }
  const list = files ?? inspectTree(root).files;
  const found = [];
  for (const rel of list) {
    const abs = path.join(root, ...rel.split("/"));
    let hit;
    try {
      hit = isBin(abs);
    } catch (e) {
      throw new Error(`lecture impossible : ${rel} (${e.code || e.message})`);
    }
    if (hit) found.push(rel);
  }
  return found.sort();
}

export function dirBytes(root) {
  let n = 0;
  for (const rel of inspectTree(root).files) n += fs.statSync(path.join(root, ...rel.split("/"))).size;
  return n;
}
export const mo = (bytes) => Math.round((bytes / 1024 / 1024) * 10) / 10;

// ---------------------------------------------------------------- bundle
/** Contenu exact attendu des trois dossiers du paquet (avant scellement). */
export function expectedBundleLayout(cfg) {
  return {
    Contents: ["Info.plist", "MacOS", "PkgInfo", "Resources"].sort(),
    "Contents/MacOS": [cfg.executableName, "node"].sort(),
    "Contents/Resources": [
      `${cfg.iconName}.icns`,
      "LICENSE-Node.js.txt",
      "THIRD_PARTY_NOTICES.txt",
      "app",
      "parent-guard.cjs",
    ].sort(),
  };
}

/** Fichiers indispensables de Resources/app (le serveur ne démarre pas sans eux). */
export const REQUIRED_APP_FILES = [
  "server.js",
  "package.json",
  "version.json",
  "data/LISEZ-MOI.txt",
  "lib/db/schema.sql",
  "prompts/generate-cv.md",
  ".next/BUILD_ID",
  ".next/app-path-routes-manifest.json",
  "node_modules/next/package.json",
  "node_modules/playwright-core/cli.js",
  "node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
  "node_modules/css-tree/data/patch.json",
];

/** Problèmes de contenu de Resources/app (présents attendus, absents exigés). */
export function appContentProblems(appDir, tree = inspectTree(appDir)) {
  const p = [];
  const files = new Set(tree.files);
  const dirs = new Set(tree.dirs);
  for (const f of REQUIRED_APP_FILES) if (!files.has(f)) p.push(`absent : ${f}`);
  if (!dirs.has(".next/static")) p.push("absent : .next/static/");
  if (!tree.files.some((f) => /^lib\/geo\/data\/[^/]+\.json\.gz$/.test(f))) {
    p.push("absent : lib/geo/data/*.json.gz");
  }
  const bad = [
    ...tree.files.filter((f) => /(^|\/)\.env(\.[^/]*)?$/i.test(f)).map((f) => `interdit : ${f}`),
    ...tree.files.filter((f) => /\.(db|sqlite3?)(-wal|-shm|-journal)?$/i.test(f)).map((f) => `interdit : ${f}`),
    ...tree.dirs.filter((d) => /(^|\/)node_modules\/(sharp|@img)$/.test(d)).map((d) => `interdit : ${d}/`),
    ...tree.dirs
      .filter((d) => /(^|\/)(chromium(_headless_shell)?-\d+|chrome-headless-shell-mac-[a-z0-9]+|ms-playwright)$/.test(d))
      .map((d) => `interdit (Chromium) : ${d}/`),
  ];
  return [...p, ...bad];
}

/**
 * Construit JobScout.app (non scellé) :
 *   Contents/Info.plist, PkgInfo
 *   Contents/MacOS/JobScout (lanceur), MacOS/node
 *   Contents/Resources/JobScout.icns, parent-guard.cjs, THIRD_PARTY_NOTICES.txt,
 *                      LICENSE-Node.js.txt, app/
 * puis chmod 755 des deux exécutables et `xattr -cr`. macOS seulement (ditto).
 */
export function createBundle({ cfg, version, app, node, nodeLicense, launcher, icns, parentGuard, notices, out }) {
  const inputs = {
    "app/ assemblé": app,
    "node universel": node,
    "LICENSE de Node": nodeLicense,
    "lanceur": launcher,
    "icône .icns": icns,
    "parent-guard.cjs": parentGuard,
    "THIRD_PARTY_NOTICES.txt": notices,
  };
  for (const [label, p] of Object.entries(inputs)) {
    if (!p || !fs.existsSync(p)) throw new Error(`${label} absent : ${p}`);
  }
  fs.rmSync(out, { recursive: true, force: true });
  const contents = path.join(out, "Contents");
  const macos = path.join(contents, "MacOS");
  const resources = path.join(contents, "Resources");
  fs.mkdirSync(macos, { recursive: true });
  fs.mkdirSync(resources, { recursive: true });

  run("ditto", ["--norsrc", "--noextattr", "--noqtn", "--noacl", app, path.join(resources, "app")]);
  fs.writeFileSync(path.join(contents, "Info.plist"), infoPlistXml(cfg, version), "utf-8");
  fs.writeFileSync(path.join(contents, "PkgInfo"), PKGINFO, "ascii");

  const exe = path.join(macos, cfg.executableName);
  const nodeDest = path.join(macos, "node");
  fs.copyFileSync(launcher, exe);
  fs.copyFileSync(node, nodeDest);
  fs.copyFileSync(icns, path.join(resources, `${cfg.iconName}.icns`));
  fs.copyFileSync(parentGuard, path.join(resources, "parent-guard.cjs"));
  fs.copyFileSync(notices, path.join(resources, "THIRD_PARTY_NOTICES.txt"));
  fs.copyFileSync(nodeLicense, path.join(resources, "LICENSE-Node.js.txt"));
  for (const f of [exe, nodeDest]) fs.chmodSync(f, 0o755);
  for (const f of ["parent-guard.cjs", "THIRD_PARTY_NOTICES.txt", "LICENSE-Node.js.txt", `${cfg.iconName}.icns`]) {
    fs.chmodSync(path.join(resources, f), 0o644);
  }
  fs.chmodSync(path.join(contents, "Info.plist"), 0o644);
  fs.chmodSync(path.join(contents, "PkgInfo"), 0o644);

  run("xattr", ["-cr", out]);
  return out;
}

const sameList = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * Contrôles du paquet (§3.3). `sealed` : le paquet est scellé
 * (_CodeSignature attendu, attributs étendus laissés à codesign --strict).
 * Lève une erreur qui liste TOUS les problèmes ; renvoie l'inventaire sinon.
 */
export async function checkBundle(bundle, { cfg, version, sealed = false, detect } = {}) {
  const problems = [];
  const layout = expectedBundleLayout(cfg);
  if (sealed) layout.Contents = [...layout.Contents, "_CodeSignature"].sort();
  for (const [dir, expected] of Object.entries(layout)) {
    const abs = path.join(bundle, ...dir.split("/"));
    const actual = fs.existsSync(abs) ? fs.readdirSync(abs).sort() : [];
    if (!sameList(actual, expected)) {
      problems.push(`${dir}/ contient [${actual.join(", ")}], attendu exactement [${expected.join(", ")}]`);
    }
  }
  if (!fs.existsSync(path.join(bundle, "Contents", "Info.plist"))) {
    throw new Error(`paquet incomplet : ${problems.join(" ; ")}`);
  }

  const tree = inspectTree(bundle);
  problems.push(...treeProblems(tree));

  const exeRel = `Contents/MacOS/${cfg.executableName}`;
  const expectedBins = [exeRel, "Contents/MacOS/node"].sort();
  const bins = await findExecutableBinaries(bundle, { files: tree.files, detect });
  if (!sameList(bins, expectedBins)) {
    problems.push(`binaires exécutables (par le contenu) : [${bins.join(", ")}], attendu exactement [${expectedBins.join(", ")}]`);
  }
  for (const rel of expectedBins) {
    const abs = path.join(bundle, ...rel.split("/"));
    if (fs.existsSync(abs) && (fs.statSync(abs).mode & 0o777) !== 0o755) {
      problems.push(`${rel} : droits ${(fs.statSync(abs).mode & 0o777).toString(8)}, attendu 755`);
    }
  }

  const appDir = path.join(bundle, "Contents", "Resources", "app");
  if (fs.existsSync(appDir)) {
    const appTree = inspectTree(appDir);
    problems.push(...appContentProblems(appDir, appTree));
  }

  const pkginfo = path.join(bundle, "Contents", "PkgInfo");
  if (fs.existsSync(pkginfo) && fs.readFileSync(pkginfo, "latin1") !== PKGINFO) {
    problems.push(`PkgInfo : contenu différent de « ${PKGINFO} »`);
  }

  // Info.plist RELU sur le disque (plutil), jamais seulement la chaîne écrite.
  const plist = path.join(bundle, "Contents", "Info.plist");
  const lint = run("plutil", ["-lint", plist], { allowFail: true });
  if (lint.status !== 0) problems.push(`plutil -lint : ${(lint.stderr || lint.stdout).trim()}`);
  else {
    const actual = readPlist(plist);
    const expected = infoPlistDict(cfg, version);
    const keys = new Set([...Object.keys(actual), ...Object.keys(expected)]);
    for (const k of keys) {
      if (JSON.stringify(actual[k]) !== JSON.stringify(expected[k])) {
        problems.push(`Info.plist ${k} : ${JSON.stringify(actual[k])}, attendu ${JSON.stringify(expected[k])}`);
      }
    }
    for (const k of FORBIDDEN_INFO_KEYS) if (k in actual) problems.push(`Info.plist : clé interdite ${k}`);
  }

  if (!sealed) {
    // `xattr -r` : une ligne « <chemin>: <attribut> » par attribut. Seul
    // com.apple.provenance, posé et protégé par macOS 13+, est toléré (signalé).
    const attrs = run("xattr", ["-r", bundle]).stdout
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => {
        const i = l.lastIndexOf(": ");
        return { file: i > 0 ? path.relative(bundle, l.slice(0, i)) : l, name: i > 0 ? l.slice(i + 2).trim() : "?" };
      });
    const bad = attrs.filter((a) => a.name !== "com.apple.provenance");
    if (bad.length) {
      problems.push(`${bad.length} attribut(s) étendu(s) après xattr -cr : ${bad.slice(0, 10).map((a) => `${a.file} (${a.name})`).join(", ")}`);
    }
    if (attrs.length > bad.length) {
      warning("Paquet", `com.apple.provenance posé par macOS sur ${attrs.length - bad.length} fichier(s) : attribut du système, sans effet sur la signature.`);
    }
  }

  const universal = {};
  for (const rel of expectedBins) {
    const abs = path.join(bundle, ...rel.split("/"));
    if (!fs.existsSync(abs)) continue;
    try {
      universal[rel] = checkUniversal(abs, { minimum: cfg.minimumSystemVersion, label: rel });
    } catch (e) {
      problems.push(e.message);
    }
  }

  if (problems.length) {
    throw new Error(`${problems.length} problème(s) dans ${path.basename(bundle)} :\n  - ${problems.join("\n  - ")}`);
  }
  return { files: tree.files.length, binaries: bins, universal };
}

// -------------------------------------------------------------------- CLI
if (isMainModule(import.meta.url)) {
  runMain("Contrôle du paquet", async () => {
    const args = process.argv.slice(2);
    if (!args.includes("--check")) {
      fail("bundle.mjs", "usage : node installer/mac/bundle.mjs --check [chemin.app]");
    }
    requireDarwin("Contrôle du paquet");
    const cfg = loadMacConfig();
    const target = args.find((a) => !a.startsWith("--")) ?? bundlePathFor(cfg);
    const sealed = fs.existsSync(path.join(target, "Contents", "_CodeSignature"));
    const r = await checkBundle(target, { cfg, version: readProjectVersion(), sealed });
    notice("Contrôle du paquet", `${path.basename(target)} : ${r.files} fichiers, binaires ${r.binaries.join(" + ")}, ${sealed ? "scellé" : "non scellé"} — conforme`);
  });
}
