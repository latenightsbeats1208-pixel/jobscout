// ============================================================================
// installer/check-leaks.mjs
//
// Contrôle anti-fuite de données personnelles — À REJOUER À CHAQUE RELEASE.
//
// La V1 avait livré des builds contenant les données personnelles de son
// auteur. Ce script est le garde-fou : il refuse toute arborescence de
// distribution contenant une identité, un numéro de téléphone, une clé d'API
// ou un fichier de données utilisateur.
//
// Usage :
//   node installer/check-leaks.mjs                    → contrôle installer/dist
//   node installer/check-leaks.mjs <dossier> [...]     → contrôle ces dossiers
//   node installer/check-leaks.mjs --from-db           → (re)génère la liste de
//        termes locale depuis le profil de la base locale, puis contrôle.
//
// Termes recherchés :
//   - une liste générique versionnée (voir GENERIC_NEEDLES) ;
//   - installer/leak-needles.local.txt : identité de l'opérateur, JAMAIS
//     versionné (il contiendrait justement les données à protéger) ;
//   - des motifs : numéros de téléphone, clés d'API, secrets d'environnement.
//
// ATTENTION — l'exécutable Inno Setup compresse sa charge utile en LZMA :
// un grep brut sur le .exe ne prouve RIEN sur son contenu. Le contrôle
// probant porte sur installer/dist (la charge utile avant compression) et sur
// l'arborescence RÉELLEMENT INSTALLÉE après une installation silencieuse de
// test. Le scan du .exe n'attrape que les métadonnées non compressées.
// ============================================================================
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.dirname(HERE);
const LOCAL_NEEDLES = path.join(HERE, "leak-needles.local.txt");

/** Termes génériques : sans danger à versionner, ils ne désignent personne.
 * Une entrée peut être une RegExp (sans flag g : test() doit rester sans
 * état) quand la sous-chaîne nue produirait des faux positifs. */
const GENERIC_NEEDLES = [
  // Les termes d'identité de l'opérateur (prénom, nom, pseudo) ne sont PAS
  // ici : ils vivent dans installer/leak-needles.operator.txt (jamais versionné,
  // une ligne par terme) et sont fusionnés dans la liste locale par --from-db.
  "COWORK",
  // Une VRAIE clé (préfixe + corps), pas le préfixe seul : le code du mode
  // « clé perso » contient légitimement startsWith("sk-ant-") — c'est de la
  // validation, pas une fuite. Le corps d'une clé réelle suit toujours.
  /sk-ant-[a-z0-9_\-]{8,}/,
];

/**
 * Motifs heuristiques, appliqués à NOTRE code et à nos données — jamais aux
 * paquets tiers : dans du JavaScript minifié, n'importe quelle suite de dix
 * chiffres ressemble à un numéro de téléphone. Les vraies coordonnées de
 * l'opérateur sont couvertes exactement par la liste locale (--from-db).
 * Les motifs exigent des séparateurs ou un préfixe international, ce qui les
 * rend peu bruyants.
 */
const PATTERNS = [
  // Les gardes avant/après excluent les suites d'octets en hexadécimal des
  // bibliothèques (« 03 03 00 00 00 00 … ») : un vrai numéro fait exactement
  // dix chiffres, il n'est ni précédé ni suivi d'un autre groupe.
  {
    label: "numéro de téléphone (international)",
    re: /(?<![\d.\-])\+\d{2}[ .\-]?\d(?:[ .\-]?\d{2}){4}(?![ .\-]?\d)/g,
  },
  {
    label: "numéro de téléphone (format français)",
    re: /(?<![\d.\-])0[1-9](?:[ .\-]\d{2}){4}(?![ .\-]?\d)/g,
  },
  { label: "clé API Anthropic", re: /sk-ant-[A-Za-z0-9_\-]{8,}/g },
  { label: "secret d'environnement", re: /(?:API_KEY|SECRET|TOKEN)\s*=\s*\S{12,}/g },
];

/** Les motifs heuristiques ne s'appliquent pas aux dépendances tierces. */
const VENDOR_RE = /(^|[\\/])node_modules([\\/]|$)/;

/** Fichiers qui ne doivent JAMAIS se trouver dans une distribution. */
const FORBIDDEN_FILES = [
  /(^|[\\/])\.env(\.|$)/i,
  /\.db(-wal|-shm|-journal)?$/i,
  /(^|[\\/])demo-profiles([\\/]|$)/i,
];

/**
 * Extensions à ne PAS scanner en texte : ce sont des binaires tiers légitimes
 * (moteurs de police, images) où un faux positif « numéro de téléphone » est
 * garanti. Leur NOM reste contrôlé, et le contenu est scanné pour les termes
 * d'identité (recherche binaire, ASCII + UTF-16LE).
 */
