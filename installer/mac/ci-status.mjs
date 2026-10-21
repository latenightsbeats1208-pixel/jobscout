// ============================================================================
// installer/mac/ci-status.mjs — état de l'intégration continue, lisible
// depuis n'importe quel poste, sans compte ni jeton.
//
//   node installer/mac/ci-status.mjs <branche | sha> [options]
//        --workflow <nom ou fichier>   un seul workflow (ex. installeur-mac.yml)
//        --annotations auto|toutes|echecs|aucune
//              auto (défaut) : jobs du workflow installeur-mac + jobs en échec
//        --json                        sortie JSON
//        --out <fichier>               écrit le rapport dans ce fichier (UTF-8)
//
//   node installer/mac/ci-status.mjs annoter --fichier <journal> --titre <titre>
//        [--lignes 20] [--niveau error|warning|notice]
//        Publie la fin d'un journal en annotation GitHub (étapes en échec).
//
// Le dépôt est lu dans `git remote get-url origin` : son identifiant n'est
// écrit nulle part dans ce fichier. L'API publique de GitHub autorise
// 60 requêtes par heure sans jeton ; un rapport en coûte environ
// 2 + (nombre de runs) + (jobs annotés). Le solde restant est affiché.
//
// Les journaux complets d'Actions ne sont lisibles qu'avec un compte ; les
// annotations (::notice, ::warning, ::error) le sont sans : c'est par elles
// que les scripts de la chaîne Mac publient leurs mesures et leurs échecs.
//
// Tous les runs du commit comptent, quelle que soit leur branche (selectRuns) :
// un échec sur verif/… n'est pas masqué par la réussite du même workflow sur
// main, comme dans `publier.mjs attendre-tests`.
//
// Codes de sortie : 0 = tous les runs terminés et verts ; 1 = au moins un run
// en échec ; 2 = usage incorrect ou API illisible ; 3 = runs en cours, aucun
// échec à ce stade ; 4 = aucun run pour ce commit.
// ============================================================================
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.resolve(HERE, "..", "..");
const API = "https://api.github.com";

/** Fichier du workflow de l'installeur Mac (annotations lues par défaut). */
export const MAC_WORKFLOW_FILE = "installeur-mac.yml";

// ------------------------------------------------------------ annotations
/** Échappement d'un message d'annotation GitHub. */
export function escapeData(s) {
  return String(s).replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}

/** Échappement d'une propriété d'annotation (title=…). */
export function escapeProperty(s) {
  return escapeData(s).replace(/:/g, "%3A").replace(/,/g, "%2C");
}

/**
 * Ligne d'annotation : commande `::niveau title=…::message` sous GitHub
 * Actions, texte lisible ailleurs.
 * @param {"notice" | "warning" | "error"} level
 * @param {string} title
 * @param {string} message
 */
export function annotation(level, title, message, env = process.env) {
  if (env.GITHUB_ACTIONS === "true") return `::${level} title=${escapeProperty(title)}::${escapeData(message)}`;
  return `[${level}] ${title} : ${message}`;
}

/** Les `n` dernières lignes non vides d'un texte. */
export function tailLines(text, n = 15) {
  return String(text ?? "")
    .split(/\r?\n/)
    .filter((l) => l.trim() !== "")
    .slice(-n)
    .join("\n");
}

// ---------------------------------------------------------------- dépôt
/** « propriétaire/nom » d'une URL de remote GitHub (https ou ssh), ou null. */
export function parseRemote(url) {
  const m = /github\.com[/:]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/.exec(String(url ?? "").trim());
  return m ? { owner: m[1], repo: m[2] } : null;
}

