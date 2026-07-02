/**
 * E2E: model-proxy OAuth-incompatible filtering (change filter-oauth-incompatible-models).
 *
 * Automates the two manual smokes (tasks 6.2 / 6.3) + the diagnostics surface.
 *
 * Precondition (seeded by docker/test-entrypoint.sh under PI_E2E_SEED=1):
 *   - auth.json: anthropic OAuth ONLY ({type:"oauth", access:"e2e-fake", ...}) — no api_key.
 *   - config.json#modelProxy: enabled + one apiKey whose hash = sha256(E2E_PROXY_KEY).
 * Bundled pi-ai catalog ships both the current model (`claude-haiku-4-5`) and the
 * legacy snapshot (`claude-3-5-haiku-20241022`), so the exclusion is real, not vacuous.
 *
 * API-level assertions via Playwright's `request` fixture (no page) — the filter
 * never calls upstream, so the fake OAuth token's invalidity is irrelevant.
 */
import { expect, test } from "@playwright/test";

// Fixed proxy key, shared verbatim with docker/test-entrypoint.sh (E2E_PROXY_KEY).
// The harness stores sha256(this) in config.json#modelProxy.apiKeys[].hash.
const PROXY_KEY = "pi-proxy-e2e-oauth-filter-000000000000000000000000000000";
const AUTH = { authorization: `Bearer ${PROXY_KEY}` };

const LEGACY = "anthropic/claude-3-5-haiku-20241022"; // in OAUTH_INCOMPATIBLE
const CURRENT = "anthropic/claude-haiku-4-5"; // current Claude-Code allowlist

test.describe("model-proxy OAuth-incompatible filtering", () => {
  test("6.2 — GET /v1/models excludes legacy snapshot, keeps current model (OAuth-only)", async ({
    request,
  }) => {
    const res = await request.get("/v1/models", { headers: AUTH });
    expect(res.status()).toBe(200);
    const ids: string[] = (await res.json()).data.map((m: { id: string }) => m.id);

    expect(ids).toContain(CURRENT);
    expect(ids).not.toContain(LEGACY);
    // No dated claude-3.x snapshot leaks through under an OAuth-only credential.
    expect(ids.filter((id) => /^anthropic\/claude-3-/.test(id))).toEqual([]);
  });

  test("6.3 — POST /v1/chat/completions with a legacy id returns a clean proxy 404", async ({
    request,
  }) => {
    const res = await request.post("/v1/chat/completions", {
      headers: AUTH,
      data: { model: LEGACY, messages: [{ role: "user", content: "hi" }], stream: false },
    });
    // find() excludes the legacy id → route 404 BEFORE any upstream call.
    expect(res.status()).toBe(404);
  });

  test("diagnostics — /api/model-proxy/diagnostics annotates excludedReason", async ({
    request,
  }) => {
    const res = await request.get("/api/model-proxy/diagnostics");
    expect(res.status()).toBe(200);
    const byId = new Map<string, unknown>(
      (await res.json()).data.map((e: { id: string; excludedReason: unknown }) => [
        e.id,
        e.excludedReason,
      ]),
    );
    // Proves the filter fired (not mere absence): legacy flagged, current included.
    expect(byId.get(LEGACY)).toBe("oauth-incompatible");
    expect(byId.get(CURRENT)).toBeNull();
  });
});
