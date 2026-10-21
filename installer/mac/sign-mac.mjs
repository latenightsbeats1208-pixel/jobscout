// ============================================================================
// installer/mac/sign-mac.mjs — signature de l'app et du DMG Mac.
//
// Mode décidé par macSigningMode(env), à partir de 5 secrets du dépôt :
//   JOBSCOUT_MAC_CERT_P12_BASE64       certificat « Developer ID Application » (.p12, base64)
//   JOBSCOUT_MAC_CERT_PASSWORD         mot de passe du .p12
//   JOBSCOUT_MAC_NOTARY_KEY_P8_BASE64  clé API App Store Connect (.p8, base64)
//   JOBSCOUT_MAC_NOTARY_KEY_ID         identifiant de la clé
//   JOBSCOUT_MAC_NOTARY_ISSUER_ID      identifiant de l'émetteur (clé d'équipe)
//   - aucun     → « adhoc » : l'app garde le sceau ad hoc posé par build-mac.mjs ;
//   - les cinq  → « developer-id » : runtime renforcé, horodatage, notarisation,
//                 agrafage ;
//   - entre 1 et 4 → ERREUR. Une configuration partielle n'est jamais
//                 rattrapée en silence par un build ad hoc.
//
// Sous-commandes :
//   node installer/mac/sign-mac.mjs mode                     affiche adhoc | developer-id
//   node installer/mac/sign-mac.mjs app [JobScout.app]       signe + notarise + agrafe l'app
//   node installer/mac/sign-mac.mjs dmg [JobScout-Mac.dmg]   signe + notarise + agrafe le DMG
//   node installer/mac/sign-mac.mjs rehearsal <app> <sortie> [--mode adhoc|developer-id]
//        répétition du runtime renforcé (node re-signé ad hoc, deux jeux de droits)
//   node installer/mac/sign-mac.mjs cleanup                  supprime trousseau et clés temporaires
//
// Secrets : jamais affichés ni passés dans un message d'erreur ; le mot de
// passe du trousseau, généré ici, est masqué (::add-mask::). Le .p12 et le .p8
// sont écrits en 0600 (umask 077) dans $RUNNER_TEMP puis effacés.
// ============================================================================
import fs from "node:fs";
import os from "node:os";
import net from "node:net";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import {
  HERE,
  OUTPUT_MAC,
  bundlePathFor,
  fail,
  isMainModule,
  loadMacConfig,
  notice,
  plistXml,
  requireDarwin,
  run,
  runMain,
  stepSummary,
  warning,
} from "./bundle.mjs";

export const SIGNING_SECRETS = [
  "JOBSCOUT_MAC_CERT_P12_BASE64",
  "JOBSCOUT_MAC_CERT_PASSWORD",
  "JOBSCOUT_MAC_NOTARY_KEY_P8_BASE64",
  "JOBSCOUT_MAC_NOTARY_KEY_ID",
  "JOBSCOUT_MAC_NOTARY_ISSUER_ID",
];

export const ENTITLEMENTS = path.join(HERE, "node.entitlements.plist");
export const ALLOW_JIT = "com.apple.security.cs.allow-jit";
export const ALLOW_UNSIGNED_MEMORY = "com.apple.security.cs.allow-unsigned-executable-memory";

const TITLE = "Signature Mac";
const log = (m) => process.stdout.write(`[sign-mac] ${m}\n`);

/**
 * « adhoc » (aucun secret), « developer-id » (les 5), sinon exception.
 * Un secret GitHub non défini arrive comme chaîne vide : il compte comme absent.
 * Le message d'erreur ne cite que des NOMS de secrets, jamais une valeur.
 * @param {Record<string, string | undefined>} [env]
 * @returns {"adhoc" | "developer-id"}
 */
export function macSigningMode(env = process.env) {
  const present = SIGNING_SECRETS.filter((k) => typeof env[k] === "string" && env[k].trim() !== "");
  if (present.length === 0) return "adhoc";
  if (present.length === SIGNING_SECRETS.length) return "developer-id";
  const missing = SIGNING_SECRETS.filter((k) => !present.includes(k));
  throw new Error(
    `configuration de signature partielle : ${present.length}/${SIGNING_SECRETS.length} secrets présents ` +
      `(${present.join(", ")}) ; manquent : ${missing.join(", ")}. Définissez les 5 secrets, ou aucun pour un build ad hoc.`
  );
}

