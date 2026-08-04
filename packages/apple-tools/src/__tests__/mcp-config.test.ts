/**
 * Config-writer tests (group 5): merge-only, atomic, abort-on-unparseable,
 * cross-kind dedup, no credential leakage. Plus installer-level idempotency
 * and CLI/server store isolation.
 *
 * See change: add-apple-tools-imcp-plugin.
 */
import { describe, expect, it } from "vitest";
import { type InstallerEnv, runInstaller } from "../install.js";
import {
  ADAPTER_PACKAGE_SOURCE,
  type ConfigIO,
  ensureAdapterPackage,
  ensureMcpEntry,
  readImcpEntry,
  setDirectTools,
  setServerDisabled,
} from "../mcp-config.js";

const SERVER = "/Applications/iMCP.app/Contents/MacOS/imcp-server";
const MCP = "/cfg/mcp.json";
const SETTINGS = "/cfg/settings.json";

function memIO(files: Record<string, string> = {}): ConfigIO & {
  writes: string[];
  store: Record<string, string>;
} {
  const store = { ...files };
  const writes: string[] = [];
  return {
    store,
    writes,
    readFile: (p) => (p in store ? store[p] : null),
    writeFileAtomic: (p, c) => {
      store[p] = c;
      writes.push(p);
    },
  };
}

describe("ensureMcpEntry", () => {
  it("#X6: preserves unrelated servers + unknown top-level keys", () => {
    const io = memIO({
      [MCP]: JSON.stringify({
        mcpServers: { other: { command: "keepme" } },
        weirdTopLevel: 42,
      }),
    });
    const r = ensureMcpEntry(io, MCP, SERVER);
    expect(r.ok).toBe(true);
    const written = JSON.parse(io.store[MCP]);
    expect(written.mcpServers.other).toEqual({ command: "keepme" });
    expect(written.weirdTopLevel).toBe(42);
    expect(written.mcpServers.iMCP).toEqual({ command: SERVER });
  });

  it("#X7: unparseable mcp.json → CONFIG_UNPARSEABLE, original byte-identical", () => {
    const original = "{ this is : not json";
    const io = memIO({ [MCP]: original });
    const r = ensureMcpEntry(io, MCP, SERVER);
    expect(r).toMatchObject({ ok: false, state: "CONFIG_UNPARSEABLE" });
    expect(io.writes).toEqual([]);
    expect(io.store[MCP]).toBe(original);
  });

  it("#X12: EACCES on write → CONFIG_WRITE_FAILED (not UNPARSEABLE), original intact", () => {
    const io: ConfigIO = {
      readFile: () => JSON.stringify({ mcpServers: {} }),
      writeFileAtomic: () => {
        const e = new Error("EACCES: permission denied") as Error & { code: string };
        e.code = "EACCES";
        throw e;
      },
    };
    const r = ensureMcpEntry(io, MCP, SERVER);
    expect(r).toMatchObject({ ok: false, state: "CONFIG_WRITE_FAILED" });
  });

  it("#X13: ENOSPC on write → CONFIG_WRITE_FAILED", () => {
    const io: ConfigIO = {
      readFile: () => null,
      writeFileAtomic: () => {
        const e = new Error("ENOSPC: no space") as Error & { code: string };
        e.code = "ENOSPC";
        throw e;
      },
    };
    const r = ensureMcpEntry(io, MCP, SERVER);
    expect(r).toMatchObject({ ok: false, state: "CONFIG_WRITE_FAILED" });
  });

  it("#X14: never copies a secret from a sibling config layer", () => {
    // The writer only ever reads the target file; a secret in some other layer
    // is unreachable. Assert the written file contains only our merge.
    const io = memIO({ [MCP]: JSON.stringify({ mcpServers: { other: { command: "x", env: { API_KEY: "secret" } } } }) });
    ensureMcpEntry(io, MCP, SERVER);
    const written = io.store[MCP];
    // the pre-existing sibling's secret is preserved verbatim (not copied INTO iMCP)
    expect(JSON.parse(written).mcpServers.iMCP.env).toBeUndefined();
    expect(JSON.parse(written).mcpServers.iMCP).toEqual({ command: SERVER });
  });

  it("#X3/#X9: a metacharacter path is written as JSON data, never a shell string", () => {
    const evil = "/Applications/iMCP.app/Contents/MacOS/imcp-server; rm -rf /";
    const io = memIO();
    ensureMcpEntry(io, MCP, evil);
    const written = JSON.parse(io.store[MCP]);
    expect(written.mcpServers.iMCP.command).toBe(evil); // opaque data, byte-preserved
  });
});

