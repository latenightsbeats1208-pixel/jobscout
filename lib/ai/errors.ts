import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { LlmNotConfiguredError } from "./client";

/**
 * Traduction FR des erreurs IA pour les routes de génération (DESIGN.md §6.4).
 *
 * Le proxy renvoie un corps d'erreur au format Anthropic enrichi d'un champ
 * `code` machine : `{ type: "error", error: { type, message, code }, message }`.
 * Le SDK expose ce corps dans `e.error` — on lit `e.error?.error?.code`,
 * JAMAIS de string-matching sur `e.message`.
 */

export type TranslatedAiError = { message: string; status: number };

/**
 * Erreur de CONTENU du pipeline IA : réponse du modèle inexploitable (tronquée,
 * hors schéma, vide) ou entrée refusée avant l'appel (document trop volumineux).
 * Son message est déjà rédigé en français et actionnable — il est donc remonté
 * tel quel à l'utilisateur, contrairement aux erreurs techniques dont le message
 * anglais brut ne doit jamais atteindre l'UI.
 */
export class AiContentError extends Error {
  readonly httpStatus: number;
  constructor(message: string, httpStatus = 502) {
    super(message);
    this.name = "AiContentError";
    this.httpStatus = httpStatus;
  }
}

/**
 * Repli des routes de génération pour toute erreur NON liée à l'IA (rendu PDF,
 * écriture disque, bibliothèque tierce) : jamais le message technique anglais.
 */
export const GENERIC_FAILURE_MESSAGE =
  "La génération a échoué pour une raison technique — réessayez ; si le problème persiste, redémarrez JobScout.";

const CODE_MESSAGES: Record<string, string> = {
  QUOTA_EXHAUSTED:
    "Pack épuisé — rechargez ou passez sur votre clé API dans Profil › Génération IA.",
  LICENSE_INVALID:
    "Clé de licence invalide ou inconnue — vérifiez-la dans Profil › Génération IA.",
  LICENSE_SUSPENDED:
    "Licence suspendue — contactez le support JobScout pour la réactiver.",
  RATE_LIMITED:
    "Trop de générations sur la dernière heure — patientez quelques minutes avant de réessayer.",
  CONCURRENCY_LIMITED:
    "Plusieurs générations sont déjà en cours — réessayez dans quelques secondes.",
  UPSTREAM_ERROR:
    "Le service de génération est momentanément indisponible — réessayez dans un instant.",
  BAD_REQUEST:
    "La demande a été refusée par le service de génération (document ou offre trop volumineux) — réduisez la taille du CV ou de l'offre puis réessayez.",
};

/** `status` est `undefined` sur les erreurs de transport du SDK (pas de réponse HTTP). */
type ApiErrorLike = { status: number | undefined; error?: unknown };

/**
 * Détection SANS dépendre d'instanceof seul : le client Anthropic est mis en
 * cache sur globalThis et partagé entre les copies de ce module que le build
 * (et même le dev) duplique par bundle de route — une APIError créée par la
 * copie A du SDK n'est PAS instanceof de la classe de la copie B.
 *
 * Le repli duck-type porte sur la FORME et non sur le nom de la classe : le
 * SDK ne pose jamais `this.name` (donc `e.name` vaut toujours « Error ») et le
 * bundler minifie `e.constructor.name` en « bH » — un test par regex sur ces
 * noms ne pouvait rien matcher dans le build de production.
 */
function asApiError(e: unknown): ApiErrorLike | null {
  if (e instanceof Anthropic.APIError) {
    return { status: typeof e.status === "number" ? e.status : undefined, error: e.error };
  }
  if (e instanceof Error && "status" in e && "error" in e && "headers" in e) {
    const status = (e as { status: unknown }).status;
    return {
      status: typeof status === "number" ? status : undefined,
      error: (e as { error?: unknown }).error,
    };
  }
  return null;
}