// --------------------------------------------------------------- trousseau
const tempRoot = () => process.env.RUNNER_TEMP || os.tmpdir();
const keychainPath = () => path.join(tempRoot(), "jobscout-signature.keychain-db");
const secretDir = () => path.join(tempRoot(), "jobscout-signature");

function addMask(value) {
  if (process.env.GITHUB_ACTIONS === "true" && value) process.stdout.write(`::add-mask::${value}\n`);
}

function writeSecretFile(name, base64) {
  const dir = secretDir();
  const previous = process.umask(0o077);
  try {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const file = path.join(dir, name);
    const buf = Buffer.from(base64.replace(/\s+/g, ""), "base64");
    if (!buf.length) throw new Error(`${name} : contenu base64 vide ou illisible.`);
    fs.writeFileSync(file, buf, { mode: 0o600 });
    return file;
  } finally {
    process.umask(previous);
  }
}

/** Lignes « 1) <SHA-1> "Developer ID Application: … (ÉQUIPE)" » de find-identity. */
export function parseIdentities(text) {
  const out = [];
  for (const line of String(text).split(/\r?\n/)) {
    const m = /^\s*\d+\)\s+([0-9A-F]{40})\s+"(.+)"\s*$/.exec(line);
    if (m) out.push({ sha1: m[1], name: m[2], team: /\(([A-Z0-9]{10})\)$/.exec(m[2])?.[1] ?? null });
  }
  return out;
}

/** Trousseau neuf, certificat importé, clé de notarisation écrite. Chaque étape repart de zéro. */
function prepareSigning(env) {
  const keychain = keychainPath();
  if (fs.existsSync(keychain)) run("security", ["delete-keychain", keychain], { allowFail: true });
  const kcPass = crypto.randomBytes(24).toString("base64");
  addMask(kcPass);
  const p12Pass = env.JOBSCOUT_MAC_CERT_PASSWORD;
  const secrets = [kcPass, p12Pass, env.JOBSCOUT_MAC_CERT_P12_BASE64, env.JOBSCOUT_MAC_NOTARY_KEY_P8_BASE64];

  run("security", ["create-keychain", "-p", kcPass, keychain], { secrets });
  run("security", ["set-keychain-settings", "-lut", "21600", keychain], { secrets });
  run("security", ["unlock-keychain", "-p", kcPass, keychain], { secrets });
  const p12 = writeSecretFile("certificat.p12", env.JOBSCOUT_MAC_CERT_P12_BASE64);
  try {
    run("security", ["import", p12, "-k", keychain, "-P", p12Pass, "-T", "/usr/bin/codesign"], { secrets });
  } finally {
    fs.rmSync(p12, { force: true });
  }
  run("security", ["set-key-partition-list", "-S", "apple-tool:,apple:,codesign:", "-s", "-k", kcPass, keychain], { secrets });
  const existing = run("security", ["list-keychains", "-d", "user"]).stdout
    .split(/\r?\n/)
    .map((l) => l.trim().replace(/^"|"$/g, ""))
    .filter((l) => l && l !== keychain);
  run("security", ["list-keychains", "-d", "user", "-s", keychain, ...existing]);

  const ids = parseIdentities(run("security", ["find-identity", "-v", "-p", "codesigning", keychain]).stdout)
    .filter((i) => i.name.startsWith("Developer ID Application:"));
  if (ids.length !== 1) {
    throw new Error(`${ids.length} identité(s) « Developer ID Application » valide(s) dans le certificat importé, attendu exactement 1.`);
  }
  const p8 = writeSecretFile("notarisation.p8", env.JOBSCOUT_MAC_NOTARY_KEY_P8_BASE64);
  log(`identité Developer ID Application de l'équipe ${ids[0].team ?? "?"} prête (trousseau temporaire)`);
  return {
    identity: ids[0].sha1,
    team: ids[0].team,
    notary: ["--key", p8, "--key-id", env.JOBSCOUT_MAC_NOTARY_KEY_ID, "--issuer", env.JOBSCOUT_MAC_NOTARY_ISSUER_ID],
    secrets: [...secrets, env.JOBSCOUT_MAC_NOTARY_KEY_ID, env.JOBSCOUT_MAC_NOTARY_ISSUER_ID],
    p8,
  };
}

