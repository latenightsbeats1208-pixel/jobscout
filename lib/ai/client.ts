import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { getSetting } from "@/lib/db";

/**
 * Client Claude routé selon le mode configuré (DESIGN.md proxy §6.1) :
 *
 * - mode « pack »  : les appels passent par le proxy JobScout, authentifiés
 *   par la clé de licence (le SDK l'envoie en `x-api-key`). Quota décompté
 *   côté serveur. `maxRetries: 0` + timeout long : le proxy rembourse les
 *   échecs, c'est l'UI qui propose « Réessayer » — un retry automatique du
 *   SDK pourrait consommer deux réservations pour un seul dossier.
 * - mode « byok »  : clé Anthropic personnelle de l'utilisateur, appels
 *   directs à l'API Anthropic, défauts SDK.
 *
 * L'empreinte de configuration est relue à CHAQUE getClaude() via getSetting()
 * (SQLite synchrone, négligeable) : le build standalone duplique ce module
 * dans plusieurs bundles (msg/route.js, chunks/…), donc un simple
 * `resetClaude()` module-local ne suffit pas — le cache client vit sur
 * `globalThis`, partagé entre toutes les copies du module, et se reconstruit
 * dès que l'empreinte change.
 *
 * `baseURL` est TOUJOURS passé explicitement pour neutraliser une
 * `ANTHROPIC_BASE_URL` qui traînerait dans l'environnement du poste.
 */

/** URL du proxy JobScout — placeholder tant que l'hébergement n'est pas arrêté. */
export const DEFAULT_PROXY_URL = "https://api.jobscout.app";

/** API Anthropic directe (mode BYOK). Surcharge test/debug uniquement. */
const ANTHROPIC_API_URL = "https://api.anthropic.com";

export type LlmMode = "pack" | "byok" | "unset";

/** Clés de la table settings — partagées avec la route /api/settings/llm. */
export const LLM_SETTING_KEYS = {
  mode: "llm:mode",
  licenseKey: "llm:license_key",
  byokKey: "llm:byok_key",
} as const;

/** Levée quand aucune configuration IA n'existe — traduite en 400 côté routes. */
export class LlmNotConfiguredError extends Error {
  constructor() {
    super(
      "Génération IA non configurée — choisissez « Pack JobScout » ou « Ma clé API Anthropic » dans Profil › Génération IA."
    );
    this.name = "LlmNotConfiguredError";
  }
}

/** Normalise une URL de proxy : supprime les `/` et le `/v1` finaux (le SDK ajoute `/v1/messages`). */
export function normalizeProxyUrl(raw: string): string {
  let url = raw.trim().replace(/\/+$/, "");
  url = url.replace(/\/v1$/i, "").replace(/\/+$/, "");
  return url;
}

/** URL effective du proxy : constante en dur, surchargeable par l'environnement. */
export function proxyBaseUrl(): string {
  const fromEnv = process.env.JOBSCOUT_PROXY_URL?.trim();
  return normalizeProxyUrl(fromEnv || DEFAULT_PROXY_URL);
}

/** URL de l'API Anthropic (BYOK). `JOBSCOUT_ANTHROPIC_BASE_URL` sert aux tests (mock local). */
export function anthropicBaseUrl(): string {
  const fromEnv = process.env.JOBSCOUT_ANTHROPIC_BASE_URL?.trim();
  return normalizeProxyUrl(fromEnv || ANTHROPIC_API_URL);
}

export type LlmConfig = {
  mode: LlmMode;
  /** Clé active (licence ou clé Anthropic). Ne JAMAIS la renvoyer au navigateur. */
  apiKey: string | null;
  baseURL: string;
  /** "settings" = configuré par l'utilisateur ; "env" = rétro-compat dev. */
  source: "settings" | "env" | null;
};

const clean = (v: string | null | undefined): string | null => {
  const t = (v ?? "").trim();
  return t.length > 0 ? t : null;
};

/**
 * Lit la configuration au moment de l'appel (jamais mise en cache : c'est
 * l'empreinte qui pilote la reconstruction du client).
 */
