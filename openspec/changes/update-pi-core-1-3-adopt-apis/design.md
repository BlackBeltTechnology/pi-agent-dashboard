## Context

- Governed pins today (all `1.1.0`):
  - `packages/server/package.json:19-20` (`piCompatibility`) and `:78` (`^1.1.0`);
  - root `package.json:135,153-155`;
  - `pnpm-workspace.yaml:55-57` (overrides) and `:114-122` (`minimumReleaseAgeExclude`, including `@earendil-works/chord@1.1.0` at `:120`);
  - `docker/Dockerfile:116`, and `.github/workflows/ci-e2e-browser.yml:311,370` (`npm i -g …@1.1.0`). These are held equal to the Dockerfile pin by `packages/shared/src/__tests__/e2e-browser-workflow-contract.test.ts` (E3);
  - `scripts/verify-release-deps.mjs:93` (`minVersion`);
  - peers and devDependencies in the `packages/*/package.json` files: `extension`, `kb-extension`, `mockup-loop`, `deck3d`, `context-budget`, `image-fit-extension`, `video-production` and others.

  The `rg '1\.1\.0'` sweep is authoritative. Pin-encoding fixtures: `packages/server/src/__tests__/pi-version-skew.test.ts`, `packages/shared/src/__tests__/bundled-node-meets-pi-floor.test.ts` and `scripts/__tests__/verify-release-deps-pi-coherence.test.mjs`.
- pi 1.1.0 → 1.3.0 manifest (`npm pack`, recorded in `evidence.md`):
  - `pi-agent-core`, `pi-ai`, `pi-codemode`, `pi-mcp` and `pi-tui` move from `^1.1.0` to exact `1.3.0`;
  - `@earendil-works/chord` is removed;
  - pi-ai 1.3.0 depends on `pi-telemetry` `1.3.0`;
  - engines stay `>=22.19.0`.
- `before_agent_start` handlers in the repo:
  - `packages/extension/src/bridge.ts:2008` (path-gate capture, `path-gate/index.ts:137-141`);
  - `packages/extension/src/dashboard-context-injector.ts:103`;
  - `packages/kb-extension/src/extension.ts:162`;
  - `packages/roles-plugin/src/bridge/index.ts:58`;
  - `packages/untrusted-content-guard/src/extension.ts:36` (`guard.ts:135-139`);
  - `packages/team-plugin/src/extension/index.ts:34-53` (in-place `systemPromptOptions.skills` splice);
  - the pass-through forwarder (`packages/extension/src/bridge-handlers/forwarders.ts:46`).

  Each one reads or edits only `systemPrompt` / `systemPromptOptions`; none reads `event.prompt` or `event.images`.
- Retry dispatch: `packages/extension/src/command-handler.ts:1416-1460` (`dispatchDashboardRetry` → `pi.sendMessage({customType:"pi-dashboard:retry", display:false}, {triggerTurn:true})`).
- Single-bang send: `packages/extension/src/command-handler.ts:1540-1544` (`pi.sendUserMessage(message)`, no options).
- Follow-up drain:
  - trigger: `forwarders.ts:168`, on `agent_end` via `setTimeout(_, 0)`;
  - body: `bridge.ts:644-700`, with an idle retry of 100 ms × 20 at `:660-670`;
  - system enqueue: `bridge.ts:727-738`;
  - `inst.drainFollowupQueue(retryCount?)`: `bridge-handlers/instance.ts:161`;
  - the existing `agent_settled` branch: `forwarders.ts:123-140`.
- pi 1.3.0 runtime (`dist/core/agent-session.js`):
  - `isIdle` = `!_isAgentRunActive && !isCompacting` (`:1057`);
  - `_startRun` sets `_isAgentRunActive = true` before `before_agent_start` (`:1393`);
  - the run loop continues while `agent.hasQueuedMessages()` (`:1418-1428`, `:1535-1549`);
  - `_emitAgentSettled` clears `_isAgentRunActive` **before** emitting `agent_settled` (`:684-691`);
  - `prompt()` and `sendCustomMessage` called during the settle emission are pushed to `_deferredSettledActions` and run afterwards (`:1603-1606`, `:1837-1840`, `:696-704`);
  - the extension-facing `sendUserMessage` is fire-and-forget: rejections go to `runner.emitError` (`:2745-2752`).

  The same deferral and queued-message continuation exist in the installed 1.1.0 (`_deferredSettledActions` ×4, `hasQueuedMessages` ×7 in `node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js`).

## Goals / Non-Goals

