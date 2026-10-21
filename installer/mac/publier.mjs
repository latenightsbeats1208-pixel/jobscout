// ============================================================================
// installer/mac/publier.mjs — Release GitHub en BROUILLON, jamais publiée ici.
//
//   node installer/mac/publier.mjs publier --dir <dossier> [--dry-run] [--tag vX.Y.Z]
//   node installer/mac/publier.mjs attendre-tests --sha <commit> [--minutes 30] [--workflow ci.yml]
//
// Variables d'environnement :
//   GH_REPO    « propriétaire/dépôt » (obligatoire ; posé par le workflow)
//   GH_TOKEN   jeton lu par gh (GITHUB_TOKEN du workflow)
//   TAG        tag visé (défaut : --tag, sinon « v » + version.json)
//   SIGNATURE  adhoc | developer-id (texte des notes ; défaut : adhoc)
//   GITHUB_SHA commit cité dans les notes
//
// publier :
//   1. Collection : le dossier contient EXACTEMENT JobScout-Mac.dmg,
//      SHA256SUMS.txt et rapport-construction.json ; SHA256SUMS.txt a une seule
//      ligne, pour JobScout-Mac.dmg, égale à l'empreinte calculée ici.
//   2. État : liste des releases par l'API (brouillons compris quand le jeton
//      a le droit d'écrire ; « Get a release by tag » ne voit que les
//      releases publiées).
//   3. Décision (decide) :
//        release publiée pour ce tag        → refus, jamais remplacée ;
//        plusieurs releases pour ce tag      → refus ;
//        brouillon avec d'autres fichiers    → refus (rien n'est supprimé ici) ;
//        brouillon                           → gh release upload --clobber, puis
//                                              titre et texte réécrits (PATCH de
//                                              la release par son identifiant) ;
//        aucune                              → gh release create --draft --verify-tag.
//      Le texte (release-notes.mjs) est toujours rendu à partir du DMG local,
//      de SIGNATURE et de GITHUB_SHA : un brouillon complété après une
//      reconstruction n'affiche jamais l'empreinte, la taille ou le mode de
//      signature de la construction précédente.
//   4. Constat (verifyRelease) : relecture par l'API — brouillon, titre,
//      exactement deux fichiers, tailles égales, empreinte « digest » égale à
//      la nôtre (sans digest, le fichier est retéléchargé et son SHA-256
//      recalculé) ; texte (checkReleaseBody) : SHA-256 local seul sur sa ligne,
//      taille, phrase du mode de signature constaté et absence de celle de
//      l'autre mode, commit cité. Un écart de texte ailleurs est signalé en
//      avertissement (l'API pourrait normaliser le Markdown).
//   --dry-run : étapes 1 et 2, puis la décision est affichée ; rien n'est écrit.
//
// attendre-tests : attend que les runs « push » du workflow ci.yml sur ce
// commit soient tous terminés ; tous doivent être verts.
//
// Codes de sortie : 0 = fait (ou décision affichée à blanc) ; 1 = refus ou
// contrôle en échec ; 2 = usage incorrect.
// ============================================================================
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { annotation, tailLines } from "./ci-status.mjs";
import { renderReleaseNotes, sha256File, formatMo, SIGNATURE_MODES, SIGNATURE_MARKERS } from "./release-notes.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.resolve(HERE, "..", "..");

// Noms des fichiers livrés : mac.json est la source unique (build, DMG, recette).
const MAC = JSON.parse(fs.readFileSync(path.join(HERE, "mac.json"), "utf-8"));
export const DMG_NAME = MAC.dmgName;
export const SUMS_NAME = MAC.sumsName;
export const REPORT_NAME = MAC.reportName;
/** Fichiers joints à la Release. */
export const ASSET_NAMES = [DMG_NAME, SUMS_NAME];
/** Fichiers attendus dans l'artefact de construction. */
export const COLLECTION = [DMG_NAME, SUMS_NAME, REPORT_NAME];

const sorted = (a) => [...a].sort();
const sameSet = (a, b) => JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));

