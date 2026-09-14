/**
 * Core config-writer contract (change extract-mcp-client-plugin, task 2.1).
 * Injected in-memory ConfigIO + stubbed adapter port → hermetic.
 */

import { describe, expect, it } from "vitest";
import {
  ADAPTER_PACKAGE_SOURCE,
  createConfigWriter,
  isValidServerName,
  validateResultingEntry,
} from "../config-writer.js";
import type { AdapterPort, ConfigIO, ServerEntry } from "../types.js";

const GLOBAL = "/agent/mcp.json";
const SETTINGS = "/agent/settings.json";
const SCRATCH = "/tmp/scratch-empty";

function makeIO(initial: Record<string, string> = {}): ConfigIO & {
  files: Map<string, string>;
  writes: string[];
  mode: Map<string, number>;
} {
  const files = new Map(Object.entries(initial));
  const writes: string[] = [];
  const mode = new Map<string, number>();
  return {
    files,
    writes,
    mode,
    readFile: (p) => (files.has(p) ? (files.get(p) as string) : null),
    writeFileAtomic: (p, content) => {
      writes.push(p);
      files.set(p, content);
      // The real writer always hardens to 0600.
      mode.set(p, 0o600);
    },
  };
}

interface PortOpts {
  globalPath?: string;
  projectPath?: (cwd: string) => string;
  lowerServers?: Record<string, ServerEntry>;
  loaderThrows?: boolean;
}

function makePort(opts: PortOpts = {}): AdapterPort & { loadCalls: Array<{ override?: string; cwd: string }> } {
  const loadCalls: Array<{ override?: string; cwd: string }> = [];
  const globalPath = opts.globalPath ?? GLOBAL;
  return {
    loadCalls,
    loadMcpConfig: (override, cwd) => {
      loadCalls.push({ override, cwd });
      if (opts.loaderThrows) throw new Error("adapter must not be consulted");
      return Promise.resolve({ mcpServers: opts.lowerServers ?? {} });
    },
    getServerProvenance: () => {
      if (opts.loaderThrows) throw new Error("adapter must not be consulted");
      return Promise.resolve(new Map());
    },
    getConfigDiscoveryPaths: () => [],
    getPiGlobalConfigPath: () => globalPath,
    getProjectPiConfigPath: (cwd) => (opts.projectPath ? opts.projectPath(cwd) : `${cwd}/.pi/mcp.json`),
  };
}

function makeWriter(io: ConfigIO, port: AdapterPort, known: string[] = []) {
  return createConfigWriter({ configIO: io, adapter: port, knownCwds: () => known, scratchCwd: SCRATCH });
}

describe("isValidServerName", () => {
  it("accepts 1 and 128 chars, spaces, and unicode", () => {
    expect(isValidServerName("a")).toBe(true);
    expect(isValidServerName("a".repeat(128))).toBe(true);
    expect(isValidServerName("my server")).toBe(true);
    expect(isValidServerName("✓")).toBe(true);
  });
  it("rejects 0/129 chars, separators, control chars, dot names, prototype keys", () => {
    for (const bad of ["", "a".repeat(129), "a/b", "a\\b", "a\u0007b", ".", "..", "__proto__", "constructor", "prototype"]) {
      expect(isValidServerName(bad), bad).toBe(false);
    }
  });
});

describe("validateResultingEntry", () => {
  it("accepts 0 or 1 transport and rejects 2+ naming every present transport", () => {
    expect(validateResultingEntry({ command: "x" })).toBeNull();
    expect(validateResultingEntry({})).toBeNull();
    const r = validateResultingEntry({ command: "x", url: "u" });
    expect(r?.code).toBe("transport-conflict");
    expect(r?.fields?.sort()).toEqual(["command", "url"]);
  });
});

