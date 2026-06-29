# Faux-backed model round-trip E2E scenarios (per-session scenario routing)

## Why

`add-playwright-e2e` and `add-e2e-spawn-scenarios` (both archived 2026-06-23)
landed the browser-E2E harness and the spawn-dependent scenarios — but neither
drives a **model round-trip in the browser**. By design:

- `add-e2e-spawn-scenarios` lists *"Seeding provider keys for live agent runs"*
  as a **non-goal** (UI-only by default). Its spawn spec asserts only that the
  `session-card-desktop` appears, and its own helper notes the card appears
  *"independent of credential validity (no model call at spawn)."*
- So the browser path proven today is `spawn → bridge registers → card`. The
  prompt → model → streamed events → rendered DOM path — the dashboard's reason
  to exist — is never asserted in a real browser.

Passing real LLM keys to close this gap is unreliable: keys expire, rate-limit,
cost money, and produce non-deterministic output no assertion can pin. pi ships
the exact seam to avoid keys entirely: pi-ai's **`registerFauxProvider()`**, a
scriptable dummy model that streams real `text_*` / `thinking_*` / `toolcall_*`
/ `done` / `error` / `aborted` events through pi's normal pipeline. The repo
already uses it in Vitest + VM smoke via `qa/fixtures/faux-provider.ext.ts` and
the `qa/fixtures/faux-scenarios.ts` catalog (archive
`2026-06-14-add-faux-model-integration-tests`).

The faux-integration-tests change left an explicit **Open Question**: whether
driving faux through the dashboard spawn path needs a `model` + `extension`
passthrough added to `sessionFlagsToArgv`. This change answers it WITHOUT
touching production spawn code: pi auto-discovers global extensions from
`~/.pi/agent/extensions/` (no `-e` needed) and honours `defaultModel` from
config. Seeding both in the container — behind the existing `PI_E2E_SEED` gate —
makes every UI-spawned session route to faux. Zero server-code change.

## What Changes

- **Per-session scenario routing (the design ask).** Each dashboard session is
  its own `pi --mode rpc` process, so the faux extension + its state are already
  per-session isolated (the integration test asserts *"two concurrent faux
  sessions stay isolated"*). Replace the fixture's single static
  `setResponses(FAUX_SCRIPT)` with a **self-perpetuating router factory**: it
  resolves the scenario id from a `[[faux:<id>]]` sentinel in the latest user
  message, computes the step index by counting assistant turns since that
  message (so multi-step scenarios like `ask-select-roundtrip` still work), and
  re-appends itself each call. `FAUX_SCRIPT` is retained as the DEFAULT/fallback
  scenario when no sentinel is present — keeping the existing Vitest + VM smoke
  consumers green.

- **Harness seeding (gated `PI_E2E_SEED=1`, default OFF — extends the shipped
  seed in `docker/test-entrypoint.sh`):**
  - Copy the faux fixture into the image and, at entrypoint, materialize it as a
    global auto-discovered extension at
    `~/.pi/agent/extensions/faux-provider/index.ts` with its sibling
    `faux-scenarios.ts` (subdir form, because the extension imports
    `./faux-scenarios.js`). No `-e` flag, no project-trust prompt.
  - Seed `defaultModel: "faux/faux-1"` into the pi config so UI-spawned sessions
    select the faux model with no key.
  - No-op when the files already exist; default OFF keeps manual
    `docker/test-up.sh` QA UI-only.

- **Get the fixture into the image.** The Docker image copies `packages/
  scripts/ patches/` but not `qa/`. Add a `COPY qa/fixtures ./qa/fixtures` (or
  relocate the two faux files to a copied path) so the entrypoint can stage
  them.

- **Faux round-trip scenario specs** under `tests/e2e/`, each sending a sentinel
  prompt through the UI composer and asserting the scripted reply renders:
  - `faux-text.spec.ts` — `[[faux:plain-text]]` → assistant text
    (`PLAIN_TEXT_MARKER`) renders in the message DOM.
  - `faux-tool.spec.ts` — `[[faux:tool-read]]` → the `read` tool renderer mounts.
  - `faux-ask.spec.ts` — `[[faux:ask-select]]` → the interactive select widget
    mounts (answer round-trip optional follow-up).

- **No production code changes.** Only the test fixture, Docker harness seed
  (test-only, gated), and `tests/e2e/` specs. Extends the `playwright-e2e-qa`
  capability.

## Capabilities

### Modified Capabilities

- `playwright-e2e-qa`: adds faux-model auto-load + per-session scenario routing
  to the `PI_E2E_SEED` harness seed, and faux-backed model round-trip scenario
  specs that assert streamed assistant text / tool / interactive renderers in a
  real browser — key-free and deterministic.

## Impact

- **Files (new):** `tests/e2e/faux-text.spec.ts`, `tests/e2e/faux-tool.spec.ts`,
  `tests/e2e/faux-ask.spec.ts`, helper additions in `tests/e2e/helpers/index.ts`.
- **Files (modified):** `qa/fixtures/faux-provider.ext.ts` (router factory +
  sentinel routing, FAUX_SCRIPT kept as fallback), `docker/Dockerfile` (COPY
  qa/fixtures), `docker/test-entrypoint.sh` (stage extension + seed defaultModel
  under `PI_E2E_SEED`), `tests/e2e/README.md`, file-index rows.
- **Depends on:** archives `2026-06-14-add-faux-model-integration-tests`,
  `2026-06-21-docker-test-harness`, `2026-06-23-add-playwright-e2e`,
  `2026-06-23-add-e2e-spawn-scenarios` (all shipped).
- **No production code changes; no `sessionFlagsToArgv` passthrough.** The faux
  routing is achieved entirely via auto-discovered extension + `defaultModel`,
  inside the disposable, RAM-backed, localhost-published test container.
- **Non-goals:** CI leg; concurrent-session DIFFERENT-scenario stress (routing
  supports it, but no spec asserts cross-session concurrency here); abort/error
  round-trip specs (follow-up); changing the production spawn argv contract.
