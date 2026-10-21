// ============================================================================
// installer/mac/fetch-node-mac.mjs
//
// Node embarqué de l'app Mac : les DEUX archives officielles darwin de la
// version épinglée (node-darwin.json, même version que le Node Windows de
// installer/node-runtime.json), réunies par lipo en un binaire universel
// (x86_64 + arm64), re-signé ad hoc. La chaîne Windows (fetch-node.mjs,
// node-runtime.json) n'est pas touchée.
//
// Vérifications bloquantes, pour chaque archive .tar.gz :
//   1. SHA-256 = empreinte épinglée ET = ligne de SHASUMS256.txt téléchargée ;
//   2. extraction de bin/node et LICENSE ;
//   3. codesign --verify --strict du binaire officiel (Authority et
//      TeamIdentifier publiés en ::notice).
// Puis : lipo -create, lipo -archs = « x86_64 arm64 », codesign ad hoc,
// codesign --verify, node -v = version épinglée, minos ≤ 11.0 (vtool).
//
// Cache : installer/vendor/node/<version>/darwin-universal/{node,LICENSE}
// (dossier ignoré par git), avec provenance.json ; réutilisé seulement si la
// provenance correspond aux empreintes épinglées et au SHA-256 du binaire, et
// toujours re-vérifié (lipo, codesign, node -v, minos).
//
//   node installer/mac/fetch-node-mac.mjs [--no-cache]     (macOS seulement)
// ============================================================================
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import {
  HERE,
  INSTALLER,
  UNIVERSAL_ARCHS,
  checkUniversal,
  fail,
  hasTool,
  isMainModule,
  loadMacConfig,
  notice,
  requireDarwin,
  run,
  runMain,
  warning,
} from "./bundle.mjs";

export const PIN_FILE = path.join(HERE, "node-darwin.json");
export const WINDOWS_PIN_FILE = path.join(INSTALLER, "node-runtime.json");
const VENDOR = path.join(INSTALLER, "vendor", "node");
const DIST = "https://nodejs.org/dist";
const TITLE = "Node embarqué (darwin)";

/** Les deux archives officielles et la tranche que chacune doit contenir. */
export const DARWIN_ARCHIVES = [
  { key: "darwin-x64", arch: "x86_64" },
  { key: "darwin-arm64", arch: "arm64" },
];

const SHA_RE = /^[0-9a-f]{64}$/;

/** node-darwin.json validé : { version, "darwin-arm64", "darwin-x64" }. */
export function readPins(file = PIN_FILE) {
  const pins = JSON.parse(fs.readFileSync(file, "utf-8"));
  if (typeof pins.version !== "string" || !/^v\d+\.\d+\.\d+$/.test(pins.version)) {
    throw new Error(`${path.basename(file)} : version « ${pins.version} » invalide (attendu vX.Y.Z).`);
  }
  for (const { key } of DARWIN_ARCHIVES) {
    if (typeof pins[key] !== "string" || !SHA_RE.test(pins[key])) {
      throw new Error(`${path.basename(file)} : empreinte SHA-256 « ${key} » absente ou invalide.`);
    }
  }
  return pins;
}

/** Même version que le Node Windows, sinon il faut ré-épingler les empreintes darwin. */
export function checkPinsAligned(pins, windowsPin) {
  if (pins.version !== windowsPin.version) {
    throw new Error(
      `installer/mac/node-darwin.json (${pins.version}) ≠ installer/node-runtime.json (${windowsPin.version}) : ` +
        `ré-épingler les empreintes darwin-arm64 et darwin-x64 depuis ${DIST}/${windowsPin.version}/SHASUMS256.txt.`
    );
  }
}

export const archiveName = (version, key) => `node-${version}-${key}.tar.gz`;

/** SHASUMS256.txt → Map(nom de fichier → empreinte en minuscules). */
export function parseShasums(text) {
  const map = new Map();
  for (const line of String(text).split(/\r?\n/)) {
    const m = /^([0-9a-fA-F]{64})\s+\*?(\S+)$/.exec(line.trim());
    if (m) map.set(m[2], m[1].toLowerCase());
  }
  return map;
}

const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
const sha256File = (file) => sha256(fs.readFileSync(file));
const log = (m) => process.stdout.write(`[node-mac] ${m}\n`);