**Goals:**
- the lockstep pin and floor at 1.3.0;
- a correct `!cmd` send on a busy session;
- removing the drain's idle-polling workaround;
- keeping the settings parity test green;
- an honest audit record.

**Non-Goals:**
- deriving `pi-settings-schema.ts` from pi's JSON Schema;
- routing `!cmd` output through the bridge-owned buffer, which would make it editable as a queued chip;
- branching any `before_agent_start` handler on `messageType`;
- MODIFYING live requirements whose "pi 1.1.0" text is a historical anchor and verified unchanged on 1.3.0. Examples: `event-reducer` `durationMs` "(pi ≥ 1.1.0 …)", `model-proxy-credential-routing` "From pi 1.1.0", `credential-delivery` "before 1.1.0", `pi-api-feature-detection`'s 1.0.1–1.1.0 audit, and `release-notes`' Keep-a-Changelog 1.1.0. These are justified in `evidence.md`.

## Decisions

**D1: Floor = pin = 1.3.0 (lockstep).** The fixtures move first. `minimumReleaseAgeExclude` is regenerated from the lockfile; `chord` drops out because nothing resolves it. pi's own exact internal pins (#10865) do not replace our overrides: the overrides also govern `pi-ai` and `pi-tui` for the dashboard's direct imports and keep one hoisted copy for the `/api/health` version probe.

**D2: Retry turn context is accepted, with no code change.** In pi ≥ 1.2.0, the Retry turn's `before_agent_start` arrives with `messageType: "custom"` and the starting `message`, and has no `prompt`. Every handler listed in Context composes on `systemPrompt`/`systemPromptOptions` only, so the Retry turn gains the session-context fragment, kb doctrine, role guidelines and the untrusted-content guideline. This includes the team-guard skill filter (`packages/team-plugin/src/extension/index.ts:34-53`, a fresh filter per start). Before 1.2 a team session's Retry turn ran with unfiltered skills; that gap closes. Considered alternative: skip injection when `messageType === "custom"`. Rejected (user decision): a Retry continues the user's request and should see the same context.

The Retry turn also gets the rest of pi's run prelude (`_startRun` → `_prepareRun`, `agent-session.js:1392-1397,1447-1455`), which 1.1.0's custom-message path skipped. It may auto-compact before the request when the context is over threshold, it delivers pending `deliverAs: "nextTurn"` messages, and it records the tool loadout. Accepted: these are what any user-prompted turn already does.

Cost: the extra system-prompt bytes on Retry turns, which are rare. The kb first-contact nudge (`kb-extension/src/extension.ts:185-203`, once per session) may now fire on a Retry turn. That's acceptable, because it is once-only either way.

**D3: Single-bang send uses `deliverAs: "followUp"`.** `pi.sendUserMessage(message, { deliverAs: "followUp" })`:

| Session state | What pi does |
|---|---|
| Idle | Ignores `streamingBehavior` and starts a turn (unchanged behaviour). |
| Busy (starting or streaming) | Appends the message to its follow-up queue. The run loop drains it (`hasQueuedMessages`) before settling. |
| During the settle emission | Defers it. |
| Compacting | Rejects it ("Cannot submit a prompt while compaction is in progress", `agent-session.js:1620`), and the output is lost, as it is today. Accepted: compaction blocks every prompt path, and the `bash_output` card still shows the output. |

The output is no longer lost. The queued entry is pi-owned, so it is not shown as a dashboard follow-up chip; the bridge's TUI-coexistence gate (`hasPendingMessages`) already waits for it. `!!` and `excludeFromContext` paths are untouched.