describe("config writer — merge-only patches", () => {
  it("preserves siblings and unknown keys through a set+unset patch", () => {
    const io = makeIO({
      [GLOBAL]: JSON.stringify({
        $schema: "x",
        unknownTop: { k: 1 },
        mcpServers: { a: { command: "a", weird: [1] }, b: { command: "b" } },
      }),
    });
    const w = makeWriter(io, makePort());
    const res = w.ensureServerEntry("x", {}, { kind: "global" });
    expect(res.ok).toBe(true);
    const out = JSON.parse(io.files.get(GLOBAL) as string);
    expect(out.$schema).toBe("x");
    expect(out.unknownTop).toEqual({ k: 1 });
    expect(out.mcpServers.b).toEqual({ command: "b" });
  });

  it("applies set and unset to exactly one entry", () => {
    const io = makeIO({
      [GLOBAL]: JSON.stringify({ mcpServers: { a: { command: "a", weird: [1] } } }),
    });
    const w = makeWriter(io, makePort());
    const r = w.ensureServerEntry("a", { args: ["1"] } as never, { kind: "global" });
    expect(r.ok).toBe(true);
    // unset path via removeServer's patch semantics is covered elsewhere; assert set applied:
    expect(JSON.parse(io.files.get(GLOBAL) as string).mcpServers.a).toEqual({ command: "a", weird: [1], args: ["1"] });
  });

  it("parses JSONC comments and trailing commas", () => {
    const io = makeIO({
      [GLOBAL]: `{ /* c */ "mcpServers": { "a": { "command": "a", }, }, }`,
    });
    const w = makeWriter(io, makePort());
    expect(w.readServerEntry("a", { kind: "global" })).toEqual({ ok: true, entry: { command: "a" } });
    expect(w.ensureServerEntry("b", { command: "b" } as never, { kind: "global" }).ok).toBe(true);
    const out = JSON.parse(io.files.get(GLOBAL) as string);
    expect(out.mcpServers.a).toEqual({ command: "a" });
    expect(out.mcpServers.b).toEqual({ command: "b" });
  });

  it("preserves the mcp-servers alias and never adds mcpServers", () => {
    const io = makeIO({ [GLOBAL]: JSON.stringify({ "mcp-servers": { a: { command: "a" } } }) });
    const w = makeWriter(io, makePort());
    w.ensureServerEntry("b", { command: "b" } as never, { kind: "global" });
    const out = JSON.parse(io.files.get(GLOBAL) as string);
    expect(out["mcp-servers"].b).toEqual({ command: "b" });
    expect(out.mcpServers).toBeUndefined();
  });

  it("writes under mcpServers when both keys exist, leaving the alias byte-identical", () => {
    const alias = { z: { command: "z" } };
    const io = makeIO({
      [GLOBAL]: JSON.stringify({ mcpServers: { a: { command: "a" } }, "mcp-servers": alias }),
    });
    const w = makeWriter(io, makePort());
    w.ensureServerEntry("b", { command: "b" } as never, { kind: "global" });
    const out = JSON.parse(io.files.get(GLOBAL) as string);
    expect(out.mcpServers.b).toEqual({ command: "b" });
    expect(out["mcp-servers"]).toEqual(alias);
  });

  it("refuses an unparseable target byte-identically", () => {
    const raw = `{ "mcpServers": `;
    const io = makeIO({ [GLOBAL]: raw });
    const w = makeWriter(io, makePort());
    const r = w.ensureServerEntry("a", { command: "a" } as never, { kind: "global" });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.refusal.code).toBe("unparseable");
    expect(io.files.get(GLOBAL)).toBe(raw);
    expect(io.writes).toHaveLength(0);
  });

  it("refuses a non-object existing entry byte-identically", () => {
    const raw = JSON.stringify({ mcpServers: { a: "string" } });
    const io = makeIO({ [GLOBAL]: raw });
    const w = makeWriter(io, makePort());
    const r = w.ensureServerEntry("a", { command: "a" } as never, { kind: "global" });
    expect(r.ok === false && r.refusal.code).toBe("entry-not-object");
    expect(io.files.get(GLOBAL)).toBe(raw);
  });

  it("refuses prototype names and invalid names with no IO", () => {
    const io = makeIO({ [GLOBAL]: JSON.stringify({ mcpServers: {} }) });
    const w = makeWriter(io, makePort());
    for (const bad of ["__proto__", "constructor", "prototype", "a/b", "."]) {
      const r = w.ensureServerEntry(bad, { command: "x" } as never, { kind: "global" });
      expect(r.ok === false && r.refusal.code, bad).toBe("invalid-name");
    }
    expect(io.writes).toHaveLength(0);
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });

  it("remove returns the removed raw entry and deletes only that key", () => {
    const removed = { command: "a", unknownKey: { n: [1] }, "weird key": true };
    const io = makeIO({ [GLOBAL]: JSON.stringify({ mcpServers: { a: removed, b: { command: "b" } } }) });
    const w = makeWriter(io, makePort());
    const r = w.removeServer("a", { kind: "global" });
    expect(r).toEqual({ ok: true, removed });
    const out = JSON.parse(io.files.get(GLOBAL) as string);
    expect(out.mcpServers.a).toBeUndefined();
    expect(out.mcpServers.b).toEqual({ command: "b" });
  });

  it("does not rewrite on a no-op patch", () => {
    const io = makeIO({ [GLOBAL]: JSON.stringify({ mcpServers: { a: { command: "a" } } }) });
    const w = makeWriter(io, makePort());
    expect(w.ensureServerEntry("a", { command: "a" } as never, { kind: "global" }).ok).toBe(true);
    expect(io.writes).toHaveLength(0);
  });

  it("reports write-failed with the IO code and leaves the file byte-identical", () => {
    const raw = JSON.stringify({ mcpServers: {} });
    const io = makeIO({ [GLOBAL]: raw });
    io.writeFileAtomic = () => {
      const e = new Error("denied") as NodeJS.ErrnoException;
      e.code = "EACCES";
      throw e;
    };
    const w = makeWriter(io, makePort());
    const r = w.ensureServerEntry("a", { command: "a" } as never, { kind: "global" });
    expect(r.ok === false && r.refusal.code).toBe("write-failed");
    expect(r.ok === false && r.refusal.ioCode).toBe("EACCES");
    expect(io.files.get(GLOBAL)).toBe(raw);
  });
});

