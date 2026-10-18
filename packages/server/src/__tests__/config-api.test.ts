import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadConfig, resolveTrustMode } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  computeBindReachability,
  formatBindReachabilityWarning,
  initBindReachability,
  resetBindReachability,
  safeComputeBindReachability,
  sameReachability,
} from "../auth/bind-reachability-service.js";
import { deleteAuthProvider, readConfigRedacted, writeConfigPartial } from "../config-api.js";
import { registerSystemRoutes } from "../routes/system-routes.js";

describe("config-api", () => {
  let testDir: string;
  let configFile: string;
  let origHome: string;

  beforeEach(() => {
    testDir = path.join(os.tmpdir(), `test-config-api-${Date.now()}`);
    fs.mkdirSync(path.join(testDir, ".pi", "dashboard"), { recursive: true });
    configFile = path.join(testDir, ".pi", "dashboard", "config.json");
    origHome = process.env.HOME!;
    process.env.HOME = testDir;
  });

  afterEach(() => {
    process.env.HOME = origHome;
    if (fs.existsSync(testDir)) fs.rmSync(testDir, { recursive: true });
  });

  describe("readConfigRedacted", () => {
    it("should redact auth.secret and provider clientSecrets", () => {
      fs.writeFileSync(configFile, JSON.stringify({
        port: 8000,
        auth: {
          secret: "real-secret",
          providers: {
            github: { clientId: "id1", clientSecret: "real-client-secret" },
          },
        },
      }));
      const config = readConfigRedacted();
      expect(config.auth!.secret).toBe("***");
      expect(config.auth!.providers.github.clientSecret).toBe("***");
      expect(config.auth!.providers.github.clientId).toBe("id1");
    });

    it("should return config without auth when not configured", () => {
      fs.writeFileSync(configFile, JSON.stringify({ port: 3000 }));
      const config = readConfigRedacted();
      expect(config.auth).toBeUndefined();
      expect(config.port).toBe(3000);
    });
  });

  describe("writeConfigPartial", () => {
    it("should merge partial config and write to disk", () => {
      fs.writeFileSync(configFile, JSON.stringify({ port: 8000, autoShutdown: true }));
      const result = writeConfigPartial({ autoShutdown: false });
      expect(result.success).toBe(true);
      expect(result.restartRequired).toBe(false);
      const written = JSON.parse(fs.readFileSync(configFile, "utf-8"));
      expect(written.autoShutdown).toBe(false);
      expect(written.port).toBe(8000); // preserved
    });

    it("should flag restartRequired when port changes", () => {
      fs.writeFileSync(configFile, JSON.stringify({ port: 8000 }));
      const result = writeConfigPartial({ port: 9000 });
      expect(result.success).toBe(true);
      expect(result.restartRequired).toBe(true);
    });

    it("should flag restartRequired when piPort changes", () => {
      fs.writeFileSync(configFile, JSON.stringify({ piPort: 9999 }));
      const result = writeConfigPartial({ piPort: 8888 });
      expect(result.restartRequired).toBe(true);
    });

    it("should flag restartRequired when bindHost changes", () => {
      fs.writeFileSync(configFile, JSON.stringify({ bindHost: "127.0.0.1" }));
      const result = writeConfigPartial({ bindHost: "0.0.0.0" });
      expect(result.success).toBe(true);
      expect(result.restartRequired).toBe(true);
    });

    it("should not flag restartRequired for non-port changes", () => {
      fs.writeFileSync(configFile, JSON.stringify({ port: 8000, autoShutdown: true }));
      const result = writeConfigPartial({ autoShutdown: false, shutdownIdleSeconds: 60 });
      expect(result.restartRequired).toBe(false);
    });

    it("should preserve redacted auth.secret", () => {
      fs.writeFileSync(configFile, JSON.stringify({
        auth: { secret: "real-secret", providers: { github: { clientId: "id", clientSecret: "real-cs" } } },
      }));
      const result = writeConfigPartial({
        auth: { secret: "***", providers: { github: { clientId: "new-id", clientSecret: "***" } } },
      });
      expect(result.success).toBe(true);
      const written = JSON.parse(fs.readFileSync(configFile, "utf-8"));
      expect(written.auth.secret).toBe("real-secret");
      expect(written.auth.providers.github.clientSecret).toBe("real-cs");
      expect(written.auth.providers.github.clientId).toBe("new-id");
    });

    it("should update allowedUsers", () => {
      fs.writeFileSync(configFile, JSON.stringify({ auth: { providers: { github: { clientId: "x", clientSecret: "y" } } } }));
      const result = writeConfigPartial({ auth: { allowedUsers: ["octocat", "*@company.com"] } });
      expect(result.success).toBe(true);
      const written = JSON.parse(fs.readFileSync(configFile, "utf-8"));
      expect(written.auth.allowedUsers).toEqual(["octocat", "*@company.com"]);
      // providers preserved
      expect(written.auth.providers.github.clientId).toBe("x");
    });

    // ── fix-trusted-networks-no-oauth regression tests ─────────────────
    // These assert that auth.bypassHosts and auth.bypassUrls are persisted
    // through PUT /api/config. Before the fix, the auth-merge block only
    // copied secret / providers / allowedUsers, silently dropping bypass*
    // on every save.

    it("should persist auth.bypassHosts with no pre-existing auth (task 1.5)", () => {
      fs.writeFileSync(configFile, JSON.stringify({ port: 8000 }));
      const result = writeConfigPartial({
        auth: { providers: {}, bypassHosts: ["192.168.1.0/24"] },
      });
      expect(result.success).toBe(true);
      const written = JSON.parse(fs.readFileSync(configFile, "utf-8"));
      expect(written.auth.bypassHosts).toEqual(["192.168.1.0/24"]);
    });

    it("should persist auth.bypassHosts alongside existing providers (task 1.6)", () => {
      fs.writeFileSync(configFile, JSON.stringify({
        auth: {
          secret: "s",
          providers: { github: { clientId: "abc", clientSecret: "xyz" } },
        },
      }));
      const result = writeConfigPartial({
        auth: { bypassHosts: ["10.0.0.0/8"] },
      });
      expect(result.success).toBe(true);
      const written = JSON.parse(fs.readFileSync(configFile, "utf-8"));
      expect(written.auth.providers.github.clientId).toBe("abc");
      expect(written.auth.providers.github.clientSecret).toBe("xyz");
      expect(written.auth.bypassHosts).toEqual(["10.0.0.0/8"]);
    });

    it("should clear auth.bypassHosts via empty array (task 1.7)", () => {
      fs.writeFileSync(configFile, JSON.stringify({
        auth: { providers: {}, bypassHosts: ["192.168.1.0/24"] },
      }));
      const result = writeConfigPartial({
        auth: { bypassHosts: [] },
      });
      expect(result.success).toBe(true);
      const written = JSON.parse(fs.readFileSync(configFile, "utf-8"));
      expect(written.auth.bypassHosts).toEqual([]);
    });

    it("should preserve existing auth.bypassHosts when partial omits the key (task 1.8)", () => {
      fs.writeFileSync(configFile, JSON.stringify({
        auth: { providers: {}, bypassHosts: ["192.168.1.0/24"] },
      }));
      const result = writeConfigPartial({
        auth: { allowedUsers: ["alice"] },
      });
      expect(result.success).toBe(true);
      const written = JSON.parse(fs.readFileSync(configFile, "utf-8"));
      expect(written.auth.bypassHosts).toEqual(["192.168.1.0/24"]);
      expect(written.auth.allowedUsers).toEqual(["alice"]);
    });

    it("should persist auth.bypassUrls symmetrically (task 1.9)", () => {
      fs.writeFileSync(configFile, JSON.stringify({ port: 8000 }));
      const result = writeConfigPartial({
        auth: { providers: {}, bypassUrls: ["/webhooks/", "/metrics"] },
      });
      expect(result.success).toBe(true);
      const written = JSON.parse(fs.readFileSync(configFile, "utf-8"));
      expect(written.auth.bypassUrls).toEqual(["/webhooks/", "/metrics"]);
    });

    it("should persist reattachPlacement (change: reattach-move-to-front)", () => {
      fs.writeFileSync(configFile, JSON.stringify({ port: 8000 }));
      const result = writeConfigPartial({ reattachPlacement: "preserve" });
      expect(result.success).toBe(true);
      const written = JSON.parse(fs.readFileSync(configFile, "utf-8"));
      expect(written.reattachPlacement).toBe("preserve");
      expect(written.port).toBe(8000); // existing fields preserved
    });

    // ── Heap sub-block merge (change: bound-session-heap-and-gc-telemetry) ──
    // Same deep-merge contract as `memoryLimits`: without it, saving one field
    // of a sub-block silently drops its siblings.
    it("deep-merges sessionHeap so a sibling field is not dropped (test-plan #E9)", () => {
      fs.writeFileSync(
        configFile,
        JSON.stringify({ port: 8000, sessionHeap: { maxOldSpaceMb: 512, initialOldSpaceMb: 64 } }),
      );
      const result = writeConfigPartial({ sessionHeap: { maxOldSpaceMb: 256 } } as any);
      expect(result.success).toBe(true);
      const written = JSON.parse(fs.readFileSync(configFile, "utf-8"));
      expect(written.sessionHeap).toEqual({ maxOldSpaceMb: 256, initialOldSpaceMb: 64 });
    });

    it("deep-merges serverHeap and flags the generic restart (it now applies on /api/restart)", () => {
      fs.writeFileSync(configFile, JSON.stringify({ port: 8000, serverHeap: { maxOldSpaceMb: 1536 } }));
      const result = writeConfigPartial({ serverHeap: { maxOldSpaceMb: 2048 } } as any);
      expect(result.success).toBe(true);
      // `/api/restart` re-reads and re-stamps the ceiling, so the in-place
      // restart IS sufficient and no stronger cold-start signal exists.
      // See change: guard-server-heap-and-store-coupling (D5).
      expect(result.restartRequired).toBe(true);
      expect(result).not.toHaveProperty("coldStartRequired");
      expect(JSON.parse(fs.readFileSync(configFile, "utf-8")).serverHeap.maxOldSpaceMb).toBe(2048);
    });

    it("sessionHeap needs neither indicator — it applies on the next spawn", () => {
      fs.writeFileSync(configFile, JSON.stringify({ port: 8000 }));
      const result = writeConfigPartial({ sessionHeap: { maxOldSpaceMb: 256 } } as any);
      expect(result.restartRequired).toBe(false);
      expect(result).not.toHaveProperty("coldStartRequired");
    });

    it("a partial write omitting sessionHeap preserves the persisted block (test-plan #E8)", () => {
      fs.writeFileSync(
        configFile,
        JSON.stringify({ port: 8000, sessionHeap: { maxOldSpaceMb: 256, maxSemiSpaceMb: 8 } }),
      );
      expect(writeConfigPartial({ autoShutdown: false }).success).toBe(true);
      const written = JSON.parse(fs.readFileSync(configFile, "utf-8"));
      expect(written.sessionHeap).toEqual({ maxOldSpaceMb: 256, maxSemiSpaceMb: 8 });
      expect(loadConfig().sessionHeap).toEqual({ maxOldSpaceMb: 256, maxSemiSpaceMb: 8 });
    });
  });
  // ── Provider deletion (D9) ───────────────────────────────────────────────
  // `writeConfigPartial`'s providers merge is spread-only and cannot express a
  // removal, and `readConfigRedacted()` would persist "***" over every
  // surviving secret. Deletion therefore gets its own raw read/write helper.
  // See change: config-override-oauth-redirect-base.
  describe("deleteAuthProvider", () => {
    const twoProviders = {
      port: 8000,
      auth: {
        secret: "real-secret",
        providers: {
          github: { clientId: "gh", clientSecret: "gh-real-secret" },
          google: { clientId: "goo", clientSecret: "goo-real-secret" },
        },
      },
    };

    // #G8
    it("removes exactly the named provider", () => {
      fs.writeFileSync(configFile, JSON.stringify(twoProviders));
      const result = deleteAuthProvider("github");
      expect(result).toMatchObject({ success: true, deleted: true, remaining: 1 });
      const written = JSON.parse(fs.readFileSync(configFile, "utf-8"));
      expect(Object.keys(written.auth.providers)).toEqual(["google"]);
    });

    // #G9 — the whole reason this is not built on readConfigRedacted().
    it("leaves the surviving provider's REAL clientSecret on disk", () => {
      fs.writeFileSync(configFile, JSON.stringify(twoProviders));
      deleteAuthProvider("github");
      const written = JSON.parse(fs.readFileSync(configFile, "utf-8"));
      expect(written.auth.providers.google.clientSecret).toBe("goo-real-secret");
      expect(written.auth.secret).toBe("real-secret");
    });

    // #G10 — idempotent: absent provider is a success with no side effect.
    it("is a no-op success for an absent provider", () => {
      fs.writeFileSync(configFile, JSON.stringify(twoProviders));
      const before = fs.readFileSync(configFile, "utf-8");
      const result = deleteAuthProvider("keycloak");
      expect(result).toMatchObject({ success: true, deleted: false, remaining: 2 });
      expect(fs.readFileSync(configFile, "utf-8")).toBe(before);
    });

    // #G11 — deleting the last provider is a LOCKOUT (auth stays enforced with
    // no login path), not a disable. Refused without an explicit force.
    it("refuses to delete the last provider without force", () => {
      fs.writeFileSync(configFile, JSON.stringify({
        auth: { providers: { github: { clientId: "gh", clientSecret: "s" } } },
      }));
      const result = deleteAuthProvider("github");
      expect(result.success).toBe(false);
      expect(result.reason).toBe("last-provider");
      const written = JSON.parse(fs.readFileSync(configFile, "utf-8"));
      expect(Object.keys(written.auth.providers)).toEqual(["github"]);
    });

    it("deletes the last provider when forced", () => {
      fs.writeFileSync(configFile, JSON.stringify({
        auth: { providers: { github: { clientId: "gh", clientSecret: "s" } } },
      }));
      const result = deleteAuthProvider("github", { force: true });
      expect(result).toMatchObject({ success: true, deleted: true, remaining: 0 });
      const written = JSON.parse(fs.readFileSync(configFile, "utf-8"));
      expect(written.auth.providers).toEqual({});
    });

    it("preserves unrelated top-level config", () => {
      fs.writeFileSync(configFile, JSON.stringify({ ...twoProviders, defaultModel: "gpt-4" }));
      deleteAuthProvider("github");
      const written = JSON.parse(fs.readFileSync(configFile, "utf-8"));
      expect(written.defaultModel).toBe("gpt-4");
      expect(written.port).toBe(8000);
    });

    it("is a success no-op when no auth block exists at all", () => {
      fs.writeFileSync(configFile, JSON.stringify({ port: 8000 }));
      expect(deleteAuthProvider("github")).toMatchObject({ success: true, deleted: false, remaining: 0 });
    });
  });

  // ── Gateway action persistence (D12) ─────────────────────────────────────
  // The action is ONE `PUT /api/config` carrying every key plus the provenance
  // record, so a half-configured gateway is not representable. These pin the
  // write side of that contract. Rows: G14, G15, S8.
  // See change: config-override-oauth-redirect-base.
  describe("gateway action writes", () => {
    const GATEWAY = "https://pi.example.com";
    const addPatch = {
      publicBaseUrls: [GATEWAY],
      cors: { allowedOrigins: [GATEWAY] },
      auth: { redirectBaseUrl: GATEWAY },
      trustedNetworks: ["10.4.0.9/32"],
      gateways: [
        {
          url: GATEWAY,
          authModes: ["oauth", "trusted-network"],
          wrote: {
            publicBaseUrls: [GATEWAY],
            corsAllowedOrigins: [GATEWAY],
            authRedirectBaseUrl: GATEWAY,
            trustedNetworks: ["10.4.0.9/32"],
          },
        },
      ],
    };

    // #G14
    it("persists every recorded key in a single write", () => {
      fs.writeFileSync(configFile, JSON.stringify({ port: 8000 }));
      expect(writeConfigPartial({ ...addPatch }).success).toBe(true);
      const written = JSON.parse(fs.readFileSync(configFile, "utf-8"));
      expect(written.publicBaseUrls).toEqual([GATEWAY]);
      expect(written.cors.allowedOrigins).toEqual([GATEWAY]);
      expect(written.auth.redirectBaseUrl).toBe(GATEWAY);
      expect(written.trustedNetworks).toEqual(["10.4.0.9/32"]);
      expect(written.gateways).toHaveLength(1);
      expect(written.gateways[0].wrote.authRedirectBaseUrl).toBe(GATEWAY);
    });

    // #G15 — the legacy nested key is left in place; the seeded top-level list
    // is what every surface reads from now on.
    it("keeps the legacy pairing entries reachable through the seeded list", () => {
      fs.writeFileSync(
        configFile,
        JSON.stringify({ pairing: { publicBaseUrls: ["https://old.example"] } }),
      );
      writeConfigPartial({ publicBaseUrls: ["https://old.example", GATEWAY] });
      const written = JSON.parse(fs.readFileSync(configFile, "utf-8"));
      expect(written.publicBaseUrls).toEqual(["https://old.example", GATEWAY]);
      expect(written.pairing.publicBaseUrls).toEqual(["https://old.example"]);
    });

    // #S8 — a failed write leaves NO provenance record. The record rides the
    // same object as the values, so there is no ordering in which one lands
    // without the other.
    it("records no gateway when the write throws", () => {
      fs.writeFileSync(configFile, JSON.stringify({ port: 8000 }));
      const before = fs.readFileSync(configFile, "utf-8");
      const spy = vi.spyOn(fs, "writeFileSync").mockImplementation(() => {
        throw new Error("disk full");
      });
      const result = writeConfigPartial({ ...addPatch });
      spy.mockRestore();
      expect(result.success).toBe(false);
      expect(fs.readFileSync(configFile, "utf-8")).toBe(before);
      expect(JSON.parse(fs.readFileSync(configFile, "utf-8")).gateways).toBeUndefined();
    });
  });
});

