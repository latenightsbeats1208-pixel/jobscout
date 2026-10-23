// Tables faites à la main pour le moteur géographique (lib/geo/index.ts).
// Libellés de lieu courants dans les offres d'emploi qui ne sont pas des noms
// de communes (quartiers d'affaires, aéroports, villes nouvelles), anciens
// noms, noms tronqués, exonymes. Les clés sont normalisées au chargement.

/** Alias français : libellé → commune (code INSEE), avec point ou libellé propres si besoin. */
export type FrAlias = { code: string; label?: string; lat?: number; lng?: number };

export const FR_ALIASES: Record<string, FrAlias> = {
  // Quartier d'affaires à cheval sur Puteaux et Courbevoie : point du parvis.
  "La Défense": { code: "92062", label: "La Défense (92)", lat: 48.892, lng: 2.24 },
  "Paris La Défense": { code: "92062", label: "La Défense (92)", lat: 48.892, lng: 2.24 },
  "Paris-La Défense": { code: "92062", label: "La Défense (92)", lat: 48.892, lng: 2.24 },
  "Puteaux La Défense": { code: "92062", label: "La Défense (92)", lat: 48.892, lng: 2.24 },
  "Courbevoie La Défense": { code: "92026", label: "La Défense (92)", lat: 48.892, lng: 2.24 },
  // Technopole sur Valbonne, Biot, Antibes, Mougins, Vallauris : point de la technopole.
  "Sophia Antipolis": { code: "06152", label: "Sophia Antipolis (06)", lat: 43.6167, lng: 7.05 },
  "Sophia": { code: "06152", label: "Sophia Antipolis (06)", lat: 43.6167, lng: 7.05 },
  "Valbonne Sophia Antipolis": { code: "06152", label: "Sophia Antipolis (06)", lat: 43.6167, lng: 7.05 },
  // Agglomérations et villes nouvelles : commune centrale.
  "Saint-Quentin-en-Yvelines": { code: "78423", label: "Saint-Quentin-en-Yvelines (78)" },
  "SQY": { code: "78423", label: "Saint-Quentin-en-Yvelines (78)" },
  "Marne-la-Vallée": { code: "77083", label: "Marne-la-Vallée (77)" },
  "Cergy-Pontoise": { code: "95127", label: "Cergy-Pontoise (95)" },
  "Paris-Saclay": { code: "91534", label: "Paris-Saclay (91)" },
  "Plateau de Saclay": { code: "91534", label: "Paris-Saclay (91)" },
  "Roissy": { code: "95527" },
  "Roissy CDG": { code: "95527" },
  "Roissy Charles de Gaulle": { code: "95527" },
  "Roissy-Charles-de-Gaulle": { code: "95527" },
  "Aéroport Charles de Gaulle": { code: "95527" },
  "Aéroport Paris-Charles de Gaulle": { code: "95527" },
  "Paris Charles de Gaulle": { code: "95527" },
  "Paris CDG": { code: "95527" },
  "Aéroport d'Orly": { code: "94054" },
  "Paris Orly": { code: "94054" },
  "Orly Aéroport": { code: "94054" },
  "La Plaine Saint-Denis": { code: "93066" },
  "Plaine Saint-Denis": { code: "93066" },
  "Saint-Denis La Plaine": { code: "93066" },
  "Massy Palaiseau": { code: "91377" },
  // Paris sous d'autres noms.
  "Ville de Paris": { code: "75056" },
  "Paris Ville": { code: "75056" },
  "Paris intra-muros": { code: "75056" },
  "Paris Centre": { code: "75056" },
  "Grand Paris": { code: "75056" },
  "Paris France": { code: "75056" },
  // Quartiers lyonnais courants.
  "Lyon Part-Dieu": { code: "69383" },
  "La Part-Dieu": { code: "69383" },
  "Lyon Confluence": { code: "69382" },
  "Lyon Gerland": { code: "69387" },
  // Noms raccourcis ou anciens (le nom exact désigne un village homonyme ou rien).
  "Cherbourg": { code: "50129" },
  "Cherbourg-Octeville": { code: "50129" },
  "Tassin": { code: "69244" },
  "Evry": { code: "91228" },
  "Courcouronnes": { code: "91228" },
  "Corbeil": { code: "91174" },
  "Sotteville": { code: "76681" },
  "Asnières": { code: "92004" },
  "Saint-Ouen": { code: "93070" },
  "Éragny": { code: "95218" },
  "Charleville": { code: "08105" },
  // Exonymes anglais de villes françaises.
  "Dunkirk": { code: "59183" },
  "Marseilles": { code: "13055" },
  "Lyons": { code: "69123" },
};

