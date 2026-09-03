import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type DashboardConfig, DEFAULT_MEMORY_LIMITS, DEFAULT_DASHBOARD_PORT, DEFAULT_GATEWAY_PORT, ensureConfig, loadConfig, resolveDashboardPorts, resolvePublicBaseUrls } from "../config.js";

describe("loadConfig", () => {
  let testDir: string;
  let configFile: string;
  let origHome: string;

  beforeEach(() => {
    testDir = path.join(os.tmpdir(), `test-config-${Date.now()}`);
    fs.mkdirSync(path.join(testDir, ".pi", "dashboard"), { recursive: true });
    configFile = path.join(testDir, ".pi", "dashboard", "config.json");
    origHome = process.env.HOME!;
    process.env.HOME = testDir;
  });

  afterEach(() => {
    process.env.HOME = origHome;
    if (fs.existsSync(testDir)) fs.rmSync(testDir, { recursive: true });
  });

  it("should return all defaults when config file is missing", () => {
    const config = loadConfig();
    expect(config.port).toBe(8000);
    expect(config.piPort).toBe(9999);
    expect(config.autoStart).toBe(true);
    expect(config.autoShutdown).toBe(false);
    expect(config.lastServer).toBeUndefined();
    expect(config.shutdownIdleSeconds).toBe(300);
  });

  it("reopenSessionsAfterShutdown defaults to ask and round-trips valid values; invalid → ask", () => {
    expect(loadConfig().reopenSessionsAfterShutdown).toBe("ask");
    fs.writeFileSync(configFile, JSON.stringify({ reopenSessionsAfterShutdown: "auto" }));
    expect(loadConfig().reopenSessionsAfterShutdown).toBe("auto");
    fs.writeFileSync(configFile, JSON.stringify({ reopenSessionsAfterShutdown: "off" }));
    expect(loadConfig().reopenSessionsAfterShutdown).toBe("off");
    fs.writeFileSync(configFile, JSON.stringify({ reopenSessionsAfterShutdown: "bogus" }));
    expect(loadConfig().reopenSessionsAfterShutdown).toBe("ask");
  });

  it("should default bindHost to 127.0.0.1 when absent and preserve an explicit value", () => {
    const defaultConfig = loadConfig();
    expect(defaultConfig.bindHost).toBe("127.0.0.1");

    fs.writeFileSync(configFile, JSON.stringify({ bindHost: "0.0.0.0" }));
    expect(loadConfig().bindHost).toBe("0.0.0.0");
  });

  it("should fall back to default for empty-string or non-string bindHost", () => {
    fs.writeFileSync(configFile, JSON.stringify({ bindHost: "" }));
    expect(loadConfig().bindHost).toBe("127.0.0.1");

    fs.writeFileSync(configFile, JSON.stringify({ bindHost: 123 }));
    expect(loadConfig().bindHost).toBe("127.0.0.1");
  });

  it("should return values from config when all fields present", () => {
    fs.writeFileSync(configFile, JSON.stringify({
      port: 3000,
      piPort: 4000,
      autoStart: false,
    }));

    const config = loadConfig();
    expect(config.port).toBe(3000);
    expect(config.piPort).toBe(4000);
    expect(config.autoStart).toBe(false);
  });

  it("should apply defaults for omitted fields", () => {
    fs.writeFileSync(configFile, JSON.stringify({ port: 3000 }));

    const config = loadConfig();
    expect(config.port).toBe(3000);
    expect(config.piPort).toBe(9999);
    expect(config.autoStart).toBe(true);
    expect(config.autoShutdown).toBe(false);
    expect(config.shutdownIdleSeconds).toBe(300);
  });

  it("should load auto-shutdown config fields", () => {
    fs.writeFileSync(configFile, JSON.stringify({
      autoShutdown: false,
      shutdownIdleSeconds: 60,
    }));

    const config = loadConfig();
    expect(config.autoShutdown).toBe(false);
    expect(config.shutdownIdleSeconds).toBe(60);
    expect(config.port).toBe(8000);
  });

  it("should return defaults for malformed JSON", () => {
    fs.writeFileSync(configFile, "not valid json {{{");

    const config = loadConfig();
    expect(config.port).toBe(8000);
    expect(config.piPort).toBe(9999);
    expect(config.autoStart).toBe(true);
  });

  it("should return defaults for empty file", () => {
    fs.writeFileSync(configFile, "");

    const config = loadConfig();
    expect(config.port).toBe(8000);
  });

  it("should return spawnStrategy when set to headless", () => {
    fs.writeFileSync(configFile, JSON.stringify({ spawnStrategy: "headless" }));

    const config = loadConfig();
    expect(config.spawnStrategy).toBe("headless");
  });

  it("should default spawnStrategy to headless when missing", () => {
    fs.writeFileSync(configFile, JSON.stringify({ port: 3000 }));

    const config = loadConfig();
    expect(config.spawnStrategy).toBe("headless");
  });

  it("should fall back to headless for invalid spawnStrategy", () => {
    fs.writeFileSync(configFile, JSON.stringify({ spawnStrategy: "invalid" }));

    const config = loadConfig();
    expect(config.spawnStrategy).toBe("headless");
  });

  it("should return devBuildOnReload true when set", () => {
    fs.writeFileSync(configFile, JSON.stringify({ devBuildOnReload: true }));

    const config = loadConfig();
    expect(config.devBuildOnReload).toBe(true);
  });

  it("should default devBuildOnReload to false when missing", () => {
    fs.writeFileSync(configFile, JSON.stringify({ port: 3000 }));

    const config = loadConfig();
    expect(config.devBuildOnReload).toBe(false);
  });

  it("should return defaultModel when set", () => {
    fs.writeFileSync(configFile, JSON.stringify({ defaultModel: "anthropic/claude-opus-4-6" }));
    const config = loadConfig();
    expect(config.defaultModel).toBe("anthropic/claude-opus-4-6");
  });

  it("should default defaultModel to empty string when missing", () => {
    fs.writeFileSync(configFile, JSON.stringify({ port: 3000 }));
    const config = loadConfig();
    expect(config.defaultModel).toBe("");
  });

  it("should default defaultModel to empty string when not a string", () => {
    fs.writeFileSync(configFile, JSON.stringify({ defaultModel: 123 }));
    const config = loadConfig();
    expect(config.defaultModel).toBe("");
  });

  // defaultThinkingLevel — mirrors defaultModel "do not override" semantics.
  // See change: add-default-thinking-level.
  it("should return defaultThinkingLevel when set", () => {
    fs.writeFileSync(configFile, JSON.stringify({ defaultThinkingLevel: "high" }));
    const config = loadConfig();
    expect(config.defaultThinkingLevel).toBe("high");
  });

  it("should default defaultThinkingLevel to empty string when missing", () => {
    fs.writeFileSync(configFile, JSON.stringify({ port: 3000 }));
    const config = loadConfig();
    expect(config.defaultThinkingLevel).toBe("");
  });

  it("should default defaultThinkingLevel to empty string when not a string", () => {
    fs.writeFileSync(configFile, JSON.stringify({ defaultThinkingLevel: 3 }));
    const config = loadConfig();
    expect(config.defaultThinkingLevel).toBe("");
  });

  it("should return auth undefined when no auth key", () => {
    fs.writeFileSync(configFile, JSON.stringify({ port: 3000 }));
    const config = loadConfig();
    expect(config.auth).toBeUndefined();
  });

  it("should return auth undefined when auth has empty providers", () => {
    fs.writeFileSync(configFile, JSON.stringify({ auth: { providers: {} } }));
    const config = loadConfig();
    expect(config.auth).toBeUndefined();
  });

  it("should return auth undefined when auth.providers is missing", () => {
    fs.writeFileSync(configFile, JSON.stringify({ auth: { secret: "abc" } }));
    const config = loadConfig();
    expect(config.auth).toBeUndefined();
  });

  it("should parse auth config with github provider", () => {
    fs.writeFileSync(configFile, JSON.stringify({
      auth: {
        secret: "my-secret",
        providers: {
          github: { clientId: "id1", clientSecret: "secret1" },
        },
        allowedUsers: ["user@example.com", "octocat"],
      },
    }));
    const config = loadConfig();
    expect(config.auth).toBeDefined();
    expect(config.auth!.secret).toBe("my-secret");
    expect(config.auth!.providers.github.clientId).toBe("id1");
    expect(config.auth!.providers.github.clientSecret).toBe("secret1");
    expect(config.auth!.allowedUsers).toEqual(["user@example.com", "octocat"]);
  });

  it("should parse auth config with keycloak provider including issuerUrl", () => {
    fs.writeFileSync(configFile, JSON.stringify({
      auth: {
        secret: "sec",
        providers: {
          keycloak: { clientId: "kc", clientSecret: "ks", issuerUrl: "https://kc.example.com/realms/test" },
        },
      },
    }));
    const config = loadConfig();
    expect(config.auth!.providers.keycloak.issuerUrl).toBe("https://kc.example.com/realms/test");
  });

  it("should skip providers missing clientId or clientSecret", () => {
    fs.writeFileSync(configFile, JSON.stringify({
      auth: {
        secret: "sec",
        providers: {
          github: { clientId: "id1" }, // missing clientSecret
          google: { clientId: "id2", clientSecret: "s2" },
        },
      },
    }));
    const config = loadConfig();
    expect(config.auth).toBeDefined();
    expect(config.auth!.providers.github).toBeUndefined();
    expect(config.auth!.providers.google).toBeDefined();
  });

  it("should return auth undefined when all providers are invalid", () => {
    fs.writeFileSync(configFile, JSON.stringify({
      auth: {
        secret: "sec",
        providers: {
          github: { clientId: "id1" }, // missing clientSecret
        },
      },
    }));
    const config = loadConfig();
    expect(config.auth).toBeUndefined();
  });

  it("should default auth.secret to empty string when missing", () => {
    fs.writeFileSync(configFile, JSON.stringify({
      auth: {
        providers: {
          github: { clientId: "id1", clientSecret: "s1" },
        },
      },
    }));
    const config = loadConfig();
    expect(config.auth!.secret).toBe("");
  });

  it("should parse auth.bypassUrls as a string array", () => {
    fs.writeFileSync(configFile, JSON.stringify({
      auth: {
        providers: { github: { clientId: "id1", clientSecret: "s1" } },
        bypassUrls: ["/webhooks/", "/metrics"],
      },
    }));
    const config = loadConfig();
    expect(config.auth!.bypassUrls).toEqual(["/webhooks/", "/metrics"]);
  });

  it("should default auth.bypassUrls to empty array when absent", () => {
    fs.writeFileSync(configFile, JSON.stringify({
      auth: {
        providers: { github: { clientId: "id1", clientSecret: "s1" } },
      },
    }));
    const config = loadConfig();
    expect(config.auth!.bypassUrls).toEqual([]);
  });

  it("should ignore non-array auth.bypassUrls", () => {
    fs.writeFileSync(configFile, JSON.stringify({
      auth: {
        providers: { github: { clientId: "id1", clientSecret: "s1" } },
        bypassUrls: "not-an-array",
      },
    }));
    const config = loadConfig();
    expect(config.auth!.bypassUrls).toEqual([]);
  });

  it("should filter non-string entries from auth.bypassUrls", () => {
    fs.writeFileSync(configFile, JSON.stringify({
      auth: {
        providers: { github: { clientId: "id1", clientSecret: "s1" } },
        bypassUrls: ["/valid", 42, null, "/also-valid"],
      },
    }));
    const config = loadConfig();
    expect(config.auth!.bypassUrls).toEqual(["/valid", "/also-valid"]);
  });

  it("should parse auth.redirectBaseUrl when set", () => {
    fs.writeFileSync(configFile, JSON.stringify({
      auth: {
        providers: { github: { clientId: "id1", clientSecret: "s1" } },
        redirectBaseUrl: "https://pi.example.com",
      },
    }));
    const config = loadConfig();
    expect(config.auth!.redirectBaseUrl).toBe("https://pi.example.com");
  });

  it("should trim auth.redirectBaseUrl and omit blank values", () => {
    fs.writeFileSync(configFile, JSON.stringify({
      auth: {
        providers: { github: { clientId: "id1", clientSecret: "s1" } },
        redirectBaseUrl: "  https://pi.example.com/  ",
      },
    }));
    expect(loadConfig().auth!.redirectBaseUrl).toBe("https://pi.example.com/");

    fs.writeFileSync(configFile, JSON.stringify({
      auth: {
        providers: { github: { clientId: "id1", clientSecret: "s1" } },
        redirectBaseUrl: "   ",
      },
    }));
    expect(loadConfig().auth!.redirectBaseUrl).toBeUndefined();

    fs.writeFileSync(configFile, JSON.stringify({
      auth: {
        providers: { github: { clientId: "id1", clientSecret: "s1" } },
        redirectBaseUrl: 42,
      },
    }));
    expect(loadConfig().auth!.redirectBaseUrl).toBeUndefined();
  });

  it("should parse lastServer when set", () => {
    fs.writeFileSync(configFile, JSON.stringify({ lastServer: "workstation.local:8000" }));
    const config = loadConfig();
    expect(config.lastServer).toBe("workstation.local:8000");
  });

  it("should return undefined lastServer when not set", () => {
    fs.writeFileSync(configFile, JSON.stringify({ port: 3000 }));
    const config = loadConfig();
    expect(config.lastServer).toBeUndefined();
  });

  it("should ignore non-string lastServer", () => {
    fs.writeFileSync(configFile, JSON.stringify({ lastServer: 123 }));
    const config = loadConfig();
    expect(config.lastServer).toBeUndefined();
  });

  it("should return electronMode false by default", () => {
    const config = loadConfig();
    expect(config.electronMode).toBe(false);
  });

  it("should parse electronMode when true", () => {
    fs.writeFileSync(configFile, JSON.stringify({ electronMode: true }));
    const config = loadConfig();
    expect(config.electronMode).toBe(true);
  });

  it("should ignore non-boolean electronMode", () => {
    fs.writeFileSync(configFile, JSON.stringify({ electronMode: "yes" }));
    const config = loadConfig();
    expect(config.electronMode).toBe(false);
  });

  // ── fix-trusted-networks-no-oauth regression tests ──────────────────
  // These assert that auth.bypassHosts and auth.bypassUrls are honored
  // at load time EVEN WHEN auth.providers is empty or absent. Before the
  // fix, parseAuthConfig returned undefined whenever providers was empty,
  // nuking bypassHosts before the resolvedTrustedNetworks merge could
  // read it. See openspec/changes/fix-trusted-networks-no-oauth/.

  it("should honor auth.bypassHosts when providers is {} (task 1.1)", () => {
    fs.writeFileSync(configFile, JSON.stringify({
      auth: { providers: {}, bypassHosts: ["192.168.1.0/24"] },
    }));
    const config = loadConfig();
    expect(config.auth).toBeDefined();
    expect(config.auth!.bypassHosts).toEqual(["192.168.1.0/24"]);
    expect(config.resolvedTrustedNetworks).toContain("192.168.1.0/24");
  });

  it("should honor auth.bypassHosts when no providers key at all (task 1.2)", () => {
    fs.writeFileSync(configFile, JSON.stringify({
      auth: { bypassHosts: ["10.0.0.0/8"] },
    }));
    const config = loadConfig();
    expect(config.auth).toBeDefined();
    expect(config.auth!.bypassHosts).toEqual(["10.0.0.0/8"]);
    expect(config.resolvedTrustedNetworks).toContain("10.0.0.0/8");
  });

  it("should honor auth.bypassUrls when providers is {} (task 1.3)", () => {
    fs.writeFileSync(configFile, JSON.stringify({
      auth: { providers: {}, bypassUrls: ["/webhooks/"] },
    }));
    const config = loadConfig();
    expect(config.auth).toBeDefined();
    expect(config.auth!.bypassUrls).toEqual(["/webhooks/"]);
  });

  it("should return auth undefined when providers={} and all bypass arrays are empty (task 1.4 boundary)", () => {
    fs.writeFileSync(configFile, JSON.stringify({
      auth: { providers: {}, bypassHosts: [], bypassUrls: [] },
    }));
    const config = loadConfig();
    // Truly empty auth → still undefined (boundary preserved)
    expect(config.auth).toBeUndefined();
    expect(config.resolvedTrustedNetworks).toEqual([]);
  });

  it("should merge top-level trustedNetworks with bypassHosts when no providers", () => {
    fs.writeFileSync(configFile, JSON.stringify({
      trustedNetworks: ["192.168.1.0/24"],
      auth: { providers: {}, bypassHosts: ["10.0.0.0/8"] },
    }));
    const config = loadConfig();
    expect(config.resolvedTrustedNetworks).toContain("192.168.1.0/24");
    expect(config.resolvedTrustedNetworks).toContain("10.0.0.0/8");
  });
});

