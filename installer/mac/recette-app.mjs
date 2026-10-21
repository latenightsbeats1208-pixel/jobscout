// ============================================================================
// installer/mac/recette-app.mjs — contrôles de l'APPLICATION servie, partagés
// par la recette Mac (test-install-mac.mjs).
//
// Repris de installer/test-install.mjs (contrôles 4 à 7 de la recette
// Windows) et complétés : communes, balayage de toutes les routes du
// manifeste, erreurs d'écriture (EROFS, EACCES, EPERM), modèles OCR.
//
// Uniquement des modules node: (node:sqlite compris). Aucune dépendance npm :
// la recette tourne sans npm ci. Module sans effet de bord à l'import.
//
// Les assertions portent sur des codes et des valeurs exactes, jamais sur un
// texte qu'un message d'échec pourrait aussi contenir.
// ============================================================================
import fs from "node:fs";
import nodeHttp from "node:http";
import net from "node:net";
import path from "node:path";

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Attend que `fn()` renvoie une valeur vraie.
 * @returns {Promise<boolean>} faux si le délai est dépassé
 */
export async function waitFor(fn, timeoutMs, everyMs = 500) {
  const until = Date.now() + timeoutMs;
  for (;;) {
    if (await fn()) return true;
    if (Date.now() >= until) return false;
    await sleep(everyMs);
  }
}

/**
 * Requête HTTP par node:http : aucune redirection suivie, aucun en-tête
 * ajouté (pas de Sec-Fetch-*), le corps est toujours lu (sauf `headOnly`).
 * @param {string} url
 * @param {{ method?: string, headers?: Record<string, string>, body?: string,
 *           timeoutMs?: number, headOnly?: boolean }} [options]
 * @returns {Promise<{ status: number, location: string | null, text: string, json: any, error: string | null }>}
 */
export function http(url, { method = "GET", headers = {}, body, timeoutMs = 20000, headOnly = false } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    /** @type {NodeJS.Timeout | null} */
    let timer = null;
    const done = (r) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(r);
    };
    const fail = (msg) => done({ status: 0, location: null, text: "", json: null, error: msg });
    const payload = body === undefined ? null : Buffer.from(body, "utf-8");
    const h = { ...headers };
    if (payload) h["content-length"] = String(payload.length);
    let req;
    try {
      req = nodeHttp.request(url, { method, headers: h, agent: false }, (res) => {
        const status = res.statusCode ?? 0;
        const location = typeof res.headers.location === "string" ? res.headers.location : null;
        if (headOnly) {
          res.destroy();
          return done({ status, location, text: "", json: null, error: null });
        }
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf-8");
          let json = null;
          try {
            json = JSON.parse(text);
          } catch {}
          done({ status, location, text, json, error: null });
        });
        res.on("error", (e) => fail(e.message));
      });
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e));
    }
    timer = setTimeout(() => {
      req.destroy();
      fail(`délai de ${timeoutMs} ms dépassé`);
    }, timeoutMs);
    req.on("error", (e) => fail(e.message));
    if (payload) req.write(payload);
    req.end();
  });
}

/** POST JSON (UTF-8). `origin` : en-tête Origin, comme un navigateur. */
export function postJson(url, data, { origin } = {}) {
  const headers = { "content-type": "application/json; charset=utf-8" };
  if (origin) headers.origin = origin;
  return http(url, { method: "POST", headers, body: JSON.stringify(data) });
}

/** Chemin d'une redirection (Location relative ou absolue), ou null. */
export function redirectPath(res, base) {
  if (!res.location) return null;
  try {
    return new URL(res.location, base).pathname;
  } catch {
    return null;
  }
}

/**
 * État d'un port TCP local.
 * @returns {Promise<"ouvert" | "fermé" | "injoignable">}
 */
