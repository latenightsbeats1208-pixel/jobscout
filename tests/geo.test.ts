import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  communeByCode,
  haversineKm,
  resolveHomeText,
  resolveOfferLocation,
  suggestCommunes,
  type GeoResult,
} from "@/lib/geo";
import { normalize, NORM_VERSION } from "@/lib/geo/normalize.mjs";
import { FR_ALIASES } from "@/lib/geo/tables";

type In = Parameters<typeof resolveOfferLocation>[0];
const r = (source: string, location: string | null, country: string | null = "France", extra: Partial<In> = {}): GeoResult =>
  resolveOfferLocation({ source, location, country, ...extra });

describe("normalisation", () => {
  it("casse, accents, ligatures, ponctuation, st/ste", () => {
    expect(normalize("Saint-Étienne")).toBe("saint etienne");
    expect(normalize("ST DENIS")).toBe("saint denis");
    expect(normalize("STE GENEVIEVE DES BOIS")).toBe("sainte genevieve des bois");
    expect(normalize("Marcq-en-Barœul")).toBe("marcq en baroeul");
    expect(normalize("L'Haÿ-les-Roses")).toBe("l hay les roses");
    expect(normalize("Côte d’Ivoire")).toBe(normalize("Côte d'Ivoire"));
    expect(normalize("  Villeneuve_d'Ascq / ")).toBe("villeneuve d ascq");
  });

  it("les fichiers de données ont été construits avec la normalisation courante", () => {
    for (const f of ["geo-fr.json.gz", "geo-world.json.gz"]) {
      const data = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(process.cwd(), "lib/geo/data", f))).toString("utf8"));
      expect(data.normVersion, f).toBe(NORM_VERSION);
    }
  });
});

describe("arrondissements", () => {
  it.each([
    ["Paris 01", "75101", "Paris 1er"],
    ["Paris 1er", "75101", "Paris 1er"],
    ["PARIS 08", "75108", "Paris 8e"],
    ["Paris 11e Arrondissement", "75111", "Paris 11e"],
    ["Paris 8e", "75108", "Paris 8e"],
    ["Lyon 3e", "69383", "Lyon 3e"],
    ["Lyon 3e Arrondissement", "69383", "Lyon 3e"],
    ["LYON 07", "69387", "Lyon 7e"],
    ["Marseille 08", "13208", "Marseille 8e"],
  ])("%s → %s", (loc, code, label) => {
    const g = r("francetravail", loc);
    expect(g).toMatchObject({ precision: "arrondissement", code, label });
  });

  it("APEC « Paris 01 » (valeur par défaut) reste au niveau de la ville, les autres numéros non", () => {
    expect(r("apec", "Paris 01", "France", { hint: "Paris 01 - 75" })).toMatchObject({ precision: "commune", code: "75056", label: "Paris (75)" });
    expect(r("apec", "Paris 12", "France", { hint: "Paris 12 - 75" })).toMatchObject({ precision: "arrondissement", code: "75112" });
  });

  it("code postal d'arrondissement", () => {
    expect(r("talent", "75011 Paris")).toMatchObject({ precision: "arrondissement", code: "75111" });
  });
});

describe("indice APEC (lieuTexte)", () => {
  it("le département lève l'homonymie", () => {
    expect(r("apec", "Montreuil", "France", { hint: "Montreuil - 93" })).toMatchObject({ precision: "commune", code: "93048", label: "Montreuil (93)" });
    expect(r("apec", "Saint-Denis", "France", { hint: "Saint-Denis - 974" })).toMatchObject({ precision: "commune", code: "97411", label: "Saint-Denis (974)" });
    expect(r("apec", "Saint-Denis", "France", { hint: "Saint-Denis - 11" })).toMatchObject({ code: "11339" });
  });

  it("nom ancien ou tronqué dans le bon département", () => {
    expect(r("apec", "Saint-Ouen", "France", { hint: "Saint-Ouen - 93" })).toMatchObject({ code: "93070" });
    expect(r("apec", "Éragny", "France", { hint: "Éragny - 95" })).toMatchObject({ code: "95218" });
  });

  it("département seul → point approximatif", () => {
    expect(r("apec", "Yvelines", "France", { hint: "Yvelines - 78" })).toMatchObject({ precision: "departement", code: "78", label: "Yvelines (78)" });
    expect(r("apec", "Corrèze", "France", { hint: "Corrèze - 19" })).toMatchObject({ precision: "departement", code: "19" });
  });
});

