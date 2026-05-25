import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadConfig, ensureConfig, type DashboardConfig } from "../config.js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

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
