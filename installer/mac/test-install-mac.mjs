// ============================================================================
// installer/mac/test-install-mac.mjs — recette de JobScout-Mac.dmg, sur un Mac.
//
//   node installer/mac/test-install-mac.mjs --dmg <JobScout-Mac.dmg>
//        --sums <SHA256SUMS.txt> --rapport <rapport-construction.json>
//        [--out <dossier>]        journaux et résultats (défaut : recette-mac)
//
// Rejoue, sur le DMG livré, le parcours d'un utilisateur et ses pannes :
//   A. fichier livré : empreinte, hdiutil verify, contenu exact du volume,
//      signature, anti-fuite ;
//   B. paquet : Info.plist, architectures, Mach-O par le contenu, liens et
//      noms, fichiers présents et absents, attributs étendus, minos, node ;
//   C. serveur lancé depuis le volume en LECTURE SEULE (contrôles de
//      recette-app.mjs) puis arrêté par la fermeture de stdin ;
//   D. installation (ditto vers Applications, détachement, anti-fuite, repère) ;
//   E. lanceur réel sans interface : port, écoute 127.0.0.1, données, seconde
//      instance, moteur LinkedIn, arrêt par SIGTERM, relance ;
//   F. pannes : SIGKILL du lanceur pendant le téléchargement du moteur,
//      SIGKILL de node, port occupé, relance après un SIGKILL ;
//   G. interface : open -n puis SIGTERM ; lancement depuis le volume (code 64) ;
//   H. désinstallation (bundle inchangé, données intactes) et réinstallation ;
//   I. Gatekeeper, diagnostic sur une copie JAMAIS exécutée ;
//   J. répétition du runtime renforcé (sign-mac.mjs rehearsal).
//
// Sécurité :
//   - sous GitHub Actions : ~/Library/Application Support/JobScout et
//     /Applications/JobScout.app doivent être absents au départ ; l'app est
//     installée dans /Applications, les données dans le dossier réel ;
//   - ailleurs : refus si l'un des deux existe ; sinon tout se passe dans un
//     dossier temporaire (Applications, données par JOBSCOUT_DATA_DIR, HOME du
//     serveur) ;
//   - aucune exécution en quarantaine, jamais : un DMG ou une app marqués
//     com.apple.quarantine arrêtent la recette avant tout lancement.
//
// Un contrôle en échec ARRÊTE la recette (les suivants dépendent de son état) :
// annotation ::error avec la fin du journal utile, code 1. Chaque groupe publie
// une synthèse ::notice (tailles, durées, versions) ; GitHub en garde 10 par
// étape. Codes : 0 = tout est vert ; 1 = un contrôle a échoué ; 2 = recette
// refusée (usage, poste non vierge, système autre que macOS).
// ============================================================================
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { checkLeaks, homeDirNeedles } from "../check-leaks.mjs";
import { findExecutables } from "../macho.mjs";
import { treeDigest, compareDigests, sha256File } from "../tree-digest.mjs";
import { annotation, tailLines } from "./ci-status.mjs";
import * as A from "./recette-app.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.resolve(HERE, "..", "..");
const CI = process.env.GITHUB_ACTIONS === "true";
const { sleep, waitFor } = A;

// ------------------------------------------------------------ résultats
class CheckFailed extends Error {}
class Refused extends Error {}

const results = [];
const warnings = [];
let currentGroup = "";
/** Fin du journal utile en cas d'échec (change selon l'étape). */
let usefulLog = () => "";
const budget = { notice: 0 };
const deferredNotices = [];

function line(s) {
  process.stdout.write(s + "\n");
}