describe("homonymes français", () => {
  it("sans département : métropole, signalé « homonyme »", () => {
    for (const [loc, code] of [
      ["Saint-Denis", "93066"],
      ["ST DENIS", "93066"],
      ["Massy", "91377"],
      ["Montreuil", "93048"],
      ["Valence", "26362"],
    ]) {
      expect(r("wttj", loc), loc).toMatchObject({ precision: "homonyme", code });
    }
  });

  it("département donné par l'indice (France Travail : département glissé dans « company »)", () => {
    expect(r("francetravail", "ST DENIS", "France", { hint: "974" })).toMatchObject({ precision: "commune", code: "97411" });
    expect(r("francetravail", "LYON", "France", { hint: "13" })).toMatchObject({ code: "69123" });
  });

  it("hameau de métropole contre grande ville d'outre-mer : l'outre-mer l'emporte, toujours signalé", () => {
    expect(r("francetravail", "Le Port")).toMatchObject({ precision: "homonyme", code: "97407" });
  });

  it("région citée : la commune de cette région", () => {
    expect(r("linkedin", "Saint-Denis, Île-de-France, France", null)).toMatchObject({ precision: "commune", code: "93066" });
  });

  it("une offre française n'est jamais placée à l'étranger par homonymie", () => {
    expect(r("hellowork", "Valence")).toMatchObject({ code: "26362" });
    expect(r("linkedin", "Valence", null)).toMatchObject({ code: "26362" });
    expect(r("wttj", "Bruges", "France")).toMatchObject({ code: "33075" });
    expect(r("linkedin", "Montréal, Québec, Canada", "Canada")).toMatchObject({ precision: "ville", code: "CA", label: "Montréal, Canada" });
    expect(r("wttj", "Montréal", "Canada")).toMatchObject({ precision: "ville", code: "CA" });
  });
});

describe("alias", () => {
  it("toutes les communes cibles existent", () => {
    for (const [name, a] of Object.entries(FR_ALIASES)) expect(communeByCode(a.code), name).not.toBeNull();
  });

  it.each([
    ["La Défense", "92062", "La Défense (92)"],
    ["Sophia Antipolis", "06152", "Sophia Antipolis (06)"],
    ["Sophia-Antipolis", "06152", "Sophia Antipolis (06)"],
    ["Saint-Quentin-en-Yvelines", "78423", "Saint-Quentin-en-Yvelines (78)"],
    ["Cherbourg", "50129", "Cherbourg-en-Cotentin (50)"],
    ["Tassin", "69244", "Tassin-la-Demi-Lune (69)"],
    ["Dunkirk", "59183", "Dunkerque (59)"],
    ["EVRY", "91228", "Évry-Courcouronnes (91)"],
    ["Ville de Paris", "75056", "Paris (75)"],
    ["Saint-Ouen", "93070", "Saint-Ouen-sur-Seine (93)"],
  ])("%s → %s", (loc, code, label) => {
    expect(r("wttj", loc)).toMatchObject({ precision: "commune", code, label });
  });

  it("formes d'agglomération", () => {
    expect(r("linkedin", "Paris et périphérie", null)).toMatchObject({ code: "75056" });
    expect(r("linkedin", "Casablanca et périphérie", null)).toMatchObject({ precision: "ville", code: "MA" });
    expect(r("linkedin", "Grand Tunis Metropolitan Area", null)).toMatchObject({ precision: "ville", code: "TN" });
    expect(r("linkedin", "Région métropolitaine de Birmingham, Alabama", null)).toMatchObject({ precision: "ville", code: "US" });
  });
});

