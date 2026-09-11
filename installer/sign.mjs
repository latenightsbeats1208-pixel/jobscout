// ============================================================================
// installer/sign.mjs — signature Authenticode de la chaîne de build.
//
// Deux binaires sortent de la chaîne : le launcher JobScout.exe (dans la
// charge utile, AVANT compression par Inno Setup) et l'installeur produit par
// ISCC (plus son désinstalleur, signé par Inno via SignTool=). Sans signature,
// SmartScreen affiche « Éditeur inconnu » chez chaque testeur.
//
// Configuration par VARIABLES D'ENVIRONNEMENT UNIQUEMENT — le certificat ne
// doit jamais entrer dans le dépôt, ni son chemin ni son mot de passe :
//
//   JOBSCOUT_SIGN_PFX            chemin du .pfx (hors du dépôt !)
//   JOBSCOUT_SIGN_PFX_PASSWORD   mot de passe du .pfx
//     — ou bien —
//   JOBSCOUT_SIGN_THUMBPRINT     empreinte SHA1 d'un certificat du magasin
//                                utilisateur (cas token EV / Trusted Signing)
//
//   JOBSCOUT_SIGN_TIMESTAMP_URL  serveur RFC 3161 (défaut : DigiCert)
//   JOBSCOUT_SIGNTOOL            chemin de signtool.exe (sinon Windows SDK)
//
// L'HORODATAGE EST OBLIGATOIRE : sans lui, les signatures expirent avec le
// certificat (1-3 ans) et les binaires distribués redeviennent « inconnus ».
// signFile() échoue donc si aucun serveur d'horodatage ne répond, et
// verifyAuthenticode() refuse une signature non horodatée.
//
// Aucun secret n'apparaît dans les journaux : les erreurs de signtool sont
// reconstruites depuis sa sortie, jamais depuis la ligne de commande (qui
// contient /p <mot de passe>).
//
// Usage CLI (c'est la commande que lance Inno Setup via /SJobScoutSign=) :
//   node installer/sign.mjs <fichier.exe> [...]
// ============================================================================
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const DEFAULT_TSA = "http://timestamp.digicert.com";
const FALLBACK_TSA = "http://timestamp.sectigo.com";

const log = (m) => process.stdout.write(`[sign] ${m}\n`);

// ------------------------------------------------------------- configuration
export function signingEnabled() {
  return Boolean(
    process.env.JOBSCOUT_SIGN_PFX || process.env.JOBSCOUT_SIGN_THUMBPRINT
  );
}

/** Description de la configuration pour les journaux — sans aucun secret. */
export function signingDescription() {
  if (process.env.JOBSCOUT_SIGN_PFX) {
    return `certificat PFX : ${path.basename(process.env.JOBSCOUT_SIGN_PFX)}`;
  }
  if (process.env.JOBSCOUT_SIGN_THUMBPRINT) {
    const t = process.env.JOBSCOUT_SIGN_THUMBPRINT;
    return `certificat du magasin utilisateur (empreinte ${t.slice(0, 8)}…)`;
  }
  return "signature désactivée";
}

function credentialArgs() {
  const pfx = process.env.JOBSCOUT_SIGN_PFX;
  const thumbprint = process.env.JOBSCOUT_SIGN_THUMBPRINT;
  if (pfx) {
    if (!fs.existsSync(pfx)) {
      throw new Error(`JOBSCOUT_SIGN_PFX pointe sur un fichier absent : ${pfx}`);
    }
    const args = ["/f", pfx];
    if (process.env.JOBSCOUT_SIGN_PFX_PASSWORD) {
      args.push("/p", process.env.JOBSCOUT_SIGN_PFX_PASSWORD);
    }
    return args;
  }
  if (thumbprint) return ["/sha1", thumbprint.replace(/\s/g, "")];
  throw new Error(
    "Signature demandée sans certificat : définissez JOBSCOUT_SIGN_PFX (+ " +
      "JOBSCOUT_SIGN_PFX_PASSWORD) ou JOBSCOUT_SIGN_THUMBPRINT."
  );
}

// ------------------------------------------------------------------ signtool
export function findSignTool() {
  const fromEnv = process.env.JOBSCOUT_SIGNTOOL;
  if (fromEnv) {
    if (!fs.existsSync(fromEnv)) {
      throw new Error(`JOBSCOUT_SIGNTOOL pointe sur un fichier absent : ${fromEnv}`);
    }
    return fromEnv;
  }
  const kitRoots = [
    "C:\\Program Files (x86)\\Windows Kits\\10\\bin",
    "C:\\Program Files\\Windows Kits\\10\\bin",
  ];
  const candidates = [];
  for (const root of kitRoots) {
    if (!fs.existsSync(root)) continue;
    for (const dir of fs.readdirSync(root)) {
      if (!/^10\.\d+/.test(dir)) continue;
      const exe = path.join(root, dir, "x64", "signtool.exe");
      if (fs.existsSync(exe)) candidates.push({ version: dir, exe });
    }
  }
  if (!candidates.length) {
    throw new Error(
      "signtool.exe introuvable (Windows SDK). Installez le composant " +
        "« Windows SDK Signing Tools » ou définissez JOBSCOUT_SIGNTOOL."
    );
  }
  // La version de SDK la plus récente.
  candidates.sort((a, b) =>
    b.version.localeCompare(a.version, undefined, { numeric: true })
  );
  return candidates[0].exe;
}

