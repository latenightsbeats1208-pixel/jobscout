import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProgressEvent, Scraper } from "@/lib/scrapers/base";
import { getDb, getSetting, setSetting } from "@/lib/db";
import { createCandidature, listCandidatures } from "@/lib/db/candidatures";
import { getOffre, listOffres, searchOffres, upsertOffreFromSource, type ScrapedOffre } from "@/lib/db/offres";
import { HTML_ENTITIES_REPAIR_KEY, readHtmlEntitiesRepair, registerCurrentScanRun } from "@/lib/db/repair-entities";
import {
  ensureEscapedMarkupRepaired,
  ensureOffresRepaired,
  ESCAPED_MARKUP_REPAIR_KEY,
  readEscapedMarkupRepair,
  repairEscapedMarkup,
} from "@/lib/db/repair-markup";
import { cleanOffreDescriptionText } from "@/lib/offres/clean-text";
import { descriptionTextFromHtml } from "@/lib/offres/escaped-markup";
import { htmlToText } from "@/lib/scrapers/base";
import { dbPath } from "@/lib/paths";
import { scoreOffreLocal } from "@/lib/scoring/local";
import { profile } from "./fixtures";
import { LATENT_CASES, LEGIT_CASES, STORED_CASES } from "./markup-cases";

/**
 * Balisage affiché en clair dans les offres déjà en base : réparation unique
 * (sélection par contenu, marque dans settings, transaction, après la réparation des
 * entités, re-score, attente d'un scan de l'ancien code), ses déclencheurs, et un nouveau
 * scan qui réécrit exactement ce que la réparation a produit.
 * Base SQLite temporaire (tests/setup.ts), offres fictives, scrapers remplacés.
 */

const LITERAL_TAG_RE = /<[A-Za-z/]/;

const scan = vi.hoisted(() => ({ offres: [] as ScrapedOffre[], noProfile: false, apecAvailable: false }));

// L'APEC est suspendue (jamais interrogée par un vrai scan) ; le test « runScan, source APEC »
// lève la suspension pour vérifier que le scan transmet sa source au filet : seule l'APEC
// tire son texte autrement (textContent), c'est donc elle qui distingue les sources.
vi.mock("@/lib/sources-meta", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/sources-meta")>();
  return {
    ...actual,
    sourceUnavailable: (id: string) => (scan.apecAvailable && id === "apec" ? false : actual.sourceUnavailable(id)),
  };
});

vi.mock("@/lib/db/queries", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db/queries")>()),
  getProfile: () => (scan.noProfile ? null : profile),
}));

vi.mock("@/lib/scrapers/registry", () => ({
  VALID_SOURCES: ["talent", "apec"],
  getEnabledScrapers: (ids: string[]) =>
    ids.map((id): Scraper => ({
      name: id,
      async *scrape(_criteria, onEvent: (e: ProgressEvent) => void) {
        onEvent({ kind: "start", source: id });
        for (const o of scan.offres) yield o;
        onEvent({ kind: "done", source: id, seen: scan.offres.length, ok: scan.offres.length, failed: 0 });
      },
    })),
}));

let seq = 0;
function scraped(over: Partial<ScrapedOffre> = {}): ScrapedOffre {
  seq++;
  return {
    source_id: `m-${seq}`,
    url: `https://example.org/offre/${seq}`,
    title: `Poste ${seq}`,
    company: "Entreprise Exemple",
    country: "France",
    location: "Lyon",
    contract_type: "CDI",
    salary: null,
    description_html: "<p>Description</p>",
    description_text: "Description du poste en CDI.",
    description_status: "ok",
    posted_at: "2026-01-15",
    is_vie: false,
    raw_payload: {},
    ...over,
  };
}

/** Texte tel qu'un scan l'aurait enregistré pour ce HTML (dérivation de la source, puis filet des entités). */
const storedText = (source: string, html: string) => cleanOffreDescriptionText(descriptionTextFromHtml(source, html));