/** Contrôle bloquant : un échec arrête la recette. */
function check(id, label, ok, detail = "") {
  results.push({ id, group: currentGroup, label, ok: !!ok, detail: String(detail ?? "") });
  line(`  ${ok ? "OK   " : "ÉCHEC"} ${id} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) throw new CheckFailed(`${id} ${label}${detail ? ` — ${detail}` : ""}`);
  return true;
}

/** Avertissement : publié, jamais bloquant. */
function warn(id, label, detail = "") {
  warnings.push(`${id} ${label}${detail ? ` — ${detail}` : ""}`);
  results.push({ id, group: currentGroup, label, ok: null, detail: String(detail ?? "") });
  line(`  AVERT ${id} ${label}${detail ? ` — ${detail}` : ""}`);
}

/** Synthèse d'un groupe : une annotation ::notice (9 au plus, la dernière est réservée). */
function notice(title, message) {
  line(`[recette] ${title} : ${message}`);
  if (budget.notice < 8) {
    budget.notice++;
    if (CI) line(annotation("notice", title, message));
  } else deferredNotices.push(`${title} : ${message}`);
}

function group(name) {
  currentGroup = name;
  line(`\n[recette] ── ${name}`);
}

// --------------------------------------------------------------- outils
/** Commande synchrone ; ne lève jamais (le code est rendu). */
function run(cmd, argv, { cwd, env, timeoutMs = 120000 } = {}) {
  const t0 = Date.now();
  const r = spawnSync(cmd, argv, { cwd, env, encoding: "utf-8", maxBuffer: 256 * 1024 * 1024, timeout: timeoutMs });
  return {
    code: r.status,
    signal: r.signal,
    stdout: r.stdout ?? "",
    stderr: (r.stderr ?? "") + (r.error ? `\n${r.error.message}` : ""),
    ms: Date.now() - t0,
  };
}

const s1 = (ms) => `${(ms / 1000).toFixed(1).replace(".", ",")} s`;
const mo = (bytes) => `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} Mo`;
const readText = (f) => {
  try {
    return fs.readFileSync(f, "utf-8");
  } catch {
    return "";
  }
};
const readJson = (f) => {
  try {
    return JSON.parse(fs.readFileSync(f, "utf-8"));
  } catch {
    return null;
  }
};
const exists = (p) => {
  try {
    fs.lstatSync(p);
    return true;
  } catch {
    return false;
  }
};

function alive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return /** @type {any} */ (e).code === "EPERM";
  }
}

/** Processus de la machine : pid, groupe, ligne de commande complète. */
function processes() {
  const r = run("ps", ["-axww", "-o", "pid=", "-o", "pgid=", "-o", "command="]);
  return r.stdout
    .split("\n")
    .map((l) => /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(l))
    .filter(Boolean)
    .map((m) => ({ pid: Number(m[1]), pgid: Number(m[2]), command: m[3] }))
    .filter((p) => p.pid !== process.pid);
}

function processesUnder(...prefixes) {
  return processes().filter((p) => prefixes.some((x) => p.command.includes(x)));
}

function killUnder(...prefixes) {
  for (const p of processesUnder(...prefixes)) {
    try {
      process.kill(p.pid, "SIGKILL");
    } catch {}
  }
}

/** Arborescence en lstat : chemins relatifs « / ». */
function walk(root) {
  const out = [];
  const visit = (abs, rel) => {
    for (const name of fs.readdirSync(abs)) {
      const p = path.join(abs, name);
      const r = rel ? `${rel}/${name}` : name;
      const st = fs.lstatSync(p);
      out.push({ rel: r, abs: p, st });
      if (st.isDirectory() && !st.isSymbolicLink()) visit(p, r);
    }
  };
  visit(root, "");
  return out;
}

function dirBytes(root) {
  let n = 0;
  for (const e of walk(root)) if (e.st.isFile()) n += e.st.size;
  return n;
}

/** Attributs étendus d'une arborescence : [{ file, name }]. */
function xattrs(target) {
  const r = run("xattr", ["-r", target]);
  return r.stdout
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      const i = l.lastIndexOf(": ");
      return i > 0 ? { file: l.slice(0, i), name: l.slice(i + 2) } : { file: l, name: "?" };
    });
}

function hasQuarantine(p) {
  return run("xattr", ["-p", "com.apple.quarantine", p]).code === 0;
}

function plistJson(file) {
  const r = run("plutil", ["-convert", "json", "-o", "-", file]);
  if (r.code !== 0) return null;
  try {
    return JSON.parse(r.stdout);
  } catch {
    return null;
  }
}

/** Comparaison de versions « 11.0 » / « 11.0.1 ». */
function cmpVersion(a, b) {
  const pa = String(a).split(".").map(Number);
  const pb = String(b).split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

/** minos de chaque tranche (LC_BUILD_VERSION, ou LC_VERSION_MIN_MACOSX). */
function minosOf(bin) {
  const r = run("xcrun", ["vtool", "-show-build", bin]);
  const values = [...r.stdout.matchAll(/^\s*minos\s+([\d.]+)/gm)].map((m) => m[1]);
  for (const m of r.stdout.matchAll(/LC_VERSION_MIN_MACOSX[\s\S]*?\n\s*version\s+([\d.]+)/g)) values.push(m[1]);
  return { code: r.code, values };
}

/** Mode de signature constaté par le contenu (codesign -dvv). */
function signatureOf(target) {
  const r = run("codesign", ["-dvv", target]);
  const t = r.stderr + "\n" + r.stdout;
  if (/^Authority=Developer ID Application/m.test(t)) return "developer-id";
  if (/^Signature=adhoc$/m.test(t)) return "adhoc";
  return null;
}

// ---------------------------------------------------------- disque image
const mounts = new Set();

function attach(dmg) {
  const r = run("hdiutil", ["attach", "-readonly", "-nobrowse", "-noautoopen", "-plist", dmg], { timeoutMs: 600000 });
  if (r.code !== 0) return { mountPoint: null, error: tailLines(r.stderr, 5) };
  const start = r.stdout.indexOf("<?xml");
  const end = r.stdout.lastIndexOf("</plist>");
  const tmp = path.join(os.tmpdir(), `recette-attach-${process.pid}-${Date.now()}.plist`);
  fs.writeFileSync(tmp, start >= 0 && end > start ? r.stdout.slice(start, end + 8) : r.stdout);
  const pl = plistJson(tmp);
  fs.rmSync(tmp, { force: true });
  const ent = (pl?.["system-entities"] ?? []).find((e) => e["mount-point"]);
  if (!ent) return { mountPoint: null, error: "point de montage absent de la réponse de hdiutil" };
  mounts.add(ent["mount-point"]);
  return { mountPoint: ent["mount-point"], error: null };
}

async function detach(mountPoint) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    if (run("hdiutil", ["detach", mountPoint]).code === 0) {
      mounts.delete(mountPoint);
      return true;
    }
    await sleep(2000);
  }
  const ok = run("hdiutil", ["detach", "-force", mountPoint]).code === 0;
  if (ok) mounts.delete(mountPoint);
  return ok;
}

// ------------------------------------------------------------- lanceur
const live = new Set();

/** Lance un processus, sorties dans <out>/<name>.{out,err}.log. */
function launch(ctx, name, bin, argv, { env, cwd, stdin = "ignore", detached = false } = {}) {
  const outFile = path.join(ctx.out, `${name}.out.log`);
  const errFile = path.join(ctx.out, `${name}.err.log`);
  const outFd = fs.openSync(outFile, "a");
  const errFd = fs.openSync(errFile, "a");
  const t0 = Date.now();
  const child = spawn(bin, argv, { env, cwd, detached, stdio: [stdin, outFd, errFd] });
  fs.closeSync(outFd);
  fs.closeSync(errFd);
  /** @type {any} */
  const h = { name, child, pid: child.pid, t0, exit: null, outFile, errFile };
  h.exited = new Promise((resolve) => {
    child.once("exit", (code, signal) => {
      h.exit = { code, signal, ms: Date.now() - t0 };
      live.delete(h);
      resolve(h.exit);
    });
    child.once("error", (e) => {
      h.exit = { code: null, signal: null, ms: Date.now() - t0, error: e.message };
      live.delete(h);
      resolve(h.exit);
    });
  });
  live.add(h);
  return h;
}

/** Sortie du processus, ou null après `ms` (le délai ne retient pas la fin du script). */
async function waitExit(h, ms) {
  if (h.exit) return h.exit;
  let timer = null;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  try {
    return await Promise.race([h.exited, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

const exitText = (ex) => (ex ? (ex.error ? `erreur ${ex.error}` : ex.signal ? `signal ${ex.signal}` : `code ${ex.code}`) : "toujours actif");

function readRuntime(dataDir) {
  return readJson(path.join(dataDir, "runtime.json"));
}

/**
 * Environnement du lanceur : celui de la session, plus des pièges que le
 * lanceur doit neutraliser (voir §3.4, étape 8).
 */
function launcherEnv(ctx, dataDir) {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith("JOBSCOUT_")) delete env[k];
  Object.assign(env, {
    HOSTNAME: "0.0.0.0",
    NODE_OPTIONS: `--require ${path.join(ctx.trapDir, "inexistant.cjs")}`,
    PORT: "9",
    JOBSCOUT_VERSION: "0.0.0-piege",
    JOBSCOUT_DB_PATH: path.join(ctx.trapDir, "jobscout.db"),
    JOBSCOUT_DOCS_PATH: path.join(ctx.trapDir, "documents"),
    PLAYWRIGHT_BROWSERS_PATH: path.join(ctx.trapDir, "browsers"),
    ANTHROPIC_API_KEY: "sk-ant-recette-jamais-utilisee-0000000000",
    ANTHROPIC_AUTH_TOKEN: "jeton-recette-jamais-utilise",
    ANTHROPIC_BASE_URL: "http://127.0.0.1:9",
  });
  if (ctx.customData || dataDir !== ctx.dataDir) env.JOBSCOUT_DATA_DIR = dataDir;
  if (!CI) env.HOME = ctx.sandboxHome;
  return env;
}

/** Lance le lanceur sans interface et attend SON runtime.json (pid = le sien). */
async function startLauncher(ctx, name, dataDir = ctx.dataDir) {
  const h = launch(ctx, name, ctx.launcherBin, ["--no-browser", "--non-interactive"], { env: launcherEnv(ctx, dataDir) });
  usefulLog = () => `${tailLines(readText(h.errFile), 6)}\n--- server.log ---\n${tailLines(readText(path.join(dataDir, "logs", "server.log")), 15)}`;
  await waitFor(() => !!h.exit || readRuntime(dataDir)?.pid === h.pid, 130000, 200);
  const rt = readRuntime(dataDir);
  return { h, rt: rt && rt.pid === h.pid ? rt : null, ms: Date.now() - h.t0 };
}

async function stopLauncher(h, signal = "SIGTERM", timeoutMs = 10000) {
  const t0 = Date.now();
  try {
    process.kill(h.pid, signal);
  } catch {}
  const ex = await waitExit(h, timeoutMs);
  return { exit: ex, ms: Date.now() - t0 };
}

/** Tout est-il arrêté pour ce lancement ? (pid, port, processus, runtime.json) */
async function allStopped(ctx, rt, dataDir) {
  const procs = processesUnder(ctx.macosPrefix, path.join(dataDir, "browsers") + "/");
  const port = rt?.url ? Number(new URL(rt.url).port) : null;
  const portClosed = port ? (await A.portState(port)) === "fermé" : true;
  return {
    ok: !alive(rt?.pid) && !alive(rt?.serverPid) && procs.length === 0 && portClosed && !exists(path.join(dataDir, "runtime.json")),
    detail: `lanceur ${alive(rt?.pid) ? "actif" : "arrêté"}, node ${alive(rt?.serverPid) ? "actif" : "arrêté"}, ` +
      `${procs.length} processus restant(s), port ${portClosed ? "fermé" : "ouvert"}, runtime.json ${exists(path.join(dataDir, "runtime.json")) ? "présent" : "supprimé"}`,
  };
}

/** Processus d'écoute d'un port (lsof) : [{ pid, addr }]. */
function listeners(port) {
  const r = run("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-Fpn"]);
  const out = [];
  let pid = null;
  for (const l of r.stdout.split("\n")) {
    if (l.startsWith("p")) pid = Number(l.slice(1));
    else if (l.startsWith("n") && pid) out.push({ pid, addr: l.slice(1) });
  }
  return out;
}

/** Exécutable d'un processus (première entrée « txt » de lsof). */
function executableOf(pid) {
  const r = run("lsof", ["-a", "-p", String(pid), "-d", "txt", "-Fn"]);
  const n = r.stdout.split("\n").find((l) => l.startsWith("n"));
  return n ? n.slice(1) : null;
}

// ============================================================== groupes
async function groupA(ctx) {
  group("A. Fichier livré");
  const dmgDir = path.dirname(ctx.dmg);
  check("A.0", "DMG sans attribut de quarantaine (aucune exécution en quarantaine)", !hasQuarantine(ctx.dmg));
  const sumsLines = readText(ctx.sums).split("\n").filter((l) => l.trim());
  const m = /^([0-9a-f]{64}) [ *](.+)$/.exec(sumsLines[0] ?? "");
  check("A.1a", "SHA256SUMS.txt : une ligne, pour le DMG livré", sumsLines.length === 1 && !!m && m[2] === path.basename(ctx.dmg) && path.dirname(ctx.sums) === dmgDir, `${sumsLines.length} ligne(s) : ${m ? m[2] : "illisible"}`);
  const sc = run("shasum", ["-a", "256", "-c", path.basename(ctx.sums)], { cwd: dmgDir, timeoutMs: 300000 });
  const sha = sha256File(ctx.dmg);
  check("A.1", "shasum -a 256 -c SHA256SUMS.txt : 0, empreinte recalculée identique", sc.code === 0 && m?.[1] === sha, `code ${sc.code}, ${sha.slice(0, 16)}…`);
  const verify = run("hdiutil", ["verify", ctx.dmg], { timeoutMs: 600000 });
  check("A.2", "hdiutil verify : 0", verify.code === 0, verify.code === 0 ? s1(verify.ms) : tailLines(verify.stderr + verify.stdout, 4));
  ctx.measures.dmgBytes = fs.statSync(ctx.dmg).size;

  const t0 = Date.now();
  const at = attach(ctx.dmg);
  check("A.3a", "montage en lecture seule (hdiutil attach -readonly -nobrowse -noautoopen)", !!at.mountPoint, at.error ?? `${at.mountPoint} en ${s1(Date.now() - t0)}`);
  ctx.vol = at.mountPoint;
  const entries = fs.readdirSync(ctx.vol);
  const visible = entries.filter((n) => !n.startsWith(".")).sort();
  // Métadonnées du système de fichiers HFS+ (journal, fseventsd…) : tolérées.
  const fsMeta = /^\.(fseventsd|journal|journal_info_block|Trashes|Spotlight-V100|DocumentRevisions-V100|TemporaryItems|HFS\+ Private Directory Data\r?)$/;
  const hidden = entries.filter((n) => n.startsWith(".") && !fsMeta.test(n));
  check("A.3b", "volume : exactement JobScout.app, Applications, LISEZ-MOI.txt", JSON.stringify(visible) === JSON.stringify(["Applications", ctx.appName, "LISEZ-MOI.txt"].sort()) && hidden.length === 0, `visibles : ${visible.join(", ")}${hidden.length ? ` ; cachés inattendus : ${hidden.join(", ")}` : ""}`);
  const link = path.join(ctx.vol, "Applications");
  const isLink = fs.lstatSync(link).isSymbolicLink();
  check("A.3c", "Applications → /Applications (lien symbolique)", isLink && fs.readlinkSync(link) === "/Applications", isLink ? fs.readlinkSync(link) : "pas un lien");
  const readme = fs.readFileSync(path.join(ctx.vol, "LISEZ-MOI.txt"));
  let readmeText = null;
  try {
    readmeText = new TextDecoder("utf-8", { fatal: true }).decode(readme);
  } catch {}
  check("A.3d", `LISEZ-MOI.txt : UTF-8 valide, « JobScout ${ctx.v} pour Mac », aucun {{…}}`, readmeText !== null && readmeText.startsWith(`JobScout ${ctx.v} pour Mac`) && !readmeText.includes("{{"), readmeText === null ? "UTF-8 invalide" : readmeText.split("\n")[0]);
  ctx.volApp = path.join(ctx.vol, ctx.appName);
  const cv = run("codesign", ["--verify", "--deep", "--strict", "--verbose=2", ctx.volApp]);
  check("A.4", "codesign --verify --deep --strict (app du volume) : 0", cv.code === 0, cv.code === 0 ? "" : tailLines(cv.stderr, 4));
  ctx.signature = signatureOf(ctx.volApp);
  check("A.4b", "signature constatée : ad hoc ou Developer ID", ctx.signature !== null, ctx.signature ?? "codesign -dvv illisible");
  const leaks = checkLeaks([ctx.volApp, path.join(ctx.vol, "LISEZ-MOI.txt")], { verbose: false, extraNeedles: homeDirNeedles() });
  check("A.5", `anti-fuite sur le volume (${leaks.scanned} fichiers) : 0 occurrence`, leaks.findings.length === 0, leaks.findings.slice(0, 5).map((f) => `${f.file} :: ${f.kind}`).join(" | "));
  // Copie pour le diagnostic Gatekeeper (groupe I) : elle ne sera JAMAIS exécutée.
  ctx.gkCopy = path.join(ctx.tmp, "gatekeeper", ctx.appName);
  fs.mkdirSync(path.dirname(ctx.gkCopy), { recursive: true });
  check("A.6", "copie témoin pour Gatekeeper (jamais exécutée)", run("ditto", [ctx.volApp, ctx.gkCopy], { timeoutMs: 300000 }).code === 0);
}

async function groupB(ctx) {
  group("B. Paquet");
  const contents = path.join(ctx.volApp, "Contents");
  const plistFile = path.join(contents, "Info.plist");
  const lint = run("plutil", ["-lint", plistFile]);
  check("B.1a", "plutil -lint Info.plist : 0", lint.code === 0, lint.stdout.trim());
  const pl = plistJson(plistFile) ?? {};
  const appVersion = readJson(path.join(contents, "Resources", "app", "version.json"))?.version;
  const pkgVersion = readJson(path.join(PROJECT, "package.json"))?.version;
  check("B.1b", `identifiant ${ctx.mac.bundleIdentifier}`, pl.CFBundleIdentifier === ctx.mac.bundleIdentifier && ctx.mac.bundleIdentifier === "fr.jobscout.app", pl.CFBundleIdentifier);
  check("B.1c", `version ${ctx.v} = Info.plist = app/version.json = package.json`, pl.CFBundleShortVersionString === ctx.v && pl.CFBundleVersion === ctx.v && appVersion === ctx.v && pkgVersion === ctx.v, `plist ${pl.CFBundleShortVersionString}/${pl.CFBundleVersion}, app ${appVersion}, package ${pkgVersion}`);
  const expected = {
    CFBundleExecutable: ctx.mac.executableName,
    CFBundlePackageType: "APPL",
    CFBundleIconFile: ctx.mac.iconName,
    LSMinimumSystemVersion: ctx.mac.minimumSystemVersion,
    JobScoutDataDirName: ctx.mac.dataDirName,
    JobScoutPortFirst: ctx.mac.ports.first,
    JobScoutPortLast: ctx.mac.ports.last,
  };
  // Comparaison en texte : <integer> ou <string> dans le plist, peu importe ici.
  const wrong = Object.entries(expected).filter(([k, v]) => String(pl[k]) !== String(v)).map(([k, v]) => `${k}=${pl[k]} (attendu ${v})`);
  const forbidden = ["LSUIElement", "LSMultipleInstancesProhibited", "LSFileQuarantineEnabled", "NSSupportsSuddenTermination"].filter((k) => k in pl);
  check("B.1d", "Info.plist : clés attendues, clés interdites absentes", wrong.length === 0 && forbidden.length === 0, [...wrong, ...forbidden.map((k) => `${k} présente`)].join(" ; "));
  check("B.1e", "PkgInfo = « APPL???? »", readText(path.join(contents, "PkgInfo")) === "APPL????");

  ctx.volLauncher = path.join(contents, "MacOS", ctx.mac.executableName);
  ctx.volNode = path.join(contents, "MacOS", "node");
  const archs = {};
  for (const [label, bin] of [["lanceur", ctx.volLauncher], ["node", ctx.volNode]]) {
    const r = run("lipo", ["-archs", bin]);
    archs[label] = r.stdout.trim();
    check(`B.2${label === "node" ? "b" : "a"}`, `lipo -archs ${label} : x86_64 et arm64`, r.code === 0 && JSON.stringify(r.stdout.trim().split(/\s+/).sort()) === JSON.stringify(["arm64", "x86_64"]), r.stdout.trim());
  }
  const executables = findExecutables(ctx.volApp);
  const machos = executables.filter((e) => e.kind === "macho" || e.kind === "macho-fat");
  check(
    "B.3",
    "Mach-O par le contenu = MacOS/JobScout et MacOS/node, rien d'autre",
    JSON.stringify(machos.map((e) => e.path).sort()) === JSON.stringify([`Contents/MacOS/${ctx.mac.executableName}`, "Contents/MacOS/node"].sort()),
    machos.map((e) => `${e.path} (${(e.archs ?? []).join("+")})`).join(", ")
  );
  const others = executables.filter((e) => e.kind === "pe" || e.kind === "elf");
  if (others.length) warn("B.3b", `${others.length} exécutable(s) Windows ou Linux dans l'app (inutiles sur Mac)`, others.slice(0, 5).map((e) => `${e.path} (${e.kind})`).join(", "));
  const tree = walk(ctx.volApp);
  ctx.measures.appFiles = tree.filter((e) => e.st.isFile()).length;
  ctx.measures.appBytes = tree.reduce((n, e) => n + (e.st.isFile() ? e.st.size : 0), 0);
  ctx.measures.nodeBytes = fs.statSync(ctx.volNode).size;
  ctx.measures.launcherBytes = fs.statSync(ctx.volLauncher).size;
  const links = tree.filter((e) => e.st.isSymbolicLink()).map((e) => e.rel);
  const nonAscii = tree.filter((e) => /[^\x20-\x7e]/.test(e.rel)).map((e) => e.rel);
  check("B.4a", "aucun lien symbolique dans l'app", links.length === 0, links.slice(0, 5).join(", "));
  check("B.4b", "aucun nom de fichier non ASCII", nonAscii.length === 0, nonAscii.slice(0, 5).join(", "));
  const junk = tree.filter((e) => /(^|\/)(\.DS_Store|\._[^/]*)$/.test(e.rel)).map((e) => e.rel);
  check("B.4c", "ni .DS_Store ni ._*", junk.length === 0, junk.slice(0, 5).join(", "));
  const attrs = xattrs(ctx.volApp);
  const badAttrs = attrs.filter((a) => a.name !== "com.apple.provenance");
  check("B.4d", "aucun attribut étendu dans l'app (xattr -r)", badAttrs.length === 0, badAttrs.slice(0, 5).map((a) => `${path.relative(ctx.vol, a.file)} : ${a.name}`).join(" | "));
  if (attrs.length > badAttrs.length) warn("B.4e", `com.apple.provenance posé par macOS sur ${attrs.length - badAttrs.length} fichier(s) de l'app`, "attribut du système, sans effet sur la signature");

  const present = [
    "Info.plist", "PkgInfo", "_CodeSignature/CodeResources",
    `Resources/${ctx.mac.iconName}.icns`, "Resources/parent-guard.cjs", "Resources/THIRD_PARTY_NOTICES.txt", "Resources/LICENSE-Node.js.txt",
    "Resources/app/server.js", "Resources/app/version.json", "Resources/app/lib/db/schema.sql", "Resources/app/prompts/generate-cv.md",
    "Resources/app/.next/static", "Resources/app/node_modules/playwright-core/cli.js",
    "Resources/app/node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs", "Resources/app/node_modules/css-tree/data/patch.json",
    "Resources/app/lib/geo/data/geo-fr.json.gz", "Resources/app/lib/geo/data/geo-world.json.gz", "Resources/app/data/LISEZ-MOI.txt",
  ];
  const missing = present.filter((rel) => !exists(path.join(contents, rel)));
  check("B.5", `${present.length} fichiers attendus présents`, missing.length === 0, missing.join(", "));
  // Chromium : dossiers d'installation de Playwright (chromium-1217,
  // chromium_headless_shell-1217, .local-browsers) ou binaire du navigateur.
  const absent = tree
    .filter(({ rel, st }) => {
      const name = path.basename(rel);
      return (
        /(^|\/)\.env(\.|$)/.test(rel) ||
        /\.db(-wal|-shm|-journal)?$/.test(rel) ||
        (st.isDirectory() && /\/node_modules\/(@img|sharp)$/.test(rel)) ||
        (st.isDirectory() && /^(\.local-browsers|chromium-\d+|chromium_headless_shell-\d+|chromium-headless-shell-\d+|Chromium\.app|Google Chrome for Testing\.app)$/.test(name)) ||
        (st.isFile() && name === "chrome-headless-shell")
      );
    })
    .map((e) => e.rel);
  check("B.6", "absents : .env, *.db, @img, sharp, Chromium", absent.length === 0, absent.slice(0, 5).join(", "));

  const min = ctx.mac.minimumSystemVersion;
  for (const [label, bin, id] of [["lanceur", ctx.volLauncher, "B.7a"], ["node", ctx.volNode, "B.7b"]]) {
    const r = minosOf(bin);
    ctx.measures[`minos_${label}`] = r.values.join("/");
    check(id, `minos du ${label} ≤ ${min} (vtool, chaque tranche)`, r.code === 0 && r.values.length >= 2 && r.values.every((x) => cmpVersion(x, min) <= 0), r.values.join(", ") || "illisible");
  }
  const env = { PATH: "/usr/bin:/bin", HOME: ctx.sandboxHome, TMPDIR: ctx.sandboxTmp };
  const nv = run(ctx.volNode, ["-p", "process.arch+' '+process.version"], { env });
  check("B.8", `node embarqué : « ${ctx.nodeArch} ${ctx.nodeVersion} »`, nv.code === 0 && nv.stdout.trim() === `${ctx.nodeArch} ${ctx.nodeVersion}`, nv.stdout.trim() || tailLines(nv.stderr, 3));
  ctx.measures.rosetta = "sans objet";
  if (ctx.runnerArch === "arm64") {
    if (run("arch", ["-x86_64", "/usr/bin/true"]).code === 0) {
      const x = run("arch", ["-x86_64", ctx.volNode, "-p", "process.arch+' '+process.version"], { env });
      ctx.measures.rosetta = x.code === 0 ? x.stdout.trim() : `échec (code ${x.code})`;
      if (x.stdout.trim() !== `x64 ${ctx.nodeVersion}`) warn("B.8b", "tranche x86_64 de node sous Rosetta", ctx.measures.rosetta);
    } else ctx.measures.rosetta = "Rosetta absente";
  }
  notice(
    `Recette A–B (${ctx.label})`,
    `DMG ${mo(ctx.measures.dmgBytes)}, empreinte vérifiée ; app ${mo(ctx.measures.appBytes)} en ${ctx.measures.appFiles} fichiers ; ` +
      `lanceur ${archs.lanceur} ${mo(ctx.measures.launcherBytes)} (minos ${ctx.measures.minos_lanceur}) ; ` +
      `node ${archs.node} ${ctx.nodeVersion} ${mo(ctx.measures.nodeBytes)} (minos ${ctx.measures.minos_node}) ; ` +
      `signature ${ctx.signature} ; Rosetta : ${ctx.measures.rosetta}`
  );
}

