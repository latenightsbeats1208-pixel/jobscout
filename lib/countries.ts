// Pays cibles disponibles, regroupés par région.
// Couvre largement les destinations V.I.E listées par Business France / Civiweb.

export type CountryGroup = {
  region: string;
  countries: string[]; // noms français (= valeur stockée dans le profil)
};

export const COUNTRY_GROUPS: CountryGroup[] = [
  {
    region: "Europe de l'Ouest",
    countries: [
      "France", "Belgique", "Suisse", "Allemagne", "Pays-Bas", "Luxembourg",
      "Royaume-Uni", "Irlande", "Espagne", "Portugal", "Italie", "Autriche",
      "Monaco",
    ],
  },
  {
    region: "Europe du Nord",
    countries: ["Suède", "Norvège", "Danemark", "Finlande", "Islande"],
  },
  {
    region: "Europe Centrale & Est",
    countries: [
      "Pologne", "Tchéquie", "Slovaquie", "Hongrie", "Roumanie", "Bulgarie",
      "Slovénie", "Croatie", "Serbie", "Ukraine", "Lituanie", "Lettonie", "Estonie",
    ],
  },
  {
    region: "Europe du Sud / Méditerranée",
    countries: ["Grèce", "Chypre", "Malte", "Turquie"],
  },
  {
    region: "Amérique du Nord & Caraïbes",
    countries: ["États-Unis", "Canada", "Mexique", "Haïti"],
  },
  {
    region: "Amérique Latine",
    countries: [
      "Brésil", "Argentine", "Chili", "Colombie", "Pérou", "Uruguay",
      "Costa Rica", "Panama", "Équateur", "République Dominicaine",
    ],
  },
  {
    region: "Asie",
    countries: [
      "Chine", "Hong Kong", "Singapour", "Japon", "Corée du Sud", "Taïwan",
      "Inde", "Vietnam", "Thaïlande", "Indonésie", "Malaisie", "Philippines",
    ],
  },
  {
    region: "Moyen-Orient",
    countries: [
      "Émirats arabes unis", "Qatar", "Arabie saoudite", "Bahreïn", "Koweït",
      "Oman", "Israël", "Liban", "Jordanie",
    ],
  },
  {
    region: "Afrique",
    countries: [
      "Maroc", "Tunisie", "Algérie", "Égypte",
      "Sénégal", "Côte d'Ivoire", "Cameroun", "Kenya", "Nigéria", "Ghana",
      "Afrique du Sud", "Île Maurice", "Madagascar", "Mauritanie",
      "Bénin", "Togo", "Burkina Faso", "Mali", "Niger", "Guinée",
      "Gabon", "Congo", "République Démocratique du Congo", "Tchad",
      "Rwanda", "Burundi", "Djibouti",
    ],
  },
  {
    region: "Océanie",
    countries: ["Australie", "Nouvelle-Zélande", "Nouvelle-Calédonie", "Polynésie française"],
  },
];

export const ALL_COUNTRIES: string[] = COUNTRY_GROUPS.flatMap((g) => g.countries);

// Pays de la francophonie pertinents pour une recherche d'emploi (OIF + français
// langue de travail). Utilisé comme préréglage « Francophonie » dans les préférences.
export const FRANCOPHONIE: string[] = [
  "France", "Belgique", "Suisse", "Luxembourg", "Monaco",
  "Canada", "Haïti",
  "Maroc", "Tunisie", "Algérie",
  "Sénégal", "Côte d'Ivoire", "Cameroun", "Bénin", "Togo",
  "Burkina Faso", "Mali", "Niger", "Guinée", "Gabon",
  "Congo", "République Démocratique du Congo", "Tchad",
  "Rwanda", "Burundi", "Djibouti", "Madagascar", "Île Maurice", "Mauritanie",
  "Liban",
  "Nouvelle-Calédonie", "Polynésie française",
];

