/**
 * Tests for `_buildAuthStatus` — server-side pure derivation that merges
 * the bridge-pushed catalogue, auth.json data, and the OAuth registry.
 * See changes: replace-hardcoded-provider-lists,
 * delegate-provider-oauth-to-pi-ai (D1, D4).
 */
import { describe, it, expect } from "vitest";
import {
  _buildAuthStatus,
  oauthIdsFrom,
  type AuthData,
} from "../auth/provider-auth-storage.js";
import type { OAuthRegistryEntry } from "../auth/pi-oauth-types.js";
import type { ProviderInfo } from "@blackbelt-technology/pi-dashboard-shared/types.js";

function makeOAuthEntry(
  id: string,
  name: string,
  flowType: "auth_code" | "device_code" = "auth_code",
): OAuthRegistryEntry {
  return {
    id,
    name,
    flowType,
    auth: {
      name,
      login: async () => ({ type: "oauth", refresh: "", access: "", expires: 0 }),
    },
  };
}

const ANTHROPIC_HANDLER = makeOAuthEntry("anthropic", "Anthropic (Claude Pro/Max)");

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
    const corporateHandler = makeOAuthEntry("corporate-sso", "Corporate SSO");
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
 *
 * `row.source` PRECEDENCE: a stored key wins outright. pi-ai reports
 * `source: "environment"` whenever the env var is also set, so an auth.json
 * row would otherwise be labelled `environment` while carrying a `maskedKey`
 * and Edit/Remove. `stored` is reserved for exactly that row.
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
            // A stored key outranks whatever `source` the catalogue reported.
            const expectedSource = stored
              ? "stored"
              : expected && source != null
                ? source
                : undefined;
            expect(row.source, `source — ${label}`).toBe(expectedSource);
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

  it("E5b — a STORED key outranks a catalogue `source: environment`", () => {
    // pi-ai reports `source: "environment"` whenever the env var is also set.
    // With a key in auth.json the row is auth.json-backed, carries a
    // `maskedKey`, and offers Edit/Remove — labelling it `environment` would
    // contradict the status contract, which reserves `stored` for exactly this.
    const catalogue: ProviderInfo[] = [
      {
        id: "deepseek",
        displayName: "DeepSeek",
        hasOAuth: false,
        configured: true,
        source: "environment",
        envVar: "DEEPSEEK_API_KEY",
      },
    ];
    const auth = { deepseek: { type: "api_key", key: "sk-stored-abcdef123456" } } as any;
    const row = _buildAuthStatus(catalogue, auth, [])[0];

    expect(row.configured).toBe(true);
    expect(row.source).toBe("stored");
    // The evidence that makes `stored` the right label.
    expect(row.maskedKey).toBeDefined();
    expect(row.maskedKey).not.toBe("(ambient)");
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

/**
 * Registry-driven rows — test-plan E23–E27 (change:
 * delegate-provider-oauth-to-pi-ai).
 *
 * D4: a permanent key obtained through an OAuth handshake (OpenRouter issues
 * one, stored as `{type:"oauth", refresh:""}`) has no meaningful expiry, so the
 * row emits `expires: null` and clients apply ONE null-check instead of
 * provider-specific knowledge.
 *
 * D1: an id is an OAuth id when the registry lists it OR auth.json already
 * holds an `{type:"oauth"}` credential under it — so a credential pi wrote for
 * a provider the dashboard has no flow for stays visible and removable, and the
 * `<id>-api` twin rule covers the newly registered ids.
 */
describe("_buildAuthStatus — registry-driven rows (E23–E27)", () => {
  const openrouter = makeOAuthEntry("openrouter", "OpenRouter OAuth");

  it("E23: a permanent-key credential reports `expires: null`, a refreshable one its number", () => {
    const auth: AuthData = {
      openrouter: { type: "oauth", access: "k", refresh: "", expires: 9007199254740991 },
      anthropic: { type: "oauth", access: "a", refresh: "r", expires: 1234 },
    };
    const result = _buildAuthStatus([], auth, [
      openrouter,
      makeOAuthEntry("anthropic", "Anthropic (Claude Pro/Max)"),
    ]);

    const or = result.find((r) => r.id === "openrouter");
    const an = result.find((r) => r.id === "anthropic");
    expect(or?.authenticated).toBe(true);
    expect(or?.expires).toBeNull();
    expect(an?.expires).toBe(1234);
  });

  it("E24: an absent `refresh` key also reports no expiry", () => {
    const auth = {
      openrouter: { type: "oauth", access: "k", expires: 999 } as AuthData[string],
    };
    const result = _buildAuthStatus([], auth, [openrouter]);
    expect(result.find((r) => r.id === "openrouter")?.expires).toBeNull();
  });

  it("E25: a stored api key on an OAuth id surfaces as the `<id>-api` twin", () => {
    for (const id of ["openrouter", "kimi-coding", "meta", "xai"]) {
      const auth: AuthData = { [id]: { type: "api_key", key: "sk" } };
      const catalogue: ProviderInfo[] = [
        { id, displayName: id, hasOAuth: true, configured: false },
      ];
      const result = _buildAuthStatus(catalogue, auth, [makeOAuthEntry(id, id)]);

      const oauthRow = result.find((r) => r.id === id);
      const apiRow = result.find((r) => r.id === `${id}-api`);
      expect(oauthRow?.flowType, id).not.toBe("api_key");
      expect(oauthRow?.authenticated, id).toBe(false);
      expect(apiRow?.authenticated, id).toBe(true);
      expect(apiRow?.name, id).toContain("(API Key)");
    }
  });

  it("E26: a stored OAuth credential with NO registry entry is still an OAuth row", () => {
    const auth: AuthData = {
      "some-future-provider": { type: "oauth", access: "a", refresh: "r", expires: 42 },
    };
    const result = _buildAuthStatus([], auth, []);

    const row = result.find((r) => r.id === "some-future-provider");
    expect(row).toBeDefined();
    expect(row?.authenticated).toBe(true);
    expect(row?.expires).toBe(42);
    // …and the DELETE route's row-kind union sees it too.
    expect(oauthIdsFrom([], auth).has("some-future-provider")).toBe(true);
  });

  it("E27: a catalogue-only custom OAuth provider gets no OAuth row", () => {
    const catalogue: ProviderInfo[] = [
      { id: "custom-llm", displayName: "Custom LLM", hasOAuth: true, configured: false, custom: true },
    ];
    const result = _buildAuthStatus(catalogue, {}, []);
    expect(result.map((r) => r.id)).not.toContain("custom-llm");
  });

  it("does not double-emit a stored OAuth id that IS in the registry", () => {
    const auth: AuthData = {
      openrouter: { type: "oauth", access: "a", refresh: "", expires: 1 },
    };
    const result = _buildAuthStatus([], auth, [openrouter]);
    expect(result.filter((r) => r.id === "openrouter")).toHaveLength(1);
  });
});