async function groupC(ctx) {
  group("C. Serveur depuis le volume en lecture seule");
  const res = path.join(ctx.volApp, "Contents", "Resources");
  const appDir = path.join(res, "app");
  const { allRoutes } = await import("../build.mjs");
  check("C.0a", "allRoutes exporté par installer/build.mjs", typeof allRoutes === "function");
  const routes = allRoutes(res);
  const port = await A.freePort([3922, 3923, 3924, 3925, 3926]);
  check("C.0b", "port de recette libre", port !== null, String(port));
  const sb = path.join(ctx.tmp, "C");
  const dataDir = path.join(sb, "data");
  for (const d of [sb, path.join(sb, "home"), path.join(sb, "tmp"), dataDir]) fs.mkdirSync(d, { recursive: true });
  const env = {
    PATH: "/usr/bin:/bin",
    HOME: path.join(sb, "home"),
    TMPDIR: path.join(sb, "tmp"),
    NODE_ENV: "production",
    HOSTNAME: "127.0.0.1",
    PORT: String(port),
    NEXT_TELEMETRY_DISABLED: "1",
    JOBSCOUT_DATA_DIR: dataDir,
    JOBSCOUT_DB_PATH: path.join(dataDir, "jobscout.db"),
    JOBSCOUT_DOCS_PATH: path.join(dataDir, "documents"),
    PLAYWRIGHT_BROWSERS_PATH: path.join(dataDir, "browsers"),
    JOBSCOUT_PARENT_GUARD: "1",
    JOBSCOUT_DISABLE_UPDATE_CHECK: "1",
    JOBSCOUT_PROXY_URL: "http://127.0.0.1:9",
    ANTHROPIC_API_KEY: "sk-ant-recette-jamais-utilisee-0000000000",
    ANTHROPIC_AUTH_TOKEN: "jeton-recette-jamais-utilise",
    ANTHROPIC_BASE_URL: "http://127.0.0.1:9",
  };
  // stdin en TUBE : parent-guard.cjs arrête le serveur à sa fermeture (avec
  // /dev/null, il s'arrêterait aussitôt). Groupe de processus propre, comme
  // sous le lanceur (POSIX_SPAWN_SETPGROUP).
  const h = launch(ctx, "C-serveur", ctx.volNode, ["--require", path.join(res, "parent-guard.cjs"), "server.js"], { env, cwd: appDir, stdin: "pipe", detached: true });
  const logText = () => readText(h.outFile) + readText(h.errFile);
  usefulLog = () => tailLines(logText(), 15);
  const base = `http://127.0.0.1:${port}`;
  const up = await waitFor(async () => {
    if (h.exit) return true;
    const r = await A.http(base + "/api/update", { timeoutMs: 2500 });
    return r.status === 200 && r.json?.current === ctx.v;
  }, 90000, 400);
  const readyMs = Date.now() - h.t0;
  check("C.0c", "serveur prêt (/api/update : current = version) en moins de 90 s", up && !h.exit, h.exit ? `arrêté : ${exitText(h.exit)}` : s1(readyMs));
  const r = await A.runAppChecks({ base, version: ctx.v, dataDir, appDir, routes, readLog: logText, check, warn, prefix: "C" });
  const t0 = Date.now();
  h.child.stdin.end();
  const ex = await waitExit(h, 10000);
  const stopMs = Date.now() - t0;
  check("C.90", "fermeture de stdin : serveur arrêté en moins de 10 s", !!ex, ex ? `${exitText(ex)} en ${s1(stopMs)}` : "toujours actif");
  const denied = A.fsDeniedLines(logText());
  check("C.91", "aucun EROFS, EACCES ni EPERM dans le journal (rien n'écrit dans l'app)", denied.length === 0, denied.slice(0, 3).join(" | "));
  const left = processesUnder(ctx.volApp + "/");
  check("C.92", "aucun processus restant depuis le volume", left.length === 0, left.map((p) => p.command.slice(0, 120)).join(" | "));
  notice(`Recette C (${ctx.label})`, `serveur prêt en ${s1(readyMs)} depuis le volume en lecture seule ; ${r.routes} routes sans 5xx (${s1(r.sweepMs)}) ; arrêt par stdin en ${s1(stopMs)} ; .wasm OCR : ${A.tesseractWasm(appDir).length}`);
}