// ISO 3166-1 alpha-2 codes
export const COUNTRY_NAME_TO_CODE: Record<string, string> = {
  // Europe Ouest
  france: "FR", belgique: "BE", suisse: "CH", allemagne: "DE",
  "pays-bas": "NL", luxembourg: "LU",
  "royaume-uni": "GB", irlande: "IE",
  espagne: "ES", portugal: "PT", italie: "IT", autriche: "AT", monaco: "MC",
  // Nord
  suede: "SE", "suède": "SE", norvege: "NO", "norvège": "NO",
  danemark: "DK", finlande: "FI", islande: "IS",
  // Centre/Est
  pologne: "PL", tchequie: "CZ", "tchéquie": "CZ", slovaquie: "SK",
  hongrie: "HU", roumanie: "RO", bulgarie: "BG", slovenie: "SI", "slovénie": "SI",
  croatie: "HR", serbie: "RS", ukraine: "UA",
  lituanie: "LT", lettonie: "LV", estonie: "EE",
  // Sud/Med
  grece: "GR", "grèce": "GR", chypre: "CY", malte: "MT", turquie: "TR",
  // Amérique Nord
  "etats-unis": "US", "états-unis": "US", canada: "CA", mexique: "MX",
  // Amérique Latine
  bresil: "BR", "brésil": "BR", argentine: "AR", chili: "CL",
  colombie: "CO", perou: "PE", "pérou": "PE", uruguay: "UY",
  "costa rica": "CR", panama: "PA", equateur: "EC", "équateur": "EC",
  "republique dominicaine": "DO", "république dominicaine": "DO",
  // Asie
  chine: "CN", "hong kong": "HK", singapour: "SG", japon: "JP",
  "coree du sud": "KR", "corée du sud": "KR", taiwan: "TW", "taïwan": "TW",
  inde: "IN", vietnam: "VN", thailande: "TH", "thaïlande": "TH",
  indonesie: "ID", "indonésie": "ID", malaisie: "MY", philippines: "PH",
  // Moyen-Orient
  "emirats arabes unis": "AE", "émirats arabes unis": "AE",
  qatar: "QA", "arabie saoudite": "SA", bahrein: "BH", "bahreïn": "BH",
  koweit: "KW", "koweït": "KW", oman: "OM",
  israel: "IL", "israël": "IL", liban: "LB", jordanie: "JO",
  // Afrique
  maroc: "MA", tunisie: "TN", algerie: "DZ", "algérie": "DZ", egypte: "EG", "égypte": "EG",
  senegal: "SN", "sénégal": "SN", "cote d'ivoire": "CI", "côte d'ivoire": "CI",
  cameroun: "CM", kenya: "KE", nigeria: "NG", "nigéria": "NG", ghana: "GH",
  "afrique du sud": "ZA", "ile maurice": "MU", "île maurice": "MU",
  madagascar: "MG", mauritanie: "MR",
  benin: "BJ", "bénin": "BJ", togo: "TG", "burkina faso": "BF",
  mali: "ML", niger: "NE", guinee: "GN", "guinée": "GN", gabon: "GA",
  congo: "CG", "republique du congo": "CG", "congo-brazzaville": "CG", "congo brazzaville": "CG",
  "rdc": "CD", "congo-kinshasa": "CD", "republique democratique du congo": "CD",
  "république démocratique du congo": "CD", tchad: "TD",
  rwanda: "RW", burundi: "BI", djibouti: "DJ",
  haiti: "HT", "haïti": "HT",
  // Océanie
  australie: "AU", "nouvelle-zelande": "NZ", "nouvelle-zélande": "NZ",
  "nouvelle-caledonie": "NC", "nouvelle-calédonie": "NC",
  "polynesie francaise": "PF", "polynésie française": "PF",
};