// ── reachability: computed, never persisted, never unguarded ───────────
// See change: warn-unreachable-trusted-networks.
describe("reachability surface", () => {
  let testDir: string;
  let configFile: string;
  let origHome: string;

  beforeEach(() => {
    testDir = path.join(os.tmpdir(), `test-reachability-${Date.now()}`);
    fs.mkdirSync(path.join(testDir, ".pi", "dashboard"), { recursive: true });
    configFile = path.join(testDir, ".pi", "dashboard", "config.json");
    origHome = process.env.HOME!;
    process.env.HOME = testDir;
    resetBindReachability();
  });

  afterEach(() => {
    process.env.HOME = origHome;
    resetBindReachability();
    if (fs.existsSync(testDir)) fs.rmSync(testDir, { recursive: true });
  });

  it("#E30 strips an echoed `reachability` object from the written config", () => {
    fs.writeFileSync(configFile, JSON.stringify({ port: 8000, bindHost: "127.0.0.1" }));
    const result = writeConfigPartial({
      bindHost: "0.0.0.0",
      reachability: {
        resolvedBindHost: "127.0.0.1",
        pendingBindHost: "127.0.0.1",
        unreachable: ["192.168.1.0/24"],
      },
    });
    expect(result.success).toBe(true);
    const written = JSON.parse(fs.readFileSync(configFile, "utf-8"));
    expect(written.bindHost).toBe("0.0.0.0");
    expect("reachability" in written).toBe(false);
  });

  it("#X1 degrades `reachability` to null instead of throwing", () => {
    fs.writeFileSync(configFile, JSON.stringify({ port: 8123, bindHost: "127.0.0.1" }));
    // `safeComputeBindReachability` is the PRODUCTION isolation the route calls;
    // deleting its try/catch fails this test. (An earlier version of this test
    // wrapped the call in its own try/catch and therefore proved nothing.)
    expect(safeComputeBindReachability(() => { throw new Error("boom"); })).toBeNull();

    // …and the rest of the config is unaffected by that degradation.
    const payload = { ...readConfigRedacted(), reachability: null };
    expect(payload.port).toBe(8123);
    expect(payload.reachability).toBeNull();
  });

  it("#X2 computes the topology facts only for the guarded surface", () => {
    fs.writeFileSync(configFile, JSON.stringify({
      port: 8000,
      bindHost: "127.0.0.1",
      auth: { bypassHosts: ["192.168.1.0/24"] },
    }));
    initBindReachability({ resolvedBindHost: "127.0.0.1", hostFlag: null });
    const r = computeBindReachability(loadConfig);
    expect(r.unreachable).toEqual(["192.168.1.0/24"]);
    expect(r.resolvedBindHost).toBe("127.0.0.1");
    // The unguarded `/api/health` counterpart is pinned in health-endpoint.test.ts.
  });
});

