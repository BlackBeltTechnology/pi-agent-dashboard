/**
 * Effective-view reader contract (change extract-mcp-client-plugin, task 2.2):
 * provenance classification, server-side redaction, settings sources, and
 * unparseable-layer reporting.
 */

import { describe, expect, it } from "vitest";
import { createEffectiveViewReader, isSecretKey } from "../effective-view.js";
import type { AdapterPort, ConfigDiscoveryPath, ConfigIO, McpConfig, Scope, ServerEntry } from "../types.js";

const GLOBAL = "/agent/mcp.json";
const CWD = "/known";
const FOLDER = "/known/.pi/mcp.json";
const SHARED = "/known/.mcp.json";
const AGENTS = "/home/.agents/mcp.json";
const SCRATCH = "/tmp/scratch-empty";

function makeIO(files: Record<string, string>): ConfigIO & { reads: string[] } {
  const reads: string[] = [];
  return {
    reads,
    readFile: (p) => {
      reads.push(p);
      return p in files ? files[p] : null;
    },
    writeFileAtomic: () => {
      throw new Error("view must never write");
    },
  };
}

interface PortOpts {
  discovered: ConfigDiscoveryPath[];
  merged?: McpConfig;
  prov?: Array<[string, { path: string; kind: "user" | "project" | "import"; importKind?: string }]>;
  cwdSeen?: string[];
}

function makePort(opts: PortOpts): AdapterPort {
  return {
    loadMcpConfig: (_override, cwd) => {
      opts.cwdSeen?.push(cwd);
      return Promise.resolve(opts.merged ?? { mcpServers: {} });
    },
    getServerProvenance: () => Promise.resolve(new Map(opts.prov ?? [])),
    getConfigDiscoveryPaths: () => opts.discovered,
    getPiGlobalConfigPath: () => GLOBAL,
    getProjectPiConfigPath: (cwd) => `${cwd}/.pi/mcp.json`,
  };
}

function d(path: string, label = path): ConfigDiscoveryPath {
  return { path, label, exists: true };
}

function reader(io: ConfigIO, port: AdapterPort) {
  return createEffectiveViewReader({ configIO: io, adapter: port, scratchCwd: SCRATCH });
}

const GLOBAL_SCOPE: Scope = { kind: "global" };
const PROJECT_SCOPE: Scope = { kind: "project", cwd: CWD };

describe("isSecretKey", () => {
  it("flags credential-named keys and not plain ones", () => {
    expect(isSecretKey("Authorization")).toBe(true);
    expect(isSecretKey("API_KEY")).toBe(true);
    expect(isSecretKey("X_SECRET")).toBe(true);
    expect(isSecretKey("Accept")).toBe(false);
    expect(isSecretKey("PATH")).toBe(false);
  });
});

describe("effective view — provenance classification", () => {
  it("classifies pi-global / pi-folder / shared / import / other", async () => {
    const io = makeIO({
      [GLOBAL]: JSON.stringify({ mcpServers: { g: { command: "g" } } }),
      [FOLDER]: JSON.stringify({ mcpServers: { f: { command: "f" } } }),
      [SHARED]: JSON.stringify({ mcpServers: { s: { command: "s" } } }),
      [AGENTS]: JSON.stringify({ mcpServers: { i: { command: "i" } } }),
    });
    const port = makePort({
      discovered: [d(FOLDER), d(SHARED), d(GLOBAL), d(AGENTS)],
      merged: { mcpServers: { g: { command: "g" }, f: { command: "f" }, s: { command: "s" }, i: { command: "i" }, o: { command: "o" } } },
      prov: [["i", { path: GLOBAL, kind: "import", importKind: "claude-code" }]],
    });
    const view = await reader(io, port).getEffectiveView(PROJECT_SCOPE, { timeoutMs: 1000 });
    const byName = Object.fromEntries(view.servers.map((s) => [s.name, s.provenance]));

    expect(byName.g[0]).toMatchObject({ layer: "pi-global", writable: true });
    expect(byName.f[0]).toMatchObject({ layer: "pi-folder", writable: true });
    expect(byName.s[0]).toMatchObject({ layer: "shared", writable: false });
    expect(byName.i[0]).toMatchObject({ layer: "shared", writable: false, importKind: "claude-code" });
    expect(byName.o[0]).toMatchObject({ layer: "other", writable: false });
  });

  it("reports every defining layer in precedence order", async () => {
    const io = makeIO({
      [GLOBAL]: JSON.stringify({ mcpServers: { x: { command: "g" } } }),
      [FOLDER]: JSON.stringify({ mcpServers: { x: { command: "f" } } }),
      [SHARED]: JSON.stringify({ mcpServers: { x: { command: "s" } } }),
    });
    const port = makePort({
      discovered: [d(FOLDER), d(SHARED), d(GLOBAL)],
      merged: { mcpServers: { x: { command: "f" } } },
    });
    const view = await reader(io, port).getEffectiveView(PROJECT_SCOPE, { timeoutMs: 1000 });
    const x = view.servers.find((s) => s.name === "x");
    expect(x?.provenance.map((p) => p.layer)).toEqual(["pi-folder", "shared", "pi-global"]);
    expect(x?.entry).toEqual({ command: "f" });
  });

  it("reports an unparseable layer but still returns other layers' servers", async () => {
    const io = makeIO({
      [GLOBAL]: JSON.stringify({ mcpServers: { g: { command: "g" } } }),
      [FOLDER]: JSON.stringify({ mcpServers: { f: { command: "f" } } }),
      [SHARED]: `{ truncated`,
    });
    const port = makePort({
      discovered: [d(FOLDER), d(SHARED), d(GLOBAL)],
      merged: { mcpServers: { g: { command: "g" }, f: { command: "f" } } },
    });
    const view = await reader(io, port).getEffectiveView(PROJECT_SCOPE, { timeoutMs: 1000 });
    expect(view.layerErrors).toHaveLength(1);
    expect(view.layerErrors[0].path).toBe(SHARED);
    expect(view.servers.map((s) => s.name).sort()).toEqual(["f", "g"]);
  });
});