/** Régions françaises : actuelles (départements lus dans les données) et anciennes. */
export type RegionDef = { code: string | null; nom: string; aliases: string[]; deps?: string[] };

export const FR_REGIONS: RegionDef[] = [
  { code: "11", nom: "Île-de-France", aliases: ["IDF", "Région parisienne", "Région Île-de-France", "Paris Region", "Région Paris"] },
  { code: "24", nom: "Centre-Val de Loire", aliases: ["Centre", "Région Centre", "Val de Loire"] },
  { code: "27", nom: "Bourgogne-Franche-Comté", aliases: [] },
  { code: "28", nom: "Normandie", aliases: ["Normandy", "Région Normandie"] },
  { code: "32", nom: "Hauts-de-France", aliases: ["Région Hauts-de-France"] },
  { code: "44", nom: "Grand Est", aliases: ["Région Grand Est"] },
  { code: "52", nom: "Pays de la Loire", aliases: ["Région Pays de la Loire"] },
  { code: "53", nom: "Bretagne", aliases: ["Brittany", "Région Bretagne"] },
  { code: "75", nom: "Nouvelle-Aquitaine", aliases: ["Région Nouvelle-Aquitaine"] },
  { code: "76", nom: "Occitanie", aliases: ["Région Occitanie"] },
  { code: "84", nom: "Auvergne-Rhône-Alpes", aliases: ["AURA", "Région Auvergne-Rhône-Alpes"] },
  { code: "93", nom: "Provence-Alpes-Côte d'Azur", aliases: ["PACA", "Région Sud", "Côte d'Azur", "Provence"] },
  { code: "94", nom: "Corse", aliases: ["Corsica"] },
  { code: null, nom: "Alsace", aliases: [], deps: ["67", "68"] },
  { code: null, nom: "Lorraine", aliases: [], deps: ["54", "55", "57", "88"] },
  { code: null, nom: "Champagne-Ardenne", aliases: [], deps: ["08", "10", "51", "52"] },
  { code: null, nom: "Picardie", aliases: [], deps: ["02", "60", "80"] },
  { code: null, nom: "Nord-Pas-de-Calais", aliases: [], deps: ["59", "62"] },
  { code: null, nom: "Haute-Normandie", aliases: [], deps: ["27", "76"] },
  { code: null, nom: "Basse-Normandie", aliases: [], deps: ["14", "50", "61"] },
  { code: null, nom: "Bourgogne", aliases: [], deps: ["21", "58", "71", "89"] },
  { code: null, nom: "Franche-Comté", aliases: [], deps: ["25", "39", "70", "90"] },
  { code: null, nom: "Auvergne", aliases: [], deps: ["03", "15", "43", "63"] },
  { code: null, nom: "Rhône-Alpes", aliases: [], deps: ["01", "07", "26", "38", "42", "69", "73", "74"] },
  { code: null, nom: "Limousin", aliases: [], deps: ["19", "23", "87"] },
  { code: null, nom: "Poitou-Charentes", aliases: [], deps: ["16", "17", "79", "86"] },
  { code: null, nom: "Aquitaine", aliases: [], deps: ["24", "33", "40", "47", "64"] },
  { code: null, nom: "Midi-Pyrénées", aliases: [], deps: ["09", "12", "31", "32", "46", "65", "81", "82"] },
  { code: null, nom: "Languedoc-Roussillon", aliases: [], deps: ["11", "30", "34", "48", "66"] },
];

/** Alias de départements (le nom officiel vient des données). */
export const DEP_ALIASES: Record<string, string> = {
  "Réunion": "974",
  "Île de la Réunion": "974",
  "Reunion Island": "974",
  "Guyane française": "973",
  "French Guiana": "973",
  "Corse du Sud": "2A",
  "Haute Corse": "2B",
};

/**
 * Territoires français dotés d'un code ISO propre → département ou collectivité.
 * PM, BL, MF, WF, TF et CP : collectivités non géolocalisées (communes sans centre,
 * voir scripts/build-geo.mjs) ; le code sert à les reconnaître (sauf CP, absent des
 * pays de la base) et de pays au lieu non placé (lib/geo/index.ts, unplaced).
 */
export const OVERSEAS_ISO: Record<string, string> = {
  GP: "971",
  MQ: "972",
  GF: "973",
  RE: "974",
  YT: "976",
  PM: "975",
  BL: "977",
  MF: "978",
  WF: "986",
  PF: "987",
  NC: "988",
  TF: "984",
  CP: "989", // Clipperton : code ISO 3166-1 exceptionnellement réservé
};