async function groupD(ctx) {
  group("D. Installation");
  const t0 = Date.now();
  fs.mkdirSync(ctx.appsDir, { recursive: true });
  const cp = run("ditto", [ctx.volApp, ctx.app], { timeoutMs: 600000 });
  ctx.measures.copyMs = Date.now() - t0;
  check("D.1a", `ditto vers ${ctx.app}`, cp.code === 0 && exists(path.join(ctx.app, "Contents", "MacOS", "node")), cp.code === 0 ? s1(ctx.measures.copyMs) : tailLines(cp.stderr, 3));
  check("D.1b", "volume détaché", await detach(ctx.vol));
  ctx.vol = null;
  check("D.1c", "app installée sans attribut de quarantaine", !hasQuarantine(ctx.app) && !hasQuarantine(ctx.launcherBin));
  const leaks = checkLeaks([ctx.app], { verbose: false, extraNeedles: homeDirNeedles() });
  check("D.2", `anti-fuite sur l'arbre installé (${leaks.scanned} fichiers) : 0 occurrence`, leaks.findings.length === 0, leaks.findings.slice(0, 5).map((f) => `${f.file} :: ${f.kind}`).join(" | "));
  ctx.digestRef = treeDigest(ctx.app);
  await sleep(1100);
  ctx.marker = path.join(ctx.out, "repere-installation");
  fs.writeFileSync(ctx.marker, new Date().toISOString() + "\n");
  ctx.markerMs = fs.statSync(ctx.marker).mtimeMs;
  check("D.3", "repère posé, instantané de référence pris", ctx.digestRef.files > 0, `${ctx.digestRef.files} fichiers, ${ctx.digestRef.digest.slice(0, 16)}…`);
  // B.9 sur l'app installée : le lanceur refuse de démarrer depuis un volume.
  const st = run(ctx.launcherBin, ["--self-test"], { env: { ...launcherEnv(ctx, path.join(ctx.tmp, "self-test")), JOBSCOUT_DATA_DIR: path.join(ctx.tmp, "self-test") }, timeoutMs: 30000 });
  check("B.9", "JobScout --self-test : code 0", st.code === 0, `code ${st.code}${st.code === 0 ? "" : ` — ${tailLines(st.stderr, 4)}`}`);
}