describe("ensureAdapterPackage", () => {
  it("#X8: unparseable settings.json → CONFIG_UNPARSEABLE, original byte-identical", () => {
    const original = "not json at all {{{";
    const io = memIO({ [SETTINGS]: original });
    const r = ensureAdapterPackage(io, SETTINGS);
    expect(r).toMatchObject({ ok: false, state: "CONFIG_UNPARSEABLE" });
    expect(io.store[SETTINGS]).toBe(original);
  });

  it("#E28: appends without reordering 23 pre-existing entries", () => {
    const existing = Array.from({ length: 23 }, (_, i) => `npm:pkg-${i}`);
    const io = memIO({ [SETTINGS]: JSON.stringify({ packages: existing }) });
    ensureAdapterPackage(io, SETTINGS);
    const written = JSON.parse(io.store[SETTINGS]).packages;
    expect(written.slice(0, 23)).toEqual(existing);
    expect(written[23]).toBe(ADAPTER_PACKAGE_SOURCE);
  });

  it("#E29: a git-sourced adapter suppresses the npm duplicate (sourcesMatch)", () => {
    const io = memIO({
      [SETTINGS]: JSON.stringify({
        packages: ["git:github.com/somebody/pi-mcp-adapter#main"],
      }),
    });
    const r = ensureAdapterPackage(io, SETTINGS);
    expect(r.ok).toBe(true);
    expect(io.writes).toEqual([]); // already present cross-kind → no append
  });

  it("appends when absent", () => {
    const io = memIO({ [SETTINGS]: JSON.stringify({ packages: [] }) });
    ensureAdapterPackage(io, SETTINGS);
    expect(JSON.parse(io.store[SETTINGS]).packages).toEqual([ADAPTER_PACKAGE_SOURCE]);
  });
});

function makeEnv(io: ConfigIO, overrides: Partial<InstallerEnv> = {}): InstallerEnv {
  return {
    platform: "darwin",
    homedir: "/home/tester",
    probeOsVersion: () => "15.3",
    pathExists: (p) => p === SERVER,
    brewPath: () => "/x/brew",
    runBrewCask: () => ({ code: 0, stderr: "" }),
    mcpJsonPath: MCP,
    settingsJsonPath: SETTINGS,
    configIO: io,
    ...overrides,
  };
}

describe("malformed-but-parseable config is refused, never coerced (security pass)", () => {
  it("mcpServers present but an array → CONFIG_UNPARSEABLE, no write", () => {
    const io = memIO({ [MCP]: JSON.stringify({ mcpServers: ["nope"] }) });
    const r = ensureMcpEntry(io, MCP, SERVER);
    expect(r).toMatchObject({ ok: false, state: "CONFIG_UNPARSEABLE" });
    expect(io.writes).toEqual([]);
  });

  it("packages present but an object → CONFIG_UNPARSEABLE, no write", () => {
    const io = memIO({ [SETTINGS]: JSON.stringify({ packages: { a: 1 } }) });
    const r = ensureAdapterPackage(io, SETTINGS);
    expect(r).toMatchObject({ ok: false, state: "CONFIG_UNPARSEABLE" });
    expect(io.writes).toEqual([]);
  });
});

