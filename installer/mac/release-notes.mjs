// ============================================================================
// installer/mac/release-notes.mjs — texte de la Release GitHub (brouillon).
//
//   node installer/mac/release-notes.mjs --dmg <JobScout-Mac.dmg> [--out <fichier>]
//        [--version X.Y.Z] [--repo <propriétaire/dépôt>]
//        [--signature adhoc|developer-id] [--commit <sha>]
//
// Par défaut : version et changelog lus dans version.json, dépôt lu dans
// GH_REPO (posé par le workflow) ou dans `git remote get-url origin`. Le nom
// du compte n'est jamais écrit dans ce fichier : seules les URL
// https://github.com/<dépôt>/… du texte produit le contiennent.
//
// Le texte suit le parcours réel de l'utilisateur (LISEZ-MOI du DMG,
// INSTALL-MAC.md) : aucun contournement par le Terminal n'y figure.
// Codes : 0 = texte écrit, 1 = donnée manquante ou invalide, 2 = usage.
// ============================================================================
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.resolve(HERE, "..", "..");

export const SIGNATURE_MODES = ["adhoc", "developer-id"];

/**
 * Phrase propre à chaque mode de signature dans le texte de la Release : le
 * constat de publier.mjs exige celle du mode constaté, et l'absence de l'autre.
 */
export const SIGNATURE_MARKERS = {
  adhoc: "il n'est pas enregistré auprès d'Apple",
  "developer-id": "JobScout est signé et notarisé par Apple",
};

/** Ancre GitHub du titre « Premier lancement : autoriser JobScout (une fois par version) » d'INSTALL-MAC.md. */
export const FIRST_LAUNCH_ANCHOR = "premier-lancement--autoriser-jobscout-une-fois-par-version";

/** « 123,4 » : octets en Mo (1 Mo = 1 048 576 octets), virgule décimale. */
export function formatMo(bytes) {
  return (bytes / 1024 / 1024).toFixed(1).replace(".", ",");
}

/**
 * Dépôt « propriétaire/nom » d'une URL de remote GitHub (https ou ssh).
 * @param {string} url
 * @returns {string | null}
 */
export function repoFromRemote(url) {
  const m = /github\.com[/:]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/.exec(String(url ?? "").trim());
  return m ? `${m[1]}/${m[2]}` : null;
}

/**
 * Dépôt courant : GH_REPO s'il est posé, sinon le remote « origin ».
 * @returns {string | null}
 */
