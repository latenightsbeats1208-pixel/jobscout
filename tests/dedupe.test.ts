import { beforeEach, describe, expect, it } from "vitest";
import { companyKey, groupDuplicates, sameOffer, titleKey, type DedupeCandidate } from "@/lib/scan/dedupe";
import { getDb } from "@/lib/db";
import { searchOffres, setOffreScore, upsertOffreFromSource, offresCounts, type ScrapedOffre } from "@/lib/db/offres";
import { getOffreSiblings, refreshDuplicates } from "@/lib/db/duplicates";
import { applyLiveness, livenessCandidates } from "@/lib/scrapers/liveness-store";
import { highScoreFigure, untrackedOffresCount } from "@/lib/db/dashboard";
import { setFeedback } from "@/lib/db/feedback";

/**
 * Doublons : la même offre publiée dans plusieurs villes ou sur plusieurs
 * sources ne fait qu'une ligne dans la liste (cas réels de la base de 623
 * offres, octobre 2026) ; et les offres retirées par leur source sortent de la
 * liste et des compteurs de l'accueil, sans disparaître de la base.
 */

describe("même offre ?", () => {
  it("même entreprise et même intitulé, au genre, à la ponctuation et au lieu près", () => {
    const a = { id: 1, title: "Employé commercial caisse et services (F/H)", company: "Carrefour", country: "France", location: "Nice" };
    const b = { id: 2, title: "Employé commercial caisse & services (F/H)", company: "CARREFOUR FRANCE", country: "France", location: "Annecy" };
    expect(sameOffer(a, b)).toBe(true);
    // Le lieu écrit dans l'intitulé ne sépare pas deux publications.
    expect(titleKey("Comptable fournisseurs - Rouen", "Rouen", "France")).toBe(titleKey("Comptable fournisseurs - Lyon", "Lyon", "France"));
  });

  it("le nom de l'employeur écrit autrement sur une autre source (cas réel WTTJ / HelloWork)", () => {
    expect(sameOffer(
      { id: 84, title: "TECH MAINT SECT ART", company: "Civils de la Défense - Ministère des Armées et des Anciens combattants", country: "France", location: "Toulon" },
      { id: 282, title: "Tech Maint Sect Art H/F", company: "Ministère des armées - Civils de la Défense", country: "France", location: "Toulon" },
    )).toBe(true);
    expect(sameOffer(
      { id: 1, title: "Comptable", company: "Air Liquide", country: "France", location: "Lyon" },
      { id: 2, title: "Comptable", company: "Air France", country: "France", location: "Lyon" },
    )).toBe(false);
  });

  it("un autre niveau, un autre contrat ou un autre pays reste une autre offre", () => {
    const base = { id: 1, company: "Atos", country: "France", location: "Nantes" };
    const same = (a: Partial<typeof base> & { title: string }, b: Partial<typeof base> & { title: string }) => sameOffer({ ...base, ...a }, { ...base, ...b });
    expect(same({ title: "Comptable senior" }, { title: "Comptable junior" })).toBe(false);
    expect(same({ title: "Comptable en alternance" }, { title: "Comptable" })).toBe(false);
    expect(same({ title: "Technicien niveau 2" }, { title: "Technicien niveau 3" })).toBe(false);
    expect(same({ title: "Comptable" }, { title: "Comptable", country: "Belgique" })).toBe(false);
  });

  it("sans entreprise connue, rien n'est regroupé (cas réel : « 26 » pris pour l'entreprise)", () => {
    for (const company of ["", "26", "Entreprise confidentielle", "Non communiqué", "SAS"]) expect(companyKey(company), company).toBeNull();
    const anon = { id: 1, title: "Agent de service", company: "26", country: "France", location: "Romans-sur-Isère" };
    expect(sameOffer(anon, { ...anon, id: 2 })).toBe(false);
  });

  it("l'offre affichée : celle où l'utilisateur a agi, puis en ligne, complète, mieux notée", () => {
    const c = (id: number, over: Partial<DedupeCandidate>): DedupeCandidate => ({
      id, title: "Tech Lead IA", company: "Thélio", country: "France", location: `Ville ${id}`,
      activity: false, closed: false, description_status: "ok", score: 50, posted_at: "2026-10-01", ...over,
    });
    expect([...groupDuplicates([c(1, {}), c(2, { score: 70 }), c(3, { description_status: "partial", score: 90 })])]).toEqual([[1, 2], [3, 2]]);
    expect(groupDuplicates([c(1, { score: 90, closed: true }), c(2, {})]).get(1)).toBe(2);
    expect(groupDuplicates([c(1, { score: 90 }), c(2, { activity: true })]).get(1)).toBe(2);
  });
});

