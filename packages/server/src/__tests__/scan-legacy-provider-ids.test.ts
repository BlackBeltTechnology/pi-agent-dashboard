/**
 * `scanLegacyProviderIds()` — read-only scan of pi's agent dir for the provider
 * id pi 1.0.3 renamed (`azure-openai-responses` → `azure`).
 *
 * Covers test-plan E13–E17 and X1–X3, plus the route half of E16 (the status
 * route carries ids + location tokens only). Uses real temp agent dirs.
 *
 * See change: update-pi-core-1-1-adopt-apis (design D4).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setAgentDirSource } from "../auth/radius-override.js";
import { scanLegacyProviderIds } from "../auth/scan-legacy-provider-ids.js";
import { registerProviderAuthRoutes } from "../routes/provider-auth-routes.js";

const OLD = "azure-openai-responses";

let dir: string;
const write = (name: string, value: unknown) =>
  fs.writeFileSync(path.join(dir, name), typeof value === "string" ? value : JSON.stringify(value));
const listing = () => fs.readdirSync(dir).sort();

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "legacy-ids-"));
});
afterEach(() => {
  setAgentDirSource(undefined);
  fs.rmSync(dir, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

describe("scanLegacyProviderIds — locations", () => {
  it("E13 reports every matched location in one entry", () => {
    write("auth.json", { [OLD]: { type: "api_key", key: "x" } });
    write("settings.json", {
      defaultProvider: `${OLD}/gpt-5`,
      enabledModels: [`${OLD}/gpt-5`, "openai/gpt-6"],
      modelThinkingLevels: { [`${OLD}/gpt-5`]: "high" },
    });
    write("models.json", { providers: { [OLD]: { models: [] } } });

    expect(scanLegacyProviderIds({ agentDir: dir })).toEqual([
      {
        legacyId: OLD,
        newId: "azure",
        locations: [
          "auth.json",
          "settings.json:defaultProvider",
          "settings.json:enabledModels",
          "settings.json:modelThinkingLevels",
          "models.json:providers",
        ],
      },
    ]);
  });

  it("E13b a bare id (no model suffix) also matches", () => {
    write("settings.json", { defaultProvider: OLD, enabledModels: [OLD], modelThinkingLevels: { [OLD]: "low" } });
    const [entry] = scanLegacyProviderIds({ agentDir: dir });
    expect(entry.locations).toEqual([
      "settings.json:defaultProvider",
      "settings.json:enabledModels",
      "settings.json:modelThinkingLevels",
    ]);
  });

  it("E14 the '/' boundary prevents prefix look-alikes", () => {
    write("settings.json", {
      defaultProvider: "azure",
      enabledModels: [`${OLD}2/gpt-5`],
      modelThinkingLevels: { [`${OLD}2/gpt-5`]: "high" },
    });
    write("auth.json", { [`${OLD}2`]: {} });
    expect(scanLegacyProviderIds({ agentDir: dir })).toEqual([]);
  });

  it("E15 a custom provider using the API type is not reported", () => {
    write("models.json", { providers: { "my-azure": { api: OLD, models: [] } } });
    expect(scanLegacyProviderIds({ agentDir: dir })).toEqual([]);
  });

  it("E16 never serializes a credential or setting value", () => {
    write("auth.json", { [OLD]: { key: "sk-SECRET-123" } });
    write("settings.json", { defaultProvider: `${OLD}/model-SECRET-xyz` });
    const result = scanLegacyProviderIds({ agentDir: dir });
    expect(result).toHaveLength(1);
    const json = JSON.stringify(result);
    expect(json).not.toContain("sk-SECRET-123");
    expect(json).not.toContain("model-SECRET-xyz");
  });

  it("E17 resolves the dir through the runtime getAgentDir (PI_CODING_AGENT_DIR)", () => {
    write("auth.json", { [OLD]: {} });
    vi.stubEnv("PI_CODING_AGENT_DIR", dir);
    // The runtime handle's getAgentDir honours the env var, as pi's does.
    setAgentDirSource(() => process.env.PI_CODING_AGENT_DIR as string);
    expect(scanLegacyProviderIds()).toEqual([
      { legacyId: OLD, newId: "azure", locations: ["auth.json"] },
    ]);
  });

  it("E17b without a runtime handle it still honours PI_CODING_AGENT_DIR", () => {
    write("auth.json", { [OLD]: {} });
    vi.stubEnv("PI_CODING_AGENT_DIR", dir);
    setAgentDirSource(undefined);
    expect(scanLegacyProviderIds()).toHaveLength(1);
  });
});

describe("scanLegacyProviderIds — fault tolerance", () => {
  it("X1 a corrupt file contributes nothing and is neither modified nor quarantined", () => {
    write("auth.json", "{not json");
    write("settings.json", { defaultProvider: OLD });
    const before = listing();
    const bytes = fs.readFileSync(path.join(dir, "auth.json"));

    const result = scanLegacyProviderIds({ agentDir: dir });

    expect(result).toEqual([{ legacyId: OLD, newId: "azure", locations: ["settings.json:defaultProvider"] }]);
    expect(fs.readFileSync(path.join(dir, "auth.json")).equals(bytes)).toBe(true);
    expect(listing()).toEqual(before); // no .corrupt-* copy, no lock file
  });

  it.skipIf(process.platform === "win32")("X2 an unreadable file is skipped; the others are still scanned", () => {
    write("settings.json", { defaultProvider: OLD });
    write("auth.json", { [OLD]: {} });
    fs.chmodSync(path.join(dir, "settings.json"), 0o000);
    try {
      const result = scanLegacyProviderIds({ agentDir: dir });
      // Running as root can still read mode-000 files; only assert the contract.
      expect(result[0].locations).toContain("auth.json");
    } finally {
      fs.chmodSync(path.join(dir, "settings.json"), 0o600);
    }
  });

  it("X3 missing files and a missing dir give an empty list", () => {
    expect(scanLegacyProviderIds({ agentDir: dir })).toEqual([]);
    expect(scanLegacyProviderIds({ agentDir: path.join(dir, "nope") })).toEqual([]);
  });

  it("a non-object field value (wrong shape) does not throw", () => {
    write("settings.json", { defaultProvider: 7, enabledModels: "x", modelThinkingLevels: [1] });
    write("models.json", { providers: [] });
    expect(scanLegacyProviderIds({ agentDir: dir })).toEqual([]);
  });
});

describe("GET /api/provider-auth/legacy-provider-ids", () => {
  it("E16 route: returns ids + location tokens only, never values", async () => {
    write("auth.json", { [OLD]: { key: "sk-SECRET-123" } });
    // Route registration re-inits the registry (rewiring the runtime source), so
    // point the fallback at the temp dir instead.
    vi.stubEnv("PI_CODING_AGENT_DIR", dir);
    const app = Fastify();
    registerProviderAuthRoutes(app, {
      piGateway: { sendToSession: vi.fn(), getConnectedSessionIds: () => [] } as any,
      browserGateway: { broadcastToAll: vi.fn() } as any,
    });
    await app.ready();

    const res = await app.inject({ method: "GET", url: "/api/provider-auth/legacy-provider-ids" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      legacyProviderIds: [{ legacyId: OLD, newId: "azure", locations: ["auth.json"] }],
    });
    expect(res.body).not.toContain("sk-SECRET-123");
    await app.close();
  });

  it("the /status body stays a bare array", async () => {
    vi.stubEnv("PI_CODING_AGENT_DIR", dir);
    const app = Fastify();
    registerProviderAuthRoutes(app, {
      piGateway: { sendToSession: vi.fn(), getConnectedSessionIds: () => [] } as any,
      browserGateway: { broadcastToAll: vi.fn() } as any,
    });
    await app.ready();
    const res = await app.inject({ method: "GET", url: "/api/provider-auth/status" });
    expect(Array.isArray(res.json())).toBe(true);
    await app.close();
  });
});
