import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ProviderInfo } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { oauthRegistryReady, setOAuthRegistryRuntimeSource } from "../auth/provider-auth-registry.js";
import { DashboardCredentialStore } from "../auth/dashboard-credential-store.js";
import { getServerModelRuntime } from "../model-proxy/server-model-runtime.js";
import { createRealRuntime, registerCapturingProvider } from "./helpers/pi-models-fixture.js";
import {
  _resetForTests as resetCatalogueCache,
  setCatalogueForSession,
} from "../package/provider-catalogue-cache.js";

/**
 * The OAuth rows now come from the pi runtime's provider registry, so the
 * expectations are the RUNTIME's eight bundled OAuth providers (minus the
 * excluded `radius`) — not a dashboard-maintained list.
 * See change: delegate-provider-oauth-to-pi-ai (D1), update-pi-core-1-0-adopt-apis
 * (pi 1.0.0 adds `openai`).
 */
const REGISTRY_OAUTH_IDS = [
  "anthropic",
  "github-copilot",
  "kimi-coding",
  "meta",
  "openai",
  "openai-codex",
  "openrouter",
  "xai",
];

// API-key rows are derived from the bridge-pushed catalogue cache.
// See change: replace-hardcoded-provider-lists.
const FIXTURE_CATALOGUE: ProviderInfo[] = [
  { id: "anthropic", displayName: "Anthropic", hasOAuth: true, configured: false },
  // pi 1.0.0: `openai` also has an OAuth login (ChatGPT), so its API-key row
  // is the `openai-api` twin. See change: update-pi-core-1-0-adopt-apis.
  { id: "openai", displayName: "OpenAI", hasOAuth: true, configured: false },
  { id: "deepseek", displayName: "DeepSeek", hasOAuth: false, configured: false },
  { id: "groq", displayName: "Groq", hasOAuth: false, configured: false },
  { id: "zai", displayName: "Z.ai", hasOAuth: false, configured: false },
];

describe("provider-auth-storage", () => {
  const authDir = path.join(os.homedir(), ".pi", "agent");
  const authPath = path.join(authDir, "auth.json");
  let originalContent: string | null = null;

  beforeEach(async () => {
    // The registry reads the server's single runtime, wired at boot by server.ts.
    // See change: collapse-model-proxy-onto-modelruntime (D6).
    setOAuthRegistryRuntimeSource(getServerModelRuntime);
    await oauthRegistryReady();
    try {
      originalContent = fs.readFileSync(authPath, "utf-8");
    } catch {
      originalContent = null;
    }
    setCatalogueForSession("test-session", FIXTURE_CATALOGUE);
  });

  afterEach(() => {
    if (originalContent !== null) {
      fs.writeFileSync(authPath, originalContent);
    }
    resetCatalogueCache();
  });

  it("readAuthJson returns empty object when file does not exist", async () => {
    const { readAuthJson } = await import("../auth/provider-auth-storage.js");
    const result = readAuthJson();
    expect(typeof result).toBe("object");
  });

  it("writeCredential and readAuthJson roundtrip", async () => {
    const { writeCredential, readAuthJson } = await import("../auth/provider-auth-storage.js");
    const cred = { type: "api_key" as const, key: "test-key-123" };
    await writeCredential("test-provider", cred);
    const data = readAuthJson();
    expect(data["test-provider"]).toEqual(cred);
    const { removeCredential } = await import("../auth/provider-auth-storage.js");
    await removeCredential("test-provider");
  });

  it("removeCredential removes the entry", async () => {
    const { writeCredential, removeCredential, readAuthJson } = await import("../auth/provider-auth-storage.js");
    await writeCredential("test-remove", { type: "api_key" as const, key: "x" });
    await removeCredential("test-remove");
    const data = readAuthJson();
    expect(data["test-remove"]).toBeUndefined();
  });

  // pi removed google-gemini-cli + google-antigravity as built-in providers.
  // See change: adopt-pi-071-072-073-features. The SET is now whatever the
  // resolved pi runtime bundles (change: delegate-provider-oauth-to-pi-ai).
  it("getAuthStatus includes every OAuth provider the runtime bundles", async () => {
    const { getAuthStatus } = await import("../auth/provider-auth-storage.js");
    const statuses = getAuthStatus();
    const oauthIds = statuses.filter((s) => s.flowType !== "api_key").map((s) => s.id);
    expect([...oauthIds].sort()).toEqual([...REGISTRY_OAUTH_IDS]);
    expect(oauthIds).not.toContain("radius");
    expect(oauthIds).not.toContain("google-gemini-cli");
    expect(oauthIds).not.toContain("google-antigravity");
  });

  it("getAuthStatus includes zai from the bridge-pushed catalogue with flowType api_key", async () => {
    const { getAuthStatus } = await import("../auth/provider-auth-storage.js");
    const statuses = getAuthStatus();
    const zai = statuses.find((s) => s.id === "zai");
    expect(zai).toBeDefined();
    expect(zai!.name).toBe("Z.ai");
    expect(zai!.flowType).toBe("api_key");
  });

  it("OAuth/api-key collision uses '<id>-api' suffix for API-key row", async () => {
    const { getAuthStatus } = await import("../auth/provider-auth-storage.js");
    const statuses = getAuthStatus();
    expect(statuses.find((s) => s.id === "anthropic" && s.flowType === "auth_code")).toBeDefined();
    expect(statuses.find((s) => s.id === "anthropic-api" && s.flowType === "api_key")).toBeDefined();
  });

  it("masking shows first 5 + ... + last 3 for keys >= 12 chars", async () => {
    const { writeCredential, getAuthStatus, removeCredential } = await import("../auth/provider-auth-storage.js");
    await writeCredential("openai", { type: "api_key", key: "sk-abc123xyz789" });
    try {
      const statuses = getAuthStatus();
      const openai = statuses.find((s) => s.id === "openai-api");
      expect(openai!.maskedKey).toBe("sk-ab...789");
    } finally {
      await removeCredential("openai");
    }
  });

  it("masking returns **** for keys < 12 chars", async () => {
    const { writeCredential, getAuthStatus, removeCredential } = await import("../auth/provider-auth-storage.js");
    await writeCredential("openai", { type: "api_key", key: "shortkey" });
    try {
      const statuses = getAuthStatus();
      const openai = statuses.find((s) => s.id === "openai-api");
      expect(openai!.maskedKey).toBe("****");
    } finally {
      await removeCredential("openai");
    }
  });

  it("empty key string results in authenticated false with no maskedKey", async () => {
    const { writeCredential, getAuthStatus, removeCredential } = await import("../auth/provider-auth-storage.js");
    await writeCredential("openai", { type: "api_key", key: "" });
    try {
      const statuses = getAuthStatus();
      const openai = statuses.find((s) => s.id === "openai-api");
      expect(openai!.authenticated).toBe(false);
      expect(openai!.maskedKey).toBeUndefined();
    } finally {
      await removeCredential("openai");
    }
  });

  it("empty catalogue + no OAuth credentials → only OAuth handler rows present", async () => {
    resetCatalogueCache();
    const { getAuthStatus } = await import("../auth/provider-auth-storage.js");
    const statuses = getAuthStatus();
    expect(statuses.filter((s) => s.flowType === "api_key")).toHaveLength(0);
    expect(statuses.filter((s) => s.flowType !== "api_key")).toHaveLength(
      REGISTRY_OAUTH_IDS.length,
    );
  });

  it("resolveAuthJsonKey strips '-api' suffix for OAuth-collision ids", async () => {
    const { resolveAuthJsonKey } = await import("../auth/provider-auth-storage.js");
    expect(resolveAuthJsonKey("anthropic-api")).toBe("anthropic");
    expect(resolveAuthJsonKey("anthropic")).toBe("anthropic");
    expect(resolveAuthJsonKey("openai")).toBe("openai");
    expect(resolveAuthJsonKey("openai-api")).toBe("openai"); // 1.0.0 OAuth twin
    expect(resolveAuthJsonKey("unknown-api")).toBe("unknown-api"); // bare passthrough; "unknown" not in OAuth set
  });
});

