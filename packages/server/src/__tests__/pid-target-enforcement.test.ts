/**
 * Deny-by-default enforcement (design D5, S4): any non-test file under
 * `packages/server/src` that calls a process probe / signal helper must be on
 * the allowlist below, whatever the argument shape (an alias such as
 * `const { pid } = session` cannot slip through).
 *
 * Allowlist kinds:
 * - `resolves`        — the module makes a REAL `resolvePidTarget(` call (a
 *                       comment or string literal does not count);
 * - `resolved-target` — the helper takes an already-resolved `PidTarget`
 *                       parameter (the type forces the caller to resolve);
 * - `own-spawn`       — signals only pids the server itself spawned or owns
 *                       (registry entries, keepers, services, lock files); a
 *                       reason is mandatory.
 *
 * Test-plan rows X70–X74, E103. See change: scope-pids-to-namespace.
 */
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

type Entry = { kind: "resolves" } | { kind: "resolved-target"; reason: string } | { kind: "own-spawn"; reason: string };
type Allowlist = Record<string, Entry>;

const HELPER_CALL = /\b(?:signalZero|killProcess|killPidWithGroup|killProcessGroup|isProcessAlive|processStartedAt)\s*\(|\bdeps\.probe\s*\(/;

/** Blank out comments and string/template literals so only real code is matched. */
export function stripCommentsAndStrings(src: string): string {
  let out = "";
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (c === "/" && n === "/") {
      while (i < src.length && src[i] !== "\n") i++;
    } else if (c === "/" && n === "*") {
      i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++;
      i += 2;
    } else if (c === '"' || c === "'" || c === "`") {
      const q = c;
      i++;
      while (i < src.length && src[i] !== q) i += src[i] === "\\" ? 2 : 1;
      i++;
      out += '""';
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

function walk(dir: string, root: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === "__tests__" || name === "test-support" || name === "node_modules") continue;
      walk(p, root, acc);
    } else if (/\.tsx?$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name) && !name.endsWith(".d.ts")) {
      acc.push(relative(root, p).split(sep).join("/"));
    }
  }
  return acc;
}

/** Violations: one line per offending file, naming it. */
export function scanPidConsumers(root: string, allowlist: Allowlist): string[] {
  const violations: string[] = [];
  for (const rel of walk(root, root)) {
    const code = stripCommentsAndStrings(readFileSync(join(root, rel), "utf8"));
    if (!HELPER_CALL.test(code)) continue;
    const entry = allowlist[rel];
    if (!entry) {
      violations.push(`${rel}: calls a process probe/signal helper but is not on the pid-target allowlist`);
    } else if (entry.kind === "resolves" && !/\bresolvePidTarget\s*\(/.test(code)) {
      violations.push(`${rel}: allowlisted as "resolves" but makes no real resolvePidTarget( call`);
    } else if (entry.kind === "resolved-target" && !/\bPidTarget\b/.test(code)) {
      violations.push(`${rel}: allowlisted as "resolved-target" but takes no PidTarget`);
    } else if (entry.kind !== "resolves" && !entry.reason.trim()) {
      violations.push(`${rel}: allowlist entry needs a reason`);
    }
  }
  return violations;
}

const SERVER_SRC = join(__dirname, "..");

const OWN = (reason: string): Entry => ({ kind: "own-spawn", reason });

/** The real allowlist for `packages/server/src`. Adding a row is a reviewed decision. */
export const PID_TARGET_ALLOWLIST: Allowlist = {
  "browser-handlers/session-action-handler.ts": { kind: "resolves" },
  "embed-lifecycle/idle-reaper.ts": { kind: "resolves" },
  "spawn-process/session-terminator.ts": { kind: "resolves" },
  "session/death-reason.ts": {
    kind: "resolved-target",
    reason: "classifyCarrierLoss(session, target) probes only a `host` target; the gateway resolves it",
  },
  "spawn-process/headless-pid-registry.ts": OWN("headless spawn registry: pids/keepers the server spawned"),
  "spawn-process/spawn-register-watchdog.ts": OWN("watchdog reclaims the pid of a spawn the server armed"),
  "spawn-process/server-pid.ts": OWN("the dashboard server's own pid file"),
  "rpc-keeper/keeper-manager.ts": OWN("rpc keeper sidecars the server spawned"),
  "terminal/terminal-manager.ts": OWN("terminal ptys the server spawned"),
  "services/service-manager.ts": OWN("managed services the server spawned"),
  "services/native-driver.ts": OWN("native service processes the server spawned"),
  "cli.ts": OWN("CLI start/stop of the dashboard server's own process and port holders"),
  "lifecycle/boot-parent-liveness.ts": OWN("liveness of the launcher parent process"),
  "lifecycle/classify-dashboard-port.ts": OWN("lock-file pid of a dashboard server instance"),
  "auth/secret-rotation.ts": OWN("lock-file pid of a server instance during secret rotation"),
  "pi/gateway-socket-bind.ts": OWN("owner pid of a stale gateway unix socket lock"),
};

function fixtureDir(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "pid-scan-"));
  for (const [rel, body] of Object.entries(files)) {
    const p = join(root, rel);
    mkdirSync(join(p, ".."), { recursive: true });
    writeFileSync(p, body);
  }
  return root;
}

