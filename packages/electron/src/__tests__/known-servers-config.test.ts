/**
 * Test that loadMinimalConfig correctly parses knownServers from config.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// We test the parsing logic directly since Electron's loadMinimalConfig is inlined
describe("Electron knownServers config parsing", () => {
  let testDir: string;
  let configFile: string;
  let origHome: string;

  beforeEach(() => {
    testDir = path.join(os.tmpdir(), `test-electron-config-${Date.now()}`);
    fs.mkdirSync(path.join(testDir, ".pi", "dashboard"), { recursive: true });
    configFile = path.join(testDir, ".pi", "dashboard", "config.json");
    origHome = process.env.HOME!;
    process.env.HOME = testDir;
  });

  afterEach(() => {
    process.env.HOME = origHome;
    if (fs.existsSync(testDir)) fs.rmSync(testDir, { recursive: true });
  });

  // Replicate the inlined parsing logic from server-lifecycle.ts
  function parseKnownServers(raw: string): Array<{ host: string; port: number; label?: string }> {
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed.knownServers)) return [];
      return parsed.knownServers
        .filter((s: any) => s && typeof s.host === "string" && typeof s.port === "number")
        .map((s: any) => ({ host: s.host, port: s.port, ...(typeof s.label === "string" ? { label: s.label } : {}) }));
    } catch {
      return [];
    }
  }

  it("should return empty array when no knownServers", () => {
    expect(parseKnownServers(JSON.stringify({ port: 8000 }))).toEqual([]);
  });

  it("should parse valid known servers", () => {
    const config = {
      knownServers: [
        { host: "office-mac", port: 8000, label: "Office" },
        { host: "build-server", port: 9000 },
      ],
    };
    const result = parseKnownServers(JSON.stringify(config));
    expect(result).toEqual([
      { host: "office-mac", port: 8000, label: "Office" },
      { host: "build-server", port: 9000 },
    ]);
  });

  it("should filter invalid entries", () => {
    const config = {
      knownServers: [
        { host: "valid", port: 8000 },
        { host: "no-port" },
        null,
        "bad",
      ],
    };
    const result = parseKnownServers(JSON.stringify(config));
    expect(result).toHaveLength(1);
    expect(result[0].host).toBe("valid");
  });

  it("should generate known servers HTML for loading page", () => {
    const servers = [
      { host: "office-mac", port: 8000, label: "Office" },
      { host: "build-server", port: 9000 },
    ];
    // Simulate the HTML generation from main.ts
    const buttons = servers.map((s) =>
      `<button onclick="window.switchServer('${s.host}', ${s.port})">${s.label || s.host} - ${s.host}:${s.port}</button>`
    );
    expect(buttons).toHaveLength(2);
    expect(buttons[0]).toContain("Office");
    expect(buttons[0]).toContain("office-mac");
    expect(buttons[1]).toContain("build-server");
  });
});


// ── group-servers-by-identity: mirror readers keep working on the routes-shape file (#E10, D5) ──
// `loadMinimalConfig` and the navigation allowlist read only `host`/`port`/`label`; neither reads `routes`.

describe("Electron mirror readers on a routes-shape config (#E10)", () => {
  let home: string;
  let savedHome: string | undefined;

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "elec-routes-"));
    savedHome = process.env.HOME;
    process.env.HOME = home;
    fs.mkdirSync(path.join(home, ".pi", "dashboard"), { recursive: true });
  });
  afterEach(() => {
    if (savedHome === undefined) delete process.env.HOME;
    else process.env.HOME = savedHome;
    fs.rmSync(home, { recursive: true, force: true });
  });

  const write = (cfg: unknown) => fs.writeFileSync(path.join(home, ".pi", "dashboard", "config.json"), JSON.stringify(cfg));
  const FP = `sha256:${"A".repeat(43)}`;
  const entries = [
    // multi-route entry: mirror = first http route
    {
      host: "192.168.16.204",
      port: 8000,
      label: "Home",
      fingerprint: FP,
      addedAt: "2026-05-01T00:00:00.000Z",
      routes: [
        { host: "home.share.zrok.io", port: 443, scheme: "https", source: "pairing" },
        { host: "192.168.16.204", port: 8000, scheme: "http", source: "mdns" },
        { host: "home-imac.local", port: 8000, scheme: "http", source: "saved" },
      ],
    },
    // https-only entry: mirrors its https host and port 443
    {
      host: "lab.example.org",
      port: 443,
      label: "Lab",
      addedAt: "2026-05-02T00:00:00.000Z",
      routes: [{ host: "lab.example.org", port: 443, scheme: "https", source: "saved" }],
    },
  ];

  it("#E10: loadMinimalConfig keeps every routes-shape entry under its host/port mirror (https-only included) and passes only host/port/label on", async () => {
    write({ port: 8000, knownServers: entries });
    const { loadMinimalConfig } = await import("../lib/server-lifecycle.js");
    const cfg = loadMinimalConfig();
    expect(cfg.knownServers).toEqual([
      { host: "192.168.16.204", port: 8000, label: "Home" },
      { host: "lab.example.org", port: 443, label: "Lab" },
    ]);
    expect(JSON.stringify(cfg.knownServers)).not.toMatch(/routes|zrok|fingerprint|pairing/);
  });

  it("#E10: the navigation allowlist is built from the mirror only — an https-only entry yields one extra unused http://host:443 origin; secondary routes are not read", async () => {
    write({ port: 8000, knownServers: entries });
    const { loadMinimalConfig } = await import("../lib/server-lifecycle.js");
    const { navigateToServer } = await import("../lib/local-proof-bootstrap.js");
    const config = loadMinimalConfig();
    const nav = async (target: string) => {
      const win = { loadURL: async (_u: string) => {} };
      return navigateToServer(win, target, { config, fetchImpl: (async () => new Response("{}")) as never, token: "t" });
    };
    expect(await nav("http://192.168.16.204:8000")).toEqual({ navigated: true });
    expect(await nav("http://lab.example.org:443")).toEqual({ navigated: true }); // the extra mirror origin
    expect(await nav("http://home.share.zrok.io:443")).toEqual({ navigated: false, reason: "target-not-allowed" }); // a secondary route is not read
    expect(await nav("http://home-imac.local:8000")).toEqual({ navigated: false, reason: "target-not-allowed" });
  });

  it("#E10: an entry whose mirror is missing is dropped exactly as before (no valid host/port)", async () => {
    write({ port: 8000, knownServers: [{ label: "x", routes: [{ host: "a.example.org", port: 443, scheme: "https", source: "saved" }] }] });
    const { loadMinimalConfig } = await import("../lib/server-lifecycle.js");
    expect(loadMinimalConfig().knownServers).toEqual([]);
  });
});
