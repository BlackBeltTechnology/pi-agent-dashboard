/**
 * Plugin `spawnSession` hook, with the optional `worktree` block.
 *
 * Extracted from `server.ts` so the whole flow can be driven with injected deps:
 * trust gate → option validation → (worktree) create-or-reuse + init → file the
 * plugin ref / queue the prompt and attach intents → spawn → watchdog / PID
 * registry → rollback on failure. A spawn with a `worktree` block re-keys every
 * cwd-keyed step onto the worktree path; a failure before the spawn leaves no
 * queued intent and NEVER falls back to `cwd`. A bare `mode: "worktree"` (no
 * block) keeps the documented local fallback.
 *
 * See change: add-plugin-spawn-worktree (design D2, D5, D6, D7).
 */
import type {
  PluginSessionLifecycle,
  PluginSpawnOptions,
  PluginSpawnResult,
  PluginSpawnWorktreeCode,
} from "@blackbelt-technology/dashboard-plugin-runtime/server";
import type { EnsureWorktreeOptions, EnsureWorktreeResult } from "../git-worktree/ensure-worktree.js";
import type { StartWorktreeInitOptions, StartWorktreeInitResult } from "../git-worktree/start-worktree-init.js";
import { mapPluginSpawnOptions } from "./plugin-spawn-choice.js";

/** The slice of a `spawnPiSession` / `spawnAcpSession` result the hook reads. */
interface PluginSpawnProcessResult {
  success: boolean;
  message?: string;
  spawnToken?: string;
  pid?: number;
  process?: unknown;
  logPath?: string;
  keeperSockPath?: string;
}

export interface PluginSpawnHookDeps {
  plugin: { id: string; priority?: number };
  defaultModel: () => string | undefined;
  mintSpawnToken: () => string;
  validateAcp: (opts: PluginSpawnOptions) => string | null | undefined;
  pendingPluginRefRegistry: {
    has(token: string): boolean;
    file(token: string, ref: unknown, ownerId: string, lifecycle?: PluginSessionLifecycle): unknown;
    remove(token: string): unknown;
  };
  pendingInitialPromptRegistry: { enqueue(cwd: string, prompt: string): unknown; withdraw(cwd: string, prompt: string): unknown };
  pendingAttachRegistry: { enqueue(cwd: string, changeName: string): boolean; withdraw(cwd: string, changeName: string): unknown };
  spawnPi: (cwd: string, opts: Record<string, unknown>) => Promise<PluginSpawnProcessResult>;
  spawnAcp: (cwd: string, opts: { agent: string; spawnToken: string }) => Promise<PluginSpawnProcessResult>;
  armWatchdog: (cwd: string, result: PluginSpawnProcessResult) => void;
  registerHeadlessPid: (pid: number, cwd: string, child: unknown, spawnToken: string, result: PluginSpawnProcessResult) => void;
  /** Create-or-reuse; the wiring supplies known-folder admission. */
  ensureWorktree: (opts: Pick<EnsureWorktreeOptions, "cwd" | "branch" | "base" | "ifExists" | "checkTarget">) => Promise<EnsureWorktreeResult>;
  /** Host cwd-policy floor for a path; compared (not interpreted) between the target and the spawn cwd. */
  resolveCwdPolicy: (cwd: string) => unknown;
  /** The `autoInitWorktreeOnSpawn` preference. */
  autoInitEnabled: () => boolean;
  startWorktreeInit: (cwd: string, opts: StartWorktreeInitOptions) => Promise<StartWorktreeInitResult>;
  /** Wait for a run another trigger started; defaults to "proceed". */
  awaitInitRun?: (cwd: string) => Promise<"done" | "failed" | "timeout">;
  log?: (line: string) => void;
  warn?: (line: string) => void;
}

const CHANGE_NAME = /^[a-z0-9][a-z0-9-]{0,99}$/;

interface WorktreeBlock {
  branch: string;
  base?: string;
  ifExists: "reuse" | "fail";
  attachChange?: string;
}

/** Shape check of the untrusted `worktree` value (design D3); returns the block or a reason. */
function parseWorktreeBlock(value: unknown): { block: WorktreeBlock } | { reason: string } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return { reason: "worktree must be an object" };
  const v = value as Record<string, unknown>;
  if (typeof v.branch !== "string" || v.branch.length === 0) return { reason: "worktree.branch must be a non-empty string" };
  if (v.ifExists !== "reuse" && v.ifExists !== "fail") return { reason: 'worktree.ifExists must be "reuse" or "fail"' };
  if (v.base !== undefined && typeof v.base !== "string") return { reason: "worktree.base must be a string" };
  if (v.attachChange !== undefined && (typeof v.attachChange !== "string" || !CHANGE_NAME.test(v.attachChange))) {
    return { reason: "worktree.attachChange must be a kebab-case change name" };
  }
  return {
    block: {
      branch: v.branch,
      ifExists: v.ifExists,
      ...(v.base !== undefined ? { base: v.base as string } : {}),
      ...(v.attachChange !== undefined ? { attachChange: v.attachChange as string } : {}),
    },
  };
}

