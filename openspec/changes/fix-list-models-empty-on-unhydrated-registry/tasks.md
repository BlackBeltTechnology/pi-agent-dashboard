## 1. Regression tests first (TDD — write, watch fail)

- [ ] 1.1 In `packages/extension/src/__tests__/` (new `role-model-tools-registry-readiness.test.ts` or extend an existing `role-model-tools` test), write failing tests exercising the `list_models` `execute` handler against a stubbed `getRegistry`:
  - **absent registry** (`getRegistry` → `undefined`): result is `{ models: [], registryReady: false, reason: <non-empty string> }`; does not throw.
  - **hydrated-but-empty** (`getRegistry` → registry whose `getAvailable()` → `[]`): result is `{ models: [], registryReady: true }`; `reason` omitted/`null`.
  - **populated** (`getAvailable()` → ≥1 model): `registryReady: true` + full `models` array with existing row shape unchanged.
  - **annotated + absent registry** (`annotated: true`, `getRegistry` → `undefined`): `{ models: [], registryReady: false, reason: <non-empty> }` — not a silent empty.
- [ ] 1.2 Run the suite with ephemeral HOME (`HOME=$(mktemp -d) npx vitest run packages/extension/src/__tests__/role-model-tools-registry-readiness.test.ts`) → verify the new cases FAIL (envelope has no `registryReady` today).

## 2. Implement the readiness discriminator

- [ ] 2.1 In `packages/extension/src/role-model-tools.ts`, keep `buildModelRows(registry, annotated)` pure and unchanged (it may still return `[]` for a falsy registry). Move the empty-vs-absent decision into the `list_models` `execute` handler (or a thin `buildModelsResult(registry, annotated)` helper): read `const registry = deps.getRegistry()`; if falsy → return `{ models: [], registryReady: false, reason: "model registry not yet hydrated in this session; retry shortly" }`; else → `{ models: buildModelRows(registry, annotated), registryReady: true }`.
- [ ] 2.2 Emit the envelope through BOTH the tool result `content` (the JSON text block) AND `details`, so structured consumers and text-parsing agents both see `registryReady`/`reason`. Preserve the existing `models` key position/shape (additive only).
- [ ] 2.3 Ensure `annotated: true` flows through the same helper so an absent registry under annotated mode also yields `registryReady: false` (not a silent empty catalogue).
- [ ] 2.4 Update the `list_models` tool `description` to document `registryReady` (false ⇒ registry not hydrated, retry) and hint that an unexpected `registryReady: true` + empty `models` should try `annotated: true` to reveal `no-credential`/`oauth-incompatible` exclusions.

## 3. Docs

- [ ] 3.1 Update the `packages/extension/src/AGENTS.md` row for `role-model-tools.ts` to note the `registryReady`/`reason` discriminator on `list_models`. `See change: fix-list-models-empty-on-unhydrated-registry`. (Caveman style; edit directly — under `packages/`, not `docs/`.)

## Tests

- [ ] T.1 `HOME=$(mktemp -d) npx vitest run packages/extension/src/__tests__/role-model-tools-registry-readiness.test.ts` → all four states green.
- [ ] T.2 Run the existing `role-model-tools` / role-manager suites to confirm no regression in `list_roles` / `update_roles` (decoupling preserved).
- [ ] T.3 `tsc --noEmit` (or `npm run quality:changed`) clean on the touched files.

## Validate

- [ ] V.1 `openspec validate fix-list-models-empty-on-unhydrated-registry` passes.
- [ ] V.2 Reload connected pi sessions (`npm run reload:check`) — the bridge re-registers `list_models`; confirm a normal session still returns the full catalogue with `registryReady: true`.
- [ ] V.3 Manual/repro (deferred to ship if a live spawn harness is unavailable): invoke `list_models` in a freshly-spawned / headless child during the hydration window and confirm it returns `registryReady: false` + `reason` rather than a bare empty `{ models: [] }`. If the window is too narrow to hit reliably, a unit test with a falsy `getRegistry` stub (task 1.1) is accepted as proof per the project's "passing unit tests are acceptable proof" convention.