// ── The startup warning names the link that actually decides ───────────
// See change: warn-unreachable-trusted-networks.
describe("formatBindReachabilityWarning", () => {
  const base = { resolvedBindHost: "127.0.0.1", pendingBindHost: "127.0.0.1", unreachable: ["192.168.1.0/24"] };

  it("is silent when every trusted entry is reachable", () => {
    expect(formatBindReachabilityWarning({ ...base, unreachable: [], bindHostSource: "config" })).toBeNull();
  });

  it("suggests config.bindHost when the config is the deciding link", () => {
    const line = formatBindReachabilityWarning({ ...base, bindHostSource: "config" });
    expect(line).toContain("[bind-reachability]");
    expect(line).toContain("127.0.0.1");
    expect(line).toContain("192.168.1.0/24");
    expect(line).toContain("bindHost");
  });

  it("suggests the FLAG when --host shadows the config", () => {
    const line = formatBindReachabilityWarning({ ...base, bindHostSource: "flag" });
    expect(line).toContain("--host 0.0.0.0");
    // Must not tell the user to edit a setting the flag overrides.
    expect(line).not.toContain("Settings → Server");
  });

  it("suggests the ENV VAR when PI_DASHBOARD_HOST shadows the config", () => {
    const line = formatBindReachabilityWarning({ ...base, bindHostSource: "env" });
    expect(line).toContain("PI_DASHBOARD_HOST=0.0.0.0");
    expect(line).not.toContain("Settings → Server");
  });
});

