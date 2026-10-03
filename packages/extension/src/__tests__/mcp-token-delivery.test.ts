/**
 * Bridge-side registration of the dashboard MCP server
 * (migrate-mcp-to-pi-builtin D1; test-plan E1–E5, E16).
 *
 * The module under test is the ENTIRE in-session surface of credential
 * delivery: on `mcp_token_minted` it registers `pi-dashboard` with pi's
 * built-in MCP (`pi.registerMcpServer`), carrying the bearer as an
 * `Authorization` header and the server-delivered `/mcp` URL. It never
 * writes `process.env`, never writes a file, never emits on `pi.events`.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createMcpDashboardRegistrar,
  DASHBOARD_MCP_SERVER_NAME,
  type McpDashboardRegistrarDeps,
} from "../mcp-token-delivery.js";

const URL_ = "http://127.0.0.1:8000/mcp";

function makeDeps(overrides: Partial<McpDashboardRegistrarDeps> = {}) {
  const lines: string[] = [];
  const reports: string[] = [];
  const pi = {
    registerMcpServer: vi.fn(),
    unregisterMcpServer: vi.fn(),
    events: { emit: vi.fn() },
  };
  const deps: McpDashboardRegistrarDeps = {
    pi,
    sessionId: () => "sess-1",
    reportUnavailable: (reason) => reports.push(reason),
    log: {
      info: (m: string) => lines.push(m),
      warn: (m: string) => lines.push(m),
      error: (m: string) => lines.push(m),
    },
    ...overrides,
  };
  return { deps, pi, lines, reports };
}

const minted = (token: unknown, url: unknown = URL_) => ({ type: "mcp_token_minted" as const, token, url });

describe("E1 — register after delivery", () => {
  it("registers pi-dashboard once with the delivered url, deferred exposure and a Bearer header", () => {
    const { deps, pi } = makeDeps();
    const r = createMcpDashboardRegistrar(deps);
    r.onMinted(minted("mcp_tok-A"));
    expect(pi.registerMcpServer).toHaveBeenCalledTimes(1);
    expect(pi.registerMcpServer).toHaveBeenCalledWith(DASHBOARD_MCP_SERVER_NAME, {
      url: URL_,
      headers: { Authorization: "Bearer mcp_tok-A" },
      exposure: "deferred",
    });
    expect(DASHBOARD_MCP_SERVER_NAME).toBe("pi-dashboard");
  });

  it("a malformed token registers nothing", () => {
    const { deps, pi } = makeDeps();
    const r = createMcpDashboardRegistrar(deps);
    for (const bad of [undefined, "", 42, null]) r.onMinted(minted(bad));
    expect(pi.registerMcpServer).not.toHaveBeenCalled();
  });
});

describe("E2 — re-mint replaces", () => {
  it("re-registers with the new token and never unregisters in between", () => {
    const { deps, pi } = makeDeps();
    const r = createMcpDashboardRegistrar(deps);
    r.onMinted(minted("mcp_tok-A"));
    r.onMinted(minted("mcp_tok-B"));
    expect(pi.registerMcpServer).toHaveBeenCalledTimes(2);
    expect(pi.registerMcpServer.mock.calls[1][1].headers.Authorization).toBe("Bearer mcp_tok-B");
    expect(pi.unregisterMcpServer).not.toHaveBeenCalled();
  });
});

describe("E3 — session end unregisters", () => {
  it("unregisters exactly once on shutdown and ignores later deliveries", () => {
    const { deps, pi } = makeDeps();
    const r = createMcpDashboardRegistrar(deps);
    r.onMinted(minted("mcp_tok-A"));
    r.onSessionShutdown();
    r.onSessionShutdown();
    expect(pi.unregisterMcpServer).toHaveBeenCalledTimes(1);
    expect(pi.unregisterMcpServer).toHaveBeenCalledWith("pi-dashboard");
    r.onMinted(minted("mcp_tok-C"));
    expect(pi.registerMcpServer).toHaveBeenCalledTimes(1);
  });

  it("a replacement session (session_start after shutdown) registers its own mint again", () => {
    const { deps, pi } = makeDeps();
    const r = createMcpDashboardRegistrar(deps);
    r.onMinted(minted("mcp_tok-A"));
    r.onSessionShutdown();
    r.onSessionStart();
    r.onMinted(minted("mcp_tok-N"));
    expect(pi.registerMcpServer).toHaveBeenCalledTimes(2);
    expect(pi.registerMcpServer.mock.calls[1][1].headers.Authorization).toBe("Bearer mcp_tok-N");
  });

  // review r1 B1: a replacement session must never keep calling /mcp with the
  // previous session's bearer while its own mint is pending (or fails).
  it("session_start without a preceding shutdown unregisters the previous session's registration", () => {
    const { deps, pi } = makeDeps();
    const r = createMcpDashboardRegistrar(deps);
    r.onMinted(minted("mcp_tok-A"));
    r.onSessionStart();
    expect(pi.unregisterMcpServer).toHaveBeenCalledTimes(1);
    expect(pi.unregisterMcpServer).toHaveBeenCalledWith("pi-dashboard");
    r.onSessionStart();
    expect(pi.unregisterMcpServer).toHaveBeenCalledTimes(1);
  });

  it("shutdown before any registration does not unregister", () => {
    const { deps, pi } = makeDeps();
    createMcpDashboardRegistrar(deps).onSessionShutdown();
    expect(pi.unregisterMcpServer).not.toHaveBeenCalled();
  });

  it("a throwing unregister (stale runtime) is swallowed", () => {
    const { deps, pi } = makeDeps();
    pi.unregisterMcpServer.mockImplementation(() => {
      throw new Error("stale");
    });
    const r = createMcpDashboardRegistrar(deps);
    r.onMinted(minted("mcp_tok-A"));
    expect(() => r.onSessionShutdown()).not.toThrow();
  });
});

describe("E4 — token never reaches process.env", () => {
  it("no env key named PI_DASHBOARD_MCP_TOKEN and no env value equals the token", () => {
    const before = process.env.PI_DASHBOARD_MCP_TOKEN;
    delete process.env.PI_DASHBOARD_MCP_TOKEN;
    try {
      const { deps } = makeDeps();
      createMcpDashboardRegistrar(deps).onMinted(minted("mcp_secret-env-probe"));
      expect(process.env.PI_DASHBOARD_MCP_TOKEN).toBeUndefined();
      expect(Object.values(process.env)).not.toContain("mcp_secret-env-probe");
    } finally {
      if (before !== undefined) process.env.PI_DASHBOARD_MCP_TOKEN = before;
    }
  });

  it("log lines and pi.events never carry the credential", () => {
    const { deps, pi, lines } = makeDeps();
    createMcpDashboardRegistrar(deps).onMinted(minted("mcp_secret-value-2"));
    expect(pi.events.emit).not.toHaveBeenCalled();
    expect(lines.length).toBeGreaterThan(0);
    for (const l of lines) expect(l).not.toContain("mcp_secret-value-2");
  });
});

describe("E5 — no mcp.json write on registration", () => {
  let dir: string | undefined;
  const prev = process.env.PI_CODING_AGENT_DIR;
  afterEach(() => {
    if (prev === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = prev;
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("leaves an absent mcp.json absent", () => {
    dir = mkdtempSync(join(tmpdir(), "mcp-reg-"));
    process.env.PI_CODING_AGENT_DIR = dir;
    const { deps } = makeDeps();
    createMcpDashboardRegistrar(deps).onMinted(minted("mcp_tok-A"));
    expect(existsSync(join(dir, "mcp.json"))).toBe(false);
  });

  it("leaves an existing mcp.json byte-identical", () => {
    dir = mkdtempSync(join(tmpdir(), "mcp-reg-"));
    process.env.PI_CODING_AGENT_DIR = dir;
    const file = join(dir, "mcp.json");
    const body = '{\n  "mcpServers": { "docs": { "url": "https://x" } }\n}\n';
    writeFileSync(file, body);
    const { deps } = makeDeps();
    createMcpDashboardRegistrar(deps).onMinted(minted("mcp_tok-A"));
    expect(readFileSync(file, "utf8")).toBe(body);
  });
});

describe("E16 — registration guard", () => {
  it("missing registerMcpServer: no throw, one log line naming the session, one report", () => {
    const { deps, lines, reports } = makeDeps({ pi: {} });
    const r = createMcpDashboardRegistrar(deps);
    expect(() => {
      r.onMinted(minted("mcp_tok-A"));
      r.onMinted(minted("mcp_tok-B"));
    }).not.toThrow();
    expect(reports).toEqual(["api-missing"]);
    const warn = lines.filter((l) => l.includes("unavailable"));
    expect(warn).toHaveLength(1);
    expect(warn[0]).toContain("sess-1");
  });

  it("throwing registerMcpServer: no throw, one report", () => {
    const { deps, pi, reports, lines } = makeDeps();
    pi.registerMcpServer.mockImplementation(() => {
      throw new Error("name taken");
    });
    const r = createMcpDashboardRegistrar(deps);
    expect(() => r.onMinted(minted("mcp_tok-A"))).not.toThrow();
    expect(reports).toEqual(["register-failed"]);
    expect(lines.filter((l) => l.includes("unavailable"))).toHaveLength(1);
  });

  it("a replacement session (session_start) reports its own unavailability", () => {
    const { deps, reports } = makeDeps({ pi: {} });
    const r = createMcpDashboardRegistrar(deps);
    r.onMinted(minted("mcp_tok-A"));
    r.onSessionShutdown();
    r.onSessionStart();
    r.onMinted(minted("mcp_tok-N"));
    expect(reports).toEqual(["api-missing", "api-missing"]);
  });

  it("delivery without a url (older server): no registration, one report", () => {
    const { deps, pi, reports } = makeDeps();
    const r = createMcpDashboardRegistrar(deps);
    r.onMinted({ type: "mcp_token_minted", token: "mcp_tok-A" });
    r.onMinted(minted("mcp_tok-A", ""));
    expect(pi.registerMcpServer).not.toHaveBeenCalled();
    expect(reports).toEqual(["no-url"]);
  });
});
