/**
 * Worktree-init hook engine (generalized from the old worktree-bootstrap step).
 *
 * A project declares ONE init hook in `.pi/settings.json#worktreeInit`:
 *   { gate: "<bash test>", run: { type: "script", command } | { type: "agent", prompt, model?, settings? } }
 *
 * Four concerns:
 *   1. `readInitHook(repoRoot)`      — parse `.pi/settings.json#worktreeInit`,
 *      fail-open to `null` on any read/parse/shape error.
 *   2. `evaluateGate(cwd, hook)`     — spawn the bash `gate` in `cwd`;
 *      `needsInit: true` iff exit code === 0. Spawn errors / timeouts
 *      fail closed (`needsInit: false`) and log.
 *   3. `runInitHook(cwd, hook, …)`   — `script` runs the command via the
 *      streaming ring-buffer executor; `agent` spawns a DETACHED headless
 *      pi, awaits exit, then re-evaluates the gate to decide ok/failed.
 *   4. `hookDefHash(hook)`           — sha256 over a canonical serialization
 *      of the hook; the trust key component.
 *
 * See change: generalize-worktree-init-hook.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { spawn } from "@blackbelt-technology/pi-dashboard-shared/platform/exec.js";
import type { ChildProcess, SpawnOptions } from "@blackbelt-technology/pi-dashboard-shared/platform/exec.js";
import { getDefaultRegistry } from "@blackbelt-technology/pi-dashboard-shared/tool-registry/index.js";

// ── Types ─────────────────────────────────────────────────────────────────

export interface ScriptRun {
  type: "script";
  command: string;
}

export interface AgentRun {
  type: "agent";
  prompt: string;
  model?: string;
  settings?: unknown;
}

export type InitRun = ScriptRun | AgentRun;

export interface WorktreeInitHook {
  gate: string;
  run: InitRun;
}

// ── 1. readInitHook ─────────────────────────────────────────────────────────

/**
 * Reads `<repoRoot>/.pi/settings.json` and returns the parsed `worktreeInit`
 * hook, or `null` on any read error, parse error, missing key, or
 * unrecognized shape (fail-open).
 */
export function readInitHook(repoRoot: string): WorktreeInitHook | null {
  const settingsPath = path.join(repoRoot, ".pi", "settings.json");
  let raw: string;
  try {
    raw = fs.readFileSync(settingsPath, "utf8");
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const hook = (parsed as { worktreeInit?: unknown }).worktreeInit;
  return normalizeHook(hook);
}

/** Validate the raw `worktreeInit` value into a typed hook, else `null`. */
export function normalizeHook(hook: unknown): WorktreeInitHook | null {
  if (!hook || typeof hook !== "object" || Array.isArray(hook)) return null;
  const h = hook as { gate?: unknown; run?: unknown };
  if (typeof h.gate !== "string" || h.gate.length === 0) return null;
  if (!h.run || typeof h.run !== "object" || Array.isArray(h.run)) return null;
  const run = h.run as { type?: unknown; command?: unknown; prompt?: unknown; model?: unknown; settings?: unknown };
  if (run.type === "script") {
    if (typeof run.command !== "string" || run.command.length === 0) return null;
    return { gate: h.gate, run: { type: "script", command: run.command } };
  }
  if (run.type === "agent") {
    if (typeof run.prompt !== "string" || run.prompt.length === 0) return null;
    const agent: AgentRun = { type: "agent", prompt: run.prompt };
    if (typeof run.model === "string") agent.model = run.model;
    if (run.settings !== undefined) agent.settings = run.settings;
    return { gate: h.gate, run: agent };
  }
  return null;
}

// ── 2. evaluateGate ───────────────────────────────────────────────────────

export interface GateResult {
  needsInit: boolean;
}

export interface EvaluateGateOptions {
  /** Hard timeout for the gate process. Default 10 s. */
  timeoutMs?: number;
  /** Override the shell spawn (tests). */
  spawnFn?: (command: string, args: readonly string[], options: SpawnOptions) => ChildProcess;
  env?: NodeJS.ProcessEnv;
}

const DEFAULT_GATE_TIMEOUT_MS = 10 * 1000;

/**
 * Spawns `bash -c <gate>` in `cwd`. Resolves `{ needsInit: true }` iff the
 * gate exits 0. Non-zero → false. Spawn error / timeout fails closed
 * (`needsInit: false`) and logs.
 */
export async function evaluateGate(
  cwd: string,
  hook: WorktreeInitHook,
  opts: EvaluateGateOptions = {},
): Promise<GateResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_GATE_TIMEOUT_MS;
  const spawnFn = opts.spawnFn ?? spawn;
  return await new Promise<GateResult>((resolve) => {
    let settled = false;
    const done = (result: GateResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    let child: ChildProcess;
    try {
      child = spawnFn("bash", ["-c", hook.gate], {
        cwd,
        env: opts.env ?? process.env,
        stdio: ["ignore", "ignore", "ignore"],
      });
    } catch (err) {
      console.warn(`[worktree-init] gate spawn failed in ${cwd}: ${(err as Error)?.message}`);
      resolve({ needsInit: false });
      return;
    }
    const timer = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch { /* noop */ }
      console.warn(`[worktree-init] gate timed out in ${cwd}`);
      done({ needsInit: false });
    }, timeoutMs);
    if (typeof timer.unref === "function") timer.unref();
    child.on("error", (err) => {
      console.warn(`[worktree-init] gate error in ${cwd}: ${err.message}`);
      done({ needsInit: false });
    });
    child.on("exit", (code) => {
      done({ needsInit: code === 0 });
    });
  });
}