export function portState(port, host = "127.0.0.1", timeoutMs = 2000) {
  return new Promise((resolve) => {
    const sock = net.connect({ host, port });
    const done = (state) => {
      sock.removeAllListeners();
      sock.destroy();
      resolve(state);
    };
    sock.setTimeout(timeoutMs, () => done("injoignable"));
    sock.once("connect", () => done("ouvert"));
    sock.once("error", (e) => done(/** @type {any} */ (e).code === "ECONNREFUSED" ? "fermé" : "injoignable"));
  });
}

/** Premier port de la liste où rien n'écoute, ou null. */
export async function freePort(candidates) {
  for (const p of candidates) if ((await portState(p)) === "fermé") return p;
  return null;
}

/** Profil de recette : accents dans le JSON, aucune donnée réelle. */
export const RECETTE_PROFILE = {
  full_name: "Profil de recette",
  email: "recette@example.test",
  phone: null,
  location: "Évry, Île-de-France",
  linkedin_url: null,
  portfolio_url: null,
  summary: "Profil éphémère créé par la recette d'installation.",
  raw_cv_text: "Responsable d'entrepôt — gestion des stocks, expéditions.",
  sectors: ["Logistique", "Supply chain"],
  target_countries: ["France"],
  sources_enabled: ["apec", "hellowork"],
  preferred_contracts: ["cdi", "cdd"],
  extraction_confidence: 90,
  experiences: [
    {
      title: "Responsable d'entrepôt",
      company: "Entrepôts de l'Étoile",
      location: "Évry",
      start_date: "2020-03",
      end_date: null,
      description: "Gestion des stocks et des expéditions.",
      bullet_points: ["Réorganisation des stocks", "Réduction de 15 % des délais d'expédition"],
      skills_used: ["Gestion des stocks"],
    },
  ],
  educations: [
    {
      school: "Université d'Évry",
      degree: "Licence professionnelle",
      field: "Logistique",
      location: "Évry",
      start_date: "2020-09",
      end_date: "2022-06",
      description: null,
    },
  ],
  skills: [{ name: "Rédaction", category: "soft", evidence_experience_ids: [] }],
  languages: [{ name: "Français", level: "Natif" }],
};

/** Textes du profil relus après l'enregistrement (accents compris). */
export const PROFILE_MARKERS = ["Entrepôts de l'Étoile", "Île-de-France"];

/** Le profil de recette est-il dans cette réponse ? */
export function hasRecetteProfile(text) {
  return PROFILE_MARKERS.every((m) => String(text ?? "").includes(m));
}

/**
 * Lignes des tables utilisateur, lues par node:sqlite en lecture seule.
 * @returns {Promise<{ ok: boolean, profile: number, offres: number, documents: number, detail: string }>}
 */
export async function countRows(dbFile) {
  const { DatabaseSync } = await import("node:sqlite");
  let lastError = "";
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const db = new DatabaseSync(dbFile, { readOnly: true });
      try {
        const n = (table) => Number(/** @type {any} */ (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()).n);
        const c = { profile: n("profile"), offres: n("offres"), documents: n("documents") };
        return { ok: true, ...c, detail: `profil=${c.profile} offres=${c.offres} documents=${c.documents}` };
      } finally {
        db.close();
      }
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
      await sleep(500);
    }
  }
  return { ok: false, profile: -1, offres: -1, documents: -1, detail: lastError };
}

/** Avertissements connus et inoffensifs (voir test-install.mjs). */
export const BENIGN_ERRORS = [/Cannot find module '@napi-rs\/canvas'/];

/** Lignes « Error: » d'un journal, hors avertissements connus. */
export function errorLines(text) {
  return (String(text ?? "").match(/Error:[^\n]*/g) ?? []).filter((l) => !BENIGN_ERRORS.some((re) => re.test(l)));
}

/** Lignes qui signalent une écriture refusée (volume en lecture seule, droits). */
export function fsDeniedLines(text) {
  return String(text ?? "")
    .split(/\r?\n/)
    .filter((l) => /\b(EROFS|EACCES|EPERM)\b/.test(l));
}

