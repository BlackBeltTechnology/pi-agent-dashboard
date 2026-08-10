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
