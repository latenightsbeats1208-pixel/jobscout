import fs from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getDb } from "@/lib/db";
import { searchOffres, setOffreScore, upsertOffreFromSource, type ScrapedOffre } from "@/lib/db/offres";
import { communeByCode, geoStatus, resolveOfferLocation } from "@/lib/geo";

/**
 * Panne passagère de la base géographique (fichier verrouillé au démarrage),
 * puis nouvel essai réussi au bout de 60 s : les offres déjà lues pendant la
 * panne doivent être replacées, sans écriture en base ni redémarrage.
 * Fichier à part : l'état de la base géographique est global au processus.
 * Base SQLite temporaire (tests/setup.ts), offres fictives.
 */

let seq = 0;

function add(location: string): number {
  seq++;
  const offre: ScrapedOffre = {
    source_id: `r-${seq}`,
    url: `https://example.org/offre/${seq}`,
    title: `Poste ${seq}`,
    company: "Entreprise Exemple",
    country: "France",
    location,
    contract_type: "CDI",
    salary: null,
    description_html: "<p>Description</p>",
    description_text: "Description du poste en CDI.",
    description_status: "ok",
    posted_at: "2026-01-15",
    is_vie: false,
    raw_payload: {},
  };
  const id = upsertOffreFromSource("hellowork", offre);
  setOffreScore(id, { score: 50, breakdown: { sector: 0, skills: 0, country: 0 }, reason: `raison ${id}` });
  return id;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("base géographique : nouvel essai après une panne", () => {
  it("replace les offres lues pendant la panne dès que la base se recharge", () => {
    const db = getDb();
    db.exec("DELETE FROM documents");
    db.exec("DELETE FROM offres");
    const ids = { lyon: add("Lyon"), villeurbanne: add("Villeurbanne") };

    // 1) Lecture des fichiers .gz en échec (verrou simulé).
    let failing = true;
    const realRead = fs.readFileSync;
    const readSpy = vi.spyOn(fs, "readFileSync").mockImplementation(((file: fs.PathOrFileDescriptor, ...rest: unknown[]) => {
      if (failing && String(file).endsWith(".gz")) {
        const e = new Error("EBUSY: resource busy or locked (simulé)") as NodeJS.ErrnoException;
        e.code = "EBUSY";
        throw e;
      }
      return (realRead as (...a: unknown[]) => unknown)(file, ...rest);
    }) as typeof fs.readFileSync);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const during = searchOffres({});
    expect(during.total).toBe(2);
    expect(geoStatus().ok).toBe(false);
    expect(errSpy).toHaveBeenCalled();
    expect(communeByCode("69123")).toBeNull();
    expect(resolveOfferLocation({ source: "hellowork", location: "Lyon", country: "France" }).lat).toBeNull();

    // 2) Le verrou est levé ; 61 s plus tard, le nouvel essai réussit.
    failing = false;
    const later = Date.now() + 61_000;
    vi.spyOn(Date, "now").mockReturnValue(later);
    const home = communeByCode("69123");
    expect(geoStatus().ok).toBe(true);
    expect(home).not.toBeNull();

    // 3) Sans nouvelle écriture en base, les deux offres sont placées.
    const after = searchOffres({ home: home! });
    expect(after.facets.distance.located).toBe(2);
    expect(after.facets.distance.unlocated).toBe(0);
    expect(after.facets.distance.counts["0"]).toBe(1);
    expect(after.facets.distance.counts["10"]).toBe(2);
    const byId = new Map(after.offers.map((o) => [o.id, o]));
    expect(byId.get(ids.lyon)!.same_city).toBe(true);
    expect(byId.get(ids.villeurbanne)!.distance_km!).toBeLessThan(10);
    expect(searchOffres({ home: home!, radiusKm: 20 }).total).toBe(2);

    // 4) La fiche d'une offre (même résolution, mémoïsée) n'a rien gardé de la panne.
    const lyon = resolveOfferLocation({ source: "hellowork", location: "Lyon", country: "France" });
    expect(lyon.precision).toBe("commune");
    expect(lyon.lat === null ? null : lyon.code).toBe("69123");
    expect(readSpy).toHaveBeenCalled();
  });
});
