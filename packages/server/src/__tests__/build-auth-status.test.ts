/**
 * Tests for `_buildAuthStatus` — server-side pure derivation that merges
 * the bridge-pushed catalogue, auth.json data, and the local OAuth handler set.
 * See change: replace-hardcoded-provider-lists.
 */
import { describe, it, expect } from "vitest";
import { _buildAuthStatus, type AuthData } from "../auth/provider-auth-storage.js";
import type { ProviderHandler } from "../auth/provider-auth-handlers.js";
import type { ProviderInfo } from "@blackbelt-technology/pi-dashboard-shared/types.js";

function makeOAuthHandler(providerId: string, displayName: string, flowType: "auth_code" | "device_code" = "auth_code"): ProviderHandler {
  return {
    flowType,
    providerId,
    displayName,
    callbackPort: 0,
    callbackPath: "/cb",
    buildAuthUrl: () => "",
    exchangeCode: async () => ({ type: "oauth", refresh: "", access: "", expires: 0 }),
  } as ProviderHandler;
}

const ANTHROPIC_HANDLER = makeOAuthHandler("anthropic", "Anthropic (Claude Pro/Max)");

describe("_buildAuthStatus", () => {
  it("returns OAuth handler rows with authenticated:false when no catalogue or auth", () => {
    const result = _buildAuthStatus([], {}, [ANTHROPIC_HANDLER]);
    expect(result).toEqual([
      {
        id: "anthropic",
        name: "Anthropic (Claude Pro/Max)",
        flowType: "auth_code",
        authenticated: false,
        configured: false,
      },
    ]);
  });

  it("OAuth row authenticated:true with expires when auth.json has oauth credential", () => {
    const auth: AuthData = {
      anthropic: { type: "oauth", refresh: "r", access: "a", expires: 999 },
    };
    const result = _buildAuthStatus([], auth, [ANTHROPIC_HANDLER]);
    expect(result[0]).toMatchObject({
      id: "anthropic",
      authenticated: true,
      expires: 999,
    });
  });

  it("emits both anthropic (OAuth) and anthropic-api (API key) rows when catalogue has anthropic", () => {
    const catalogue: ProviderInfo[] = [
      { id: "anthropic", displayName: "Anthropic", hasOAuth: true, configured: false },
    ];
    const result = _buildAuthStatus(catalogue, {}, [ANTHROPIC_HANDLER]);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe("anthropic");
    expect(result[0].flowType).toBe("auth_code");
    expect(result[1].id).toBe("anthropic-api");
    expect(result[1].name).toBe("Anthropic (API Key)");
    expect(result[1].flowType).toBe("api_key");
  });

  it("non-collision catalogue ids use bare id and bare display name", () => {
    const catalogue: ProviderInfo[] = [
      { id: "deepseek", displayName: "DeepSeek", hasOAuth: false, configured: false },
    ];
    const result = _buildAuthStatus(catalogue, {}, []);
    expect(result[0]).toEqual({
      id: "deepseek",
      name: "DeepSeek",
      flowType: "api_key",
      authenticated: false,
      configured: false,
    });
  });

  it("masks stored API key (>=12 chars) showing first 5 + ... + last 3", () => {
    const catalogue: ProviderInfo[] = [
      { id: "deepseek", displayName: "DeepSeek", hasOAuth: false, configured: true },
    ];
    const auth: AuthData = { deepseek: { type: "api_key", key: "sk-abcdef123456789" } };
    const result = _buildAuthStatus(catalogue, auth, []);
    expect(result[0].authenticated).toBe(true);
    expect(result[0].maskedKey).toBe("sk-ab...789");
  });

  it("masks short stored API key as ****", () => {
    const catalogue: ProviderInfo[] = [
      { id: "groq", displayName: "Groq", hasOAuth: false, configured: true },
    ];
    const auth: AuthData = { groq: { type: "api_key", key: "short" } };
    const result = _buildAuthStatus(catalogue, auth, []);
    expect(result[0].maskedKey).toBe("****");
  });

  it("ambient catalogue entry forces authenticated:true and maskedKey:'(ambient)' even with no auth.json entry", () => {
    const catalogue: ProviderInfo[] = [
      {
        id: "google-vertex",
        displayName: "Google Vertex AI",
        hasOAuth: false,
        configured: false,
        ambient: true,
      },
    ];
    const result = _buildAuthStatus(catalogue, {}, []);
    expect(result[0]).toMatchObject({
      id: "google-vertex",
      authenticated: true,
      ambient: true,
      maskedKey: "(ambient)",
    });
  });

  it("envVar from catalogue propagates to status row", () => {
    const catalogue: ProviderInfo[] = [
      { id: "openai", displayName: "OpenAI", hasOAuth: false, configured: false, envVar: "OPENAI_API_KEY" },
    ];
    const result = _buildAuthStatus(catalogue, {}, []);
    expect(result[0].envVar).toBe("OPENAI_API_KEY");
    expect(result[0].authenticated).toBe(false);
  });

  it("OAuth credential under anthropic does NOT mark anthropic-api authenticated", () => {
    const catalogue: ProviderInfo[] = [
      { id: "anthropic", displayName: "Anthropic", hasOAuth: true, configured: true },
    ];
    const auth: AuthData = {
      anthropic: { type: "oauth", refresh: "r", access: "a", expires: 999 },
    };
    const result = _buildAuthStatus(catalogue, auth, [ANTHROPIC_HANDLER]);
    const oauthRow = result.find((r) => r.id === "anthropic");
    const apiRow = result.find((r) => r.id === "anthropic-api");
    expect(oauthRow?.authenticated).toBe(true);
    expect(apiRow?.authenticated).toBe(false);
    expect(apiRow?.maskedKey).toBeUndefined();
  });

  it("api_key credential at auth.json[anthropic] marks anthropic-api authenticated", () => {
    const catalogue: ProviderInfo[] = [
      { id: "anthropic", displayName: "Anthropic", hasOAuth: true, configured: true },
    ];
    const auth: AuthData = {
      anthropic: { type: "api_key", key: "sk-anthropic-key-1234" },
    };
    const result = _buildAuthStatus(catalogue, auth, [ANTHROPIC_HANDLER]);
    const oauthRow = result.find((r) => r.id === "anthropic");
    const apiRow = result.find((r) => r.id === "anthropic-api");
    expect(oauthRow?.authenticated).toBe(false);
    expect(apiRow?.authenticated).toBe(true);
    expect(apiRow?.maskedKey).toBe("sk-an...234");
  });

  it("skips API-key rows for catalogue entries marked custom:true", () => {
    const catalogue: ProviderInfo[] = [
      { id: "deepseek", displayName: "DeepSeek", hasOAuth: false, configured: false },
      { id: "proxy", displayName: "proxy", hasOAuth: false, configured: false, custom: true },
      { id: "your-llmproxy", displayName: "your-llmproxy", hasOAuth: false, configured: true, custom: true },
    ];
    const result = _buildAuthStatus(catalogue, {}, []);
    const ids = result.map((r) => r.id);
    expect(ids).toContain("deepseek");
    expect(ids).not.toContain("proxy");
    expect(ids).not.toContain("your-llmproxy");
  });

  it("OAuth row IS still emitted for a custom provider with an OAuth handler", () => {
    // A custom provider whose id matches a registered OAuth handler
    // should still surface its OAuth row — only the API-key row is
    // suppressed for custom providers.
    const corporateHandler = makeOAuthHandler("corporate-sso", "Corporate SSO");
    const catalogue: ProviderInfo[] = [
      { id: "corporate-sso", displayName: "Corporate SSO", hasOAuth: true, configured: false, custom: true },
    ];
    const result = _buildAuthStatus(catalogue, {}, [corporateHandler]);
    const oauthRow = result.find((r) => r.id === "corporate-sso");
    const apiKeyRow = result.find((r) => r.id === "corporate-sso-api");
    expect(oauthRow).toBeDefined();
    expect(oauthRow?.flowType).toBe("auth_code");
    expect(apiKeyRow).toBeUndefined();
  });

  it("preserves OAuth handler order then catalogue order", () => {
    const catalogue: ProviderInfo[] = [
      { id: "deepseek", displayName: "DeepSeek", hasOAuth: false, configured: false },
      { id: "groq", displayName: "Groq", hasOAuth: false, configured: false },
    ];
    const result = _buildAuthStatus(catalogue, {}, [ANTHROPIC_HANDLER]);
    expect(result.map((r) => r.id)).toEqual(["anthropic", "deepseek", "groq"]);
  });
});