/** Offre écrite telle quelle, sans le filet (comme une offre enregistrée avant ce correctif). */
function insertRaw(source: string, o: Partial<ScrapedOffre>): number {
  const s = scraped({ ...o, description_text: o.description_text ?? storedText(source, o.description_html ?? "<p>Description</p>") });
  const r = getDb().prepare(`
    INSERT INTO offres (source, source_id, url, title, company, country, location, contract_type, salary,
      description_html, description_text, description_status, posted_at, score, is_vie, raw_payload)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ok', ?, 42, 0, '{}')
  `).run(source, s.source_id, s.url, s.title, s.company, s.country, s.location, s.contract_type, s.salary,
    s.description_html, s.description_text, s.posted_at);
  return Number(r.lastInsertRowid);
}

const row = (id: number) => ({ ...(getDb().prepare("SELECT * FROM offres WHERE id = ?").get(id) as Record<string, unknown>) });
const allRows = () => getDb().prepare("SELECT * FROM offres ORDER BY id").all().map((r) => ({ ...r })) as Record<string, unknown>[];
type State = { done: boolean; retryAt: number; ownScanRuns?: number[] };
const G = globalThis as typeof globalThis & { __jobscoutHtmlEntitiesRepairV1?: State; __jobscoutEscapedMarkupRepairV1?: State };
/** État de la réparation du balisage, relu à chaque appel (le test le supprime). */
const markupState = () => G.__jobscoutEscapedMarkupRepairV1;

/** Score local de l'offre telle qu'elle est en base, au format de setOffreScore. */
function localScore(id: number) {
  const o = row(id) as { title: string; company: string; country: string | null; description_text: string; contract_type: string | null };
  const r = scoreOffreLocal(profile, {
    title: o.title, company: o.company, country: o.country, description_text: o.description_text, contract_type: o.contract_type,
  });
  return { score: r.score, score_breakdown: JSON.stringify({ ...r.breakdown, reason: r.reason }) };
}

/** Ligne scan_runs « running » (scan de l'ancien code tant qu'elle n'est pas enregistrée). */
function insertRun(): number {
  return Number(getDb().prepare("INSERT INTO scan_runs (status) VALUES ('running')").run().lastInsertRowid);
}

/** Base sans marque, état « jamais vérifié » ; `entitiesDone` : réparation des entités déjà faite (base déjà passée par celle-ci). */
function resetRepairs(entitiesDone = true) {
  const db = getDb();
  db.prepare("DELETE FROM settings WHERE key IN (?, ?)").run(HTML_ENTITIES_REPAIR_KEY, ESCAPED_MARKUP_REPAIR_KEY);
  delete G.__jobscoutHtmlEntitiesRepairV1;
  delete G.__jobscoutEscapedMarkupRepairV1;
  if (entitiesDone) setSetting(HTML_ENTITIES_REPAIR_KEY, JSON.stringify({ at: "2026-01-01T00:00:00.000Z", ids: [], fields: {}, rescored: 0 }));
}

/** Formes stockées en miniature, puis des offres légitimes ou propres. */
function seed() {
  const stored = STORED_CASES.map((c) => insertRaw(c.source, { description_html: c.html }));
  const legit = LEGIT_CASES.map(([, html], i) => insertRaw(["talent", "wttj", "apec", "linkedin"][i % 4], { description_html: html }));
  const clean = insertRaw("hellowork", { description_html: "<p>Poste en CDI à Lyon, équipe produit.</p>" });
  return { stored, legit, clean };
}

beforeEach(() => {
  const db = getDb();
  db.exec("DELETE FROM candidatures");
  db.exec("DELETE FROM documents");
  db.exec("DELETE FROM offres");
  db.exec("DELETE FROM scan_runs");
  scan.noProfile = false;
  scan.apecAvailable = false;
  scan.offres = [];
  resetRepairs();
});

