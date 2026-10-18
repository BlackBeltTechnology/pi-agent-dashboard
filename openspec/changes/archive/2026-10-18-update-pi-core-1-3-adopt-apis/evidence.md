# Evidence: update-pi-core-1-3-adopt-apis

The packages were fetched with `npm pack` into `/tmp` and not installed: `@earendil-works/pi-coding-agent@1.3.0` and `@earendil-works/pi-agent-core@1.3.0`. The baseline is the installed `node_modules/@earendil-works/pi-coding-agent` `1.1.0`.

## Dependency delta (package.json, 1.1.0 → 1.3.0)

| dep | 1.1.0 | 1.3.0 |
|---|---|---|
| `@earendil-works/pi-agent-core` | `^1.1.0` | `1.3.0` (exact) |
| `@earendil-works/pi-ai` | `^1.1.0` | `1.3.0` |
| `@earendil-works/pi-codemode` | `^1.1.0` | `1.3.0` |
| `@earendil-works/pi-mcp` | `^1.1.0` | `1.3.0` |
| `@earendil-works/pi-tui` | `^1.1.0` | `1.3.0` |
| `@earendil-works/chord` | `^1.1.0` | removed |
| engines.node | `>=22.19.0` | `>=22.19.0` |
| typebox | `1.3.27` | `1.3.27` |

pi-ai 1.3.0 dependencies include `@earendil-works/pi-telemetry` `1.3.0` (unpacked `pi-ai@1.3.0` `package.json`). TypeBox `1.3.27` was checked in both the installed 1.1.0 manifest and the 1.3.0 tarball. pi 1.3.0 `files` adds `schemas/`. `exports` shrinks from `.`, `./rpc-entry`, `./client`, `./experimental/plugin` (installed 1.1.0) to `.` plus `./rpc-entry` (1.2.0 "Removed").

## Drain spike (systematic-debugging): is the idle-retry loop still needed?

Question: when the bridge drains on `agent_end` + `setTimeout(0)`, why must it poll `isIdle()`? Would `agent_settled` remove the need?

pi 1.3.0 `dist/core/agent-session.js`:
- `get isIdle()` returns `!this._isAgentRunActive && !this.isCompacting` (`:1057`).
- `_startRun` sets `_isAgentRunActive = true` before `_prepareRun` (which emits `before_agent_start`) (`:1392-1397`). The session is therefore busy while a run starts (1.2.0 breaking change).
- The run loop calls `agent.continue()` while `_handlePostAgentRun()` / `_runBeforeSettleBoundary()` report `agent.hasQueuedMessages()` (`:1418-1428`, `:1505-1549`). Follow-ups queued after `agent_end` are drained inside the run.
- In the `finally` block, `_emitAgentSettled()` runs (`:1440`). It sets `_isAgentRunActive = false` **before** emitting `agent_settled` to extensions (`:684-691`).
- `prompt()` called during the settle emission is pushed to `_deferredSettledActions` (`:1603-1606`); `sendCustomMessage` with `triggerTurn` behaves the same way (`:1837-1840`). Both run after the emission (`:696-704`).
- The extension-facing `sendUserMessage` is fire-and-forget: `this.sendUserMessage(...).catch(err => runner.emitError(...))` (`:2745-2752`). An extension never sees a synchronous throw for a busy-session rejection.

pi-agent-core 1.3.0 `dist/agent.js`: `agent_end` is processed inside the executor of `runWithLifecycle`; `finishRun()` (which sets `isStreaming = false`) runs in its `finally` (`:341-362`, `:381-388`). That is the original reason for the drain's transition window.

Baseline 1.1.0: `_deferredSettledActions` appears 4× and `hasQueuedMessages` 7× in the installed `agent-session.js`, so the mechanism is not new in 1.2/1.3.

Conclusion: at `agent_settled` the session is idle. A `setTimeout(0)` scheduled from the bridge's `agent_settled` handler observes `isIdle() === true`, unless something else started a run in between. In that case the next `agent_settled` covers it. The 100 ms × 20 retry loop is unnecessary → design D4.

## `before_agent_start` handlers (D2)

