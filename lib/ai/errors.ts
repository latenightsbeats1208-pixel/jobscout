import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { LlmNotConfiguredError } from "./client";
import { PROVIDERS, type ProviderId } from "./providers";

/**
 * Traduction FR des erreurs IA pour les routes de génération.
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
    "Crédits du relais épuisés — passez sur votre clé API dans Profil › Génération IA.",
  LICENSE_INVALID:
    "Clé de licence invalide ou inconnue — vérifiez-la dans Profil › Génération IA.",
  LICENSE_SUSPENDED:
    "Licence refusée par le relais — passez sur votre clé API dans Profil › Génération IA.",
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

  // Fournisseurs compatibles OpenAI (lib/ai/llm.ts) — détection par nom : le
  // bundler duplique le module, instanceof ne suffit pas.
  if (e instanceof Error && e.name === "LlmTransportError") {
    const t = e as Error & { provider?: string; url?: string; timeout?: boolean; code?: string; phase?: string; timeoutMs?: number };
    return transportMessage(t);
  }
  if (e instanceof Error && e.name === "LlmHttpError") {
    const h = e as Error & { status?: number; provider?: string; detail?: string };
    const status = typeof h.status === "number" ? h.status : 502;
    const label = providerLabel(h.provider);
    const detail = (h.detail ?? "").trim();
    const suffix = detail ? ` (détail : ${detail.slice(0, 160)})` : "";
    // Ollama en local n'a pas de clé : son 401 vient des modèles « cloud », qu'il
    // relaie vers ollama.com et qui exigent un compte connecté sur sa machine.
    // « Clé API refusée » envoyait l'utilisateur chercher une clé qui n'existe pas.
    if (status === 401 && h.provider === "ollama") {
      return {
        message:
          "Ollama n'est pas connecté à un compte Ollama : les modèles « cloud » (nom terminé par « cloud ») l'exigent. Sur la machine où tourne Ollama, lancez « ollama signin » et validez le lien affiché, puis réessayez — ou choisissez un modèle installé localement dans Profil › Génération IA. (Serveur Ollama distant protégé par une clé : vérifiez la clé.)",
        status,
      };
    }
    const byStatus: Record<number, string> = {
      400: `${label} a refusé la demande — le modèle choisi ne gère peut-être pas les réponses structurées, ou le document est trop long pour lui. Essayez un autre modèle dans Profil › Génération IA.${suffix}`,
      401: `Clé API refusée par ${label} — vérifiez-la dans Profil › Génération IA.`,
      402: `Crédit épuisé chez ${label} — rechargez votre compte ou changez de fournisseur.`,
      403: `Accès refusé par ${label} — votre clé n'a pas accès à ce modèle ou à ce service.${suffix}`,
      404: `Modèle introuvable chez ${label} — vérifiez le nom du modèle dans Profil › Génération IA (« Charger la liste »).${suffix}`,
      413: `Document ou offre trop volumineux pour ${label} — réduisez la taille du CV ou choisissez un modèle à plus grand contexte.`,
      429: `Limite atteinte chez ${label} (trop de requêtes ou quota épuisé) — patientez quelques minutes ou vérifiez votre crédit.`,
    };
    return {
      message:
        byStatus[status] ??
        (status >= 500
          ? `${label} est momentanément indisponible (HTTP ${status}) — réessayez dans un instant.`
          : `Erreur de ${label} (HTTP ${status}) — vérifiez votre configuration dans Profil › Génération IA.${suffix}`),
      status,
    };
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
    // Refus d'Anthropic en direct (clé de l'utilisateur) : { error: { type, message } },
    // sans `code`. Le motif est écrit dans le journal du serveur — sans lui, un
    // « HTTP 400 » ne se diagnostiquait pas — et les cas courants sont traduits.
    // Ni clé ni contenu dans ce message : Anthropic n'y décrit que le refus.
    const upstream = (body as { error?: { type?: unknown; message?: unknown } } | undefined)?.error;
    const type = typeof upstream?.type === "string" ? upstream.type : "";
    const detail = typeof upstream?.message === "string" ? upstream.message : "";
    if (type || detail) console.warn(`[llm] anthropic HTTP ${status} ${type} : ${detail.slice(0, 300)}`);
    // Seul cas lu dans le texte : Anthropic signale un solde épuisé par un 400
    // « invalid_request_error » que rien d'autre ne distingue.
    if (type === "billing_error" || /credit balance/i.test(detail)) {
      return {
        message:
          "Crédit épuisé chez Anthropic (Claude) — rechargez votre compte sur platform.claude.com (Billing), ou changez de fournisseur dans Profil › Génération IA.",
        status: 402,
      };
    }
    if (type === "authentication_error") {
      return { message: "Clé API refusée par Anthropic (Claude) — vérifiez-la dans Profil › Génération IA.", status };
    }
    if (type === "permission_error") {
      return { message: "Accès refusé par Anthropic (Claude) — votre clé n'a pas accès à ce modèle.", status };
    }
    if (type === "not_found_error") {
      return {
        message:
          "Modèle introuvable chez Anthropic (Claude) — vérifiez le nom du modèle dans Profil › Génération IA (« Charger la liste »).",
        status,
      };
    }
    if (type === "rate_limit_error") {
      return { message: "Limite de débit atteinte chez Anthropic (Claude) — patientez une minute puis réessayez.", status };
    }
    if (type === "overloaded_error") {
      return { message: "Anthropic (Claude) est momentanément surchargé — réessayez dans un instant.", status };
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

const providerLabel = (p: string | undefined): string =>
  (p && PROVIDERS[p as ProviderId]?.label) || "Le service d'IA";

/**
 * Message d'un échec réseau (lib/ai/llm.ts, LlmTransportError), selon le code
 * de la cause. Avant la 3.4.14, tout échec réseau d'un serveur local donnait
 * « Impossible de joindre… vérifiez que le logiciel est lancé », y compris une
 * génération simplement trop lente ou une connexion coupée par Ollama : le
 * conseil envoyait l'utilisateur vers une fausse piste.
 */