/** Key-order-insensitive JSON, so two equal floors compare equal however they were merged. */
function stable(value: unknown): string {
  return JSON.stringify(value, (_k, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1)))
      : v,
  );
}

const fail = (code: PluginSpawnWorktreeCode, message: string): PluginSpawnResult => ({ success: false, code, message });

interface PreparedWorktree {
  path: string;
  branch: string;
  created: boolean;
}

/**
 * Create-or-reuse the worktree, then run its init when auto-init is on (design D6). Runs BEFORE
 * anything is filed or queued, so a failure leaves no intent. An untrusted hook is never run.
 */
async function prepareWorktree(
  deps: PluginSpawnHookDeps,
  opts: PluginSpawnOptions,
  block: WorktreeBlock,
  log: (line: string) => void,
): Promise<{ worktree: PreparedWorktree } | { failure: PluginSpawnResult }> {
  const logLine = (state: string, code?: string) =>
    log(`[plugin-spawn] worktree ${state} plugin=${deps.plugin.id} branch=${JSON.stringify(block.branch)}${code ? ` code=${code}` : ""}`);
  const ensured = await deps.ensureWorktree({
    cwd: opts.cwd,
    branch: block.branch,
    ...(block.base !== undefined ? { base: block.base } : {}),
    ifExists: block.ifExists,
    checkTarget: (target) => stable(deps.resolveCwdPolicy(target)) === stable(deps.resolveCwdPolicy(opts.cwd)),
  });
  if (!ensured.ok) {
    logLine("failed", ensured.code);
    return { failure: fail(ensured.code, ensured.message) };
  }
  const initFailure = deps.autoInitEnabled() ? await runInit(deps, ensured.path) : undefined;
  if (initFailure !== undefined) {
    logLine("failed", "init_failed");
    return { failure: fail("init_failed", initFailure) };
  }
  logLine(ensured.created ? "created" : "reused");
  return { worktree: { path: ensured.path, branch: ensured.branch, created: ensured.created } };
}

