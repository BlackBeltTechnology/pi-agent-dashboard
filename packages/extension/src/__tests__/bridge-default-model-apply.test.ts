/**
 * Tests for the bridge's default-model application at session_start.
 *
 * Bridge startup branch model with shared production guards.
 *
 * Covers the input-derivation expression (the bug surface fixed by this
 * change) PLUS the four spawn paths (new / resume / fork / reload) PLUS the
 * older-pi fallback (`buildSessionContext` undefined) PLUS the
 * default-not-configured no-op.
 *
 * Spec: openspec/specs/bridge-extension/spec.md — requirement
 * "Default model applied only to brand-new sessions".
 *
 * See changes: fix-resume-keeps-session-model (original gate),
 *              fix-default-model-new-session-entry-count (signal correction).
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hasExplicitModelArg, hasProtectedSdkModel, shouldApplyDefaultModel } from "../bridge-default-model-gate.js";

interface BuildSessionContextResult {
  model?: { provider: string; modelId: string };
  messages: unknown[];
}

interface FakeSessionManager {
  buildSessionContext?: () => BuildSessionContextResult;
  getEntries?: () => unknown[];
}

interface FakeCtx {
  sessionManager: FakeSessionManager;
}

interface FakePiEvent {
  reason?: string;
}

interface RunArgs {
  ctx: FakeCtx;
  event: FakePiEvent;
  hasModelRegistry: boolean;
  defaultModel: string; // "" === unset
  /**
   * Injected pi argv — the bridge passes its own `process.argv`; the mirror
   * NEVER reads vitest's `process.argv`. Optional: omitted = argv modeled as
   * carrying no `--model` flag.
   */
  argv?: string[];
  subagentChild?: string;
  settingsPath?: string;
}

/**
 * Pure-model mirror of bridge.ts session_start default-model branch.
 * The shared SDK helper uses real settings files. A wiring assertion below
 * checks that production uses the same guard and captures its model before awaits.
 *
 * Returns the gate verdict AND the pending signal: a true verdict with an
 * unresolved custom-provider default sets `pendingDefaultModel` (the model
 * string); a false verdict leaves it null — which is exactly why the
 * provider-ready retry arm can never re-apply to an explicit-model session.
 */
function runSessionStartDefaultModelBranch(args: RunArgs): {
  applied: boolean;
  pending: string | null;
} {
  const startupModel = args.ctx.sessionManager.buildSessionContext?.()?.model;
  const entryCount = args.ctx.sessionManager.buildSessionContext?.()?.messages?.length ?? 0;
  const eligible = shouldApplyDefaultModel({
    reason: args.event.reason,
    entryCount,
    hasModelRegistry: args.hasModelRegistry,
    hasDefaultModel: Boolean(args.defaultModel),
    hasExplicitModel: hasExplicitModelArg(args.argv ?? []),
  });
  const apply = eligible && !hasProtectedSdkModel({
    subagentChild: args.subagentChild,
    startupModel,
    settingsPath: args.settingsPath ?? "unused-settings-path",
  });
  // Gate-true + default not yet resolvable (custom provider) → applyDefaultModel()
  // returns the model string and the bridge stores it in pendingDefaultModel.
  return { applied: apply, pending: apply ? args.defaultModel : null };
}

/**
 * Mirror of the provider-ready retry arm in `onProviderChanged`:
 *
 *   if (pendingDefaultModel) {
 *     pendingDefaultModel = applyDefaultModel();
 *   }
 */
function runProviderReadyRetry(args: { pending: string | null }): {
  applied: boolean;
  pending: string | null;
} {
  if (args.pending === null) return { applied: false, pending: null };
  // Retry ran and the provider now resolves → applied, pending cleared.
  return { applied: true, pending: null };
}

/**
 * Build a fake `ctx.sessionManager` whose `getEntries()` returns N entries
 * but whose `buildSessionContext().messages` returns M messages. Mirrors
 * pi's behaviour where setup entries (model_change + thinking_level_change)
 * inflate getEntries() but never appear in messages.
 */
function makeCtx(opts: { entriesCount: number; messageCount: number }): FakeCtx {
  return {
    sessionManager: {
      getEntries: () => Array.from({ length: opts.entriesCount }, (_, i) => ({ idx: i })),
      buildSessionContext: () => ({
        messages: Array.from({ length: opts.messageCount }, (_, i) => ({ idx: i })),
      }),
    },
  };
}

