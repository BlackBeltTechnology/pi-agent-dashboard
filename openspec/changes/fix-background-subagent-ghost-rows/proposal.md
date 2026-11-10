# Proposal

## Why

The composer dock can show subagents as running long after they ended. A Stop click on such a row cannot fix it. On 2026-11-09 the judo-blueprint session showed 10 background `judo-blueprint-author` rows as running, then `Stopping…`, for about 15 hours. At 15:56 the producer had already reported `0 running` (`AgentCancel` → "Nothing to cancel"). The rows went away only when the pi process restarted the next morning and its history was rebuilt.

Three gaps line up to cause this:

1. **The end frame is lost.** `subagent_completed` / `subagent_failed` are transcript-class, and the gateway sheds them when a browser socket is over `MAX_WS_BUFFER`. That session shed 6 942 frames. Nothing re-requests a shed subagent end. The client sees the seq gap but only uses it to skip its replay cache.
2. **A stop the session cannot act on gets no answer.** The producer looks up the id. When the id is unknown or already ended, it logs `ignored` to the pi console and replies with nothing. The dashboard waits for an end frame that never comes. The row says `Still running` after 10 s, and every later click does the same.
3. **No reconcile when a session's bridge re-initializes.** After an extension reload or bridge takeover the producer tracks nothing (or something different), but the browser map still says `running`. No signal ever tells the client which subagents the session actually runs.

The result is a dock that shows false state and gives the user no way to correct it. Next time a subagent really hangs, the user cannot tell a ghost from a hang.

## What Changes

- **Every stop gets an answer (A).** Each producer activation that receives `subagents:stop` answers on the bus with its own verdict (`phase`: `queued`, `running`, `terminal` or `unknown`, plus the final `status` when terminal). The subagents plugin's bridge entry, which runs in the same session, combines the verdicts of every activation on that bus and forwards one `subagent_stop_result { agentId, outcome, phase, status? }` to the dashboard. When no activation of the session runs the subagent (phase `unknown`), the subagent becomes terminal as *ended, not tracked by its session*: its dock row leaves the lane and the pending stop clears. When the phase is `terminal` and the answer carries the run's final status, that status is applied.
- **Subagent end frames are never shed (B).** `subagent_completed`, `subagent_failed` and the two new subagent control frames get a defer key per subagent (or per session for the snapshot). On a healthy socket they go out exactly as today. Where the gateway would shed them, it defers a size-bounded copy in the pending map and delivers it once the socket drains. Every other session event stays transcript-class.
- **Reconcile when the session's bridge initializes (D).** On every `dashboard:bridge-ready` (session start, extension reload, bridge takeover), the plugin's bridge entry asks every producer activation on the bus for the subagents it tracks (queued, running, and finished with their status) and forwards the union as `subagent_registry_snapshot` with the time it was taken. Any subagent in the browser map that is still queued or running for that session, not in the snapshot and with no newer live frame becomes terminal (*ended, not tracked by its session*), or takes the finished status the snapshot gives for it. A later live frame for it revives it in the dock. A plain transport reconnect sends no snapshot: the browser then replays from the server store, which holds the ends, and the stop answer covers the rest.
- **Older producers degrade to today.** Without `stop_result` or a snapshot, the dock keeps its current feedback (`Stopping…` → `Still running` after 10 s), and B still prevents most ghosts.
- **Producer half ships separately.** The two producer-side bus contracts (the stop verdict and the registry query) are specified here as the contract the dashboard consumes. The producer implementation is a sibling change in `pi-dashboard-subagents` (next minor release).

## Capabilities

### New Capabilities

- `subagent-liveness-reconcile`: how the dashboard corrects a subagent it shows as live but the owning session no longer runs, from a stop answer or a registry snapshot; the wire contract of `subagent_stop_result` and `subagent_registry_snapshot`; the *ended, not tracked* terminal presentation.

### Modified Capabilities

- `subagent-stop-control`: dock and card stop feedback gain the "session does not run it" outcome, which ends the row instead of leaving it on `Stopping…` / `Still running`.
- `ws-frame-delivery-policy`: subagent end and control frames get a defer key, so a saturated socket defers a bounded copy instead of shedding them.

## Impact

- `packages/server/src/pairing/browser-gateway.ts`: a `deferKeyOfEvent` helper beside `frameClassOf` (unchanged); `sendTo`'s shed branch defers a bounded projection for keyed frames; new `deferredSubagentFrames` health counter.
- `packages/subagents-plugin/src/bridge/index.ts`: collects stop verdicts and registry answers on the session bus, declares two new forward channels, emits the combined frames.
- `packages/subagents-plugin/src/client/`: `lastFrameAt` on the plugin's subagent state (`sessionEventReducer.ts`); finalizer arms for `subagent_stop_result` and `subagent_registry_snapshot`, `untracked` revive (`toolRowFinalizer.ts`); "no longer tracked" copy (`i18n.ts`, full-screen view).
- `packages/shared/src/dashboard-plugin/subagent-types.ts`: documents the new `healedBy` values `untracked` and `session_reconcile` (the field is already a string).
- Tests: plugin client unit tests, gateway unit tests, `tests/e2e/background-subagents.spec.ts` / `subagent-queue-stop.spec.ts`. The e2e harness pin moves to the producer release that carries the two channels.
- `packages/client/src/lib/replay/replay-persist.ts`: never caches a deferred, projected end frame.
- Dependency: producer `@blackbelt-technology/pi-dashboard-subagents` next minor (sibling change `emit-subagent-stop-verdicts-and-registry` in that repo). The dashboard ships first and stays compatible with 0.7.0.