describe("ensureConfig", () => {
  let testDir: string;
  let configDir: string;
  let configFile: string;
  let origHome: string;

  beforeEach(() => {
    testDir = path.join(os.tmpdir(), `test-ensure-${Date.now()}`);
    configDir = path.join(testDir, ".pi", "dashboard");
    configFile = path.join(configDir, "config.json");
    origHome = process.env.HOME!;
    process.env.HOME = testDir;
  });

  afterEach(() => {
    process.env.HOME = origHome;
    if (fs.existsSync(testDir)) fs.rmSync(testDir, { recursive: true });
  });

  it("should create directory and config when nothing exists", () => {
    ensureConfig();
    expect(fs.existsSync(configFile)).toBe(true);

    const content = JSON.parse(fs.readFileSync(configFile, "utf-8"));
    expect(content.port).toBe(8000);
    expect(content.piPort).toBe(9999);
    expect(content.autoStart).toBe(true);
    expect(content.autoShutdown).toBe(false);
    expect(content.shutdownIdleSeconds).toBe(300);
    expect(content.devBuildOnReload).toBe(false);
    expect(content.electronMode).toBeUndefined();
  });

  it("should create config when directory exists but file does not", () => {
    fs.mkdirSync(configDir, { recursive: true });
    ensureConfig();
    expect(fs.existsSync(configFile)).toBe(true);
  });

  it("should not overwrite existing config", () => {
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(configFile, JSON.stringify({ port: 1234 }));

    ensureConfig();

    const content = JSON.parse(fs.readFileSync(configFile, "utf-8"));
    expect(content.port).toBe(1234);
    expect(content.piPort).toBeUndefined();
  });
});

