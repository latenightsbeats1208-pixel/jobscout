// ============================================================================
// installer/install-info.mjs — page « INFO-INSTALLATION.txt » du variant de
// TEST, affichée par Inno Setup AVANT l'installation (InfoBeforeFile) et
// livrée dans le dossier d'installation à côté de LISEZ-MOI.txt.
//
// Toutes les tailles sont MESURÉES sur la charge utile assemblée — jamais
// écrites à la main. Seule exception : le désinstalleur (unins000.exe + .dat),
// écrit par Inno Setup sur la machine cible, qui n'existe pas encore au moment
// du build — il est compté avec une estimation MAJORÉE (UNINSTALLER_BYTES), et
// le total est arrondi au Mo SUPÉRIEUR : on n'annonce jamais moins que ce qui
// sera réellement posé sur le disque. test-install.mjs relit ce fichier avec
// parseInfoSizes() et confronte chaque composant au dist réel, et le total à
// l'arborescence RÉELLEMENT installée, désinstalleur compris (tolérance 5 %).
//
// Le fichier est écrit en UTF-8 AVEC BOM : c'est ce qu'attend Inno Setup pour
// afficher correctement les accents dans l'assistant.
// ============================================================================
import fs from "node:fs";
import path from "node:path";

export const INFO_FILE_NAME = "INFO-INSTALLATION.txt";

/** Marque d'ordre des octets (U+FEFF) en tête du fichier — voir en-tête. */
const BOM = String.fromCharCode(0xfeff);

/**
 * Moteur LinkedIn (chromium_headless_shell, `playwright install chromium
 * --only-shell`) — mesures réelles du 30/08/2026 sur l'application installée :
 * ~100 Mo téléchargés, 277 840 671 octets (≈ 265 Mo) une fois décompressé.
 * Les libellés de l'interface sont dans lib/scrapers/browser-engine.ts
 * (ENGINE_SIZE_LABEL / ENGINE_DISK_SIZE_LABEL) : à garder alignés.
 */
export const ENGINE_DOWNLOAD_LABEL = "~100 Mo";
export const ENGINE_DISK_LABEL = "~265 Mo";

/** Mo = mébioctets (1 048 576 octets), comme l'Explorateur Windows et Inno. */
export const toMo = (bytes) => bytes / 1024 / 1024;
/** Arrondi à l'entier, plancher 1 : un composant de 0,7 Mo s'annonce « ~1 Mo ». */
export const roundMo = (bytes) => Math.max(1, Math.round(toMo(bytes)));
/** Arrondi au Mo SUPÉRIEUR — pour le total, jamais en dessous de la réalité. */
export const ceilMo = (bytes) => Math.max(1, Math.ceil(toMo(bytes)));

/**
 * Désinstalleur écrit par Inno Setup À L'INSTALLATION (unins000.exe +
 * unins000.dat) : il ne fait pas partie de la charge utile et ne peut pas
 * être mesuré au build. Mesuré 5 911 299 octets (5,64 Mio) sur la recette du
 * build 3.4.4 (unins000.exe 4 741 850 + unins000.dat 1 169 449) ; on compte
 * 6 Mio, une marge pour un journal d'installation plus long sur un autre poste.
 * La recette vérifie que le total annoncé couvre bien l'arborescence installée.
 */
export const UNINSTALLER_BYTES = 6 * 1024 * 1024;

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else if (entry.isFile()) out.push(p);
  }
  return out;
}

export function dirSize(dir) {
  if (!fs.existsSync(dir)) return 0;
  return walk(dir).reduce((n, f) => n + fs.statSync(f).size, 0);
}

/**
 * Tailles réelles (octets) d'une charge utile : runtime (runtime\node.exe),
 * application (app\), lanceur (tout le reste : JobScout.exe, icône, notes),
 * payloadTotal (la charge utile seule), uninstaller (estimation majorée, voir
 * UNINSTALLER_BYTES) et total = payloadTotal + uninstaller, c'est-à-dire ce
 * qui sera réellement posé sur le disque.
 */
export function measurePayload(payload) {
  const nodeExe = path.join(payload, "runtime", "node.exe");
  const runtime = fs.existsSync(nodeExe) ? fs.statSync(nodeExe).size : 0;
  const app = dirSize(path.join(payload, "app"));
  const payloadTotal = dirSize(payload);
  return {
    launcher: payloadTotal - runtime - app,
    runtime,
    app,
    uninstaller: UNINSTALLER_BYTES,
    payloadTotal,
    // Ce qui sera réellement posé sur le disque : charge utile + désinstalleur.
    total: payloadTotal + UNINSTALLER_BYTES,
  };
}

/** Libellés des composants — partagés entre l'écriture et la relecture. */
export const INFO_COMPONENTS = [
  { key: "launcher", label: "Le lanceur JobScout.exe, son icône et ces notes" },
  { key: "runtime", label: "Le moteur Node.js 22 embarqué (runtime\\node.exe)" },
  { key: "app", label: "L'application JobScout (dossier app\\)" },
  { key: "uninstaller", label: "Le désinstalleur (créé par l'assistant)" },
];