export const COUNTRY_CODE_TO_NAME: Record<string, string> = {
  FR: "France", BE: "Belgique", CH: "Suisse", DE: "Allemagne",
  NL: "Pays-Bas", LU: "Luxembourg", GB: "Royaume-Uni", UK: "Royaume-Uni",
  IE: "Irlande", ES: "Espagne", PT: "Portugal", IT: "Italie", AT: "Autriche",
  MC: "Monaco",
  SE: "Suède", NO: "Norvège", DK: "Danemark", FI: "Finlande", IS: "Islande",
  PL: "Pologne", CZ: "Tchéquie", SK: "Slovaquie", HU: "Hongrie", RO: "Roumanie",
  BG: "Bulgarie", SI: "Slovénie", HR: "Croatie", RS: "Serbie", UA: "Ukraine",
  LT: "Lituanie", LV: "Lettonie", EE: "Estonie",
  GR: "Grèce", CY: "Chypre", MT: "Malte", TR: "Turquie",
  US: "États-Unis", CA: "Canada", MX: "Mexique",
  BR: "Brésil", AR: "Argentine", CL: "Chili", CO: "Colombie", PE: "Pérou",
  UY: "Uruguay", CR: "Costa Rica", PA: "Panama", EC: "Équateur", DO: "République Dominicaine",
  CN: "Chine", HK: "Hong Kong", SG: "Singapour", JP: "Japon", KR: "Corée du Sud",
  TW: "Taïwan", IN: "Inde", VN: "Vietnam", TH: "Thaïlande", ID: "Indonésie",
  MY: "Malaisie", PH: "Philippines",
  AE: "Émirats arabes unis", QA: "Qatar", SA: "Arabie saoudite", BH: "Bahreïn",
  KW: "Koweït", OM: "Oman", IL: "Israël", LB: "Liban", JO: "Jordanie",
  MA: "Maroc", TN: "Tunisie", DZ: "Algérie", EG: "Égypte",
  SN: "Sénégal", CI: "Côte d'Ivoire", CM: "Cameroun", KE: "Kenya",
  NG: "Nigéria", GH: "Ghana", ZA: "Afrique du Sud", MU: "Île Maurice",
  MG: "Madagascar", MR: "Mauritanie",
  BJ: "Bénin", TG: "Togo", BF: "Burkina Faso", ML: "Mali", NE: "Niger",
  GN: "Guinée", GA: "Gabon", CG: "Congo", CD: "République Démocratique du Congo",
  TD: "Tchad", RW: "Rwanda", BI: "Burundi", DJ: "Djibouti", HT: "Haïti",
  AU: "Australie", NZ: "Nouvelle-Zélande", NC: "Nouvelle-Calédonie",
  PF: "Polynésie française",
};

function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    // Apostrophes typographiques (’ ‘ ‛) → apostrophe droite : « Côte d’Ivoire » = « Côte d'Ivoire »
    .replace(/[\u2018\u2019\u201b\u0060]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

// Noms anglais (et variantes) rencontrés dans les sources internationales
// (WTTJ Algolia, LinkedIn, JSON-LD) → code ISO, pour ramener au nom français canonique.
const ENGLISH_COUNTRY_ALIASES: Record<string, string> = {
  "united states": "US", "united states of america": "US", usa: "US", "u.s.": "US", "u.s.a.": "US",
  "united kingdom": "GB", uk: "GB", "great britain": "GB", england: "GB", scotland: "GB",
  germany: "DE", spain: "ES", italy: "IT", belgium: "BE", switzerland: "CH", netherlands: "NL",
  "the netherlands": "NL", portugal: "PT", ireland: "IE", austria: "AT", poland: "PL",
  sweden: "SE", norway: "NO", denmark: "DK", finland: "FI", czechia: "CZ", "czech republic": "CZ",
  greece: "GR", turkey: "TR", morocco: "MA", tunisia: "TN", algeria: "DZ", egypt: "EG",
  senegal: "SN", "ivory coast": "CI", "cote d'ivoire": "CI", cameroon: "CM", lebanon: "LB",
  mauritius: "MU", "south africa": "ZA", "united arab emirates": "AE", "saudi arabia": "SA",
  japan: "JP", china: "CN", singapore: "SG", "south korea": "KR", india: "IN", australia: "AU",
  "new zealand": "NZ", brazil: "BR", mexico: "MX", argentina: "AR", colombia: "CO", chile: "CL",
  quebec: "CA", "québec": "CA",
};

/**
 * Nom de pays canonique (français) à partir d'un code ISO, d'un nom français
 * ou d'un nom anglais. Inconnu → chaîne d'origine (jamais null si non vide).
 */
export function normalizeCountryName(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.length === 2) return COUNTRY_CODE_TO_NAME[trimmed.toUpperCase()] ?? trimmed;
  const key = norm(trimmed);
  const code = COUNTRY_NAME_TO_CODE[key] ?? ENGLISH_COUNTRY_ALIASES[key] ?? null;
  if (code && COUNTRY_CODE_TO_NAME[code]) return COUNTRY_CODE_TO_NAME[code];
  return trimmed;
}

