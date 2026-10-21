// ============================================================================
// installer/tree-digest.mjs
//
// Instantané d'une arborescence : une ligne par entrée, triée par chemin
// (séparateur « / », ordre des unités de code : le même résultat sous Windows,
// macOS et Linux).
//
//   <sha256 du contenu>  <taille> <chemin>     fichier
//   <64 tirets>          dossier  <chemin>/    dossier (même vide)
//   <sha256 de la cible> lien     <chemin>     lien symbolique, jamais suivi
//   <64 tirets>          autre    <chemin>     tube, socket…
//
// Sert à :
//   - la non-régression Windows : assemblage avant et après une modification de
//     la chaîne, 0 différence attendue (JobScout.exe exclu : csc y inscrit un
//     identifiant et une date à chaque compilation) ;
//   - aux instantanés du build et de la recette Mac : le serveur a-t-il écrit
//     dans l'app, l'app installée a-t-elle changé ?
//
// Usage :
//   node installer/tree-digest.mjs <dossier> [--exclude <motif>]... [--out <fichier>]
//        Liste sur la sortie standard (ou dans --out), synthèse sur stderr.
//   node installer/tree-digest.mjs --compare <A> <B> [--exclude <motif>]...
//        A et B : un dossier, ou une liste écrite par --out.
//
// Codes de sortie : 0 = liste écrite, ou A et B identiques ; 1 = différences
// (listées) ; 2 = usage incorrect ou dossier illisible.
//
// Motifs d'exclusion (inspirés de .gitignore) :
//   - sans « / » : nom d'un fichier ou d'un dossier, à toute profondeur
//     (« JobScout.exe », « *.log ») ;
//   - avec « / » : chemin depuis la racine (« app/.next/cache ») ;
//   - « * » ne franchit pas un « / », « ** » le franchit, « ? » vaut un caractère.
//   Un dossier exclu l'est avec tout son contenu.
//
// Module sans effet de bord à l'import.
// ============================================================================
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

/** Colonne « empreinte » des dossiers et des entrées spéciales. */
export const NO_HASH = "-".repeat(64);

const sha256 = (data) => crypto.createHash("sha256").update(data).digest("hex");

/** SHA-256 d'un fichier, lu par blocs de 1 Mo (le node universel fait ~200 Mo). */
export function sha256File(file) {
  const hash = crypto.createHash("sha256");
  const fd = fs.openSync(file, "r");
  try {
    const buf = Buffer.allocUnsafe(1 << 20);
    let n;
    while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) hash.update(buf.subarray(0, n));
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest("hex");
}

function globToRegExp(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*" && glob[i + 1] === "*") {
      if (glob[i + 2] === "/") {
        re += "(?:.*/)?";
        i += 2;
      } else {
        re += ".*";
        i += 1;
      }
    } else if (c === "*") re += "[^/]*";
    else if (c === "?") re += "[^/]";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}

/**
 * Compile des motifs d'exclusion (chaînes ou RegExp) en une fonction
 * `(chemin relatif « / ») => boolean`. Une entrée est exclue si elle-même ou
 * l'un de ses dossiers parents correspond.
 * @param {Array<string | RegExp>} [patterns]
 * @returns {(rel: string) => boolean}
 */
export function compileExcludes(patterns = []) {
  const tests = patterns.map((p) => {
    if (p instanceof RegExp) return { anywhere: false, test: (s) => p.test(s) };
    const pat = String(p).replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+$/, "");
    if (!pat) throw new Error("motif d'exclusion vide");
    const re = globToRegExp(pat);
    return { anywhere: !pat.includes("/"), test: (s) => re.test(s) };
  });
  return (rel) => {
    if (!tests.length) return false;
    const segs = rel.split("/");
    for (let k = 1; k <= segs.length; k++) {
      const prefix = segs.slice(0, k).join("/");
      const name = segs[k - 1];
      for (const t of tests) if (t.test(t.anywhere ? name : prefix)) return true;
    }
    return false;
  };
}

