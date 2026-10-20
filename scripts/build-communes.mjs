// Table commune → département de lib/geo/communes-fr.json, pour situer une offre
// dont la source ne donne que la ville (LinkedIn, Welcome to the Jungle, Talent.com).
//
// Source : API Découpage administratif (geo.api.gouv.fr), Licence Ouverte 2.0
// (Etalab). Toutes les communes, sauf qu'un nom porté par une commune d'au moins
// 1 000 habitants ne désigne qu'elle(s) : « Valence » reste la ville de la Drôme
// et non aussi deux villages homonymes. Une maison de retraite ou une usine est
// souvent dans un village : sans lui, l'offre n'était pas située du tout.
//
// Régénérer : node scripts/build-communes.mjs
import fs from "node:fs";
import path from "node:path";

const MIN_POPULATION = 1000;
const url = "https://geo.api.gouv.fr/communes?fields=nom,codeDepartement,population&format=json";
const communes = await (await fetch(url)).json();

// « Marcq-en-Barœul » : la ligature n'a pas de forme décomposée, elle s'écrit « oe ».
const key = (s) =>
  s.toLowerCase().replace(/œ/g, "oe").replace(/æ/g, "ae")
    .normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/[^a-z0-9]+/g, " ").trim();

const byName = new Map();
for (const c of communes) {
  if (!c.codeDepartement) continue;
  const name = key(c.nom);
  (byName.get(name) ?? byName.set(name, []).get(name)).push(c);
}
const byDept = {};
for (const [name, list] of byName) {
  const towns = list.filter((c) => (c.population ?? 0) >= MIN_POPULATION);
  for (const c of towns.length ? towns : list) (byDept[c.codeDepartement] ??= new Set()).add(name);
}
const out = Object.fromEntries(
  Object.keys(byDept).sort().map((d) => [d, [...byDept[d]].sort().join("|")])
);
const file = path.join(process.cwd(), "lib", "geo", "communes-fr.json");
fs.writeFileSync(file, JSON.stringify(out) + "\n");
console.log(`${Object.values(byDept).reduce((n, s) => n + s.size, 0)} communes → ${file}`);