let seq = 0;
function add(over: Partial<ScrapedOffre> = {}, score = 50, source = "hellowork"): number {
  seq++;
  const id = upsertOffreFromSource(source, {
    source_id: `d-${seq}`, url: `https://example.org/${seq}`, title: `Poste ${seq}`, company: "Entreprise Exemple",
    country: "France", location: "Lyon", contract_type: "CDI", salary: null, description_html: "<p>…</p>",
    description_text: "Description du poste.", description_status: "ok", posted_at: "2026-10-01", is_vie: false, raw_payload: {},
    ...over,
  });
  setOffreScore(id, { score, breakdown: { sector: 0, skills: 0, country: 0 }, reason: "" });
  return id;
}

beforeEach(() => {
  const db = getDb();
  db.exec("DELETE FROM offre_feedback");
  db.exec("DELETE FROM documents");
  db.exec("DELETE FROM offres");
});

describe("liste des offres", () => {
  it("une ligne par groupe, avec les autres lieux et sources ; chaque publication garde sa page", () => {
    const lyon = add({ title: "Mécanicien service rapide (H/F)", company: "Groupement Mousquetaires", location: "Lyon" }, 72);
    const brest = add({ title: "MECANICIEN SERVICE RAPIDE (H/F)", company: "Groupement Mousquetaires", location: "Brest" }, 60);
    const wttj = add({ title: "Mécanicien service rapide", company: "Groupement Mousquetaires", location: "Lyon" }, 65, "wttj");
    const other = add({ title: "Comptable", location: "Lyon" }, 80);

    const { offers, total } = searchOffres();
    expect(total).toBe(2);
    const group = offers.find((o) => o.id === lyon)!;
    expect(group.variants.map((v) => v.id).sort()).toEqual([brest, wttj].sort());
    expect(offers.find((o) => o.id === other)!.variants).toEqual([]);
    // Chercher la ville d'un doublon ou filtrer sur sa source trouve le groupe.
    expect(searchOffres({ query: "brest" }).offers.map((o) => o.id)).toEqual([lyon]);
    expect(searchOffres({ source: "wttj" }).offers.map((o) => o.id)).toEqual([lyon]);
    expect(getOffreSiblings(brest).map((s) => s.id).sort()).toEqual([lyon, wttj].sort());
    expect(offresCounts().total).toBe(2);
  });

  it("un avis fait de l'offre la représentante de son groupe", () => {
    const a = add({ title: "Tech Lead IA", company: "Thélio", location: "Bordeaux" }, 80);
    const b = add({ title: "Tech Lead IA", company: "Thélio", location: "Toulouse" }, 60);
    expect(searchOffres().offers.map((o) => o.id)).toEqual([a]);
    setFeedback(b, { verdict: "down", reason: null });
    expect(searchOffres().offers.map((o) => o.id)).toEqual([b]);
    expect(refreshDuplicates().changed).toBe(0); // déjà à jour : rien à réécrire
  });

  it("une offre retirée sort de la liste et des compteurs, et revient si la source la renvoie", () => {
    const gone = add({ title: "Comptable", company: "Alpha", source_id: "ret-1" }, 90);
    const live = add({ title: "Contrôleur de gestion", company: "Beta" }, 75);
    applyLiveness(new Map([[gone, "closed"], [live, "open"]]));

    const def = searchOffres();
    expect(def.offers.map((o) => o.id)).toEqual([live]);
    expect(def.facets).toMatchObject({ total: 1, closed: 1 });
    expect(searchOffres({ includeClosed: true }).offers.map((o) => o.id)).toEqual([live, gone]); // en fin de liste
    expect(highScoreFigure(70).total).toBe(1);
    expect(untrackedOffresCount()).toBe(1);

    // Revue par un scan : de nouveau en ligne.
    add({ title: "Comptable", company: "Alpha", source_id: "ret-1" }, 90);
    expect(searchOffres().offers.map((o) => o.id)).toEqual([gone, live]);
  });

  it("le scan ne revérifie que les offres qu'il n'a pas revues, au plus une fois par jour", () => {
    const db = getDb();
    const old = add({ title: "Ancienne" }, 90);
    const seen = add({ title: "Revue par le scan" }, 95);
    const linkedin = add({ title: "LinkedIn" }, 99, "linkedin");
    const checked = add({ title: "Vérifiée ce matin" }, 80);
    db.prepare("UPDATE offres SET scraped_at = datetime('now', '-2 days'), checked_at = datetime('now', '-2 days') WHERE id IN (?, ?, ?)").run(old, linkedin, checked);
    db.prepare("UPDATE offres SET checked_at = datetime('now', '-1 hours') WHERE id = ?").run(checked);
    const startedAt = (db.prepare("SELECT datetime('now', '-1 minutes') AS t").get() as { t: string }).t;
    expect(livenessCandidates({ notSeenSince: startedAt, limit: 10 }).map((r) => r.id)).toEqual([old]);
    void seen;
  });
});
