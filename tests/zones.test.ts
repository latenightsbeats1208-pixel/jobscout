import { beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import { searchOffres, setOffreScore, upsertOffreFromSource, type ScrapedOffre } from "@/lib/db/offres";
import { nameToCode } from "@/lib/countries";
import { ZONES, inZones, searchLocations } from "@/lib/zones";
import { getSearchZoneIds, getSearchZones, setSearchZoneIds } from "@/lib/zones-store";
import { departementChunks } from "@/lib/scrapers/francetravail";

let seq = 0;
function add(location: string, country = "France", source = "hellowork"): number {
  seq++;
  const offre: ScrapedOffre = {
    source_id: `z-${seq}`, url: `https://example.org/z/${seq}`, title: `Poste ${seq}`, company: "Exemple",
    country, location, contract_type: "CDI", salary: null, description_html: "<p>x</p>", description_text: "Poste en CDI.",
    description_status: "ok", posted_at: "2026-01-15", is_vie: false, raw_payload: {},
  };
  const id = upsertOffreFromSource(source, offre);
  setOffreScore(id, { score: 50, breakdown: { sector: 0, skills: 0, country: 0 }, reason: "r" });
  return id;
}

beforeEach(() => {
  getDb().exec("DELETE FROM documents; DELETE FROM offres;");
  setSearchZoneIds([]);
});

describe("zones", () => {
  it("appartenance : rayon autour des centres, département pour les offres peu précises", () => {
    const paris = [ZONES.paris];
    expect(inZones({ lat: 48.8049, lng: 2.1204, precision: "commune", code: "78646" }, paris)).toBe(true); // Versailles
    expect(inZones({ lat: 49.4432, lng: 1.0999, precision: "commune", code: "76540" }, paris)).toBe(false); // Rouen
    expect(inZones({ lat: 48.6, lng: 2.4, precision: "departement", code: "91" }, paris)).toBe(true);
    expect(inZones({ lat: 49.2, lng: 4.0, precision: "departement", code: "51" }, paris)).toBe(false);
    expect(inZones({ lat: 46.5197, lng: 6.6323, precision: "ville", code: "CH" }, [ZONES.romandie])).toBe(true); // Lausanne
    expect(inZones({ lat: 47.3769, lng: 8.5417, precision: "ville", code: "CH" }, [ZONES.romandie])).toBe(false); // Zurich
    expect(inZones({ lat: null, lng: null, precision: "inconnu", code: null }, paris)).toBe(false);
  });

  it("lieux de recherche : zones à la place de leur pays, autres pays inchangés", () => {
    const locs = searchLocations(["France", "Belgique"], [ZONES.lyon, ZONES.romandie], "linkedin", nameToCode).map((l) => l.location);
    expect(locs).toContain("Lyon, Auvergne-Rhône-Alpes, France");
    expect(locs).toContain("Geneva, Switzerland");
    expect(locs).toContain("Belgique");
    expect(locs).not.toContain("France");
    expect(searchLocations(["France"], [], "talent", nameToCode)).toEqual([{ location: "France", country: "FR" }]);
    expect(searchLocations([], [], "talent", nameToCode)).toEqual([{ location: "", country: null }]);
  });

  it("France Travail : départements des zones par paquets de 5", () => {
    expect(departementChunks({ sectors: [], countries: [] })).toEqual([null]);
    expect(departementChunks({ sectors: [], countries: [], zones: [ZONES.paris, ZONES.lyon, ZONES.romandie] })).toEqual([
      ["75", "92", "93", "94", "77"],
      ["78", "91", "95", "69"],
    ]);
  });

  it("réglage enregistré, identifiants inconnus ignorés", () => {
    expect(setSearchZoneIds(["lyon", "nope", "lyon", "romandie"])).toEqual(["lyon", "romandie"]);
    expect(getSearchZoneIds()).toEqual(["lyon", "romandie"]);
    expect(getSearchZones().map((z) => z.label)).toEqual(["Lyon et agglomération", "Suisse romande"]);
  });

  it("filtre « Mes zones » de la liste des offres", () => {
    const villeurbanne = add("Villeurbanne (69)");
    const geneve = add("Genève", "Suisse", "talent");
    add("Marseille (13)");
    add("Zurich", "Suisse", "talent");
    const zones = [ZONES.lyon, ZONES.romandie];
    const all = searchOffres({ zones });
    expect(all.total).toBe(4);
    expect(all.facets.zones.count).toBe(2);
    const only = searchOffres({ zones, zonesOnly: true });
    expect(only.offers.map((o) => o.id).sort()).toEqual([villeurbanne, geneve].sort());
    // Sans zone configurée : aucun filtre, même demandé.
    expect(searchOffres({ zonesOnly: true }).total).toBe(4);
  });
});
