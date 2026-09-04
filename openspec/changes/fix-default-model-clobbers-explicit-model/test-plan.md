# Test Plan — fix-default-model-clobbers-explicit-model

Stage: proposal   Generated: 2026-02-10

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | Never override explicit model | decision-table | L1 | automated | gate input `{reason:"startup", entryCount:0, hasModelRegistry:true, hasDefaultModel:true, hasExplicitModel:true}` | `shouldApplyDefaultModel()` | returns `false` — explicit-model condition dominates all-true remainder |
| E2 | Apply default only to brand-new startup (MODIFIED) | decision-table | L1 | automated | same input with `hasExplicitModel:false` | `shouldApplyDefaultModel()` | returns `true` — existing behavior preserved |
| E3 | Never override explicit model (argv derivation) | EP exact-token | L1 | automated | argv arrays: `[..., "--model", "x/y"]`; `[..., "--models", "a,b"]`; argv without token | `hasExplicitModelArg(argv)` | `true`; `false` (`--models` is distinct token); `false` |
| E4 | Never override explicit model (accepted fail-safe false-positives) | EP boundary pins | L1 | automated | argv arrays: trailing dangling `["pi","--model"]`; `["pi","--","--model"]`; `["pi","--name","--model"]` (swallowed as flag value) | `hasExplicitModelArg(argv)` | `true` in all three — documented accepted trade-offs encoded in code, not prose |
| E5 | Apply default only to brand-new startup (MODIFIED, regression) | decision-table | L1 | automated | every pre-existing gate case (`reason≠startup`, `entryCount>0`, no registry, no default) each with `hasExplicitModel:false` | `shouldApplyDefaultModel()` | unchanged results — all `false`; no pre-existing case flips |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | Never override explicit model (deferred re-apply) | state-transition (illegal edge) | L1 | automated | explicit-model session at session_start (gate false) with custom-provider default unresolved | provider-ready event fires later | mirror reports no default applied AND no pending retry was ever set (`pendingDefaultModel` stays null) |
| X2 | Apply default thinking level alongside default model (MODIFIED) | state-transition | L1 | automated | gate false due to `hasExplicitModel:true`, non-empty `config.defaultThinkingLevel` | session_start branch runs | `setThinkingLevel` never called — thinking level skipped together with model |

### Integration (runtime)

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| I1 | Never override explicit model (end-to-end argv wiring) | state-convergence | L3 | automated | harness (`PI_E2E_SEED=1`, `defaultModel: faux/faux-1`) + child pi process launched with explicit `--model faux/faux-2` | session registers; observe ≥8s window (covers the ~5s deferred apply from issue #595) | `GET /api/sessions` (harness-derived port from `.pi-test-harness.json`) reports model `faux-2` for the whole window; no `model_change` to `faux-1` after startup |
| I2 | Apply default only to brand-new startup (end-to-end regression) | state-convergence | L3 | automated | same harness; session spawned WITHOUT `--model` (plain `/api/session/spawn`) | session registers | session converges to `faux/faux-1` (`config.defaultModel` applied) |
| I3 | Never override explicit model (real pi-subagents child, issue #595 §6.1) | exploratory runtime | — | manual-only | agent definition pinning a non-default model, run via the external `pi-subagents` package under a live dashboard | subagent child-process run completes | child's `events.jsonl` reports the agent model, not `config.defaultModel` [judgment: external package, not automatable in this repo's harness] |
| I4 | Never override existing-session models (runtime sweep) | exploratory runtime | — | manual-only | live dashboard with sessions on non-default models | resume, fork, and `/reload` each session | each keeps its model [judgment: release-verification sweep; automated coverage exists at L1 via `entryCount>0` cases] |

---

## Coverage summary

- Requirements covered: 3/3 (MODIFIED brand-new-startup gate, ADDED never-override-explicit incl. deferred re-apply, MODIFIED thinking-level coupling)
- Scenarios by class: edge 5 · perf 0 · frontend 0 · error 2 · integration 4
- Scenarios by level: L1 7 · L2 0 · L3 2 · manual 2
- Scenarios by disposition: automated 9 · manual-only 2

## New infra needed

- `qa/fixtures/faux-provider.ext.ts`: register a second model row `faux-2` (both in `registerFauxProvider` models and `pi.registerProvider` models) so an explicit non-default `--model faux/faux-2` resolves in the harness (needed by I1). One-fixture change; no new harness/level.
