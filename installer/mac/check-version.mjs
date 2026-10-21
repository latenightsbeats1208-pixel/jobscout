// ============================================================================
// installer/mac/check-version.mjs — cohérence des numéros de version.
//
//   node installer/mac/check-version.mjs [--root <dossier>]
//
// Variables d'environnement (posées par le workflow installeur-mac.yml) :
//   REF_TYPE   « tag » ou « branch » (github.ref_type)
//   REF_NAME   nom du tag ou de la branche (github.ref_name)
//
// Contrôles, tous bloquants :
//   1. version.json, package.json et package-lock.json (racine ET packages[""])
//      portent la même version, au format X.Y.Z ;
//   2. le changelog de version.json a une entrée non vide pour cette version,
//      sans texte provisoire (« TODO », « A_COMPLETER », « {{…}} ») ;
//   3. CONFIDENTIALITE.md contient « JobScout <version> » ;
//   4. installer/mac/node-darwin.json épingle la même version de Node que
//      installer/node-runtime.json (Windows), avec deux empreintes SHA-256 ;
//   5. installer/mac/LISEZ-MOI.txt (texte du DMG) : toute mention
//      « JobScout X.Y.Z » écrite en dur vaut la version (un modèle
//      « {{version}} » passe) ;
//   6. sur un tag : son nom vaut exactement « v<version> ».
//
// Sortie : une ligne par contrôle, `::error` pour chaque échec, un `::notice`
// de synthèse si tout est vert. Codes : 0 = cohérent, 1 = au moins un écart,
// 2 = usage incorrect.
// ============================================================================
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { annotation } from "./ci-status.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(HERE, "..", "..");

/** Textes provisoires interdits dans une entrée de changelog publiée. */
export const PLACEHOLDER_RE = /\bTODO\b|\bTBD\b|A_COMPLETER|À COMPLÉTER|\{\{[^}]*\}\}/;

const SEMVER_RE = /^\d+\.\d+\.\d+$/;
const SHA256_RE = /^[0-9a-f]{64}$/;

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf-8"));
}

/**
 * Contrôle la cohérence des versions sous `root`.
 * @param {{ root?: string, refType?: string, refName?: string }} [options]
 * @returns {{ version: string | null, results: Array<{ label: string, ok: boolean, detail: string }> }}
 */
