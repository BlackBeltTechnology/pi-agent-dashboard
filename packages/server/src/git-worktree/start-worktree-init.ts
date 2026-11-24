/**
 * Shared worktree-init run starter: the trust check → gate → run → broadcast body
 * of `POST /api/git/worktree/init`, extracted so the plugin-spawn hook starts the
 * SAME run (config-root resolution, TOFU trust, gate cache, registry run state,
 * `sendCwd` broadcast, stderr redaction) instead of re-implementing it.
 *
 * Trust is only ever CHECKED here, never granted: granting (`confirmHash`, scope,
 * pi mirror) stays in the route, which owns the request that carries the consent.
 *
 * See change: generalize-worktree-init-hook, add-plugin-spawn-worktree (design D6).
 */
import { resolveConfigRoot } from "./git-operations.js";
import { redactGitText } from "./redact-git-text.js";
import {
  evaluateGate,
  type GateResult,
  hookDefHash,
  type InitProgress,
  readInitHook,
  runInitHook,
  type WorktreeInitHook,
} from "./worktree-init.js";
import { mapInitStderrToHint } from "./worktree-init-errors.js";
import type { WorktreeInitRegistry } from "./worktree-init-registry.js";
import { isTrusted } from "./worktree-init-trust.js";

/**
 * Per-resolved-checkout cache of the gate result, with a short TTL, keyed by the hook definition it
 * was evaluated for (a different hook for the same checkout must evaluate its own gate).
 * Invalidated when a hook run starts/exits for that checkout.
 * See change: generalize-worktree-init-hook.
 */
const GATE_CACHE_TTL_MS = 30 * 1000;
const gateCache = new Map<string, { hash: string; needsInit: boolean; evaluatedAt: number }>();
export function invalidateGateCache(checkoutPath: string): void {
  gateCache.delete(checkoutPath);
}
export async function evaluateGateCached(checkoutPath: string, hook: WorktreeInitHook): Promise<GateResult> {
  const hash = hookDefHash(hook);
  const hit = gateCache.get(checkoutPath);
  if (hit && hit.hash === hash && Date.now() - hit.evaluatedAt < GATE_CACHE_TTL_MS) return { needsInit: hit.needsInit };
  const res = await evaluateGate(checkoutPath, hook);
  gateCache.set(checkoutPath, { hash, needsInit: res.needsInit, evaluatedAt: Date.now() });
  return res;
}

/**
 * Last non-empty line of the progress tail, for the ghost preview. The tail is
 * the most recent <= 4KB of combined output; the chip shows only its final line.
 * See change: friendlier-worktree-init.
 */
function lastLineOf(tail: string): string {
  const lines = tail.split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]?.trim();
    if (line) return line;
  }
  return "";
}

export interface StartWorktreeInitOptions {
  registry?: WorktreeInitRegistry;
  /** Legacy per-click subscriber id; echoed on the progress/done/failed broadcasts. */
  requestId?: string;
  /** Return `already_running` instead of restarting when the registry holds a running run for `cwd`. */
  skipIfRunning?: boolean;
}

export type StartWorktreeInitResult =
  | { status: "no_hook" }
  | { status: "untrusted"; hook: WorktreeInitHook; hash: string }
  | { status: "already_initialized" }
  | { status: "already_running" }
  | { status: "done"; durationMs: number }
  | { status: "failed"; code: string; hint: string; stderr: string };

/** `cwd` must be a canonical (admitted / worktree) checkout path: it keys the registry and the gate cache. */
export async function startWorktreeInit(cwd: string, opts: StartWorktreeInitOptions = {}): Promise<StartWorktreeInitResult> {
  const { registry, requestId, skipIfRunning } = opts;
  const redact = (text: unknown) => redactGitText(text, { root: cwd });
  const configRoot = resolveConfigRoot(cwd);
  if (!configRoot) return { status: "no_hook" };
  const hook = readInitHook(configRoot);
  if (!hook) return { status: "no_hook" };
  const hash = hookDefHash(hook);
  if (!isTrusted(configRoot, hash)) {
    // Echo the hash so the client confirms with `confirmHash` without re-implementing the canonical hash.
    return { status: "untrusted", hook, hash };
  }
  // Re-trust case: the hook was edited (invalidating trust) but the gate is already satisfied
  // (`needsInit === false`). Granting trust should clear the control WITHOUT re-running the hook.
  const preGate = await evaluateGateCached(cwd, hook);
  // A live run wins over a satisfied gate: a hook can create its gate artifact (e.g. `node_modules`) mid-run,
  // and a skipIfRunning caller must still wait for the run. Checked synchronously before `startRun`.
  if (skipIfRunning && registry?.getActiveRuns().some((r) => r.cwd === cwd && r.phase === "running")) {
    return { status: "already_running" };
  }
  if (!preGate.needsInit) return { status: "already_initialized" };
  // Fan out to the legacy per-click requestId subscriber (if any) AND to
  // every cwd-keyed subscriber (refresh / second tab / auto-init).
  const sendIf = (msg: any) => {
    if (registry) {
      if (requestId) registry.send(requestId, msg);
      registry.sendCwd(cwd, msg);
    }
  };
  registry?.startRun(cwd);
  const onProgress = (p: InitProgress) => {
    registry?.progressRun(cwd, lastLineOf(p.line), p.line);
    sendIf({ type: "worktree_init_progress", requestId: requestId ?? "", cwd, line: p.line });
  };
  invalidateGateCache(cwd);
  const runResult = await runInitHook(cwd, hook, onProgress);
  invalidateGateCache(cwd);
  if (runResult.ok) {
    registry?.finishRun(cwd, "done");
    sendIf({ type: "worktree_init_done", requestId: requestId ?? "", cwd, durationMs: runResult.durationMs });
    return { status: "done", durationMs: runResult.durationMs };
  }
  // B20: the mapper sees the RAW stderr (so it can match paths); BOTH the mapped hint and the
  // stderr are redacted AFTER mapping, against the checkout the hook ran in (`cwd`).
  const rawStderr = runResult.stderr ?? "";
  const hint = redact(mapInitStderrToHint(rawStderr) ?? `init failed (${runResult.code ?? "unknown"})`);
  const stderr = redact(rawStderr);
  const code = runResult.code ?? "init_failed";
  registry?.finishRun(cwd, "failed", code);
  sendIf({ type: "worktree_init_failed", requestId: requestId ?? "", cwd, code, message: hint, stderr });
  return { status: "failed", code, hint, stderr };
}

/**
 * Wait for the run the registry reported as running for `cwd`: resolves its terminal phase (`done` /
 * `failed`), or `timeout` when it does not finish in time OR its entry is gone before a terminal phase
 * was observed (evicted: the outcome is unknown, never assumed to be success). Used by the plugin-spawn
 * hook when another trigger (the browser) started the run first, so an unattended prompt never races
 * `pnpm install`.
 */
export async function awaitInitRun(
  registry: WorktreeInitRegistry,
  cwd: string,
  { timeoutMs = 10 * 60_000, pollMs = 500 }: { timeoutMs?: number; pollMs?: number } = {},
): Promise<"done" | "failed" | "timeout"> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const run = registry.getActiveRuns().find((r) => r.cwd === cwd);
    if (!run) return "timeout";
    if (run.phase !== "running") return run.phase === "failed" ? "failed" : "done";
    if (Date.now() >= deadline) return "timeout";
    await new Promise((r) => setTimeout(r, pollMs));
  }
}