/** Comme normalizeCountryName, mais renvoie null si le libellé n'est pas un pays connu (villes, régions…). */
export function strictCountryName(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.length === 2) return COUNTRY_CODE_TO_NAME[trimmed.toUpperCase()] ?? null;
  const key = norm(trimmed);
  const code = COUNTRY_NAME_TO_CODE[key] ?? ENGLISH_COUNTRY_ALIASES[key] ?? null;
  return code ? COUNTRY_CODE_TO_NAME[code] ?? null : null;
}

export function nameToCode(name: string | null | undefined): string | null {
  if (!name) return null;
  return COUNTRY_NAME_TO_CODE[norm(name)] ?? null;
}

// Noms anglais des pays, pour les documents générés en anglais (lettre :
// « Alloy / Canada » et non « États-Unis » dans une lettre anglophone).
const COUNTRY_CODE_TO_NAME_EN: Record<string, string> = {
  FR: "France", BE: "Belgium", CH: "Switzerland", DE: "Germany",
  NL: "Netherlands", LU: "Luxembourg", GB: "United Kingdom", UK: "United Kingdom",
  IE: "Ireland", ES: "Spain", PT: "Portugal", IT: "Italy", AT: "Austria",
  MC: "Monaco",
  SE: "Sweden", NO: "Norway", DK: "Denmark", FI: "Finland", IS: "Iceland",
  PL: "Poland", CZ: "Czechia", SK: "Slovakia", HU: "Hungary", RO: "Romania",
  BG: "Bulgaria", SI: "Slovenia", HR: "Croatia", RS: "Serbia", UA: "Ukraine",
  LT: "Lithuania", LV: "Latvia", EE: "Estonia",
  GR: "Greece", CY: "Cyprus", MT: "Malta", TR: "Turkey",
  US: "United States", CA: "Canada", MX: "Mexico",
  BR: "Brazil", AR: "Argentina", CL: "Chile", CO: "Colombia", PE: "Peru",
  UY: "Uruguay", CR: "Costa Rica", PA: "Panama", EC: "Ecuador", DO: "Dominican Republic",
  CN: "China", HK: "Hong Kong", SG: "Singapore", JP: "Japan", KR: "South Korea",
  TW: "Taiwan", IN: "India", VN: "Vietnam", TH: "Thailand", ID: "Indonesia",
  MY: "Malaysia", PH: "Philippines",
  AE: "United Arab Emirates", QA: "Qatar", SA: "Saudi Arabia", BH: "Bahrain",
  KW: "Kuwait", OM: "Oman", IL: "Israel", LB: "Lebanon", JO: "Jordan",
  MA: "Morocco", TN: "Tunisia", DZ: "Algeria", EG: "Egypt",
  SN: "Senegal", CI: "Côte d'Ivoire", CM: "Cameroon", KE: "Kenya",
  NG: "Nigeria", GH: "Ghana", ZA: "South Africa", MU: "Mauritius",
  MG: "Madagascar", MR: "Mauritania",
  BJ: "Benin", TG: "Togo", BF: "Burkina Faso", ML: "Mali", NE: "Niger",
  GN: "Guinea", GA: "Gabon", CG: "Congo", CD: "Democratic Republic of the Congo",
  TD: "Chad", RW: "Rwanda", BI: "Burundi", DJ: "Djibouti", HT: "Haiti",
  AU: "Australia", NZ: "New Zealand", NC: "New Caledonia",
  PF: "French Polynesia",
};

/** Nom anglais d'un pays connu (nom français canonique, alias ou code ISO) ; sinon la valeur telle quelle. */
export function countryNameEnglish(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const code = nameToCode(raw) ?? (raw.trim().length === 2 ? raw.trim().toUpperCase() : null);
  return (code && COUNTRY_CODE_TO_NAME_EN[code]) || raw;
}