describe("repairEscapedMarkup — offres enregistrées avant ce correctif", () => {
  it("répare les offres en miniature (formes stockées) et elles seules : HTML, texte re-dérivé, score, marque", () => {
    const ids = seed();
    const before = new Map(allRows().map((r) => [r.id as number, r]));
    // Garde-fou du test : ces offres affichent bien des balises en clair dans leur texte.
    for (const id of ids.stored) expect(row(id).description_text).toMatch(LITERAL_TAG_RE);

    const result = repairEscapedMarkup()!;
    expect(result.ids).toEqual(ids.stored);
    expect(result.fields).toEqual({ description_html: 8, description_text: 8 });
    expect(result.rules).toEqual({ markup: 2, "markup-unwrap-p": 2, "truncated-tail": 3, "doubled-end-tag": 1 });
    expect(result).toMatchObject({ textKept: [], rescored: 8 });

    STORED_CASES.forEach((c, i) => {
      const id = ids.stored[i];
      const text = storedText(c.source, c.repaired);
      if (c.text != null) expect(text).toBe(c.text);
      expect(text).not.toMatch(LITERAL_TAG_RE);
      // Seuls ces champs changent ; le score est recalculé sur le texte réparé.
      expect(row(id)).toEqual({ ...before.get(id), description_html: c.repaired, description_text: text, ...localScore(id) });
    });
    for (const id of [...ids.legit, ids.clean]) expect(row(id)).toEqual(before.get(id));

    expect(JSON.parse(getSetting(ESCAPED_MARKUP_REPAIR_KEY)!)).toEqual(result);
    expect(readEscapedMarkupRepair()?.ids).toEqual(ids.stored);
  });

  it("second passage : rien (marque), et même forcé, aucun changement", () => {
    seed();
    repairEscapedMarkup();
    const snapshot = allRows();
    expect(repairEscapedMarkup()).toBeNull();
    expect(ensureEscapedMarkupRepaired()).toBeNull();
    const forced = repairEscapedMarkup({ force: true })!;
    expect(forced.ids).toEqual([]);
    expect(allRows()).toEqual(snapshot);
    // Un passage forcé ne remplace pas la marque d'origine.
    expect(readEscapedMarkupRepair()?.ids).toHaveLength(STORED_CASES.length);
  });

  it("ne fait rien tant que la réparation des entités n'a pas eu lieu", () => {
    resetRepairs(false);
    const id = insertRaw("talent", { description_html: STORED_CASES[0].html });
    const before = row(id);
    expect(repairEscapedMarkup()).toBeNull();
    expect(repairEscapedMarkup({ force: true })).toBeNull();
    expect(ensureEscapedMarkupRepaired()).toBeNull();
    expect(getSetting(ESCAPED_MARKUP_REPAIR_KEY)).toBeNull();
    expect(G.__jobscoutEscapedMarkupRepairV1?.done).toBe(false);
    expect(row(id)).toEqual(before);
  });

  it("base d'avant les deux correctifs : entités d'abord, balisage ensuite, chacune une seule fois", () => {
    resetRepairs(false);
    // Titre encodé (entités) et description entièrement échappée, texte d'avant le correctif des entités encore encodé.
    const id = insertRaw("talent", {
      title: "Charg&eacute; d&apos;&eacute;tudes",
      description_html: "&lt;p&gt;Mission &amp;amp; ind&amp;eacute;pendance&lt;/p&gt;",
      description_text: "<p>Mission &amp; ind&eacute;pendance</p>",
    });
    expect(ensureOffresRepaired()).toBe(2);
    const entities = readHtmlEntitiesRepair()!, markup = readEscapedMarkupRepair()!;
    expect([entities.ids, markup.ids]).toEqual([[id], [id]]);
    expect(entities.at <= markup.at).toBe(true);
    expect(row(id)).toMatchObject({
      title: "Chargé d'études",
      // Entités : « &amp;amp; » → « &amp; », « &amp;eacute; » → « &eacute; » ; balisage : un
      // niveau de plus retiré (« &amp; » → « & », affiché « & »), « &eacute; » gardé.
      description_html: "<p>Mission & ind&eacute;pendance</p>",
      description_text: "Mission & indépendance",
      ...localScore(id),
    });
    expect(ensureOffresRepaired()).toBe(0);
  });

  it("annule tout en cas d'erreur (transaction) et ne pose pas la marque, puis répare au nouvel essai", () => {
    const a = insertRaw("talent", { description_html: STORED_CASES[0].html });
    const b = insertRaw("apec", { description_html: STORED_CASES[4].html });
    const before = [row(a), row(b)];
    getDb().exec(`CREATE TEMP TRIGGER fail_markup BEFORE UPDATE OF description_html ON offres WHEN NEW.id = ${b} BEGIN SELECT RAISE(ABORT, 'refus'); END`);
    try {
      expect(() => repairEscapedMarkup()).toThrow(/refus/);
      // ensureEscapedMarkupRepaired ne lève jamais : nouvel essai plus tard.
      const err = vi.spyOn(console, "error").mockImplementation(() => {});
      expect(ensureEscapedMarkupRepaired()).toBeNull();
      expect(err).toHaveBeenCalledOnce();
      err.mockRestore();
      expect(G.__jobscoutEscapedMarkupRepairV1).toMatchObject({ done: false });
      expect(G.__jobscoutEscapedMarkupRepairV1!.retryAt).toBeGreaterThan(Date.now());
    } finally {
      getDb().exec("DROP TRIGGER fail_markup");
    }
    expect([row(a), row(b)]).toEqual(before);
    expect(getSetting(ESCAPED_MARKUP_REPAIR_KEY)).toBeNull();
    G.__jobscoutEscapedMarkupRepairV1!.retryAt = 0;
    expect(ensureEscapedMarkupRepaired()?.ids).toEqual([a, b]);
  });

  it("base verrouillée par un autre processus : rien d'écrit, nouvel essai une minute plus tard", () => {
    const id = insertRaw("talent", { description_html: STORED_CASES[0].html });
    const before = row(id);
    const other = new DatabaseSync(dbPath());
    other.exec("BEGIN IMMEDIATE");
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(ensureEscapedMarkupRepaired()).toBeNull();
      expect(err).toHaveBeenCalledOnce();
      expect(String(err.mock.calls[0][1])).toMatch(/locked/);
    } finally {
      err.mockRestore();
      other.exec("ROLLBACK");
      other.close();
    }
    expect(row(id)).toEqual(before);
    expect(getSetting(ESCAPED_MARKUP_REPAIR_KEY)).toBeNull();
    // Avant la minute : pas de nouvel essai ; après : réparation.
    expect(ensureEscapedMarkupRepaired()).toBeNull();
    G.__jobscoutEscapedMarkupRepairV1!.retryAt = 0;
    expect(ensureEscapedMarkupRepaired()?.ids).toEqual([id]);
  });

  it("texte stocké décalé de blancs par rapport au HTML : texte re-dérivé et re-scoré", () => {
    const { html, repaired, text } = STORED_CASES[0];
    const exact = storedText("talent", html);
    // Une espace de plus dans une suite de blancs (« <br />  </p> »), comme dans un texte stocké décalé.
    const drift = exact.replace("</p> <p>", "</p>  <p>");
    expect(drift).not.toBe(exact);
    const id = insertRaw("talent", { description_html: html, description_text: drift });
    expect(repairEscapedMarkup()).toMatchObject({ ids: [id], fields: { description_html: 1, description_text: 1 }, textKept: [], rescored: 1 });
    expect(row(id)).toMatchObject({ description_html: repaired, description_text: text, ...localScore(id) });
  });

  it("« < » échappé en références numériques seulement (&#60;, &#x3C;, &#X3C;) : retenu par le préfiltre SQL et réparé", () => {
    const a = insertRaw("talent", { description_html: "&#60;p&#62;Un &#x3C;strong&#x3e;bloc&#x3c;/strong&#62;.&#60;/p&#62;" });
    const b = insertRaw("talent", { description_html: "&#X3C;p&#X3E;Autre bloc&#X3C;/p&#X3E;" });
    expect(repairEscapedMarkup()).toMatchObject({ ids: [a, b], textKept: [] });
    expect(row(a)).toMatchObject({ description_html: "<p>Un <strong>bloc</strong>.</p>", description_text: "Un bloc." });
    expect(row(b)).toMatchObject({ description_html: "<p>Autre bloc</p>", description_text: "Autre bloc" });
  });

  it("texte qui ne dérivait pas du HTML : HTML réparé, texte et score gardés (textKept)", () => {
    const id = insertRaw("talent", { description_html: "&lt;p&gt;Mission&lt;/p&gt;", description_text: "Résumé écrit à part, sans rapport avec le HTML." });
    expect(repairEscapedMarkup()).toMatchObject({ ids: [id], fields: { description_html: 1 }, textKept: [id], rescored: 0 });
    expect(row(id)).toMatchObject({ description_html: "<p>Mission</p>", description_text: "Résumé écrit à part, sans rapport avec le HTML.", score: 42, score_breakdown: null });
  });

  it("sans profil : HTML et texte réparés, score inchangé (« Re-scorer » reste le recours)", () => {
    scan.noProfile = true;
    const id = insertRaw("talent", { description_html: STORED_CASES[0].html });
    expect(repairEscapedMarkup()).toMatchObject({ ids: [id], rescored: 0 });
    expect(row(id)).toMatchObject({ description_html: STORED_CASES[0].repaired, score: 42, score_breakdown: null });
  });

  it("attend la fin d'un scan lancé dans ce processus par le code intermédiaire (enregistré pour les entités seulement), puis répare", () => {
    const id = insertRaw("talent", { description_html: STORED_CASES[0].html });
    const run = insertRun();
    registerCurrentScanRun(run); // ce que fait un scan du code intermédiaire (entités seulement)
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      expect(ensureOffresRepaired()).toBe(0);
      expect(searchOffres().offers[0].description_text).toContain("<p>");
      // L'ancien scan écrit encore, sans ce filet : cette ligne sera aussi réparée.
      const late = insertRaw("linkedin", { description_html: STORED_CASES[7].html });
      expect(getSetting(ESCAPED_MARKUP_REPAIR_KEY)).toBeNull();
      expect(G.__jobscoutEscapedMarkupRepairV1).toMatchObject({ done: false });
      // Scan terminé, nouvel essai une minute plus tard.
      getDb().prepare("UPDATE scan_runs SET status = 'done', finished_at = datetime('now') WHERE id = ?").run(run);
      G.__jobscoutEscapedMarkupRepairV1!.retryAt = 0;
      expect(searchOffres().offers.map((o) => o.description_text).join(" ")).not.toMatch(LITERAL_TAG_RE);
      expect(readEscapedMarkupRepair()?.ids).toEqual([id, late]);
      expect(info).toHaveBeenCalledOnce();
    } finally {
      info.mockRestore();
    }
  });
});