| handler | reads |
|---|---|
| `packages/extension/src/dashboard-context-injector.ts:103` | `event.systemPrompt` |
| `packages/extension/src/bridge.ts:2008` → `path-gate/index.ts:137-141` | `systemPromptOptions.skills/contextFiles` |
| `packages/kb-extension/src/extension.ts:162` | `systemPrompt`, `systemPromptOptions.cwd/contextFiles` |
| `packages/roles-plugin/src/bridge/index.ts:58` | `systemPromptOptions.selectedTools/toolGuidelines` |
| `packages/untrusted-content-guard/src/guard.ts:135-139` | `systemPromptOptions.promptGuidelines` |
| `packages/team-plugin/src/extension/index.ts:34-53` | `systemPromptOptions.skills` (in-place splice) |
| `packages/extension/src/bridge-handlers/forwarders.ts:46` | pass-through forward |

None reads `prompt` or `images`. pi 1.3.0 `docs/extensions.md:104` documents the `messageType` union.

## Single-bang send (D3)

`packages/extension/src/command-handler.ts:1540-1544` calls `pi.sendUserMessage(message)` without options. In pi 1.3.0, `prompt()` throws "Agent is already processing. Specify streamingBehavior …" when busy and no `streamingBehavior` is given (`agent-session.js:1638`). The runtime wrapper turns the throw into an extension error event, so the output never reaches the LLM.

## Settings (D5)

The diff of documented keys in `docs/settings.md` (1.1.0 → 1.3.0) adds exactly one key: `sessionShareDestination` (`"auto" | "gist" | "radius"`, default `"auto"`). `showHardwareCursor` keeps the type `boolean` and the default `false`.

## Other audited items

- Dropped sub-packages and exports (`pi-api-feature-detection` "Dropped and added runtime sub-dependencies"): running `rg -n "pi-coding-agent/(client|experimental)|@earendil-works/chord"` outside `node_modules`, the lockfile and `openspec/` finds only `pnpm-workspace.yaml:120` (`minimumReleaseAgeExclude`, regenerated by task 1.4).
- pi-ai / pi-tui 1.3.0 import surface (unpacked tarballs): `Loader` is exported by `pi-tui/dist/index.d.ts:10` (used at `packages/extension/src/bridge-handlers/lifecycle.ts:11`). `streamSimple`, `findEnvKeys`, `getEnvApiKey` and `getSupportedThinkingLevels` (dynamic imports at `bridge.ts:1889`, `provider-register.ts:735`) are declared in the same `dist/*.js` files in 1.1.0 and 1.3.0.
- Retry-turn prelude: 1.3.0 `_startRun` → `_prepareRun` (`agent-session.js:1392-1397,1447-1455`) runs the compaction check, `before_agent_start`, `nextTurn` delivery and the loadout record for custom-message runs too.

- `resolveModelScope` diff 1.1.0 → 1.3.0 (`dist/core/model-resolver.js`): exact reference first (`resolveModelReference`, `fuzzy:false`), and an ambiguous exact match keeps all candidates and warns (code `ambiguous`). Otherwise minimatch runs on `provider/id` or `id`, as in `packages/shared/src/enabled-models-match.ts`.
- Team guard: `packages/team-plugin/src/extension/index.ts:34-53` + `guard.ts:140-160`. A fresh `grantedSkillFilter` is built per `before_agent_start`, so a Retry turn's start is filtered like a prompt turn's.