describe("LinkedIn et villes étrangères", () => {
  it("« Luxembourg, Luxembourg, Luxembourg »", () => {
    expect(r("linkedin", "Luxembourg, Luxembourg, Luxembourg", "Luxembourg")).toMatchObject({ precision: "ville", code: "LU", label: "Luxembourg" });
  });
  it("« Abidjan, Côte d’Ivoire »", () => {
    expect(r("linkedin", "Abidjan, Côte d’Ivoire", "Côte d'Ivoire")).toMatchObject({ precision: "ville", code: "CI", label: "Abidjan, Côte d’Ivoire" });
  });
  it("« Monaco, Monaco »", () => {
    expect(r("linkedin", "Monaco, Monaco", "Monaco")).toMatchObject({ precision: "ville", code: "MC", label: "Monaco" });
  });
  it("repli segment par segment et nom français", () => {
    expect(r("linkedin", "Cocody, Abidjan, Côte d’Ivoire", "Côte d'Ivoire")).toMatchObject({ precision: "ville", code: "CI" });
    expect(r("linkedin", "Tunis, Gouvernorat Tunis, Tunisie", "Tunisie")).toMatchObject({ precision: "ville", label: "Tunis, Tunisie" });
    expect(r("linkedin", "Bruxelles, Région de Bruxelles-Capitale, Belgique", "Belgique")).toMatchObject({ label: "Bruxelles, Belgique" });
    expect(r("talent", "brussel, brussel hoofdstad, Belgium", "Belgique")).toMatchObject({ label: "Bruxelles, Belgique" });
  });
  it("pays du dernier segment quand le champ pays est vide", () => {
    expect(r("linkedin", "Dakar, Sénégal", null)).toMatchObject({ precision: "ville", code: "SN" });
  });
  it("État américain : obligatoire quand il est cité", () => {
    expect(r("wttj", "San Mateo, CA", "États-Unis")).toMatchObject({ precision: "ville", code: "US" });
    const houston = r("linkedin", "Houston, Texas, États-Unis", "États-Unis");
    expect(houston).toMatchObject({ precision: "ville", code: "US" });
    expect(houston.lng).toBeLessThan(-90);
  });
  it("le texte prime sur un champ pays forcé à France", () => {
    expect(r("apec", "Belgique", "France", { hint: "Belgique" })).toMatchObject({ precision: "pays", label: "Belgique", lat: null });
  });
});

describe("niveaux non placés", () => {
  it("pays seul → GeoNone pays", () => {
    expect(r("francetravail", "France")).toEqual({ lat: null, lng: null, precision: "pays", label: "France", country: "FR" });
    expect(r("linkedin", "Rwanda", "Rwanda")).toMatchObject({ precision: "pays", label: "Rwanda", lat: null });
    expect(r("talent", null, "Suisse")).toMatchObject({ precision: "pays", label: "Suisse", lat: null });
  });
  it("région → GeoNone region", () => {
    expect(r("linkedin", "Île-de-France", null)).toEqual({ lat: null, lng: null, precision: "region", label: "Île-de-France", country: "FR" });
    expect(r("linkedin", "Occitanie, France", "France")).toMatchObject({ precision: "region", label: "Occitanie" });
  });
  it("département → point approximatif", () => {
    const g = r("hellowork", "Yvelines");
    expect(g).toMatchObject({ precision: "departement", code: "78", label: "Yvelines (78)" });
    expect(g.lat).toBeGreaterThan(48.6);
    expect(r("francetravail", "13")).toMatchObject({ precision: "departement", code: "13" });
  });
  it("rien → inconnu", () => {
    expect(r("linkedin", null, null)).toEqual({ lat: null, lng: null, precision: "inconnu", label: null });
  });
});

describe("Talent : lieu lu dans l'en-tête", () => {
  it("« Entreprise • Ville, Région, Pays »", () => {
    const head = "(Stage) - Chargé(e) de marketing H/F\n\nEntreprise Exemple • Paris, Île-de-France, France\n Il y a plus de 30 jours";
    expect(r("talent", null, "France", { head })).toMatchObject({ precision: "commune", code: "75056" });
    const be = "Marketeur\n\nExemple BV • Nivelles, Walloon Region, Belgium\n Minder dan 1 uur geleden";
    expect(r("talent", null, "Belgique", { head: be })).toMatchObject({ precision: "ville", code: "BE" });
  });
  it("« Renens (VD) » seulement si le lieu est dans le pays de l'offre", () => {
    const head = "Cheffe de projet génie civil\nRejoignez notre équipe d'ingénierie.\nCheffe de projet génie civil\nRenens (VD)\nEntrée à convenir";
    expect(r("talent", null, "Suisse", { head })).toMatchObject({ precision: "ville", code: "CH", label: "Renens, Suisse" });
  });
  it("sans en-tête exploitable → pays", () => {
    expect(r("talent", null, "Belgique", { head: "Bedrijfsinformatie\n\nEen voorbeeldbedrijf." })).toMatchObject({ precision: "pays", label: "Belgique" });
  });
});