/** Supprime le trousseau temporaire et les fichiers de clés. Jamais bloquant. */
export function cleanup() {
  const done = [];
  const keychain = keychainPath();
  if (process.platform === "darwin" && fs.existsSync(keychain)) {
    const r = run("security", ["delete-keychain", keychain], { allowFail: true });
    if (r.status === 0) done.push("trousseau temporaire supprimé");
    else warning(TITLE, `suppression du trousseau temporaire en échec : ${r.stderr.trim()}`);
  }
  if (fs.existsSync(secretDir())) {
    fs.rmSync(secretDir(), { recursive: true, force: true });
    done.push("clés temporaires effacées");
  }
  notice(TITLE, done.length ? `nettoyage : ${done.join(", ")}` : "nettoyage : rien à nettoyer");
}

// ------------------------------------------------------------ constats
/** Lecture de `codesign -dvv` : autorités, équipe, ad hoc, runtime renforcé, horodatage. */
export function codesignDetails(text) {
  const lines = String(text).split(/\r?\n/);
  const flags = /flags=0x[0-9a-f]+\(([^)]*)\)/.exec(text)?.[1] ?? "";
  return {
    authorities: lines.filter((l) => l.startsWith("Authority=")).map((l) => l.slice(10)),
    team: lines.find((l) => l.startsWith("TeamIdentifier="))?.slice(15) ?? null,
    adhoc: lines.some((l) => l.trim() === "Signature=adhoc"),
    runtime: flags.split(",").includes("runtime"),
    timestamp: lines.some((l) => l.startsWith("Timestamp=")),
  };
}

const details = (target) => codesignDetails(run("codesign", ["-dvv", target]).stderr);

/** Mode réel d'une app, lu dans SA signature (jamais déduit de l'environnement). */
export function detectSigningMode(app) {
  const d = details(app);
  if (d.authorities[0]?.startsWith("Developer ID Application:")) return "developer-id";
  if (d.adhoc) return "adhoc";
  return "inconnu";
}

function requireDeveloperId(target, { runtime }) {
  const d = details(target);
  const problems = [];
  if (!d.authorities[0]?.startsWith("Developer ID Application:")) problems.push("Authority « Developer ID Application » absente");
  if (!d.timestamp) problems.push("horodatage sécurisé absent");
  if (runtime && !d.runtime) problems.push("runtime renforcé absent");
  if (problems.length) throw new Error(`${path.basename(target)} : ${problems.join(", ")}.`);
  return d;
}

function stapleAndValidate(target) {
  run("xcrun", ["stapler", "staple", target]);
  const v = run("xcrun", ["stapler", "validate", target], { allowFail: true });
  if (v.status !== 0 || !/^The validate action worked!$/m.test(v.stdout)) {
    throw new Error(`stapler validate ${path.basename(target)} : ${(v.stderr || v.stdout).trim()}`);
  }
}

/** Notarisation : submit --wait, PUIS TOUJOURS le journal ; statut ≠ Accepted → échec. */
function notarize(file, ctx, label) {
  const sub = run(
    "xcrun",
    ["notarytool", "submit", file, ...ctx.notary, "--wait", "--timeout", "30m", "--output-format", "json"],
    { allowFail: true, secrets: ctx.secrets, timeout: 35 * 60 * 1000 }
  );
  let result = null;
  try {
    result = JSON.parse(sub.stdout.trim());
  } catch {
    result = null;
  }
  if (!result?.id) {
    throw new Error(`notarisation de ${label} : soumission refusée (code ${sub.status}) ${sub.stderr.trim().slice(-800)}`);
  }
  const logFile = path.join(OUTPUT_MAC, `notarisation-${label}.json`);
  fs.mkdirSync(OUTPUT_MAC, { recursive: true });
  const lg = run("xcrun", ["notarytool", "log", result.id, ...ctx.notary, logFile], { allowFail: true, secrets: ctx.secrets });
  let issues = [];
  try {
    issues = JSON.parse(fs.readFileSync(logFile, "utf-8")).issues ?? [];
  } catch {
    warning(TITLE, `journal de notarisation de ${label} illisible (code ${lg.status}).`);
  }
  for (const i of (issues ?? []).slice(0, 20)) {
    log(`  [${i.severity}] ${i.path ?? ""} : ${i.message}`);
  }
  if (result.status !== "Accepted") {
    throw new Error(`notarisation de ${label} : statut « ${result.status} » (${result.message ?? ""}), ${issues?.length ?? 0} problème(s) dans le journal.`);
  }
  notice(TITLE, `notarisation de ${label} : Accepted (soumission ${result.id}, ${issues?.length ?? 0} remarque(s))`);
  return { id: result.id, status: result.status, issues: issues?.length ?? 0 };
}

