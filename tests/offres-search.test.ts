import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "@/lib/db";
import { setSetting } from "@/lib/db";
import { dbPath } from "@/lib/paths";
import { offresCounts, searchOffres, setOffreScore, upsertOffreFromSource, newOffersFromLastScan, newOffersFromLastScanCount, type ScrapedOffre } from "@/lib/db/offres";

/**
 * searchOffres (liste /offres et /api/offres/search) : pagination stable, filtres,
 * et cache mémoire toujours à jour après une écriture (scan, re-score, documents,
 * autre connexion). Base SQLite temporaire (tests/setup.ts), offres fictives.
 */

let seq = 0;

function scraped(over: Partial<ScrapedOffre> = {}): ScrapedOffre {
  seq++;
  return {
    source_id: `t-${seq}`,
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

function add(over: Partial<ScrapedOffre> = {}, score = 50): number {
  const id = upsertOffreFromSource("hellowork", scraped(over));
  setOffreScore(id, { score, breakdown: { sector: 0, skills: 0, country: 0 }, reason: `raison ${id}` });
  return id;
}

beforeEach(() => {
  const db = getDb();
  db.exec("DELETE FROM documents");
  db.exec("DELETE FROM offres");
});

describe("searchOffres", () => {
  it("pagine sans doublon ni trou quand toutes les offres sont ex æquo (départage par id)", () => {
    const ids = Array.from({ length: 60 }, () => add({}, 70));
    const pages = [1, 2, 3].map((page) => searchOffres({ page }));
    const seen = pages.flatMap((p) => p.offers.map((o) => o.id));
    expect(pages.map((p) => p.offers.length)).toEqual([24, 24, 12]);
    expect(new Set(seen).size).toBe(60);
    expect(seen).toEqual([...ids].sort((a, b) => b - a));
    expect(pages.every((p) => p.total === 60)).toBe(true);
    // Même requête, même page : même contenu.
    expect(searchOffres({ page: 2 }).offers.map((o) => o.id)).toEqual(pages[1].offers.map((o) => o.id));
  });

  it("ne renvoie ni description_html ni raw_payload, et coupe la description à 1 000 caractères", () => {
    add({ description_text: "a".repeat(1500), raw_payload: { secret: "brut" } });
    const [offer] = searchOffres().offers;
    expect(offer.description_text).toHaveLength(1000);
    expect(JSON.stringify(offer)).not.toMatch(/description_html|raw_payload|brut/);
    expect(offer.score_reason).toMatch(/^raison /);
  });

  it("recherche sans accents ni casse, dans le titre comme dans la description", () => {
    const hit = add({ title: "Chargée de communication" });
    const inText = add({ description_text: "Vous piloterez la stratégie éditoriale." });
    add({ title: "Comptable" });
    expect(searchOffres({ query: "chargee" }).offers.map((o) => o.id)).toEqual([hit]);
    expect(searchOffres({ query: "CHARGÉE DE" }).offers.map((o) => o.id)).toEqual([hit]);
    expect(searchOffres({ query: "strategie editoriale" }).offers.map((o) => o.id)).toEqual([inText]);
    expect(searchOffres({ query: "introuvable" }).total).toBe(0);
  });

  it("?vie=1 suit la catégorie de contrat (détection V.I.E), pas la colonne is_vie", () => {
    const vie = add({ title: "Chef de projet V.I.E Singapour", is_vie: false });
    add({ title: "Chef de projet", is_vie: true }); // drapeau figé sans marqueur V.I.E
    const result = searchOffres({ vieOnly: true });
    expect(result.offers.map((o) => o.id)).toEqual([vie]);
    expect(searchOffres({ contracts: ["vie"] }).offers.map((o) => o.id)).toEqual([vie]);
    expect(result.facets.contractCounts.vie).toBe(1);
    expect(result.facets.hasVie).toBe(true);
    expect(offresCounts().vie).toBe(1);
  });

  it("tri « Plus anciennes » : dates croissantes, dates inconnues en dernier", () => {
    const sansDate = add({ posted_at: null });
    const recente = add({ posted_at: "2026-03-01" });
    const ancienne = add({ posted_at: "2025-11-20" });
    expect(searchOffres({ sortBy: "oldest" }).offers.map((o) => o.id)).toEqual([ancienne, recente, sansDate]);
    expect(searchOffres({ sortBy: "newest" }).offers.map((o) => o.id)).toEqual([recente, ancienne, sansDate]);
  });
});

describe("cache de searchOffres", () => {
  afterEach(() => vi.restoreAllMocks());

  it("relit l'ordre au bout d'une minute (bonus de fraîcheur) sans perdre ni doubler d'offre", () => {
    const ids = Array.from({ length: 30 }, (_, i) => add({ posted_at: `2026-01-${String(i + 1).padStart(2, "0")}` }, 50 + i));
    const before = [1, 2].flatMap((page) => searchOffres({ page }).offers.map((o) => o.id));
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now + 61_000);
    const after = [1, 2].flatMap((page) => searchOffres({ page }).offers.map((o) => o.id));
    expect(after).toEqual(before);
    expect(new Set(after)).toEqual(new Set(ids));
  });

  it("voit un re-score (écriture sans date ni nouvelle ligne)", () => {
    const a = add({}, 40);
    const b = add({}, 30);
    expect(searchOffres().offers.map((o) => o.id)).toEqual([a, b]);
    setOffreScore(b, { score: 90, breakdown: { sector: 0, skills: 0, country: 0 }, reason: "nouvelle raison" });
    const after = searchOffres();
    expect(after.offers.map((o) => o.id)).toEqual([b, a]);
    expect(after.offers[0]).toMatchObject({ score: 90, score_reason: "nouvelle raison" });
    expect(searchOffres({ minScore: true }).offers.map((o) => o.id)).toEqual([b]);
  });

  it("voit une offre ajoutée ou mise à jour par un scan", () => {
    add({ title: "Première" });
    expect(searchOffres().total).toBe(1);
    const again = scraped({ title: "Deuxième" });
    upsertOffreFromSource("wttj", again);
    expect(searchOffres().total).toBe(2);
    upsertOffreFromSource("wttj", { ...again, title: "Deuxième, titre corrigé" });
    expect(searchOffres({ query: "titre corrige" }).total).toBe(1);
    expect(searchOffres().facets.sources).toEqual(["hellowork", "wttj"]);
  });

  it("isole les nouvelles offres du dernier scan sans inclure les offres précédentes", () => {
    const old = add({ title: "Ancienne offre" });
    const freshA = add({ title: "Nouvelle offre A" });
    const freshB = add({ title: "Nouvelle offre B" });
    setSetting("last_scan_new_offer_ids", JSON.stringify([freshA, freshB]));
    expect(searchOffres({ newOnly: true }).offers.map((offer) => offer.id).sort()).toEqual([freshA, freshB].sort());
    expect(newOffersFromLastScan(1)).toHaveLength(1);
    expect(newOffersFromLastScanCount()).toBe(2);
    expect(searchOffres({ newOnly: true }).offers.map((offer) => offer.id)).not.toContain(old);
  });

  it("voit un document généré (badge « Dossier prêt »)", () => {
    const id = add();
    expect(searchOffres().offers[0].has_cv).toBe(false);
    getDb().prepare("INSERT INTO documents (type, offre_id, file_path, format) VALUES ('cv', ?, 'cv.pdf', 'pdf')").run(id);
    expect(searchOffres().offers[0].has_cv).toBe(true);
  });

  it("voit une écriture faite par une autre connexion (script, autre processus)", () => {
    const a = add({}, 40);
    const b = add({}, 30);
    expect(searchOffres().offers.map((o) => o.id)).toEqual([a, b]);
    const other = new DatabaseSync(dbPath());
    try {
      other.prepare("UPDATE offres SET score = 95 WHERE id = ?").run(b);
      other.prepare("DELETE FROM offres WHERE id = ?").run(a);
    } finally {
      other.close();
    }
    const after = searchOffres();
    expect(after.offers.map((o) => o.id)).toEqual([b]);
    expect(after.facets.total).toBe(1);
  });
});
