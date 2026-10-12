/**
 * Régions et départements français (codes INSEE), embarqués : la zone de
 * recherche se choisit dans cette liste, sans appel réseau ni donnée envoyée à
 * un service de géolocalisation. Partagé entre le serveur et l'interface.
 */

export type Region = { code: string; name: string };
export type Departement = { code: string; name: string; region: string };

export const REGIONS: Region[] = [
  { code: "84", name: "Auvergne-Rhône-Alpes" },
  { code: "27", name: "Bourgogne-Franche-Comté" },
  { code: "53", name: "Bretagne" },
  { code: "24", name: "Centre-Val de Loire" },
  { code: "94", name: "Corse" },
  { code: "44", name: "Grand Est" },
  { code: "01", name: "Guadeloupe" },
  { code: "03", name: "Guyane" },
  { code: "32", name: "Hauts-de-France" },
  { code: "11", name: "Île-de-France" },
  { code: "04", name: "La Réunion" },
  { code: "02", name: "Martinique" },
  { code: "06", name: "Mayotte" },
  { code: "28", name: "Normandie" },
  { code: "75", name: "Nouvelle-Aquitaine" },
  { code: "76", name: "Occitanie" },
  { code: "52", name: "Pays de la Loire" },
  { code: "93", name: "Provence-Alpes-Côte d'Azur" },
];

