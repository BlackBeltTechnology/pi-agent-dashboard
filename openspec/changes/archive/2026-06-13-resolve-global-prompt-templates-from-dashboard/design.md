## Context

Salvaged from archived `fix-slash-dispatch-delivery` (Decision 3 + Decision 5). Codebase had diverged: delivery plumbing and Path D error feedback landed via PR #30 and `enable-rpc-keeper-by-default`, but the prompt-template resolution and `hasDispatchCommand` fallback were never applied.

## Decisions

### Decision 1: `resolveTemplate` queries `pi.getCommands()` for `source: "prompt"`

`resolveTemplate` Step 3 adds a parallel probe for `source: "prompt"` immediately after the `source: "skill"` probe, inside the same candidate-name loop so original-form-first precedence holds. `pi.getCommands()` already returns prompt templates (global + project + package), so no directory scan is added; one extra O(n) `.find()` on the same array.

**Path-field correction (found during E2E verification).** Real pi (0.78) `getCommands()` returns the on-disk path under `sourceInfo.path` (a synthetic `SourceInfo` `{ path, source, scope, origin, baseDir }` built by `createSyntheticSourceInfo`), NOT a top-level `c.path`. Verified at `agent-session.js::_bindExtensionCore::getCommands` and `core/source-info.js`. The original guidance here ("use `c.path`; do NOT switch to `sourceInfo.path`") was WRONG for this pi version — both the skill probe and the new prompt probe would have matched `undefined` and silently fallen through, passing raw `/session-summary` to the LLM. Resolution: read the path via `c.sourceInfo?.path ?? c.path` (accepts the real pi shape AND legacy/stub top-level `path`). Unit tests updated to mock the real `sourceInfo` shape; the prior `{ name, source, path }` mocks did not reflect runtime, which is why the bug escaped unit testing.

### Decision 2: `hasDispatchCommand` adds `in`-operator fallback

Keep the fast path `typeof (pi as any)?.dispatchCommand === "function"`. When that is false, fall back to `pi != null && "dispatchCommand" in (pi as object)` with a guarded `typeof` on the resolved value, so getter-backed / Proxy-hidden functions still detect. Still returns `false` for `null`/`undefined` pi and for non-function values. No version-sniffing.

## Non-Goals

- Re-litigating Path D wording (already shipped; keeper is always-on, config knob removed).
- Touching delivery plumbing (landed).
- Directory scanning for prompt templates (`pi.getCommands()` already carries paths).

## References

- Archived `fix-slash-dispatch-delivery` — Decisions 3 & 5.
- `packages/extension/src/prompt-expander.ts` Step 3.
- `packages/extension/src/bridge-context.ts::hasDispatchCommand`.
