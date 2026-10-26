/**
 * Connexion par mot de passe unique, pour un JobScout auto-hébergé (un seul
 * utilisateur). Actif seulement si JOBSCOUT_PASSWORD est défini : en local,
 * rien ne change.
 *
 * Le cookie de session porte HMAC-SHA256(mot de passe, libellé fixe) : rien à
 * stocker côté serveur, et changer le mot de passe déconnecte toutes les
 * sessions. Web Crypto uniquement : ce module tourne aussi dans le middleware
 * (runtime Edge).
 */
export const SESSION_COOKIE = "jobscout_session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 90; // 90 jours

const SESSION_LABEL = "jobscout-session-v1";

function password(): string {
  return process.env.JOBSCOUT_PASSWORD ?? "";
}

export function authEnabled(): boolean {
  return password().length > 0;
}

async function hmacHex(key: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const k = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, enc.encode(message));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function expectedSessionToken(): Promise<string> {
  return hmacHex(password(), SESSION_LABEL);
}

/** Comparaison en temps constant (longueurs égales) : pas d'oracle de timing. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Vérifie un mot de passe saisi, sans comparer directement les chaînes. */
export async function checkPassword(candidate: string): Promise<boolean> {
  if (!authEnabled()) return false;
  const [a, b] = await Promise.all([hmacHex(candidate, SESSION_LABEL), expectedSessionToken()]);
  return safeEqual(a, b);
}
