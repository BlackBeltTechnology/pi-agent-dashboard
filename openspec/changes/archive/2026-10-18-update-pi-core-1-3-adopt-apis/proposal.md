## Why

pi 1.3.0 is the latest release (2026-10-15). The repo pins, type-checks and tests against `1.1.0` (`pnpm-workspace.yaml:55-57`, `packages/server/package.json:19-20,78`, `docker/Dockerfile:116`), and the lockstep policy (`pi-core-version-check`) moves the floor with the pin. Between 1.1.0 and 1.3.0 pi changed three things the bridge depends on:

- `before_agent_start` now also fires for runs started by `pi.sendMessage(…, { triggerTurn: true })` (1.2.0, breaking), so the dashboard's **Retry** turn now gets the per-turn system-prompt context.
- A run counts as busy from the moment it starts (1.2.0, breaking). `pi.sendUserMessage` without `deliverAs` on a busy session is rejected; the bridge's `!cmd` path is exposed.
- pi now pins its own internal packages to exact versions (1.3.0, #10865).

Planning also confirmed something we could already rely on: pi (≥ 1.1.0) clears its active-run state before emitting `agent_settled`, and defers a prompt issued during that emission until afterwards. That makes the bridge's 2-second idle-polling drain workaround unnecessary.

## What Changes

### Pin bump + floor (atomic)
- Pin `@earendil-works/pi-coding-agent`, `pi-ai` and `pi-tui` to `1.3.0` on every governed surface:
  - the server dependency (`^1.3.0`) and `piCompatibility.minimum`/`recommended` (`1.3.0`);
  - the root `package.json` peers and devDependencies;
  - `docker/Dockerfile` (and its `Dockerfile.AGENTS.md` row), plus the two `npm i -g …@1.1.0` steps in `.github/workflows/ci-e2e-browser.yml:311,370`, which `e2e-browser-workflow-contract.test.ts` (E3) requires to equal the Dockerfile pin;
  - `scripts/verify-release-deps.mjs` `minVersion`;
  - the `pnpm-workspace.yaml` `overrides`;
  - `minimumReleaseAgeExclude`, derived from the lockfile after `pnpm install`. The `@earendil-works/chord@1.1.0` entry goes, because pi 1.2.0 dropped the dependency.
- Pin-encoding fixtures move first (TDD): `pi-version-skew.test.ts`, `bundled-node-meets-pi-floor.test.ts` (new `1.3.0` row, Node 22.19), `verify-release-deps-pi-coherence.test.mjs` and `pi-version-update-handling.test.ts` (X3). The floor-encoding smoke tests move with them: `tests/e2e/pi-1-1-floor-smoke.spec.ts` (`FLOOR`) and `qa/tests/01-install.sh` (`PI_FLOOR`).
- **BREAKING (publishable peers):** every `@earendil-works` pi peer becomes `>=1.3.0` (optional, no upper bound), and pi devDependencies become `^1.3.0`.
- Dependency delta, verified from manifests: pi-coding-agent's `@earendil-works/*` siblings move from `^1.1.0` to exact `1.3.0`. `@earendil-works/chord` is removed. Node engines (`>=22.19.0`) are unchanged.

### Adopted
- **Retry turns carry per-turn context.** With pi ≥ 1.2.0, the dashboard **Retry** turn (`pi.sendMessage({customType:"pi-dashboard:retry"}, {triggerTurn:true})`, `packages/extension/src/command-handler.ts:1446-1453`) runs every `before_agent_start` handler: the dashboard session-context injector, kb doctrine, role guidelines, the untrusted-content guideline, the path-gate resource capture and the team-guard skill filter. Before 1.2 a Retry turn ran none of them, so a team session's Retry turn saw unfiltered skills; 1.2 closes that gap. Per the pi 1.2.0 changelog (#10267; not independently diffed), 1.2 also stops those sections being dropped after the first tool call of such a run. This is accepted as desired behaviour, specified in `agent-session-context-injection`, and needs no code change.
- **`!cmd` output send is busy-safe.** The single-bang path (`command-handler.ts:1543`) calls `pi.sendUserMessage(message)` without `deliverAs`. On a busy session pi rejects that asynchronously, and the output silently never reaches the LLM: pi's runtime `sendUserMessage` is fire-and-forget and reports the failure through the extension error channel (`agent-session.js:2745-2752`). The bridge SHALL pass `deliverAs: "followUp"`. pi ignores it when idle and queues the message into the running run when busy.
- **Follow-up drain moves to `agent_settled`.** The bridge drain currently runs on `agent_end`, then polls `ctx.isIdle()` every 100 ms for up to 2 s (`packages/extension/src/bridge.ts:644-700`, `bridge-handlers/forwarders.ts:168`), because `agent_end` arrives before pi goes idle. `agent_settled` fires once per run, after retries and continuations, with `_isAgentRunActive` already false (`agent-session.js:684-707`). The drain SHALL run on `agent_settled` (deferred with `setTimeout(_, 0)`) and drop the idle-retry loop. Its gating moves into a pure module so tests drive the real decision instead of a mirror. If a run has already started (`!ctx.isIdle()`), the drain SHALL bail; the next `agent_settled` drains. A side effect: the drain no longer fires between the attempts of an auto-retry chain.
- **`sessionShareDestination` setting.** Add it to the typed pi-settings set (`"auto"` | `"gist"` | `"radius"`, default `"auto"`; Sessions and context) so the parity test against pi's `docs/settings.md` stays green.

### Audited, deliberately NOT consumed
- **`before_agent_start.messageType`.** Every dashboard handler edits only `systemPrompt`/`systemPromptOptions` and none reads `prompt`, so no branch on `messageType` is needed. The pass-through forwarder sends the event unchanged.
- **pi's shipped JSON Schemas** (`schemas/settings.schema.json` and others). They could replace the hand-kept `pi-settings-schema.ts` and its markdown parity test. They are deferred to a separate change: they are not in pi's `exports` map, and the migration is a refactor, not a version bump.
- **`reachesTools` and namespace `aliases`.** No dashboard tool reaches other tools.
- **`PI_CLIPBOARD_OSC52`.** It is a pi process environment variable, recorded for a possible Docker image follow-up.

### Documented no-ops
- **Fixed inside pi:**
  - thinking from a previous model is no longer replayed to a new model (1.3);
  - retry classification adds "Unable to forward upstream stream", "temporarily unavailable" and "upstream provider returned an error". The dashboard reads pi's retry events and doesn't replicate the classifier;
  - malformed tool-call JSON now fails validation, and invalid `\u` escapes in tool arguments are handled;
  - the symlinked-`AGENTS.md`-in-worktree fix;
  - `~` expansion in resource-filter settings;
  - the `ctx.ui.custom` overlay `done()` fix;
  - codemode worker limits and timings;
  - provider fixes (OpenCode, Gemini/Vertex, Xiaomi, Mistral, Anthropic image tool results, OpenRouter prices).
- **Changed in pi, no dashboard writer:** the `kimi-coding` provider moves to Chat Completions at `api.kimi.com/coding/v1`, and a `models.json` base-URL override must now include `/v1`. The dashboard writes no `kimi-coding` override. `quota-plugin` calls `api.kimi.com` directly for usage (`packages/quota-plugin/src/server/quotas/fetchers.ts:181`), not through pi.
- **Resumed sessions keep their active tools (1.3).** `context-budget` (`packages/context-budget/src/meter.ts:34-38`) filters tools on `session_start`; on resume its filter now applies over the restored set. Harmless.
- **`pi mcp list --json` reports `resources: true`** instead of counts. `mcp-client-plugin` reads neither field.
- **Truncated print mode exits 1.** `memory-eval`'s judge (`packages/memory-eval/src/commands/judge.ts:133`) already treats a non-zero exit as a failed judgement.
- **TUI only:** the `showHardwareCursor` cursor-drawing change (its key, type and default are unchanged), Kitty shifted-symbol keybindings, overlay mouse-wheel scroll, and terminal colour-reply leaks.
- **Not used by the dashboard:** the theme `$schema` move (dashboard themes are its own CSS), the removed experimental `pi-client`/`pi-protocol`/`pi-server` packages and the dropped `./client` and `./experimental/plugin` exports (no repo import), per-key OpenRouter model lists (registry-derived), and the GPT-6 thinking-level cache preservation (pi-side).

### Out of scope
Deriving `pi-settings-schema.ts` from pi's JSON Schema (follow-up change). Routing `!cmd` output through the bridge-owned follow-up buffer.

The review found pre-existing spec drift. Where it sits in a requirement this change already modifies, it is corrected here (`mid-turn-prompt-queue` "Typed-during-streaming…" and "Drained queued user message renders AFTER…"). The idle-send wording in `command-routing` "Command routing order" and `bridge-extension` "Command routing in send_prompt handler" is corrected here as well, so no requirement contradicts `bridge.ts:1609`. The `mid-turn-prompt-queue` Purpose line ("follow-up drains … at `agent_end` boundaries") cannot be changed by a delta; it is edited when the change is archived (task 5.3).

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `pi-core-version-check`: pins, floor, peers and examples move to `1.3.0`.
- `agent-session-context-injection`: a Retry (custom-message) turn receives the per-turn system-prompt contributions, including the team-guard skill filter.
- `command-routing`: single-bang output is sent with `deliverAs: "followUp"`. The passthrough step of "Command routing order" is corrected to the `{ deliverAs }` the code sends.
- `bridge-extension`: "Command routing in send_prompt handler" default route corrected to `{ deliverAs }`.
- `mid-turn-prompt-queue`: the follow-up drain runs on `agent_settled`, without the idle-retry loop. The idle-send and drained-message-ordering requirements are corrected to match the code and pi's boundaries.
- `pi-agent-settings-editor`: `sessionShareDestination` joins the typed set.
- `pi-api-feature-detection`: records the 1.2.0–1.3.0 audit (adopted, not consumed, no-ops).

## Impact

- **Pins:** `packages/server/package.json`, root and `packages/*/package.json` peers and devDependencies, `pnpm-workspace.yaml`, `docker/Dockerfile` (+ `Dockerfile.AGENTS.md`), `scripts/verify-release-deps.mjs` (+ sidecar), plus `pnpm install` (lockfile).
- **Code:**
  - `packages/extension/src/command-handler.ts` (single-bang `deliverAs`);
  - `packages/extension/src/bridge.ts` (drain function);
  - `packages/extension/src/bridge-handlers/forwarders.ts` (drain trigger moves from `agent_end` to `agent_settled`);
  - `packages/extension/src/bridge-handlers/instance.ts` (drain signature);
  - `packages/extension/src/followup-buffer.ts` (doc comment);
  - `packages/shared/src/pi-settings-schema.ts` (new key).
- **Tests:** pin fixtures, the drain tests in `packages/extension/src/__tests__/`, the command-handler bang tests, and the pi-settings schema and parity tests.
- **Docs (DocScribe):** floor mentions in `docs/architecture.md`, `docs/faq.md` and `README.md`.
- **`CHANGELOG.md` `[Unreleased]`:** the floor raise (breaking for below-floor pi).
- **Rollback:** revert the commit and run `pnpm install`. No persisted state changes. The drain change is bridge-only and reverts with the commit.

## Discipline Skills

- `doubt-driven-review`: the floor raise is a public, irreversible-for-users step (a publishable peer range), and the drain rewrite changes a race-sensitive lifecycle path.
- `systematic-debugging`: the drain spike's evidence (pi 1.3.0 `agent_settled` ordering and the deferred-prompt path) is recorded in `evidence.md` before the code moves, including an observed faux-provider event trace.
