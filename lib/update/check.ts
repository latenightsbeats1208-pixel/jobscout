import "server-only";
import fs from "node:fs";
import path from "node:path";

/**
 * Vérification de mise à jour — une seule fois par démarrage du serveur,
 * délai court, échec totalement silencieux (l'app doit rester utilisable
 * hors-ligne). Aucune donnée utilisateur n'est envoyée : c'est un simple GET.
 */

// L'hébergement définitif n'est pas encore arrêté : URL surchargeable par
// l'environnement, avec ce placeholder par défaut.
export const DEFAULT_UPDATE_URL = "https://updates.jobscout.app/version.json";
const FETCH_TIMEOUT_MS = 4000;

/**
 * Variant de build : « test » pour l'installeur de test (installer/build.mjs
 * --variant test — assemble.mjs écrit alors `variant: "test"` dans le
 * version.json du paquet), « prod » sinon. Le nom de produit affiché en suit.
 */
export type BuildVariant = "prod" | "test";

export type UpdateStatus = {
  current: string;
  variant: BuildVariant;
  latest: string | null;
  updateAvailable: boolean;
  downloadUrl: string | null;
  /** Empreinte SHA-256 de l'installeur annoncée par le feed (optionnelle). */
  sha256: string | null;
  notes: string | null;
  checkedAt: string | null;
};

/**
 * Supply-chain (DESIGN.md §6.7) : le feed de mise à jour est servi par le
 * proxy et traité comme DONNÉE NON FIABLE. Un lien de téléchargement n'est
 * accepté que vers un hôte de cette allowlist EN DUR — un feed compromis ne
 * peut pas rediriger l'utilisateur vers un binaire arbitraire. Jamais
 * d'auto-exécution : notification seule.
 */
const ALLOWED_DOWNLOAD_HOSTS = ["github.com", "updates.jobscout.app"];

export function sanitizeDownloadUrl(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== "https:") return null;
    if (!ALLOWED_DOWNLOAD_HOSTS.includes(url.hostname.toLowerCase())) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function sanitizeSha256(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim().toLowerCase();
  return /^[0-9a-f]{64}$/.test(v) ? v : null;
}

let _current: string | null = null;
let _variant: BuildVariant | null = null;

function readVersionFile(): { version?: string; variant?: string } {
  try {
    const raw = fs.readFileSync(path.join(process.cwd(), "version.json"), "utf-8");
    return JSON.parse(raw) as { version?: string; variant?: string };
  } catch {
    return {};
  }
}

/** Version locale : env (posée par le launcher) puis version.json du paquet. */
export function currentVersion(): string {
  if (_current) return _current;
  const fromEnv = process.env.JOBSCOUT_VERSION?.trim();
  if (fromEnv) {
    _current = fromEnv;
    return _current;
  }
  const parsed = readVersionFile();
  _current = typeof parsed.version === "string" ? parsed.version : "0.0.0";
  return _current;
}

/** Variant de build lu dans version.json du paquet ; « prod » par défaut. */
export function currentVariant(): BuildVariant {
  if (_variant) return _variant;
  _variant = readVersionFile().variant === "test" ? "test" : "prod";
  return _variant;
}

/** Nom de produit affiché : « JobScout Test » pour le variant de test. */
export function productName(): string {
  return currentVariant() === "test" ? "JobScout Test" : "JobScout";
}

/** Comparaison sémantique simple (majeur.mineur.correctif). */
export function isNewer(candidate: string, reference: string): boolean {
  const parse = (v: string) =>
    v
      .trim()
      .replace(/^v/i, "")
      .split(".")
      .map((p) => parseInt(p, 10) || 0);
  const a = parse(candidate);
  const b = parse(reference);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}

let cached: UpdateStatus | null = null;
let inFlight: Promise<UpdateStatus> | null = null;

function offlineStatus(): UpdateStatus {
  return {
    current: currentVersion(),
    variant: currentVariant(),
    latest: null,
    updateAvailable: false,
    downloadUrl: null,
    sha256: null,
    notes: null,
    checkedAt: null,
  };
}

export async function getUpdateStatus(): Promise<UpdateStatus> {
  if (cached) return cached;
  if (inFlight) return inFlight;
  if (process.env.JOBSCOUT_DISABLE_UPDATE_CHECK === "1") return offlineStatus();

  const url = process.env.JOBSCOUT_UPDATE_URL?.trim() || DEFAULT_UPDATE_URL;

  inFlight = (async (): Promise<UpdateStatus> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        cache: "no-store",
        headers: { accept: "application/json" },
      });
      if (!res.ok) return offlineStatus();
      const data = (await res.json()) as {
        version?: string;
        download_url?: string;
        sha256?: string;
        notes?: string;
      };
      const latest = typeof data.version === "string" ? data.version : null;
      const status: UpdateStatus = {
        current: currentVersion(),
        variant: currentVariant(),
        latest,
        updateAvailable: !!latest && isNewer(latest, currentVersion()),
        // Hôte hors allowlist → null : la pastille annonce la version sans lien.
        downloadUrl: sanitizeDownloadUrl(data.download_url),
        sha256: sanitizeSha256(data.sha256),
        notes: typeof data.notes === "string" ? data.notes : null,
        checkedAt: new Date().toISOString(),
      };
      cached = status;
      return status;
    } catch {
      // Hors-ligne, DNS absent, endpoint pas encore hébergé : on ne dit rien.
      return offlineStatus();
    } finally {
      clearTimeout(timer);
      inFlight = null;
    }
  })();

  return inFlight;
}
