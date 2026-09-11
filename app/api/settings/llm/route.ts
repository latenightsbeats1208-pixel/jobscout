import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getSetting, setSetting } from "@/lib/db";
import {
  LLM_SETTING_KEYS,
  anthropicBaseUrl,
  getLlmConfig,
  getLlmState,
  proxyBaseUrl,
  resetClaude,
} from "@/lib/ai/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Configuration de la génération IA (DESIGN.md §6.2).
 *
 * GET  : état courant (mode, configuré, hints masqués) + quota du pack si
 *        joignable (timeout 4 s, échec totalement silencieux — motif
 *        lib/update/check.ts : l'app doit rester utilisable hors-ligne).
 * POST : { action: "save" | "verify" | "reset" } — les clés ne sont JAMAIS
 *        renvoyées en clair (hint = 4 derniers symboles).
 */

type Quota = {
  status: string | null;
  plan: string | null;
  points_remaining: number | null;
  dossiers_estimes: number | null;
  rate_limit: { limit: number; used_1h: number } | null;
};

const QUOTA_TIMEOUT_MS = 4000;

function parseQuota(data: unknown): Quota {
  const d = (data ?? {}) as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const str = (v: unknown) => (typeof v === "string" ? v : null);
  const rl = (d.rate_limit ?? null) as { limit?: unknown; used_1h?: unknown } | null;
  return {
    status: str(d.status),
    plan: str(d.plan),
    points_remaining: num(d.points_remaining),
    dossiers_estimes: num(d.dossiers_estimes),
    rate_limit:
      rl && typeof rl.limit === "number" && typeof rl.used_1h === "number"
        ? { limit: rl.limit, used_1h: rl.used_1h }
        : null,
  };
}

/** GET /v1/quota du proxy. Renvoie { ok, status, quota } — jamais d'exception. */
async function fetchQuota(
  licenseKey: string,
  { timeoutMs = QUOTA_TIMEOUT_MS }: { timeoutMs?: number } = {}
): Promise<{ ok: boolean; status: number; quota: Quota | null; code: string | null }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${proxyBaseUrl()}/v1/quota`, {
      signal: controller.signal,
      cache: "no-store",
      headers: { "x-api-key": licenseKey, accept: "application/json" },
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      const code = (body as { error?: { code?: unknown } } | null)?.error?.code;
      return {
        ok: false,
        status: res.status,
        quota: null,
        code: typeof code === "string" ? code : null,
      };
    }
    return { ok: true, status: res.status, quota: parseQuota(body), code: null };
  } catch {
    // Hors-ligne, proxy pas encore déployé, DNS absent : silence total.
    return { ok: false, status: 0, quota: null, code: null };
  } finally {
    clearTimeout(timer);
  }
}

export async function GET() {
  const state = getLlmState();
  let quota: Quota | null = null;
  // Quota UNIQUEMENT si le mode pack est configuré : le mode non configuré ne
  // doit produire AUCUN appel réseau (recette d'installation).
  if (state.mode === "pack" && state.configured) {
    const cfg = getLlmConfig();
    if (cfg.apiKey) {
      const res = await fetchQuota(cfg.apiKey);
      quota = res.ok ? res.quota : null;
    }
  }
  return NextResponse.json({ ...state, quota });
}

const clean = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
};

/** Clé fournie par le formulaire, sinon clé déjà enregistrée (champ laissé vide). */
function resolveKey(provided: string | null, settingKey: string): string | null {
  if (provided) return provided;
  return clean(getSetting(settingKey));
}

async function verifyPack(licenseKey: string): Promise<NextResponse> {
  const res = await fetchQuota(licenseKey, { timeoutMs: 6000 });
  if (res.ok) {
    return NextResponse.json({ ok: true, mode: "pack", quota: res.quota });
  }
  if (res.status === 0) {
    return NextResponse.json(
      { error: "Impossible de joindre le serveur JobScout — vérifiez votre connexion internet puis réessayez." },
      { status: 502 }
    );
  }
  const messages: Record<string, string> = {
    LICENSE_INVALID: "Clé de licence invalide ou inconnue — vérifiez la saisie.",
    LICENSE_SUSPENDED: "Licence suspendue — contactez le support JobScout.",
    QUOTA_EXHAUSTED: "Licence valide mais pack épuisé — rechargez ou passez sur votre clé API.",
    RATE_LIMITED: "Trop de requêtes — patientez quelques minutes puis réessayez.",
  };
  const fallback =
    res.status === 401
      ? messages.LICENSE_INVALID
      : `Vérification impossible (HTTP ${res.status}) — réessayez plus tard.`;
  return NextResponse.json(
    { error: (res.code && messages[res.code]) || fallback },
    { status: res.status >= 400 ? res.status : 502 }
  );
}

async function verifyByok(apiKey: string): Promise<NextResponse> {
  try {
    const client = new Anthropic({
      apiKey,
      baseURL: anthropicBaseUrl(),
      // Voir lib/ai/client.ts : sans authToken: null, une ANTHROPIC_AUTH_TOKEN
      // héritée de l'environnement partirait en Authorization: Bearer — et
      // Anthropic pourrait refuser la clé personnelle pourtant valide, ce que
      // le message d'erreur ci-dessous imputerait à tort à la saisie.
      authToken: null,
      maxRetries: 0,
      timeout: 10_000,
    });
    // models.list : appel gratuit, valide la clé sans consommer de tokens.
    await client.models.list();
    return NextResponse.json({ ok: true, mode: "byok" });
  } catch (e) {
    if (e instanceof Anthropic.APIError) {
      const msg =
        e.status === 401
          ? "Clé API Anthropic refusée — vérifiez la saisie (elle commence par sk-ant-)."
          : `Vérification impossible (HTTP ${e.status ?? "?"}) — réessayez plus tard.`;
      return NextResponse.json({ error: msg }, { status: e.status ?? 502 });
    }
    return NextResponse.json(
      { error: "Impossible de joindre l'API Anthropic — vérifiez votre connexion internet." },
      { status: 502 }
    );
  }
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body.action !== "string") {
    return NextResponse.json({ error: "Requête invalide." }, { status: 400 });
  }
  const action = body.action;
  const mode = clean(body.mode);
  const licenseKey = resolveKey(clean(body.license_key), LLM_SETTING_KEYS.licenseKey);
  const byokKey = resolveKey(clean(body.byok_key), LLM_SETTING_KEYS.byokKey);

  if (action === "reset") {
    setSetting(LLM_SETTING_KEYS.mode, "");
    setSetting(LLM_SETTING_KEYS.licenseKey, "");
    setSetting(LLM_SETTING_KEYS.byokKey, "");
    resetClaude(); // best-effort — l'empreinte relue à chaque appel fait le vrai travail
    return NextResponse.json({ ok: true, ...getLlmState(), quota: null });
  }

  if (mode !== "pack" && mode !== "byok") {
    return NextResponse.json({ error: "Choisissez un mode : Pack JobScout ou clé API." }, { status: 400 });
  }

  if (action === "verify") {
    if (mode === "pack") {
      if (!licenseKey)
        return NextResponse.json({ error: "Saisissez votre clé de licence JobScout." }, { status: 400 });
      return verifyPack(licenseKey);
    }
    if (!byokKey)
      return NextResponse.json({ error: "Saisissez votre clé API Anthropic." }, { status: 400 });
    return verifyByok(byokKey);
  }

  if (action === "save") {
    if (mode === "pack") {
      if (!licenseKey)
        return NextResponse.json({ error: "Saisissez votre clé de licence JobScout." }, { status: 400 });
      setSetting(LLM_SETTING_KEYS.mode, "pack");
      setSetting(LLM_SETTING_KEYS.licenseKey, licenseKey);
    } else {
      if (!byokKey)
        return NextResponse.json({ error: "Saisissez votre clé API Anthropic." }, { status: 400 });
      setSetting(LLM_SETTING_KEYS.mode, "byok");
      setSetting(LLM_SETTING_KEYS.byokKey, byokKey);
    }
    resetClaude(); // best-effort — l'empreinte relue à chaque appel fait le vrai travail
    return NextResponse.json({ ok: true, ...getLlmState(), quota: null });
  }

  return NextResponse.json({ error: "Action inconnue." }, { status: 400 });
}