describe("config writer — disabled semantics", () => {
  it("disable writes disabled:true", async () => {
    const io = makeIO({ [GLOBAL]: JSON.stringify({ mcpServers: { a: { command: "a" } } }) });
    const w = makeWriter(io, makePort());
    const r = await w.setServerDisabled("a", true, { kind: "global" });
    expect(r.ok).toBe(true);
    expect(JSON.parse(io.files.get(GLOBAL) as string).mcpServers.a).toEqual({ command: "a", disabled: true });
  });

  it("enable removes the key when no lower layer disables", async () => {
    const io = makeIO({ [GLOBAL]: JSON.stringify({ mcpServers: { a: { command: "a", disabled: true } } }) });
    const port = makePort({ lowerServers: {} });
    const w = makeWriter(io, port);
    const r = await w.setServerDisabled("a", false, { kind: "global" });
    expect(r.ok).toBe(true);
    expect(JSON.parse(io.files.get(GLOBAL) as string).mcpServers.a).toEqual({ command: "a" });
    expect(io.writes).toHaveLength(1);
  });

  it("deletes the entry entirely when enable empties it", async () => {
    const io = makeIO({ [GLOBAL]: JSON.stringify({ mcpServers: { a: { disabled: true }, b: { command: "b" } } }) });
    const w = makeWriter(io, makePort({ lowerServers: {} }));
    await w.setServerDisabled("a", false, { kind: "global" });
    const out = JSON.parse(io.files.get(GLOBAL) as string);
    expect(out.mcpServers.a).toBeUndefined();
    expect(out.mcpServers.b).toEqual({ command: "b" });
  });

  it("enable writes disabled:false when a lower layer still disables", async () => {
    const io = makeIO({ [GLOBAL]: JSON.stringify({ mcpServers: { a: { command: "a", disabled: true } } }) });
    const port = makePort({ lowerServers: { a: { command: "a", disabled: true } } });
    const w = makeWriter(io, port);
    const r = await w.setServerDisabled("a", false, { kind: "global" });
    expect(r.ok).toBe(true);
    expect(JSON.parse(io.files.get(GLOBAL) as string).mcpServers.a).toEqual({ command: "a", disabled: false });
    expect(io.writes).toHaveLength(2);
    // Global lower merge excludes the Pi-global layer via an override path in scratch.
    expect(port.loadCalls[0]).toEqual({ override: `${SCRATCH}/mcp.json`, cwd: SCRATCH });
  });

  it("project-scope enable merges with the project cwd (no override)", async () => {
    const cwd = "/known";
    const io = makeIO({ [`${cwd}/.pi/mcp.json`]: JSON.stringify({ mcpServers: { a: { command: "a", disabled: true } } }) });
    const port = makePort({ lowerServers: {} });
    const w = makeWriter(io, port, [cwd]);
    await w.setServerDisabled("a", false, { kind: "project", cwd });
    expect(port.loadCalls[0]).toEqual({ override: undefined, cwd });
  });

  it("propagates a merge timeout after the removal write has landed", async () => {
    const io = makeIO({ [GLOBAL]: JSON.stringify({ mcpServers: { a: { command: "a", disabled: true } } }) });
    const port = makePort();
    port.loadMcpConfig = () => Promise.reject(new Error("adapter-timeout"));
    const w = makeWriter(io, port);
    await expect(w.setServerDisabled("a", false, { kind: "global" })).rejects.toThrow("adapter-timeout");
    expect(JSON.parse(io.files.get(GLOBAL) as string).mcpServers.a).toEqual({ command: "a" });
    expect(io.writes).toHaveLength(1);
  });
});