/** Pays si petits qu'un libellé « pays seul » désigne en pratique leur ville principale. */
export const CITY_STATES = new Set(["MC", "SG", "HK", "MO", "VA", "SM", "GI", "LU"]);

/**
 * Subdivisions étrangères (code admin1 GeoNames) : départagent les homonymes
 * (« Birmingham, Alabama » n'est pas au Royaume-Uni, « Falmouth, Maine » n'est
 * pas Falmouth (Massachusetts)) et donnent le pays quand le libellé n'en a pas.
 * `abbr` : abréviation usuelle quand elle diffère du code GeoNames (Canada).
 */
export type AdminArea = { cc: string; code: string; names: string[]; abbr?: string };

export const ADMIN_AREAS: AdminArea[] = [
  // États-Unis : code GeoNames = abréviation postale.
  { cc: "US", code: "AL", names: ["Alabama"] },
  { cc: "US", code: "AK", names: ["Alaska"] },
  { cc: "US", code: "AZ", names: ["Arizona"] },
  { cc: "US", code: "AR", names: ["Arkansas"] },
  { cc: "US", code: "CA", names: ["California", "Californie"] },
  { cc: "US", code: "CO", names: ["Colorado"] },
  { cc: "US", code: "CT", names: ["Connecticut"] },
  { cc: "US", code: "DE", names: ["Delaware"] },
  { cc: "US", code: "DC", names: ["District of Columbia", "District de Columbia", "Washington DC", "Washington D.C."] },
  { cc: "US", code: "FL", names: ["Florida", "Floride"] },
  { cc: "US", code: "GA", names: ["Georgia", "Géorgie"] },
  { cc: "US", code: "HI", names: ["Hawaii", "Hawaï"] },
  { cc: "US", code: "ID", names: ["Idaho"] },
  { cc: "US", code: "IL", names: ["Illinois"] },
  { cc: "US", code: "IN", names: ["Indiana"] },
  { cc: "US", code: "IA", names: ["Iowa"] },
  { cc: "US", code: "KS", names: ["Kansas"] },
  { cc: "US", code: "KY", names: ["Kentucky"] },
  { cc: "US", code: "LA", names: ["Louisiana", "Louisiane"] },
  { cc: "US", code: "ME", names: ["Maine"] },
  { cc: "US", code: "MD", names: ["Maryland"] },
  { cc: "US", code: "MA", names: ["Massachusetts"] },
  { cc: "US", code: "MI", names: ["Michigan"] },
  { cc: "US", code: "MN", names: ["Minnesota"] },
  { cc: "US", code: "MS", names: ["Mississippi"] },
  { cc: "US", code: "MO", names: ["Missouri"] },
  { cc: "US", code: "MT", names: ["Montana"] },
  { cc: "US", code: "NE", names: ["Nebraska"] },
  { cc: "US", code: "NV", names: ["Nevada"] },
  { cc: "US", code: "NH", names: ["New Hampshire"] },
  { cc: "US", code: "NJ", names: ["New Jersey"] },
  { cc: "US", code: "NM", names: ["New Mexico", "Nouveau-Mexique"] },
  { cc: "US", code: "NY", names: ["New York", "État de New York", "New York State"] },
  { cc: "US", code: "NC", names: ["North Carolina", "Caroline du Nord"] },
  { cc: "US", code: "ND", names: ["North Dakota", "Dakota du Nord"] },
  { cc: "US", code: "OH", names: ["Ohio"] },
  { cc: "US", code: "OK", names: ["Oklahoma"] },
  { cc: "US", code: "OR", names: ["Oregon"] },
  { cc: "US", code: "PA", names: ["Pennsylvania", "Pennsylvanie"] },
  { cc: "US", code: "RI", names: ["Rhode Island"] },
  { cc: "US", code: "SC", names: ["South Carolina", "Caroline du Sud"] },
  { cc: "US", code: "SD", names: ["South Dakota", "Dakota du Sud"] },
  { cc: "US", code: "TN", names: ["Tennessee"] },
  { cc: "US", code: "TX", names: ["Texas"] },
  { cc: "US", code: "UT", names: ["Utah"] },
  { cc: "US", code: "VT", names: ["Vermont"] },
  { cc: "US", code: "VA", names: ["Virginia", "Virginie"] },
  { cc: "US", code: "WA", names: ["Washington", "État de Washington", "Washington State"] },
  { cc: "US", code: "WV", names: ["West Virginia", "Virginie-Occidentale"] },
  { cc: "US", code: "WI", names: ["Wisconsin"] },
  { cc: "US", code: "WY", names: ["Wyoming"] },
  // Canada : codes GeoNames numériques.
  { cc: "CA", code: "01", abbr: "AB", names: ["Alberta"] },
  { cc: "CA", code: "02", abbr: "BC", names: ["British Columbia", "Colombie-Britannique"] },
  { cc: "CA", code: "03", abbr: "MB", names: ["Manitoba"] },
  { cc: "CA", code: "04", abbr: "NB", names: ["New Brunswick", "Nouveau-Brunswick"] },
  { cc: "CA", code: "05", abbr: "NL", names: ["Newfoundland and Labrador", "Terre-Neuve-et-Labrador"] },
  { cc: "CA", code: "07", abbr: "NS", names: ["Nova Scotia", "Nouvelle-Écosse"] },
  { cc: "CA", code: "08", abbr: "ON", names: ["Ontario"] },
  { cc: "CA", code: "09", abbr: "PE", names: ["Prince Edward Island", "Île-du-Prince-Édouard"] },
  { cc: "CA", code: "10", abbr: "QC", names: ["Quebec", "Québec", "Province de Québec"] },
  { cc: "CA", code: "11", abbr: "SK", names: ["Saskatchewan"] },
  { cc: "CA", code: "12", abbr: "YT", names: ["Yukon"] },
  { cc: "CA", code: "13", abbr: "NT", names: ["Northwest Territories", "Territoires du Nord-Ouest"] },
  { cc: "CA", code: "14", abbr: "NU", names: ["Nunavut"] },
  // Suisse : code GeoNames = abréviation du canton.
  { cc: "CH", code: "AG", names: ["Aargau", "Argovie"] },
  { cc: "CH", code: "AI", names: ["Appenzell Innerrhoden", "Appenzell Rhodes-Intérieures"] },
  { cc: "CH", code: "AR", names: ["Appenzell Ausserrhoden", "Appenzell Rhodes-Extérieures"] },
  { cc: "CH", code: "BE", names: ["Bern", "Berne", "Canton de Berne"] },
  { cc: "CH", code: "BL", names: ["Basel-Landschaft", "Bâle-Campagne"] },
  { cc: "CH", code: "BS", names: ["Basel-Stadt", "Bâle-Ville", "Basel-City"] },
  { cc: "CH", code: "FR", names: ["Fribourg", "Freiburg", "Canton de Fribourg"] },
  { cc: "CH", code: "GE", names: ["Genève", "Geneva", "Genf", "Canton de Genève"] },
  { cc: "CH", code: "GL", names: ["Glarus", "Glaris"] },
  { cc: "CH", code: "GR", names: ["Graubünden", "Grisons"] },
  { cc: "CH", code: "JU", names: ["Jura", "Canton du Jura"] },
  { cc: "CH", code: "LU", names: ["Luzern", "Lucerne"] },
  { cc: "CH", code: "NE", names: ["Neuchâtel", "Canton de Neuchâtel"] },
  { cc: "CH", code: "NW", names: ["Nidwalden", "Nidwald"] },
  { cc: "CH", code: "OW", names: ["Obwalden", "Obwald"] },
  { cc: "CH", code: "SG", names: ["St. Gallen", "Saint-Gall"] },
  { cc: "CH", code: "SH", names: ["Schaffhausen", "Schaffhouse"] },
  { cc: "CH", code: "SO", names: ["Solothurn", "Soleure"] },
  { cc: "CH", code: "SZ", names: ["Schwyz"] },
  { cc: "CH", code: "TG", names: ["Thurgau", "Thurgovie"] },
  { cc: "CH", code: "TI", names: ["Ticino", "Tessin"] },
  { cc: "CH", code: "UR", names: ["Uri"] },
  { cc: "CH", code: "VD", names: ["Vaud", "Waadt", "Canton de Vaud"] },
  { cc: "CH", code: "VS", names: ["Valais", "Wallis"] },
  { cc: "CH", code: "ZG", names: ["Zug", "Zoug"] },
  { cc: "CH", code: "ZH", names: ["Zürich", "Zurich", "Canton de Zurich"] },
  // Belgique : trois régions.
  { cc: "BE", code: "BRU", names: ["Bruxelles-Capitale", "Région de Bruxelles-Capitale", "Brussels Region", "Brussels Capital", "Brussels-Capital Region", "Brussels Capital Region", "Brussel Hoofdstad", "Brussels Hoofdstedelijk Gewest", "Région bruxelloise"] },
  { cc: "BE", code: "VLG", names: ["Flandre", "Région flamande", "Flemish Region", "Vlaanderen", "Flanders", "Vlaams Gewest"] },
  { cc: "BE", code: "WAL", names: ["Wallonie", "Région wallonne", "Walloon Region", "Wallonia"] },
];