describe("loadConfig reattachPlacement", () => {
  let testDir: string;
  let configFile: string;
  let origHome: string;

  beforeEach(() => {
    testDir = path.join(os.tmpdir(), `test-reattach-${Date.now()}-${Math.random()}`);
    fs.mkdirSync(path.join(testDir, ".pi", "dashboard"), { recursive: true });
    configFile = path.join(testDir, ".pi", "dashboard", "config.json");
    origHome = process.env.HOME!;
    process.env.HOME = testDir;
  });

  afterEach(() => {
    process.env.HOME = origHome;
    if (fs.existsSync(testDir)) fs.rmSync(testDir, { recursive: true });
  });

  it("defaults to 'always' when missing", () => {
    fs.writeFileSync(configFile, JSON.stringify({}));
    expect(loadConfig().reattachPlacement).toBe("always");
  });

  it("defaults to 'always' when config file does not exist", () => {
    expect(loadConfig().reattachPlacement).toBe("always");
  });

  it("accepts 'preserve'", () => {
    fs.writeFileSync(configFile, JSON.stringify({ reattachPlacement: "preserve" }));
    expect(loadConfig().reattachPlacement).toBe("preserve");
  });

  it("accepts 'streaming-only'", () => {
    fs.writeFileSync(configFile, JSON.stringify({ reattachPlacement: "streaming-only" }));
    expect(loadConfig().reattachPlacement).toBe("streaming-only");
  });

  it("accepts 'always' explicitly", () => {
    fs.writeFileSync(configFile, JSON.stringify({ reattachPlacement: "always" }));
    expect(loadConfig().reattachPlacement).toBe("always");
  });

  it("falls back to 'always' on invalid string", () => {
    fs.writeFileSync(configFile, JSON.stringify({ reattachPlacement: "wibble" }));
    expect(loadConfig().reattachPlacement).toBe("always");
  });

  it("falls back to 'always' on non-string", () => {
    fs.writeFileSync(configFile, JSON.stringify({ reattachPlacement: 42 }));
    expect(loadConfig().reattachPlacement).toBe("always");
  });

  it("ensureConfig does NOT write reattachPlacement to defaults", () => {
    ensureConfig();
    const content = JSON.parse(fs.readFileSync(configFile, "utf-8"));
    expect(content.reattachPlacement).toBeUndefined();
  });
});

