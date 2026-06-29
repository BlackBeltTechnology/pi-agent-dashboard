# Tasks — Faux-backed model round-trip E2E (per-session routing)

## 1. Faux fixture: per-session scenario routing
- [x] 1.1 In `qa/fixtures/faux-provider.ext.ts`, add `resolveActiveStep(context)`: walk `context.messages` backward to the last `user` message matching `/\[\[faux:([\w-]+)\]\]/`; return `{ id, stepIndex }` where `stepIndex` = count of `assistant` messages after it.
- [x] 1.2 Replace the static `registration.setResponses(scenario.script)` with a self-perpetuating `router` factory that re-appends itself, resolves `SCENARIOS[id]`, and returns `script[stepIndex]` (calling it when it is a factory step).
- [x] 1.3 Keep `FAUX_SCRIPT` env as the fallback scenario when no sentinel is present → verify by running the existing server Vitest + `qa/tests/10-faux-model.sh` unchanged-green.
- [x] 1.4 Add a unit test for `resolveActiveStep` (sentinel parse + step-index counting, incl. the `ask-select-roundtrip` 2-step case).

## 2. Get the fixture into the Docker image
- [x] 2.1 `docker/Dockerfile`: `COPY qa/fixtures ./qa/fixtures` (or relocate the two faux files to an already-copied path) so the entrypoint can stage them. Verify the build context includes them (not `.dockerignore`'d).

## 3. Harness seed (gated PI_E2E_SEED, default OFF)
- [x] 3.1 `docker/test-entrypoint.sh` (inside the existing `PI_E2E_SEED` block, before base entrypoint, no-op when present): stage `~/.pi/agent/extensions/faux-provider/index.ts` + sibling `faux-scenarios.ts` from the copied fixture.
- [x] 3.2 Same block: seed `defaultModel: "faux/faux-1"` into the pi config (merge, do not clobber existing keys).
- [x] 3.3 Verify in-container: spawn a session, confirm faux loads (no "No API provider registered for api: faux") and `faux/faux-1` is the active model.

## 4. Scenario specs (tests/e2e/)
- [x] 4.1 Helper in `tests/e2e/helpers/index.ts`: `sendPrompt(page, text)` that types into the composer and submits; reuse `ensureGitSession`. Add any new testids.
- [x] 4.2 `tests/e2e/faux-text.spec.ts` — send `[[faux:plain-text]] go`; assert `PLAIN_TEXT_MARKER` ("The quick brown faux jumps over the lazy dog.") appears in the rendered message DOM.
- [x] 4.3 `tests/e2e/faux-tool.spec.ts` — send `[[faux:tool-read]] go`; assert the `read` tool renderer mounts.
- [x] 4.4 `tests/e2e/faux-ask.spec.ts` — send `[[faux:ask-select]] go`; assert the interactive select widget mounts (optional: submit an answer and assert the follow-up via `ask-select-roundtrip`).

## 5. Docs
- [x] 5.1 `tests/e2e/README.md`: document the sentinel convention `[[faux:<scenario-id>]]` and the catalog source (`qa/fixtures/faux-scenarios.ts`).
- [x] 5.2 Add a `docs/file-index-*` row per new/changed file (delegated, caveman style).

## 6. Verify
- [x] 6.1 `openspec validate add-e2e-faux-model-roundtrip` passes.
- [x] 6.2 `npm test` (vitest) green — fixture change did not regress server/client faux tests.
- [x] 6.3 `npm run test:e2e` green for the three faux specs against the container.
- [x] 6.4 `docker/test-up.sh` WITHOUT `PI_E2E_SEED` still boots UI-only (no faux extension, no defaultModel seed).