function informativeChecks(target, kind) {
  const status = run("spctl", ["--status"], { allowFail: true });
  const args = kind === "dmg"
    ? ["-a", "-t", "open", "--context", "context:primary-signature", "-vv", target]
    : ["-a", "-t", "exec", "-vv", target];
  const sp = run("spctl", args, { allowFail: true });
  notice(`Gatekeeper (information) ${kind}`, `spctl --status : ${(status.stdout || status.stderr).trim()} ; spctl ${args.slice(0, 3).join(" ")} : ${(sp.stderr || sp.stdout).trim().replace(/\n/g, " | ")}`);
  if (kind === "app") {
    const sc = run("syspolicy_check", ["distribution", target], { allowFail: true });
    if (!sc.error) notice("Gatekeeper (information) syspolicy_check", `code ${sc.status} : ${(sc.stdout || sc.stderr).trim().split("\n").slice(-3).join(" | ")}`);
  }
}

function updateReport(patch) {
  const file = path.join(OUTPUT_MAC, loadMacConfig().reportName);
  if (!fs.existsSync(file)) return;
  const report = JSON.parse(fs.readFileSync(file, "utf-8"));
  report.signature = { ...(report.signature ?? {}), ...patch };
  fs.writeFileSync(file, JSON.stringify(report, null, 2) + "\n");
}

// ------------------------------------------------------------- app, dmg
/** Signe l'app de l'intérieur vers l'extérieur, la notarise et l'agrafe (mode developer-id). */
export function signAppDeveloperId(app, env = process.env) {
  requireDarwin(TITLE);
  const cfg = loadMacConfig();
  const ctx = prepareSigning(env);
  const node = path.join(app, "Contents", "MacOS", "node");
  const launcher = path.join(app, "Contents", "MacOS", cfg.executableName);
  const base = ["--force", "--options", "runtime", "--timestamp", "--keychain", keychainPath(), "--sign", ctx.identity];
  run("codesign", [...base, "--entitlements", ENTITLEMENTS, node]);
  run("codesign", [...base, launcher]);
  run("codesign", [...base, app]);
  run("codesign", ["--verify", "--deep", "--strict", "--verbose=2", app]);
  for (const t of [node, launcher, app]) requireDeveloperId(t, { runtime: true });

  const zip = path.join(tempRoot(), `${cfg.bundleName}-notarisation.zip`);
  fs.rmSync(zip, { force: true });
  run("ditto", ["-c", "-k", "--keepParent", app, zip]);
  let notarization;
  try {
    notarization = notarize(zip, ctx, "app");
  } finally {
    fs.rmSync(zip, { force: true });
  }
  stapleAndValidate(app);
  run("codesign", ["--verify", "--deep", "--strict", "--verbose=2", app]);
  const d = requireDeveloperId(app, { runtime: true });
  informativeChecks(app, "app");
  updateReport({ mode: "developer-id", team: d.team, notarizationApp: notarization });
  return { team: d.team, notarization };
}

/** Signe le DMG (horodaté), le notarise et l'agrafe (mode developer-id). */
export function signDmg(dmg, env = process.env) {
  requireDarwin(TITLE);
  const ctx = prepareSigning(env);
  run("codesign", ["--force", "--timestamp", "--keychain", keychainPath(), "--sign", ctx.identity, dmg]);
  run("codesign", ["--verify", "--strict", "--verbose=2", dmg]);
  requireDeveloperId(dmg, { runtime: false });
  const notarization = notarize(dmg, ctx, "dmg");
  stapleAndValidate(dmg);
  informativeChecks(dmg, "dmg");
  updateReport({ notarizationDmg: notarization });
  return { notarization };
}

// -------------------------------------------------------------- répétition
/**
 * JS gourmand en JIT : boucle chaude, expressions régulières, WebAssembly,
 * fonctions générées. Dernière ligne exacte attendue : « jit-ok 20000 <ms> ».
 */