async function groupE(ctx) {
  group("E. Lanceur réel, sans interface");
  const d = ctx.dataDir;
  const first = ctx.mac.ports.first;
  const base = `http://127.0.0.1:${first}`;
  const { h, rt, ms } = await startLauncher(ctx, "E1-lanceur");
  ctx.measures.coldMs = ms;
  check("E.1", `runtime.json publié en moins de 120 s, url http://127.0.0.1:${first}, version ${ctx.v}`, !!rt && rt.url === base && rt.version === ctx.v && ms <= 120000, rt ? `${rt.url} v${rt.version} en ${s1(ms)}` : `absent — ${exitText(h.exit)}`);
  const ls = listeners(first);
  const exe = ls[0] ? executableOf(ls[0].pid) : null;
  const real = (p) => {
    try {
      return fs.realpathSync(p);
    } catch {
      return null;
    }
  };
  check("E.2a", `écoute sur 127.0.0.1:${first} uniquement, jamais *:${first}`, ls.length > 0 && ls.every((l) => l.addr === `127.0.0.1:${first}`), ls.map((l) => l.addr).join(", ") || "aucune écoute");
  check("E.2b", "processus d'écoute = MacOS/node de l'app installée = serverPid", ls.length > 0 && ls.every((l) => l.pid === rt.serverPid) && !!exe && real(exe) === real(ctx.appNode), `${exe} (pid ${ls[0]?.pid}, serverPid ${rt.serverPid})`);
  const mode = fs.statSync(d).mode & 0o777;
  check("E.3a", "dossier de données en 0700", mode === 0o700, mode.toString(8));
  const allowed = new Set(["jobscout.db", "jobscout.db-wal", "jobscout.db-shm", "documents", "browsers", "ocr", "logs", "runtime.json", "launcher.lock"]);
  const extra = fs.readdirSync(d).filter((n) => !allowed.has(n));
  check("E.3b", "contenu du dossier de données dans la liste blanche", extra.length === 0, extra.join(", ") || fs.readdirSync(d).join(", "));
  const logFile = path.join(d, "logs", "server.log");
  const lmode = exists(logFile) ? fs.statSync(logFile).mode & 0o777 : -1;
  const logText = readText(logFile);
  check("E.3c", "logs/server.log en 0600, « ▲ Next.js » lisible, sans « â–² »", lmode === 0o600 && logText.includes("▲ Next.js") && !logText.includes("â–²"), `mode ${lmode.toString(8)}, ${tailLines(logText, 1).slice(0, 100)}`);
  check("E.3d", "pièges d'environnement neutralisés : rien écrit hors du dossier de données", !exists(ctx.trapDir));
  const root = await A.http(base + "/");
  check("E.4a", "« / » : 307 vers /onboarding", root.status === 307 && A.redirectPath(root, base) === "/onboarding", `HTTP ${root.status} → ${root.location}`);
  const upd = await A.http(base + "/api/update");
  check("E.4b", `/api/update : current = ${ctx.v}`, upd.status === 200 && upd.json?.current === ctx.v, `current=${upd.json?.current}`);

  const second = launch(ctx, "E5-seconde-instance", ctx.launcherBin, ["--no-browser", "--non-interactive"], { env: launcherEnv(ctx, d) });
  const ex2 = await waitExit(second, 10000);
  const nodes = processesUnder(ctx.appNode);
  check("E.5", "seconde instance : code 2 en moins de 10 s, un seul node", !!ex2 && ex2.code === 2 && nodes.length === 1, `${exitText(ex2)}, ${nodes.length} node`);
  if (!ex2) await stopLauncher(second, "SIGKILL", 3000);

  // Moteur LinkedIn, installé par le bouton de l'application.
  const t0 = Date.now();
  const post = await A.http(base + "/api/engine", { method: "POST", headers: { origin: base } });
  check("E.6a", "POST /api/engine (Origin local) : téléchargement démarré", post.status === 200 && post.json?.started === true, `HTTP ${post.status} — ${post.text.slice(0, 160)}`);
  let state = null;
  await waitFor(async () => {
    state = (await A.http(base + "/api/engine")).json;
    return state?.installed === true || !!state?.error;
  }, 10 * 60 * 1000, 3000);
  ctx.measures.engineMs = Date.now() - t0;
  check("E.6b", "moteur installé en moins de 10 min", state?.installed === true, state?.installed ? s1(ctx.measures.engineMs) : state?.error ?? "délai dépassé");
  const browsers = path.join(d, "browsers");
  check("E.6c", "moteur dans le dossier de données (chemin avec « Application Support »)", state.path === browsers && browsers.includes("/Application Support/"), state.path);
  const shells = walk(browsers).filter((e) => e.st.isFile() && path.basename(e.rel) === "chrome-headless-shell");
  check("E.6d", "chrome-headless-shell présent, sans com.apple.quarantine", shells.length > 0 && shells.every((s) => !hasQuarantine(s.abs)), shells.map((s) => s.rel).join(", ") || "introuvable");
  const tm = run("tmutil", ["isexcluded", browsers]);
  check("E.6e", "browsers/ exclu de Time Machine", /\[Excluded\]/.test(tm.stdout), tm.stdout.trim());
  ctx.measures.engineBytes = dirBytes(browsers);
  const script =
    `const { chromium } = require(${JSON.stringify(path.join(ctx.appRes, "app", "node_modules", "playwright"))});` +
    "(async () => { const b = await chromium.launch(); const p = await b.newPage();" +
    " await p.goto('data:text/html,<h1>ok</h1>'); const t = await p.textContent('h1');" +
    " console.log('RESULTAT=' + t + ' VERSION=' + b.version()); await b.close(); })()" +
    ".catch((e) => { console.error(e); process.exit(1); });";
  const pw = run(ctx.appNode, ["-e", script], { cwd: path.join(ctx.appRes, "app"), env: { PATH: "/usr/bin:/bin", HOME: ctx.sandboxHome, TMPDIR: ctx.sandboxTmp, PLAYWRIGHT_BROWSERS_PATH: browsers }, timeoutMs: 180000 });
  const pwm = /^RESULTAT=ok VERSION=(\S+)$/m.exec(pw.stdout);
  check("E.6f", "Chromium lancé par le node et le playwright embarqués : « ok »", pw.code === 0 && !!pwm, pwm ? `Chromium ${pwm[1]}` : tailLines(pw.stderr, 4));

  const prof = await A.postJson(base + "/api/profile", A.RECETTE_PROFILE);
  check("E.7", "POST /api/profile : 200", prof.status === 200, `HTTP ${prof.status}`);

  const stop = await stopLauncher(h);
  ctx.measures.stopMs = stop.ms;
  check("E.8a", "SIGTERM au lanceur : code 0 en moins de 10 s", !!stop.exit && stop.exit.code === 0, `${exitText(stop.exit)} en ${s1(stop.ms)}`);
  const st = await allStopped(ctx, rt, d);
  check("E.8b", "port fermé, aucun processus de l'app ni de browsers/, runtime.json supprimé", st.ok, st.detail);

  const again = await startLauncher(ctx, "E9-relance");
  ctx.measures.warmMs = again.ms;
  check("E.9a", `relance : port ${first} de nouveau`, again.rt?.url === base, again.rt ? `${again.rt.url} en ${s1(again.ms)}` : exitText(again.h.exit));
  const p2 = await A.http(base + "/api/profile");
  check("E.9b", "relance : profil présent", p2.status === 200 && A.hasRecetteProfile(p2.text), `HTTP ${p2.status}`);
  const stop2 = await stopLauncher(again.h);
  check("E.9c", "relance : arrêt propre (code 0)", stop2.exit?.code === 0, exitText(stop2.exit));
  notice(
    `Recette D–E (${ctx.label})`,
    `copie ${s1(ctx.measures.copyMs)} ; démarrage à froid ${s1(ctx.measures.coldMs)}, à chaud ${s1(ctx.measures.warmMs)} ; ` +
      `arrêt ${s1(ctx.measures.stopMs)} ; moteur LinkedIn ${s1(ctx.measures.engineMs)}, ${mo(ctx.measures.engineBytes)} sur le disque, Chromium ${pwm?.[1]}`
  );
}