**D4: The drain runs on `agent_settled`, with a single idle check.**
- The `agent_settled` branch in `forwarders.ts` schedules `setTimeout(() => inst.drainFollowupQueue(), 0)`, and the `agent_end` scheduling at `forwarders.ts:168` is removed.
- `drainFollowupQueue()` loses its `retryCount` parameter and the 100 ms × 20 loop. When `ctx.isIdle()` is false (another extension's deferred settle action or a TUI prompt has already started a run), it returns. The next `agent_settled` drains.
- Every other invariant is unchanged: the re-entrancy lock, the empty-buffer gate, the TUI-coexistence gate, pop-before-send, emit-before-send, the fresh-turn send with no `deliverAs`, and catch-and-drop.
- `enqueueSystemFollowup` keeps its `setTimeout(drain, 0)`. Called while idle, it ships; called mid-run, the next settle ships it.
- Testability: the gate sequence (empty buffer → pending messages → idle → pop → emit → send → catch) moves into a pure function in a new `packages/extension/src/followup-drain.ts`. Like `followup-buffer.ts`, it takes the buffer, a `ctx`-like probe, `emitQueueUpdate` and `sendUserMessage` as parameters. `bridge.ts` keeps only the `isDraining` lock and the wiring, so tests drive the real decision instead of a mirror (the existing drain tests are mirrors: `bridge-followup-queue-drain.test.ts:4`, `bridge-system-followup.test.ts:46`).

Why `setTimeout` rather than calling inside the handler: a `sendUserMessage` issued synchronously inside the settle emission is deferred by pi into `_deferredSettledActions`, whose failure surfaces inside pi's settle path rather than the bridge's. Deferring by a timer lets the call see a settled, idle session and keeps the bridge's own error handling.

Effects of the new trigger:
- An auto-retry chain fires one `agent_settled` after the final attempt. The drain no longer probes, and gives up, between attempts.
- An aborted run also settles (`aborted: true`). The drain then ships the next entry, as the `agent_end` drain did before: the abort requirement preserves buffers and does not suppress the drain.

**D5: `sessionShareDestination` is a typed enum key.** It uses `enumKey("sessionShareDestination", ["auto","gist","radius"], "auto", "sessions", …)`, following `pi-settings-schema.ts:106-122`. The typed set grows from 49 to 50 keys, and the spec list and the parity test's `SPEC_KEYS` move together.

## Risks / Trade-offs

- **[No `agent_settled` for some runs]** → A `_prepareRun` failure (`agent-session.js:1396-1404`) and a manual `compact()` emit no settle. If the drain bails because compaction started between the settle and the timer (`isIdle` includes `isCompacting`, `:1057-1059`), the entry waits for the next run's settle. The old design shared this exposure: no `agent_end` there, and the 2 s retry gave up. Accepted. The entry stays visible and editable in the queue panel.
- **[Unknown-version runtime]** → `bridge-extension` "Bridge normalizes agent_settled to one terminal signal per run" exempts an unknown-version runtime from the one-settle guarantee. On such a runtime older than 0.80.4, which emits no `agent_settled`, buffered follow-ups would never drain; the `agent_end` drain used to cover it. Accepted for the same reason as that carve-out: an unknown-version runtime is outside every floor guarantee.
- **[Abort with pi-queued follow-ups]** → On abort, pi keeps its native follow-up queue (`abort()` does not clear it), so `hasPendingMessages()` stays true and the TUI-coexistence gate holds the dashboard buffer until the next run. This already applies to TUI follow-ups. D3 adds one more source: a busy `!cmd` queued and then aborted. Accepted. The dashboard entry stays visible and is drained by the next settled run.
- **[Abort-latch ordering]** → The `agent_settled` branch clears the abort latch (`forwarders.ts:123-131`) before the drain timer fires. The old `agent_end` drain also sent only after pi went idle, which is after the settle, so after a user abort the next queued follow-up starts as before. This is behaviour parity, not a new auto-start.
- **[Follow-up typed while a run starts]** → With pi ≥ 1.2.0 the session is busy during `before_agent_start`, but the bridge flips `isAgentStreaming` only on `agent_start` (`forwarders.ts:100`). A dashboard follow-up in that window takes the direct path with `{ deliverAs }` (`bridge.ts:1609`), so pi queues it natively: delivered, but without a dashboard chip. Accepted. The window is the length of `before_agent_start`.

- **[`agent_settled` not delivered to the bridge]** → The floor guarantees native `agent_settled` (0.80.4+). The retry tracker already depends on it as the sole terminal signal (`forwarders.ts:123-130`). A dropped settle now also stalls the drain until the next settle, the same exposure the retry chain already has.
- **[Busy `!cmd` output is invisible in the queue UI]** → It is accepted as pi-owned; it shows in chat when delivered. Routing it through the bridge buffer is a non-goal.
- **[Hidden `messageType` consumers in third-party extensions]** → This is outside the dashboard; pi's breaking-change note covers it.
- **[The floor raise strands users on pi < 1.3.0]** → The existing red advisory plus the `CHANGELOG.md` note, as in every lockstep bump.

## Migration Plan

Land as one commit: fixtures, then pins, `pnpm install`, code, tests and docs. Rollback: revert the commit and run `pnpm install`. No persisted state changes.

## Open Questions

None. The scope decisions (D2 context accepted, schema derivation deferred, drain simplified) were taken with the user during explore.