/** Modèles WebAssembly de tesseract.js-core présents dans l'app (OCR). */
export function tesseractWasm(appDir) {
  const dir = path.join(appDir, "node_modules", "tesseract.js-core");
  try {
    return fs.readdirSync(dir).filter((n) => n.endsWith(".wasm"));
  } catch {
    return [];
  }
}

/**
 * Charge chaque route une fois ; 4xx est normal (méthode, paramètre), 5xx ou
 * absence de réponse signale un module manquant ou une route cassée.
 * Les corps sont abandonnés dès les en-têtes (/api/scan/start est un flux).
 * @param {string} base
 * @param {string[]} routes
 * @returns {Promise<{ count: number, broken: string[] }>}
 */
export async function sweepRoutes(base, routes) {
  const broken = [];
  for (const route of routes) {
    const r = await http(base + route, { headOnly: true, timeoutMs: 20000 });
    if (r.status === 0 || r.status >= 500) broken.push(`${route} → ${r.status || `pas de réponse (${r.error})`}`);
  }
  return { count: routes.length, broken };
}

/**
 * Contrôles de l'application sur une base VIERGE, dans l'ordre :
 * onboarding, IA non configurée, version, base vierge, moteur absent,
 * communes, balayage des routes (avant tout profil : /api/scan/start ne lance
 * alors aucun scan), profil accentué, pages, version affichée, erreurs.
 *
 * @param {{ base: string, version: string, dataDir: string, appDir: string,
 *           routes: string[], readLog: () => string,
 *           check: (id: string, label: string, ok: boolean, detail?: string) => boolean,
 *           warn: (id: string, label: string, detail?: string) => void,
 *           prefix?: string }} ctx
 * @returns {Promise<{ routes: number, sweepMs: number }>}
 */