function repoFromGit(cwd = PROJECT) {
  const url = execFileSync("git", ["remote", "get-url", "origin"], {
    cwd,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  const r = parseRemote(url);
  if (!r) throw new Error("le remote « origin » n'est pas un dépôt GitHub");
  return r;
}

// ------------------------------------------------------------------ API
class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const rate = { remaining: null, reset: null, calls: 0 };

async function api(pathname) {
  rate.calls++;
  let res;
  try {
    res = await fetch(`${API}/${pathname}`, {
      headers: {
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        "user-agent": "jobscout-ci-status",
      },
      signal: AbortSignal.timeout(30000),
    });
  } catch (e) {
    throw new ApiError(0, `API injoignable (${e instanceof Error ? e.message : String(e)})`);
  }
  const remaining = res.headers.get("x-ratelimit-remaining");
  if (remaining !== null) rate.remaining = Number(remaining);
  const reset = res.headers.get("x-ratelimit-reset");
  if (reset !== null) rate.reset = Number(reset);
  if (!res.ok) {
    let msg = "";
    try {
      msg = (await res.json()).message ?? "";
    } catch {}
    if ((res.status === 403 || res.status === 429) && rate.remaining === 0) {
      const at = rate.reset ? new Date(rate.reset * 1000).toLocaleTimeString("fr-FR") : "?";
      throw new ApiError(res.status, `quota de l'API publique épuisé (60 requêtes par heure), réessayez après ${at}`);
    }
    throw new ApiError(res.status, `HTTP ${res.status} sur ${pathname}${msg ? ` : ${msg}` : ""}`);
  }
  return res.json();
}

async function resolveCommit(base, target) {
  if (/^[0-9a-f]{40}$/i.test(target)) return { sha: target.toLowerCase(), label: "commit" };
  if (/^[0-9a-f]{7,39}$/i.test(target)) {
    const c = await api(`${base}/commits/${target}`);
    return { sha: c.sha, label: "commit" };
  }
  // Formes documentées de « Get a commit » : heads/<branche>, tags/<tag>
  // (une branche verif/… contient des « / »).
  for (const [kind, label] of [["heads", "branche"], ["tags", "tag"]]) {
    try {
      const c = await api(`${base}/commits/${kind}/${encodeURI(target)}`);
      return { sha: c.sha, label: `${label} ${target}` };
    } catch (e) {
      if (!(e instanceof ApiError) || (e.status !== 404 && e.status !== 422)) throw e;
    }
  }
  throw new ApiError(404, `ni branche ni tag « ${target} » dans le dépôt`);
}

// ------------------------------------------------------------- synthèse
const STATE_FR = {
  success: "OK",
  failure: "ÉCHEC",
  cancelled: "ANNULÉ",
  skipped: "IGNORÉ",
  timed_out: "DÉLAI DÉPASSÉ",
  action_required: "ACTION REQUISE",
  neutral: "NEUTRE",
  startup_failure: "ÉCHEC AU DÉMARRAGE",
  stale: "PÉRIMÉ",
};

/** Libellé d'état d'un run ou d'un job (status + conclusion de l'API). */
export function stateLabel(status, conclusion) {
  if (status !== "completed") return status === "queued" || status === "waiting" || status === "pending" ? "EN ATTENTE" : "EN COURS";
  return STATE_FR[conclusion] ?? String(conclusion ?? "?").toUpperCase();
}

const OK_CONCLUSIONS = new Set(["success", "skipped", "neutral"]);

/**
 * Code de sortie d'un ensemble de runs (voir l'en-tête).
 * @param {Array<{ status: string, conclusion: string | null }>} runs
 */
export function exitCodeFor(runs) {
  if (!runs.length) return 4;
  if (runs.some((r) => r.status === "completed" && !OK_CONCLUSIONS.has(r.conclusion ?? ""))) return 1;
  if (runs.some((r) => r.status !== "completed")) return 3;
  return 0;
}

/**
 * Runs à rapporter : ceux du workflow demandé (tous si `workflow` est nul),
 * TOUS gardés, triés par nom puis par date de création. Une relance garde
 * l'identifiant de son run et l'API n'en liste que la dernière tentative :
 * deux runs du même workflow sur ce commit (branche verif/…, puis main
 * avancé sur le même commit) sont donc deux runs distincts, et un échec sur
 * l'un n'est jamais masqué par la réussite de l'autre — même règle que
 * `attendre-tests` (publier.mjs), qui exige que tous les runs « push » soient
 * verts. Seul un doublon d'identifiant est écarté.
 * @param {any[]} runs
 * @param {string | null} [workflow] nom ou fichier du workflow
 */
export function selectRuns(runs, workflow = null) {
  let list = Array.isArray(runs) ? runs.filter(Boolean) : [];
  if (workflow) {
    const w = workflow.toLowerCase();
    list = list.filter((r) => String(r.name ?? "").toLowerCase() === w || String(r.path ?? "").toLowerCase().endsWith(w));
  }
  const seen = new Set();
  list = list.filter((r) => {
    if (r.id === undefined || r.id === null) return true;
    if (seen.has(r.id)) return false;
    seen.add(r.id);
    return true;
  });
  const time = (r) => {
    const t = Date.parse(r.created_at);
    return Number.isFinite(t) ? t : 0;
  };
  return [...list].sort((a, b) => String(a.name).localeCompare(String(b.name)) || time(a) - time(b));
}

function duration(start, end) {
  if (!start) return "";
  const s = Math.max(0, Math.round(((end ? Date.parse(end) : Date.now()) - Date.parse(start)) / 1000));
  return s >= 60 ? `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, "0")} s` : `${s} s`;
}

function wantsAnnotations(mode, run, job) {
  if (mode === "aucune") return false;
  if (mode === "toutes") return true;
  const failed = job.status === "completed" && !OK_CONCLUSIONS.has(job.conclusion ?? "");
  if (mode === "echecs") return failed;
  return failed || String(run.path ?? "").endsWith(MAC_WORKFLOW_FILE);
}

async function collect({ owner, repo }, target, { workflow = null, annotations = "auto" } = {}) {
  const base = `repos/${owner}/${repo}`;
  const commit = await resolveCommit(base, target);
  const data = await api(`${base}/actions/runs?head_sha=${commit.sha}&per_page=50`);
  const runs = selectRuns(data.workflow_runs ?? [], workflow);
  const out = [];
  for (const r of runs) {
    const jobsData = await api(`${base}/actions/runs/${r.id}/jobs?per_page=100&filter=latest`);
    const jobs = [];
    for (const j of jobsData.jobs ?? []) {
      let notes = [];
      if (wantsAnnotations(annotations, r, j) && j.status === "completed") {
        try {
          const list = await api(`${base}/check-runs/${j.id}/annotations?per_page=50`);
          notes = list.map((a) => ({ level: a.annotation_level, title: a.title ?? "", message: a.message ?? "" }));
        } catch (e) {
          notes = [{ level: "erreur de lecture", title: "", message: e instanceof Error ? e.message : String(e) }];
        }
      }
      const failedStep = (j.steps ?? []).find((s) => s.conclusion === "failure");
      jobs.push({
        id: j.id,
        name: j.name,
        status: j.status,
        conclusion: j.conclusion,
        duration: duration(j.started_at, j.completed_at),
        failedStep: failedStep ? failedStep.name : null,
        url: j.html_url,
        annotations: notes,
      });
    }
    out.push({
      id: r.id,
      name: r.name,
      path: r.path,
      event: r.event,
      branch: r.head_branch,
      status: r.status,
      conclusion: r.conclusion,
      attempt: r.run_attempt,
      url: r.html_url,
      jobs,
    });
  }
  return { repo: `${owner}/${repo}`, target, commit: commit.sha, label: commit.label, runs: out };
}

/** Rapport texte (voir collect). */
export function formatReport(report) {
  const lines = [];
  lines.push(`Dépôt ${report.repo} — ${report.label === "commit" ? "" : `${report.label} — `}commit ${report.commit.slice(0, 12)}`);
  if (!report.runs.length) lines.push("Aucun run d'Actions pour ce commit (pas encore poussé, ou workflow non déclenché).");
  for (const r of report.runs) {
    lines.push("");
    lines.push(
      `${r.name} (${r.event}${r.branch ? `, ${r.branch}` : ""}${r.attempt > 1 ? `, tentative ${r.attempt}` : ""}) : ` +
        `${stateLabel(r.status, r.conclusion)} — ${r.url}`
    );
    for (const j of r.jobs) {
      lines.push(
        `  ${stateLabel(j.status, j.conclusion).padEnd(9)} ${j.name}${j.duration ? ` (${j.duration})` : ""}` +
          (j.failedStep ? ` — étape en échec : « ${j.failedStep} »` : "")
      );
      for (const a of j.annotations) {
        const msg = String(a.message).replace(/\r?\n/g, "\n" + " ".repeat(16));
        lines.push(`      [${a.level}]${a.title ? ` ${a.title} :` : ""} ${msg}`);
      }
    }
  }
  return lines.join("\n") + "\n";
}

// ------------------------------------------------------------------- CLI
function parseOptions(argv, spec) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) {
      out._.push(a);
      continue;
    }
    const eq = a.indexOf("=");
    const key = eq > 0 ? a.slice(2, eq) : a.slice(2);
    if (!(key in spec)) throw new Error(`option inconnue : --${key}`);
    if (spec[key] === "flag") {
      out[key] = true;
      continue;
    }
    const val = eq > 0 ? a.slice(eq + 1) : argv[++i];
    if (val === undefined || val === "") throw new Error(`--${key} attend une valeur`);
    out[key] = val;
  }
  return out;
}