/** Start (and await) the worktree init; returns a failure message, or undefined when the spawn may proceed. */
async function runInit(deps: PluginSpawnHookDeps, cwd: string): Promise<string | undefined> {
  try {
    const started = await deps.startWorktreeInit(cwd, { skipIfRunning: true });
    if (started.status === "failed") return started.hint;
    if (started.status === "already_running") {
      const phase = (await deps.awaitInitRun?.(cwd)) ?? "done";
      if (phase === "timeout") return "worktree init is still running";
      if (phase === "failed") return "worktree init failed";
    }
    // `untrusted` is never run: the spawn proceeds and init stays pending, as for a dialog spawn.
    return undefined;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

/** Root-option checks that run before anything else; a result means "refuse". */
function rejectBadOptions(deps: PluginSpawnHookDeps, opts: PluginSpawnOptions): PluginSpawnResult | undefined {
  if ((deps.plugin.priority ?? 1000) > 100) {
    return { success: false, message: `spawn not permitted for plugin "${deps.plugin.id}"` };
  }
  // Validate the untrusted root options object BEFORE mapping or dereferencing `opts.pluginRef`/`opts.cwd`.
  // A JS plugin can call `spawnSession(null)` or omit `cwd`; reject both with a structured result.
  if (typeof opts !== "object" || opts === null) return { success: false, message: "spawn options must be an object" };
  if (typeof opts.cwd !== "string" || opts.cwd.length === 0) {
    return { success: false, message: "spawn options require a non-empty cwd" };
  }
  // ACP agent spawn: validate BEFORE anything is filed or spawned. See change: add-acp-session-driver (D14).
  const acpRejection = deps.validateAcp(opts);
  return acpRejection ? { success: false, message: acpRejection } : undefined;
}

/**
 * Honour a caller-supplied spawn token VERBATIM (trusted-only). A token already pending for ANY owner is
 * rejected via the non-destructive `has()` probe. Otherwise mint up front so the ownership ref is filed
 * against it BEFORE the spawn await. See change: detach-automation-goal-from-core.
 */
function resolveSpawnToken(deps: PluginSpawnHookDeps, opts: PluginSpawnOptions): { token: string } | { failure: PluginSpawnResult } {
  const requested = typeof opts.spawnToken === "string" ? opts.spawnToken : "";
  if (requested?.includes("\0")) return { failure: { success: false, message: "spawnToken must not contain NUL" } };
  const token = requested || deps.mintSpawnToken();
  if (requested && deps.pendingPluginRefRegistry.has(token)) {
    return { failure: { success: false, message: `spawnToken "${token}" is already pending for another spawn` } };
  }
  return { token };
}

/** Build the `spawnSession` hook of one plugin context. */
export function createPluginSpawnHook(deps: PluginSpawnHookDeps): (opts: PluginSpawnOptions) => Promise<PluginSpawnResult> {
  const log = deps.log ?? ((l: string) => console.log(l));
  const warn = deps.warn ?? ((l: string) => console.warn(l));

  return async (opts) => {
    const rejected = rejectBadOptions(deps, opts);
    if (rejected) return rejected;
    // Worktree block (design D2/D3): honoured only together with `mode: "worktree"`. A bare
    // `mode: "worktree"` keeps the documented local fallback.
    let block: WorktreeBlock | undefined;
    if (opts.mode !== "worktree" && opts.worktree !== undefined) {
      warn(`[plugin-spawn] plugin=${deps.plugin.id} passed a worktree block without mode "worktree"; ignoring it and running in-place`);
    }
    if (opts.mode === "worktree" && opts.worktree !== undefined) {
      const parsed = parseWorktreeBlock(opts.worktree);
      if ("reason" in parsed) {
        log(`[plugin-spawn] worktree failed plugin=${deps.plugin.id} branch=(invalid) code=invalid_block`);
        return fail("invalid_block", parsed.reason);
      }
      block = parsed.block;
    }
    // Literal model passes through; `@role` resolves once; a dropped choice is reported in
    // `warning`. See change: add-spawn-model-choice.
    const { options: sessionOptions, warning: choiceWarning } = mapPluginSpawnOptions(opts, {
      defaultModel: deps.defaultModel() || undefined,
    });
    const minted = resolveSpawnToken(deps, opts);
    if ("failure" in minted) return minted.failure;
    const spawnToken = minted.token;

    let spawnCwd = opts.cwd;
    let worktree: PreparedWorktree | undefined;
    if (block) {
      const prepared = await prepareWorktree(deps, opts, block, log);
      if ("failure" in prepared) return prepared.failure;
      worktree = prepared.worktree;
      spawnCwd = worktree.path;
    }

    deps.pendingPluginRefRegistry.file(spawnToken, opts.pluginRef, deps.plugin.id, opts.lifecycle);
    // Fresh-spawn reprime rides the per-cwd pending-initial-prompt FIFO exactly as core's own respawn
    // path does: enqueue BEFORE the spawn await, withdraw on failure/throw so a dead spawn leaves no
    // stale intent for an unrelated later register in the same cwd. See change: relocate-goal-product-to-plugin (D1-#3).
    const initialPrompt =
      typeof opts.initialPrompt === "string" && opts.initialPrompt.length > 0 ? opts.initialPrompt : undefined;
    if (initialPrompt) deps.pendingInitialPromptRegistry.enqueue(spawnCwd, initialPrompt);
    // Attach intent, identical to the dialog's `attachProposal`; no `gitWorktreeBase` (dialog-only).
    const attachChange = block?.attachChange;
    const attachQueued = attachChange ? deps.pendingAttachRegistry.enqueue(spawnCwd, attachChange) : false;
    const attachWarning = attachChange && !attachQueued ? "attach queue full; session not attached" : undefined;
    // Bare `mode: "worktree"` / a non-default sandbox are not enforced by the host hook (4.2 limitation).
    if ((opts.mode === "worktree" && !block) || (opts.sandbox && opts.sandbox !== "workspace-write")) {
      warn(
        `[plugin-spawn] mode=${opts.mode ?? "local"} sandbox=${opts.sandbox ?? "(default)"} requested but not yet enforced by the host hook; running in-place at ${opts.cwd}`,
      );
    }
    const rollback = () => {
      deps.pendingPluginRefRegistry.remove(spawnToken);
      if (initialPrompt) deps.pendingInitialPromptRegistry.withdraw(spawnCwd, initialPrompt);
      if (attachQueued && attachChange) deps.pendingAttachRegistry.withdraw(spawnCwd, attachChange);
    };
    try {
      const result =
        typeof opts.agent === "string"
          ? await deps.spawnAcp(spawnCwd, { agent: opts.agent, spawnToken })
          : await deps.spawnPi(spawnCwd, { ...sessionOptions, spawnToken });
      // Plugin/automation spawn: transport-less, reclaim required.
      deps.armWatchdog(spawnCwd, result);
      if (result.process && result.pid) {
        deps.registerHeadlessPid(result.pid, spawnCwd, result.process, result.spawnToken ?? spawnToken, result);
      }
      // Token-keyed, idempotent rollback on failure so no later session resolves a stale ref.
      if (!result.success) rollback();
      const warnings = result.success ? [choiceWarning, attachWarning].filter(Boolean) : [];
      return {
        success: result.success,
        message: result.message,
        ...(result.spawnToken ? { spawnToken: result.spawnToken } : { spawnToken }),
        ...(warnings.length > 0 ? { warning: warnings.join("; ") } : {}),
        ...(result.success && worktree ? { worktreePath: worktree.path, branch: worktree.branch, created: worktree.created } : {}),
      };
    } catch (err) {
      rollback();
      return { success: false, message: err instanceof Error ? err.message : String(err) };
    }
  };
}