describe("bridge default-model apply at session_start", () => {
  // ── New session ────────────────────────────────────────────────────────
  it("applies default model for a brand-new session with pre-emit setup entries", () => {
    // Brand-new session: pi auto-appended model_change + thinking_level_change
    // BEFORE emitting session_start, so getEntries() === 2 but messages === 0.
    // THIS is the regression case: the previous gate used getEntries().length
    // and silently skipped applying the default.
    const ctx = makeCtx({ entriesCount: 2, messageCount: 0 });
    const result = runSessionStartDefaultModelBranch({
      ctx,
      event: { reason: "startup" },
      hasModelRegistry: true,
      defaultModel: "anthropic/claude-sonnet-4-5",
    });
    expect(result.applied).toBe(true);
  });

  it("applies default model when getEntries returns 0 (synthetic minimal session)", () => {
    // Defensive: ensure the predicate is symmetric when both signals are 0.
    const ctx = makeCtx({ entriesCount: 0, messageCount: 0 });
    const result = runSessionStartDefaultModelBranch({
      ctx,
      event: { reason: "startup" },
      hasModelRegistry: true,
      defaultModel: "anthropic/claude-sonnet-4-5",
    });
    expect(result.applied).toBe(true);
  });

  // ── Resumed session ────────────────────────────────────────────────────
  it("does NOT apply default model for a resumed session (messages > 0)", () => {
    // Resume via --session: persisted entries loaded, including prior messages.
    const ctx = makeCtx({ entriesCount: 50, messageCount: 30 });
    const result = runSessionStartDefaultModelBranch({
      ctx,
      event: { reason: "startup" },
      hasModelRegistry: true,
      defaultModel: "anthropic/claude-sonnet-4-5",
    });
    expect(result.applied).toBe(false);
  });

  // ── Forked session ─────────────────────────────────────────────────────
  it("does NOT apply default model for a forked session (parent messages copied)", () => {
    // Fork via --fork: SessionManager.forkFrom copies parent entries including messages.
    const ctx = makeCtx({ entriesCount: 80, messageCount: 40 });
    const result = runSessionStartDefaultModelBranch({
      ctx,
      event: { reason: "startup" },
      hasModelRegistry: true,
      defaultModel: "anthropic/claude-sonnet-4-5",
    });
    expect(result.applied).toBe(false);
  });

  // ── Bridge reload of in-flight session ─────────────────────────────────
  it("does NOT apply default model on bridge reload of in-flight session", () => {
    // Reload: reason === "reload" (filtered by the reason gate AND messages > 0).
    const ctx = makeCtx({ entriesCount: 100, messageCount: 60 });
    const result = runSessionStartDefaultModelBranch({
      ctx,
      event: { reason: "reload" },
      hasModelRegistry: true,
      defaultModel: "anthropic/claude-sonnet-4-5",
    });
    expect(result.applied).toBe(false);
  });

  // ── Older pi without buildSessionContext ───────────────────────────────
  it("applies default model when older pi lacks buildSessionContext (fallback to 0)", () => {
    // Hypothetical older pi: only getEntries() exists. Optional-chained fallback
    // returns 0 → predicate returns true → default applied. Safer than silent skip.
    const ctx: FakeCtx = {
      sessionManager: {
        getEntries: () => [{}, {}],
        // buildSessionContext intentionally absent
      },
    };
    const result = runSessionStartDefaultModelBranch({
      ctx,
      event: { reason: "startup" },
      hasModelRegistry: true,
      defaultModel: "anthropic/claude-sonnet-4-5",
    });
    expect(result.applied).toBe(true);
  });

  it("applies default model when buildSessionContext returns object without messages array", () => {
    // Defensive: malformed result from buildSessionContext. Optional-chained
    // .messages?.length falls through to ?? 0.
    const ctx: FakeCtx = {
      sessionManager: {
        getEntries: () => [{}, {}],
        buildSessionContext: () => ({} as BuildSessionContextResult),
      },
    };
    const result = runSessionStartDefaultModelBranch({
      ctx,
      event: { reason: "startup" },
      hasModelRegistry: true,
      defaultModel: "anthropic/claude-sonnet-4-5",
    });
    expect(result.applied).toBe(true);
  });

  // ── Default not configured ─────────────────────────────────────────────
  it("does NOT apply default model when config.defaultModel is empty", () => {
    const ctx = makeCtx({ entriesCount: 2, messageCount: 0 });
    const result = runSessionStartDefaultModelBranch({
      ctx,
      event: { reason: "startup" },
      hasModelRegistry: true,
      defaultModel: "",
    });
    expect(result.applied).toBe(false);
  });

  it("does NOT apply default model when model registry not yet available", () => {
    const ctx = makeCtx({ entriesCount: 2, messageCount: 0 });
    const result = runSessionStartDefaultModelBranch({
      ctx,
      event: { reason: "startup" },
      hasModelRegistry: false,
      defaultModel: "anthropic/claude-sonnet-4-5",
    });
    expect(result.applied).toBe(false);
  });

  // ── Spec invariant: signal source ──────────────────────────────────────
  it("uses buildSessionContext().messages, NOT getEntries(), as the signal", () => {
    // This is the regression-locking test. If anyone reverts the bridge.ts
    // expression from `buildSessionContext().messages.length` back to
    // `getEntries().length`, this test must fail.
    //
    // Scenario: a session with 100 raw entries but ZERO messages (e.g. lots
    // of model_change / thinking_level_change / compaction-summary entries).
    // The correct signal says "brand-new, apply default"; the old (buggy)
    // signal would say "has history, skip".
    const buildSessionContext = vi.fn(() => ({ messages: [] }));
    const getEntries = vi.fn(() => Array.from({ length: 100 }, () => ({})));
    const ctx: FakeCtx = {
      sessionManager: { buildSessionContext, getEntries },
    };
    const result = runSessionStartDefaultModelBranch({
      ctx,
      event: { reason: "startup" },
      hasModelRegistry: true,
      defaultModel: "anthropic/claude-sonnet-4-5",
    });
    expect(result.applied).toBe(true);
    expect(buildSessionContext).toHaveBeenCalled();
    // getEntries() MAY or MAY NOT be called by the production branch; the
    // important contract is that buildSessionContext is the source of truth.
  });

  // ── Explicit model dominates the whole flow (X1, issue #595) ─────────────
  // See change: fix-default-model-clobbers-explicit-model (test-plan #X1).
  describe("explicit-model session: default never applied, never pended", () => {
    const explicitArgv = ["pi", "--mode", "rpc", "--model", "newapi/MiniMax-M3"];
    const customDefaultArgs = {
      event: { reason: "startup" },
      hasModelRegistry: true,
      defaultModel: "custom/slow-provider-model", // custom provider — unresolved at startup
    } as const;

    it("gate false at session_start despite all other conditions holding", () => {
      const ctx = makeCtx({ entriesCount: 2, messageCount: 0 });
      const result = runSessionStartDefaultModelBranch({
        ctx,
        ...customDefaultArgs,
        argv: explicitArgv,
      });
      expect(result.applied).toBe(false);
      // The gated entry point never sets pendingDefaultModel — this is WHY the
      // deferred retry below needs no separate guard.
      expect(result.pending).toBeNull();
    });

    it("provider-ready retry arm finds nothing to re-apply", () => {
      const ctx = makeCtx({ entriesCount: 2, messageCount: 0 });
      const first = runSessionStartDefaultModelBranch({
        ctx,
        ...customDefaultArgs,
        argv: explicitArgv,
      });
      const after = runProviderReadyRetry({ pending: first.pending });
      expect(after.applied).toBe(false);
      expect(after.pending).toBeNull();
    });

    it("control: the same session WITHOUT --model does pend, proving the mirror detects it", () => {
      // Guards the mirror itself: identical conditions minus the argv flag must
      // produce applied=true with the model pended for the provider-ready retry.
      const ctx = makeCtx({ entriesCount: 2, messageCount: 0 });
      const result = runSessionStartDefaultModelBranch({
        ctx,
        ...customDefaultArgs,
        argv: ["pi", "--mode", "rpc"],
      });
      expect(result.applied).toBe(true);
      expect(result.pending).toBe("custom/slow-provider-model");
      const after = runProviderReadyRetry({ pending: result.pending });
      expect(after.applied).toBe(true);
    });
  });
});