async function groupF(ctx) {
  group("F. Pannes");
  const first = ctx.mac.ports.first;
  const base = `http://127.0.0.1:${first}`;

  // F.1 — SIGKILL du lanceur pendant le téléchargement du moteur, dans un
  // second dossier de données (le lanceur crée le dernier niveau).
  const d2 = ctx.f1Data;
  fs.mkdirSync(path.dirname(d2), { recursive: true });
  const a = await startLauncher(ctx, "F1-lanceur", d2);
  check("F.1a", "second dossier de données : lanceur prêt", !!a.rt, a.rt ? a.rt.url : exitText(a.h.exit));
  const b2 = a.rt.url;
  const post = await A.http(b2 + "/api/engine", { method: "POST", headers: { origin: b2 } });
  const cli = path.join(ctx.appRes, "app", "node_modules", "playwright-core", "cli.js");
  let installer = null;
  await waitFor(() => {
    installer = processes().find((p) => p.command.includes(cli) && / install\b/.test(p.command)) ?? null;
    return !!installer;
  }, 60000, 100);
  check("F.1b", "téléchargement du moteur en cours (cli.js install)", post.json?.started === true && !!installer, installer ? `pid ${installer.pid}` : `HTTP ${post.status} ${post.text.slice(0, 120)}`);
  await sleep(500);
  const t0 = Date.now();
  await stopLauncher(a.h, "SIGKILL", 3000);
  const gone = await waitFor(() => !alive(a.rt.serverPid) && processesUnder(ctx.macosPrefix).length === 0, 10000, 200);
  const killMs = Date.now() - t0;
  ctx.measures.guardMs = killMs;
  check("F.1c", "SIGKILL du lanceur : node et cli.js install arrêtés en moins de 10 s", gone, gone ? s1(killMs) : processesUnder(ctx.macosPrefix).map((p) => p.command.slice(0, 100)).join(" | "));
  const a2 = await startLauncher(ctx, "F1-relance", d2);
  const eng = a2.rt ? await A.http(a2.rt.url + "/api/engine") : { status: 0, json: null };
  check("F.1d", "relance : moteur installed=false (téléchargement interrompu)", eng.status === 200 && eng.json?.installed === false, `HTTP ${eng.status} installed=${eng.json?.installed}`);
  const s2 = await stopLauncher(a2.h);
  check("F.1e", "relance : arrêt propre (code 0)", s2.exit?.code === 0, exitText(s2.exit));

  // F.2 — SIGKILL de node : le lanceur sort avec le code 70.
  const b = await startLauncher(ctx, "F2-lanceur");
  check("F.2a", "lanceur prêt", !!b.rt, b.rt ? b.rt.url : exitText(b.h.exit));
  const t1 = Date.now();
  try {
    process.kill(b.rt.serverPid, "SIGKILL");
  } catch {}
  const exB = await waitExit(b.h, 5000);
  ctx.measures.code70Ms = Date.now() - t1;
  check("F.2b", "SIGKILL de node : lanceur sorti avec le code 70 en moins de 5 s", exB?.code === 70, `${exitText(exB)} en ${s1(ctx.measures.code70Ms)}`);
  check("F.2c", "runtime.json supprimé", !exists(path.join(ctx.dataDir, "runtime.json")));
  if (!exB) await stopLauncher(b.h, "SIGKILL", 3000);

  // F.3 — port occupé par un faux serveur qui répond 200 {}.
  let fakeHits = 0;
  const fake = http.createServer((req, res) => {
    fakeHits++;
    res.writeHead(200, { "content-type": "application/json" });
    res.end("{}");
  });
  await new Promise((resolve, reject) => {
    fake.once("error", reject);
    fake.listen(first, "127.0.0.1", () => resolve(undefined));
  });
  try {
    const c = await startLauncher(ctx, "F3-port-occupe");
    const next = `http://127.0.0.1:${first + 1}`;
    const upd = c.rt ? await A.http(c.rt.url + "/api/update") : { status: 0, json: null };
    check("F.3a", `port ${first} occupé : url publiée ${next}`, c.rt?.url === next, c.rt ? c.rt.url : exitText(c.h.exit));
    check("F.3b", "le faux serveur n'est jamais pris pour JobScout (0 requête reçue)", fakeHits === 0 && upd.json?.current === ctx.v, `${fakeHits} requête(s), current=${upd.json?.current}`);
    const s3 = await stopLauncher(c.h);
    check("F.3c", "arrêt propre (code 0)", s3.exit?.code === 0, exitText(s3.exit));
  } finally {
    await new Promise((resolve) => fake.close(() => resolve(undefined)));
  }

  // F.4 — relance après un SIGKILL du lanceur : état périmé remplacé.
  const e = await startLauncher(ctx, "F4-lanceur");
  check("F.4a", "lanceur prêt", !!e.rt, e.rt ? e.rt.url : exitText(e.h.exit));
  await stopLauncher(e.h, "SIGKILL", 3000);
  const nodeGone = await waitFor(() => !alive(e.rt.serverPid), 10000, 200);
  const stale = readRuntime(ctx.dataDir);
  check("F.4b", "après SIGKILL : node arrêté par la garde, runtime.json périmé laissé", nodeGone && stale?.pid === e.rt.pid, `node ${nodeGone ? "arrêté" : "actif"}, runtime.json ${stale ? `pid ${stale.pid}` : "absent"}`);
  const f = await startLauncher(ctx, "F4-relance");
  check("F.4c", "relance : runtime.json périmé remplacé", !!f.rt && f.rt.pid !== e.rt.pid && f.rt.version === ctx.v, f.rt ? `pid ${f.rt.pid}` : exitText(f.h.exit));
  check("F.4d", "logs/server.previous.log présent", exists(path.join(ctx.dataDir, "logs", "server.previous.log")));
  const s4 = await stopLauncher(f.h);
  check("F.4e", "arrêt propre (code 0)", s4.exit?.code === 0, exitText(s4.exit));
}

async function groupG(ctx) {
  group("G. Interface");
  const prev = readRuntime(ctx.dataDir);
  const args = ["-n"];
  if (ctx.customData) args.push("--env", `JOBSCOUT_DATA_DIR=${ctx.dataDir}`, "--env", `HOME=${ctx.sandboxHome}`);
  args.push(ctx.app, "--args", "--no-browser");
  const t0 = Date.now();
  const o = run("open", args);
  check("G.1a", "open -n JobScout.app --args --no-browser : 0", o.code === 0, tailLines(o.stderr, 3));
  usefulLog = () => tailLines(readText(path.join(ctx.dataDir, "logs", "server.log")), 15);
  await waitFor(() => {
    const rt = readRuntime(ctx.dataDir);
    return !!rt && (!prev || rt.pid !== prev.pid);
  }, 130000, 250);
  const rt = readRuntime(ctx.dataDir);
  ctx.measures.guiMs = Date.now() - t0;
  check("G.1b", "mode interface : runtime.json publié", !!rt && rt.version === ctx.v, rt ? `${rt.url} en ${s1(ctx.measures.guiMs)}` : "absent");
  const t1 = Date.now();
  try {
    process.kill(rt.pid, "SIGTERM");
  } catch {}
  let st = { ok: false, detail: "" };
  await waitFor(async () => (st = await allStopped(ctx, rt, ctx.dataDir)).ok, 10000, 250);
  ctx.measures.guiStopMs = Date.now() - t1;
  check("G.1c", "SIGTERM à l'app : tout arrêté en moins de 10 s", st.ok, `${st.detail} (${s1(ctx.measures.guiStopMs)})`);

  const at = attach(ctx.dmg);
  check("G.2a", "volume remonté", !!at.mountPoint, at.error ?? at.mountPoint);
  ctx.vol = at.mountPoint;
  const volLauncher = path.join(ctx.vol, ctx.appName, "Contents", "MacOS", ctx.mac.executableName);
  const h = launch(ctx, "G2-depuis-le-volume", volLauncher, ["--no-browser", "--non-interactive"], { env: launcherEnv(ctx, ctx.dataDir) });
  const ex = await waitExit(h, 10000);
  if (!ex) await stopLauncher(h, "SIGKILL", 3000);
  check("G.2b", "lancement depuis le volume : code 64, stderr cite « Applications »", ex?.code === 64 && readText(h.errFile).includes("Applications"), `${exitText(ex)} — ${tailLines(readText(h.errFile), 2)}`);
  check("G.2c", "volume détaché", await detach(ctx.vol));
  ctx.vol = null;
  notice(`Recette F–G (${ctx.label})`, `SIGKILL du lanceur → serveur arrêté en ${s1(ctx.measures.guardMs)} ; SIGKILL de node → code 70 en ${s1(ctx.measures.code70Ms)} ; port occupé → port suivant ; open -n prêt en ${s1(ctx.measures.guiMs)}, arrêt ${s1(ctx.measures.guiStopMs)} ; depuis le volume → code 64`);
}