async function download(url, { attempts = 3 } = {}) {
  let last;
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(300_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (e) {
      last = e;
      log(`  ${url} : essai ${i}/${attempts} en échec (${e.message})`);
      if (i < attempts) await new Promise((r) => setTimeout(r, 5000 * i));
    }
  }
  throw new Error(`${url} : téléchargement impossible (${last?.message}).`);
}

/** Authority et TeamIdentifier de `codesign -dvv` (écrits sur stderr). */
export function parseCodesignIdentity(text) {
  const lines = String(text).split(/\r?\n/);
  return {
    authorities: lines.filter((l) => l.startsWith("Authority=")).map((l) => l.slice(10)),
    teamId: lines.find((l) => l.startsWith("TeamIdentifier="))?.slice(15) ?? null,
    adhoc: lines.some((l) => l.trim() === "Signature=adhoc"),
  };
}

/** Vérifications du binaire universel : lipo, signature, version, minos. */
function verifyUniversal(file, { version, minimum }) {
  const { archs, minos } = checkUniversal(file, { minimum, label: "node universel" });
  run("codesign", ["--verify", "--strict", file]);
  const id = parseCodesignIdentity(run("codesign", ["-dvv", file]).stderr);
  if (!id.adhoc) throw new Error("node universel : signature ad hoc attendue (codesign -dvv sans « Signature=adhoc »).");
  const v = run(file, ["-v"]).stdout.trim();
  if (v !== version) throw new Error(`node universel : « node -v » affiche « ${v} », attendu « ${version} ».`);
  return { archs, minos };
}

/**
 * Renvoie le Node universel vérifié : { node, license, version, archs, minos,
 * bytes, sha256, thin: [{ key, sha256, bytes, authority, teamId }], cached }.
 */
