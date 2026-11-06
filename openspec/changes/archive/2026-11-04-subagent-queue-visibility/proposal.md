# Proposal

## Why

A subagent waiting for a free slot looks the same as one that is running: the card has a spinner, a yellow border and a timer that counts the wait as run time. `AgentToolRenderer` maps the producer's `status: "queued"` to `running`. Every per-row stop sends a session-wide abort, so stopping one subagent ends the whole turn. There are also two concurrency limits:
- the dashboard's `maxConcurrentSubagents` *refuses* extra calls and is read once per session;
- the producer's `maxConcurrent` *queues* them, but can only be edited by hand.

With equal values the queue never forms. `@blackbelt-technology/pi-dashboard-subagents` 0.6.0 now provides queue info, per-subagent stop and a live limit, so the dashboard can surface all of it.

## What Changes

- **Queued state (plugin).** A `queued` subagent renders as a neutral waiting card: dashed neutral border, clock icon, no spinner. It shows `#<queuePosition> in queue`, an `activeSlots/maxConcurrent` slot reading and the wait time. The run timer counts from `slotGrantedAt`, so the wait is never shown as run time. Producers older than 0.6.0 show a plain `Queued` pill.
- **Per-subagent stop.** Each queued or running subagent's row and card stop only that subagent:
  - **Route:** a new plugin route `POST /api/plugins/subagents/stop {sessionId, agentId}` requires operate authority, validates both ids, and relays a fixed `subagents:stop {agentId}` into the session through `ctx.emitEventToSession`. The plugin manifest declares `emits: ["subagents:stop"]`.
  - **Feedback:** the card shows "stopping…". A refused request or a missing confirmation within 10 s is surfaced on the card, and the control is re-enabled.
  - **Fallback:** without `stoppable`, the row keeps today's session-wide stop.
- **Stopped state.** A subagent that ends `status: "stopped"` renders neutral and final on the card, chat row, dock and detail view: "removed from queue · never started" or "stopped by you · ran <t>". Late frames cannot reopen it.
- **Generic claim seams (core client).** The `tool-renderer` claim gains optional `rowStatus`, `stop` and `stopLabel`, modelled on `resultPending`:
  - `rowStatus` → `{state: "queued" | "stopped", label?}` replaces the spinner or the success check.
  - `stop` is consulted before the row's own abort and before an enclosing burst-group controller.
  - Core stays subagent-agnostic.
- **"Max parallel subagents" setting (plugin).** A number field (0 to 64, `0` = unlimited, default 4) edits the producer's `maxConcurrent` through the existing producer-file mirror. It takes part in the host's global save state. It shows the heap-limits per-child budget warning. Changes apply live, including to waiting subagents.
- **BREAKING: remove `maxConcurrentSubagents`.** The bridge fan-out admission gate, its saturation sampler, its config key, and the Settings → Sessions field with its heap warning are removed, and no more `subagent-admission-refused` entries are written. The existing diagnostics group still hides old ones. The producer's `maxConcurrent` is the only subagent concurrency limit, so extras queue instead of failing.
- **Harness.** The docker E2E harness pins producer 0.6.0.
- Mockup: mockups/subagent-queued-state (in this change)

## Capabilities

### New Capabilities
- `subagent-queue-state`: how the dashboard presents a subagent waiting for a slot (card, chat row, position, slot reading, wait vs run time).
- `subagent-stop-control`: stopping one subagent from the dashboard, covering the stop request, its feedback, and how a stopped subagent is shown.

### Modified Capabilities
- `agent-tool-rendering`: `ToolCallStep` reads the optional `tool-renderer` claim fields `rowStatus`, `stop` and `stopLabel`.
- `subagent-producer-settings-persistence`: the mirror, merge and reconcile cover `maxConcurrent`. Adds the "Max parallel subagents" field on the global save state.
- `subagent-fanout-admission`: all requirements REMOVED, because the admission gate is deleted.
- `subagent-live-detail-reliability`: `stopped` is terminal wherever `completed` or `failed` is.
- `heap-limits`: the heap/fan-out coupling pairs the session ceiling with the producer's `maxConcurrent`.
- `settings-panel`: the heap/fan-out disclosure is REMOVED from Settings → Sessions, together with the field.

## Discipline Skills

- `security-hardening`: a new browser-reachable route stops work in a session from HTTP input. It needs an operate-authority gate, id validation, a known-session check, and a fixed event type behind the emit allowlist.
- `observability-instrumentation`: each stop request is logged with session, agent and outcome. The producer logs its side.
- `doubt-driven-review`: the new claim fields are a published plugin-API contract, and removing the admission gate drops a memory-safety mitigation.
- `review-code`: a cross-package change (core client, extension, shared, plugin client and server). Run it before commit.

## Impact

- `packages/subagents-plugin`: `src/client/AgentToolRenderer.tsx`, `toolRowFinalizer.ts`, `SubagentDockGroup.tsx`, `SubagentDetailView.tsx`, `SubagentsSettings.tsx`; `src/server/index.ts` and `producer-file.ts`; `src/configSchema.json`; `package.json` (`emits`, claim fields).
- Core client: `ToolCallStep.tsx`, `runtime-plugin-loader.ts`, and `packages/client-utils/src/agent-card-utils.ts`.
- Shared: `manifest-types.ts`, `subagent-types.ts`, `config.ts`, `heap-limits.ts`, `custom-event-groups.ts`.
- Codegen: `packages/dashboard-plugin-runtime/src/vite-plugin/index.ts`.
- Admission removal: `packages/extension/src/subagent-fanout-admission.ts` (deleted), `bridge.ts`, `bridge-handlers/instance.ts`, `bridge-handlers/lifecycle.ts`, `SettingsPanel.tsx`, i18n, and `tests/e2e/subagent-fanout-admission.spec.ts`.
- `docker/Dockerfile` `PI_DASHBOARD_SUBAGENTS_VERSION` → `0.6.0`.
- Docs: `docs/heap-limits.md`, `docs/architecture.md`, `docs/faq.md`, `docs/security/tool-call-guards.md`, `docs/security-map.md`, `docs/research/unified-context-manager-exploration.md`.
- In-flight changes `add-supervised-tool-approval` and `unify-context-manager` reference the gate and need a follow-up update.
- Requires producer 0.6.0 for the queue info, stop and live limit. Older producers degrade to a plain `Queued` pill and the session-wide stop.