const byPath = (a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

/** Une ligne de la liste pour une entrée. */
export function formatEntry(e) {
  if (e.type === "file") return `${e.sha256} ${e.size} ${e.path}`;
  if (e.type === "dir") return `${NO_HASH} dossier ${e.path}/`;
  if (e.type === "link") return `${e.sha256} lien ${e.path}`;
  return `${NO_HASH} autre ${e.path}`;
}

/** Liste complète (une ligne par entrée, fin de ligne « \n »). */
export function formatDigest(entries) {
  return entries.map(formatEntry).join("\n") + (entries.length ? "\n" : "");
}

function summarize(entries) {
  let files = 0, dirs = 0, links = 0, others = 0, bytes = 0;
  for (const e of entries) {
    if (e.type === "file") {
      files++;
      bytes += e.size;
    } else if (e.type === "dir") dirs++;
    else if (e.type === "link") links++;
    else others++;
  }
  return { files, dirs, links, others, bytes, digest: sha256(formatDigest(entries)) };
}

/**
 * Instantané de `root`.
 * @param {string} root
 * @param {{ exclude?: Array<string | RegExp> }} [options]
 * @returns {{ root: string | null,
 *             entries: Array<{ type: string, path: string, size: number | null, sha256: string | null, target?: string }>,
 *             files: number, dirs: number, links: number, others: number, bytes: number, digest: string }}
 *   `digest` est le SHA-256 de la liste formatée : deux arbres identiques ont
 *   la même valeur.
 */
export function treeDigest(root, { exclude = [] } = {}) {
  const isExcluded = compileExcludes(exclude);
  const st = fs.lstatSync(root);
  if (!st.isDirectory()) throw new Error(`${root} n'est pas un dossier`);
  const entries = [];
  const visit = (abs, rel) => {
    for (const name of fs.readdirSync(abs)) {
      const r = rel ? `${rel}/${name}` : name;
      if (isExcluded(r)) continue;
      const p = path.join(abs, name);
      const s = fs.lstatSync(p);
      if (s.isSymbolicLink()) {
        const target = fs.readlinkSync(p);
        entries.push({ type: "link", path: r, size: null, sha256: sha256(target), target });
      } else if (s.isDirectory()) {
        entries.push({ type: "dir", path: r, size: null, sha256: null });
        visit(p, r);
      } else if (s.isFile()) {
        entries.push({ type: "file", path: r, size: s.size, sha256: sha256File(p) });
      } else {
        entries.push({ type: "other", path: r, size: null, sha256: null });
      }
    }
  };
  visit(root, "");
  entries.sort(byPath);
  return { root, entries, ...summarize(entries) };
}

const LINE_RE = /^([0-9a-f]{64}|-{64}) (\d+|dossier|lien|autre) (.+)$/;

/**
 * Relit une liste écrite par formatDigest (ou par --out). Accepte aussi une
 * liste redirigée par PowerShell (« > ») : marque d'ordre en tête, fins de
 * ligne « \r\n ».
 */
export function parseDigest(text) {
  const entries = [];
  for (const [i, raw] of text.replace(/^﻿/, "").split("\n").entries()) {
    const line = raw.replace(/\r$/, "");
    if (!line) continue;
    const m = LINE_RE.exec(line);
    if (!m) throw new Error(`ligne ${i + 1} illisible : ${line.slice(0, 80)}`);
    const [, hash, kind, p] = m;
    if (kind === "dossier") entries.push({ type: "dir", path: p.replace(/\/$/, ""), size: null, sha256: null });
    else if (kind === "lien") entries.push({ type: "link", path: p, size: null, sha256: hash });
    else if (kind === "autre") entries.push({ type: "other", path: p, size: null, sha256: null });
    else entries.push({ type: "file", path: p, size: Number(kind), sha256: hash });
  }
  entries.sort(byPath);
  return { root: null, entries, ...summarize(entries) };
}

/**
 * Compare deux instantanés (résultats de treeDigest ou parseDigest).
 * @param {{ entries: Array<{ type: string, path: string, size: number | null, sha256: string | null }> }} a
 * @param {{ entries: Array<{ type: string, path: string, size: number | null, sha256: string | null }> }} b
 * @param {{ exclude?: Array<string | RegExp> }} [options]  exclusions appliquées aux deux côtés
 * @returns {{ equal: boolean, added: any[], removed: any[], changed: Array<{ path: string, before: any, after: any }> }}
 */
export function compareDigests(a, b, { exclude = [] } = {}) {
  const isExcluded = compileExcludes(exclude);
  const keep = (list) => list.filter((e) => !isExcluded(e.path));
  const ma = new Map(keep(a.entries).map((e) => [e.path, e]));
  const mb = new Map(keep(b.entries).map((e) => [e.path, e]));
  const added = [], removed = [], changed = [];
  for (const [p, e] of mb) if (!ma.has(p)) added.push(e);
  for (const [p, e] of ma) {
    const f = mb.get(p);
    if (!f) removed.push(e);
    else if (e.type !== f.type || e.size !== f.size || e.sha256 !== f.sha256) changed.push({ path: p, before: e, after: f });
  }
  added.sort(byPath);
  removed.sort(byPath);
  changed.sort(byPath);
  return { equal: !added.length && !removed.length && !changed.length, added, removed, changed };
}

/**
 * Instantané d'un dossier, ou relecture d'une liste écrite par --out.
 * @param {string} target
 * @param {{ exclude?: Array<string | RegExp> }} [options]
 */
export function loadDigest(target, { exclude = [] } = {}) {
  const st = fs.statSync(target);
  if (st.isDirectory()) return treeDigest(target, { exclude });
  // Windows PowerShell 5.1 écrit « > » en UTF-16LE (marque FF FE).
  const buf = fs.readFileSync(target);
  const text = buf[0] === 0xff && buf[1] === 0xfe ? buf.subarray(2).toString("utf16le") : buf.toString("utf-8");
  const parsed = parseDigest(text);
  if (!exclude.length) return parsed;
  const isExcluded = compileExcludes(exclude);
  const entries = parsed.entries.filter((e) => !isExcluded(e.path));
  return { root: null, entries, ...summarize(entries) };
}

const describe = (d) =>
  `${d.files} fichiers (${d.bytes} octets), ${d.dirs} dossiers, ${d.links} liens` +
  (d.others ? `, ${d.others} autres` : "") +
  ` — empreinte ${d.digest}`;

function parseArgs(argv) {
  const out = { positional: [], exclude: [], out: null, compare: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--compare") out.compare = true;
    else if (a === "--exclude" || a === "--out") {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${a} attend une valeur`);
      if (a === "--exclude") out.exclude.push(v);
      else out.out = v;
    } else if (a.startsWith("--exclude=")) out.exclude.push(a.slice(10));
    else if (a.startsWith("--out=")) out.out = a.slice(6);
    else if (a.startsWith("--")) throw new Error(`option inconnue ${a}`);
    else out.positional.push(a);
  }
  return out;
}

function main(argv) {
  let args;
  try {
    args = parseArgs(argv);
    if (args.compare ? args.positional.length !== 2 : args.positional.length !== 1) {
      throw new Error("arguments attendus : <dossier> | --compare <A> <B>");
    }
  } catch (e) {
    process.stderr.write(
      `[digest] ${e.message}\n` +
        "usage : node installer/tree-digest.mjs <dossier> [--exclude <motif>]... [--out <fichier>]\n" +
        "        node installer/tree-digest.mjs --compare <A> <B> [--exclude <motif>]...\n"
    );
    return 2;
  }
  try {
    if (!args.compare) {
      const d = treeDigest(path.resolve(args.positional[0]), { exclude: args.exclude });
      const text = formatDigest(d.entries);
      if (args.out) fs.writeFileSync(args.out, text, "utf-8");
      else process.stdout.write(text);
      process.stderr.write(`[digest] ${args.positional[0]} : ${describe(d)}\n`);
      return 0;
    }
    const [pa, pb] = args.positional.map((p) => path.resolve(p));
    const a = loadDigest(pa, { exclude: args.exclude });
    const b = loadDigest(pb, { exclude: args.exclude });
    const cmp = compareDigests(a, b);
    process.stdout.write(`[digest] A = ${pa}\n         ${describe(a)}\n`);
    process.stdout.write(`[digest] B = ${pb}\n         ${describe(b)}\n`);
    if (cmp.equal) {
      process.stdout.write(`[digest] IDENTIQUES : 0 différence.\n`);
      return 0;
    }
    const head = (e) => formatEntry(e).split(" ").slice(0, 2).join(" ");
    const lines = [
      ...cmp.added.map((e) => `  + ${formatEntry(e)}`),
      ...cmp.removed.map((e) => `  - ${formatEntry(e)}`),
      ...cmp.changed.map((c) => `  ~ ${c.path} (${head(c.before)} -> ${head(c.after)})`),
    ];
    process.stdout.write(
      `[digest] DIFFÉRENCES : ${cmp.added.length} ajoutés, ${cmp.removed.length} retirés, ` +
        `${cmp.changed.length} modifiés\n` +
        lines.slice(0, 200).join("\n") +
        (lines.length > 200 ? `\n  … et ${lines.length - 200} autres` : "") +
        "\n"
    );
    return 1;
  } catch (e) {
    process.stderr.write(`[digest] ÉCHEC : ${e.message}\n`);
    return 2;
  }
}

const isMain =
  !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) process.exitCode = main(process.argv.slice(2));