export function checkVersion({ root = DEFAULT_ROOT, refType = "", refName = "" } = {}) {
  /** @type {Array<{ label: string, ok: boolean, detail: string }>} */
  const results = [];
  const check = (label, ok, detail = "") => {
    results.push({ label, ok: !!ok, detail });
    return !!ok;
  };
  const tryRead = (rel, reader) => {
    try {
      return { value: reader(path.join(root, rel)), error: null };
    } catch (e) {
      return { value: null, error: `${rel} illisible : ${e instanceof Error ? e.message : String(e)}` };
    }
  };

  // 1. Les quatre emplacements du numéro de version.
  const vj = tryRead("version.json", readJson);
  const pj = tryRead("package.json", readJson);
  const lj = tryRead("package-lock.json", readJson);
  const v = vj.value && typeof vj.value.version === "string" ? vj.value.version : null;
  check("version.json lisible, version au format X.Y.Z", v !== null && SEMVER_RE.test(v), vj.error ?? `version=${v}`);
  const found = [
    ["package.json", pj.value?.version ?? null, pj.error],
    ["package-lock.json (racine)", lj.value?.version ?? null, lj.error],
    ['package-lock.json (packages[""])', lj.value?.packages?.[""]?.version ?? null, lj.error],
  ];
  for (const [where, value, error] of found) {
    check(`${where} = version.json`, v !== null && value === v, error ?? `${value} / ${v}`);
  }

  // 2. Entrée de changelog, sans texte provisoire.
  const entry = v !== null ? vj.value?.changelog?.[v] : undefined;
  const hasEntry = typeof entry === "string" && entry.trim().length > 0;
  check(`changelog de version.json : entrée ${v ?? "?"} présente`, hasEntry, hasEntry ? `${entry.length} caractères` : "absente ou vide");
  if (hasEntry) {
    const m = PLACEHOLDER_RE.exec(entry);
    check(`changelog ${v} : aucun texte provisoire`, !m, m ? `« ${m[0]} » à remplacer` : "aucun");
  }

  // 3. Version citée par la politique de confidentialité.
  const conf = tryRead("CONFIDENTIALITE.md", (f) => fs.readFileSync(f, "utf-8"));
  check(
    `CONFIDENTIALITE.md cite « JobScout ${v ?? "?"} »`,
    v !== null && typeof conf.value === "string" && conf.value.includes(`JobScout ${v}`),
    conf.error ?? ((conf.value ?? "").match(/JobScout \d+\.\d+\.\d+/g) ?? []).slice(0, 3).join(", ")
  );

  // 4. Même Node épinglé pour Windows et pour Mac.
  const win = tryRead(path.join("installer", "node-runtime.json"), readJson);
  const mac = tryRead(path.join("installer", "mac", "node-darwin.json"), readJson);
  const wv = win.value?.version ?? null;
  const mv = mac.value?.version ?? null;
  check(
    "node-darwin.json épingle le même Node que node-runtime.json (sinon : ré-épingler)",
    typeof wv === "string" && wv.length > 0 && mv === wv,
    win.error ?? mac.error ?? `Mac ${mv} / Windows ${wv}`
  );
  check(
    "node-darwin.json : empreintes SHA-256 darwin-arm64 et darwin-x64",
    SHA256_RE.test(String(mac.value?.["darwin-arm64"] ?? "")) && SHA256_RE.test(String(mac.value?.["darwin-x64"] ?? "")),
    mac.error ?? "64 caractères hexadécimaux attendus pour chacune"
  );

  // 5. Texte du DMG : pas de numéro de version figé et périmé.
  const readmeRel = path.join("installer", "mac", "LISEZ-MOI.txt");
  if (fs.existsSync(path.join(root, readmeRel))) {
    const text = fs.readFileSync(path.join(root, readmeRel), "utf-8");
    const stale = [...new Set(text.match(/JobScout \d+\.\d+\.\d+/g) ?? [])].filter((s) => s !== `JobScout ${v}`);
    check("installer/mac/LISEZ-MOI.txt : aucune version périmée écrite en dur", stale.length === 0, stale.join(", ") || "aucune");
  }

  // 6. Tag = v<version>.
  if (refType === "tag") {
    check(`tag « ${refName} » = « v${v ?? "?"} »`, v !== null && refName === `v${v}`, `tag ${refName}`);
  }

  return { version: v, results };
}

function parseArgs(argv) {
  const out = { root: DEFAULT_ROOT };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--root") {
      const val = argv[++i];
      if (!val) throw new Error("--root attend un dossier");
      out.root = path.resolve(val);
    } else if (a.startsWith("--root=")) out.root = path.resolve(a.slice(7));
    else throw new Error(`argument inconnu : ${a}`);
  }
  return out;
}

function main(argv, env = process.env) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (e) {
    process.stderr.write(`[version] ${e.message}\nusage : node installer/mac/check-version.mjs [--root <dossier>]\n`);
    return 2;
  }
  const refType = env.REF_TYPE ?? "";
  const refName = env.REF_NAME ?? "";
  const { version, results } = checkVersion({ root: args.root, refType, refName });
  for (const r of results) {
    process.stdout.write(`  ${r.ok ? "OK   " : "ÉCHEC"} ${r.label}${r.detail ? ` — ${r.detail}` : ""}\n`);
  }
  const failed = results.filter((r) => !r.ok);
  if (failed.length) {
    // Une annotation par écart (9 au plus : GitHub en garde 10 par étape).
    for (const f of failed.slice(0, 9)) {
      process.stdout.write(annotation("error", "Versions", `${f.label}${f.detail ? ` — ${f.detail}` : ""}`, env) + "\n");
    }
    process.stdout.write(`[version] ${results.length - failed.length}/${results.length} contrôles OK\n`);
    return 1;
  }
  const where = refType === "tag" ? `tag ${refName}` : refName ? `branche ${refName}` : "copie locale";
  const summary =
    `JobScout ${version} (${where}) : version.json = package.json = package-lock (2 endroits), ` +
    `changelog, CONFIDENTIALITE.md, Node épinglé identique Windows/Mac — ${results.length}/${results.length} contrôles OK`;
  process.stdout.write(annotation("notice", "Versions", summary, env) + "\n");
  return 0;
}

const isMain = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) process.exitCode = main(process.argv.slice(2));
