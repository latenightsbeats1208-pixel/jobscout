import { beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import { currentSearch } from "@/lib/db/scans";
import {
  offresCounts, previousSearchOffres, searchOffres, setCurrentSearchOnly, setOffreScore, upsertOffreFromSource, type ScrapedOffre,
} from "@/lib/db/offres";

/**
 * Offres d'une recherche précédente (19 octobre 2026 : 1 392 offres commerciales
 * sous un profil Acheteur) : l'échelle relative se calcule sans elles, et la
 * liste peut les masquer sans rien effacer.
 */

let seq = 0;
function add(score: number, scrapedAt: string, title = `Poste ${++seq}`): number {
  const offre: ScrapedOffre = {
    source_id: `p-${++seq}`, url: `https://example.org/${seq}`, title, company: `Entreprise ${seq}`,
    country: "France", location: "Paris", contract_type: "CDI", salary: null,
    description_html: "<p>x</p>", description_text: `Description ${seq}`, description_status: "ok",
    posted_at: "2026-10-01", is_vie: false, raw_payload: {},
  };
  const id = upsertOffreFromSource("hellowork", offre);
  setOffreScore(id, { score, breakdown: { sector: 0, skills: 0, country: 0 }, reason: "r" });
  getDb().prepare("UPDATE offres SET scraped_at = ? WHERE id = ?").run(scrapedAt, id);
  return id;
}

function scan(startedAt: string, firstLine: string | null) {
  getDb().prepare("INSERT INTO scan_runs (started_at, status, log) VALUES (?, 'done', ?)").run(startedAt, JSON.stringify(firstLine ? [firstLine, "[wttj] 10 vues"] : []));
}

const COMMERCIAL = "Recherche : « Chargé de développement commercial » — zone : tout le pays";
const ACHETEUR = "Recherche : « Acheteur » — zone : Île-de-France";

beforeEach(() => {
  const db = getDb();
  db.exec("DELETE FROM offres");
  db.exec("DELETE FROM scan_runs");
  setCurrentSearchOnly(false);
});

describe("recherche en cours", () => {
  it("regroupe les derniers scans qui annoncent la même recherche", () => {
    scan("2026-10-12 15:07:21", null); // scan d'avant l'annonce de la recherche
    scan("2026-10-13 03:08:21", COMMERCIAL);
    scan("2026-10-13 16:08:26", COMMERCIAL);
    expect(currentSearch()).toEqual({ since: "2026-10-13 03:08:21", label: COMMERCIAL });
    scan("2026-10-19 16:14:36", ACHETEUR);
    scan("2026-10-19 18:00:00", ACHETEUR);
    expect(currentSearch()).toEqual({ since: "2026-10-19 16:14:36", label: ACHETEUR });
    // Un scan qui démarre n'a pas encore écrit son journal : il ne coupe pas la série.
    scan("2026-10-19 19:00:00", null);
    expect(currentSearch()?.since).toBe("2026-10-19 16:14:36");
  });

  it("aucune recherche identifiée sans scan qui l'annonce", () => {
    scan("2026-10-12 15:07:21", null);
    expect(currentSearch()).toBeNull();
  });
});

describe("offres d'une recherche précédente", () => {
  function setup() {
    scan("2026-10-13 03:08:21", COMMERCIAL);
    scan("2026-10-19 16:14:36", ACHETEUR);
    // 30 offres commerciales, mal notées pour le profil Acheteur.
    for (let i = 0; i < 30; i++) add(10 + (i % 5), "2026-10-13 04:00:00");
    // 12 offres de la recherche Acheteur, de 31 à 86.
    const ids = Array.from({ length: 12 }, (_, i) => add(31 + i * 5, "2026-10-19 16:20:00", `Acheteur ${i}`));
    return ids;
  }

  it("l'échelle relative se calcule sur la recherche en cours", () => {
    const [lowest] = setup();
    // Avec les 30 offres commerciales dans l'échelle, 31/100 était « Haut de votre liste ».
    const offer = searchOffres({ page: 1 }).offers.find((o) => o.id === lowest)!;
    expect(offer.score_label).toBe("Bas de votre liste");
    expect(previousSearchOffres()).toEqual({ count: 30, since: "2026-10-19 16:14:36", hidden: false });
  });

  it("la liste les masque à la demande, sans rien effacer, et l'accueil compte pareil", () => {
    setup();
    expect(searchOffres().total).toBe(42);
    setCurrentSearchOnly(true);
    expect(searchOffres().total).toBe(12);
    expect(searchOffres().offers.every((o) => o.title.startsWith("Acheteur"))).toBe(true);
    expect(offresCounts().total).toBe(12);
    expect(previousSearchOffres()?.hidden).toBe(true);
    expect((getDb().prepare("SELECT COUNT(*) AS c FROM offres").get() as { c: number }).c).toBe(42);
    setCurrentSearchOnly(false);
    expect(searchOffres().total).toBe(42);
  });

  it("une offre revue par la recherche en cours en fait partie, même collectée avant", () => {
    scan("2026-10-13 03:08:21", COMMERCIAL);
    const old = add(50, "2026-10-13 04:00:00", "Acheteur ancien");
    scan("2026-10-19 16:14:36", ACHETEUR);
    getDb().prepare("UPDATE offres SET scraped_at = '2026-10-19 16:30:00' WHERE id = ?").run(old);
    expect(previousSearchOffres()).toBeNull();
  });
});
