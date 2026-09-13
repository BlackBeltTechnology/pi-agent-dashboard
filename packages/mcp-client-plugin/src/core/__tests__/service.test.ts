/**
 * `mcp-client.config` service factory (change extract-mcp-client-plugin,
 * task 2.5): write-only isolation, check/write parity, merge-only guarantees.
 */

import { describe, expect, it } from "vitest";
import { createMcpClientConfigService } from "../service.js";
import type { AdapterPort, ConfigIO, ServerEntry } from "../types.js";

const GLOBAL = "/agent/mcp.json";
const SETTINGS = "/agent/settings.json";
const SCRATCH = "/tmp/mcp-scratch";

function makeIO(initial: Record<string, string> = {}): ConfigIO & { files: Map<string, string>; writes: string[] } {
  const files = new Map(Object.entries(initial));
  const writes: string[] = [];
  return {
    files,
    writes,
    readFile: (p) => (files.has(p) ? (files.get(p) as string) : null),
    writeFileAtomic: (p, content) => {
      writes.push(p);
      files.set(p, content);
    },
  };
}

function makePort(loaderThrows = false): AdapterPort {
  return {
    loadMcpConfig: () => {
      if (loaderThrows) throw new Error("loader must not be called");
      return Promise.resolve({ mcpServers: {} });
    },
    getServerProvenance: () => {
      if (loaderThrows) throw new Error("loader must not be called");
      return Promise.resolve(new Map());
    },
    getConfigDiscoveryPaths: () => [],
    getPiGlobalConfigPath: () => GLOBAL,
    getProjectPiConfigPath: (cwd) => `${cwd}/.pi/mcp.json`,
  };
}

function makeService(io: ConfigIO, port: AdapterPort, known: string[] = []) {
  return createMcpClientConfigService({ configIO: io, adapter: port, knownCwds: () => known, scratchCwd: SCRATCH });
}

describe("createMcpClientConfigService", () => {
  it("exposes the adapter verdict through the probe", () => {
    const io = makeIO({ [`${GLOBAL.replace("/mcp.json", "")}/npm/node_modules/pi-mcp-adapter/package.json`]: JSON.stringify({ version: "2.31.0" }) });
    const svc = makeService(io, makePort());
    expect(svc.adapterVerdict()).toMatchObject({ kind: "ok", installed: "2.31.0" });
  });

  it("readServerEntry returns the raw file entry without consulting the loader (E38)", () => {
    const io = makeIO({ [GLOBAL]: JSON.stringify({ mcpServers: { iMCP: { command: "/bin/x", disabled: true } } }) });
    const svc = makeService(io, makePort(true));
    expect(svc.readServerEntry("iMCP", { kind: "global" })).toEqual({ command: "/bin/x", disabled: true });
  });

  it("write-only operations never consult the adapter loaders", () => {
    const io = makeIO({});
    const svc = makeService(io, makePort(true));
    expect(svc.ensureServerEntry("x", { command: "x" }, { kind: "global" }).ok).toBe(true);
    expect(svc.setDirectTools("x", ["t"], { kind: "global" }).ok).toBe(true);
    expect(svc.ensureAdapterPackage().ok).toBe(true);
    expect(svc.checkConfigFiles({ serverName: "x", fields: { command: "y" } }).mcpJson.ok).toBe(true);
  });

  it("check and write agree on a transport conflict (E39)", () => {
    const io = makeIO({ [GLOBAL]: JSON.stringify({ mcpServers: { x: { url: "u" } } }) });
    const svc = makeService(io, makePort());
    const check = svc.checkConfigFiles({ serverName: "x", fields: { command: "/bin/x" } as Partial<ServerEntry> });
    expect(check.mcpJson.ok).toBe(false);
    const write = svc.ensureServerEntry("x", { command: "/bin/x" }, { kind: "global" });
    expect(write.ok === false && write.refusal.code).toBe("transport-conflict");
    expect(io.writes).toHaveLength(0);
  });

  it("checkConfigFiles never writes", () => {
    const io = makeIO({ [GLOBAL]: JSON.stringify({ mcpServers: {} }) });
    const svc = makeService(io, makePort());
    svc.checkConfigFiles({ serverName: "x", fields: { command: "x" } });
    expect(io.writes).toHaveLength(0);
  });

  it("ensureAdapterPackage merges settings.json only", () => {
    const io = makeIO({ [SETTINGS]: JSON.stringify({ packages: ["npm:a"], other: 1 }) });
    const svc = makeService(io, makePort(true));
    expect(svc.ensureAdapterPackage().ok).toBe(true);
    expect(JSON.parse(io.files.get(SETTINGS) as string)).toMatchObject({ packages: ["npm:a", "npm:pi-mcp-adapter"], other: 1 });
  });

  it("ensureServerEntry preserves operator-set fields (E41)", () => {
    const io = makeIO({
      [GLOBAL]: JSON.stringify({ mcpServers: { iMCP: { command: "old", disabled: true, directTools: ["a"], unknown: 1 } } }),
    });
    const svc = makeService(io, makePort(true));
    expect(svc.ensureServerEntry("iMCP", { command: "new" }, { kind: "global" }).ok).toBe(true);
    expect(JSON.parse(io.files.get(GLOBAL) as string).mcpServers.iMCP).toEqual({
      command: "new",
      disabled: true,
      directTools: ["a"],
      unknown: 1,
    });
  });

  it("factory with in-memory IO + a stub port touches no real path", async () => {
    const io = makeIO({ [GLOBAL]: JSON.stringify({ mcpServers: {} }) });
    const svc = makeService(io, makePort());
    const view = await svc.getEffectiveView({ kind: "global" });
    expect(view.cwd).toBe(SCRATCH);
    expect(io.writes).toHaveLength(0);
  });

  it("removeServer returns the removed raw entry", () => {
    const removed = { command: "a", unknownKey: { n: [1] } };
    const io = makeIO({ [GLOBAL]: JSON.stringify({ mcpServers: { a: removed, b: { command: "b" } } }) });
    const svc = makeService(io, makePort(true));
    const r = svc.removeServer("a", { kind: "global" });
    expect(r).toEqual({ ok: true, removed });
    expect(JSON.parse(io.files.get(GLOBAL) as string).mcpServers.b).toEqual({ command: "b" });
  });
});