/**
 * The model runtime's credential store over auth.json (test-plan #E11, #X11).
 * See change: collapse-model-proxy-onto-modelruntime (D1).
 */
describe("DashboardCredentialStore over auth.json", () => {
  const authDir = path.join(os.homedir(), ".pi", "agent");
  const authPath = path.join(authDir, "auth.json");

  beforeEach(() => {
    fs.mkdirSync(authDir, { recursive: true });
    fs.rmSync(authPath, { force: true });
  });

  afterEach(() => {
    delete process.env.E11_ACME_KEY;
  });

  it("E11: read returns a stored api_key credential and the upstream request carries it, not the env key", async () => {
    fs.writeFileSync(authPath, JSON.stringify({ acme: { type: "api_key", key: "sk-stored" } }), { mode: 0o600 });
    process.env.E11_ACME_KEY = "sk-env";

    const store = new DashboardCredentialStore();
    await expect(store.read("acme")).resolves.toEqual({ type: "api_key", key: "sk-stored" });

    const runtime = await createRealRuntime();
    // The configured key names an env var; the STORED credential owns the provider.
    const captured = registerCapturingProvider(runtime, "acme", { apiKey: "E11_ACME_KEY" });
    const model = runtime.getModels("acme")[0];
    for await (const _event of runtime.streamSimple(model, { messages: [{ role: "user", content: "hi", timestamp: 0 }] })) {
      // drain
    }
    expect(captured).toHaveLength(1);
    expect(captured[0].options.apiKey).toBe("sk-stored");
  });

  it("X11: delete never creates an absent auth.json", async () => {
    const store = new DashboardCredentialStore();
    await store.delete("anthropic");
    expect(fs.existsSync(authPath)).toBe(false);
  });

  it("X11: delete removes the stored credential and keeps the others", async () => {
    fs.writeFileSync(
      authPath,
      JSON.stringify({ anthropic: { type: "api_key", key: "a" }, openai: { type: "api_key", key: "o" } }),
      { mode: 0o600 },
    );
    const store = new DashboardCredentialStore();
    await store.delete("anthropic");
    expect(JSON.parse(fs.readFileSync(authPath, "utf-8"))).toEqual({ openai: { type: "api_key", key: "o" } });
  });
});
