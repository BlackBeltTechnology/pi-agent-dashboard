import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  setCatalogueForSession,
  _resetForTests as resetCatalogueCache,
} from "../provider-catalogue-cache.js";
import type { ProviderInfo } from "@blackbelt-technology/pi-dashboard-shared/types.js";

// API-key rows are derived from the bridge-pushed catalogue cache.
// See change: replace-hardcoded-provider-lists.
const FIXTURE_CATALOGUE: ProviderInfo[] = [
  { id: "anthropic", displayName: "Anthropic", hasOAuth: true, configured: false },
  { id: "openai", displayName: "OpenAI", hasOAuth: false, configured: false },
  { id: "deepseek", displayName: "DeepSeek", hasOAuth: false, configured: false },
  { id: "groq", displayName: "Groq", hasOAuth: false, configured: false },
  { id: "zai", displayName: "Z.ai", hasOAuth: false, configured: false },
];

describe("provider-auth-storage", () => {
  const authDir = path.join(os.homedir(), ".pi", "agent");
  const authPath = path.join(authDir, "auth.json");
  let originalContent: string | null = null;

  beforeEach(() => {
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
    const { readAuthJson } = await import("../provider-auth-storage.js");
    const result = readAuthJson();
    expect(typeof result).toBe("object");
  });

  it("writeCredential and readAuthJson roundtrip", async () => {
    const { writeCredential, readAuthJson } = await import("../provider-auth-storage.js");
    const cred = { type: "api_key" as const, key: "test-key-123" };
    writeCredential("test-provider", cred);
    const data = readAuthJson();
    expect(data["test-provider"]).toEqual(cred);
    const { removeCredential } = await import("../provider-auth-storage.js");
    removeCredential("test-provider");
  });

  it("removeCredential removes the entry", async () => {
    const { writeCredential, removeCredential, readAuthJson } = await import("../provider-auth-storage.js");
    writeCredential("test-remove", { type: "api_key" as const, key: "x" });
    removeCredential("test-remove");
    const data = readAuthJson();
    expect(data["test-remove"]).toBeUndefined();
  });

  // pi 0.71 removed google-gemini-cli + google-antigravity as built-in
  // providers; the dashboard dropped their handlers. See change:
  // adopt-pi-071-072-073-features.
  it("getAuthStatus includes the 3 OAuth handlers", async () => {
    const { getAuthStatus } = await import("../provider-auth-storage.js");
    const statuses = getAuthStatus();
    const oauthIds = statuses.filter((s) => s.flowType !== "api_key").map((s) => s.id);
    expect(oauthIds).toContain("anthropic");
    expect(oauthIds).toContain("openai-codex");
    expect(oauthIds).toContain("github-copilot");
    expect(oauthIds).not.toContain("google-gemini-cli");
    expect(oauthIds).not.toContain("google-antigravity");
    // Exact set (registry order): no extra/dropped handlers.
    expect(oauthIds).toEqual(["anthropic", "openai-codex", "github-copilot"]);
  });

  it("getAuthStatus includes zai from the bridge-pushed catalogue with flowType api_key", async () => {
    const { getAuthStatus } = await import("../provider-auth-storage.js");
    const statuses = getAuthStatus();
    const zai = statuses.find((s) => s.id === "zai");
    expect(zai).toBeDefined();
    expect(zai!.name).toBe("Z.ai");
    expect(zai!.flowType).toBe("api_key");
  });

  it("OAuth/api-key collision uses '<id>-api' suffix for API-key row", async () => {
    const { getAuthStatus } = await import("../provider-auth-storage.js");
    const statuses = getAuthStatus();
    expect(statuses.find((s) => s.id === "anthropic" && s.flowType === "auth_code")).toBeDefined();
    expect(statuses.find((s) => s.id === "anthropic-api" && s.flowType === "api_key")).toBeDefined();
  });

  it("masking shows first 5 + ... + last 3 for keys >= 12 chars", async () => {
    const { writeCredential, getAuthStatus, removeCredential } = await import("../provider-auth-storage.js");
    writeCredential("openai", { type: "api_key", key: "sk-abc123xyz789" });
    try {
      const statuses = getAuthStatus();
      const openai = statuses.find((s) => s.id === "openai");
      expect(openai!.maskedKey).toBe("sk-ab...789");
    } finally {
      removeCredential("openai");
    }
  });

  it("masking returns **** for keys < 12 chars", async () => {
    const { writeCredential, getAuthStatus, removeCredential } = await import("../provider-auth-storage.js");
    writeCredential("openai", { type: "api_key", key: "shortkey" });
    try {
      const statuses = getAuthStatus();
      const openai = statuses.find((s) => s.id === "openai");
      expect(openai!.maskedKey).toBe("****");
    } finally {
      removeCredential("openai");
    }
  });

  it("empty key string results in authenticated false with no maskedKey", async () => {
    const { writeCredential, getAuthStatus, removeCredential } = await import("../provider-auth-storage.js");
    writeCredential("openai", { type: "api_key", key: "" });
    try {
      const statuses = getAuthStatus();
      const openai = statuses.find((s) => s.id === "openai");
      expect(openai!.authenticated).toBe(false);
      expect(openai!.maskedKey).toBeUndefined();
    } finally {
      removeCredential("openai");
    }
  });

  it("empty catalogue + no OAuth credentials → only OAuth handler rows present", async () => {
    resetCatalogueCache();
    const { getAuthStatus } = await import("../provider-auth-storage.js");
    const statuses = getAuthStatus();
    expect(statuses.filter((s) => s.flowType === "api_key")).toHaveLength(0);
    expect(statuses.filter((s) => s.flowType !== "api_key")).toHaveLength(3);
  });

  it("resolveAuthJsonKey strips '-api' suffix for OAuth-collision ids", async () => {
    const { resolveAuthJsonKey } = await import("../provider-auth-storage.js");
    expect(resolveAuthJsonKey("anthropic-api")).toBe("anthropic");
    expect(resolveAuthJsonKey("anthropic")).toBe("anthropic");
    expect(resolveAuthJsonKey("openai")).toBe("openai");
    expect(resolveAuthJsonKey("unknown-api")).toBe("unknown-api"); // bare passthrough; "unknown" not in OAuth set
  });
});