export const DEPARTEMENTS: Departement[] = [
  { code: "01", name: "Ain", region: "84" },
  { code: "02", name: "Aisne", region: "32" },
  { code: "03", name: "Allier", region: "84" },
  { code: "04", name: "Alpes-de-Haute-Provence", region: "93" },
  { code: "05", name: "Hautes-Alpes", region: "93" },
  { code: "06", name: "Alpes-Maritimes", region: "93" },
  { code: "07", name: "Ardèche", region: "84" },
  { code: "08", name: "Ardennes", region: "44" },
  { code: "09", name: "Ariège", region: "76" },
  { code: "10", name: "Aube", region: "44" },
  { code: "11", name: "Aude", region: "76" },
  { code: "12", name: "Aveyron", region: "76" },
  { code: "13", name: "Bouches-du-Rhône", region: "93" },
  { code: "14", name: "Calvados", region: "28" },
  { code: "15", name: "Cantal", region: "84" },
  { code: "16", name: "Charente", region: "75" },
  { code: "17", name: "Charente-Maritime", region: "75" },
  { code: "18", name: "Cher", region: "24" },
  { code: "19", name: "Corrèze", region: "75" },
  { code: "2A", name: "Corse-du-Sud", region: "94" },
  { code: "2B", name: "Haute-Corse", region: "94" },
  { code: "21", name: "Côte-d'Or", region: "27" },
  { code: "22", name: "Côtes-d'Armor", region: "53" },
  { code: "23", name: "Creuse", region: "75" },
  { code: "24", name: "Dordogne", region: "75" },
  { code: "25", name: "Doubs", region: "27" },
  { code: "26", name: "Drôme", region: "84" },
  { code: "27", name: "Eure", region: "28" },
  { code: "28", name: "Eure-et-Loir", region: "24" },
  { code: "29", name: "Finistère", region: "53" },
  { code: "30", name: "Gard", region: "76" },
  { code: "31", name: "Haute-Garonne", region: "76" },
  { code: "32", name: "Gers", region: "76" },
  { code: "33", name: "Gironde", region: "75" },
  { code: "34", name: "Hérault", region: "76" },
  { code: "35", name: "Ille-et-Vilaine", region: "53" },
  { code: "36", name: "Indre", region: "24" },
  { code: "37", name: "Indre-et-Loire", region: "24" },
  { code: "38", name: "Isère", region: "84" },
  { code: "39", name: "Jura", region: "27" },
  { code: "40", name: "Landes", region: "75" },
  { code: "41", name: "Loir-et-Cher", region: "24" },
  { code: "42", name: "Loire", region: "84" },
  { code: "43", name: "Haute-Loire", region: "84" },
  { code: "44", name: "Loire-Atlantique", region: "52" },
  { code: "45", name: "Loiret", region: "24" },
  { code: "46", name: "Lot", region: "76" },
  { code: "47", name: "Lot-et-Garonne", region: "75" },
  { code: "48", name: "Lozère", region: "76" },
  { code: "49", name: "Maine-et-Loire", region: "52" },
  { code: "50", name: "Manche", region: "28" },
  { code: "51", name: "Marne", region: "44" },
  { code: "52", name: "Haute-Marne", region: "44" },
  { code: "53", name: "Mayenne", region: "52" },
  { code: "54", name: "Meurthe-et-Moselle", region: "44" },
  { code: "55", name: "Meuse", region: "44" },
  { code: "56", name: "Morbihan", region: "53" },
  { code: "57", name: "Moselle", region: "44" },
  { code: "58", name: "Nièvre", region: "27" },
  { code: "59", name: "Nord", region: "32" },
  { code: "60", name: "Oise", region: "32" },
  { code: "61", name: "Orne", region: "28" },
  { code: "62", name: "Pas-de-Calais", region: "32" },
  { code: "63", name: "Puy-de-Dôme", region: "84" },
  { code: "64", name: "Pyrénées-Atlantiques", region: "75" },
  { code: "65", name: "Hautes-Pyrénées", region: "76" },
  { code: "66", name: "Pyrénées-Orientales", region: "76" },
  { code: "67", name: "Bas-Rhin", region: "44" },
  { code: "68", name: "Haut-Rhin", region: "44" },
  { code: "69", name: "Rhône", region: "84" },
  { code: "70", name: "Haute-Saône", region: "27" },
  { code: "71", name: "Saône-et-Loire", region: "27" },
  { code: "72", name: "Sarthe", region: "52" },
  { code: "73", name: "Savoie", region: "84" },
  { code: "74", name: "Haute-Savoie", region: "84" },
  { code: "75", name: "Paris", region: "11" },
  { code: "76", name: "Seine-Maritime", region: "28" },
  { code: "77", name: "Seine-et-Marne", region: "11" },
  { code: "78", name: "Yvelines", region: "11" },
  { code: "79", name: "Deux-Sèvres", region: "75" },
  { code: "80", name: "Somme", region: "32" },
  { code: "81", name: "Tarn", region: "76" },
  { code: "82", name: "Tarn-et-Garonne", region: "76" },
  { code: "83", name: "Var", region: "93" },
  { code: "84", name: "Vaucluse", region: "93" },
  { code: "85", name: "Vendée", region: "52" },
  { code: "86", name: "Vienne", region: "75" },
  { code: "87", name: "Haute-Vienne", region: "75" },
  { code: "88", name: "Vosges", region: "44" },
  { code: "89", name: "Yonne", region: "27" },
  { code: "90", name: "Territoire de Belfort", region: "27" },
  { code: "91", name: "Essonne", region: "11" },
  { code: "92", name: "Hauts-de-Seine", region: "11" },
  { code: "93", name: "Seine-Saint-Denis", region: "11" },
  { code: "94", name: "Val-de-Marne", region: "11" },
  { code: "95", name: "Val-d'Oise", region: "11" },
  { code: "971", name: "Guadeloupe", region: "01" },
  { code: "972", name: "Martinique", region: "02" },
  { code: "973", name: "Guyane", region: "03" },
  { code: "974", name: "La Réunion", region: "04" },
  { code: "976", name: "Mayotte", region: "06" },
];

/**
 * Zone de recherche du profil : « » (tout le pays), « R:84 » (une région) ou
 * « D:69 » (un département). Une valeur inconnue vaut « tout le pays ».
 */
export type SearchArea = { kind: "region" | "departement"; code: string; name: string };

export function parseSearchArea(value: string | null | undefined): SearchArea | null {
  const m = (value ?? "").match(/^([RD]):([0-9AB]{2,3})$/);
  if (!m) return null;
  if (m[1] === "R") {
    const r = REGIONS.find((x) => x.code === m[2]);
    return r ? { kind: "region", code: r.code, name: r.name } : null;
  }
  const d = DEPARTEMENTS.find((x) => x.code === m[2]);
  return d ? { kind: "departement", code: d.code, name: d.name } : null;
}

export function searchAreaValue(area: SearchArea): string {
  return `${area.kind === "region" ? "R" : "D"}:${area.code}`;
}

/** Libellé d'affichage : « Rhône (69) », « Auvergne-Rhône-Alpes ». */
export function searchAreaLabel(area: SearchArea): string {
  return area.kind === "departement" ? `${area.name} (${area.code})` : area.name;
}