// See change: simplify-session-card-ordering.
describe("loadConfig completedFirst / questionFirst", () => {
  let testDir: string;
  let configFile: string;
  let origHome: string;

  beforeEach(() => {
    testDir = path.join(os.tmpdir(), `test-config-cfqf-${Date.now()}-${Math.random()}`);
    fs.mkdirSync(path.join(testDir, ".pi", "dashboard"), { recursive: true });
    configFile = path.join(testDir, ".pi", "dashboard", "config.json");
    origHome = process.env.HOME!;
    process.env.HOME = testDir;
  });

  afterEach(() => {
    process.env.HOME = origHome;
    if (fs.existsSync(testDir)) fs.rmSync(testDir, { recursive: true });
  });

  it("both default to false when omitted", () => {
    fs.writeFileSync(configFile, JSON.stringify({}));
    const cfg = loadConfig();
    expect(cfg.completedFirst).toBe(false);
    expect(cfg.questionFirst).toBe(false);
  });

  it("both default to false when config file missing", () => {
    const cfg = loadConfig();
    expect(cfg.completedFirst).toBe(false);
    expect(cfg.questionFirst).toBe(false);
  });

  it("round-trips true values", () => {
    fs.writeFileSync(configFile, JSON.stringify({ completedFirst: true, questionFirst: true }));
    const cfg = loadConfig();
    expect(cfg.completedFirst).toBe(true);
    expect(cfg.questionFirst).toBe(true);
  });

  it("falls back to false for non-boolean", () => {
    fs.writeFileSync(configFile, JSON.stringify({ completedFirst: "yes", questionFirst: 1 }));
    const cfg = loadConfig();
    expect(cfg.completedFirst).toBe(false);
    expect(cfg.questionFirst).toBe(false);
  });
});

