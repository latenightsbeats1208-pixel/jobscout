import { beforeEach, describe, expect, it } from "vitest";
import { callStructured, listModels, resetLlmMemory, type LlmDeps } from "@/lib/ai/llm";
import { cfgFor } from "./fixtures";

const TOOL = {
  name: "build_cv",
  description: "CV.",
  input_schema: { type: "object", properties: { sections: { type: "object", properties: { a: { type: "array" } } } } },
};

type Reply = { content: unknown[]; stop_reason: string | null };

/** Faux client : rejoue les réponses (ou erreurs) dans l'ordre, la dernière se répète. */
function fakeAnthropic(...replies: Array<Reply | Error>) {
  const calls: Array<Record<string, unknown>> = [];
  let i = 0;
  const client = {
    messages: {
      create: async (params: Record<string, unknown>) => {
        calls.push(params);
        const r = replies[Math.min(i++, replies.length - 1)];
        if (r instanceof Error) throw r;
        return r;
      },
    },
    models: { list: async () => ({ data: [{ id: "claude-opus-4-8" }, { id: "claude-sonnet-5" }] }) },
  } as unknown as NonNullable<LlmDeps["anthropic"]>;
  return { client, calls };
}

/** Erreur 400 au format du SDK (status + message). */
const http400 = (message: string) => Object.assign(new Error(`400 ${message}`), { status: 400 });