// ------------------------------------------------------- logique pure
/**
 * Lit un fichier au format de `shasum -a 256` (« <hex>  <nom> », ou
 * « <hex> *<nom> » en mode binaire).
 * @param {string} text
 * @returns {{ entries: Array<{ sha256: string, name: string }>, errors: string[] }}
 */
export function parseSums(text) {
  const entries = [];
  const errors = [];
  String(text ?? "")
    .split("\n")
    .map((l) => l.replace(/\r$/, ""))
    .forEach((line, i) => {
      if (!line.trim()) return;
      const m = /^([0-9a-fA-F]{64}) [ *](.+)$/.exec(line);
      if (!m) errors.push(`ligne ${i + 1} illisible`);
      else entries.push({ sha256: m[1].toLowerCase(), name: m[2] });
    });
  return { entries, errors };
}

/**
 * Contrôle de l'artefact de construction, avant toute écriture.
 * @param {{ names: string[], sumsText: string, dmgSha256: string, dmgSize: number,
 *           reportText: string, version: string }} input
 * @returns {{ ok: boolean, problems: string[] }}
 */
export function checkCollection({ names, sumsText, dmgSha256, dmgSize, reportText, version }) {
  const problems = [];
  if (!sameSet(names, COLLECTION)) {
    const extra = names.filter((n) => !COLLECTION.includes(n));
    const missing = COLLECTION.filter((n) => !names.includes(n));
    problems.push(
      `contenu de l'artefact : attendu exactement ${COLLECTION.join(", ")}` +
        (missing.length ? ` ; manquant : ${missing.join(", ")}` : "") +
        (extra.length ? ` ; en trop : ${extra.join(", ")}` : "")
    );
  }
  if (!(dmgSize > 0)) problems.push(`${DMG_NAME} vide ou absent`);
  const sums = parseSums(sumsText);
  if (sums.errors.length) problems.push(`${SUMS_NAME} : ${sums.errors.join(", ")}`);
  if (sums.entries.length !== 1 || sums.entries[0].name !== DMG_NAME) {
    problems.push(
      `${SUMS_NAME} : une seule ligne attendue, pour ${DMG_NAME} (lu : ${sums.entries.map((e) => e.name).join(", ") || "aucune"})`
    );
  } else if (sums.entries[0].sha256 !== dmgSha256) {
    problems.push(`${SUMS_NAME} ne correspond pas au DMG (fichier ${sums.entries[0].sha256.slice(0, 12)}…, calculé ${String(dmgSha256).slice(0, 12)}…)`);
  }
  let report = null;
  try {
    report = JSON.parse(reportText);
  } catch {
    problems.push(`${REPORT_NAME} : JSON illisible`);
  }
  if (report && typeof report === "object" && "version" in report && report.version !== version) {
    problems.push(`${REPORT_NAME} : version ${report.version}, attendu ${version}`);
  }
  return { ok: problems.length === 0, problems };
}

/**
 * @typedef {{ action: "create" | "complete" | "refuse", reason: string,
 *             release: any, matches: number }} Decision
 */

/**
 * Que faire de la Release de ce tag ?
 * @param {{ tag: string, releases: any[] }} input
 * @returns {Decision}
 */
export function decide({ tag, releases }) {
  const matches = (Array.isArray(releases) ? releases : []).filter((r) => r && r.tag_name === tag);
  if (matches.length > 1) {
    return {
      action: "refuse",
      reason: `${matches.length} releases portent le tag ${tag} (identifiants ${matches.map((r) => r.id).join(", ")}) : à trier à la main`,
      release: null,
      matches: matches.length,
    };
  }
  if (matches.length === 0) {
    return { action: "create", reason: `aucune release pour ${tag} : création d'un brouillon`, release: null, matches: 0 };
  }
  const rel = matches[0];
  if (rel.draft !== true) {
    return {
      action: "refuse",
      reason: `la release ${tag} est déjà publiée (${rel.html_url ?? rel.id}) : elle n'est jamais remplacée`,
      release: rel,
      matches: 1,
    };
  }
  const unexpected = (rel.assets ?? []).map((a) => a.name).filter((n) => !ASSET_NAMES.includes(n));
  if (unexpected.length) {
    return {
      action: "refuse",
      reason: `le brouillon ${tag} contient d'autres fichiers (${unexpected.join(", ")}) : rien n'est supprimé automatiquement`,
      release: rel,
      matches: 1,
    };
  }
  return { action: "complete", reason: `brouillon ${tag} existant : ${ASSET_NAMES.join(" et ")} remplacés`, release: rel, matches: 1 };
}