export const JIT_SCRIPT = [
  "const t=Date.now();let s=0;for(let i=0;i<3e7;i++){s=(s+Math.imul(i,2654435761))|0;}",
  "let m=0;for(const _ of 'a1@b2.com '.repeat(20000).matchAll(/([a-z]+)(\\d)@(\\w+)\\.com/g))m++;",
  "const w=new Uint8Array([0,97,115,109,1,0,0,0,1,7,1,96,2,127,127,1,127,3,2,1,0,7,7,1,3,97,100,100,0,0,10,9,1,7,0,32,0,32,1,106,11]);",
  "const add=new WebAssembly.Instance(new WebAssembly.Module(w)).exports.add;if(add(2,3)!==5)throw new Error('wasm');",
  "const f=[];for(let k=0;k<2000;k++)f.push(new Function('x','return x*'+k+'+1'));let z=0;for(let r=0;r<200;r++)for(const g of f)z+=g(r);",
  "if(!Number.isFinite(z+s))throw new Error('calcul');console.log('jit-ok',m,Date.now()-t);",
].join("");

export const REHEARSAL_VARIANTS = [
  { id: "allow-jit", keys: [ALLOW_JIT] },
  { id: "allow-jit+unsigned-memory", keys: [ALLOW_JIT, ALLOW_UNSIGNED_MEMORY], reference: true },
];

function freePort(start) {
  return new Promise((resolve, reject) => {
    const tryPort = (p) => {
      if (p > start + 50) return reject(new Error(`aucun port libre entre ${start} et ${start + 50}`));
      const srv = net.createServer();
      srv.once("error", () => tryPort(p + 1));
      srv.listen(p, "127.0.0.1", () => srv.close(() => resolve(p)));
    };
    tryPort(start);
  });
}