export async function ensureNodeMac({ useCache = true } = {}) {
  requireDarwin(TITLE);
  for (const t of ["lipo", "codesign", "tar", "xcrun"]) {
    if (!hasTool(t)) fail(TITLE, `outil absent : ${t}`);
  }
  const cfg = loadMacConfig();
  const minimum = cfg.minimumSystemVersion;
  const pins = readPins();
  checkPinsAligned(pins, JSON.parse(fs.readFileSync(WINDOWS_PIN_FILE, "utf-8")));
  const { version } = pins;

  const cacheDir = path.join(VENDOR, version, "darwin-universal");
  const cachedNode = path.join(cacheDir, "node");
  const cachedLicense = path.join(cacheDir, "LICENSE");
  const provenanceFile = path.join(cacheDir, "provenance.json");

  if (useCache && fs.existsSync(cachedNode) && fs.existsSync(cachedLicense) && fs.existsSync(provenanceFile)) {
    let prov = null;
    try {
      prov = JSON.parse(fs.readFileSync(provenanceFile, "utf-8"));
    } catch {
      prov = null;
    }
    const matches =
      prov &&
      prov.version === version &&
      DARWIN_ARCHIVES.every(({ key }) => prov.archives?.[key] === pins[key]) &&
      prov.universalSha256 === sha256File(cachedNode);
    if (matches) {
      const { archs, minos } = verifyUniversal(cachedNode, { version, minimum });
      log(`cache réutilisé et re-vérifié : ${cachedNode}`);
      return {
        node: cachedNode,
        license: cachedLicense,
        version,
        archs,
        minos,
        bytes: fs.statSync(cachedNode).size,
        sha256: prov.universalSha256,
        thin: prov.thin ?? [],
        cached: true,
      };
    }
    warning(TITLE, "cache présent mais sans provenance conforme aux empreintes épinglées : reconstruit.");
  }

  const work = fs.mkdtempSync(path.join(os.tmpdir(), "jobscout-node-mac-"));
  try {
    log(`SHASUMS256.txt de ${version}`);
    const sums = parseShasums((await download(`${DIST}/${version}/SHASUMS256.txt`)).toString("utf-8"));

    const thin = [];
    let licenseText = null;
    for (const { key, arch } of DARWIN_ARCHIVES) {
      const name = archiveName(version, key);
      log(`téléchargement ${DIST}/${version}/${name}`);
      const buf = await download(`${DIST}/${version}/${name}`);
      const actual = sha256(buf);
      const official = sums.get(name);
      if (!official) throw new Error(`${name} absent de SHASUMS256.txt (${version}).`);
      if (actual !== pins[key] || actual !== official) {
        throw new Error(
          `SHA-256 NON CONFORME pour ${name}\n  obtenu    : ${actual}\n  épinglé   : ${pins[key]}\n  officiel  : ${official}`
        );
      }
      log(`  SHA-256 vérifié (épinglé = officiel) : ${actual}`);

      const archive = path.join(work, name);
      fs.writeFileSync(archive, buf);
      const dest = path.join(work, key);
      fs.mkdirSync(dest);
      const root = `node-${version}-${key}`;
      run("tar", ["-xzf", archive, "-C", dest, `${root}/bin/node`, `${root}/LICENSE`]);
      const bin = path.join(dest, root, "bin", "node");
      const lic = path.join(dest, root, "LICENSE");
      if (!fs.existsSync(bin) || !fs.existsSync(lic)) throw new Error(`${name} : bin/node ou LICENSE absent après extraction.`);

      const sliceArchs = run("lipo", ["-archs", bin]).stdout.trim();
      if (sliceArchs !== arch) throw new Error(`${name} : lipo -archs affiche « ${sliceArchs} », attendu « ${arch} ».`);
      // Intégrité de la signature d'origine (Node.js publie des binaires signés).
      run("codesign", ["--verify", "--strict", bin]);
      const id = parseCodesignIdentity(run("codesign", ["-dvv", bin]).stderr);
      notice(
        `Node officiel ${key}`,
        `${version} : signature d'origine valide — Authority=${id.authorities[0] ?? "(aucune)"} ; TeamIdentifier=${id.teamId ?? "(aucun)"}`
      );
      const text = fs.readFileSync(lic, "utf-8");
      if (licenseText !== null && text !== licenseText) {
        warning(TITLE, `LICENSE de ${name} différent de celui de l'autre archive : celui de la première est conservé.`);
      }
      licenseText ??= text;
      thin.push({ key, arch, sha256: actual, bytes: fs.statSync(bin).size, path: bin, authority: id.authorities[0] ?? null, teamId: id.teamId });
    }

    const universal = path.join(work, "node");
    run("lipo", ["-create", ...thin.map((t) => t.path), "-output", universal]);
    run("codesign", ["--force", "--sign", "-", "--timestamp=none", universal]);
    const { archs, minos } = verifyUniversal(universal, { version, minimum });
    log(`universel : ${archs}, minos ${Object.entries(minos).map(([a, m]) => `${m} (${a})`).join(", ")}`);

    fs.rmSync(cacheDir, { recursive: true, force: true });
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.copyFileSync(universal, cachedNode);
    fs.chmodSync(cachedNode, 0o755);
    fs.writeFileSync(cachedLicense, licenseText, "utf-8");
    const universalSha256 = sha256File(cachedNode);
    const thinInfo = thin.map(({ key, arch, sha256: s, bytes, authority, teamId }) => ({ key, arch, sha256: s, bytes, authority, teamId }));
    fs.writeFileSync(
      provenanceFile,
      JSON.stringify(
        {
          version,
          archives: Object.fromEntries(DARWIN_ARCHIVES.map(({ key }) => [key, pins[key]])),
          universalSha256,
          thin: thinInfo,
          createdAt: new Date().toISOString(),
        },
        null,
        2
      ) + "\n"
    );
    // La copie dans le cache doit rester identique au binaire vérifié.
    if (universalSha256 !== sha256File(universal)) throw new Error("copie du node universel corrompue dans le cache.");
    run("codesign", ["--verify", "--strict", cachedNode]);

    return {
      node: cachedNode,
      license: cachedLicense,
      version,
      archs,
      minos,
      bytes: fs.statSync(cachedNode).size,
      sha256: universalSha256,
      thin: thinInfo,
      cached: false,
    };
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

if (isMainModule(import.meta.url)) {
  runMain(TITLE, async () => {
    const r = await ensureNodeMac({ useCache: !process.argv.includes("--no-cache") });
    if (r.archs !== UNIVERSAL_ARCHS) fail(TITLE, `architectures inattendues : ${r.archs}`);
    notice(
      TITLE,
      `${r.version} universel (${r.archs}), ${(r.bytes / 1024 / 1024).toFixed(1)} Mo, minos ${Object.values(r.minos).join("/")}, ` +
        `${r.cached ? "depuis le cache" : "assemblé"} → installer/vendor/node/${r.version}/darwin-universal/node`
    );
  });
}