async function groupH(ctx) {
  group("H. Désinstallation et mise à jour");
  const cv = run("codesign", ["--verify", "--deep", "--strict", "--verbose=2", ctx.app]);
  check("H.1a", "codesign --verify --deep --strict après usage : 0", cv.code === 0, tailLines(cv.stderr, 3));
  const newer = walk(ctx.app).filter((e) => e.st.mtimeMs > ctx.markerMs).map((e) => e.rel);
  check("H.1b", "rien de modifié dans l'app depuis l'installation (find -newer)", newer.length === 0, newer.slice(0, 5).join(", "));
  const cmp = compareDigests(ctx.digestRef, treeDigest(ctx.app));
  check("H.1c", "instantané identique à celui de l'installation", cmp.equal, [...cmp.added.map((e) => `+${e.path}`), ...cmp.removed.map((e) => `-${e.path}`), ...cmp.changed.map((c) => `~${c.path}`)].slice(0, 6).join(", "));
  fs.rmSync(ctx.app, { recursive: true, force: true });
  check("H.2a", "app supprimée", !exists(ctx.app));
  const rows = await A.countRows(path.join(ctx.dataDir, "jobscout.db"));
  check("H.2b", "données intactes : 1 profil (node:sqlite)", rows.ok && rows.profile === 1, rows.detail);
  const agentsDir = path.join(os.homedir(), "Library", "LaunchAgents");
  const agents = exists(agentsDir) ? fs.readdirSync(agentsDir).filter((n) => /jobscout/i.test(n)) : [];
  check("H.2c", "aucun ~/Library/LaunchAgents/*jobscout*", agents.length === 0, agents.join(", "));
  const at = attach(ctx.dmg);
  check("H.3a", "réinstallation : volume monté", !!at.mountPoint, at.error ?? "");
  const cp = run("ditto", [path.join(at.mountPoint, ctx.appName), ctx.app], { timeoutMs: 600000 });
  check("H.3b", "réinstallation : ditto et détachement", cp.code === 0 && (await detach(at.mountPoint)), tailLines(cp.stderr, 3));
  const r = await startLauncher(ctx, "H3-reinstallee");
  const p = r.rt ? await A.http(r.rt.url + "/api/profile") : { status: 0, text: "" };
  check("H.3c", "réinstallation : profil présent", p.status === 200 && A.hasRecetteProfile(p.text), `HTTP ${p.status}`);
  const s = await stopLauncher(r.h);
  check("H.3d", "arrêt propre (code 0)", s.exit?.code === 0, exitText(s.exit));
  const lib = path.join(os.homedir(), "Library");
  const id = ctx.mac.bundleIdentifier;
  const candidates = [
    `Preferences/${id}.plist`,
    `Saved Application State/${id}.savedState`,
    `Caches/${id}`,
    `HTTPStorages/${id}`,
    `HTTPStorages/${id}.binarycookies`,
    `WebKit/${id}`,
    `Application Scripts/${id}`,
    `Containers/${id}`,
  ].filter((rel) => exists(path.join(lib, rel)));
  ctx.measures.outside = candidates.length ? candidates.map((c) => `~/Library/${c}`).join(", ") : "aucun";
  check("H.4", "inventaire des fichiers créés hors du dossier de données", true, ctx.measures.outside);
  notice(`Recette H (${ctx.label})`, `bundle inchangé après usage (signature, dates, instantané) ; app supprimée : base intacte (1 profil) ; réinstallée : profil retrouvé ; créés hors du dossier de données : ${ctx.measures.outside}`);
}

async function groupI(ctx) {
  group("I. Gatekeeper (diagnostic, copie jamais exécutée)");
  const hex = Math.floor(Date.now() / 1000).toString(16);
  check("I.1", "copie témoin marquée com.apple.quarantine", run("xattr", ["-w", "com.apple.quarantine", `0081;${hex};Safari;`, ctx.gkCopy]).code === 0 && hasQuarantine(ctx.gkCopy));
  const status = run("spctl", ["--status"]);
  const assess = run("spctl", ["-a", "-t", "exec", "-vv", ctx.gkCopy]);
  const spc = (assess.stderr + assess.stdout).trim().split("\n").map((l) => l.replace(ctx.gkCopy, "JobScout.app")).join(" / ");
  let sys = "syspolicy_check absent";
  if (exists("/usr/bin/syspolicy_check")) {
    const s = run("/usr/bin/syspolicy_check", ["distribution", ctx.gkCopy], { timeoutMs: 180000 });
    sys = `code ${s.code} : ${tailLines(s.stdout + s.stderr, 3).replaceAll(ctx.gkCopy, "JobScout.app").replace(/\n/g, " / ").slice(0, 400)}`;
  }
  check("I.2", "diagnostic enregistré", true, `spctl --status : ${status.stdout.trim() || status.stderr.trim()}`);
  if (ctx.signature === "developer-id") {
    const st = run("xcrun", ["stapler", "validate", ctx.gkCopy]);
    check("I.3a", "Developer ID : stapler validate (app) : 0", st.code === 0, tailLines(st.stdout + st.stderr, 2));
    const sd = run("xcrun", ["stapler", "validate", ctx.dmg]);
    check("I.3b", "Developer ID : stapler validate (DMG) : 0", sd.code === 0, tailLines(sd.stdout + sd.stderr, 2));
    check("I.3c", "Developer ID : Authority « Developer ID Application »", signatureOf(ctx.gkCopy) === "developer-id");
  }
  fs.rmSync(path.dirname(ctx.gkCopy), { recursive: true, force: true });
  notice(`Gatekeeper (${ctx.label})`, `spctl --status : ${status.stdout.trim() || status.stderr.trim()} ; spctl -a -t exec : ${spc.slice(0, 400)} ; syspolicy_check : ${sys} ; signature ${ctx.signature}${ctx.signature === "developer-id" ? " (agrafage vérifié)" : " (diagnostic seulement)"}`);
}

async function groupJ(ctx) {
  group("J. Répétition du runtime renforcé");
  const signMac = path.join(HERE, "sign-mac.mjs");
  const blocking = ctx.signature === "developer-id";
  if (!exists(signMac)) {
    if (blocking) check("J.1", "sign-mac.mjs présent (mode Developer ID)", false);
    warn("J.1", "répétition indisponible : installer/mac/sign-mac.mjs absent");
    return;
  }
  const outDir = path.join(ctx.out, "repetition");
  fs.mkdirSync(outDir, { recursive: true });
  const r = run(process.execPath, [signMac, "rehearsal", ctx.app, outDir], { timeoutMs: 15 * 60 * 1000 });
  fs.writeFileSync(path.join(outDir, "sortie.log"), r.stdout + "\n" + r.stderr);
  const detail = `code ${r.code} en ${s1(r.ms)} — ${tailLines(r.stdout + r.stderr, 3).replace(/\n/g, " / ").slice(0, 300)}`;
  if (blocking) check("J.1", "répétition du runtime renforcé (bloquante en Developer ID) : 0", r.code === 0, detail);
  else if (r.code !== 0) warn("J.1", "répétition du runtime renforcé en échec (avertissement en ad hoc)", detail);
  else check("J.1", "répétition du runtime renforcé : 0", true, detail);
  // L'app installée doit rester intacte après la répétition (elle copie node).
  const cv = run("codesign", ["--verify", "--deep", "--strict", ctx.app]);
  check("J.2", "app installée intacte après la répétition (codesign --verify)", cv.code === 0, tailLines(cv.stderr, 2));
  notice(`Répétition (${ctx.label})`, detail);
}

// ============================================================ pilote
function parseArgs(argv) {
  const o = { dmg: null, sums: null, rapport: null, out: "recette-mac" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const eq = a.indexOf("=");
    const k = eq > 0 ? a.slice(2, eq) : a.slice(2);
    if (!a.startsWith("--") || !(k in o)) throw new Refused(`argument inconnu : ${a}`);
    const v = eq > 0 ? a.slice(eq + 1) : argv[++i];
    if (!v) throw new Refused(`--${k} attend une valeur`);
    o[k] = path.resolve(v);
  }
  for (const k of ["dmg", "sums", "rapport"]) {
    if (!o[k]) throw new Refused(`--${k} est obligatoire`);
    if (!exists(o[k])) throw new Refused(`--${k} : ${o[k]} introuvable`);
  }
  return o;
}