describe("loadConfig spawnRegisterTimeoutMs", () => {
  let testDir: string;
  let configFile: string;
  let origHome: string;

  beforeEach(() => {
    testDir = path.join(os.tmpdir(), `test-config-srt-${Date.now()}`);
    fs.mkdirSync(path.join(testDir, ".pi", "dashboard"), { recursive: true });
    configFile = path.join(testDir, ".pi", "dashboard", "config.json");
    origHome = process.env.HOME!;
    process.env.HOME = testDir;
  });

  afterEach(() => {
    process.env.HOME = origHome;
    if (fs.existsSync(testDir)) fs.rmSync(testDir, { recursive: true });
  });

  it("defaults to 30000 when field is omitted", () => {
    expect(loadConfig().spawnRegisterTimeoutMs).toBe(30000);
  });

  it("preserves in-range value", () => {
    fs.writeFileSync(configFile, JSON.stringify({ spawnRegisterTimeoutMs: 45000 }));
    expect(loadConfig().spawnRegisterTimeoutMs).toBe(45000);
  });

  it("clamps below-range value to 5000", () => {
    fs.writeFileSync(configFile, JSON.stringify({ spawnRegisterTimeoutMs: 1000 }));
    expect(loadConfig().spawnRegisterTimeoutMs).toBe(5000);
  });

  it("clamps above-range value to 120000", () => {
    fs.writeFileSync(configFile, JSON.stringify({ spawnRegisterTimeoutMs: 999999 }));
    expect(loadConfig().spawnRegisterTimeoutMs).toBe(120000);
  });

  it("falls back to default for non-number string", () => {
    fs.writeFileSync(configFile, JSON.stringify({ spawnRegisterTimeoutMs: "thirty" }));
    expect(loadConfig().spawnRegisterTimeoutMs).toBe(30000);
  });

  it("falls back to default for null", () => {
    fs.writeFileSync(configFile, JSON.stringify({ spawnRegisterTimeoutMs: null }));
    expect(loadConfig().spawnRegisterTimeoutMs).toBe(30000);
  });
});

// See change: add-dynamic-pwa-manifest-naming.
describe("dashboardName", () => {
  let testDir: string;
  let configFile: string;
  let origHome: string;

  beforeEach(() => {
    testDir = path.join(os.tmpdir(), `test-config-${Date.now()}`);
    fs.mkdirSync(path.join(testDir, ".pi", "dashboard"), { recursive: true });
    configFile = path.join(testDir, ".pi", "dashboard", "config.json");
    origHome = process.env.HOME!;
    process.env.HOME = testDir;
  });

  afterEach(() => {
    process.env.HOME = origHome;
    if (fs.existsSync(testDir)) fs.rmSync(testDir, { recursive: true });
  });

  it("is undefined when absent from config", () => {
    fs.writeFileSync(configFile, JSON.stringify({}));
    expect(loadConfig().dashboardName).toBeUndefined();
  });

  it("round-trips a non-empty string", () => {
    fs.writeFileSync(configFile, JSON.stringify({ dashboardName: "Home NAS" }));
    expect(loadConfig().dashboardName).toBe("Home NAS");
  });

  it("is undefined for whitespace-only override", () => {
    fs.writeFileSync(configFile, JSON.stringify({ dashboardName: "   " }));
    expect(loadConfig().dashboardName).toBeUndefined();
  });

  it("is undefined for non-string override", () => {
    fs.writeFileSync(configFile, JSON.stringify({ dashboardName: 42 }));
    expect(loadConfig().dashboardName).toBeUndefined();
  });
});