describe("WTTJ : télétravail complet", () => {
  it("fulltime sans lieu placé → inconnu « Télétravail complet »", () => {
    expect(r("wttj", null, "États-Unis", { hint: "fulltime" })).toEqual({ lat: null, lng: null, precision: "inconnu", label: "Télétravail complet" });
  });
  it("fulltime avec un lieu : le lieu reste placé", () => {
    expect(r("wttj", "Paris", "France", { hint: "fulltime" })).toMatchObject({ precision: "commune", code: "75056" });
  });
  it("autres valeurs : ignorées", () => {
    expect(r("wttj", null, "États-Unis", { hint: "partial" })).toMatchObject({ precision: "pays", label: "États-Unis" });
  });
});

describe("mémoïsation", () => {
  it("même entrée → même objet", () => {
    const a = r("wttj", "Lyon");
    const b = r("wttj", "Lyon");
    expect(a).toBe(b);
    expect(Object.isFrozen(a)).toBe(true);
  });
});

describe("ville de l'utilisateur", () => {
  it("suggestCommunes « boulogne »", () => {
    const s = suggestCommunes("boulogne");
    expect(s.length).toBeGreaterThan(1);
    expect(s.length).toBeLessThanOrEqual(8);
    expect(s[0]).toMatchObject({ code: "92012", label: "Boulogne-Billancourt (92)" });
    expect(s.map((x) => x.code)).toContain("62160"); // Boulogne-sur-Mer
  });
  it("suggestCommunes « 92100 »", () => {
    const s = suggestCommunes("92100");
    expect(s[0]).toMatchObject({ code: "92012" });
    expect(s[0].cps).toContain("92100");
  });
  it("suggestCommunes « st denis 93 » et « saint-denis (93) »", () => {
    expect(suggestCommunes("st denis 93")[0]).toMatchObject({ code: "93066", label: "Saint-Denis (93)" });
    expect(suggestCommunes("saint-denis (93)")[0]).toMatchObject({ code: "93066" });
    expect(suggestCommunes("st denis")[0]).toMatchObject({ code: "93066" });
  });
  it("suggestCommunes « lyon », « paris 11 », préfixe de code postal", () => {
    expect(suggestCommunes("lyon")[0]).toMatchObject({ code: "69123", label: "Lyon (69)" });
    expect(suggestCommunes("paris 11")[0]).toMatchObject({ code: "75111", label: "Paris 11e" });
    const cp = suggestCommunes("690", 20);
    expect(cp.length).toBeGreaterThan(0);
    expect(cp.every((c) => c.cps.some((x) => x.startsWith("690")))).toBe(true);
    expect(suggestCommunes("")).toEqual([]);
    expect(suggestCommunes("lyon", 3)).toHaveLength(3);
  });
  it("suggestCommunes est rapide (< 5 ms par requête, index prêts)", () => {
    suggestCommunes("x");
    // Meilleur de 5 essais : la suite complète tourne en parallèle et un seul
    // essai mesure surtout l'ordonnanceur.
    for (const q of ["b", "sa", "saint", "boulogne", "92100", "st denis 93", "villeneuve d", "e"]) {
      let bestMs = Infinity;
      for (let k = 0; k < 5; k++) {
        const t = performance.now();
        suggestCommunes(q);
        bestMs = Math.min(bestMs, performance.now() - t);
      }
      expect(bestMs, q).toBeLessThan(5);
    }
  });
  it("communeByCode", () => {
    expect(communeByCode("75056")).toMatchObject({ label: "Paris (75)", lat: 48.8589, lng: 2.347 });
    expect(communeByCode("00000")).toBeNull();
  });
  it("resolveHomeText", () => {
    expect(resolveHomeText("Lyon, France")).toMatchObject({ code: "69123", label: "Lyon (69)" });
    expect(resolveHomeText("92100 Boulogne")).toMatchObject({ code: "92012" });
    expect(resolveHomeText("Paris 11e")).toMatchObject({ code: "75111" });
    expect(resolveHomeText("Saint-Denis (93)")).toMatchObject({ code: "93066" });
    expect(resolveHomeText("Genève, Suisse")).toBeNull();
    expect(resolveHomeText("Île-de-France")).toBeNull();
    expect(resolveHomeText("")).toBeNull();
  });
});