describe("déclenchement : première lecture ou écriture des offres", () => {
  it("getOffre (fiche, génération de LM)", () => {
    const id = insertRaw("talent", { description_html: STORED_CASES[0].html });
    expect(getOffre(id)?.description_text).toBe(STORED_CASES[0].text);
    expect(readEscapedMarkupRepair()?.ids).toEqual([id]);
  });

  it("listOffres (re-score)", () => {
    const id = insertRaw("apec", { description_html: STORED_CASES[4].html });
    expect(listOffres().find((o) => o.id === id)?.description_text).toBe(STORED_CASES[4].text);
    expect(readEscapedMarkupRepair()?.ids).toEqual([id]);
  });

  it("searchOffres (liste) : cache construit sur l'ancien texte, puis reconstruit après la réparation", () => {
    const id = insertRaw("linkedin", { description_html: STORED_CASES[7].html });
    // Ancien code : cache construit sur le texte en clair (marque simulée pour qu'il ne répare pas).
    setSetting(ESCAPED_MARKUP_REPAIR_KEY, "{}");
    expect(searchOffres().offers[0].description_text).toContain("2026</p>");
    // Le correctif est chargé : marque absente, état jamais vérifié.
    getDb().prepare("DELETE FROM settings WHERE key = ?").run(ESCAPED_MARKUP_REPAIR_KEY);
    delete G.__jobscoutEscapedMarkupRepairV1;
    expect(searchOffres().offers.map((o) => [o.id, o.description_text])).toEqual([[id, STORED_CASES[7].text]]);
    expect(readEscapedMarkupRepair()?.ids).toEqual([id]);
    expect(markupState()?.done).toBe(true);
  });

  it("listCandidatures (page Candidatures, export) : les deux réparations, pas seulement celle des entités", () => {
    const id = insertRaw("talent", { description_html: STORED_CASES[0].html });
    createCandidature({ offre_id: id });
    expect(listCandidatures().map((c) => c.offre_id)).toEqual([id]);
    expect(readEscapedMarkupRepair()?.ids).toEqual([id]);
    expect(row(id).description_text).toBe(STORED_CASES[0].text);
  });

  it("première écriture (scan lancé avant toute page) : réparation avant d'écrire", () => {
    const old = insertRaw("talent", { description_html: STORED_CASES[1].html });
    upsertOffreFromSource("talent", scraped({ description_html: "<p>Nouvelle offre propre.</p>", description_text: "Nouvelle offre propre." }));
    expect(readEscapedMarkupRepair()?.ids).toEqual([old]);
    expect(row(old).description_html).toBe(STORED_CASES[1].repaired);
  });
});