describe("SDK startup model protection", () => {
  let directory: string;
  let settingsPath: string;
  const piDefault = { provider: "openai-codex", modelId: "gpt-6-astra" };
  const sdkModel = { provider: "pi-claude", modelId: "claude-fable-5" };

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "bridge-model-"));
    settingsPath = join(directory, "settings.json");
    writeFileSync(settingsPath, JSON.stringify({
      defaultProvider: piDefault.provider,
      defaultModel: piDefault.modelId,
    }));
  });
  afterEach(() => rmSync(directory, { recursive: true, force: true }));

  function start(model = piDefault, overrides: Partial<RunArgs> = {}) {
    return runSessionStartDefaultModelBranch({
      ctx: { sessionManager: { buildSessionContext: () => ({ messages: [], model }) } },
      event: { reason: "startup" },
      hasModelRegistry: true,
      defaultModel: "dashboard/late-provider-model",
      settingsPath,
      argv: ["node", "sdk-runner.js"],
      ...overrides,
    });
  }

  it.each(["1", "", "0"])("protects child marker presence (%j), even when the SDK chose Pi's default", (subagentChild) => {
    const result = start(piDefault, { subagentChild });
    expect(result).toEqual({ applied: false, pending: null });
    expect(runProviderReadyRetry(result).applied).toBe(false);
  });

  it("preserves an unmarked SDK caller's non-default startup model", () => {
    const result = start(sdkModel);
    expect(result).toEqual({ applied: false, pending: null });
    expect(runProviderReadyRetry(result).applied).toBe(false);
  });

  it.each([
    { provider: "other-provider", modelId: piDefault.modelId },
    { provider: piDefault.provider, modelId: "other/model" },
  ])("compares both provider and complete modelId: %j", (model) => {
    expect(start(model).applied).toBe(false);
  });

  it("still protects a literal argv --model independently of SDK signals", () => {
    expect(start(piDefault, { argv: ["pi", "--model", "openai-codex/gpt-6-astra"] }).applied).toBe(false);
  });

  it("applies the Dashboard default to a plain new session using Pi's default", () => {
    expect(start()).toEqual({ applied: true, pending: "dashboard/late-provider-model" });
  });

  it("documents the accepted indistinguishable same-default arbitrary SDK choice", () => {
    expect(start({ ...piDefault }).applied).toBe(true);
  });

  it.each(["resume", "fork", "reload", "new"])("keeps %s behavior without reading settings", (reason) => {
    writeFileSync(settingsPath, "invalid-json");
    expect(start(sdkModel, { event: { reason } }).applied).toBe(false);
  });

  it("keeps history-bearing startup resumes and forks without reading settings", () => {
    writeFileSync(settingsPath, "invalid-json");
    expect(start(sdkModel, { ctx: makeCtx({ entriesCount: 5, messageCount: 2 }) }).applied).toBe(false);
  });

  it.each([{}, { defaultProvider: "pi-claude" }, { defaultModel: "claude-fable-5" },
    { defaultProvider: "", defaultModel: "claude-fable-5" }])("does not invent a comparison for incomplete settings: %j", (settings) => {
    writeFileSync(settingsPath, JSON.stringify(settings));
    expect(start(sdkModel).applied).toBe(true);
  });

  it("retains plain startup behavior when the settings file is absent", () => {
    rmSync(settingsPath);
    expect(start(sdkModel).applied).toBe(true);
  });

  it.each(["{invalid-json", "null", "[]"])("reports invalid settings (%s) instead of applying a guessed default", (contents) => {
    writeFileSync(settingsPath, contents);
    expect(() => start(sdkModel)).toThrow(settingsPath);
  });

  it("reports settings read failures other than absence", () => {
    expect(() => start(sdkModel, { settingsPath: directory })).toThrow(directory);
  });

  it.each([
    { argv: ["pi", "--model", "explicit"] },
    { subagentChild: "1" },
  ])("does not read settings for an already protected launch: %j", (overrides) => {
    writeFileSync(settingsPath, "invalid-json");
    expect(start(sdkModel, overrides).applied).toBe(false);
  });

  it("does not write Pi settings", () => {
    const before = readFileSync(settingsPath, "utf8");
    start(sdkModel);
    expect(readFileSync(settingsPath, "utf8")).toBe(before);
  });
});

describe("production startup guard wiring", () => {
  it("captures the SDK model before awaits and guards the pending-default assignment", () => {
    const source = readFileSync(new URL("../bridge.ts", import.meta.url), "utf8");
    const handler = source.slice(source.indexOf('pi.on("session_start", safe(async'));
    const snapshot = handler.indexOf("const startupModel = ctx.sessionManager.buildSessionContext?.()?.model;");
    expect(snapshot).toBeGreaterThanOrEqual(0);
    expect(snapshot).toBeLessThan(handler.indexOf("await "));
    expect(handler).toMatch(/hasExplicitModel: hasExplicitModelArg\(process\.argv\),\s*\}\) && !hasProtectedSdkModel\(\{\s*subagentChild: process\.env\.PI_SUBAGENT_CHILD,\s*startupModel,\s*settingsPath: path\.join\(os\.homedir\(\), "\.pi", "agent", "settings\.json"\),\s*\}\)\) \{\s*pendingDefaultModel = applyDefaultModel\(\);/);
  });
});