/**
 * D1 — kind-aware `configured` derivation (test-plan E1–E6).
 *
 * `configured` is projected per ROW KIND from evidence the row itself owns:
 *   - OAuth row   → auth.json[id] holds an **oauth** credential
 *   - api-key row → `hasStoredKey || ambient ||
 *                    (entry.configured && entry.source != null && entry.source !== "stored")`
 *
 * The `source !== "stored"` exclusion is what closes the phantom twin: a
 * stored credential of ANY kind sets `entry.configured` with `source: "stored"`,
 * so without the exclusion an OAuth credential on a catalogue id emits a
 * keyless `configured:true` api-key row whose Remove destroys that credential.
 * `entry.source == null` is likewise not evidence — the bridge's fallback branch
 * sets `configured` with no source, and treating `undefined !== "stored"` as
 * evidence reopens the clobber against an older pi.
 */
describe("_buildAuthStatus — D1 kind-aware `configured`", () => {
  const ALL_SOURCES: Array<ProviderInfo["source"]> = [
    undefined,
    "stored",
    "runtime",
    "environment",
    "fallback",
    "models_json_key",
    "models_json_command",
  ];

  it("E1 — api-key `configured` follows the decision table across every source × entry.configured × stored key × ambient", () => {
    let cases = 0;
    for (const source of ALL_SOURCES) {
      for (const entryConfigured of [true, false]) {
        for (const stored of [true, false]) {
          for (const ambient of [true, false]) {
            const label = `source=${String(source)} entry.configured=${entryConfigured} stored=${stored} ambient=${ambient}`;
            const catalogue: ProviderInfo[] = [
              {
                id: "p",
                displayName: "P",
                hasOAuth: false,
                configured: entryConfigured,
                ...(source !== undefined ? { source } : {}),
                ...(ambient ? { ambient: true } : {}),
              },
            ];
            const auth: AuthData = stored
              ? { p: { type: "api_key", key: "sk-abcdef123456789" } }
              : {};
            const row = _buildAuthStatus(catalogue, auth, [])[0];
            const expected =
              stored ||
              ambient ||
              (entryConfigured && source != null && source !== "stored");
            expect(row.configured, `configured — ${label}`).toBe(expected);
            expect(row.source, `source — ${label}`).toBe(expected ? source : undefined);
            cases++;
          }
        }
      }
    }
    expect(cases).toBe(56);
  });

  it("E2 — a stored OAuth credential configures the OAuth row; the -api twin stays unconfigured with no maskedKey", () => {
    const catalogue: ProviderInfo[] = [
      { id: "anthropic", displayName: "Anthropic", hasOAuth: true, configured: true, source: "stored" },
    ];
    const auth: AuthData = {
      anthropic: { type: "oauth", refresh: "r", access: "a", expires: 999 },
    };
    const result = _buildAuthStatus(catalogue, auth, [ANTHROPIC_HANDLER]);
    const oauthRow = result.find((r) => r.id === "anthropic")!;
    const apiRow = result.find((r) => r.id === "anthropic-api")!;
    expect(oauthRow.configured).toBe(true);
    expect(oauthRow.source).toBe("stored");
    expect(apiRow.configured).toBe(false);
    expect(apiRow.source).toBeUndefined();
    expect(apiRow.maskedKey).toBeUndefined();
  });

  it("E3 — a stored api_key at the shared key unconfigures the OAuth row and configures the -api twin as stored", () => {
    const catalogue: ProviderInfo[] = [
      { id: "anthropic", displayName: "Anthropic", hasOAuth: true, configured: true, source: "stored" },
    ];
    const auth: AuthData = {
      anthropic: { type: "api_key", key: "sk-anthropic-key-1234" },
    };
    const result = _buildAuthStatus(catalogue, auth, [ANTHROPIC_HANDLER]);
    const oauthRow = result.find((r) => r.id === "anthropic")!;
    const apiRow = result.find((r) => r.id === "anthropic-api")!;
    expect(oauthRow.configured).toBe(false);
    expect(apiRow.configured).toBe(true);
    expect(apiRow.source).toBe("stored");
  });

  it("E4 — an absent `source` is not evidence: `configured:true` alone does not configure an api-key row", () => {
    const catalogue: ProviderInfo[] = [
      { id: "deepseek", displayName: "DeepSeek", hasOAuth: false, configured: true },
    ];
    const row = _buildAuthStatus(catalogue, {}, [])[0];
    expect(row.configured).toBe(false);
    expect(row.source).toBeUndefined();
  });

  it("E5 — an env-var credential on an OAuth id configures the -api twin as environment-sourced", () => {
    const catalogue: ProviderInfo[] = [
      {
        id: "anthropic",
        displayName: "Anthropic",
        hasOAuth: true,
        configured: true,
        source: "environment",
        envVar: "ANTHROPIC_API_KEY",
      },
    ];
    const result = _buildAuthStatus(catalogue, {}, [ANTHROPIC_HANDLER]);
    const apiRow = result.find((r) => r.id === "anthropic-api")!;
    expect(apiRow.configured).toBe(true);
    expect(apiRow.source).toBe("environment");
    expect(apiRow.envVar).toBe("ANTHROPIC_API_KEY");
    // The env key is not independently visible to the OAuth row, which owns
    // only auth.json evidence — so the OAuth row stays unconfigured.
    expect(result.find((r) => r.id === "anthropic")!.configured).toBe(false);
  });

  it("E6 — a stored key beats ambient for maskedKey", () => {
    const catalogue: ProviderInfo[] = [
      {
        id: "google-vertex",
        displayName: "Google Vertex AI",
        hasOAuth: false,
        configured: true,
        ambient: true,
        source: "stored",
      },
    ];
    const auth: AuthData = {
      "google-vertex": { type: "api_key", key: "sk-abcdef123456789" },
    };
    const row = _buildAuthStatus(catalogue, auth, [])[0];
    expect(row.maskedKey).toBe("sk-ab...789");
    expect(row.configured).toBe(true);
  });
});