async function serverCheck(prefix, nodeBin, appDir, version, sandbox) {
  const port = await freePort(3930);
  const env = {
    PATH: "/usr/bin:/bin",
    HOME: sandbox,
    TMPDIR: sandbox,
    NODE_ENV: "production",
    HOSTNAME: "127.0.0.1",
    PORT: String(port),
    NEXT_TELEMETRY_DISABLED: "1",
    JOBSCOUT_DATA_DIR: path.join(sandbox, "data"),
    JOBSCOUT_DISABLE_UPDATE_CHECK: "1",
  };
  fs.mkdirSync(env.JOBSCOUT_DATA_DIR, { recursive: true });
  const [cmd, ...pre] = prefix.length ? prefix : [nodeBin];
  const args = prefix.length ? [...pre, nodeBin, "server.js"] : ["server.js"];
  const t0 = Date.now();
  const child = spawn(cmd, args, { cwd: appDir, env, stdio: ["ignore", "pipe", "pipe"], detached: true });
  const out = [];
  child.stdout.on("data", (b) => out.push(b.toString()));
  child.stderr.on("data", (b) => out.push(b.toString()));
  let exit = null;
  child.on("exit", (code, signal) => (exit = { code, signal }));
  try {
    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline && !exit) {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/api/update`, { signal: AbortSignal.timeout(2500) });
        if (res.status === 200) {
          const body = await res.json();
          if (body.current === version) return { ok: true, seconds: (Date.now() - t0) / 1000 };
          return { ok: false, detail: `/api/update : current « ${body.current} » ≠ ${version}` };
        }
      } catch {
        /* pas encore prêt */
      }
      await new Promise((r) => setTimeout(r, 400));
    }
    const tail = out.join("").trim().split("\n").slice(-5).join(" | ");
    return { ok: false, detail: exit ? `serveur arrêté (code ${exit.code}, signal ${exit.signal}) : ${tail}` : `pas de réponse en 90 s : ${tail}` };
  } finally {
    if (!exit) {
      try { process.kill(-child.pid, "SIGTERM"); } catch { /* déjà arrêté */ }
      const until = Date.now() + 5000;
      while (!exit && Date.now() < until) await new Promise((r) => setTimeout(r, 100));
      if (!exit) {
        try { process.kill(-child.pid, "SIGKILL"); } catch { /* déjà arrêté */ }
      }
    }
  }
}

/**
 * Répétition du runtime renforcé : le node de l'app, copié, re-signé AD HOC
 * avec --options runtime et chaque jeu de droits ; chaque variante exécute
 * JIT_SCRIPT puis server.js jusqu'à /api/update. Résultats par architecture
 * dans <out>/repetition-<arch>.json. Échec bloquant seulement si l'app est
 * signée Developer ID ET que la variante de référence (node.entitlements.plist)
 * échoue en natif ; sinon avertissement.
 */
export async function rehearsal({ app, out, mode } = {}) {
  requireDarwin("Répétition du runtime renforcé");
  if (!app || !out) throw new Error("usage : rehearsal <app> <sortie>");
  const nodeSrc = path.join(app, "Contents", "MacOS", "node");
  const appDir = path.join(app, "Contents", "Resources", "app");
  if (!fs.existsSync(nodeSrc) || !fs.existsSync(path.join(appDir, "server.js"))) {
    throw new Error(`${app} : Contents/MacOS/node ou Resources/app/server.js absent.`);
  }
  const version = JSON.parse(fs.readFileSync(path.join(appDir, "version.json"), "utf-8")).version;
  const signingMode = mode ?? detectSigningMode(app);

  // Le fichier de référence doit contenir exactement les droits de la variante de référence.
  const refKeys = Object.keys(JSON.parse(run("plutil", ["-convert", "json", "-o", "-", ENTITLEMENTS]).stdout)).sort();
  const reference = REHEARSAL_VARIANTS.find((v) => v.reference);
  if (refKeys.join(",") !== [...reference.keys].sort().join(",")) {
    throw new Error(`node.entitlements.plist contient [${refKeys.join(", ")}], attendu [${reference.keys.join(", ")}].`);
  }

  const native = run("uname", ["-m"]).stdout.trim();
  const arches = [{ arch: native, prefix: [], native: true }];
  if (native === "arm64" && run("arch", ["-x86_64", "/usr/bin/true"], { allowFail: true }).status === 0) {
    arches.push({ arch: "x86_64", prefix: ["arch", "-x86_64"], native: false });
  }

  fs.mkdirSync(out, { recursive: true });
  const results = [];
  for (const variant of REHEARSAL_VARIANTS) {
    const dir = path.join(out, "repetition", variant.id);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    const plist = variant.reference ? ENTITLEMENTS : path.join(dir, "droits.plist");
    if (!variant.reference) fs.writeFileSync(plist, plistXml(Object.fromEntries(variant.keys.map((k) => [k, true]))));
    const bin = path.join(dir, "node");
    fs.copyFileSync(nodeSrc, bin);
    fs.chmodSync(bin, 0o755);
    run("xattr", ["-c", bin]);
    run("codesign", ["--force", "--sign", "-", "--options", "runtime", "--timestamp=none", "--entitlements", plist, bin]);
    const d = details(bin);
    if (!d.runtime || !d.adhoc) throw new Error(`répétition ${variant.id} : signature ad hoc avec runtime renforcé non constatée.`);

    for (const { arch, prefix, native: isNative } of arches) {
      const t0 = Date.now();
      const [cmd, ...pre] = prefix.length ? prefix : [bin];
      const jitArgs = prefix.length ? [...pre, bin, "-e", JIT_SCRIPT] : ["-e", JIT_SCRIPT];
      const jr = run(cmd, jitArgs, { allowFail: true, timeout: 120_000 });
      const last = jr.stdout.trim().split("\n").pop() ?? "";
      const jit = jr.status === 0 && /^jit-ok 20000 \d+$/.test(last)
        ? { ok: true, seconds: (Date.now() - t0) / 1000 }
        : { ok: false, detail: `code ${jr.status}${jr.signal ? ` (${jr.signal})` : ""} ${jr.stderr.trim().split("\n").slice(-3).join(" | ")}` };
      const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "jobscout-repetition-"));
      let server;
      try {
        server = jit.ok ? await serverCheck(prefix, bin, appDir, version, sandbox) : { ok: false, detail: "non lancé (JIT en échec)" };
      } finally {
        fs.rmSync(sandbox, { recursive: true, force: true });
      }
      results.push({ variant: variant.id, entitlements: variant.keys, reference: !!variant.reference, arch, native: isNative, jit, server });
      const verdict = jit.ok && server.ok ? "OK" : "ÉCHEC";
      const msg = `${variant.id} (${arch}${isNative ? "" : ", Rosetta"}) : JIT ${jit.ok ? `OK ${jit.seconds.toFixed(1)} s` : `ÉCHEC ${jit.detail}`} ; ` +
        `serveur ${server.ok ? `OK ${server.seconds.toFixed(1)} s` : `ÉCHEC ${server.detail}`}`;
      (verdict === "OK" ? notice : warning)("Répétition du runtime renforcé", msg);
    }
  }

  const report = { version, signingMode, nativeArch: native, results, at: new Date().toISOString() };
  fs.writeFileSync(path.join(out, `repetition-${native}.json`), JSON.stringify(report, null, 2) + "\n");
  stepSummary(
    `### Répétition du runtime renforcé (${native})\n\n| Variante | Architecture | JIT | Serveur |\n|---|---|---|---|\n` +
      results.map((r) => `| ${r.variant} | ${r.arch}${r.native ? "" : " (Rosetta)"} | ${r.jit.ok ? "OK" : "échec"} | ${r.server.ok ? "OK" : "échec"} |`).join("\n") + "\n"
  );
  const blocking = signingMode === "developer-id"
    ? results.filter((r) => r.reference && r.native && !(r.jit.ok && r.server.ok))
    : [];
  return { report, blocking };
}