/** Texte comparable : fins de ligne LF, espaces de fin de texte retirés. */
const normalizeBody = (s) => String(s ?? "").replace(/\r\n?/g, "\n").trim();

/**
 * @typedef {{ body: string, title: string, signature: string, commit?: string | null }} ExpectedNotes
 */

/**
 * Le texte d'une Release relue par l'API correspond-il au DMG livré ?
 * Bloquant (`problems`) : SHA-256 local seul sur sa ligne, taille affichée,
 * phrase du mode de signature constaté, absence de celle de tout autre mode,
 * commit cité. Informatif (`warnings`) : autre écart avec le texte rendu.
 * @param {string | null | undefined} body texte relu
 * @param {ExpectedNotes & { sha256: string, sizeBytes: number }} expected
 * @returns {{ problems: string[], warnings: string[] }}
 */
export function checkReleaseBody(body, { body: expectedBody, signature, commit = null, sha256, sizeBytes }) {
  const problems = [];
  const warnings = [];
  const text = normalizeBody(body);
  if (!text) return { problems: ["texte de la Release vide"], warnings };
  const lines = text.split("\n").map((l) => l.trim());
  if (!/^[0-9a-f]{64}$/.test(String(sha256)) || !lines.includes(sha256)) {
    const shown = lines.filter((l) => /^[0-9a-f]{64}$/.test(l));
    problems.push(
      `texte : empreinte affichée ${shown.length ? shown.map((s) => s.slice(0, 12) + "…").join(", ") : "absente"}, ` +
        `attendu ${String(sha256).slice(0, 12)}… (DMG local)`
    );
  }
  const size = `(${formatMo(sizeBytes)} Mo)`;
  if (!text.includes(size)) problems.push(`texte : taille ${size} absente`);
  const marker = SIGNATURE_MARKERS[signature];
  if (!marker) problems.push(`texte : mode de signature inconnu (${signature})`);
  else if (!text.includes(marker)) problems.push(`texte : phrase du mode ${signature} absente (« ${marker} »)`);
  for (const [mode, other] of Object.entries(SIGNATURE_MARKERS)) {
    if (mode !== signature && text.includes(other)) problems.push(`texte : contient encore la phrase du mode ${mode} (« ${other} »)`);
  }
  if (commit && !text.includes(`/commit/${commit})`)) problems.push(`texte : commit ${String(commit).slice(0, 12)} non cité`);
  if (!problems.length && text !== normalizeBody(expectedBody)) {
    warnings.push("texte relu différent du texte envoyé ailleurs que sur l'empreinte, la taille, la signature et le commit (normalisation par l'API ?)");
  }
  return { problems, warnings };
}

/**
 * Constat après écriture : la Release relue par l'API est-elle exactement
 * celle attendue ? `notes` est obligatoire : sans texte attendu, le constat
 * échoue (jamais de contrôle sauté en silence).
 * @param {{ tag: string, releases: any[], local: Record<string, { size: number, sha256: string }>,
 *           notes?: ExpectedNotes | null }} input
 * @returns {{ ok: boolean, problems: string[], warnings: string[], release: any, toDownload: Array<{ id: number, name: string }> }}
 */