/**
 * Traduit une erreur levée par un appel IA en message FR + statut HTTP.
 * Renvoie null si l'erreur n'est pas liée à l'IA (le catch appelant garde
 * alors son comportement générique).
 */
export function translateAiError(e: unknown): TranslatedAiError | null {
  if (
    e instanceof LlmNotConfiguredError ||
    (e instanceof Error && e.name === "LlmNotConfiguredError")
  ) {
    return { message: e.message, status: 400 };
  }

  // Contenu inexploitable (tronqué, hors schéma, vide) : message FR déjà rédigé.
  // Le test par `name` couvre les copies du module dupliquées par le bundler.
  if (e instanceof AiContentError || (e instanceof Error && e.name === "AiContentError")) {
    const status = (e as { httpStatus?: unknown }).httpStatus;
    return { message: e.message, status: typeof status === "number" ? status : 502 };
  }

  const apiError = asApiError(e);
  if (apiError) {
    // Pas de statut HTTP = aucune réponse reçue : APIConnectionError (et sa
    // sous-classe timeout) hérite d'APIError, ce test doit donc être fait ICI
    // et pas après — sinon la panne la plus fréquente d'une app de bureau,
    // « hors-ligne », renvoyait l'utilisateur vérifier une configuration
    // pourtant correcte.
    if (typeof apiError.status !== "number" || apiError.status < 100) {
      if (e instanceof Anthropic.APIConnectionTimeoutError) {
        return {
          message:
            "La génération a dépassé le délai d'attente — relancez-la ; si cela se reproduit, réessayez plus tard.",
          status: 504,
        };
      }
      return {
        message:
          "Impossible de joindre le service de génération — vérifiez votre connexion internet puis réessayez.",
        status: 502,
      };
    }
    const status = apiError.status;
    // Corps proxy : { type, error: { code, … }, message } — e.error est le corps entier.
    const body = apiError.error as { error?: { code?: unknown } } | undefined;
    const code = body?.error?.code;
    if (typeof code === "string" && CODE_MESSAGES[code]) {
      return { message: CODE_MESSAGES[code], status };
    }
    // Inconnu (y compris page HTML d'un edge que le SDK n'a pas su parser) :
    // fallback générique avec le statut, sans relayer un corps illisible.
    return {
      message: `Erreur du service de génération (HTTP ${status}) — réessayez ; si le problème persiste, vérifiez votre configuration dans Profil › Génération IA.`,
      status,
    };
  }

  return null;
}

/** Erreur FR claire quand la réponse du modèle est tronquée (stop_reason max_tokens). */
export function assertNotTruncated(
  message: { stop_reason: string | null },
  what: string
): void {
  if (message.stop_reason === "max_tokens") {
    throw new AiContentError(
      `La réponse IA pour ${what} a été tronquée (limite de longueur atteinte) — relancez la génération ; si le problème persiste, réduisez la taille du document ou de l'offre.`
    );
  }
}

/**
 * Repli commun des routes de génération : message FR pour l'utilisateur, détail
 * technique dans les logs serveur uniquement. Sans lui, un « ENOSPC: no space
 * left on device » d'une bibliothèque de rendu atterrissait tel quel dans l'UI
 * d'un exécutable grand public.
 */
export function genericFailure(where: string, e: unknown): string {
  console.error(`[${where}] échec non-IA :`, e);
  // En développement uniquement : le détail technique est ajouté au message
  // pour diagnostiquer sans accès au terminal du serveur. Jamais en production.
  if (process.env.NODE_ENV !== "production") {
    const stackHead = e instanceof Error ? (e.stack ?? "").split("\n").slice(1, 4).join(" | ") : "";
    const detail = e instanceof Error ? `${e.name}: ${e.message} ${stackHead}` : String(e);
    return `${GENERIC_FAILURE_MESSAGE} [dev] ${detail}`;
  }
  return GENERIC_FAILURE_MESSAGE;
}