describe("config writer — paths, admission, write-only isolation", () => {
  it("lands writes at the port-provided paths", () => {
    const io = makeIO({});
    const w = makeWriter(io, makePort({ globalPath: "/custom/agent/mcp.json" }));
    w.ensureServerEntry("a", { command: "a" } as never, { kind: "global" });
    expect(io.files.has("/custom/agent/mcp.json")).toBe(true);
  });

  it("refuses a project write for an unknown cwd with no IO", () => {
    const io = makeIO({});
    const w = makeWriter(io, makePort(), ["/known"]);
    const r = w.ensureServerEntry("a", { command: "a" } as never, { kind: "project", cwd: "/other" });
    expect(r.ok === false && r.refusal.code).toBe("not-allowed");
    expect(io.writes).toHaveLength(0);
    expect(io.files.size).toBe(0);
  });

  it("admits a project write for a known cwd", () => {
    const cwd = "/known";
    const io = makeIO({});
    const w = makeWriter(io, makePort(), [cwd]);
    const r = w.ensureServerEntry("a", { command: "a" } as never, { kind: "project", cwd });
    expect(r.ok).toBe(true);
    expect(io.files.has(`${cwd}/.pi/mcp.json`)).toBe(true);
  });

  it("write-only operations never consult the adapter loaders", () => {
    const io = makeIO({});
    const w = makeWriter(io, makePort({ loaderThrows: true }));
    expect(w.ensureServerEntry("a", { command: "a" } as never, { kind: "global" }).ok).toBe(true);
    expect(w.setDirectTools("a", ["t"], { kind: "global" }).ok).toBe(true);
    expect(w.removeServer("a", { kind: "global" }).ok).toBe(true);
    expect(w.ensureAdapterPackage().ok).toBe(true);
    expect(w.readServerEntry("a", { kind: "global" }).ok).toBe(true);
  });
});

describe("config writer — settings + adapter package", () => {
  it("merges only the changed settings keys and unset deletes a key", () => {
    const io = makeIO({
      [GLOBAL]: JSON.stringify({ settings: { a: 1, b: 2 }, mcpServers: { x: { command: "x" } }, other: 1 }),
    });
    const w = makeWriter(io, makePort());
    const r = w.patchSettings({ a: 9 } as never, ["b"]);
    expect(r.ok).toBe(true);
    const out = JSON.parse(io.files.get(GLOBAL) as string);
    expect(out.settings).toEqual({ a: 9 });
    expect(out.mcpServers).toEqual({ x: { command: "x" } });
    expect(out.other).toBe(1);
  });

  it("ensureAdapterPackage merges-only and honours settings.json beside the global mcp.json", () => {
    const io = makeIO({ [SETTINGS]: JSON.stringify({ packages: ["npm:a"], other: { x: 1 } }) });
    const w = makeWriter(io, makePort());
    expect(w.ensureAdapterPackage().ok).toBe(true);
    const out = JSON.parse(io.files.get(SETTINGS) as string);
    expect(out.packages).toEqual(["npm:a", ADAPTER_PACKAGE_SOURCE]);
    expect(out.other).toEqual({ x: 1 });
  });

  it("ensureAdapterPackage is a no-op when the adapter is already listed", () => {
    const io = makeIO({ [SETTINGS]: JSON.stringify({ packages: [ADAPTER_PACKAGE_SOURCE] }) });
    const w = makeWriter(io, makePort());
    expect(w.ensureAdapterPackage().ok).toBe(true);
    expect(io.writes).toHaveLength(0);
  });

  it("readParseStatus never writes", () => {
    const io = makeIO({ [GLOBAL]: `{ bad` });
    const w = makeWriter(io, makePort());
    const s = w.readParseStatus(GLOBAL);
    expect(s.ok).toBe(false);
    expect(io.writes).toHaveLength(0);
  });
});