async function cleanup(ctx) {
  for (const h of [...live]) {
    try {
      process.kill(h.pid, "SIGTERM");
    } catch {}
  }
  await sleep(live.size ? 3000 : 0);
  for (const h of [...live]) {
    try {
      process.kill(h.pid, "SIGKILL");
    } catch {}
  }
  if (ctx?.macosPrefix) killUnder(ctx.macosPrefix, path.join(ctx.dataDir, "browsers") + "/", path.join(ctx.f1Data, "browsers") + "/");
  for (const m of [...mounts]) await detach(m);
  if (!ctx) return;
  // Journaux du serveur, pour l'artefact de diagnostic (envoyé en cas d'échec).
  for (const dir of [ctx.dataDir, ctx.f1Data]) {
    for (const n of ["server.log", "server.previous.log"]) {
      const f = path.join(dir, "logs", n);
      if (exists(f)) fs.copyFileSync(f, path.join(ctx.out, `${dir === ctx.dataDir ? "principal" : "F1"}-${n}`));
    }
  }
  if (ctx.playwrightAside && exists(ctx.playwrightAside)) {
    try {
      fs.renameSync(ctx.playwrightAside, ctx.playwrightRegistry);
    } catch {}
  }
  if (ctx.installedByUs && exists(ctx.app)) fs.rmSync(ctx.app, { recursive: true, force: true });
  if (ctx.tmp) fs.rmSync(ctx.tmp, { recursive: true, force: true });
}

function writeSummary(ctx, failure, totalMs) {
  const ok = results.filter((r) => r.ok === true).length;
  const total = results.filter((r) => r.ok !== null).length;
  const out = {
    plateforme: ctx?.label ?? null,
    version: ctx?.v ?? null,
    signature: ctx?.signature ?? null,
    resultat: failure ? "échec" : "succès",
    echec: failure ? failure.message : null,
    controles: results,
    avertissements: warnings,
    mesures: ctx?.measures ?? {},
    dureeMs: totalMs,
  };
  if (ctx?.out) fs.writeFileSync(path.join(ctx.out, "resultats.json"), JSON.stringify(out, null, 2) + "\n");
  if (process.env.GITHUB_STEP_SUMMARY) {
    const esc = (s) => String(s).replace(/\|/g, "\\|").replace(/\n/g, " ");
    const rows = results.map((r) => `| ${r.id} | ${esc(r.label)} | ${r.ok === true ? "OK" : r.ok === false ? "**ÉCHEC**" : "avertissement"} | ${esc(r.detail).slice(0, 200)} |`);
    fs.appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `### Recette ${ctx?.label ?? ""} : ${failure ? "échec" : "succès"} (${ok}/${total})\n\n| Contrôle | Libellé | Résultat | Détail |\n|---|---|---|---|\n${rows.join("\n")}\n\n`
    );
  }
  return { ok, total };
}

async function main(argv) {
  const started = Date.now();
  let ctx = null;
  let failure = null;
  try {
    if (process.platform !== "darwin") throw new Refused("la recette Mac ne tourne que sous macOS");
    const o = parseArgs(argv);
    fs.mkdirSync(o.out, { recursive: true });
    const mac = readJson(path.join(HERE, "mac.json"));
    if (!mac?.bundleIdentifier || !mac?.ports?.first) throw new Refused("installer/mac/mac.json illisible");
    const v = readJson(path.join(PROJECT, "version.json"))?.version;
    const nodeVersion = readJson(path.join(PROJECT, "installer", "node-runtime.json"))?.version;
    const runnerArch = run("uname", ["-m"]).stdout.trim();
    const macos = run("sw_vers", ["-productVersion"]).stdout.trim();
    const home = os.homedir();
    const realData = path.join(home, "Library", "Application Support", mac.dataDirName);
    const realApp = path.join("/Applications", `${mac.bundleName}.app`);
    const preexisting = [realData, realApp].filter(exists);
    if (preexisting.length) {
      throw new Refused(
        CI
          ? `poste de recette non vierge : ${preexisting.join(", ")}`
          : `un JobScout est déjà installé ou a déjà tourné sur ce Mac (${preexisting.join(", ")}) : recette refusée pour ne pas y toucher`
      );
    }
    const running = processes().filter((p) => p.command.includes(`${mac.bundleName}.app/Contents/MacOS/`));
    if (running.length) throw new Refused(`un JobScout est en cours d'exécution (pid ${running.map((p) => p.pid).join(", ")})`);
    const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "jobscout-recette-")));
    const appsDir = CI ? "/Applications" : path.join(tmp, "Applications");
    const appPath = path.join(appsDir, `${mac.bundleName}.app`);
    ctx = {
      v,
      nodeVersion,
      mac,
      dmg: o.dmg,
      sums: o.sums,
      rapport: o.rapport,
      out: path.resolve(o.out),
      tmp,
      appsDir,
      appName: `${mac.bundleName}.app`,
      app: appPath,
      appRes: path.join(appPath, "Contents", "Resources"),
      appNode: path.join(appPath, "Contents", "MacOS", "node"),
      launcherBin: path.join(appPath, "Contents", "MacOS", mac.executableName),
      macosPrefix: path.join(appPath, "Contents", "MacOS") + "/",
      dataDir: CI ? realData : path.join(tmp, "Application Support", mac.dataDirName),
      f1Data: path.join(tmp, "F1 second dossier", mac.dataDirName),
      customData: !CI,
      sandboxHome: path.join(tmp, "home"),
      sandboxTmp: path.join(tmp, "tmpdir"),
      trapDir: path.join(tmp, "piege"),
      runnerArch,
      nodeArch: runnerArch === "arm64" ? "arm64" : "x64",
      label: `macOS ${macos} ${runnerArch}`,
      installedByUs: true,
      measures: {},
      vol: null,
    };
    for (const d of [ctx.sandboxHome, ctx.sandboxTmp]) fs.mkdirSync(d, { recursive: true });
    line(`[recette] JobScout ${v}, ${ctx.label}, ${CI ? "GitHub Actions (Applications et données réelles)" : "hors CI (dossier temporaire)"}`);
    const rapport = readJson(o.rapport);
    if (!rapport) throw new Refused("--rapport : JSON illisible");
    if ("version" in rapport && rapport.version !== v) throw new Refused(`rapport-construction.json : version ${rapport.version}, checkout ${v}`);
    // Registre Playwright global (sous GitHub Actions seulement) : un Chromium
    // déjà présent fausserait « moteur absent ». Mis de côté, puis remis.
    ctx.playwrightRegistry = path.join(home, "Library", "Caches", "ms-playwright");
    if (CI && exists(ctx.playwrightRegistry)) {
      ctx.playwrightAside = `${ctx.playwrightRegistry}.recette-de-cote`;
      fs.renameSync(ctx.playwrightRegistry, ctx.playwrightAside);
      line(`[recette] registre Playwright global mis de côté le temps de la recette`);
    }

    await groupA(ctx);
    await groupB(ctx);
    await groupC(ctx);
    await groupD(ctx);
    await groupE(ctx);
    await groupF(ctx);
    await groupG(ctx);
    await groupH(ctx);
    await groupI(ctx);
    await groupJ(ctx);
  } catch (e) {
    failure = e;
  }
  const tail = failure instanceof CheckFailed ? usefulLog() : "";
  try {
    await cleanup(ctx);
  } catch (e) {
    line(`[recette] nettoyage incomplet : ${e instanceof Error ? e.message : String(e)}`);
  }
  const totalMs = Date.now() - started;
  const { ok, total } = writeSummary(ctx, failure, totalMs);
  if (warnings.length) {
    const shown = warnings.slice(0, 8);
    for (const w of shown) if (CI) line(annotation("warning", `Recette ${ctx?.label ?? ""}`, w));
    if (warnings.length > shown.length && CI) line(annotation("warning", `Recette ${ctx?.label ?? ""}`, `… et ${warnings.length - shown.length} autre(s) avertissement(s) (voir le résumé de l'étape)`));
  }
  if (failure instanceof Refused) {
    line(annotation("error", "Recette refusée", failure.message));
    return 2;
  }
  if (failure) {
    const where = failure instanceof CheckFailed ? `échec ${failure.message}` : `erreur : ${failure instanceof Error ? failure.stack ?? failure.message : String(failure)}`;
    const msg = `${ok}/${total} contrôles OK avant l'arrêt — ${where}${tail ? `\n\n--- fin du journal utile ---\n${tail}` : ""}`;
    line(annotation("error", `Recette ${ctx?.label ?? ""} — groupe ${currentGroup}`, msg.slice(0, 6000)));
    if (!CI) line(msg);
    return 1;
  }
  const extra = deferredNotices.length ? ` | ${deferredNotices.join(" | ")}` : "";
  line(annotation("notice", `Recette ${ctx.label}`, `${ok}/${total} contrôles OK, ${warnings.length} avertissement(s) — JobScout ${ctx.v}, ${ctx.label}, signature ${ctx.signature} — durée ${s1(totalMs)}${extra}`));
  return 0;
}

const isMain = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) process.exitCode = await main(process.argv.slice(2));