- pi 1.2.0 "system prompt sections no longer dropped after the first tool call of a `triggerTurn` run" (#10267): taken from the changelog only and **unverified** against code. The `_runSystemPromptOptions` projection reads the same in 1.1.0 and 1.3.0. The adoption doesn't depend on it.
- Provider-level no-ops (Kimi, OpenCode, Gemini/Vertex, Xiaomi, Mistral, Anthropic, OpenRouter, GPT-6) come from the changelog only and were **unverified** per item. None of them touches a dashboard code path.
- MCP rule sources mirrored by `mcp-client-plugin/src/core/pi-rules.ts`: `cmp` reports `dist/core/mcp-servers.js` and `dist/extensions/mcp/config.js` byte-identical between 1.1.0 and 1.3.0.
- ExtensionAPI queue methods: `dist/core/extensions/types.d.ts` (1.3.0) declares `hasPendingMessages` (`:244`) and no `clear*Queue`. Neither `types.d.ts` nor `runner.js` mentions `queue_update`.
- Compaction rejects `prompt()` at `agent-session.js:1620`. `_startRun`'s failure path (`:1398-1405`) emits no `agent_settled`.

- `memory-eval` judge: `packages/memory-eval/src/commands/judge.ts:133` maps `exitCode !== 0` to `outcome = "failed"`.
- `mcp-client-plugin`: no source reads `resources` / `resourceTemplates` from `pi mcp list --json` (`rg` outside `__tests__`).
- `context-budget`: `packages/context-budget/src/meter.ts:34-38` filters `getActiveTools()` on `session_start`.

## Justified version anchors (not modified)

These live requirements mention `1.1.0` as historical anchors and stay true under a 1.3.0 floor:
- `event-reducer` `durationMs` "(pi ≥ 1.1.0 …)";
- `model-proxy-credential-routing` "From pi 1.1.0";
- `credential-delivery` "before 1.1.0";
- `pi-api-feature-detection` "pi 1.0.1–1.1.0 changes …";
- `release-notes` (Keep a Changelog 1.1.0, not pi).
- `packages/nano-banana/src/pi-backend.ts:18` `PI_MIN_VERSION = "1.0.0"` (and `README.md:41,73`): a feature gate (the pi backend needs ≥ 1.0.0), not a pin. It stays true under a 1.3.0 floor; the `nano-banana-pi-backend` ≥ 1.0.0 anchor was justified the same way in the 1.1 bump.

## Verification runs

Worktree `.worktrees/os-update-pi-core-1-3-adopt-apis`, macOS arm64, Node 24, pnpm 11.15.1, pi 1.3.0 installed.

### Drain spike (task 3.0) — real pi 1.3.0 under the faux provider

Driven with `pi --mode rpc` + `qa/fixtures/faux-provider.ext.ts` + a probe extension logging `ctx.isIdle()` synchronously and inside a `setTimeout(0)` scheduled from each handler. Retry settings `{maxRetries:3, baseDelayMs:300}`; the 503 scenario was a spike-local copy of the fixtures (not committed).

| run | event order | `isIdle()` |
|---|---|---|
| normal turn | `agent_start` → `agent_end` → `agent_settled` | `agent_end` sync **false**; `agent_settled` sync **true**; `agent_settled` + `setTimeout(0)` **true** (`hasPendingMessages()` false) |
| auto-retry chain (503 × 3, then ok) | `agent_start` → `agent_end` ×4, ONE `agent_settled` after the last | `agent_end` + `setTimeout(0)` **false** on all three failed attempts (the old drain would have polled here); `agent_settled` + `setTimeout(0)` **true** |
| abort mid-stream (`slow-stream`, TPS 2) | `agent_start` → `agent_end` → `agent_settled {aborted:true}` | `agent_settled` + `setTimeout(0)` **true** |

`isIdle()` was never false inside the `agent_settled` timer without a new run. This confirms design D4: one idle check, no retry loop.

### Fixtures red → green (tasks 1.1, 1.4)

Pin-encoding fixtures were edited to 1.3.0 first (`pi-version-skew.test.ts`, `verify-release-deps-pi-coherence.test.mjs`, `bundled-node-meets-pi-floor.test.ts`, `pi-version-update-handling.test.ts`, `e2e-browser-workflow-contract.test.ts`); no red run was recorded before the pins moved (the install had not yet been done in this worktree). After the pins moved and `pnpm install` ran: 5 files, 107 tests green.

`minimumReleaseAge`: not configured in `pnpm-workspace.yaml` / `.npmrc`; pnpm 11.15.1 `config get minimum-release-age` prints `undefined`. `minimumReleaseAgeExclude` was still regenerated from the lockfile: pi-agent-core, pi-ai, pi-coding-agent, pi-tui, pi-codemode, pi-mcp, pi-telemetry at `1.3.0`; `@earendil-works/chord@1.1.0` dropped.

### Install and gate (task 6.27, test-plan #X3)

- `pnpm install --frozen-lockfile` → `Already up to date`, exit 0.
- `node scripts/verify-release-deps.mjs` → `OK — 12 rules passed.`
- `pnpm-lock.yaml`: `@earendil-works/chord` count 0; one copy of each pi package at `1.3.0` (`pi-agent-core`, `pi-ai`, `pi-codemode`, `pi-coding-agent`, `pi-mcp`, `pi-telemetry`, `pi-tui`); installed `node_modules/@earendil-works/pi-coding-agent` `1.3.0`.

### Docker harness (tasks 6.23, 6.24, 6.28; test-plan #F1, #F2, #X4)

Image built from the worktree (`docker/test-up.sh -d --build`); `docker exec … pi --version` → `1.3.0`. Run with `PW_E2E_USE_RUNNING=1` against the derived port from `.pi-test-harness.json`:

- `pi-1-3-floor-smoke.spec.ts` passed (`/api/health` `current === "1.3.0"`, no below-floor error).
- `followup-settle-drain.spec.ts` F1 and F2 passed.
- `optimistic-prompt.spec.ts` (mid-turn queue chip) passed.
- `long-session-settle.spec.ts` P4 and `pending-prompt-recovery.spec.ts` F1 failed on 240–300 s waits for a long-transcript tail; both are long-transcript replay specs unrelated to the follow-up drain. Not attributed to this change (the harness VM has 8 GB).

### QA install floor (task 6.29, test-plan #X5)

`qa/tests/01-install.sh` `PI_FLOOR="1.3.0"` edited and `bash -n` clean. The VM install itself (`qa/` clean-install run per OS) was NOT run locally; it executes in the VM smoke leg.

### Full vitest (`npm test`)

`Test Files 5 failed | 2882 passed | 51 skipped; Tests 8 failed | 37748 passed`. Re-run in isolation:
- `host-gate-upgrade`, `dox-row`, `seed-engine-cli`: pass (load-sensitive flakes in the full run).
- `repo-hygiene` byte cap: failed on `tests/e2e/AGENTS.md` (this change's two new rows pushed it over 30000 bytes); fixed by trimming row summaries (the `<File>.AGENTS.md` sidecars carry the detail) — `node scripts/dox-byte-gate.mjs` green.
- `system-routes-restart-loader` (4 cases): fails identically on `develop` in the main checkout; pre-existing, unrelated.

`npm run lint` (tsc7): only the three pre-existing `Promise.withResolvers` errors in `dashboard-plugin-runtime` remain (same count on the pre-change tree).

### `1.1.0` sweep (task 1.6)

Updated: every pi pin (listed above), `docs/architecture.md` / `docs/faq.md` floor statements, `docker/Dockerfile.AGENTS.md`, `scripts/verify-release-deps.mjs.AGENTS.md`, `qa/tests/AGENTS.md`, `tests/e2e/pi-1-3-floor-smoke.spec.ts{,.AGENTS.md}`. Justified anchors left unchanged (all remain true under a 1.3.0 floor):
- `packages/mcp-client-plugin` `pi-rules.ts`, `effective-view.ts`, `types.ts`, `schema/mcp-config.schema.json`, its tests and AGENTS rows: mirror pi's MCP config validation; `dist/core/mcp-servers.js` and `dist/extensions/mcp/config.js` are byte-identical between 1.1.0 and 1.3.0.
- `packages/client` `event-reducer.ts`, `state-replay.ts`, `models-json-reader.ts`, `internal-registry.ts`, `provider-register.ts` and their tests: "pi >= 1.1.0" feature anchors (`durationMs`, `samplingParamsByThinkingLevel`).
- `packages/server` `model-proxy/*`, `routes/model-proxy-routes.ts`: "pi >= 1.1.0" OAuth-refresh anchors.
- `docs/credential-vault.md`, `docs/credential-vault.agent.md`: spill-file mode `0600` since pi 1.1.0; `dist/utils/output-files.js` in 1.3.0 still sets `OUTPUT_FILE_MODE = 0o600`.
- `docs/plans/iroh-transport-research.md`, `packages/music-production` (`beat-this==1.1.0`), `packages/electron` and `packages/shared` test fixtures (`openspec`/`pi-flows`/`PackageRow` versions): not pi pins.
- `scripts/verify-release-deps.mjs` `node-pty 1.1.0` rule and the 1.1.0 evidence note: history; the note now continues to 1.3.0.
- `openspec/specs/**`: change through this change's delta files only.
