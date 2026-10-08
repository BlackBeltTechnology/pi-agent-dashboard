/**
 * Tests for the OAuth-incompatible override table.
 *
 * See change: filter-oauth-incompatible-models, task 1.3.
 */
import { describe, expect, it } from "vitest";
import { isOauthIncompatible, OAUTH_INCOMPATIBLE } from "../oauth-compat.js";

describe("isOauthIncompatible", () => {
  it("returns true for a known OAuth-incompatible id", () => {
    expect(isOauthIncompatible("anthropic", "claude-3-5-haiku-20241022")).toBe(true);
  });

  it("returns false for a known provider with an unknown id", () => {
    expect(isOauthIncompatible("anthropic", "claude-haiku-4-5")).toBe(false);
  });

  it("returns false for an unknown provider", () => {
    expect(isOauthIncompatible("openai", "gpt-4o")).toBe(false);
  });

  it("matches ids case-sensitively", () => {
    expect(isOauthIncompatible("anthropic", "CLAUDE-3-5-HAIKU-20241022")).toBe(false);
  });

  it("flags every legacy Anthropic snapshot in the table", () => {
    for (const id of OAUTH_INCOMPATIBLE.anthropic) {
      expect(isOauthIncompatible("anthropic", id)).toBe(true);
    }
  });

  // E10 (change: update-pi-core-0-85-adopt-apis): the table lists ONLY pre-4.x
  // snapshots. The fable 5.1 HTTP 400 was a client-version (user-agent) header
  // gate, NOT a catalog gate — adding it here would wrongly hide a model that
  // IS reachable on 0.85.1, and the change explicitly forbids it.
  it("E10: contains only pre-4.x snapshots; claude-fable-5-1 is absent", () => {
    expect(OAUTH_INCOMPATIBLE.anthropic.has("claude-fable-5-1")).toBe(false);
    expect(OAUTH_INCOMPATIBLE.anthropic.has("claude-fable-5")).toBe(false);
    for (const id of OAUTH_INCOMPATIBLE.anthropic) {
      expect(id, `${id} must be a pre-4.x claude-3 snapshot`).toMatch(/^claude-3/);
    }
    // No Codex/OpenAI OAuth-incompat entries exist — the Codex channel is
    // routed by provider equality, not by this table.
    expect(OAUTH_INCOMPATIBLE.openai).toBeUndefined();
    expect(OAUTH_INCOMPATIBLE["openai-codex"]).toBeUndefined();
  });
});

/**
 * test-plan #E5 — the OAuth-incompatible filter survives the move onto the
 * model runtime: an OAuth-only credential excludes a flagged model from
 * `/api/models`, and `?annotated=1` names the reason.
 * See change: collapse-model-proxy-onto-modelruntime (D5).
 */
describe("OAuth-incompatible filter over the runtime catalogue (E5)", () => {
  it("E5: flagged model excluded from /api/models; annotated excludedReason is oauth-incompatible", async () => {
    const Fastify = (await import("fastify")).default;
    const { InternalRegistry } = await import("../internal-registry.js");
    const { registerModelsIntrospectionRoute } = await import("../../routes/models-introspection-routes.js");
    const catalogue = {
      getProviders: () => [{ id: "anthropic" }],
      getModels: () => [
        { id: "claude-3-5-haiku-20241022", provider: "anthropic", api: "anthropic-messages" },
        { id: "claude-haiku-4-5", provider: "anthropic", api: "anthropic-messages" },
      ],
    };
    const registry = new InternalRegistry(catalogue, {} as never, {
      readProviders: () => ({}),
      readModels: () => [],
      readAuth: () => ({ anthropic: { type: "oauth", access: "a", refresh: "r", expires: Date.now() + 3_600_000 } }),
    });
    const app = Fastify({ logger: false });
    registerModelsIntrospectionRoute(app, { getRegistry: async () => registry });
    await app.ready();

    const plain = JSON.parse((await app.inject({ method: "GET", url: "/api/models" })).body).data as Array<{ id: string }>;
    const ids = plain.map((m) => m.id);
    expect(ids.some((id) => id.endsWith("claude-haiku-4-5"))).toBe(true);
    expect(ids.some((id) => id.endsWith("claude-3-5-haiku-20241022"))).toBe(false);

    const annotated = JSON.parse((await app.inject({ method: "GET", url: "/api/models?annotated=1" })).body).data as Array<{
      id: string;
      excludedReason: string | null;
    }>;
    const flagged = annotated.find((m) => m.id.endsWith("claude-3-5-haiku-20241022"));
    expect(flagged?.excludedReason).toBe("oauth-incompatible");
    expect(annotated.find((m) => m.id.endsWith("claude-haiku-4-5"))?.excludedReason).toBeNull();
    await app.close();
  });
});