// ── 3. runInitHook ────────────────────────────────────────────────────────

export interface InitProgress {
  /** Most recent ≤ tailBytes of combined stdout/stderr. */
  line: string;
}

export interface InitResult {
  ok: boolean;
  durationMs: number;
  /** Whether the hook actually executed (false only on internal precondition failures). */
  ran: boolean;
  code?: string;
  /** Last ≤ tailBytes of combined output on failure. */
  stderr?: string;
}

export interface RunInitOptions {
  throttleMs?: number;
  tailBytes?: number;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
  /** Override the shell spawn (tests). */
  spawnFn?: (command: string, args: readonly string[], options: SpawnOptions) => ChildProcess;
  /** Override pi binary resolution for the agent flavor (tests). */
  resolvePiBin?: () => string | null;
  /** Override gate re-evaluation used to detect agent completion (tests). */
  evaluateGateFn?: (cwd: string, hook: WorktreeInitHook) => Promise<GateResult>;
}

const DEFAULT_THROTTLE_MS = 250;
const DEFAULT_TAIL_BYTES = 4 * 1024;
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * Runs the declared hook in `cwd`. `script` flavor streams throttled
 * progress and resolves on exit. `agent` flavor spawns a DETACHED headless
 * pi (output → `<cwd>/.pi/worktree-init.log`), awaits exit, then
 * re-evaluates the gate: still-needs-init ⇒ failed (with log tail).
 */
export async function runInitHook(
  cwd: string,
  hook: WorktreeInitHook,
  onProgress: (p: InitProgress) => void,
  opts: RunInitOptions = {},
): Promise<InitResult> {
  if (hook.run.type === "script") {
    return await runScript(cwd, hook.run.command, onProgress, opts);
  }
  return await runAgent(cwd, hook, onProgress, opts);
}

/** Script flavor: `bash -c <command>` with a ring-buffer/throttle/timeout. */
async function runScript(
  cwd: string,
  command: string,
  onProgress: (p: InitProgress) => void,
  opts: RunInitOptions,
): Promise<InitResult> {
  const throttleMs = opts.throttleMs ?? DEFAULT_THROTTLE_MS;
  const tailBytes = opts.tailBytes ?? DEFAULT_TAIL_BYTES;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const spawnFn = opts.spawnFn ?? spawn;

  let tail = "";
  const appendToTail = (chunk: string) => {
    tail = tail + chunk;
    if (tail.length > tailBytes) tail = tail.slice(tail.length - tailBytes);
  };

  let lastEmit = 0;
  let pendingTimer: NodeJS.Timeout | null = null;
  const emit = () => {
    lastEmit = Date.now();
    if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null; }
    try { onProgress({ line: tail }); } catch { /* swallow */ }
  };
  const scheduleEmit = () => {
    const since = Date.now() - lastEmit;
    if (since >= throttleMs) { emit(); return; }
    if (pendingTimer) return;
    pendingTimer = setTimeout(emit, throttleMs - since);
  };

  onProgress({ line: `> ${command}\n` });
  appendToTail(`> ${command}\n`);

  const start = Date.now();
  return await new Promise<InitResult>((resolve) => {
    let settled = false;
    let child: ChildProcess;
    try {
      child = spawnFn("bash", ["-c", command], {
        cwd,
        env: opts.env ?? process.env,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (err) {
      // Synchronous spawn failure (e.g. ENOENT) — keep the stable failure envelope.
      appendToTail(`\n${(err as Error)?.message ?? "spawn failed"}`);
      emit();
      resolve({ ok: false, ran: true, durationMs: Date.now() - start, code: "spawn_error", stderr: tail });
      return;
    }
    const timer = setTimeout(() => {
      if (settled) return;
      try { child.kill("SIGTERM"); } catch { /* noop */ }
      setTimeout(() => { try { child.kill("SIGKILL"); } catch { /* noop */ } }, 2000);
    }, timeoutMs);

    child.stdout?.on("data", (b: Buffer) => { appendToTail(b.toString("utf8")); scheduleEmit(); });
    child.stderr?.on("data", (b: Buffer) => { appendToTail(b.toString("utf8")); scheduleEmit(); });

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null; }
      appendToTail(`\n${err.message}`);
      emit();
      resolve({ ok: false, ran: true, durationMs: Date.now() - start, code: "spawn_error", stderr: tail });
    });

    child.on("exit", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null; }
      emit();
      const ok = code === 0;
      resolve({
        ok,
        ran: true,
        durationMs: Date.now() - start,
        code: ok ? undefined : (signal ? `signal_${signal}` : "script_nonzero_exit"),
        stderr: ok ? undefined : tail,
      });
    });
  });
}

