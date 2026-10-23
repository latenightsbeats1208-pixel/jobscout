import { beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import { searchOffres, setOffreScore, upsertOffreFromSource, type ScrapedOffre } from "@/lib/db/offres";
import { communeByCode } from "@/lib/geo";

/**
 * Filtre et tri par distance : rayon, « dans ma commune », offres sans
 * lieu précis, tri « Plus proches » stable, comptes du menu. Base SQLite temporaire
 * (tests/setup.ts), offres fictives, base géographique embarquée (lib/geo).
 */

let seq = 0;

function add(location: string, country: string | null = "France", score = 50, source = "hellowork"): number {
  seq++;
  const offre: ScrapedOffre = {
    source_id: `d-${seq}`,
    url: `https://example.org/offre/${seq}`,
    title: `Poste ${seq}`,
    company: "Entreprise Exemple",
    country: country ?? "",
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
  const id = upsertOffreFromSource(source, offre);
  setOffreScore(id, { score, breakdown: { sector: 0, skills: 0, country: 0 }, reason: `raison ${id}` });
  return id;
}

function lyon() {
  const c = communeByCode("69123");
  if (!c) throw new Error("Lyon absent de la base géographique");
  return c;
}

beforeEach(() => {
  const db = getDb();
  db.exec("DELETE FROM documents");
  db.exec("DELETE FROM offres");
});

describe("distance depuis la ville de référence", () => {
  it("rayon, dans ma commune, offres sans lieu et comptes du menu", () => {
    const ids = {
      lyon: add("Lyon"),
      lyon3: add("Lyon 3e Arrondissement"),
      villeurbanne: add("Villeurbanne"),
      vienne: add("Vienne", "France"),
      paris: add("Paris"),
      bruxelles: add("Bruxelles", "Belgique"),
      inconnu: add("", "France"),
    };
    const home = lyon();

    const all = searchOffres({ home });
    const byId = new Map(all.offers.map((o) => [o.id, o]));
    expect(byId.get(ids.lyon)!.same_city).toBe(true);
    expect(byId.get(ids.lyon3)!.same_city).toBe(true);
    expect(byId.get(ids.villeurbanne)!.distance_km!).toBeLessThan(10);
    expect(byId.get(ids.paris)!.distance_km!).toBeGreaterThan(380);
    expect(byId.get(ids.paris)!.distance_km!).toBeLessThan(400);
    expect(byId.get(ids.bruxelles)!.distance_km!).toBeGreaterThan(500);
    expect(byId.get(ids.inconnu)!.distance_km).toBeNull();
    expect(all.facets.distance.home).toEqual({ code: "69123", label: home.label });
    expect(all.facets.distance.located).toBe(6);
    expect(all.facets.distance.unlocated).toBe(1);
    expect(all.facets.distance.counts["0"]).toBe(2);
    expect(all.facets.distance.counts["10"]).toBe(3);
    expect(all.facets.distance.counts["50"]).toBe(4);
    expect(all.facets.distance.counts["200"]).toBe(4);

    const commune = searchOffres({ home, radiusKm: 0 }).offers.map((o) => o.id).sort();
    expect(commune).toEqual([ids.lyon, ids.lyon3].sort());
    const ten = searchOffres({ home, radiusKm: 10 });
    expect(ten.total).toBe(3);
    const fifty = searchOffres({ home, radiusKm: 50 }).offers.map((o) => o.id);
    expect(fifty).toContain(ids.vienne);
    expect(fifty).not.toContain(ids.inconnu);
    const withUnknown = searchOffres({ home, radiusKm: 50, includeUnlocated: true }).offers.map((o) => o.id);
    expect(withUnknown).toContain(ids.inconnu);
  });

  it("tri « Plus proches » : distances croissantes, inconnues en dernier", () => {
    const ids = [add("Paris"), add(""), add("Villeurbanne"), add("Lyon"), add("Bruxelles", "Belgique")];
    const order = searchOffres({ home: lyon(), sortBy: "distance" }).offers.map((o) => o.id);
    expect(order).toEqual([ids[3], ids[2], ids[0], ids[4], ids[1]]);
  });

  it("pagination stable avec de nombreuses offres au même point (départage par l'ordre intelligent)", () => {
    for (let i = 0; i < 40; i++) add("Paris", "France", 60);
    for (let i = 0; i < 20; i++) add("Lyon", "France", 40);
    const pages = [1, 2, 3].map((page) => searchOffres({ home: lyon(), sortBy: "distance", page }));
    const seen = pages.flatMap((p) => p.offers.map((o) => o.id));
    expect(seen.length).toBe(60);
    expect(new Set(seen).size).toBe(60);
    // Les 20 offres lyonnaises d'abord.
    expect(pages[0].offers.slice(0, 20).every((o) => o.same_city)).toBe(true);
  });

  it("sans ville de référence : ni distance, ni rayon appliqué", () => {
    add("Lyon");
    add("Paris");
    const r = searchOffres({ radiusKm: 10, sortBy: "distance" });
    expect(r.total).toBe(2);
    expect(r.offers.every((o) => o.distance_km === null && !o.same_city)).toBe(true);
    expect(r.facets.distance).toEqual({ home: null, counts: { "0": 0, "5": 0, "10": 0, "20": 0, "30": 0, "50": 0, "100": 0, "200": 0 }, located: 0, unlocated: 0 });
  });

  it("indice APEC : le département lève l'homonymie (Saint-Denis 93, pas La Réunion)", () => {
    seq++;
    const id = upsertOffreFromSource("apec", {
      source_id: `apec-${seq}`, url: `https://example.org/apec/${seq}`, title: "Poste APEC", company: "Exemple",
      country: "France", location: "Saint-Denis", contract_type: "CDI", salary: null,
      description_html: "", description_text: "CDI", description_status: "ok", posted_at: "2026-01-15", is_vie: false,
      raw_payload: { lieuTexte: "Saint-Denis - 93" },
    });
    setOffreScore(id, { score: 50, breakdown: { sector: 0, skills: 0, country: 0 }, reason: "r" });
    const paris = communeByCode("75056")!;
    const offer = searchOffres({ home: paris }).offers.find((o) => o.id === id)!;
    expect(offer.distance_km!).toBeLessThan(15);
    expect(offer.geo_label).toContain("93");
  });
});

describe("cas limites (rayons, arrondis, indices, offres à l'étranger)", () => {
  it("le filtre compare la distance affichée : une offre affichée « 5 km » est dans « Jusqu'à 5 km »", () => {
    const paris = communeByCode("75056")!;
    const id = add("Montrouge");
    const offer = searchOffres({ home: paris }).offers.find((o) => o.id === id)!;
    expect(offer.distance_km!).toBeGreaterThan(5);
    expect(Math.round(offer.distance_km!)).toBe(5);
    expect(searchOffres({ home: paris, radiusKm: 5 }).offers.map((o) => o.id)).toContain(id);
  });

  it("chaque rayon contient la ville, même depuis un arrondissement dont le centre est excentré", () => {
    const paris12 = communeByCode("75112")!;
    const ids = [add("Paris"), add("Paris 16e")];
    const r = searchOffres({ home: paris12, radiusKm: 5 });
    expect(r.offers.map((o) => o.id).sort()).toEqual([...ids].sort());
    expect(r.facets.distance.counts["5"]).toBeGreaterThanOrEqual(r.facets.distance.counts["0"]);
  });

  it("tri « Plus proches » : « dans votre ville » avant une commune voisine plus proche du centre", () => {
    const paris12 = communeByCode("75112")!;
    const voisine = add("Charenton-le-Pont");
    const ville = add("Paris");
    const order = searchOffres({ home: paris12, sortBy: "distance" }).offers.map((o) => o.id);
    expect(order.indexOf(ville)).toBeLessThan(order.indexOf(voisine));
  });

  it("France Travail : le département rangé dans le champ entreprise (« 974 ») est utilisé", () => {
    seq++;
    const id = upsertOffreFromSource("francetravail", {
      source_id: `ft-${seq}`, url: `https://example.org/ft/${seq}`, title: "Poste FT", company: "974",
      country: "France", location: "ST DENIS", contract_type: "CDI", salary: null,
      description_html: "", description_text: "CDI", description_status: "ok", posted_at: "2026-01-15", is_vie: false,
      raw_payload: {},
    });
    setOffreScore(id, { score: 50, breakdown: { sector: 0, skills: 0, country: 0 }, reason: "r" });
    const offer = searchOffres({ home: communeByCode("75056")! }).offers.find((o) => o.id === id)!;
    expect(offer.geo_label).toContain("974");
    expect(offer.distance_km!).toBeGreaterThan(9000);
  });

  it("« Les inclure » n'ajoute que les offres en France sans ville, jamais une offre à l'étranger", () => {
    const fr = add("", "France");
    const abroad = add("", "Sénégal");
    const r = searchOffres({ home: lyon(), radiusKm: 20, includeUnlocated: true });
    const ids = r.offers.map((o) => o.id);
    expect(ids).toContain(fr);
    expect(ids).not.toContain(abroad);
    expect(r.facets.distance.unlocated).toBe(1);
  });

  it("collectivités non géolocalisées : sans distance, hors de tout rayon, même avec « Les inclure » ; Papeete et Nouméa placées", () => {
    const paris = communeByCode("75056")!;
    const ids = {
      saintPierre: add("Saint-Pierre (975)"),
      gustavia: add("Gustavia", "Saint-Barthélemy"),
      papeete: add("Papeete", "Polynésie française"),
      noumea: add("Nouméa", "Nouvelle-Calédonie"),
      sansVille: add("", "France"),
    };
    const all = searchOffres({ home: paris });
    const byId = new Map(all.offers.map((o) => [o.id, o]));
    expect(byId.get(ids.saintPierre)).toMatchObject({ distance_km: null, geo_label: "Saint-Pierre (975)" });
    expect(byId.get(ids.gustavia)).toMatchObject({ distance_km: null, geo_label: "Saint-Barthélemy (977)" });
    expect(byId.get(ids.papeete)!.distance_km!).toBeGreaterThan(15000);
    expect(byId.get(ids.noumea)!.distance_km!).toBeGreaterThan(15000);
    expect(all.facets.distance.located).toBe(2);
    // Seule l'offre sans ville compte parmi les offres « en France sans ville précise ».
    expect(all.facets.distance.unlocated).toBe(1);
    const included = searchOffres({ home: paris, radiusKm: 200, includeUnlocated: true }).offers.map((o) => o.id);
    expect(included).toEqual([ids.sansVille]);
  });

  it("tri « Plus proches » : une offre connue au seul département (« 75 ») vient après toute la ville", () => {
    const paris = communeByCode("75056")!;
    const dept = add("75", "France", 90);
    const ville = [add("Paris", "France", 10), add("Paris 11e", "France", 20)];
    const r = searchOffres({ home: paris, sortBy: "distance" });
    const order = r.offers.map((o) => o.id);
    expect(order.slice(0, 2).sort()).toEqual([...ville].sort());
    expect(order[2]).toBe(dept);
    expect(r.offers[2].same_dept).toBe(true);
    expect(r.facets.distance.counts["0"]).toBe(2);
  });
});