describe("haversineKm", () => {
  it("Paris–Lyon ≈ 391 km", () => {
    const paris = communeByCode("75056")!;
    const lyon = communeByCode("69123")!;
    expect(Math.abs(haversineKm(paris, lyon) - 391)).toBeLessThanOrEqual(3);
    expect(haversineKm(paris, paris)).toBe(0);
  });
});

describe("micro-États sans lieu (Talent)", () => {
  it("pays Luxembourg sans lieu ni en-tête : la ville de Luxembourg", () => {
    const r = resolveOfferLocation({ source: "talent", location: null, country: "Luxembourg", head: "Description du poste" });
    expect(r.lat).not.toBeNull();
    expect(r.label).toContain("Luxembourg");
  });
});

describe("collectivités d'outre-mer non géolocalisées (975, 977, 978, 984, 986, 989)", () => {
  // Centres retirés de la base (scripts/build-geo.mjs, NON_GEOLOCALISEES) ; noms et codes gardés.
  const COLLECTIVITES = ["975", "977", "978", "984", "986", "989"];
  const SANS_CENTRE = ["97501", "97502", "97701", "97801", "98411", "98412", "98413", "98414", "98415", "98611", "98612", "98613", "98901"];
  type FrData = { communes: [string, string, string, string[], number | null, number | null, number, string][]; deps: [string, string, number | null, number | null, string, string][] };
  const frData = (): FrData => JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(process.cwd(), "lib/geo/data", "geo-fr.json.gz"))).toString("utf8"));
  const none = (label: string, country: string) => ({ lat: null, lng: null, precision: "inconnu", label, country });

  it("données : ces 13 communes et le point de leur collectivité sont sans coordonnées, et ce sont les seules", () => {
    const data = frData();
    expect(data.communes.filter((c) => c[4] === null || c[5] === null).map((c) => c[0])).toEqual(SANS_CENTRE);
    expect(data.communes.filter((c) => COLLECTIVITES.includes(c[2])).map((c) => c[0])).toEqual(SANS_CENTRE);
    expect(data.deps.filter((d) => d[2] === null || d[3] === null).map((d) => d[0]).sort()).toEqual(COLLECTIVITES);
    for (const dep of ["987", "988"]) {
      const list = data.communes.filter((c) => c[2] === dep);
      expect(list.length, dep).toBeGreaterThan(30);
      expect(list.every((c) => typeof c[4] === "number" && typeof c[5] === "number"), dep).toBe(true);
    }
  });

  it("ni ville de référence possible, ni suggestion", () => {
    for (const code of SANS_CENTRE) expect(communeByCode(code), code).toBeNull();
    expect(suggestCommunes("97133")).toEqual([]);
    expect(suggestCommunes("saint barth", 20).map((s) => s.code)).not.toContain("97701");
    expect(suggestCommunes("saint pierre", 20).map((s) => s.code)).not.toContain("97502");
    expect(suggestCommunes("saint pierre", 20).map((s) => s.code)).toContain("97416");
    expect(resolveHomeText("Saint-Pierre (975)")).toBeNull();
    expect(resolveHomeText("97150 Saint-Martin")).toBeNull();
  });

  it("une offre à Saint-Barthélemy n'est pas placée, ni prise pour un homonyme de métropole", () => {
    const stb = none("Saint-Barthélemy (977)", "BL");
    expect(r("linkedin", "Saint-Barthélemy", "Saint-Barthélemy")).toEqual(stb);
    expect(r("linkedin", "Gustavia", "Saint-Barthélemy")).toEqual(stb);
    expect(r("francetravail", "977 - ST BARTHELEMY")).toEqual(stb);
    expect(r("hellowork", "97133 Saint-Barthélemy")).toEqual(stb);
    expect(r("francetravail", "ST BARTHELEMY", "France", { hint: "977" })).toEqual(stb);
    expect(r("apec", "Saint-Barthélemy", "France", { hint: "Saint-Barthélemy - 977" })).toEqual(stb);
    // Le village du Morbihan, quand il est désigné, reste placé.
    expect(r("hellowork", "Saint-Barthélemy (56)")).toMatchObject({ precision: "commune", code: "56207" });
  });

  it("une offre à Saint-Pierre-et-Miquelon (975) n'est pas placée, ni prise pour Saint-Pierre (La Réunion)", () => {
    const sp = none("Saint-Pierre (975)", "PM");
    const cases: [string, string | null, Partial<In>][] = [
      ["Saint-Pierre (975)", "France", {}],
      ["975 - ST PIERRE", "France", {}],
      ["97500 Saint-Pierre", "France", {}],
      ["Saint-Pierre, Saint-Pierre-et-Miquelon", null, {}],
      ["Saint-Pierre", "Saint-Pierre-et-Miquelon", {}],
      ["ST PIERRE", "France", { hint: "975" }],
    ];
    for (const [loc, country, extra] of cases) expect(r("francetravail", loc, country, extra), loc).toEqual(sp);
    expect(r("hellowork", "Miquelon-Langlade")).toEqual(none("Miquelon-Langlade (975)", "PM"));
    expect(r("linkedin", "Saint-Pierre-et-Miquelon", null)).toEqual(none("Saint-Pierre-et-Miquelon (975)", "PM"));
    // Sans indice, « Saint-Pierre » reste la commune de La Réunion (homonyme), et « Saint-Pierre (974) » aussi.
    expect(r("francetravail", "Saint-Pierre")).toMatchObject({ precision: "homonyme", code: "97416" });
    expect(r("francetravail", "Saint-Pierre (974)")).toMatchObject({ precision: "commune", code: "97416" });
  });

  it("Saint-Martin, Wallis-et-Futuna, Terres australes, Clipperton : reconnus, non placés", () => {
    // « Saint-Martin » seul : la collectivité (31 160 habitants) plutôt qu'un village de métropole, comme avant.
    expect(r("francetravail", "Saint-Martin")).toEqual(none("Saint-Martin (978)", "MF"));
    expect(r("linkedin", "Marigot", "Saint-Martin")).toEqual(none("Saint-Martin (978)", "MF"));
    expect(r("hellowork", "Saint-Martin (65)")).toMatchObject({ precision: "commune", code: "65392" });
    expect(r("linkedin", "Mata-Utu, Wallis-et-Futuna", null)).toEqual(none("Wallis-et-Futuna (986)", "WF"));
    expect(r("hellowork", "98600 Uvea")).toEqual(none("Uvea (986)", "WF"));
    expect(r("linkedin", "Archipel des Kerguelen", null)).toEqual(none("Archipel des Kerguelen (984)", "TF"));
    expect(r("linkedin", "Île de Clipperton", null)).toEqual(none("Île de Clipperton (989)", "CP"));
  });

  it("Polynésie française (987) et Nouvelle-Calédonie (988) restent placées", () => {
    const papeete = r("linkedin", "Papeete, Polynésie française", null);
    expect(papeete).toMatchObject({ precision: "commune", code: "98735", label: "Papeete (987)" });
    expect(papeete.lat).toBeLessThan(-17);
    expect(r("wttj", "Papeete", "Polynésie française")).toMatchObject({ precision: "commune", code: "98735" });
    const noumea = r("francetravail", "Nouméa");
    expect(noumea).toMatchObject({ precision: "commune", code: "98818", label: "Nouméa (988)" });
    expect(noumea.lng).toBeGreaterThan(166);
    expect(r("wttj", "Nouméa", "Nouvelle-Calédonie")).toMatchObject({ precision: "commune", code: "98818" });
    expect(r("linkedin", "Nouvelle-Calédonie", null)).toMatchObject({ precision: "departement", code: "988" });
    expect(communeByCode("98735")).toMatchObject({ label: "Papeete (987)" });
    expect(communeByCode("98818")).toMatchObject({ label: "Nouméa (988)" });
  });

  it("chaque collectivité d'outre-mer encore placée a le producteur de ses contours nommé dans THIRD_PARTY_NOTICES.txt", () => {
    // Leurs contours ne viennent pas d'IGN ADMIN EXPRESS : un point embarqué sans producteur nommé n'est pas attribué.
    const COM = ["975", "977", "978", "984", "986", "987", "988", "989"];
    const PRODUCTEURS: Record<string, string> = {
      "987": "https://www.data.gouv.fr/fr/datasets/geographie-administrative-de-la-polynesie-francaise/",
      "988": "https://georep-dtsi-sgt.opendata.arcgis.com/datasets/dtsi-sgt::limites-administratives-terrestres-1/",
    };
    const data = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(process.cwd(), "lib/geo/data", "geo-fr.json.gz"))).toString("utf8"));
    const notices = fs.readFileSync(path.join(process.cwd(), "THIRD_PARTY_NOTICES.txt"), "utf8");
    const placed = new Set<string>();
    for (const c of data.communes as [string, string, string, string[], number | null, number | null][]) {
      if (COM.includes(c[2]) && (c[4] !== null || c[5] !== null)) placed.add(c[2]);
    }
    for (const d of data.deps as [string, string, number | null, number | null][]) {
      if (COM.includes(d[0]) && (d[2] !== null || d[3] !== null)) placed.add(d[0]);
    }
    expect([...placed].sort()).toEqual(Object.keys(PRODUCTEURS).sort());
    for (const [code, url] of Object.entries(PRODUCTEURS)) expect(notices, code).toContain(url);
  });
});