export function verifyRelease({ tag, releases, local, notes = null }) {
  const problems = [];
  const warnings = [];
  const toDownload = [];
  const matches = (Array.isArray(releases) ? releases : []).filter((r) => r && r.tag_name === tag);
  if (matches.length !== 1) {
    return { ok: false, problems: [`${matches.length} release(s) pour ${tag}, 1 attendue`], warnings, release: null, toDownload };
  }
  const rel = matches[0];
  if (rel.draft !== true) problems.push(`la release ${tag} n'est pas un brouillon`);
  if (!notes || typeof notes.body !== "string") {
    problems.push("texte attendu de la Release non fourni au constat");
  } else {
    if (rel.name !== notes.title) problems.push(`titre « ${rel.name ?? ""} », attendu « ${notes.title} »`);
    const dmg = local[DMG_NAME] ?? { size: 0, sha256: "" };
    const b = checkReleaseBody(rel.body, { ...notes, sha256: dmg.sha256, sizeBytes: dmg.size });
    problems.push(...b.problems);
    warnings.push(...b.warnings);
  }
  const assets = rel.assets ?? [];
  const names = assets.map((a) => a.name);
  if (!sameSet(names, ASSET_NAMES)) problems.push(`fichiers joints : ${names.join(", ") || "aucun"} (attendu : ${ASSET_NAMES.join(", ")})`);
  for (const a of assets) {
    const want = local[a.name];
    if (!want) continue;
    if (a.state !== "uploaded") problems.push(`${a.name} : état « ${a.state} »`);
    if (a.size !== want.size) problems.push(`${a.name} : ${a.size} octets en ligne, ${want.size} en local`);
    if (typeof a.digest === "string" && a.digest) {
      if (a.digest !== `sha256:${want.sha256}`) problems.push(`${a.name} : empreinte en ligne ${a.digest}, locale sha256:${want.sha256}`);
    } else {
      toDownload.push({ id: a.id, name: a.name });
    }
  }
  return { ok: problems.length === 0, problems, warnings, release: rel, toDownload };
}

/**
 * Runs du workflow de tests sur un commit : attendre, réussite ou échec ?
 * @param {Array<{ status: string, conclusion: string | null, event: string, databaseId?: number, url?: string }>} runs
 * @returns {{ state: "wait" | "ok" | "fail", detail: string }}
 */
export function evaluateTestRuns(runs) {
  const push = (Array.isArray(runs) ? runs : []).filter((r) => r && r.event === "push");
  if (!push.length) return { state: "wait", detail: "aucun run « push » pour ce commit" };
  const pending = push.filter((r) => r.status !== "completed");
  if (pending.length) return { state: "wait", detail: `${pending.length}/${push.length} run(s) en cours` };
  const bad = push.filter((r) => r.conclusion !== "success");
  if (bad.length) {
    return {
      state: "fail",
      detail: bad.map((r) => `run ${r.databaseId ?? "?"} : ${r.conclusion}${r.url ? ` (${r.url})` : ""}`).join(" ; "),
    };
  }
  return { state: "ok", detail: `${push.length} run(s) « push » terminé(s) et vert(s)` };
}

// ------------------------------------------------------------- outils
function say(level, title, message) {
  process.stdout.write(annotation(level, title, message) + "\n");
}

/**
 * Appel de la CLI gh : { code, stdout, stderr }. `stdoutFile` : sortie
 * binaire écrite dans ce fichier (téléchargement d'un fichier joint).
 * @param {string[]} args
 * @param {{ stdoutFile?: string | null, timeoutMs?: number }} [options]
 * @returns {{ code: number | null, stdout: string, stderr: string }}
 */
function ghSpawn(args, { stdoutFile = null, timeoutMs = 20 * 60 * 1000 } = {}) {
  let fd = null;
  try {
    if (stdoutFile) fd = fs.openSync(stdoutFile, "w");
    const r = spawnSync("gh", args, {
      encoding: "utf-8",
      maxBuffer: 64 * 1024 * 1024,
      timeout: timeoutMs,
      stdio: ["ignore", fd ?? "pipe", "pipe"],
    });
    return { code: r.status, stdout: r.stdout ?? "", stderr: (r.stderr ?? "") + (r.error ? `\n${r.error.message}` : "") };
  } finally {
    if (fd !== null) fs.closeSync(fd);
  }
}

function listReleases(repo, gh) {
  const all = [];
  for (let page = 1; page <= 20; page++) {
    const r = gh(["api", "-H", "Accept: application/vnd.github+json", `repos/${repo}/releases?per_page=100&page=${page}`]);
    if (r.code !== 0) throw new Error(`lecture des releases impossible (gh api, code ${r.code}) : ${tailLines(r.stderr, 5)}`);
    const list = JSON.parse(r.stdout);
    if (!Array.isArray(list)) throw new Error("réponse inattendue de l'API releases");
    all.push(...list);
    if (list.length < 100) break;
  }
  return all;
}

