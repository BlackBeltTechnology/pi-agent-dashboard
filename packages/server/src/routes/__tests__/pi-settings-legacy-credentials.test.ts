import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { maskSecret } from "../../auth/pi-legacy-credentials.js";
import * as storage from "../../auth/provider-auth-storage.js";
import { registerPiSettingsRoutes } from "../pi-settings-routes.js";

const lockfile = createRequire(import.meta.url)("proper-lockfile") as typeof import("proper-lockfile");

/**
 * Legacy plain-text API keys in settings.json: masked detection, move/remove
 * into auth.json, race handling and the no-leak guarantee. Real tmp agent dir
 * (settings) + the per-file ephemeral HOME (auth.json).
 * See change: pi-settings-full-coverage (test-plan #E9–#E14, #X1–#X5, #X7).
 */
describe("pi-settings legacy credentials", () => {
  let dir: string;
  let file: string;
  let app: FastifyInstance;
  let reloads: number;
  const authDir = path.join(os.homedir(), ".pi", "agent");
  const authPath = path.join(authDir, "auth.json");

  // Distinct 40-char fixtures; the tail is what masking exposes.
  const KEY = (tag: string) => `sk-${tag}-${"x".repeat(28)}${tag.slice(-4).padStart(4, "0")}`;
  const OPENAI = KEY("openai");
  const ANTHROPIC = KEY("ant-api03");

  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), "pi-legacy-"));
    file = path.join(dir, "settings.json");
    mkdirSync(authDir, { recursive: true });
    rmSync(authPath, { force: true });
    reloads = 0;
    app = Fastify();
    registerPiSettingsRoutes(app, {
      networkGuard: async () => {},
      reloadConnectedSessions: () => {
        reloads += 1;
        return 1;
      },
      readDashboardConfig: () => ({}),
      fsDeps: { agentDirEnv: dir },
      scanThemes: async () => ({
        global: { extensions: [], skills: [], prompts: [], themes: [], agents: [] },
        packages: [],
      }),
    });
  });

  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
    rmSync(authPath, { force: true });
  });

  const seed = (t: string | object) => writeFileSync(file, typeof t === "string" ? t : JSON.stringify(t, null, 2));
  const seedAuth = (t: string | object) => writeFileSync(authPath, typeof t === "string" ? t : JSON.stringify(t), { mode: 0o600 });
  const settingsText = () => readFileSync(file, "utf-8");
  const settingsJson = () => JSON.parse(settingsText());
  const authText = () => {
    try {
      return readFileSync(authPath, "utf-8");
    } catch {
      return null;
    }
  };
  const authJson = () => JSON.parse(authText() ?? "{}");
  const get = async () => (await app.inject({ method: "GET", url: "/api/pi-settings" })).json();
  const post = async (actions: unknown, baseEtag?: string) =>
    app.inject({
      method: "POST",
      url: "/api/pi-settings/legacy-credentials",
      payload: { baseEtag: baseEtag ?? (await get()).etag, actions },
    });
  type Legacy = { key: string; provider: string | null; auth: string; masked: string };
  const entry = (b: { legacyCredentials: Legacy[] }, key: string): Legacy | undefined => b.legacyCredentials.find((e) => e.key === key);

  describe("read", () => {
    it("E9 masks by length and ignores empty or non-string values", async () => {
      seed({
        anthropicApiKey: "a".repeat(31),
        openaiApiKey: `${"b".repeat(28)}WXYZ`, // 32
        providers: { zai: { apiKey: `${"c".repeat(60)}1234` }, empty: { apiKey: "" }, num: { apiKey: 123 } },
      });
      const b = await get();
      expect(entry(b, "anthropicApiKey")?.masked).toBe("••••");
      expect(entry(b, "openaiApiKey")?.masked).toBe("…WXYZ");
      expect(entry(b, "providers.zai.apiKey")?.masked).toBe("…1234");
      expect(entry(b, "providers.empty.apiKey")).toBeUndefined();
      expect(entry(b, "providers.num.apiKey")).toBeUndefined();
      expect(maskSecret("a".repeat(31))).toBe("••••");
    });

    it("E9 the masked value contains none of a short key's characters and no entry carries a value", async () => {
      seed({ openaiApiKey: "sk-proj-short-key-1234567" });
      const b = await get();
      expect(entry(b, "openaiApiKey")?.masked).toBe("••••");
      expect(JSON.stringify(b.legacyCredentials)).not.toContain("short-key");
    });

    it("E10 auth state per auth.json content", async () => {
      seed({ openaiApiKey: OPENAI });
      // absent
      expect(entry(await get(), "openaiApiKey")).toMatchObject({ provider: "openai", auth: "none" });
      // same value
      seedAuth({ openai: { type: "api_key", key: OPENAI } });
      expect(entry(await get(), "openaiApiKey")?.auth).toBe("same");
      // different value
      seedAuth({ openai: { type: "api_key", key: KEY("other") } });
      expect(entry(await get(), "openaiApiKey")?.auth).toBe("different");
      // oauth login
      seedAuth({ openai: { type: "oauth", refresh: "r", access: "a", expires: 1 } });
      expect(entry(await get(), "openaiApiKey")?.auth).toBe("different");
      // corrupt file
      seedAuth("{ not json");
      expect(entry(await get(), "openaiApiKey")?.auth).toBe("different");
    });

    it("E10 a credential under the pre-rename id counts as stored", async () => {
      seed({ providers: { "azure-openai-responses": { apiKey: OPENAI } } });
      seedAuth({ "azure-openai-responses": { type: "api_key", key: OPENAI } });
      expect(entry(await get(), "providers.azure-openai-responses.apiKey")).toMatchObject({ provider: "azure", auth: "different" });
    });

    it("E11 provider normalisation; top-level apiKey has none; apiKeys object is not listed", async () => {
      seedAuth({ anthropic: { type: "oauth", refresh: "r", access: "a", expires: 1 } }); // makes `anthropic` an OAuth id
      seed({
        providers: { "azure-openai-responses": { apiKey: OPENAI }, "anthropic-api": { apiKey: ANTHROPIC } },
        apiKey: KEY("top"),
        apiKeys: { openai: KEY("legacy") },
      });
      const b = await get();
      expect(entry(b, "providers.azure-openai-responses.apiKey")?.provider).toBe("azure");
      expect(entry(b, "providers.anthropic-api.apiKey")?.provider).toBe("anthropic");
      expect(entry(b, "apiKey")).toMatchObject({ provider: null, auth: "different" });
      expect(b.legacyCredentials.map((e: { key: string }) => e.key)).not.toContain("apiKeys");
    });
  });

  describe("move", () => {
    it("E12 writes auth.json, deletes the key, prunes empty provider blocks and keeps the rest", async () => {
      seed({ providers: { zai: { apiKey: OPENAI } }, theme: "dark", openaiApiKey: ANTHROPIC });
      const res = await post([{ key: "providers.zai.apiKey", action: "move" }]);
      expect(res.statusCode).toBe(200);
      expect(authJson().zai).toEqual({ type: "api_key", key: OPENAI });
      expect(settingsJson()).toEqual({ theme: "dark", openaiApiKey: ANTHROPIC });
      expect(reloads).toBe(1);
      const body = res.json();
      expect(body.legacyCredentials.map((e: { key: string }) => e.key)).toEqual(["openaiApiKey"]);
    });

    it("E12 moving the only key under providers removes `providers`", async () => {
      seed({ providers: { zai: { apiKey: OPENAI } } });
      await post([{ key: "providers.zai.apiKey", action: "move" }]);
      expect(settingsJson()).toEqual({});
    });

    it("move writes auth.json then deletes (spec scenario)", async () => {
      seed({ openaiApiKey: OPENAI, theme: "dark" });
      const res = await post([{ key: "openaiApiKey", action: "move" }]);
      expect(res.statusCode).toBe(200);
      expect(authJson()).toEqual({ openai: { type: "api_key", key: OPENAI } });
      expect(settingsJson()).toEqual({ theme: "dark" });
      expect(res.json().legacyCredentials).toEqual([]);
    });

    it("E13 refused moves: state same, providerless, missing key, two keys for one provider", async () => {
      seedAuth({ openai: { type: "api_key", key: OPENAI } });
      const cases: unknown[][] = [
        [{ key: "openaiApiKey", action: "move" }], // state same
        [{ key: "apiKey", action: "move" }], // providerless
        [{ key: "nope", action: "move" }], // missing
        [
          { key: "anthropicApiKey", action: "move" },
          { key: "providers.anthropic.apiKey", action: "move" },
        ],
      ];
      for (const actions of cases) {
        seed({ openaiApiKey: OPENAI, apiKey: KEY("top"), anthropicApiKey: ANTHROPIC, providers: { anthropic: { apiKey: ANTHROPIC } } });
        const [s0, a0] = [settingsText(), authText()];
        const res = await post(actions);
        expect(res.statusCode, JSON.stringify(actions)).toBe(400);
        expect(Array.isArray(res.json().legacyCredentials)).toBe(true);
        expect(settingsText()).toBe(s0);
        expect(authText()).toBe(a0);
      }
    });

    it("a credential in auth.json refuses the move", async () => {
      seed({ anthropicApiKey: ANTHROPIC });
      seedAuth({ anthropic: { type: "oauth", refresh: "r", access: "a", expires: 1 } });
      const [s0, a0] = [settingsText(), authText()];
      expect((await post([{ key: "anthropicApiKey", action: "move" }])).statusCode).toBe(400);
      expect([settingsText(), authText()]).toEqual([s0, a0]);
    });
  });

  describe("remove", () => {
    it("E14 only a same-valued key can be removed; other keys survive; auth.json unchanged", async () => {
      // none → 400
      seed({ openaiApiKey: OPENAI });
      expect((await post([{ key: "openaiApiKey", action: "remove" }])).statusCode).toBe(400);
      // different → 400
      seedAuth({ openai: { type: "api_key", key: KEY("other") } });
      expect((await post([{ key: "openaiApiKey", action: "remove" }])).statusCode).toBe(400);
      expect(settingsJson().openaiApiKey).toBe(OPENAI);
      // same → removed
      seed({ anthropicApiKey: ANTHROPIC, theme: "dark" });
      seedAuth({ anthropic: { type: "api_key", key: ANTHROPIC } });
      const a0 = authText();
      const res = await post([{ key: "anthropicApiKey", action: "remove" }]);
      expect(res.statusCode).toBe(200);
      expect(settingsJson()).toEqual({ theme: "dark" });
      expect(authText()).toBe(a0);
    });
  });

  describe("faults", () => {
    it("X1 an auth.json write failure keeps the key in settings.json and leaks nothing", async () => {
      seed({ openaiApiKey: OPENAI });
      vi.spyOn(storage, "writeCredentialIfAbsent").mockRejectedValueOnce(new Error(`EIO writing ${OPENAI}`));
      const res = await post([{ key: "openaiApiKey", action: "move" }]);
      expect(res.statusCode).toBe(500);
      expect(res.body).not.toContain(OPENAI);
      expect(settingsJson().openaiApiKey).toBe(OPENAI);
      expect(authText()).toBeNull();
    });

    it("X2 a credential saved through Providers between plan and write is never overwritten", async () => {
      seed({ openaiApiKey: OPENAI });
      const real = storage.writeCredentialIfAbsent;
      vi.spyOn(storage, "writeCredentialIfAbsent").mockImplementationOnce(async (p, c) => {
        await storage.writeCredential(p, { type: "api_key", key: KEY("providers") });
        return real(p, c);
      });
      const res = await post([{ key: "openaiApiKey", action: "move" }]);
      expect(res.statusCode).toBe(409);
      expect(Array.isArray(res.json().legacyCredentials)).toBe(true);
      expect(authJson().openai.key).toBe(KEY("providers"));
      expect(settingsJson().openaiApiKey).toBe(OPENAI);
    });

    it("X3 a value changed between write and delete stays, and reads as different", async () => {
      seed({ openaiApiKey: OPENAI });
      const real = storage.writeCredentialIfAbsent;
      vi.spyOn(storage, "writeCredentialIfAbsent").mockImplementationOnce(async (p, c) => {
        const r = await real(p, c);
        writeFileSync(file, JSON.stringify({ openaiApiKey: KEY("v2") }));
        return r;
      });
      const res = await post([{ key: "openaiApiKey", action: "move" }]);
      expect(res.statusCode).toBe(409);
      expect(settingsJson().openaiApiKey).toBe(KEY("v2"));
      expect(authJson().openai.key).toBe(OPENAI);
      expect(entry(await get(), "openaiApiKey")?.auth).toBe("different");
    });

    it("X4 a stale token writes nothing", async () => {
      seed({ openaiApiKey: OPENAI });
      const [s0, a0] = [settingsText(), authText()];
      const res = await post([{ key: "openaiApiKey", action: "move" }], "not-the-token");
      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({ success: false, error: "stale" });
      expect([settingsText(), authText()]).toEqual([s0, a0]);
    });

    it("X7 a held settings lock gives 503 and no auth.json write", async () => {
      seed({ openaiApiKey: OPENAI });
      const etag = (await get()).etag;
      const release = await lockfile.lock(file, { realpath: false, stale: 10_000 });
      try {
        const res = await post([{ key: "openaiApiKey", action: "move" }], etag);
        expect(res.statusCode).toBe(503);
      } finally {
        await release();
      }
      expect(authText()).toBeNull();
      expect(settingsJson().openaiApiKey).toBe(OPENAI);
    });

    it("validates the request shape", async () => {
      seed({});
      const etag = (await get()).etag;
      for (const body of [{ actions: [] }, { baseEtag: etag }, { baseEtag: etag, actions: [] }, { baseEtag: etag, actions: [{ key: "x", action: "nuke" }] }]) {
        const res = await app.inject({ method: "POST", url: "/api/pi-settings/legacy-credentials", payload: body });
        expect(res.statusCode).toBe(400);
      }
    });
  });

  it("X5 no key value appears in any response (outside `raw`), error envelope, parseError or log line", async () => {
    const SENTINEL = "sk-ant-LEAKSENTINEL-0123456789abcdefghijklmnop";
    const logs: string[] = [];
    for (const m of ["log", "warn", "error", "info", "debug"] as const) {
      vi.spyOn(console, m).mockImplementation((...a: unknown[]) => void logs.push(a.map(String).join(" ")));
    }
    const bodies: string[] = [];
    const record = (res: { body: string }) => {
      const parsed = JSON.parse(res.body) as Record<string, unknown>;
      delete parsed.raw; // the file as stored (JSON mode) is the documented carve-out
      bodies.push(JSON.stringify(parsed));
      return res;
    };

    seed({ anthropicApiKey: SENTINEL, openaiApiKey: `${SENTINEL}-2`, apiKey: `${SENTINEL}-3` });
    record(await app.inject({ method: "GET", url: "/api/pi-settings" })); // read
    const etag = (await get()).etag;
    record(await post([{ key: "apiKey", action: "move" }], etag)); // 400 providerless
    record(await post([{ key: "anthropicApiKey", action: "move" }], "stale")); // 409 stale
    vi.spyOn(storage, "writeCredentialIfAbsent").mockRejectedValueOnce(new Error(`auth failure ${SENTINEL}`));
    record(await post([{ key: "anthropicApiKey", action: "move" }], etag)); // auth failure
    seedAuth("{ corrupt");
    record(await post([{ key: "anthropicApiKey", action: "move" }], etag)); // corrupt auth.json
    rmSync(authPath, { force: true });
    record(await post([{ key: "anthropicApiKey", action: "move" }], etag)); // move ok
    seed(`{"anthropicApiKey": "${SENTINEL}`); // truncated file holding a key
    record(await app.inject({ method: "GET", url: "/api/pi-settings" }));
    record(await app.inject({ method: "PUT", url: "/api/pi-settings/raw", payload: { raw: `{"k": ${SENTINEL}}`, baseEtag: "x" } }));

    for (const text of [...bodies, ...logs]) expect(text).not.toContain("LEAKSENTINEL");
    expect(bodies.length).toBeGreaterThanOrEqual(8);
  });

  it("X5 control: the check would fail if a value were interpolated", () => {
    // Guards the guard: a response carrying a value must trip the same assertion.
    expect(JSON.stringify({ legacyCredentials: [{ masked: "sk-ant-LEAKSENTINEL-1" }] })).toContain("LEAKSENTINEL");
  });
});