describe("setServerDisabled — pi-mcp-adapter contract (task 7.8, verified v2.19.0)", () => {
  const PROJECT_MCP = "/proj/.pi/mcp.json";

  it("#F10: disabling writes `disabled: true` to the project-local file only", () => {
    const io = memIO();
    const r = setServerDisabled(io, PROJECT_MCP, true);
    expect(r.ok).toBe(true);
    expect(io.writes).toEqual([PROJECT_MCP]);
    expect(JSON.parse(io.store[PROJECT_MCP]).mcpServers.iMCP).toEqual({ disabled: true });
  });

  it("#F10: the lower-layer ~/.pi/agent/mcp.json command entry is untouched", () => {
    const agentMcp = JSON.stringify({ mcpServers: { iMCP: { command: SERVER } } });
    const io = memIO({ [MCP]: agentMcp });
    setServerDisabled(io, PROJECT_MCP, true);
    expect(io.store[MCP]).toBe(agentMcp); // byte-identical
  });

  it("enabling REMOVES the key rather than writing false (adapter parity)", () => {
    // pi-mcp-adapter's writeProjectServerDisabledOverride deletes the field on
    // enable; isServerDisabled treats only a literal `true` as disabled.
    const io = memIO({
      [PROJECT_MCP]: JSON.stringify({ mcpServers: { iMCP: { disabled: true } } }),
    });
    setServerDisabled(io, PROJECT_MCP, false);
    expect(JSON.parse(io.store[PROJECT_MCP]).mcpServers.iMCP).toEqual({});
  });

  it("supports BOTH levels: global ~/.pi/agent/mcp.json and project .pi/mcp.json", () => {
    // Global level — the same layer the installer writes `command` to.
    const globalIO = memIO({
      [MCP]: JSON.stringify({ mcpServers: { iMCP: { command: SERVER } } }),
    });
    expect(setServerDisabled(globalIO, MCP, true).ok).toBe(true);
    const globalEntry = JSON.parse(globalIO.store[MCP]).mcpServers.iMCP;
    // merge-only: `command` survives alongside the new flag
    expect(globalEntry).toEqual({ command: SERVER, disabled: true });

    // Project level — highest-precedence override, separate file.
    const projIO = memIO();
    expect(setServerDisabled(projIO, PROJECT_MCP, true).ok).toBe(true);
    expect(JSON.parse(projIO.store[PROJECT_MCP]).mcpServers.iMCP).toEqual({ disabled: true });
  });

  it("readImcpEntry reports the effective flags (literal true only)", () => {
    const io = memIO({
      [MCP]: JSON.stringify({
        mcpServers: { iMCP: { command: SERVER, disabled: true, directTools: ["calendar"] } },
      }),
    });
    expect(readImcpEntry(io, MCP)).toEqual({ disabled: true, directTools: ["calendar"] });

    // A non-literal-true value must NOT read as disabled (adapter parity).
    const io2 = memIO({
      [MCP]: JSON.stringify({ mcpServers: { iMCP: { disabled: "true" } } }),
    });
    expect(readImcpEntry(io2, MCP).disabled).toBe(false);

    // Absent file / absent entry degrade to defaults, never throw.
    expect(readImcpEntry(memIO(), MCP)).toEqual({ disabled: false, directTools: [] });
  });

  it("preserves sibling servers and unrelated keys on the override file", () => {
    const io = memIO({
      [PROJECT_MCP]: JSON.stringify({ mcpServers: { other: { disabled: true } }, extra: 1 }),
    });
    setServerDisabled(io, PROJECT_MCP, true);
    const written = JSON.parse(io.store[PROJECT_MCP]);
    expect(written.mcpServers.other).toEqual({ disabled: true });
    expect(written.extra).toBe(1);
  });
});

describe("setDirectTools — adapter per-server filter (ServerEntry.directTools)", () => {
  it("writes the tool list onto the iMCP entry, preserving command", () => {
    const io = memIO({
      [MCP]: JSON.stringify({ mcpServers: { iMCP: { command: SERVER } } }),
    });
    expect(setDirectTools(io, MCP, ["calendar", "contacts"]).ok).toBe(true);
    expect(JSON.parse(io.store[MCP]).mcpServers.iMCP).toEqual({
      command: SERVER,
      directTools: ["calendar", "contacts"],
    });
  });

  it("an empty selection REMOVES the key (adapter reads [] as promote-nothing)", () => {
    const io = memIO({
      [MCP]: JSON.stringify({
        mcpServers: { iMCP: { command: SERVER, directTools: ["calendar"] } },
      }),
    });
    setDirectTools(io, MCP, []);
    expect(JSON.parse(io.store[MCP]).mcpServers.iMCP).toEqual({ command: SERVER });
  });

  it("does not disturb the disabled flag", () => {
    const io = memIO({
      [MCP]: JSON.stringify({ mcpServers: { iMCP: { disabled: true } } }),
    });
    setDirectTools(io, MCP, ["weather"]);
    expect(JSON.parse(io.store[MCP]).mcpServers.iMCP).toEqual({
      disabled: true,
      directTools: ["weather"],
    });
  });
});

describe("idempotency + store isolation", () => {
  it("#E27: two runs → one iMCP key, ≤1 adapter entry", () => {
    const io = memIO();
    runInstaller(makeEnv(io));
    runInstaller(makeEnv(io));
    const mcp = JSON.parse(io.store[MCP]);
    const settings = JSON.parse(io.store[SETTINGS]);
    expect(Object.keys(mcp.mcpServers)).toEqual(["iMCP"]);
    expect(settings.packages.filter((p: string) => p === ADAPTER_PACKAGE_SOURCE)).toHaveLength(1);
  });

  it("#X15: write mode touches exactly two files, never a plugin config store", () => {
    const io = memIO();
    const r = runInstaller(makeEnv(io));
    expect(r.state).toBe("READY_PENDING_GRANTS");
    expect(new Set(io.writes)).toEqual(new Set([MCP, SETTINGS]));
    expect(io.writes).toHaveLength(2);
  });
});