function readCollection(dir, version) {
  const names = fs.existsSync(dir)
    ? fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name)
    : [];
  const dmg = path.join(dir, DMG_NAME);
  const read = (n) => {
    try {
      return fs.readFileSync(path.join(dir, n), "utf-8");
    } catch {
      return "";
    }
  };
  const dmgSize = fs.existsSync(dmg) ? fs.statSync(dmg).size : 0;
  const dmgSha256 = dmgSize > 0 ? sha256File(dmg) : "";
  const result = checkCollection({
    names,
    sumsText: read(SUMS_NAME),
    dmgSha256,
    dmgSize,
    reportText: read(REPORT_NAME),
    version,
  });
  const sums = path.join(dir, SUMS_NAME);
  const local = {
    [DMG_NAME]: { size: dmgSize, sha256: dmgSha256 },
    [SUMS_NAME]: { size: fs.existsSync(sums) ? fs.statSync(sums).size : 0, sha256: fs.existsSync(sums) ? sha256File(sums) : "" },
  };
  return { ...result, dmg, sums, local };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Dépendances remplaçables par les tests : la CLI gh et l'attente. */
export const DEFAULT_DEPS = { gh: ghSpawn, sleep };

// --------------------------------------------------------- sous-commandes
async function cmdPublier(o, env, { gh, sleep }) {
  const repo = env.GH_REPO;
  if (!repo || !/^[^/\s]+\/[^/\s]+$/.test(repo)) throw new UsageError("GH_REPO (propriétaire/dépôt) est obligatoire");
  if (!o.dir) throw new UsageError("--dir est obligatoire");
  const meta = JSON.parse(fs.readFileSync(path.join(PROJECT, "version.json"), "utf-8"));
  const tag = o.tag ?? env.TAG ?? `v${meta.version}`;
  if (!/^v\d+\.\d+\.\d+$/.test(tag)) throw new UsageError(`tag invalide : ${tag}`);
  const version = tag.slice(1);
  const signature = env.SIGNATURE || "adhoc";
  if (!SIGNATURE_MODES.includes(signature)) throw new UsageError(`SIGNATURE inconnue : ${signature}`);
  const dry = !!o["dry-run"];
  const title = dry ? "Publication (à blanc)" : "Release en brouillon";

  // 1. Collection.
  const col = readCollection(path.resolve(o.dir), version);
  if (!col.ok) {
    say("error", title, `artefact refusé : ${col.problems.join(" ; ")}`);
    return 1;
  }
  const dmgSha = col.local[DMG_NAME].sha256;
  const dmgMo = formatMo(col.local[DMG_NAME].size);
  process.stdout.write(`[publier] collection OK : ${DMG_NAME} ${dmgMo} Mo, sha256 ${dmgSha}\n`);

  // 2. État.
  const releases = listReleases(repo, gh);
  process.stdout.write(`[publier] ${releases.length} release(s) lue(s), dont ${releases.filter((r) => r.draft).length} brouillon(s)\n`);

  // Texte de la Release, rendu UNE fois à partir du DMG local, de la
  // signature constatée et du commit : il sert à la création, à la réécriture
  // d'un brouillon complété et au constat.
  const commit = env.GITHUB_SHA || null;
  const releaseTitle = `JobScout ${version}`;
  const notesText = renderReleaseNotes({
    version,
    repo,
    sha256: dmgSha,
    sizeBytes: col.local[DMG_NAME].size,
    signature,
    commit,
    changelog: meta.version === version ? meta.changelog?.[version] ?? "" : "",
  });
  const expected = { body: notesText, title: releaseTitle, signature, commit };

  // 3. Décision.
  const d = decide({ tag, releases });
  if (dry) {
    const caveat = "jeton en lecture seule : les brouillons éventuels ne sont pas visibles d'ici";
    const what =
      d.action === "create"
        ? `créerait le brouillon « ${releaseTitle} » (${tag}) avec ${DMG_NAME} (${dmgMo} Mo, sha256 ${dmgSha}) et ${SUMS_NAME}`
        : d.action === "complete"
          ? `remplacerait ${ASSET_NAMES.join(" et ")} dans le brouillon ${tag}, puis réécrirait son titre et son texte (sha256 ${dmgSha}, signature ${signature})`
          : `refuserait : ${d.reason}`;
    say(d.action === "refuse" ? "warning" : "notice", title, `Sur le tag ${tag}, ce workflow ${what}. Releases lues : ${releases.length} (${caveat}).`);
    return 0;
  }
  if (d.action === "refuse") {
    say("error", title, d.reason);
    return 1;
  }
  const notes = path.join(env.RUNNER_TEMP || os.tmpdir(), `notes-${tag}.md`);
  fs.writeFileSync(notes, notesText, "utf-8");
  if (d.action === "create") {
    const r = gh(["release", "create", tag, "--repo", repo, "--draft", "--verify-tag", "--title", releaseTitle, "--notes-file", notes, col.dmg, col.sums]);
    if (r.code !== 0) {
      say("error", title, `gh release create a échoué (code ${r.code}) : ${tailLines(r.stderr, 8)}`);
      return 1;
    }
  } else {
    const r = gh(["release", "upload", tag, "--repo", repo, "--clobber", col.dmg, col.sums]);
    if (r.code !== 0) {
      say("error", title, `gh release upload a échoué (code ${r.code}) : ${tailLines(r.stderr, 8)}`);
      return 1;
    }
    // Le texte du brouillon décrit la construction précédente (empreinte,
    // taille, mode de signature, commit) : réécrit par l'identifiant de la
    // release, que « List releases » a donné (le tag seul peut ne pas voir un
    // brouillon). « draft » n'est pas envoyé : le brouillon reste un brouillon.
    const e = gh([
      "api", "-X", "PATCH", "-H", "Accept: application/vnd.github+json",
      `repos/${repo}/releases/${d.release.id}`,
      "-F", `body=@${notes}`,
      "-f", `name=${releaseTitle}`,
    ]);
    if (e.code !== 0) {
      say("error", title, `réécriture du texte du brouillon ${tag} impossible (gh api PATCH, code ${e.code}) : ${tailLines(e.stderr, 8)}`);
      return 1;
    }
  }
  process.stdout.write(`[publier] ${d.action === "create" ? "brouillon créé" : "brouillon complété, texte réécrit"} ; constat…\n`);

  // 4. Constat (l'API peut mettre quelques secondes à refléter l'envoi).
  let v = null;
  for (let attempt = 1; attempt <= 6; attempt++) {
    v = verifyRelease({ tag, releases: listReleases(repo, gh), local: col.local, notes: expected });
    if (v.ok) break;
    await sleep(5000);
  }
  if (!v || !v.ok) {
    say("error", title, `constat en échec : ${(v?.problems ?? ["release introuvable"]).join(" ; ")}`);
    return 1;
  }
  for (const w of v.warnings) say("warning", title, w);
  const how = {};
  for (const a of v.release.assets) how[a.name] = "empreinte relue dans l'API";
  for (const a of v.toDownload) {
    const tmp = path.join(env.RUNNER_TEMP || os.tmpdir(), `constat-${a.id}-${a.name}`);
    const r = gh(["api", "-H", "Accept: application/octet-stream", `repos/${repo}/releases/assets/${a.id}`], { stdoutFile: tmp });
    const got = r.code === 0 && fs.existsSync(tmp) ? sha256File(tmp) : null;
    try {
      fs.rmSync(tmp, { force: true });
    } catch {}
    if (got !== col.local[a.name].sha256) {
      say("error", title, `constat : ${a.name} retéléchargé ${got ? `sha256 ${got}` : `illisible (code ${r.code})`}, attendu ${col.local[a.name].sha256}`);
      return 1;
    }
    how[a.name] = "retéléchargé et recalculé";
  }
  say(
    "notice",
    title,
    `Brouillon ${tag} prêt, à publier à la main après l'essai sur un vrai Mac : ${v.release.html_url} — ` +
      `${DMG_NAME} ${dmgMo} Mo, sha256 ${dmgSha} (${how[DMG_NAME]}) ; ${SUMS_NAME} (${how[SUMS_NAME]}) ; signature ${signature} ; ` +
      `texte relu : même empreinte, même taille, même mode de signature${commit ? ", même commit" : ""}.`
  );
  return 0;
}

