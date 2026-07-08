## 1. Resolver: cwd → live flows (TDD)

- [x] 1.1 In `packages/flows-plugin/src/__tests__/automation-actions.test.ts`, add tests for the new resolver-based contribution: `flowsActionContributions(flowsForCwd)` where `flowsForCwd` is a stub. Assert `available(cwd)` is `flowsForCwd(cwd).length > 0` and the `flow` enum `options(cwd)` equals `flowsForCwd(cwd)`. Cover: non-empty list → available + options populated; empty list → unavailable + `[]`. Verify tests fail first.
- [x] 1.2 In `automation-actions.ts`, change `flowsActionContributions()` to accept `flowsForCwd: (cwd: string) => string[]` and use it for both `available` and the `flow` enum `options`. Remove the static `discoverFlows`/`hasFlows` helpers (no other caller). Keep `FLOW_ID_RE`, `buildEvent`, `summarizeFlowResult`, and payload shapes unchanged. Update the field `help` text (no longer "Discovered in .pi/flows/flows"). Make 1.1 pass.
- [x] 1.3 Update the existing `discoverFlows` describe block and the `flowsActionContributions` fs-based test: delete the `discoverFlows` filesystem tests, re-point the contribution tests at the injected stub (no `mkdtemp`/`flow.yaml` scaffolding). Keep the `flow:run` `buildEvent` + malformed-id + inputs tests intact (they don't depend on discovery).

## 2. Wire the resolver in the server entry

- [x] 2.1 In `packages/flows-plugin/src/server/index.ts`, build `flowsForCwd(cwd)`: narrow `ctx.sessionManager.listActive()` to `{ id: string; cwd: string }[]`, filter to exact `cwd` match, union `stateStore.getState(s.id)?.flows?.map(f => f.name)` across matches, return sorted-unique. Guard missing/oddly-shaped entries.
- [x] 2.2 Pass `flowsForCwd` into `flowsActionContributions(flowsForCwd)` used by `provideFlowsActions`. Confirm `provideFlowsActions` still publishes under `automation.action.flows`.
- [x] 2.3 Add a focused server-entry test (or extend an existing flows-plugin server test) that seeds `stateStore.setFlows(sessionId, [{name:"invoicebot:pull",...}])`, stubs `sessionManager.listActive()` to return a session with matching `cwd`, and asserts the resolved contribution's `available(cwd)` is true and options include `invoicebot:pull`. Also assert empty result when no session matches the cwd.

## 3. Docs + verify

- [x] 3.1 Update the `automation-actions.ts` row in `packages/flows-plugin/src/server/AGENTS.md`: `flows.run` availability + enum options now derive from the live per-session flows list (`stateStore` + `sessionManager` cwd match), not a `.pi/flows/flows/` scan; static `discoverFlows` removed. Add `See change: fix-automation-flow-detection`. Caveman style.
- [x] 3.2 Run `npm test 2>&1 | tee /tmp/pi-test.log` and `grep -nE 'FAIL|Error|✗' /tmp/pi-test.log`; fix any fallout (including other files importing `discoverFlows`).
- [x] 3.3 Restart the dashboard server (`curl -X POST http://localhost:8000/api/restart`), open Create Automation for a folder with a running invoicebot session, and confirm `flows.run` is enabled with its flows listed in the `flow` enum. Confirm a folder with no running session still shows it disabled.