const BINARY_EXT = new Set([
  ".exe", ".dll", ".node", ".ico", ".png", ".jpg", ".jpeg", ".gif", ".webp",
  ".woff", ".woff2", ".ttf", ".otf", ".afm", ".pfb", ".zip", ".gz", ".br",
  ".wasm", ".pdf", ".docx", ".xlsx", ".traineddata", ".bin", ".pak", ".dat",
]);

function loadLocalNeedles() {
  try {
    return fs
      .readFileSync(LOCAL_NEEDLES, "utf-8")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"));
  } catch {
    return null;
  }
}

/**
 * Mots courants de l'interface : un profil de test peut s'appeler « Profil de
 * démarrage » — ces fragments ne sont pas des identités et généreraient des
 * milliers de faux positifs.
 */
const STOPWORDS = new Set([
  "profil", "demarrage", "démarrage", "utilisateur", "test", "demo", "démo",
  "scout", "jobscout", "null", "none", "france", "paris", "gmail", "hotmail",
  "outlook", "yahoo", "linkedin", "https", "http", "www", "com",
]);

const mask = (v) => v.slice(0, 2) + "*".repeat(Math.max(1, v.length - 2));

/** Régénère la liste locale depuis le profil de la base — valeurs masquées. */
async function generateLocalNeedles() {
  const { DatabaseSync } = await import("node:sqlite");
  const dbFile =
    process.env.JOBSCOUT_DB_PATH || path.join(PROJECT, "data", "jobscout.db");
  if (!fs.existsSync(dbFile)) {
    console.error(`[leaks] base introuvable (${dbFile}) — liste locale inchangée.`);
    return;
  }
  const db = new DatabaseSync(dbFile, { readOnly: true });
  const values = new Set();
  const add = (v) => {
    const t = String(v ?? "").trim();
    if (t.length < 4) return;
    if (STOPWORDS.has(t.toLowerCase())) return;
    values.add(t);
  };
  /**
   * Le texte brut du CV est l'endroit le plus dense en données personnelles :
   * un profil peut porter un nom de démonstration alors que le CV fusionné
   * contient le vrai e-mail et le vrai téléphone. On les extrait par motif.
   */
  const harvestRawCv = (raw) => {
    const text = String(raw ?? "");
    if (!text) return;
    for (const m of text.matchAll(/[\w.+-]+@[\w-]+\.[\w.]{2,}/g)) {
      add(m[0]);
      add(m[0].split("@")[0]);
    }
    for (const m of text.matchAll(
      /(?:\+33|\+\d{1,3}[ .\-]?|\b0)[1-9](?:[ .\-]?\d{2}){4}\b/g
    )) {
      add(m[0]);
      const digits = m[0].replace(/\D/g, "");
      if (digits.length >= 9) values.add(digits);
    }
  };

  const harvest = (identity) => {
    if (!identity) return;
    harvestRawCv(identity.raw_cv_text);
    add(identity.full_name);
    add(identity.email);
    add(identity.phone);
    // Un numéro s'écrit de dix façons : on indexe aussi la suite de chiffres.
    const digits = String(identity.phone ?? "").replace(/\D/g, "");
    if (digits.length >= 9) values.add(digits);
    // Partie locale de l'e-mail et fragments du nom (hors mots courants).
    const localPart = String(identity.email ?? "").split("@")[0];
    if (localPart) add(localPart);
    // On n'indexe PAS les fragments de nom pris isolément : « Thomas » ou
    // « Girard » apparaissent dans les métadonnées d'auteur de paquets tiers
    // et transformeraient le verrou en source de faux positifs permanents.
    const slug = String(identity.linkedin_url ?? "")
      .replace(/\/+$/, "")
      .split("/")
      .pop();
    if (slug) add(slug);
  };

  try {
    for (const row of db
      .prepare(
        "SELECT full_name, email, phone, linkedin_url, raw_cv_text FROM profile"
      )
      .all()) {
      harvest(row);
    }
    // Les profils sauvegardés (snapshots) vivent dans `settings` : l'identité
    // réelle de l'opérateur peut n'exister QUE là si un persona de démo est
    // chargé au moment du build. On les récolte tous.
    for (const row of db
      .prepare("SELECT key, value FROM settings WHERE key LIKE 'profile_snapshot:%'")
      .all()) {
      try {
        const snap = JSON.parse(row.value);
        harvest(snap?.profile ?? snap?.identity ?? snap);
      } catch {
        /* snapshot illisible : ignoré */
      }
    }
    // Clés IA (llm:byok_key = clé Anthropic perso, llm:license_key = clé de
    // licence) : des secrets, jamais des données de démo — toute occurrence
    // dans une distribution est une fuite.
    for (const row of db
      .prepare(
        "SELECT value FROM settings WHERE key IN ('llm:byok_key', 'llm:license_key')"
      )
      .all()) {
      add(row.value);
    }
  } finally {
    db.close();
  }
  // Termes d'identité saisis à la main (prénom, pseudo…) : une ligne par terme.
  const OPERATOR_NEEDLES = path.join(HERE, "leak-needles.operator.txt");
  if (fs.existsSync(OPERATOR_NEEDLES)) {
    for (const line of fs.readFileSync(OPERATOR_NEEDLES, "utf-8").split(/\r?\n/)) {
      const t = line.trim();
      if (t && !t.startsWith("#")) add(t);
    }
  }
  fs.writeFileSync(
    LOCAL_NEEDLES,
    "# Termes d'identité de l'opérateur — généré par check-leaks.mjs --from-db.\n" +
      "# NE JAMAIS VERSIONNER CE FICHIER (voir installer/.gitignore).\n" +
      [...values].join("\n") +
      "\n",
    "utf-8"
  );
  console.log(
    `[leaks] liste locale régénérée : ${values.size} termes → ` +
      [...values].map(mask).join(", ")
  );
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else if (entry.isFile()) out.push(p);
  }
  return out;
}