describe("nouveau scan après la réparation", () => {
  it("la même offre re-scannée telle que la source la sert réécrit exactement les octets réparés", () => {
    // Formes stockées, puis autres formes servies par les sources (dont l'APEC à double espace : le texte se tire selon la source).
    const cases = [...STORED_CASES, ...LATENT_CASES];
    const ids = cases.map((c, i) => insertRaw(c.source, { source_id: `same-${i}`, description_html: c.html }));
    ensureOffresRepaired();
    const repaired = ids.map((id) => row(id));
    expect(readEscapedMarkupRepair()?.ids).toEqual(ids);
    cases.forEach((c, i) => {
      // Ce que le scraper de la source produit : HTML tel que servi, texte dérivé de ce HTML.
      upsertOffreFromSource(c.source, scraped({
        source_id: `same-${i}`,
        description_html: c.html,
        description_text: descriptionTextFromHtml(c.source, c.html),
      }));
      const now = row(ids[i]);
      expect([now.description_html, now.description_text]).toEqual([repaired[i].description_html, repaired[i].description_text]);
      expect(now.description_text).not.toMatch(LITERAL_TAG_RE);
    });
  });

  it("runScan (code actuel) : ne fait pas attendre la réparation, enregistre et note l'offre réparée", async () => {
    resetRepairs(false);
    const old = insertRaw("talent", { description_html: STORED_CASES[0].html });
    const c = STORED_CASES[1];
    const raw = scraped({ description_html: c.html, description_text: descriptionTextFromHtml("talent", c.html) });
    scan.offres = [raw];
    const { runScan } = await import("@/lib/scan/orchestrator");
    for await (const _ of runScan(() => {}, { onlySource: "talent" })) void _;

    const stored = getDb().prepare("SELECT id, description_html, description_text, score FROM offres WHERE source_id = ?").get(raw.source_id) as {
      id: number; description_html: string; description_text: string; score: number;
    };
    expect(stored).toMatchObject({ description_html: c.repaired, description_text: c.text });
    // Réparations faites avant la première écriture : l'ancienne offre seulement.
    expect(readHtmlEntitiesRepair()?.ids).toEqual([]);
    expect(readEscapedMarkupRepair()?.ids).toEqual([old]);
    expect(G.__jobscoutEscapedMarkupRepairV1?.ownScanRuns).toHaveLength(1);
    expect(G.__jobscoutHtmlEntitiesRepairV1?.ownScanRuns).toEqual(G.__jobscoutEscapedMarkupRepairV1?.ownScanRuns);
    // Noté sur le texte tel qu'il est enregistré.
    expect(stored.score).toBe(localScore(stored.id).score);
  });

  it("runScan, source APEC : texte enregistré et score tirés comme l'APEC (double espace gardée)", async () => {
    const html = "Maîtrise de la gestion  de projet et SQL ;&lt;li d";
    const raw = scraped({ description_html: html, description_text: descriptionTextFromHtml("apec", html) });
    scan.offres = [raw];
    scan.apecAvailable = true;
    const { runScan } = await import("@/lib/scan/orchestrator");
    for await (const _ of runScan(() => {}, { onlySource: "apec" })) void _;

    const stored = getDb().prepare("SELECT id, source, description_html, description_text, score FROM offres WHERE source_id = ?").get(raw.source_id) as {
      id: number; source: string; description_html: string; description_text: string; score: number;
    };
    const fixed = "Maîtrise de la gestion  de projet et SQL ;";
    expect(stored).toMatchObject({ source: "apec", description_html: fixed, description_text: fixed });
    expect(stored.score).toBe(localScore(stored.id).score);
    // Garde-fou du test : la double espace change le score (sinon il ne départagerait pas les sources).
    const single = scoreOffreLocal(profile, { title: raw.title, company: raw.company, country: raw.country, description_text: htmlToText(fixed), contract_type: raw.contract_type });
    expect(single.score).not.toBe(stored.score);
  });
});