export function currentRepo(env = process.env, cwd = PROJECT) {
  if (env.GH_REPO && /^[^/\s]+\/[^/\s]+$/.test(env.GH_REPO)) return env.GH_REPO;
  try {
    const url = execFileSync("git", ["remote", "get-url", "origin"], {
      cwd,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return repoFromRemote(url);
  } catch {
    return null;
  }
}

/**
 * Texte Markdown de la Release.
 * @param {{ version: string, repo: string, sha256: string, sizeBytes: number,
 *           signature?: string, commit?: string | null, changelog?: string }} input
 * @returns {string}
 */
export function renderReleaseNotes({ version, repo, sha256, sizeBytes, signature = "adhoc", commit = null, changelog = "" }) {
  if (!/^\d+\.\d+\.\d+$/.test(String(version))) throw new Error(`version invalide : ${version}`);
  if (!/^[^/\s]+\/[^/\s]+$/.test(String(repo))) throw new Error(`dépôt invalide : ${repo}`);
  if (!/^[0-9a-f]{64}$/.test(String(sha256))) throw new Error("empreinte SHA-256 invalide");
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) throw new Error("taille du DMG invalide");
  if (!SIGNATURE_MODES.includes(signature)) throw new Error(`signature inconnue : ${signature} (attendu : ${SIGNATURE_MODES.join(" ou ")})`);

  const site = `https://github.com/${repo}`;
  const guide = `${site}/blob/v${version}/INSTALL-MAC.md`;
  const install = `${site}/blob/v${version}/INSTALL.md`;
  const lines = [];
  lines.push(
    `JobScout ${version} pour Mac : un seul fichier pour les Mac à puce Apple et les Mac Intel, macOS 11 Big Sur ou plus récent.`,
    "",
    "## Installer JobScout sur votre Mac",
    "",
    `1. Téléchargez **JobScout-Mac.dmg** ci-dessous (${formatMo(sizeBytes)} Mo), puis ouvrez-le d'un double-clic.`,
    "2. Dans la fenêtre qui s'ouvre, glissez l'icône JobScout sur le dossier Applications.",
    "3. Ouvrez le dossier Applications, puis double-cliquez sur JobScout. N'ouvrez pas JobScout depuis la fenêtre du disque téléchargé."
  );
  if (signature === "adhoc") {
    lines.push(
      `4. **Premier lancement, une fois par version.** JobScout est gratuit et son code est public, mais ${SIGNATURE_MARKERS.adhoc} (inscription payante) : macOS bloque sa première ouverture.`,
      "   - Dans le message de macOS, cliquez sur **OK** (ou **Terminé**), jamais sur « Placer dans la corbeille ».",
      "   - Menu Pomme > **Réglages Système** > **Confidentialité et sécurité**. Descendez jusqu'à **Sécurité**, cliquez sur **Ouvrir quand même**, confirmez, puis saisissez le mot de passe de votre session.",
      "   - Sur macOS 11 à 14 : clic droit (ou control-clic) sur JobScout > **Ouvrir** > **Ouvrir**.",
      `   - Le pas à pas, pour chaque version de macOS : [guide Mac](${guide}#${FIRST_LAUNCH_ANCHOR}).`
    );
  } else {
    lines.push(
      `4. **Premier lancement.** ${SIGNATURE_MARKERS["developer-id"]} : macOS vous demande seulement de confirmer que vous voulez l'ouvrir.`
    );
  }
  lines.push(
    "5. La fenêtre « JobScout démarre… » s'affiche, puis votre navigateur s'ouvre sur JobScout (en principe http://127.0.0.1:3477).",
    "",
    "Pour arrêter JobScout : menu JobScout > **Quitter JobScout** (⌘Q). Fermer la fenêtre ou l'onglet n'arrête rien.",
    "",
    "Vos données restent sur votre Mac, dans `~/Library/Application Support/JobScout` (menu JobScout > Dossier de données). Remplacer ou supprimer l'application ne les efface pas.",
    "",
    "## Vérifier le fichier (facultatif)",
    "",
    "Empreinte SHA-256 de JobScout-Mac.dmg (également dans SHA256SUMS.txt) :",
    "",
    "```",
    sha256,
    "```",
    "",
    "Dans le Terminal : `shasum -a 256 ~/Downloads/JobScout-Mac.dmg` doit afficher la même suite de caractères."
  );
  if (commit) {
    const short = String(commit).slice(0, 12);
    lines.push(
      "",
      `Construit par GitHub Actions à partir du commit [${short}](${site}/commit/${commit}), puis testé sur macOS 15 et 26, puce Apple et Intel. ` +
        `Attestation de provenance : \`gh attestation verify JobScout-Mac.dmg --repo ${repo}\`.`
    );
  }
  lines.push(
    "",
    "## Windows et Linux",
    "",
    `Cette version ne contient pas d'installeur pour Windows ni pour Linux : installez JobScout depuis le code source en suivant le [guide d'installation](${install}).`
  );
  const text = String(changelog ?? "").trim();
  if (text) lines.push("", `## Nouveautés de la version ${version}`, "", text);
  lines.push("", "---", "", `JobScout est distribué sous licence MIT : [LICENSE](${site}/blob/v${version}/LICENSE).`, "");
  return lines.join("\n");
}

/** SHA-256 d'un fichier, lu par blocs (le DMG pèse plusieurs centaines de Mo). */
export function sha256File(file) {
  const hash = crypto.createHash("sha256");
  const fd = fs.openSync(file, "r");
  try {
    const buf = Buffer.allocUnsafe(1 << 20);
    let n;
    while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) hash.update(buf.subarray(0, n));
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest("hex");
}

/**
 * Notes de la Release à partir du DMG et de version.json.
 * @param {{ dmg: string, version?: string, repo?: string | null, signature?: string, commit?: string | null, root?: string }} options
 */
export function releaseNotesFor({ dmg, version, repo, signature = "adhoc", commit = null, root = PROJECT }) {
  const meta = JSON.parse(fs.readFileSync(path.join(root, "version.json"), "utf-8"));
  const v = version ?? meta.version;
  const r = repo ?? currentRepo(process.env, root);
  if (!r) throw new Error("dépôt inconnu : GH_REPO absent et remote « origin » illisible");
  const changelog = meta.changelog?.[v] ?? "";
  return renderReleaseNotes({
    version: v,
    repo: r,
    sha256: sha256File(dmg),
    sizeBytes: fs.statSync(dmg).size,
    signature,
    commit,
    changelog,
  });
}

function parseArgs(argv) {
  const out = { dmg: null, out: null, version: undefined, repo: undefined, signature: "adhoc", commit: null };
  const keys = { "--dmg": "dmg", "--out": "out", "--version": "version", "--repo": "repo", "--signature": "signature", "--commit": "commit" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const [k, inline] = a.includes("=") ? [a.slice(0, a.indexOf("=")), a.slice(a.indexOf("=") + 1)] : [a, undefined];
    if (!(k in keys)) throw new Error(`argument inconnu : ${a}`);
    const v = inline ?? argv[++i];
    if (v === undefined || v === "") throw new Error(`${k} attend une valeur`);
    out[keys[k]] = v;
  }
  if (!out.dmg) throw new Error("--dmg est obligatoire");
  return out;
}

function main(argv) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (e) {
    process.stderr.write(
      `[notes] ${e.message}\nusage : node installer/mac/release-notes.mjs --dmg <JobScout-Mac.dmg> [--out <fichier>] ` +
        "[--version X.Y.Z] [--repo <propriétaire/dépôt>] [--signature adhoc|developer-id] [--commit <sha>]\n"
    );
    return 2;
  }
  try {
    const text = releaseNotesFor(args);
    if (args.out) fs.writeFileSync(args.out, text, "utf-8");
    else process.stdout.write(text);
    return 0;
  } catch (e) {
    process.stderr.write(`[notes] ÉCHEC : ${e instanceof Error ? e.message : String(e)}\n`);
    return 1;
  }
}

const isMain = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) process.exitCode = main(process.argv.slice(2));