/**
 * Excise la table de certificats Authenticode d'un exécutable PE avant le
 * scan de contenu. La signature embarque l'IDENTITÉ DU SIGNATAIRE — pour un
 * auto-entrepreneur, le certificat porte son nom légal. C'est une identité
 * PUBLIQUE PAR CONSTRUCTION (c'est le nom d'éditeur que Windows affiche à
 * l'utilisateur), pas une fuite : sans cette excision, tout build signé
 * ferait échouer le verrou sur le nom de l'opérateur. Seule la zone de
 * signature (Data Directory 4 de l'en-tête PE, offset FICHIER + taille) est
 * neutralisée ; tout le reste du binaire reste scanné. En cas de doute sur la
 * structure, le fichier est scanné intégralement (comportement d'origine).
 */
function withoutAuthenticode(file, buf) {
  if (!/\.(exe|dll|node|sys)$/i.test(file)) return buf;
  try {
    if (buf.length < 0x40 || buf.readUInt16LE(0) !== 0x5a4d) return buf;
    const pe = buf.readUInt32LE(0x3c);
    if (pe + 24 > buf.length || buf.readUInt32LE(pe) !== 0x00004550) return buf;
    const optSize = buf.readUInt16LE(pe + 20);
    const opt = pe + 24;
    if (opt + optSize > buf.length || optSize < 2) return buf;
    const magic = buf.readUInt16LE(opt);
    // PE32 (0x10b) : répertoires à opt+96 ; PE32+ (0x20b) : à opt+112.
    const dirBase = magic === 0x20b ? opt + 112 : magic === 0x10b ? opt + 96 : 0;
    if (!dirBase) return buf;
    const entry = dirBase + 4 * 8; // Data Directory 4 : Certificate Table
    if (entry + 8 > opt + optSize) return buf;
    const certOffset = buf.readUInt32LE(entry);
    const certSize = buf.readUInt32LE(entry + 4);
    if (!certOffset || !certSize || certOffset + certSize > buf.length) return buf;
    const copy = Buffer.from(buf);
    copy.fill(0, certOffset, certOffset + certSize);
    return copy;
  } catch {
    return buf;
  }
}

/**
 * Un terme purement alphabétique est cherché avec des frontières de mot :
 * « erwin » en sous-chaîne nue matche « browserWindow » (b-r-o-w-s-**erWin**-d-o-w)
 * et ferait échouer le contrôle sur des dizaines de fichiers tiers. Les termes
 * qui contiennent chiffres ou symboles (e-mails, numéros, préfixes de clés)
 * restent cherchés en sous-chaîne : eux ne produisent pas de faux positifs.
 */
function compileNeedle(needle) {
  if (needle instanceof RegExp) {
    return { needle: needle.source, test: (hay) => needle.test(hay) };
  }
  const lower = needle.toLowerCase();
  if (/^[a-zà-ÿ][a-zà-ÿ .'-]*$/.test(lower)) {
    const esc = lower.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`(?<![a-z0-9à-ÿ])${esc}(?![a-z0-9à-ÿ])`);
    return { needle, test: (hay) => re.test(hay) };
  }
  return { needle, test: (hay) => hay.includes(lower) };
}