export function getLlmConfig(): LlmConfig {
  const mode = clean(getSetting(LLM_SETTING_KEYS.mode));
  const licenseKey = clean(getSetting(LLM_SETTING_KEYS.licenseKey));
  const byokKey = clean(getSetting(LLM_SETTING_KEYS.byokKey));

  if (mode === "pack" && licenseKey) {
    return { mode: "pack", apiKey: licenseKey, baseURL: proxyBaseUrl(), source: "settings" };
  }
  if (mode === "byok" && byokKey) {
    return { mode: "byok", apiKey: byokKey, baseURL: anthropicBaseUrl(), source: "settings" };
  }

  // Rétro-compat développement UNIQUEMENT : une ANTHROPIC_API_KEY d'environnement
  // ne doit JAMAIS être consommée par l'exécutable vendu (la clé perso d'un
  // utilisateur serait utilisée sans son consentement).
  if (process.env.NODE_ENV !== "production") {
    const envKey = clean(process.env.ANTHROPIC_API_KEY);
    if (envKey) {
      return { mode: "byok", apiKey: envKey, baseURL: anthropicBaseUrl(), source: "env" };
    }
  }

  return { mode: "unset", apiKey: null, baseURL: proxyBaseUrl(), source: null };
}

/** État sûr pour l'UI : jamais de clé en clair, hints masqués (4 derniers symboles). */
export type LlmState = {
  mode: LlmMode;
  configured: boolean;
  source: "settings" | "env" | null;
  licenseHint: string | null;
  byokHint: string | null;
  proxyUrl: string;
};

const hint = (key: string | null): string | null =>
  key && key.length >= 8 ? `…${key.slice(-4)}` : key ? "…" : null;

export function getLlmState(): LlmState {
  const cfg = getLlmConfig();
  return {
    mode: cfg.mode,
    configured: cfg.mode !== "unset",
    source: cfg.source,
    licenseHint: hint(clean(getSetting(LLM_SETTING_KEYS.licenseKey))),
    byokHint: hint(clean(getSetting(LLM_SETTING_KEYS.byokKey))),
    proxyUrl: proxyBaseUrl(),
  };
}

// Cache partagé entre les copies du module dupliquées par le build standalone.
type LlmCache = { fingerprint: string; client: Anthropic };
const G = globalThis as typeof globalThis & { __jobscoutLlmClient?: LlmCache };

export function getClaude(): Anthropic {
  const cfg = getLlmConfig();
  if (cfg.mode === "unset" || !cfg.apiKey) throw new LlmNotConfiguredError();

  const fingerprint = JSON.stringify([cfg.mode, cfg.apiKey, cfg.baseURL]);
  const cached = G.__jobscoutLlmClient;
  if (cached && cached.fingerprint === fingerprint) return cached.client;

  const client = new Anthropic({
    apiKey: cfg.apiKey,
    baseURL: cfg.baseURL,
    // authToken explicitement neutralisé, au même titre que baseURL : sans lui,
    // le SDK lit ANTHROPIC_AUTH_TOKEN dans l'environnement du poste
    // (index.js:56) et l'envoie en `Authorization: Bearer …` à CHAQUE appel —
    // y compris vers le proxy JobScout, donc vers un tiers, sans consentement.
    authToken: null,
    // Mode pack : pas de retry SDK (le proxy rembourse, l'UI propose de
    // réessayer) et timeout long (génération Opus non-streaming = minutes).
    ...(cfg.mode === "pack" ? { maxRetries: 0, timeout: 150_000 } : {}),
  });
  G.__jobscoutLlmClient = { fingerprint, client };
  return client;
}

/**
 * Best-effort : vide le cache de CE bundle (et de tous, via globalThis).
 * La vraie garantie de fraîcheur reste l'empreinte relue à chaque appel.
 */
export function resetClaude(): void {
  delete G.__jobscoutLlmClient;
}

// IDs de modèles surchargeables via env (JOBSCOUT_MODEL_OPUS / JOBSCOUT_MODEL_SONNET)
// pour ne pas avoir à redéployer si Anthropic publie une nouvelle version.
// En mode pack, le proxy FORCE de toute façon le modèle côté serveur.
export const MODELS = {
  // Heavy: extraction CV, génération CV/LM
  opus: process.env.JOBSCOUT_MODEL_OPUS || "claude-opus-4-8",
  // Volumique: scoring offres, MSG V.I.E
  sonnet: process.env.JOBSCOUT_MODEL_SONNET || "claude-sonnet-5",
} as const;