const TOTAL_PREFIX = "CE QUI SERA INSTALLÉ (~";
const TOTAL_SUFFIX = " Mo sur le disque au total)";
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function renderInstallInfo({ appName, dataDirName, version, signed, sizes }) {
  const title = `${appName} — build de test v${version} (${signed ? "signé" : "non signé"})`;
  const row = (label, bytes) =>
    `  - ${(label + " ").padEnd(58, ".")} ~${roundMo(bytes)} Mo`;
  const byKey = Object.fromEntries(INFO_COMPONENTS.map((c) => [c.key, c.label]));

  const lines = [
    title,
    "=".repeat(title.length),
    "",
    // Total = charge utile + désinstalleur, au Mo SUPÉRIEUR : le chiffre de
    // cette page ne doit jamais être inférieur à ce que l'assistant posera.
    `${TOTAL_PREFIX}${ceilMo(sizes.total)}${TOTAL_SUFFIX}`,
    row(byKey.launcher, sizes.launcher),
    row(byKey.runtime, sizes.runtime),
    row(byKey.app, sizes.app),
    row(byKey.uninstaller, sizes.uninstaller),
    "  - Une base de données VIERGE : aucun profil, aucune offre, aucun document.",
    "    Elle est créée au premier lancement, dans votre dossier de données (ci-dessous).",
    `  Dossier d'installation : %LOCALAPPDATA%\\Programs\\${appName}`,
    `  Raccourcis : groupe « ${appName} » dans le menu Démarrer et icône sur le Bureau`,
    "  (décochable à l'étape « Tâches supplémentaires »).",
    "  Installation par utilisateur, sans droit administrateur ; aucun autre logiciel",
    "  n'est requis (ni Node.js, ni Python, ni navigateur particulier).",
    "",
    "OÙ VONT VOS DONNÉES",
    `  %LOCALAPPDATA%\\${dataDirName}`,
    "  Profil, offres scannées, documents générés (CV, lettres) et journaux.",
    "  Ce dossier est séparé du programme et PRÉSERVÉ à la désinstallation",
    "  (l'assistant propose de le supprimer, réponse par défaut « Non »).",
    "  Un JobScout standard déjà installé garde ses propres données : les deux",
    "  versions coexistent sans se mélanger.",
    "",
    "CE QUI N'EST PAS INSTALLÉ",
    "  - Le moteur LinkedIn (navigateur Chromium headless). Optionnel : il n'est",
    "    téléchargé que si vous activez la source LinkedIn dans Profil › Sources.",
    `    Compter ${ENGINE_DOWNLOAD_LABEL} à télécharger et ${ENGINE_DISK_LABEL} sur le disque une fois décompressé.`,
    "    Les six autres sources (Welcome to the Jungle, APEC, HelloWork, France",
    "    Travail, Talent.com, Civiweb) fonctionnent sans.",
    "  - Aucune clé d'IA embarquée. Pour importer un CV et générer CV et lettres,",
    "    saisissez votre propre clé API Anthropic dans Profil › Génération IA",
    "    (le pack JobScout par licence n'est pas encore ouvert). Sans clé, le scan",
    "    et le classement des offres fonctionnent normalement.",
    "",
    "PRÉREQUIS",
    "  - Windows 10 ou 11, 64 bits.",
    "  - .NET Framework 4 (présent d'origine sur Windows 10 et 11).",
    "  - Aucun droit administrateur.",
    "",
    "RÉSEAU",
    "  - Le serveur local n'écoute que sur 127.0.0.1 : rien n'est exposé sur le réseau.",
    "  - Connexions sortantes uniquement pour scanner les sites d'offres, pour le",
    "    service d'IA si vous l'avez configuré, et pour la vérification de mise à jour.",
  ];

  if (!signed) {
    lines.push(
      "",
      "AVERTISSEMENT — BUILD DE TEST NON SIGNÉ",
      "  Cet installeur n'est pas signé numériquement : Windows SmartScreen peut",
      "  afficher « Windows a protégé votre ordinateur » avec « Éditeur inconnu ».",
      "  Cliquez sur « Informations complémentaires » puis « Exécuter quand même »."
    );
  }
  return lines.join("\r\n") + "\r\n";
}

/** Relit les tailles annoncées (en Mo) : { launcher, runtime, app, uninstaller, total }. */
export function parseInfoSizes(text) {
  const t = text.startsWith(BOM) ? text.slice(1) : text;
  const out = {};
  const total = new RegExp(escapeRe(TOTAL_PREFIX) + "(\\d+)" + escapeRe(TOTAL_SUFFIX)).exec(t);
  out.total = total ? Number(total[1]) : null;
  for (const { key, label } of INFO_COMPONENTS) {
    const m = new RegExp(escapeRe(label) + " ?\\.*\\s*~(\\d+) Mo").exec(t);
    out[key] = m ? Number(m[1]) : null;
  }
  return out;
}

/** Mesure la charge utile, écrit INFO-INSTALLATION.txt dedans, renvoie les tailles. */
export function writeInstallInfo(payload, { appName, dataDirName, version, signed }) {
  const sizes = measurePayload(payload);
  const text = renderInstallInfo({ appName, dataDirName, version, signed, sizes });
  const file = path.join(payload, INFO_FILE_NAME);
  fs.writeFileSync(file, BOM + text, "utf8");
  return { file, sizes };
}