/**
 * @structural-pin deny-by-default D5 scan: which server files call a process probe/signal helper is a property of source text
 */
describe("pid-target enforcement — real tree", () => {
  it("X70: every helper call in packages/server/src is allowlisted and justified", () => {
    expect(scanPidConsumers(SERVER_SRC, PID_TARGET_ALLOWLIST)).toEqual([]);
  });

  it("X70: no stale allowlist rows (each row still calls a helper)", () => {
    const stale = Object.keys(PID_TARGET_ALLOWLIST).filter((rel) => {
      const code = stripCommentsAndStrings(readFileSync(join(SERVER_SRC, rel), "utf8"));
      return !HELPER_CALL.test(code);
    });
    expect(stale).toEqual([]);
  });

  it("E103(d): the registry, server-pid and CLI files pass as own-spawn entries with a reason", () => {
    for (const rel of ["spawn-process/headless-pid-registry.ts", "spawn-process/server-pid.ts", "cli.ts"]) {
      const e = PID_TARGET_ALLOWLIST[rel];
      expect(e.kind).toBe("own-spawn");
      expect(e.kind !== "resolves" && e.reason.length).toBeGreaterThan(10);
    }
  });
});

describe("pid-target enforcement — scanner on fixtures", () => {
  it("X71: a new unresolved consumer fails, naming the file", () => {
    const root = fixtureDir({ "x.ts": "export const f = (session: { pid: number }) => signalZero(session.pid);\n" });
    const v = scanPidConsumers(root, {});
    expect(v).toHaveLength(1);
    expect(v[0]).toMatch(/^x\.ts:/);
  });

  it("X72: each helper is covered, whatever the argument", () => {
    const calls = [
      "killProcess(s.pid)",
      "killPidWithGroup(pid)",
      "killProcessGroup(x)",
      "isProcessAlive(s.pid)",
      "processStartedAt(s.pid)",
      "deps.probe(s.pid)",
    ];
    const files = Object.fromEntries(calls.map((c, i) => [`f${i}.ts`, `export const g = () => ${c};\n`]));
    const v = scanPidConsumers(fixtureDir(files), {});
    expect(v).toHaveLength(6);
    for (let i = 0; i < 6; i++) expect(v.some((line) => line.startsWith(`f${i}.ts:`))).toBe(true);
  });

  it("X73: a resolvePidTarget( only in a comment or string does not count", () => {
    const root = fixtureDir({
      "a.ts": [
        "// resolvePidTarget(s, ctx)",
        'const note = "resolvePidTarget(";',
        "export const f = (s: { pid: number }) => signalZero(s.pid);",
      ].join("\n"),
    });
    const v = scanPidConsumers(root, { "a.ts": { kind: "resolves" } });
    expect(v).toHaveLength(1);
    expect(v[0]).toMatch(/no real resolvePidTarget/);
  });

  it("X74: a resolved module passes", () => {
    const root = fixtureDir({
      "ok.ts": "export const f = (s: any, ctx: any) => { if (resolvePidTarget(s, ctx).kind === 'host') signalZero(s.pid); };\n",
    });
    expect(scanPidConsumers(root, { "ok.ts": { kind: "resolves" } })).toEqual([]);
  });

  it("E103: argument-free scan, own-spawn exemption, tests ignored", () => {
    const root = fixtureDir({
      "x.ts": "export const f = (session: any) => { const { pid } = session; return signalZero(pid); };\n",
      "y.ts": "export const g = (entry: any) => killProcess(entry.pid);\n",
      "__tests__/z.test.ts": "killProcess(1);\n",
    });
    const v = scanPidConsumers(root, { "y.ts": OWN("registry entry the server spawned") });
    expect(v).toHaveLength(1);
    expect(v[0]).toMatch(/^x\.ts:/);
  });
});