describe("loadConfig gitWorktreeEnabled", () => {
  let testDir: string;
  let configFile: string;
  let origHome: string;

  beforeEach(() => {
    testDir = path.join(os.tmpdir(), `test-gwe-${Date.now()}-${Math.random()}`);
    fs.mkdirSync(path.join(testDir, ".pi", "dashboard"), { recursive: true });
    configFile = path.join(testDir, ".pi", "dashboard", "config.json");
    origHome = process.env.HOME!;
    process.env.HOME = testDir;
  });

  afterEach(() => {
    process.env.HOME = origHome;
    if (fs.existsSync(testDir)) fs.rmSync(testDir, { recursive: true });
  });

  it("defaults to true when absent from config", () => {
    fs.writeFileSync(configFile, JSON.stringify({}));
    expect(loadConfig().gitWorktreeEnabled).toBe(true);
  });

  it("defaults to true when config file does not exist", () => {
    expect(loadConfig().gitWorktreeEnabled).toBe(true);
  });

  it("round-trips explicit false", () => {
    fs.writeFileSync(configFile, JSON.stringify({ gitWorktreeEnabled: false }));
    expect(loadConfig().gitWorktreeEnabled).toBe(false);
  });

  it("round-trips explicit true", () => {
    fs.writeFileSync(configFile, JSON.stringify({ gitWorktreeEnabled: true }));
    expect(loadConfig().gitWorktreeEnabled).toBe(true);
  });

  it("falls back to default when non-boolean", () => {
    fs.writeFileSync(configFile, JSON.stringify({ gitWorktreeEnabled: "yes" }));
    expect(loadConfig().gitWorktreeEnabled).toBe(true);
  });

  it("preserves sibling fields when only gitWorktreeEnabled is set", () => {
    fs.writeFileSync(
      configFile,
      JSON.stringify({ port: 1234, gitWorktreeEnabled: false, defaultModel: "gpt-4" }),
    );
    const c = loadConfig();
    expect(c.gitWorktreeEnabled).toBe(false);
    expect(c.port).toBe(1234);
    expect(c.defaultModel).toBe("gpt-4");
  });

  it("preserves sibling fields when defaultThinkingLevel is set alongside them", () => {
    // Partial-merge shape: a config carrying port + defaultModel plus
    // defaultThinkingLevel keeps all three intact. See change:
    // add-default-thinking-level.
    fs.writeFileSync(
      configFile,
      JSON.stringify({ port: 1234, defaultModel: "gpt-4", defaultThinkingLevel: "low" }),
    );
    const c = loadConfig();
    expect(c.defaultThinkingLevel).toBe("low");
    expect(c.port).toBe(1234);
    expect(c.defaultModel).toBe("gpt-4");
  });
});

// Slice 2 — `pairing.publicBaseUrls` promoted to top-level `publicBaseUrls`.
// See change: config-override-oauth-redirect-base (D7).
describe("publicBaseUrls promotion", () => {
  let testDir: string;
  let configFile: string;
  let origHome: string;

  beforeEach(() => {
    testDir = path.join(os.tmpdir(), `test-config-pbu-${Date.now()}`);
    fs.mkdirSync(path.join(testDir, ".pi", "dashboard"), { recursive: true });
    configFile = path.join(testDir, ".pi", "dashboard", "config.json");
    origHome = process.env.HOME!;
    process.env.HOME = testDir;
  });

  afterEach(() => {
    process.env.HOME = origHome;
    if (fs.existsSync(testDir)) fs.rmSync(testDir, { recursive: true });
  });

  // #G2
  it("resolves a top-level publicBaseUrls list", () => {
    fs.writeFileSync(configFile, JSON.stringify({ publicBaseUrls: ["https://top.example", 7] }));
    const c = loadConfig();
    expect(c.publicBaseUrls).toEqual(["https://top.example"]);
    expect(resolvePublicBaseUrls(c)).toEqual(["https://top.example"]);
  });

  // #G3 — a legacy-only config keeps working, byte-identical, and the legacy
  // key is still readable in its old location.
  it("falls back to the legacy pairing.publicBaseUrls when the top-level key is absent", () => {
    fs.writeFileSync(
      configFile,
      JSON.stringify({ pairing: { publicBaseUrls: ["https://legacy.example"] } }),
    );
    const c = loadConfig();
    expect(c.publicBaseUrls).toBeUndefined();
    expect(c.pairing.publicBaseUrls).toEqual(["https://legacy.example"]);
    expect(resolvePublicBaseUrls(c)).toEqual(["https://legacy.example"]);
  });

  // #G4
  it("prefers the top-level key when both are present", () => {
    fs.writeFileSync(
      configFile,
      JSON.stringify({
        publicBaseUrls: ["https://top.example"],
        pairing: { publicBaseUrls: ["https://legacy.example"] },
      }),
    );
    expect(resolvePublicBaseUrls(loadConfig())).toEqual(["https://top.example"]);
  });

  // Absence is load-bearing (D7): an empty top-level list must NOT fall back.
  it("treats an empty top-level list as present-but-empty, not absent", () => {
    fs.writeFileSync(
      configFile,
      JSON.stringify({ publicBaseUrls: [], pairing: { publicBaseUrls: ["https://legacy.example"] } }),
    );
    expect(resolvePublicBaseUrls(loadConfig())).toEqual([]);
  });

  // #G5 — no default value is written; absence must stay representable.
  it("ensureConfig never writes a top-level publicBaseUrls key", () => {
    ensureConfig();
    const written = JSON.parse(fs.readFileSync(configFile, "utf-8"));
    expect(Object.hasOwn(written, "publicBaseUrls")).toBe(false);
    expect(loadConfig().publicBaseUrls).toBeUndefined();
  });
});

