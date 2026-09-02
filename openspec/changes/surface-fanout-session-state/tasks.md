## 1. Lock the observable contracts with failing tests

- [ ] 1.1 Add a work-source lease test for 6 available items with bound 4; verify the source returns 4 handles plus `deferredCount: 2`, and verify the 2 deferred items remain eligible for a later lease.
- [ ] 1.2 Add the all-leased boundary test for 4 available items with bound 4; verify the lease summary reports 4 handles and `deferredCount: 0` rather than omitting the count.
- [ ] 1.3 Add an engine observability test; verify one work-source fire persists `leasedCount` and `deferredCount` on its parent and emits one log containing both counts and the effective bound.
- [ ] 1.4 Add a run-list route test for a `running` parent with 4 `running` children; verify one response contains parent `status`, ordered `children`, attached `childRuns`, each child's distinct `workItemKey`, and enough data to derive a running count of 4 plus map every child/session to its item.
- [ ] 1.5 Add a partial-startup polling test; verify a running parent is returned before every child is appended and a later route call exposes newly persisted children.
- [ ] 1.6 Add a concurrency regression test; verify one admitted `concurrency: queue` fire starts all 4 leased handles without waiting, while a second overlapping fire waits until the first parent finalizes.

## 2. Expose the work-source lease summary

- [ ] 2.1 Replace the generic work-source `next(bound)` handle-array result with an atomic `{ handles, deferredCount }` lease summary; update every generic source implementation and verify the tests from 1.1–1.2 pass.
- [ ] 2.2 Update the engine work-source path to consume the lease summary without leasing or dropping deferred items; verify the later lease in task 1.1 still receives the remainder.
- [ ] 2.3 Keep bound resolution unchanged (per-automation override → plugin config → `PI_AUTOMATION_MAX_CONCURRENT_SPAWNS` → hard default 4); verify existing bound-precedence tests remain green and add no configuration key.

## 3. Persist and log fan-out state

- [ ] 3.1 Add optional `leasedCount` and `deferredCount` fields to fan-out parent run records, and `workItemKey` to work-source child records; write explicit parent zero values and copy each leased handle's stable key to its child, then verify historical records without the fields still deserialize/list successfully.
- [ ] 3.2 Emit one structured fire log with automation identity, parent run id, effective bound, leased count, and deferred count; verify the 4-of-6 and 4-of-4 cases produce distinguishable log assertions.
- [ ] 3.3 Keep deferred work informational rather than truncation/failure; verify no deferred handle receives a child record or terminal status until a later fire leases it.

## 4. Pin the polling lifecycle response

- [ ] 4.1 Preserve the run-list route's parent shape with `status`, ordered `children`, and attached `childRuns`, including each work-source child's `workItemKey`; verify task 1.4 passes without adding a second endpoint or aggregate `runningCount` field.
- [ ] 4.2 Ensure each poll reflects the latest persisted child status and partial startup state while retaining each child's `workItemKey`; verify task 1.5 plus a running-to-terminal child transition test pass with unchanged attribution.
- [ ] 4.3 Do not add a run-lifecycle WebSocket event; verify the change diff contains no new lifecycle broadcast type and route tests establish polling as the update mechanism.

## 5. Document the two concurrency axes

- [ ] 5.1 Delegate automation documentation to DocScribe using caveman style: describe `concurrency` as inter-fire admission and `maxConcurrentSpawns` as intra-fire lease width, with a `concurrency: queue` example that starts 4 children concurrently; verify no text claims queue serializes children within one fire.
- [ ] 5.2 Document the run-list polling contract, including per-child `workItemKey`, and explicitly mark lifecycle WebSocket push out of scope; verify the documented response fields match the route test fixture.
- [ ] 5.3 Update the nearest package/server `AGENTS.md` purpose rows for every touched file with `See change: surface-fanout-session-state`; verify `kb dox lint` reports no new tree errors.

## 6. Verify

- [ ] 6.1 Run the targeted automation-plugin source, engine, run-store, runner, and route test files; verify all new and existing focused tests pass.
- [ ] 6.2 Run `npm run quality:changed`; verify no changed-file quality errors remain.
- [ ] 6.3 Run `npm test` once with `set -o pipefail` and captured output, then `npm run build`; verify both repository gates pass.
- [ ] 6.4 Run `observability-instrumentation` against the deferred-work signal and `review-code` against the completed diff; resolve every blocking finding and verify the focused tests remain green.