// ── Regression: the broadcast gate must watch the WHOLE published fact ─
// Gating the `reachability_updated` push on `pendingBindHost` alone meant a
// write that edited only the trusted entries sent nothing, leaving every other
// connected browser on a stale advisory until it reloaded — contradicting the
// protocol docstring and the server-bind-host spec's no-polling requirement.
// Found by CodeRabbit on PR #483. See change: warn-unreachable-trusted-networks.
describe("sameReachability (broadcast gate)", () => {
  const base = {
    resolvedBindHost: "127.0.0.1",
    pendingBindHost: "127.0.0.1",
    unreachable: ["192.168.1.0/24"],
    bindHostSource: "config" as const,
  };

  it("is true for an identical fact — no needless broadcast", () => {
    expect(sameReachability(base, { ...base, unreachable: [...base.unreachable] })).toBe(true);
  });

  it("is FALSE when only the unreachable set changed (the bind host standing still)", () => {
    expect(sameReachability(base, { ...base, unreachable: ["192.168.1.0/24", "10.0.0.0/8"] })).toBe(false);
    expect(sameReachability(base, { ...base, unreachable: [] })).toBe(false);
    expect(sameReachability(base, { ...base, unreachable: ["10.0.0.0/8"] })).toBe(false);
  });

  it("is false when the bind host, the resolved host, or the deciding link changed", () => {
    expect(sameReachability(base, { ...base, pendingBindHost: "0.0.0.0" })).toBe(false);
    expect(sameReachability(base, { ...base, resolvedBindHost: "0.0.0.0" })).toBe(false);
    expect(sameReachability(base, { ...base, bindHostSource: "env" })).toBe(false);
  });
});

