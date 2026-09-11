// ============================================================================
// installer/fetch-node.mjs
//
// Récupère le runtime Node embarqué dans le paquet Windows.
//
// node:sqlite exige Node >= 22.5 : on ne peut pas dépendre du Node de la
// machine cible (souvent absent). On embarque donc le node.exe officiel de la
// dernière LTS 22.x, téléchargé depuis nodejs.org et VÉRIFIÉ contre le
// SHASUMS256.txt publié à côté de l'archive.
//
// Le résultat est mis en cache dans installer/vendor/node/<version>/node.exe :
// les builds suivants ne retéléchargent rien.
//
//   node installer/fetch-node.mjs            → version épinglée (node-runtime.json)
//   node installer/fetch-node.mjs --refresh  → ré-épingle la dernière LTS 22.x
// ============================================================================
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import os from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PIN_FILE = path.join(HERE, "node-runtime.json");
const VENDOR = path.join(HERE, "vendor", "node");
const MAJOR = 22;
const ARCH = "win-x64";

function log(msg) {
  process.stdout.write(`[node-runtime] ${msg}\n`);
}

async function resolveLatestLts() {
  const res = await fetch("https://nodejs.org/dist/index.json");
  if (!res.ok) throw new Error(`nodejs.org/dist/index.json : HTTP ${res.status}`);
  const all = await res.json();
  const match = all.find((v) => v.version.startsWith(`v${MAJOR}.`) && v.lts);
  if (!match) throw new Error(`Aucune version LTS ${MAJOR}.x publiée.`);
  return match.version; // ex. "v22.23.2"
}

function readPin() {
  try {
    return JSON.parse(fs.readFileSync(PIN_FILE, "utf-8"));
  } catch {
    return null;
  }
}

function writePin(version) {
  fs.writeFileSync(
    PIN_FILE,
    JSON.stringify(
      {
        comment:
          "Runtime Node embarque dans l'installeur Windows. Verifie par SHA256 contre SHASUMS256.txt de nodejs.org.",
        version,
        arch: ARCH,
        pinned_at: new Date().toISOString().slice(0, 10),
      },
      null,
      2
    ) + "\n"
  );
}

/** Ligne du SHASUMS256.txt officiel correspondant à notre archive. */
async function officialSha256(version, zipName) {
  const url = `https://nodejs.org/dist/${version}/SHASUMS256.txt`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} : HTTP ${res.status}`);
  const text = await res.text();
  for (const line of text.split(/\r?\n/)) {
    const [sum, name] = line.trim().split(/\s+/);
    if (name === zipName) return sum.toLowerCase();
  }
  throw new Error(`${zipName} absent de SHASUMS256.txt (${version}).`);
}

function extractNodeExe(zipPath, destDir) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "jobscout-node-"));
  try {
    // tar.exe (bsdtar) sait lire les zip sur Windows 10/11 ; Expand-Archive en secours.
    try {
      execFileSync("tar", ["-xf", zipPath, "-C", tmp], { stdio: "ignore" });
    } catch {
      execFileSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          `Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${tmp}' -Force`,
        ],
        { stdio: "ignore" }
      );
    }
    const root = fs.readdirSync(tmp).find((d) => d.startsWith("node-"));
    if (!root) throw new Error("Archive Node : racine introuvable.");
    const src = path.join(tmp, root, "node.exe");
    if (!fs.existsSync(src)) throw new Error("node.exe introuvable dans l'archive.");
    fs.mkdirSync(destDir, { recursive: true });
    fs.copyFileSync(src, path.join(destDir, "node.exe"));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/** Retourne le chemin d'un node.exe vérifié, en le téléchargeant si besoin. */
export async function ensureNodeRuntime({ refresh = false } = {}) {
  let pin = readPin();
  let version = pin?.version;
  if (refresh || !version) {
    version = await resolveLatestLts();
    writePin(version);
    log(`version épinglée : ${version}`);
  }

  const destDir = path.join(VENDOR, version);
  const exe = path.join(destDir, "node.exe");
  if (fs.existsSync(exe)) {
    log(`runtime déjà en cache : ${version}`);
    return { exe, version };
  }

  const zipName = `node-${version}-${ARCH}.zip`;
  const zipUrl = `https://nodejs.org/dist/${version}/${zipName}`;
  log(`téléchargement ${zipUrl}`);
  const res = await fetch(zipUrl);
  if (!res.ok) throw new Error(`${zipUrl} : HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());

  const actual = crypto.createHash("sha256").update(buf).digest("hex");
  const expected = await officialSha256(version, zipName);
  if (actual !== expected) {
    throw new Error(
      `SHA256 NON CONFORME pour ${zipName}\n  attendu : ${expected}\n  obtenu  : ${actual}`
    );
  }
  log(`SHA256 vérifié : ${expected}`);

  fs.mkdirSync(VENDOR, { recursive: true });
  const zipPath = path.join(VENDOR, zipName);
  fs.writeFileSync(zipPath, buf);
  try {
    extractNodeExe(zipPath, destDir);
  } finally {
    fs.rmSync(zipPath, { force: true });
  }
  const size = (fs.statSync(exe).size / 1024 / 1024).toFixed(1);
  log(`node.exe extrait (${size} Mo) → ${exe}`);
  return { exe, version };
}

if (!!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  ensureNodeRuntime({ refresh: process.argv.includes("--refresh") }).then(
    ({ exe, version }) => log(`prêt : ${version} (${exe})`),
    (e) => {
      console.error(`[node-runtime] ÉCHEC : ${e.message}`);
      process.exit(1);
    }
  );
}