describe("fournisseur Anthropic", () => {
  beforeEach(() => resetLlmMemory());

  it("outil forcé, cache sur les blocs marqués, modèle selon le rôle", async () => {
    const { client, calls } = fakeAnthropic({
      content: [{ type: "tool_use", name: "build_cv", input: { sections: { a: [1] } } }],
      stop_reason: "tool_use",
    });
    const cfg = cfgFor("anthropic");
    const r = await callStructured(
      { role: "writer", system: [{ text: "S1", cache: true }, { text: "S2" }], user: "U", tool: TOOL, maxTokens: 4000 },
      cfg,
      { anthropic: client }
    );
    expect(r.input).toEqual({ sections: { a: [1] } });
    expect(r.truncated).toBe(false);
    const p = calls[0];
    expect(p.model).toBe(cfg.models.writer);
    expect(p.max_tokens).toBe(4000);
    expect(p.tool_choice).toEqual({ type: "tool", name: "build_cv" });
    expect(p.system).toEqual([
      { type: "text", text: "S1", cache_control: { type: "ephemeral" } },
      { type: "text", text: "S2" },
    ]);
    expect(p.messages).toEqual([{ role: "user", content: "U" }]);
  });

  it("répare un sous-objet renvoyé en chaîne JSON (défaut observé avec Opus)", async () => {
    const { client } = fakeAnthropic({
      content: [{ type: "tool_use", name: "build_cv", input: { sections: '{"a":[2]}' } }],
      stop_reason: "tool_use",
    });
    const r = await callStructured({ role: "reviewer", system: "S", user: "U", tool: TOOL, maxTokens: 10 }, cfgFor("anthropic"), { anthropic: client });
    expect(r.input).toEqual({ sections: { a: [2] } });
  });

  it("stop_reason max_tokens → tronqué ; sans tool_use → input null", async () => {
    const t = fakeAnthropic({ content: [{ type: "text", text: "…" }], stop_reason: "max_tokens" });
    const r = await callStructured({ role: "writer", system: "S", user: "U", tool: TOOL, maxTokens: 10 }, cfgFor("anthropic"), { anthropic: t.client });
    expect(r.truncated).toBe(true);
    expect(r.input).toBeNull();
  });

  it("outil forcé refusé (modèles récents) → mode « auto » avec consigne, mémorisé pour les appels suivants", async () => {
    const ok: Reply = { content: [{ type: "tool_use", name: "build_cv", input: { sections: { a: [3] } } }], stop_reason: "tool_use" };
    const { client, calls } = fakeAnthropic(
      http400('{"type":"error","error":{"type":"invalid_request_error","message":"tool_choice forced tool use is not supported for this model"}}'),
      ok
    );
    const req = { role: "writer" as const, system: [{ text: "S1", cache: true }], user: "U", tool: TOOL, maxTokens: 100 };
    const cfg = cfgFor("anthropic", { models: { writer: "claude-sonnet-5-5", reviewer: "claude-haiku-4-5" } });
    const r = await callStructured(req, cfg, { anthropic: client });
    expect(r.input).toEqual({ sections: { a: [3] } });
    expect(calls).toHaveLength(2);
    expect(calls[0].tool_choice).toEqual({ type: "tool", name: "build_cv" });
    expect(calls[1].tool_choice).toEqual({ type: "auto" });
    const sys = calls[1].system as Array<{ text: string; cache_control?: unknown }>;
    expect(sys[0]).toEqual({ type: "text", text: "S1", cache_control: { type: "ephemeral" } });
    expect(sys[sys.length - 1].text).toContain("build_cv");
    // Appel suivant avec le même modèle : directement en « auto ».
    await callStructured(req, cfg, { anthropic: client });
    expect(calls).toHaveLength(3);
    expect(calls[2].tool_choice).toEqual({ type: "auto" });
  });

  it("température : envoyée si demandée ; refusée → nouvel essai sans, mémorisé", async () => {
    const ok = { content: [{ type: "tool_use", name: "build_cv", input: { sections: { a: [] } } }], stop_reason: "tool_use" };
    const { client, calls } = fakeAnthropic(http400("temperature: unsupported for this model"), ok, ok);
    const req = { role: "reviewer" as const, system: "S", user: "U", tool: TOOL, maxTokens: 1000, temperature: 0 };
    const r = await callStructured(req, cfgFor("anthropic"), { anthropic: client });
    expect(r.input).toEqual({ sections: { a: [] } });
    expect(calls[0].temperature).toBe(0);
    expect(calls[1]).not.toHaveProperty("temperature");
    await callStructured(req, cfgFor("anthropic"), { anthropic: client });
    expect(calls).toHaveLength(3);
    expect(calls[2]).not.toHaveProperty("temperature");
  });

  it("sans température demandée, aucune n'est envoyée", async () => {
    const { client, calls } = fakeAnthropic({ content: [{ type: "tool_use", name: "build_cv", input: { sections: { a: [] } } }], stop_reason: "tool_use" });
    await callStructured({ role: "writer", system: "S", user: "U", tool: TOOL, maxTokens: 1000 }, cfgFor("anthropic"), { anthropic: client });
    expect(calls[0]).not.toHaveProperty("temperature");
  });

  it("autre erreur 400 (document trop long) → pas de nouvel essai", async () => {
    const { client, calls } = fakeAnthropic(http400("prompt is too long: 250000 tokens > 200000 maximum"));
    const err = await callStructured({ role: "writer", system: "S", user: "U", tool: TOOL, maxTokens: 10 }, cfgFor("anthropic"), { anthropic: client }).catch((e) => e);
    expect(err.status).toBe(400);
    expect(calls).toHaveLength(1);
  });

  it("mode « auto » : JSON rendu en texte au lieu d'un appel d'outil → récupéré", async () => {
    const { client } = fakeAnthropic(http400("tool_choice not supported"), {
      content: [{ type: "text", text: 'Voici : {"sections":{"a":[4]}}' }],
      stop_reason: "end_turn",
    });
    const r = await callStructured({ role: "writer", system: "S", user: "U", tool: TOOL, maxTokens: 10 }, cfgFor("anthropic"), { anthropic: client });
    expect(r.input).toEqual({ sections: { a: [4] } });
  });

  it("liste des modèles via l'API Anthropic", async () => {
    const { client } = fakeAnthropic({ content: [], stop_reason: null });
    expect(await listModels(cfgFor("anthropic"), { anthropic: client })).toEqual(["claude-opus-4-8", "claude-sonnet-5"]);
  });
});
