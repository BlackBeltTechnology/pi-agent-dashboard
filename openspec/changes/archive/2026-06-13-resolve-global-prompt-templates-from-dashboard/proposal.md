## Why

Two leftover fixes from the now-archived `fix-slash-dispatch-delivery` change. Its Issues 1 & 2 (delivery param, Path D error feedback) already landed; these two did not.

**Issue A — global prompt templates not resolved.** Prompt templates installed at `~/.pi/agent/prompts/` (e.g. `/session-summary`) cannot be invoked from the dashboard. `resolveTemplate` in `packages/extension/src/prompt-expander.ts` (Step 3 — `pi.getCommands()` fallback) only matches `source: "skill"`. Prompt templates register as `source: "prompt"` and are skipped, so they fall through to the LLM as raw slash text. `pi.getCommands()` already returns every prompt template with its path; the lookup just needs to also accept `source: "prompt"`.

**Issue B — `hasDispatchCommand` misses getter/Proxy-hidden properties.** `packages/extension/src/bridge-context.ts::hasDispatchCommand` uses a pure `typeof (pi as any)?.dispatchCommand === "function"` check. If a future pi exposes `dispatchCommand` via a getter or Proxy trap, the `typeof` access may not resolve it. Add an `in`-operator fallback with a guarded `typeof` on the resolved value. Defensive — no current pi ships `dispatchCommand`.

## What Changes

- **MODIFIED**: `packages/extension/src/prompt-expander.ts` — `resolveTemplate` Step 3 adds a parallel `source: "prompt"` probe alongside the existing `source: "skill"` probe in `pi.getCommands()`, sharing the same candidate-name resolution loop (original-form-first precedence preserved). Uses the entry's path field directly; no fs scanning added.
- **MODIFIED**: `packages/extension/src/bridge-context.ts` — `hasDispatchCommand` gains an `in`-operator fallback for getter-backed / Proxy-hidden `dispatchCommand`.
- **MODIFIED (tests)**: `packages/extension/src/__tests__/prompt-expander.test.ts` — add `source: "prompt"` resolution test. `packages/extension/src/__tests__/extension-slash-command-detection.test.ts` — add `hasDispatchCommand` getter-backed fallback test.

## Impact

- **Affected specs**: `command-routing` (MODIFIED — prompt-template resolution + `hasDispatchCommand` detection).
- **Backward compatibility**: Additive. Skill resolution unchanged. `hasDispatchCommand` still returns `false` when `dispatchCommand` absent. Global prompt templates (`/session-summary`) now expand from the dashboard instead of going to the LLM as raw text. Unrecognized slashes still fall through.

## Depends On

- `fix-slash-dispatch-delivery` (archived 2026-06-12) — landed Issues 1 & 2; this change finishes Decision 3 + Issue 3.