/**
 * Exécution de signtool SANS jamais rejeter la ligne de commande dans
 * l'erreur : execFileSync inclurait les arguments (donc le mot de passe du
 * PFX) dans e.message. On reconstruit l'erreur depuis stdout/stderr seuls.
 */
function runSignTool(args) {
  const res = spawnSync(findSignTool(), args, { encoding: "utf-8" });
  if (res.error) throw new Error(`signtool : ${res.error.message}`);
  if (res.status !== 0) {
    const output = [res.stdout, res.stderr].filter(Boolean).join("\n").trim();
    throw new Error(output || `signtool a rendu le code ${res.status}`);
  }
  return (res.stdout || "").trim();
}

// ----------------------------------------------------------------- signature
/**
 * Signe un binaire (SHA-256) avec horodatage RFC 3161. Les serveurs
 * d'horodatage sont des services gratuits parfois capricieux : on tente le
 * serveur configuré puis un serveur de repli, deux passes chacune.
 */
export function signFile(file) {
  if (!fs.existsSync(file)) throw new Error(`Fichier à signer absent : ${file}`);
  const creds = credentialArgs();
  const primary = process.env.JOBSCOUT_SIGN_TIMESTAMP_URL || DEFAULT_TSA;
  const servers = [...new Set([primary, FALLBACK_TSA, primary])];

  let lastError = null;
  for (const tsa of servers) {
    try {
      runSignTool([
        "sign",
        "/fd", "SHA256",
        "/tr", tsa,
        "/td", "SHA256",
        "/d", "JobScout",
        ...creds,
        file,
      ]);
      return { file, tsa };
    } catch (e) {
      lastError = e;
    }
  }
  throw new Error(
    `Signature de ${path.basename(file)} échouée (horodatage compris) :\n` +
      (lastError?.message || "raison inconnue")
  );
}

// -------------------------------------------------------------- vérification
/**
 * Vérifie via Get-AuthenticodeSignature (PowerShell) qu'un binaire est signé
 * ET horodaté. Statuts acceptés :
 *   - Valid        : chaîne approuvée (certificat commercial) ;
 *   - UnknownError : signature intègre mais chaîne non approuvée — le cas
 *                    d'un certificat de test auto-signé. Toléré avec
 *                    avertissement pour ne pas bloquer les builds d'essai.
 * Tout le reste (NotSigned, HashMismatch…) est une erreur, de même qu'une
 * signature sans horodatage.
 */
export function verifyAuthenticode(file) {
  const escaped = file.replace(/'/g, "''");
  const script =
    `$sig = Get-AuthenticodeSignature -LiteralPath '${escaped}'; ` +
    `[pscustomobject]@{ ` +
    `status = [string]$sig.Status; ` +
    `signer = if ($sig.SignerCertificate) { $sig.SignerCertificate.Subject } else { $null }; ` +
    `notAfter = if ($sig.SignerCertificate) { $sig.SignerCertificate.NotAfter.ToString('yyyy-MM-dd') } else { $null }; ` +
    `timestamper = if ($sig.TimeStamperCertificate) { $sig.TimeStamperCertificate.Subject } else { $null } ` +
    `} | ConvertTo-Json -Compress`;
  const res = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
    { encoding: "utf-8" }
  );
  if (res.status !== 0 || !res.stdout?.trim()) {
    throw new Error(
      `Get-AuthenticodeSignature inutilisable sur ${path.basename(file)} : ` +
        (res.stderr || "").trim()
    );
  }
  const info = JSON.parse(res.stdout.trim());

  if (info.status === "NotSigned" || !info.signer) {
    throw new Error(`${path.basename(file)} n'est PAS signé.`);
  }
  if (!info.timestamper) {
    throw new Error(
      `${path.basename(file)} est signé SANS horodatage : la signature ` +
        "expirera avec le certificat. Refusé."
    );
  }
  if (info.status !== "Valid" && info.status !== "UnknownError") {
    throw new Error(
      `Signature de ${path.basename(file)} invalide (statut ${info.status}).`
    );
  }
  return info;
}

/** Journalise le verdict d'un binaire signé, sous une forme lisible. */
export function reportSignature(file, info) {
  const cn = /CN=([^,]+)/.exec(info.signer || "")?.[1] || info.signer;
  log(`${path.basename(file)} : signé par « ${cn} », horodaté, expire le ${info.notAfter}`);
  if (info.status === "UnknownError") {
    log(
      "  AVERTISSEMENT : chaîne de certification non approuvée (certificat de " +
        "test auto-signé ?). SmartScreen traitera ce binaire comme non signé."
    );
  }
}

// ------------------------------------ CLI (utilisée par Inno Setup via /S…)
const isMain =
  !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const files = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  if (!files.length) {
    console.error("Usage : node installer/sign.mjs <fichier.exe> [...]");
    process.exit(2);
  }
  try {
    for (const file of files) {
      const { tsa } = signFile(file);
      log(`${path.basename(file)} signé (horodatage : ${tsa})`);
      reportSignature(file, verifyAuthenticode(file));
    }
  } catch (e) {
    console.error(`[sign] ÉCHEC : ${e.message}`);
    process.exit(1);
  }
}