/** Resolve the `pi` binary path via the shared tool registry. */
function resolvePiBinDefault(): string | null {
  try {
    const res = getDefaultRegistry().resolve("pi");
    return res.ok && res.path ? res.path : null;
  } catch {
    return null;
  }
}

/**
 * Agent flavor: spawn a DETACHED headless pi (output → `.pi/worktree-init.log`),
 * await exit, then re-evaluate the gate. Still-needs-init ⇒ failed.
 */
async function runAgent(
  cwd: string,
  hook: WorktreeInitHook,
  onProgress: (p: InitProgress) => void,
  opts: RunInitOptions,
): Promise<InitResult> {
  if (hook.run.type !== "agent") {
    return { ok: false, ran: false, durationMs: 0, code: "internal" };
  }
  const tailBytes = opts.tailBytes ?? DEFAULT_TAIL_BYTES;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const spawnFn = opts.spawnFn ?? spawn;
  const resolvePiBin = opts.resolvePiBin ?? resolvePiBinDefault;
  const evalGate = opts.evaluateGateFn ?? ((c, h) => evaluateGate(c, h, { spawnFn: opts.spawnFn, env: opts.env }));

  const piBin = resolvePiBin();
  if (!piBin) {
    return { ok: false, ran: false, durationMs: 0, code: "pi_unresolved", stderr: "could not resolve the pi binary" };
  }

  // Combined output log for failure surfacing.
  const logPath = path.join(cwd, ".pi", "worktree-init.log");
  try { fs.mkdirSync(path.dirname(logPath), { recursive: true }); } catch { /* noop */ }
  let logFd: number | undefined;
  try { logFd = fs.openSync(logPath, "w"); } catch { /* fall back to ignore */ }

  const args = ["-p", hook.run.prompt];
  if (hook.run.model) args.push("--model", hook.run.model);

  onProgress({ line: `> pi -p (agent init)\n` });

  const start = Date.now();
  const exitCode = await new Promise<number | null>((resolve) => {
    let settled = false;
    let child: ChildProcess | null = null;
    const finish = (code: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(code);
    };
    // Bound the detached agent so a stuck child can't block the init request.
    const timer = setTimeout(() => {
      try { child?.kill("SIGTERM"); } catch { /* noop */ }
      const hardKill = setTimeout(() => { try { child?.kill("SIGKILL"); } catch { /* noop */ } }, 2000);
      if (typeof hardKill.unref === "function") hardKill.unref();
      finish(null);
    }, timeoutMs);
    if (typeof timer.unref === "function") timer.unref();
    try {
      child = spawnFn(piBin, args, {
        cwd,
        env: opts.env ?? process.env,
        detached: true,
        stdio: ["ignore", logFd ?? "ignore", logFd ?? "ignore"],
      } as SpawnOptions);
    } catch (err) {
      onProgress({ line: `\n${(err as Error)?.message ?? "spawn failed"}` });
      finish(null);
      return;
    }
    child.on("error", () => finish(null));
    child.on("exit", (code) => finish(code));
    // Detach: do not keep the parent alive on this child.
    try { child.unref?.(); } catch { /* noop */ }
  });
  if (logFd !== undefined) { try { fs.closeSync(logFd); } catch { /* noop */ } }

  const durationMs = Date.now() - start;
  // Completion is decided by re-evaluating the gate, not the exit code.
  const gate = await evalGate(cwd, hook);
  if (!gate.needsInit) {
    return { ok: true, ran: true, durationMs };
  }
  const logTail = readTail(logPath, tailBytes);
  return {
    ok: false,
    ran: true,
    durationMs,
    code: exitCode === 0 ? "agent_incomplete" : "agent_failed",
    stderr: logTail,
  };
}

/** Read the last `maxBytes` of a file, returning "" on any error. */
function readTail(file: string, maxBytes: number): string {
  try {
    const buf = fs.readFileSync(file);
    return buf.length > maxBytes ? buf.subarray(buf.length - maxBytes).toString("utf8") : buf.toString("utf8");
  } catch {
    return "";
  }
}

// ── 4. hookDefHash ────────────────────────────────────────────────────────

/** sha256 over a canonical (key-sorted) serialization of the hook. */
export function hookDefHash(hook: WorktreeInitHook): string {
  return createHash("sha256").update(canonicalize(hook)).digest("hex");
}

/** Deterministic JSON with recursively sorted object keys. */
function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(obj[k])}`).join(",")}}`;
}
