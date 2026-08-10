## 1. Red tests first (must FAIL against today's monkey-patch)

- [ ] 1.1 Add `packages/extension/src/__tests__/eventbus-foreign-emit-forwarding.test.ts`: build ONE `node:events` emitter and TWO independent `{ emit, on }` facades over it (pi's `createExtensionAPI` topology, per design D7); hand facade A to the production bridge EventBus wiring with a fake connection; emit `flow:complete` through facade **B**; assert a real `event_forward` with `eventType: "flow_complete"` and the payload verbatim reached the fake connection.
- [ ] 1.2 RUN 1.1 and record that it FAILS today (no `event_forward` produced) — paste the failure into the task notes. Do not proceed until the red is observed.
- [ ] 1.3 Extend 1.1 with: (a) `subagents:completed` from facade B forwards as `subagent_completed`; (b) an emission from facade B while not-ready is NOT forwarded; (c) a bridge-self emission forwards EXACTLY once (no double-forward); (d) coverage assertion — every key of `EVENT_BUS_MAP` has an active subscription; (e) forwarding failure (throwing connection) does not break delivery to other subscribers of that channel.
- [ ] 1.4 Add `packages/automation-plugin/src/__tests__/flows-run-finalizes-on-forwarded-completion.test.ts`: boot the REAL `registerPlugin` with a stub `ServerPluginContext` and the REAL `flowsActionContributions` published under `automation.action.flows`; write a temp folder-scope automation with `action: { kind: flows.run, payload: { flow, task } }` + concrete `model`; fire via the real `plugin_action` `run` path; assert `emitEventToSession` received `flow:run`; push `{ eventType: "flow_complete", data: { flowName, status: "success", lastResult: { result: { summary } } } }` into the registered `ctx.onEvent`; assert on-disk `run.json.status === "done"` and the result line came from the action's summarizer. (Isolate `HOME`; select the run by the runId the run path returned.)
- [ ] 1.5 Fold the four cases of `packages/automation-plugin/src/__tests__/finalize-event-dispatched.test.ts` into 1.4 as real-handler cases (declared-completion finalize, unrelated event does not finalize, buffered text preferred over summarizer, no-completion run finalizes on `agent_end`), then **DELETE** that mirror file.
- [ ] 1.6 RUN 1.4/1.5 and record that they PASS pre-fix (they prove the server side is already correct) — this is the control for task 3.

## 2. Replace the emit intercept with per-channel subscriptions

- [ ] 2.1 In `packages/extension/src/bridge.ts`, delete the `origEventsEmit` capture, the `pi.events.emit = wrapper` assignment, and the cleanup restore (`pi.events.emit = origEventsEmit`). Nothing is mutated on the host surface any more.
- [ ] 2.2 Extract the wrapper body into one shared `forwardBusEvent(channel, data)` handler preserving today's semantics exactly: subagent-channel branch (buffer/`markForwarded`/`connection.isConnected`), the `sessionReady && isActive()` gate for everything else, `sendEventForward` rename via `EVENT_BUS_MAP`, and a try/catch so forwarding can never throw into the emitter.
- [ ] 2.3 Subscribe `forwardBusEvent` per channel by iterating `Object.keys(EVENT_BUS_MAP)` (design D2), once per bridge instance at wiring time (D4), collecting the unsubscribe functions returned by `pi.events.on`.
- [ ] 2.4 Move the subscription loop into `packages/extension/src/flow-event-wiring.ts` (D5), injected with `forwardBusEvent`; update the stale comment that defers to the emit intercept.
- [ ] 2.5 Release the collected unsubscribers on bridge teardown/supersede; assert no code path reassigns any host emit function.
- [ ] 2.6 Add the finalize-path diagnostic (design D8): the automation plugin logs which path finalized a run (completion event / `agent_end` / session death / reaper) at info level.

## 3. Turn the red green

- [ ] 3.1 Re-run 1.1/1.3 — the foreign-facade forwarding tests now PASS.
- [ ] 3.2 Re-run 1.4/1.5 — still PASS (no regression on the server path).
- [ ] 3.3 `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log` then `grep -nE 'FAIL|Error|✗|✘|Tests +[0-9]+ (failed|passed)' /tmp/pi-test.log` — full suite green, with special attention to `packages/flows-plugin/src/__tests__/flow-reducer-bridge-contract.test.ts` (it asserts against `FLOW_EVENT_MAP`) and any existing bridge/subagent tests that assumed the intercept.
- [ ] 3.4 Type gate: `npx tsc -b` (or the repo's configured typecheck) clean.
- [ ] 3.5 `npm run quality:changed` clean (Biome ratchet, per the `code-quality` skill).

## 4. Prove it end-to-end (execution, not inference)

- [ ] 4.1 Reload sessions so the new extension wiring is live (`npm run reload`); confirm a session picked it up.
- [ ] 4.2 Create a throwaway folder-scope automation with a `flows.run` action against any available flow, fire it via `POST /api/plugins/automation/run`, and observe the run's `run.json` reach `status: "done"` within seconds.
- [ ] 4.3 Confirm the negative: the run record carries NO `error: "run exceeded max age"`, and the server log shows the completion-event finalize path (task 2.6) — not the reaper, not "finalized on session death".
- [ ] 4.4 Confirm the spawned session is terminated and the concurrency slot freed (the next fire is not dropped as overlapping).
- [ ] 4.5 Record the evidence (run id, elapsed time, finalize-path log line) in the change notes, then remove the throwaway automation.

## 5. Verify the live-forwarding corollary

- [ ] 5.1 With a live session, run a flow interactively and confirm live `flow_*` `event_forward` messages arrive at the server DURING the run (not only after a reload/cold hydration).
- [ ] 5.2 Confirm the flow card renders from live events with the dashboard's persisted-JSONL replay path (`packages/shared/src/state-replay.ts`) not being the source — e.g. by observing card progress before any replay could have run.

## 6. Discharge the residual unknown (subagent frames)

- [ ] 6.1 Run a real subagent in a live session and confirm `subagent_created/started/completed` are forwarded live on the new subscription path — this is currently code-read only and MUST be verified by execution.
- [ ] 6.2 Exercise the not-ready path: emit subagent frames while the transport is closed (or before ready), then reconnect, and confirm the per-agent buffer flushes exactly once with latest-wins semantics.
- [ ] 6.3 If either 6.1 or 6.2 regresses, fix on this change (the buffer contract is part of the moved branch) — do not defer.

## 7. Specs, docs, gates

- [ ] 7.1 `openspec validate fix-automation-run-lifecycle --strict` clean.
- [ ] 7.2 Apply the spec deltas at archive time: `catch-all-event-forwarding` (mechanism + live-delivery guarantee + wildcard removal), `automation-action-registry` (stale finalization scenario retired, pointer to `automation-run-lifecycle`), `automation-run-lifecycle` (live-completion finalize, reaper is backstop only).
- [ ] 7.3 Update the nearest directory `AGENTS.md` rows for every touched/added/deleted file (`packages/extension/src/`, `packages/extension/src/__tests__/`, `packages/automation-plugin/src/__tests__/`) with purpose + `See change: fix-automation-run-lifecycle`.
- [ ] 7.4 Delegate any `docs/` prose (architecture note: EventBus forwarding is subscription-based because `pi.events` is per-extension) to the DocScribe subagent in caveman style; do not edit `docs/` directly.
- [ ] 7.5 Add a CHANGELOG `## [Unreleased]` entry: live flow/subagent event forwarding restored; automation `flows.run` runs finalize instead of being reaped.
- [ ] 7.6 Run the `review-code` discipline over the diff before commit; spawn `Audit` only if the diff grows beyond the extension event path.