function annoter(argv) {
  const o = parseOptions(argv, { fichier: "value", titre: "value", lignes: "value", niveau: "value" });
  if (!o.fichier || !o.titre) throw new Error("annoter : --fichier et --titre sont obligatoires");
  const level = o.niveau ?? "error";
  if (!["error", "warning", "notice"].includes(level)) throw new Error(`niveau inconnu : ${level}`);
  const n = Math.max(1, Math.min(200, Number(o.lignes ?? 20) || 20));
  let text;
  try {
    text = fs.readFileSync(o.fichier, "utf-8");
  } catch {
    process.stdout.write(annotation(level, o.titre, `journal absent : ${o.fichier}`) + "\n");
    return 0;
  }
  // Les annotations sont publiques : pas plus de ~4 000 caractères.
  const tail = tailLines(text, n).slice(-4000);
  process.stdout.write(annotation(level, o.titre, tail || "(journal vide)") + "\n");
  return 0;
}

async function main(argv) {
  if (argv[0] === "annoter") {
    try {
      return annoter(argv.slice(1));
    } catch (e) {
      process.stderr.write(`[ci] ${e.message}\n`);
      return 2;
    }
  }
  let o;
  try {
    o = parseOptions(argv, { workflow: "value", annotations: "value", json: "flag", out: "value" });
    if (o._.length !== 1) throw new Error("un argument attendu : <branche | sha>");
    if (o.annotations && !["auto", "toutes", "echecs", "aucune"].includes(o.annotations)) {
      throw new Error(`--annotations : auto, toutes, echecs ou aucune (reçu ${o.annotations})`);
    }
  } catch (e) {
    process.stderr.write(
      `[ci] ${e.message}\nusage : node installer/mac/ci-status.mjs <branche | sha> [--workflow <nom>] ` +
        "[--annotations auto|toutes|echecs|aucune] [--json] [--out <fichier>]\n" +
        "        node installer/mac/ci-status.mjs annoter --fichier <journal> --titre <titre> [--lignes 20]\n"
    );
    return 2;
  }
  let report;
  try {
    report = await collect(repoFromGit(), o._[0], { workflow: o.workflow ?? null, annotations: o.annotations ?? "auto" });
  } catch (e) {
    process.stderr.write(`[ci] ÉCHEC : ${e instanceof Error ? e.message : String(e)}\n`);
    return 2;
  }
  const code = exitCodeFor(report.runs);
  const text = o.json
    ? JSON.stringify({ ...report, exitCode: code, api: { calls: rate.calls, remaining: rate.remaining } }, null, 2) + "\n"
    : formatReport(report) + `\n[API publique : ${rate.calls} requêtes, solde ${rate.remaining ?? "?"} pour l'heure — code ${code}]\n`;
  if (o.out) {
    fs.writeFileSync(o.out, text, "utf-8");
    process.stdout.write(`[ci] rapport écrit dans ${o.out} (code ${code})\n`);
  } else process.stdout.write(text);
  return code;
}

const isMain = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) process.exitCode = await main(process.argv.slice(2));