async function cmdAttendreTests(o, env, { gh, sleep }) {
  const repo = env.GH_REPO;
  if (!repo || !/^[^/\s]+\/[^/\s]+$/.test(repo)) throw new UsageError("GH_REPO (propriétaire/dépôt) est obligatoire");
  const sha = o.sha;
  if (!sha || !/^[0-9a-f]{7,40}$/i.test(sha)) throw new UsageError("--sha <commit> est obligatoire");
  const minutes = Number(o.minutes ?? 30);
  if (!(minutes > 0)) throw new UsageError("--minutes doit être positif");
  const workflow = o.workflow ?? "ci.yml";
  const title = `Tests (${workflow})`;
  const deadline = Date.now() + minutes * 60 * 1000;
  let last = "";
  for (;;) {
    const r = gh([
      "run", "list", "--repo", repo, "--workflow", workflow, "--commit", sha,
      "--json", "databaseId,status,conclusion,event,headBranch,createdAt,url", "--limit", "50",
    ]);
    if (r.code !== 0) {
      say("error", title, `gh run list a échoué (code ${r.code}) : ${tailLines(r.stderr, 5)}`);
      return 1;
    }
    const ev = evaluateTestRuns(JSON.parse(r.stdout || "[]"));
    if (ev.state === "ok") {
      say("notice", title, `commit ${sha.slice(0, 12)} : ${ev.detail}`);
      return 0;
    }
    if (ev.state === "fail") {
      say("error", title, `commit ${sha.slice(0, 12)} : ${ev.detail}`);
      return 1;
    }
    if (ev.detail !== last) process.stdout.write(`[publier] ${new Date().toISOString()} ${ev.detail}\n`);
    last = ev.detail;
    if (Date.now() > deadline) {
      say("error", title, `commit ${sha.slice(0, 12)} : délai de ${minutes} min dépassé (${ev.detail})`);
      return 1;
    }
    await sleep(30000);
  }
}