/**
 * See change: lazy-load-session-history, fix-lazy-history-backfill-ux (D7).
 *
 * The default flipped from `0` (unlimited) to `2000`, which makes PRESENCE
 * DETECTION the load-bearing property: the old parse collapsed absent,
 * negative, non-numeric and explicit `0` into `0`, so a non-zero default would
 * be unreachable from a config file that simply omits the field. E1/E2 are the
 * pair that pins it — absent → the default, explicit `0` → `0` (the documented
 * rollback lever), and `0` still never clamps up.
 */
describe("loadConfig memoryLimits.maxReplayEvents", () => {
  let testDir: string;
  let configFile: string;
  let origHome: string;

  beforeEach(() => {
    testDir = path.join(os.tmpdir(), `test-config-mre-${Date.now()}`);
    fs.mkdirSync(path.join(testDir, ".pi", "dashboard"), { recursive: true });
    configFile = path.join(testDir, ".pi", "dashboard", "config.json");
    origHome = process.env.HOME!;
    process.env.HOME = testDir;
  });

  afterEach(() => {
    process.env.HOME = origHome;
    if (fs.existsSync(testDir)) fs.rmSync(testDir, { recursive: true });
  });

  const writeLimits = (limits: Record<string, unknown>) =>
    fs.writeFileSync(configFile, JSON.stringify({ memoryLimits: limits }));

  // #E1 — absent resolves to the DEFAULT, not to 0, and no sibling moves.
  it("maxReplayEvents defaults to 2000 when absent, leaving siblings untouched", () => {
    writeLimits({ maxEventsPerSession: 12345, maxStringFieldSize: 77, maxWsBufferBytes: 999 });
    const limits = loadConfig().memoryLimits;
    expect(limits.maxReplayEvents).toBe(2000);
    expect(limits.maxReplayEvents).toBe(DEFAULT_MEMORY_LIMITS.maxReplayEvents);
    expect(limits.maxEventsPerSession).toBe(12345);
    expect(limits.maxStringFieldSize).toBe(77);
    expect(limits.maxWsBufferBytes).toBe(999);
  });

  // #E2, #E3, #E4 — the MIN_REPLAY_WINDOW boundary, both sides plus the point.
  it.each([
    [99, 100],
    [100, 100],
    [101, 101],
  ])("maxReplayEvents %i resolves to %i at the minimum-window boundary", (input, expected) => {
    writeLimits({ maxReplayEvents: input });
    expect(loadConfig().memoryLimits.maxReplayEvents).toBe(expected);
  });

  /**
   * #E2 — an EXPLICIT 0 is "unlimited", and is the documented rollback lever.
   * It must survive presence detection (not fall back to the default) and must
   * never clamp up to `MIN_REPLAY_WINDOW`.
   */
  it("an explicit maxReplayEvents 0 is preserved, never defaulted and never clamped", () => {
    writeLimits({ maxReplayEvents: 0 });
    expect(loadConfig().memoryLimits.maxReplayEvents).toBe(0);
  });

  /**
   * #E5, #E6 — negative and non-numeric are UNSET, so they resolve to the
   * default. `-1` changes meaning here: it parsed to `0` (unlimited) before the
   * flip and to `2000` after. Recorded deliberately, not waved through.
   */
  it.each([
    ["negative", -1],
    ["non-numeric string", "500"],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
  ])("maxReplayEvents falls back to the default for a %s value", (_label, input) => {
    writeLimits({ maxReplayEvents: input });
    expect(loadConfig().memoryLimits.maxReplayEvents).toBe(DEFAULT_MEMORY_LIMITS.maxReplayEvents);
  });

  it("a fractional maxReplayEvents is floored, not rounded up", () => {
    writeLimits({ maxReplayEvents: 500.9 });
    expect(loadConfig().memoryLimits.maxReplayEvents).toBe(500);
  });
});

/**
 * `memoryLimits.replayWindowMode` — the head/tail split becomes a configured
 * SHAPE rather than a hard-coded one. Unknown values coerce to the default
 * rather than throwing, matching every sibling in `parseMemoryLimits`.
 * See change: add-tail-only-replay-window (D1).
 */
