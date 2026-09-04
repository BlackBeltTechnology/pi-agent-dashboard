/**
 * Pure gate predicate for the bridge's default-model application.
 *
 * Decides whether the bridge should call `pi.setModel()` with `config.defaultModel`
 * at `session_start` time.
 *
 * Rule: apply default only on brand-new sessions (no prior message history).
 * Resumed (`--session`), forked (`--fork`, parent messages copied by
 * `SessionManager.forkFrom`), and reloaded sessions all have messages > 0 and
 * SHALL keep their existing model. Mirrors pi's own `!hasExistingSession`
 * gate (`pi-coding-agent/dist/core/sdk.js:106` —
 * `existingSession.messages.length > 0`).
 *
 * Signal derivation: `ctx.sessionManager.buildSessionContext().messages.length`,
 * NOT the raw `getEntries()` count. Pi's sdk.js auto-appends `model_change` and
 * `thinking_level_change` setup entries to a brand-new session BEFORE emitting
 * `session_start`, so `getEntries()` is ≥ 2 even for sessions with no user
 * history; only `buildSessionContext().messages` correctly distinguishes
 * "brand-new" from "has history".
 *
 * See changes: fix-resume-keeps-session-model (original gate),
 *              fix-default-model-new-session-entry-count (signal correction).
 */
/**
 * Inputs to {@link shouldApplyDefaultModel}.
 */
export interface DefaultModelGateInput {
  /** `event.reason` from the pi `session_start` event. */
  reason: string | undefined;
  /**
   * Count of `message` entries from
   * `ctx.sessionManager.buildSessionContext().messages`. Mirrors pi's own
   * `hasExistingSession` predicate. NOT the raw `getEntries()` count — pi
   * auto-appends `model_change` + `thinking_level_change` setup entries
   * before `session_start`. Field name kept as `entryCount` for diff stability
   * with the original `fix-resume-keeps-session-model` change.
   */
  entryCount: number;
  /** Whether the bridge has captured a model registry from pi yet. */
  hasModelRegistry: boolean;
  /** Whether `config.defaultModel` is set to a non-empty string. */
  hasDefaultModel: boolean;
  /**
   * Whether the pi process was launched with an explicit `--model` argument.
   * An explicit model on the command line is authoritative — a "default"
   * never overrides it. Derive it in the bridge via
   * {@link hasExplicitModelArg}(process.argv).
   * See change: fix-default-model-clobbers-explicit-model (issue #595).
   */
  hasExplicitModel: boolean;
}

/**
 * True when the pi process argv carries an explicit `--model` flag.
 *
 * Exact-token match on `--model`, mirroring pi's own parser (`cli/args.js`:
 * `arg === "--model"`, value in the next argv slot) — the `--model=x` equals
 * form is not a pi flag, `--models` is a distinct flag, and there is no `-m`
 * alias. The bridge runs inside the pi process, so the argv to pass is
 * pi's own `process.argv` — this covers every spawner that passes `--model`
 * (pi-subagents children, automation-plugin run spawns, worktree init hooks,
 * and a user's manual `pi --model X`).
 *
 * Accepted fail-safe false-positives (pinned by tests): a trailing dangling
 * `--model` with no value, a literal `--model` after `--`, and a `--model`
 * swallowed as another flag's value all count as explicit — skipping the
 * dashboard default is always safer than clobbering the caller's choice.
 *
 * See change: fix-default-model-clobbers-explicit-model (issue #595).
 */
export function hasExplicitModelArg(argv: string[]): boolean {
  return argv.includes("--model");
}

export function shouldApplyDefaultModel(args: DefaultModelGateInput): boolean {
  if (args.reason !== "startup") return false;
  if (args.entryCount !== 0) return false;
  if (!args.hasModelRegistry) return false;
  if (!args.hasDefaultModel) return false;
  // An explicit `--model` on the launch command line is the spawner's resolved
  // choice (subagent agent definition, automation run, worktree init hook, or
  // the user) — the configured default never overrides it, matching plain pi
  // CLI behavior. See change: fix-default-model-clobbers-explicit-model.
  if (args.hasExplicitModel) return false;
  return true;
}
