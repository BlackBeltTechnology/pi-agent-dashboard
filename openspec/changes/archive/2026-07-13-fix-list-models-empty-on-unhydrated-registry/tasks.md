## 1. Regression tests first (TDD — write, watch fail)

- [x] 1.1 In `packages/extension/src/__tests__/` (new `role-model-tools-registry-readiness.test.ts` or extend an existing `role-model-tools` test), write failing tests exercising the `list_models` `execute` handler against a stubbed `getRegistry`:
  - **absent registry** (`getRegistry` → `undefined`): result is `{ models: [], registryReady: false, reason: <non-empty string> }`; does not throw.
  - **hydrated-but-empty** (`getRegistry` → registry whose `getAvailable()` → `[]`): result is `{ models: [], registryReady: true }`; `reason` omitted/`null`.
  - **populated** (`getAvailable()` → ≥1 model): `registryReady: true` + full `models` array with existing row shape unchanged.
  - **annotated + absent registry** (`annotated: true`, `getRegistry` → `undefined`): `{ models: [], registryReady: false, reason: <non-empty> }` — not a silent empty.
- [x] 1.2 Run the suite with ephemeral HOME (`HOME=$(mktemp -d) npx vitest run packages/extension/src/__tests__/role-model-tools-registry-readiness.test.ts`) → verify the new cases FAIL (envelope has no `registryReady` today).

## 2. Implement the readiness discriminator

- [x] 2.1 In `packages/extension/src/role-model-tools.ts`, keep `buildModelRows(registry, annotated)` pure and unchanged (it may still return `[]` for a falsy registry). Move the empty-vs-absent decision into the `list_models` `execute` handler (or a thin `buildModelsResult(registry, annotated)` helper): read `const registry = deps.getRegistry()`; if falsy → return `{ models: [], registryReady: false, reason: "model registry not yet hydrated in this session; retry shortly" }`; else → `{ models: buildModelRows(registry, annotated), registryReady: true }`.
- [x] 2.2 Emit the envelope through BOTH the tool result `content` (the JSON text block) AND `details`, so structured consumers and text-parsing agents both see `registryReady`/`reason`. Preserve the existing `models` key position/shape (additive only).
- [x] 2.3 Ensure `annotated: true` flows through the same helper so an absent registry under annotated mode also yields `registryReady: false` (not a silent empty catalogue).
- [x] 2.4 Update the `list_models` tool `description` to document `registryReady` (false ⇒ registry not hydrated, retry) and hint that an unexpected `registryReady: true` + empty `models` should try `annotated: true` to reveal `no-credential`/`oauth-incompatible` exclusions.

## 3. Docs

- [x] 3.1 Update the `packages/extension/src/AGENTS.md` row for `role-model-tools.ts` to note the `registryReady`/`reason` discriminator on `list_models`. `See change: fix-list-models-empty-on-unhydrated-registry`. (Caveman style; edit directly — under `packages/`, not `docs/`.)

## Tests

- [x] T.1 `HOME=$(mktemp -d) npx vitest run packages/extension/src/__tests__/role-model-tools-registry-readiness.test.ts` → all four states green.
- [x] T.2 Run the existing `role-model-tools` / role-manager suites to confirm no regression in `list_roles` / `update_roles` (decoupling preserved).
- [x] T.3 `tsc --noEmit` (or `npm run quality:changed`) clean on the touched files.

## Validate

- [x] V.1 `openspec validate fix-list-models-empty-on-unhydrated-registry` passes.
- [x] V.2 Confirm a live session's `list_models` returns the full catalogue with `registryReady: true` — PROVEN e2e (Playwright + docker harness). New faux scenario `tool-list-models` (`qa/fixtures/faux-scenarios.ts`) drives the REAL bridge `list_models` tool against the live faux-populated registry; spec `tests/e2e/list-models-registry-ready.spec.ts` asserts `registryReady=true` + populated catalogue (`hasFaux=true`). Ran attach-mode against the rebuilt harness (baked local source): 1 passed.
- [x] V.3 Absent-registry `registryReady: false` + `reason` — the spawn-before-hydration window cannot be forced deterministically in the harness; per this task's own acceptance clause the unit test with a falsy `getRegistry` stub (task 1.1, case A) is the accepted proof, and it is green. The live e2e (V.2) exercises the same discriminator on the ready path end-to-end.

## E2E (Playwright + docker harness)

- [x] E.1 Add faux scenario `tool-list-models` (`qa/fixtures/faux-scenarios.ts`): step 1 emits a real `list_models` tool call; step 2 reads the tool result via `lastToolResultText` and echoes the `registryReady`/count/`faux/faux-1` discriminator as plain text (`summarizeListModelsResult`, marker `LIST_MODELS_MARKER_PREFIX`). Does not perturb the curated server/client faux consumers (verified: faux-router/session/renderers suites green).
- [x] E.2 Add `tests/e2e/list-models-registry-ready.spec.ts` (L3): spawn fresh git session → `[[faux:tool-list-models]]` → assert `registryReady=true` + `hasFaux=true`. Ran `PW_E2E_USE_RUNNING=1 PW_E2E_PORT=<derived> PW_CHANNEL=chrome npx playwright test list-models-registry-ready` → 1 passed; harness torn down.