// -------------------------------------------------------------------- CLI
if (isMainModule(import.meta.url)) {
  runMain(TITLE, async () => {
    const [cmd, ...rest] = process.argv.slice(2);
    const cfg = loadMacConfig();
    switch (cmd) {
      case "mode": {
        const mode = macSigningMode(process.env);
        process.stdout.write(`${mode}\n`);
        if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `mode=${mode}\n`);
        return;
      }
      case "app": {
        requireDarwin(TITLE);
        const app = path.resolve(rest[0] ?? bundlePathFor(cfg));
        if (!fs.existsSync(app)) fail(TITLE, `${app} absent : lancez d'abord build-mac.mjs.`);
        const mode = macSigningMode(process.env);
        if (mode === "adhoc") {
          run("codesign", ["--verify", "--deep", "--strict", "--verbose=2", app]);
          if (detectSigningMode(app) !== "adhoc") fail(TITLE, `${path.basename(app)} n'a pas le sceau ad hoc attendu.`);
          updateReport({ mode: "adhoc" });
          notice(TITLE, "mode ad hoc : aucun secret de signature, l'app garde son sceau ad hoc (macOS demandera « Ouvrir quand même » une fois par version).");
          return;
        }
        const r = signAppDeveloperId(app, process.env);
        notice(TITLE, `app signée Developer ID (équipe ${r.team}), notarisée et agrafée.`);
        return;
      }
      case "dmg": {
        requireDarwin(TITLE);
        const dmg = path.resolve(rest[0] ?? path.join(OUTPUT_MAC, cfg.dmgName));
        if (!fs.existsSync(dmg)) fail(TITLE, `${dmg} absent : lancez d'abord make-dmg.mjs.`);
        if (macSigningMode(process.env) === "adhoc") {
          notice(TITLE, "mode ad hoc : le DMG n'est pas signé.");
          return;
        }
        signDmg(dmg, process.env);
        notice(TITLE, `${path.basename(dmg)} signé, notarisé et agrafé.`);
        return;
      }
      case "rehearsal": {
        const pos = rest.filter((a, i) => !a.startsWith("--") && rest[i - 1] !== "--mode");
        const mi = rest.indexOf("--mode");
        const mode = mi >= 0 ? rest[mi + 1] : undefined;
        if (mode !== undefined && !["adhoc", "developer-id"].includes(mode)) fail(TITLE, `--mode « ${mode} » : adhoc ou developer-id attendu.`);
        if (pos.length !== 2) fail(TITLE, "usage : sign-mac.mjs rehearsal <app> <sortie> [--mode adhoc|developer-id]");
        const { blocking, report } = await rehearsal({ app: path.resolve(pos[0]), out: path.resolve(pos[1]), mode });
        if (blocking.length) {
          fail("Répétition du runtime renforcé", `${blocking.length} échec(s) de la variante de référence en mode Developer ID : ` +
            blocking.map((b) => `${b.arch} ${b.jit.ok ? b.server.detail : b.jit.detail}`).join(" ; "));
        }
        const ok = report.results.filter((r) => r.jit.ok && r.server.ok).length;
        notice("Répétition du runtime renforcé", `${ok}/${report.results.length} essais OK (${report.nativeArch}, signature ${report.signingMode})`);
        return;
      }
      case "cleanup":
        cleanup();
        return;
      default:
        fail(TITLE, "usage : sign-mac.mjs mode | app [chemin.app] | dmg [chemin.dmg] | rehearsal <app> <sortie> [--mode …] | cleanup");
    }
  });
}