describe("effective view — secret redaction", () => {
  const enriched: ServerEntry = {
    url: "https://x",
    bearerToken: "TOKEN",
    headers: { Authorization: "Bearer SECRET", Accept: "application/json" },
    env: { API_KEY: "k", PATH: "/usr/bin" },
    requestHeadersCommand: { command: "/bin/sign", env: { X_SECRET: "s" } },
    oauth: { clientSecret: "cs" },
  };

  it("redacts secrets inherited from a shared layer with key-name markers", async () => {
    const io = makeIO({ [SHARED]: JSON.stringify({ mcpServers: { x: enriched } }) });
    const port = makePort({ discovered: [d(SHARED)], merged: { mcpServers: { x: enriched } } });
    const view = await reader(io, port).getEffectiveView(GLOBAL_SCOPE, { timeoutMs: 1000 });
    const x = view.servers.find((s) => s.name === "x") as { entry: Record<string, unknown> };
    expect(x.entry.bearerToken).toEqual({ redacted: true });
    expect((x.entry.oauth as Record<string, unknown>).clientSecret).toEqual({ redacted: true });
    expect(x.entry.headers).toMatchObject({ redacted: true });
    const headers = x.entry.headers as { keys: Array<{ name: string; secret: boolean }> };
    expect(headers.keys).toEqual([
      { name: "Authorization", secret: true },
      { name: "Accept", secret: false },
    ]);
    const env = (x.entry.env as { keys: Array<{ name: string; secret: boolean }> }).keys;
    expect(env).toEqual([
      { name: "API_KEY", secret: true },
      { name: "PATH", secret: false },
    ]);
    expect(JSON.stringify(view)).not.toContain("TOKEN");
    expect(JSON.stringify(view)).not.toContain("Bearer SECRET");
    expect(JSON.stringify(view)).not.toContain("cs");
  });

  it("leaves own-layer secrets intact", async () => {
    const io = makeIO({ [GLOBAL]: JSON.stringify({ mcpServers: { x: enriched } }) });
    const port = makePort({ discovered: [d(GLOBAL)], merged: { mcpServers: { x: enriched } } });
    const view = await reader(io, port).getEffectiveView(GLOBAL_SCOPE, { timeoutMs: 1000 });
    const x = view.servers.find((s) => s.name === "x") as { entry: Record<string, unknown> };
    expect(x.entry.bearerToken).toBe("TOKEN");
    expect(x.entry.headers).toMatchObject({ Authorization: "Bearer SECRET" });
  });

  it("redacts a secret defined in Pi-global when viewed at project scope", async () => {
    const io = makeIO({ [GLOBAL]: JSON.stringify({ mcpServers: { x: enriched } }) });
    const port = makePort({ discovered: [d(GLOBAL)], merged: { mcpServers: { x: enriched } } });
    const view = await reader(io, port).getEffectiveView(PROJECT_SCOPE, { timeoutMs: 1000 });
    const x = view.servers.find((s) => s.name === "x") as { entry: Record<string, unknown> };
    expect(x.entry.bearerToken).toEqual({ redacted: true });
  });
});

describe("effective view — global scope isolation + settings", () => {
  it("uses the scratch cwd for a global view and no project layers", async () => {
    const cwdSeen: string[] = [];
    const io = makeIO({});
    const port = makePort({ discovered: [], merged: { mcpServers: {} }, cwdSeen });
    await reader(io, port).getEffectiveView(GLOBAL_SCOPE, { timeoutMs: 1000 });
    expect(cwdSeen).toEqual([SCRATCH]);
  });

  it("reports each settings key's source layer or default", async () => {
    const io = makeIO({
      [GLOBAL]: JSON.stringify({ mcpServers: {}, settings: { toolPrefix: "mcp", idleTimeout: 5 } }),
      [SHARED]: JSON.stringify({ mcpServers: {}, settings: { idleTimeout: 9, requestTimeoutMs: 20 } }),
    });
    const port = makePort({
      discovered: [d(SHARED), d(GLOBAL)],
      merged: { mcpServers: {}, settings: { toolPrefix: "mcp", idleTimeout: 5, requestTimeoutMs: 20, directTools: true } as never },
    });
    const view = await reader(io, port).getEffectiveView(GLOBAL_SCOPE, { timeoutMs: 1000 });
    expect(view.settings.toolPrefix).toMatchObject({ source: "pi-global" });
    expect(view.settings.idleTimeout).toMatchObject({ source: "pi-global" });
    expect(view.settings.requestTimeoutMs).toMatchObject({ source: "shared", path: SHARED });
    expect(view.settings.directTools).toMatchObject({ source: "default" });
  });
});