class UsageError extends Error {}

function parseArgs(argv) {
  const spec = { dir: "value", "dry-run": "flag", tag: "value", sha: "value", minutes: "value", workflow: "value" };
  const out = { cmd: argv[0] };
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    const eq = a.indexOf("=");
    const key = a.startsWith("--") ? (eq > 0 ? a.slice(2, eq) : a.slice(2)) : null;
    if (!key || !(key in spec)) throw new UsageError(`argument inconnu : ${a}`);
    if (spec[key] === "flag") out[key] = true;
    else {
      const v = eq > 0 ? a.slice(eq + 1) : argv[++i];
      if (v === undefined || v === "") throw new UsageError(`--${key} attend une valeur`);
      out[key] = v;
    }
  }
  return out;
}

/**
 * Point d'entrée (CLI et tests) : rend le code de sortie.
 * @param {string[]} argv
 * @param {Record<string, string | undefined>} [env]
 * @param {{ gh: typeof ghSpawn, sleep: (ms: number) => Promise<unknown> }} [deps]
 * @returns {Promise<number>}
 */
export async function main(argv, env = process.env, deps = DEFAULT_DEPS) {
  try {
    const o = parseArgs(argv);
    if (o.cmd === "publier") return await cmdPublier(o, env, deps);
    if (o.cmd === "attendre-tests") return await cmdAttendreTests(o, env, deps);
    throw new UsageError(`sous-commande inconnue : ${o.cmd ?? "(aucune)"}`);
  } catch (e) {
    if (e instanceof UsageError) {
      process.stderr.write(
        `[publier] ${e.message}\nusage : node installer/mac/publier.mjs publier --dir <dossier> [--dry-run] [--tag vX.Y.Z]\n` +
          "        node installer/mac/publier.mjs attendre-tests --sha <commit> [--minutes 30] [--workflow ci.yml]\n"
      );
      return 2;
    }
    say("error", "Publication", e instanceof Error ? e.message : String(e));
    return 1;
  }
}

const isMain = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) process.exitCode = await main(process.argv.slice(2));