describe("writeConfigPartial — openspec readiness keys (add-openspec-init-affordances)", () => {
  let testDir: string;
  let configFile: string;
  let origHome: string;

  beforeEach(() => {
    testDir = path.join(os.tmpdir(), `test-config-api-osx-${Date.now()}`);
    fs.mkdirSync(path.join(testDir, ".pi", "dashboard"), { recursive: true });
    configFile = path.join(testDir, ".pi", "dashboard", "config.json");
    origHome = process.env.HOME!;
    process.env.HOME = testDir;
  });

  afterEach(() => {
    process.env.HOME = origHome;
    if (fs.existsSync(testDir)) fs.rmSync(testDir, { recursive: true });
  });

  it("E23: a targeted optOutDirectories write preserves every other config key", () => {
    fs.writeFileSync(configFile, JSON.stringify({
      port: 8000,
      autoShutdown: false,
      openspec: { pollIntervalSeconds: 45, maxConcurrentSpawns: 4, changeDetection: "always" },
    }));
    const result = writeConfigPartial({ openspec: { optOutDirectories: ["/only/this"], offerInitialization: false } });
    expect(result.success).toBe(true);
    const cfg = loadConfig();
    // Unrelated top-level keys preserved.
    expect(cfg.port).toBe(8000);
    expect(cfg.autoShutdown).toBe(false);
    // Sibling openspec poll keys preserved (deep merge, not replace).
    expect(cfg.openspec.pollIntervalSeconds).toBe(45);
    expect(cfg.openspec.maxConcurrentSpawns).toBe(4);
    expect(cfg.openspec.changeDetection).toBe("always");
    // The written keys landed.
    expect(cfg.openspec.optOutDirectories).toEqual(["/only/this"]);
    expect(cfg.openspec.offerInitialization).toBe(false);
  });

  it("kroki block survives save round-trip without field loss (test-plan #E10)", () => {
    fs.writeFileSync(configFile, JSON.stringify({
      port: 8000,
      kroki: { url: "http://localhost:8100", allowRemote: true },
    }));
    const result = writeConfigPartial({ autoShutdown: false });
    expect(result.success).toBe(true);
    const cfg = loadConfig();
    expect(cfg.kroki.url).toBe("http://localhost:8100");
    expect(cfg.kroki.allowRemote).toBe(true);
    expect(cfg.autoShutdown).toBe(false);
  });

  // test-plan #E25: the opt-out is writable through the config endpoint's
  // writer and survives a later Settings save, which sends only the CHANGED
  // sessionList keys. See change: archive-service-sessions-on-end.
  it("E25: archiveServiceSessionsOnEnd=false persists and survives a partial sessionList save", () => {
    fs.writeFileSync(configFile, JSON.stringify({ port: 8000 }));
    expect(writeConfigPartial({ sessionList: { archiveServiceSessionsOnEnd: false } }).success).toBe(true);
    expect(loadConfig().sessionList.archiveServiceSessionsOnEnd).toBe(false);

    expect(writeConfigPartial({ sessionList: { archiveAfterDays: 14 } }).success).toBe(true);
    const cfg = loadConfig();
    expect(cfg.sessionList.archiveAfterDays).toBe(14);
    expect(cfg.sessionList.archiveServiceSessionsOnEnd).toBe(false);
  });
});

