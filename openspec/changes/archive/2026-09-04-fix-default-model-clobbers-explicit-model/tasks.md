# Tasks

## 1. Gate predicate (TDD)

- [x] 1.1 Test E1 in `packages/extension/src/__tests__/bridge-default-model-gate.test.ts` (extend existing suite — see sibling cases in that file): input `{reason:"startup", entryCount:0, hasModelRegistry:true, hasDefaultModel:true, hasExplicitModel:true}` · call `shouldApplyDefaultModel()` · returns false (explicit-model dominates). Verify: fails red before 1.7. (test-plan #E1)
- [x] 1.2 Test E2 in the same file: same input with `hasExplicitModel:false` · call `shouldApplyDefaultModel()` · returns true. (test-plan #E2)
- [x] 1.3 Test E3 in the same file: argv `[..., "--model", "x/y"]` / `[..., "--models", "a,b"]` / no token · call `hasExplicitModelArg(argv)` · true / false / false (exact-token match). (test-plan #E3)
- [x] 1.4 Test E4 in the same file: argv trailing dangling `["pi","--model"]` / `["pi","--","--model"]` / `["pi","--name","--model"]` · call `hasExplicitModelArg(argv)` · true in all three (accepted fail-safe false-positives pinned in code). (test-plan #E4)
- [x] 1.5 Test E5 in the same file: every pre-existing gate case (`reason≠startup`, `entryCount>0`, no registry, no default) each with `hasExplicitModel:false` · call `shouldApplyDefaultModel()` · unchanged false results. (test-plan #E5)
- [x] 1.6 Verify 1.1–1.5 fail red: `npm test -- bridge-default-model-gate` shows only the new cases failing (compile-level failures for the missing symbol count as red).
- [x] 1.7 Implement: add required `hasExplicitModel: boolean` to `DefaultModelGateInput` and export `hasExplicitModelArg(argv: string[]): boolean` (exact-token `--model` match) in `packages/extension/src/bridge-default-model-gate.ts`, doc comment citing issue #595; migrate ALL existing `DefaultModelGateInput` constructions (gate tests, `bridge-default-model-apply.test.ts`, `bridge-default-thinking-level-apply.test.ts` mirrors). Verify: `npm test -- bridge-default-model` green AND `npm run lint` (tsc) clean.

## 2. Bridge call site

- [x] 2.1 In `packages/extension/src/bridge.ts` session_start handler, derive `hasExplicitModel: hasExplicitModelArg(process.argv)` and pass it to `shouldApplyDefaultModel`. Confirm the retry path (`pendingDefaultModel` re-apply in `onProviderChanged`) needs no extra guard because the gated entry point never sets `pendingDefaultModel` for explicit-model sessions; note this in a comment. Verify: `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log` all green.
- [x] 2.2 Test X1 in `packages/extension/src/__tests__/bridge-default-model-apply.test.ts` (extend the call-site mirror there — copy its mirror pattern): explicit-model session at session_start with custom-provider default unresolved · provider-ready event fires later · mirror (with injected `argv: string[]` routed through the real `hasExplicitModelArg`, never vitest's own `process.argv`; mirror return extended with a pending signal) reports no default applied and `pendingDefaultModel` never set. Verify: `npm test -- bridge-default-model-apply` green. (test-plan #X1)
- [x] 2.3 Test X2 in `packages/extension/src/__tests__/bridge-default-thinking-level-apply.test.ts` (extend the success-branch mirror there): gate false due to `hasExplicitModel:true` with non-empty `config.defaultThinkingLevel` · session_start branch runs · `setThinkingLevel` never called. Verify: `npm test -- bridge-default-thinking-level-apply` green. (test-plan #X2)

## 3. E2E (docker harness)

- [x] 3.1 Harness infra for I1: register a second model `faux-2` in `qa/fixtures/faux-provider.ext.ts` (both `registerFauxProvider` models and `pi.registerProvider` models arrays) so `--model faux/faux-2` resolves in the harness. Verify: `--list-models` inside the harness shows `faux/faux-2`.
- [x] 3.2 Test I1 in a new `tests/e2e/explicit-model-preserved.spec.ts` (copy harness glue from `tests/e2e/session-spawn.spec.ts`; port from `.pi-test-harness.json`, never `:18000`): seeded harness (`defaultModel: faux/faux-1`) + child pi process launched with explicit `--model faux/faux-2` · session registers, observe ≥8s window (covers the ~5s deferred apply from issue #595) · `GET /api/sessions` reports model `faux-2` for the whole window with no `model_change` to `faux-1` after startup. Verify: `npm run test:e2e -- explicit-model-preserved` green per `run-dashboard-e2e-local-changes`. (test-plan #I1)
- [x] 3.3 Test I2 in the same spec: session spawned WITHOUT `--model` via plain `/api/session/spawn` · session registers · converges to `faux/faux-1` (default applied). Verify: same spec run green. (test-plan #I2)

## 4. Manual runtime verification

- [x] 4.1 Real pi-subagents child check per issue #595 §6.1: agent definition pinning a non-default model, run via the external `pi-subagents` package under a live dashboard (child PROCESS — not an in-process Agent-tool spawn, which bypasses the gate); FIRST confirm the child resolved the LOCAL fixed extension copy (see `switch-extension-source` skill — `npm run reload` refreshes connected sessions only, not new spawns); then grep the child's `events.jsonl` for the agent model, not `config.defaultModel`. (test-plan: manual-only)
- [x] 4.2 Runtime regression sweep: fresh dashboard session (no `--model`) still receives `config.defaultModel` (+ `defaultThinkingLevel` when set); resume, fork, and `/reload` sessions on non-default models each keep their model. (test-plan: manual-only)

## 5. Docs & ticket

- [x] 5.1 Update `packages/extension/src/bridge-default-model-gate.ts.AGENTS.md` row (and the `src/AGENTS.md` summary row) with the new `hasExplicitModel` input + `hasExplicitModelArg` helper + `See change:` reference. Verify: `kb dox lint` reports no stale row for the file.
- [ ] 5.2 Comment on GitHub issue #595 when the fix lands: link the PR, note the argv-based generalization vs the proposed `PI_SUBAGENT_CHILD` guard, and clarify the single-source/release relationship of the two bridge "copies". Verify: comment visible on the issue.
