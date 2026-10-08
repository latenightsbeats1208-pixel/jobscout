import { afterEach, describe, expect, it, vi } from "vitest";
import { translateAiError } from "@/lib/ai/errors";

/** Refus d'Anthropic en direct, au format du SDK : statut, corps { type, error: { type, message } }, en-têtes. */
const anthropicError = (status: number, type: string, message: string) =>
  Object.assign(new Error(`${status} ${message}`), {
    status,
    headers: {},
    error: { type: "error", error: { type, message } },
  });

describe("refus d'Anthropic (clé de l'utilisateur)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("solde épuisé (400 invalid_request_error) → « crédit épuisé », motif journalisé", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const t = translateAiError(
      anthropicError(400, "invalid_request_error", "Your credit balance is too low to access the Anthropic API.")
    )!;
    expect(t.status).toBe(402);
    expect(t.message).toContain("Crédit épuisé chez Anthropic");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("anthropic HTTP 400 invalid_request_error : Your credit balance"));
  });

  it("clé refusée, modèle introuvable, surcharge → message propre à chaque cas", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(translateAiError(anthropicError(401, "authentication_error", "invalid x-api-key"))!.message).toContain("Clé API refusée");
    expect(translateAiError(anthropicError(404, "not_found_error", "model: nope"))!.message).toContain("Modèle introuvable");
    expect(translateAiError(anthropicError(529, "overloaded_error", "Overloaded"))!.message).toContain("surchargé");
  });

  it("autre 400 → message générique avec le statut, motif journalisé", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const t = translateAiError(anthropicError(400, "invalid_request_error", "max_tokens: too large"))!;
    expect(t.status).toBe(400);
    expect(t.message).toContain("HTTP 400");
    expect(warn).toHaveBeenCalledOnce();
  });
});
