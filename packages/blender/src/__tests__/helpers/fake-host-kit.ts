/**
 * Test kit around `fake-host.mjs`: temp dirs, a real `Supervisor` whose every effect is injected (probe,
 * provision, repair, spawn of the scripted fake host), recorded call spies, and the host's JSONL request log.
 * Everything is cleaned up by `cleanupAll()` (kills leftover host children, shuts supervisors down, removes dirs).
 *
 * See change: add-blender-wasm-mcp (design D9).
 */
import { type ChildProcess, spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { type Mock, vi } from "vitest";
import type { ProbeResult } from "../../host/probe.js";
import type { HostErrorCode, OpName } from "../../host/protocol.js";
import { type Call, type Cancelled, type OpRequest, type Outcome, Supervisor, type SupervisorDeps } from "../../host/supervisor.js";
import { startTool, type ToolContext } from "../../mcp/tools.js";
import { resolveLimits } from "../../mcp/workspace.js";
import type { ProvisionResult } from "../../provision.js";

export const FAKE_HOST = fileURLToPath(new URL("./fake-host.mjs", import.meta.url));

export interface BootStep {
  delayMs?: number;
  /** Exit with this code during boot (after writing `stderr`). */
  exitCode?: number;
  stderr?: string;
  /** Never send `ready`. */
  hang?: boolean;
}
export interface OpStep {
  delayMs?: number;
  result?: Record<string, unknown>;
  output?: string;
  outputTruncated?: boolean;
  /** Output files keyed verbatim (unconfined, e.g. `../../x`), string contents. */
  files?: Record<string, string>;
  error?: { code: HostErrorCode; message: string };
  /** Exit mid-call with this code (no result). */
  exitCode?: number;
  stderr?: string;
}
export interface FakeHostConfig {
  boots?: BootStep[];
  steps?: OpStep[];
}

export interface LogEntry {
  type: "boot" | "op" | "sent";
  n: number;
  t: number;
  pid: number;
  id?: number;
  op?: OpName;
  args?: Record<string, unknown>;
  nonce?: string;
  outputLimit?: number;
  files?: Record<string, number>;
  hasBlend?: boolean;
}

const tmpDirs: string[] = [];
const supervisors: Supervisor[] = [];
const children: ChildProcess[] = [];

/** A fresh realpath'd temp directory. */
export function tmpDir(prefix = "blender-t-"): string {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  tmpDirs.push(d);
  return d;
}

export async function cleanupAll(): Promise<void> {
  for (const s of supervisors.splice(0)) await s.shutdown().catch(() => undefined);
  for (const c of children.splice(0)) if (c.exitCode === null && c.signalCode === null) c.kill("SIGKILL");
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
}

export function runtimeResult(over: Partial<ProvisionResult> = {}): ProvisionResult {
  return { version: "0.0.5", source: "cache", dir: "/nonexistent/runtime", bytes: 1, licence: "GPL-2.0-or-later", ...over };
}

export interface Harness {
  dir: string;
  deps: SupervisorDeps;
  spies: {
    probe: Mock<SupervisorDeps["probe"]>;
    provision: Mock<SupervisorDeps["provision"]>;
    repair: Mock<SupervisorDeps["repair"]>;
    spawnHost: Mock<SupervisorDeps["spawnHost"]>;
  };
  logEntries(): LogEntry[];
  /** Requests the host received. */
  ops(): LogEntry[];
  boots(): LogEntry[];
  /** A tracked `Supervisor` over `deps`. */
  supervisor(): Supervisor;
}

export interface HarnessOptions {
  probe?: ProbeResult;
  runtime?: Partial<ProvisionResult>;
  deps?: Partial<SupervisorDeps>;
}

/** A fake-host harness: all effects injected and spied, the host a real scripted child process. */
export function makeHarness(cfg: FakeHostConfig = {}, opts: HarnessOptions = {}): Harness {
  const dir = tmpDir("blender-sup-");
  const logPath = path.join(dir, "host-log.jsonl");
  const cfgPath = path.join(dir, "host-config.json");
  fs.writeFileSync(cfgPath, JSON.stringify({ ...cfg, log: logPath }));
  const probe = vi.fn<SupervisorDeps["probe"]>(async () => opts.probe ?? { mode: "native", node: "v24.15.0" });
  const provision = vi.fn<SupervisorDeps["provision"]>(async () => runtimeResult(opts.runtime));
  const repair = vi.fn<SupervisorDeps["repair"]>(async () => true);
  const spawnHost = vi.fn<SupervisorDeps["spawnHost"]>((flags) => {
    const child = spawn(process.execPath, [...flags, FAKE_HOST], {
      stdio: ["ignore", "ignore", "pipe", "ipc"],
      serialization: "advanced",
      env: { ...process.env, FAKE_HOST_CONFIG: cfgPath },
    });
    children.push(child);
    return child;
  });
  let n = 0;
  const deps: SupervisorDeps = {
    probe,
    provision,
    repair,
    spawnHost,
    now: () => Date.now(),
    nonce: () => `nonce-${++n}`,
    idleMs: 600_000,
    bootTimeoutMs: 20_000,
    ...opts.deps,
  };
  const logEntries = (): LogEntry[] =>
    fs.existsSync(logPath)
      ? fs
          .readFileSync(logPath, "utf8")
          .split("\n")
          .filter(Boolean)
          .map((l) => JSON.parse(l) as LogEntry)
      : [];
  return {
    dir,
    deps,
    spies: { probe, provision, repair, spawnHost },
    logEntries,
    ops: () => logEntries().filter((e) => e.type === "op"),
    boots: () => logEntries().filter((e) => e.type === "boot"),
    supervisor: () => {
      const s = new Supervisor(deps);
      supervisors.push(s);
      return s;
    },
  };
}

/** `enqueue` that always has a sensible default request; resolves to the outcome (never a Cancelled). */
export async function run(sup: Supervisor, req: Partial<OpRequest> & Pick<OpRequest, "op">): Promise<Outcome> {
  const out = await sup.enqueue({ args: {} as never, timeoutSec: 30, outputLimit: 1024 * 1024, ...req }).promise;
  if ("cancelled" in out) throw new Error("call was cancelled");
  return out;
}

export async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

/** Whether `promise` has settled within a short grace period (for "no response" assertions). */
export async function settlesWithin<T>(promise: Promise<T>, ms: number): Promise<boolean> {
  let settled = false;
  void promise.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  await sleep(ms);
  return settled;
}

export type { Call, Cancelled };

export interface ParsedTool {
  isError: boolean;
  /** Parsed first content block. */
  data: Record<string, unknown> & { code?: string; message?: string };
  /** Last block when there is more than one. */
  output?: string;
  raw: { isError?: true; content: { type: "text"; text: string }[] };
}

/** A tool context over `supervisor` with an optional limits override. */
export function toolCtx(root: string, supervisor: ToolContext["supervisor"], limits = resolveLimits({})): ToolContext {
  return { root, supervisor, limits };
}

/** Run one tool call to completion and parse its result. */
export async function callTool(name: string, args: unknown, ctx: ToolContext): Promise<ParsedTool> {
  const res = await startTool(name, args, ctx).promise;
  if ("cancelled" in res) throw new Error("call was cancelled");
  return {
    isError: res.isError === true,
    data: JSON.parse(res.content[0].text) as ParsedTool["data"],
    output: res.content.length > 1 ? res.content[res.content.length - 1].text : undefined,
    raw: res,
  };
}

/** A fresh workspace root (realpath'd temp dir). */
export const makeRoot = (): string => tmpDir("blender-root-");