describe("licence des données géographiques", () => {
  const ODBL_URL = "https://opendatacommons.org/licenses/odbl/1-0/";
  const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), "utf8");
  const flat = (s: string) => s.replace(/\s+/g, " ");
  /** Texte de la notice sous l'intitulé encadré « lib/geo/data/<fichier> - … », jusqu'à l'intitulé suivant. */
  const section = (notices: string, file: string) => {
    const parts = notices.split(/^-{75}$/m);
    const i = parts.findIndex((p) => p.trim().startsWith(`lib/geo/data/${file} - `));
    return i >= 0 && i + 1 < parts.length ? parts[i + 1] : "";
  };
  const declaresOdbl = (text: string) =>
    flat(text).includes(`la base de donnees lib/geo/data/geo-fr.json.gz est mise a disposition sous Open Database License (ODbL) 1.0 - ${ODBL_URL}`);
  /** Légende d'attribution de la fenêtre « Ville de référence » : texte affiché et liens (intitulé → adresse). */
  const legend = (tsx: string) => {
    const html = tsx.match(/<p[^>]*>\s*(Distances à vol d’oiseau[\s\S]*?)<\/p>/)?.[1] ?? "";
    const links: Record<string, string> = {};
    for (const a of html.matchAll(/<a href="([^"]+)"[^>]*>([^<]+)<\/a>/g)) links[a[2]] = a[1];
    return { text: flat(html.replace(/<[^>]+>/g, "")).trim(), links };
  };

  it("THIRD_PARTY_NOTICES.txt déclare geo-fr.json.gz sous ODbL 1.0 (lien, avis, méthode) et la légende de l'interface mentionne ODbL", () => {
    const notices = read("THIRD_PARTY_NOTICES.txt");
    const fr = section(notices, "geo-fr.json.gz");
    const world = section(notices, "geo-world.json.gz");
    expect(fr.length).toBeGreaterThan(500);
    expect(world.length).toBeGreaterThan(200);
    expect(declaresOdbl(fr)).toBe(true);
    // Témoin négatif : la même section sans la licence ODbL ne passe pas.
    expect(declaresOdbl(fr.replace("Open Database License (ODbL) 1.0", "Licence Ouverte 2.0"))).toBe(false);
    expect(flat(fr)).toContain('Contient des informations issues du jeu de donnees "Contours administratifs" (Etalab, data.gouv.fr), disponible sous Open Database License (ODbL)');
    expect(flat(fr)).toContain("(ODbL 1.0, article 4.6)");
    expect(flat(fr)).toContain("scripts/build-geo.mjs");
    // geo-world.json.gz reste GeoNames (CC BY 4.0) et INSEE.
    expect(declaresOdbl(world)).toBe(false);
    expect(flat(world)).toContain("Ce fichier n'est pas sous ODbL");
    expect(flat(world)).toContain("Licence Creative Commons Attribution 4.0 International (CC BY 4.0)");

    // L'en-tête du fichier embarqué déclare la même licence.
    const data = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(process.cwd(), "lib/geo/data", "geo-fr.json.gz"))).toString("utf8"));
    expect(data.sources).toContain(`Open Database License (ODbL) 1.0 — ${ODBL_URL}`);

    const { text, links } = legend(read("components/app/distance-home.tsx"));
    expect(text).toContain("contient des données sous licence ODbL");
    expect(links.ODbL).toBe(ODBL_URL);
    expect(links["CC BY 4.0"]).toBe("https://creativecommons.org/licenses/by/4.0/");
    for (const mot of ["INSEE", "La Poste", "IGN", "Etalab", "GeoNames", "données modifiées", "THIRD_PARTY_NOTICES.txt"]) expect(text, mot).toContain(mot);
  });
});