// ── retire-trusted-networks-bypass: `network` block merge + origin stamping ──
// The origin is server-owned: any change to a stored `trustMode` stamps
// `operator` (the boot decision passes `upgrade`); an unchanged mode keeps the
// stored origin whatever the caller sent. See change: retire-trusted-networks-bypass (D2).
describe("config-api network trust mode", () => {
  let testDir: string;
  let configFile: string;
  let origHome: string | undefined;
  const raw = () => JSON.parse(fs.readFileSync(configFile, "utf-8"));

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-config-api-network-"));
    fs.mkdirSync(path.join(testDir, ".pi", "dashboard"), { recursive: true });
    configFile = path.join(testDir, ".pi", "dashboard", "config.json");
    origHome = process.env.HOME;
    process.env.HOME = testDir;
  });

  afterEach(() => {
    if (origHome === undefined) delete process.env.HOME;
    else process.env.HOME = origHome;
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  // E6
  it("#E6 stored legacy/upgrade → PUT pair stamps operator; the same mode again leaves it; a hand edit without origin reads operator", () => {
    fs.writeFileSync(configFile, JSON.stringify({ port: 8000, network: { trustMode: "legacy", trustModeOrigin: "upgrade" } }));
    expect(resolveTrustMode(loadConfig())).toEqual({ mode: "legacy", origin: "upgrade", unrecognised: null });

    expect(writeConfigPartial({ network: { trustMode: "pair" } }).success).toBe(true);
    expect(raw().network).toEqual({ trustMode: "pair", trustModeOrigin: "operator" });
    expect(resolveTrustMode(loadConfig())).toEqual({ mode: "pair", origin: "operator", unrecognised: null });

    // Same mode again: origin unchanged (even if the caller sends one).
    fs.writeFileSync(configFile, JSON.stringify({ network: { trustMode: "pair", trustModeOrigin: "upgrade" } }));
    expect(writeConfigPartial({ network: { trustMode: "pair", trustModeOrigin: "operator" } }).success).toBe(true);
    expect(raw().network).toEqual({ trustMode: "pair", trustModeOrigin: "upgrade" });

    // Hand edit with no origin at all reads as an operator decision.
    fs.writeFileSync(configFile, JSON.stringify({ network: { trustMode: "legacy" } }));
    expect(resolveTrustMode(loadConfig())).toEqual({ mode: "legacy", origin: "operator", unrecognised: null });
  });

  it("#E6 a caller cannot forge the origin on a mode change; the boot decision may stamp upgrade", () => {
    fs.writeFileSync(configFile, JSON.stringify({ port: 8000 }));
    expect(writeConfigPartial({ network: { trustMode: "legacy", trustModeOrigin: "upgrade" } }).success).toBe(true);
    expect(raw().network).toEqual({ trustMode: "legacy", trustModeOrigin: "operator" });

    fs.writeFileSync(configFile, JSON.stringify({ port: 8000 }));
    expect(writeConfigPartial({ network: { trustMode: "legacy" } }, { trustModeOrigin: "upgrade" }).success).toBe(true);
    expect(raw().network).toEqual({ trustMode: "legacy", trustModeOrigin: "upgrade" });
  });

  it("#E6 an unchanged mode with no stored origin does not invent one", () => {
    fs.writeFileSync(configFile, JSON.stringify({ network: { trustMode: "pair" } }));
    expect(writeConfigPartial({ network: { trustMode: "pair", trustModeOrigin: "upgrade" } }).success).toBe(true);
    expect(raw().network).toEqual({ trustMode: "pair" });
  });

  // E7
  it("#E7 partial {network:{trustMode}} keeps auth.bypassHosts; partial {auth:{bypassHosts}} keeps network incl. origin", () => {
    fs.writeFileSync(configFile, JSON.stringify({
      port: 8000,
      network: { trustMode: "legacy", trustModeOrigin: "upgrade" },
      auth: { secret: "real-secret", providers: {}, bypassHosts: ["10.0.0.0/8"] },
    }));

    expect(writeConfigPartial({ network: { trustMode: "pair" } }).success).toBe(true);
    expect(raw().auth.bypassHosts).toEqual(["10.0.0.0/8"]);
    expect(raw().auth.secret).toBe("real-secret");
    expect(raw().network).toEqual({ trustMode: "pair", trustModeOrigin: "operator" });

    expect(writeConfigPartial({ auth: { bypassHosts: ["192.168.16.0/24"] } }).success).toBe(true);
    expect(raw().auth.bypassHosts).toEqual(["192.168.16.0/24"]);
    expect(raw().network).toEqual({ trustMode: "pair", trustModeOrigin: "operator" });
  });

  it("#E7 a partial that carries only the origin cannot change it, and an unrelated key leaves the block untouched", () => {
    fs.writeFileSync(configFile, JSON.stringify({ network: { trustMode: "legacy", trustModeOrigin: "upgrade" } }));
    expect(writeConfigPartial({ network: { trustModeOrigin: "operator" } }).success).toBe(true);
    expect(raw().network).toEqual({ trustMode: "legacy", trustModeOrigin: "upgrade" });
    expect(writeConfigPartial({ autoShutdown: false }).success).toBe(true);
    expect(raw().network).toEqual({ trustMode: "legacy", trustModeOrigin: "upgrade" });
  });

  it("#E7 an unrecognised stored mode survives an unrelated save untouched (never silently dropped)", () => {
    fs.writeFileSync(configFile, JSON.stringify({ network: { trustMode: "open" } }));
    expect(writeConfigPartial({ autoShutdown: false }).success).toBe(true);
    expect(raw().network).toEqual({ trustMode: "open" });
  });

  it("#E7 readConfigRedacted returns the network block (GET round trip)", () => {
    fs.writeFileSync(configFile, JSON.stringify({ network: { trustMode: "pair", trustModeOrigin: "upgrade" } }));
    expect(readConfigRedacted().network).toEqual({ trustMode: "pair", trustModeOrigin: "upgrade" });
  });

  describe("routes", () => {
    const makeApp = (): FastifyInstance => {
      const app = Fastify();
      (app as any)._reloadAuth = async () => {};
      registerSystemRoutes(app, {
        sessionManager: {} as never,
        preferencesStore: { flush: () => {} } as never,
        metaPersistence: { flushAll: () => {} } as never,
        config: { port: 8000, piPort: 9999, dev: false } as never,
        networkGuard: (async () => {}) as never,
      } as never);
      return app;
    };

    it("#E7 GET → PUT round trip keeps `network` and its origin", async () => {
      fs.writeFileSync(configFile, JSON.stringify({ port: 8000, network: { trustMode: "legacy", trustModeOrigin: "upgrade" } }));
      const app = makeApp();
      const got = await app.inject({ method: "GET", url: "/api/config" });
      expect(got.statusCode).toBe(200);
      const body = got.json();
      const config = body.data ?? body.config ?? body;
      expect(config.network).toEqual({ trustMode: "legacy", trustModeOrigin: "upgrade" });

      // The client echoes the whole block back on an unrelated save.
      const put = await app.inject({ method: "PUT", url: "/api/config", payload: { network: config.network, autoShutdown: false } });
      expect(put.statusCode).toBe(200);
      expect(raw().network).toEqual({ trustMode: "legacy", trustModeOrigin: "upgrade" });

      const flip = await app.inject({ method: "PUT", url: "/api/config", payload: { network: { trustMode: "pair" } } });
      expect(flip.statusCode).toBe(200);
      expect(raw().network).toEqual({ trustMode: "pair", trustModeOrigin: "operator" });
      await app.close();
    });

    it('PUT network.trustMode "open" (or any unknown value) → 400 and nothing is written', async () => {
      fs.writeFileSync(configFile, JSON.stringify({ port: 8000, network: { trustMode: "legacy", trustModeOrigin: "upgrade" } }));
      const before = fs.readFileSync(configFile, "utf-8");
      const app = makeApp();
      for (const trustMode of ["open", "", null, 1, "PAIR"]) {
        const res = await app.inject({ method: "PUT", url: "/api/config", payload: { network: { trustMode } } });
        expect(res.statusCode, JSON.stringify(trustMode)).toBe(400);
        expect(res.json().error).toContain("network.trustMode");
      }
      expect(fs.readFileSync(configFile, "utf-8")).toBe(before);
      await app.close();
    });
  });
});