function transportMessage(t: {
  provider?: string;
  url?: string;
  timeout?: boolean;
  code?: string;
  phase?: string;
  timeoutMs?: number;
}): TranslatedAiError {
  const preset = t.provider ? PROVIDERS[t.provider as ProviderId] : undefined;
  const label = providerLabel(t.provider);
  const url = t.url ?? "";
  // Serveur local : fournisseur local (Ollama, LM Studio) ou adresse de la machine même (« Autre »).
  const local = !!preset?.local || /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(url);
  const code = t.code ?? "";

  if (t.timeout && t.phase === "liste") {
    const seconds = Math.round((t.timeoutMs || 15_000) / 1000);
    return {
      message: `${label} n'a pas répondu en ${seconds} secondes à la demande de liste des modèles — le logiciel est peut-être figé, ou un autre programme occupe l'adresse ${url} : redémarrez-le, puis réessayez.`,
      status: 504,
    };
  }
  if (t.timeout) {
    const minutes = Math.round((t.timeoutMs || preset?.timeoutMs || 0) / 60_000);
    return {
      message: local
        ? `${label} n'a pas fini de répondre${minutes ? ` en ${minutes} minutes` : " à temps"} — le modèle est trop lent pour cette machine : choisissez un modèle plus léger dans Profil › Génération IA${t.provider === "ollama" ? " (la commande « ollama ps » indique s'il tourne sur la carte graphique ou sur le processeur)" : ""}.`
        : `${label} n'a pas répondu à temps — relancez la génération ; si cela se reproduit, réessayez plus tard.`,
      status: 504,
    };
  }
  if (!local) {
    // Le réseau fonctionne (l'hôte a répondu par un refus) : serveur arrêté ou adresse fausse.
    if (code === "ECONNREFUSED") {
      return {
        message: `Le serveur à l'adresse ${url} refuse la connexion : il est arrêté, ou l'adresse ou le port est faux — vérifiez-la dans Profil › Génération IA.`,
        status: 502,
      };
    }
    // Nom d'hôte introuvable sur une adresse saisie à la main : faute de frappe plus probable qu'une coupure.
    if (code === "ENOTFOUND" && t.provider === "custom") {
      return { message: `Adresse introuvable : ${url} — vérifiez-la dans Profil › Génération IA.`, status: 502 };
    }
    return {
      message: `Impossible de joindre ${label} — vérifiez votre connexion internet puis réessayez.${code ? ` (code ${code})` : ""}`,
      status: 502,
    };
  }
  if (code === "ECONNREFUSED") {
    const lmStudio = t.provider === "lmstudio" ? ", ou son serveur n'est pas démarré (onglet Developer › Start server)" : "";
    return {
      message: `Rien ne répond à l'adresse ${url} : ${label} n'est pas lancé${lmStudio}, ou son serveur écoute sur une autre adresse ou un autre port${t.provider === "ollama" ? " (variable OLLAMA_HOST)" : ""}. Lancez-le, ou corrigez l'adresse dans Profil › Génération IA.`,
      status: 502,
    };
  }
  if (code === "UND_ERR_SOCKET" || code === "ECONNRESET" || code === "EPIPE") {
    return {
      message: `${label} a coupé la connexion pendant sa réponse (logiciel fermé ou redémarré, mémoire insuffisante pour ce modèle, antivirus) — relancez ; si cela se reproduit, choisissez un modèle plus léger.`,
      status: 502,
    };
  }
  if (code.startsWith("ERR_SSL") || code === "EPROTO") {
    return {
      message: `L'adresse ${url} commence par https://, mais ${label} répond en http:// — remplacez « https » par « http » dans Profil › Génération IA.`,
      status: 502,
    };
  }
  return {
    message: `Impossible de joindre ${label} à l'adresse ${url} — vérifiez que le logiciel est lancé et que le serveur local est démarré.${code ? ` (code ${code})` : ""}`,
    status: 502,
  };
}

/** Erreur FR claire quand la réponse du modèle est tronquée (limite de longueur atteinte). */
export function assertNotTruncated(
  message: { truncated?: boolean; stop_reason?: string | null },
  what: string
): void {
  if (message.truncated || message.stop_reason === "max_tokens") {
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