export async function runAppChecks({ base, version, dataDir, appDir, routes, readLog, check, warn, prefix = "C" }) {
  let n = 0;
  const id = () => `${prefix}.${++n}`;

  const root = await http(base + "/");
  check(id(), "« / » sur base vierge : 307 vers /onboarding", root.status === 307 && redirectPath(root, base) === "/onboarding", `HTTP ${root.status} → ${root.location}`);
  const onboarding = await http(base + "/onboarding/upload");
  check(id(), "/onboarding/upload : 200 et carte de configuration IA", onboarding.status === 200 && onboarding.text.includes('data-testid="ai-settings"'), `HTTP ${onboarding.status}`);

  const llm = await http(base + "/api/settings/llm");
  const lj = llm.json ?? {};
  check(id(), "IA non configurée : configured=false, mode=unset, quota=null", llm.status === 200 && lj.configured === false && lj.mode === "unset" && lj.quota === null, `HTTP ${llm.status} — mode=${lj.mode} configured=${lj.configured}`);
  check(id(), "IA non configurée : aucune clé renvoyée (ni JSC-, ni sk-ant-)", llm.status === 200 && !/JSC-[A-Z0-9]{8,}|sk-ant-/.test(llm.text));

  const upd = await http(base + "/api/update");
  check(id(), `/api/update : current = ${version}`, upd.status === 200 && upd.json?.current === version, `HTTP ${upd.status} — current=${upd.json?.current}`);

  const blank = await countRows(path.join(dataDir, "jobscout.db"));
  check(id(), "base vierge : 0 profil, 0 offre, 0 document", blank.ok && blank.profile === 0 && blank.offres === 0 && blank.documents === 0, blank.detail);
  const eng = await http(base + "/api/engine");
  check(id(), "/api/engine : installed=false (rien téléchargé)", eng.status === 200 && eng.json?.installed === false, `HTTP ${eng.status} — installed=${eng.json?.installed}`);

  // Communes (base embarquée lib/geo/data, aucun appel extérieur).
  const lyon = await http(base + "/api/geo/communes?q=lyon");
  const l0 = lyon.json?.communes?.[0];
  check(id(), "/api/geo/communes?q=lyon : 1re commune 69123 « Lyon (69) »", lyon.status === 200 && l0?.code === "69123" && l0?.label === "Lyon (69)", `HTTP ${lyon.status} — ${l0 ? `${l0.code} ${l0.label}` : "aucune"}`);
  const paris = await http(base + "/api/geo/communes?q=Paris");
  const pc = paris.json?.communes ?? [];
  check(id(), "/api/geo/communes?q=Paris : contient 75056", paris.status === 200 && pc.some((c) => c.code === "75056"), `HTTP ${paris.status} — ${pc.map((c) => c.code).join(", ")}`);
  const evry = await http(base + "/api/geo/communes?q=91000");
  const ec = evry.json?.communes ?? [];
  check(id(), "/api/geo/communes?q=91000 : 91228 avec « Évry » dans le libellé", evry.status === 200 && ec.some((c) => c.code === "91228" && String(c.label).includes("Évry")), `HTTP ${evry.status} — ${ec.map((c) => `${c.code} ${c.label}`).join(", ")}`);

  // Balayage du manifeste, base sans profil. Les erreurs que ces appels
  // provoquent volontairement (paramètres absents) sont hors du contrôle
  // « aucune ligne Error: » : on note où le balayage commence et finit.
  const sweepStart = readLog().length;
  const t0 = Date.now();
  const sweep = await sweepRoutes(base, routes);
  const sweepMs = Date.now() - t0;
  const sweepEnd = readLog().length;
  check(id(), `balayage du manifeste : ${sweep.count} routes, aucune réponse 5xx`, sweep.count > 0 && sweep.broken.length === 0, sweep.broken.slice(0, 8).join(" | ") || `${(sweepMs / 1000).toFixed(1)} s`);

  const post = await postJson(base + "/api/profile", RECETTE_PROFILE);
  check(id(), "POST /api/profile (JSON accentué) : 200", post.status === 200, `HTTP ${post.status}`);
  check(id(), "base créée dans le dossier de données", fs.existsSync(path.join(dataDir, "jobscout.db")), path.join(dataDir, "jobscout.db"));
  check(id(), "aucune base dans l'application", !fs.existsSync(path.join(appDir, "data", "jobscout.db")));
  const reread = await http(base + "/api/profile");
  check(id(), "profil relu intact (« Entrepôts de l'Étoile », « Île-de-France »)", reread.status === 200 && hasRecetteProfile(reread.text), `HTTP ${reread.status}`);

  for (const p of ["/dashboard", "/offres", "/candidatures", "/documents", "/profile"]) {
    const r = await http(base + p, { timeoutMs: 60000 });
    check(id(), `page ${p} : 200`, r.status === 200, `HTTP ${r.status}`);
  }
  const after = await http(base + "/");
  check(id(), "« / » après l'onboarding : 307 vers /dashboard", after.status === 307 && redirectPath(after, base) === "/dashboard", `HTTP ${after.status} → ${after.location}`);
  const dash = await http(base + "/dashboard");
  check(id(), `« JobScout v${version} » affiché`, dash.status === 200 && dash.text.includes(`JobScout v${version}`));

  const log = readLog();
  const outside = log.slice(0, sweepStart) + log.slice(sweepEnd);
  const errors = errorLines(outside);
  const inSweep = errorLines(log.slice(sweepStart, sweepEnd));
  check(id(), "aucune ligne « Error: » hors @napi-rs/canvas (hors balayage)", errors.length === 0, errors.slice(0, 3).join(" | ") || `${inSweep.length} ligne(s) pendant le balayage, attendues`);

  const wasm = tesseractWasm(appDir);
  if (!wasm.length) warn(id(), "OCR : aucun .wasm de tesseract.js-core dans l'app (lecture des CV en image indisponible)", "lot à part");
  else n++;
  return { routes: sweep.count, sweepMs };
}