/**
 * Vue textuelle d'un fichier : octets bruts + interprétation UTF-16LE (les
 * ressources Windows et certains JSON stockent le texte en UTF-16).
 */
function haystack(buf) {
  const raw = buf.toString("latin1").toLowerCase();
  // Au-delà de ~8 Mo la vue UTF-16 coûte cher pour un gain nul : ces fichiers
  // sont des binaires tiers, pas des données produites ici.
  if (buf.length > 8 * 1024 * 1024) return raw;
  // Separateur NUL (echappe : un NUL litteral dans la source ferait classer CE
  // fichier comme binaire par ripgrep, qui repond alors << no matches >> sur des
  // motifs pourtant presents) : un NUL ne peut jamais faire le pont d un terme
  // cherche entre les deux vues.
  return raw + "\u0000" + buf.toString("utf16le").toLowerCase();
}

export function checkLeaks(targets, { verbose = true, exclude = [] } = {}) {
  const local = loadLocalNeedles();
  const needles = [...new Set([...GENERIC_NEEDLES, ...(local ?? [])])];
  const compiled = needles.map(compileNeedle);
  const findings = [];
  let scanned = 0;

  if (!local && verbose) {
    console.warn(
      "[leaks] AVERTISSEMENT : installer/leak-needles.local.txt absent.\n" +
        "        Lancez `node installer/check-leaks.mjs --from-db` pour couvrir\n" +
        "        l'identité et le téléphone du poste de développement."
    );
  }

  for (const target of targets) {
    if (!fs.existsSync(target)) {
      findings.push({ file: target, kind: "cible absente", sample: "" });
      continue;
    }
    const files = fs.statSync(target).isDirectory() ? walk(target) : [target];
    for (const file of files) {
      const rel = path.relative(path.dirname(target), file) || path.basename(file);
      if (exclude.some((re) => re.test(rel))) continue;
      scanned++;

      for (const re of FORBIDDEN_FILES) {
        if (re.test(rel)) {
          findings.push({ file: rel, kind: "fichier interdit dans un paquet", sample: "" });
        }
      }
      const relLower = rel.toLowerCase();
      for (const c of compiled) {
        if (c.test(relLower)) {
          findings.push({
            file: rel,
            kind: `terme « ${c.needle} » dans le NOM`,
            sample: "",
          });
        }
      }

      let buf;
      try {
        buf = fs.readFileSync(file);
      } catch {
        continue;
      }

      // La zone de signature Authenticode est excisée avant le scan : elle
      // porte le nom d'éditeur (public par construction), pas une fuite.
      const hay = haystack(withoutAuthenticode(file, buf));
      for (const c of compiled) {
        if (c.test(hay)) {
          findings.push({
            file: rel,
            kind: `terme « ${c.needle} » dans le CONTENU`,
            sample: "",
          });
        }
      }

      if (BINARY_EXT.has(path.extname(file).toLowerCase())) continue;
      if (VENDOR_RE.test(rel)) continue;
      const text = buf.toString("utf-8");
      for (const { label, re } of PATTERNS) {
        re.lastIndex = 0;
        const m = re.exec(text);
        if (m) {
          findings.push({
            file: rel,
            kind: `motif : ${label}`,
            sample: m[0].slice(0, 12) + "…",
          });
        }
      }
    }
  }

  return { findings, scanned, needleCount: needles.length };
}

// ------------------------------- CLI ---------------------------------------
const isMain =
  !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const args = process.argv.slice(2);
  if (args.includes("--from-db")) await generateLocalNeedles();
  const targets = args.filter((a) => !a.startsWith("--"));
  const resolved = targets.length
    ? targets.map((t) => path.resolve(t))
    : [path.join(HERE, "dist")];

  console.log(`[leaks] cibles : ${resolved.join(", ")}`);
  const { findings, scanned, needleCount } = checkLeaks(resolved);
  console.log(`[leaks] ${scanned} fichiers scannés, ${needleCount} termes recherchés.`);

  if (findings.length === 0) {
    console.log("[leaks] RÉSULTAT : 0 occurrence. Distribution propre.");
    process.exit(0);
  }
  console.error(`[leaks] RÉSULTAT : ${findings.length} FUITE(S) —`);
  for (const f of findings.slice(0, 60)) {
    console.error(`  - ${f.file} :: ${f.kind}${f.sample ? ` (${f.sample})` : ""}`);
  }
  if (findings.length > 60) console.error(`  … et ${findings.length - 60} autres.`);
  process.exit(1);
}