describe("loadConfig memoryLimits.replayWindowMode", () => {
  let testDir: string;
  let configFile: string;
  let origHome: string;

  beforeEach(() => {
    testDir = path.join(os.tmpdir(), `test-config-rwm-${Date.now()}`);
    fs.mkdirSync(path.join(testDir, ".pi", "dashboard"), { recursive: true });
    configFile = path.join(testDir, ".pi", "dashboard", "config.json");
    origHome = process.env.HOME!;
    process.env.HOME = testDir;
  });

  afterEach(() => {
    process.env.HOME = origHome;
    if (fs.existsSync(testDir)) fs.rmSync(testDir, { recursive: true });
  });

  const writeLimits = (limits: Record<string, unknown>) =>
    fs.writeFileSync(configFile, JSON.stringify({ memoryLimits: limits }));

  // #E1 — the field ABSENT is today's behaviour, for everyone who never opts in.
  it("defaults to head-tail when the field is absent", () => {
    fs.writeFileSync(configFile, JSON.stringify({}));
    expect(loadConfig().memoryLimits.replayWindowMode).toBe("head-tail");
    expect(DEFAULT_MEMORY_LIMITS.replayWindowMode).toBe("head-tail");
  });

  // #E2 — every invalid class coerces, and NONE of them throws.
  it.each([
    ["a near-miss string", "tail"],
    ["a number", 7],
    ["null", null],
    ["an array", []],
    ["wrong case", "TAIL-ONLY"],
  ])("coerces %s to head-tail without throwing", (_label, input) => {
    writeLimits({ replayWindowMode: input });
    expect(() => loadConfig()).not.toThrow();
    expect(loadConfig().memoryLimits.replayWindowMode).toBe("head-tail");
  });

  // #E3 — the one valid opt-in value survives verbatim.
  it("returns tail-only verbatim", () => {
    writeLimits({ replayWindowMode: "tail-only" });
    expect(loadConfig().memoryLimits.replayWindowMode).toBe("tail-only");
  });

  /**
   * #E4 — the MIN_REPLAY_WINDOW clamp is MODE-INDEPENDENT. A mode switch that
   * silently doubled a configured `50` would be a worse surprise than the
   * documented floor, so both modes must agree for every input.
   */
  it.each([
    [0, 0],
    [1, 100],
    [5, 100],
    [99, 100],
    [100, 100],
    [101, 101],
  ])("clamps maxReplayEvents %i to %i identically in both modes", (input, expected) => {
    writeLimits({ maxReplayEvents: input, replayWindowMode: "head-tail" });
    const headTail = loadConfig().memoryLimits.maxReplayEvents;
    writeLimits({ maxReplayEvents: input, replayWindowMode: "tail-only" });
    const tailOnly = loadConfig().memoryLimits.maxReplayEvents;
    expect(headTail).toBe(expected);
    expect(tailOnly).toBe(expected);
    expect(headTail).toBe(tailOnly);
  });
});

// fix-bridge-autostart-port-resolution — shared env→config→default port
// resolver (task 2.1, test-plan #E2). Pure function: env and parsed file
// config are ARGUMENTS, never process.env reads (design D1). Parse rules
// pinned to the pre-existing private resolver: Number(v) finite > 0,
// first var of a role wins.
describe("resolveDashboardPorts", () => {
  it("env wins over config for both roles", () => {
    const r = resolveDashboardPorts(
      { PI_DASHBOARD_PORT: "18697", PI_DASHBOARD_PI_PORT: "19697" },
      { port: 8001, piPort: 9101 },
    );
    expect(r).toEqual({ port: 18697, piPort: 19697 });
  });

  it("config wins over defaults when env absent", () => {
    const r = resolveDashboardPorts({}, { port: 8001, piPort: 9101 });
    expect(r).toEqual({ port: 8001, piPort: 9101 });
  });

  it("falls back to the shared defaults when neither source carries a port", () => {
    const r = resolveDashboardPorts({}, {});
    expect(r).toEqual({ port: DEFAULT_DASHBOARD_PORT, piPort: DEFAULT_GATEWAY_PORT });
  });

  it.each([
    ["empty string", ""],
    ["non-numeric", "abc"],
    ["zero", "0"],
    ["negative", "-1"],
    ["decimal", "1.5"],
    ["out of TCP range", "70000"],
  ])("ignores %s env values instead of shadowing config", (_label, value) => {
    const r = resolveDashboardPorts(
      { PI_DASHBOARD_PORT: value, DASHBOARD_PORT: value, PI_DASHBOARD_PI_PORT: value, PI_GATEWAY_PORT: value },
      { port: 8001, piPort: 9101 },
    );
    expect(r).toEqual({ port: 8001, piPort: 9101 });
  });

  it("first var of a role wins (PI_DASHBOARD_PORT over DASHBOARD_PORT, PI_DASHBOARD_PI_PORT over PI_GATEWAY_PORT)", () => {
    const r = resolveDashboardPorts(
      { PI_DASHBOARD_PORT: "8001", DASHBOARD_PORT: "8002", PI_DASHBOARD_PI_PORT: "9101", PI_GATEWAY_PORT: "9102" },
      {},
    );
    expect(r).toEqual({ port: 8001, piPort: 9101 });
  });

  it("second var of a role is used when the first is absent", () => {
    const r = resolveDashboardPorts({ DASHBOARD_PORT: "8002", PI_GATEWAY_PORT: "9102" }, {});
    expect(r).toEqual({ port: 8002, piPort: 9102 });
  });

  it("ignores unusable CONFIG values (0, negative, out of range) so they never shadow the defaults", () => {
    expect(resolveDashboardPorts({}, { port: 0, piPort: -5 })).toEqual({
      port: DEFAULT_DASHBOARD_PORT,
      piPort: DEFAULT_GATEWAY_PORT,
    });
    expect(resolveDashboardPorts({}, { port: 70000 })).toEqual({
      port: DEFAULT_DASHBOARD_PORT,
      piPort: DEFAULT_GATEWAY_PORT,
    });
  });
});
