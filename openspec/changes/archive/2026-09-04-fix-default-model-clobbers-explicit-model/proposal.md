# Fix: default-model gate clobbers explicitly requested models

## Why

The bridge applies `config.defaultModel` to every brand-new startup session — including sessions that were launched with an explicit `--model <id>` on the pi argv. ~5s after such a child starts, `applyDefaultModel()` overwrites the caller's chosen model with the operator's default. Reported upstream as [issue #595](https://github.com/BlackBeltTechnology/pi-agent-dashboard/issues/595) for `pi-subagents` children (agent model `newapi/MiniMax-M3` clobbered by default `glm-5.3-flash`, failing the subagent's model verification), but the flaw is general: every spawner that passes `--model` is affected — pi-subagents children, automation-plugin run spawns (`SessionOptions.model`), worktree init hooks (`hook.run.model`, `worktree-init.ts:342`), and a user running `pi --model X` under the dashboard. Plain pi CLI keeps the explicit model; the dashboard bridge must behave identically.

## What Changes

- `shouldApplyDefaultModel` (`packages/extension/src/bridge-default-model-gate.ts`) gains a `hasExplicitModel` input and returns false when it is true — a "default" never overrides an explicit choice.
- The `session_start` call site in `packages/extension/src/bridge.ts` derives the signal from the process argv (`process.argv.includes("--model")` — the bridge runs inside the pi process, so argv is pi's argv; `--models` is a distinct token and there is no `-m` alias).
- The deferred retry path (`onProviderChanged` → `pendingDefaultModel` re-apply) needs no separate guard: the gated entry point never sets `pendingDefaultModel` for explicit-model sessions.
- No change to `pi-subagents` and no reliance on the `PI_SUBAGENT_CHILD` env contract proposed in the issue — the argv signal covers all affected spawn paths, not just subagent children.
- **Scope note — in-process subagent sessions are out of scope.** Subagent sessions created in-process via `createAgentSession` (e.g. the foreground `pi-dashboard-subagents` Agent tool) do not reach the gate in the normal case: `initBridge` (`bridge.ts:~200`) skips initialization when the bridge is already active for a different pi instance in the same process. (If the parent bridge failed to initialize, an in-process child could still init and hit the gate — a pre-existing edge outside this change's scope.) The reported case (issue #595 evidence: `pi --mode json --model …` argv, `PI_SUBAGENT_CHILD=1` env, per-run `events.jsonl`) is a child **process**, where argv carries `--model`.
- **Intended coupling:** skipping the default model for explicit-model sessions also skips `config.defaultThinkingLevel` (it is applied only inside `applyDefaultModel()`'s success branch). This is deliberate CLI parity — plain `pi --model X` gets no dashboard thinking-level either, and spawners express thinking via the `provider/id:<thinking>` model suffix.
- **Accepted argv edge cases** (rare, all fail-safe — they skip the default rather than clobber): a dangling `pi --model` with no value skips the dashboard default (pi applies its own saved default); a literal `"--model"` positional after `--` false-positives; a `--model` token swallowed as another flag's value (e.g. `pi --name --model`) false-positives. All accepted as trade-offs; no mitigation. The derivation lives in a small pure helper (`hasExplicitModelArg(argv)`) so it is directly unit-testable.
- Note on the issue's "two bridge copies" claim: `packages/extension` IS the published `@blackbelt-technology/pi-dashboard-extension` package — one source, release-lagged. Fixing here and cutting a release fixes both observed copies.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `bridge-default-model-gate`: new requirement — the gate SHALL NOT apply the default model when the session was launched with an explicit `--model` argument; existing brand-new-session behavior without `--model` is unchanged.

## Impact

- `packages/extension/src/bridge-default-model-gate.ts` — new required predicate input (+ pure `hasExplicitModelArg(argv)` helper); all existing `DefaultModelGateInput` constructions in tests must be migrated (`npm run lint` = `tsc --noEmit` gates this).
- `packages/extension/src/bridge.ts` — one call site passes the argv-derived signal.
- `packages/extension/src/__tests__/bridge-default-model-gate.test.ts` — new cases.
- Regression surface that must stay unchanged: fresh human-opened dashboard session (no `--model`) still gets `config.defaultModel` (+ `defaultThinkingLevel`); resume/fork/reload still keep their model.
- Ships to users via a release of `@blackbelt-technology/pi-dashboard-extension`.

## Discipline Skills

- `review-code` — non-trivial behavior change on the bridge startup path; run before commit.
- No other checkpoints apply: no auth/untrusted input/secrets (`security-hardening` n/a), no latency budget (`performance-optimization` n/a), no new endpoint/job (`observability-instrumentation` n/a).
