// Table commune → département de lib/geo/communes-fr.json, pour situer une offre
// dont la source ne donne que la ville (LinkedIn, Welcome to the Jungle, Talent.com).
//
// Source : API Découpage administratif (geo.api.gouv.fr), Licence Ouverte 2.0
// (Etalab). Seules les communes d'au moins 1 000 habitants sont gardées : une
// offre dans un village inconnu de la table n'est simplement pas située.
//
// Régénérer : node scripts/build-communes.mjs
import fs from "node:fs";
import path from "node:path";

const MIN_POPULATION = 1000;
const url = "https://geo.api.gouv.fr/communes?fields=nom,codeDepartement,population&format=json";
const communes = await (await fetch(url)).json();

const key = (s) =>
  s.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/[^a-z0-9]+/g, " ").trim();

const byDept = {};
for (const c of communes) {
  if ((c.population ?? 0) < MIN_POPULATION || !c.codeDepartement) continue;
  (byDept[c.codeDepartement] ??= new Set()).add(key(c.nom));
}
const out = Object.fromEntries(
  Object.keys(byDept).sort().map((d) => [d, [...byDept[d]].sort().join("|")])
);
const file = path.join(process.cwd(), "lib", "geo", "communes-fr.json");
fs.writeFileSync(file, JSON.stringify(out) + "\n");
console.log(`${Object.values(byDept).reduce((n, s) => n + s.size, 0)} communes → ${file}`);
