# Tasks — Fix automation identity persistence

> Requirements: `specs/meta-json-session-cache/spec.md` (R1). Test scenarios and
> their dispositions: `test-plan.md` (the manifest — every automated row is
> folded below as a test task; there are no manual-only rows).
>
> L1 harness exemplars — read for glue, do NOT modify:
> `packages/server/src/__tests__/meta-key-byte-identity.test.ts` (the projection
> guard this change extends), `packages/server/src/__tests__/notify-log-persistence.test.ts`
> (the save→restart→restore round-trip shape), and
> `packages/client/src/lib/__tests__/filter-automation-visibility.test.ts`
> (board-filter harness for the visibility partition).
> L3 harness exemplars: `tests/e2e/archive-fold.spec.ts` and
> `tests/e2e/ended-session-endedat.spec.ts` (both seed `.meta.json` sidecars
> out-of-band); read the harness port from `.pi-test-harness.json`
> (`dashboardPort`), never hardcode `:18000`.

## 1. Server persistence tests (red)

Each task must FAIL before group 2 lands. 1.1–1.4 extend
`packages/server/src/__tests__/meta-key-byte-identity.test.ts`; 1.5 belongs
beside the scanner round-trip exemplars.

- [x] 1.1 Full-overwrite wipe is closed: sidecar holding a merged automation ref (`kind: "automation"`, `automationRun {name, runId, visibility: "hidden"}`) · an unrelated field changes and the routine full-overwrite save runs · re-read sidecar still carries `kind` and an `automationRun` deep-equal to the merged value (test-plan #E1).
- [x] 1.2 Projection→restore round-trip: session carrying `kind` + `automationRun` · projected to meta then rebuilt from that meta · rebuilt session carries both, `automationRun` deep-equal (test-plan #E2).
- [x] 1.3 Classification × identity decision table: four sessions — (kind+run), (kind only), (run only), (neither) · each projected and rebuilt · each rebuild reproduces exactly the fields its input had, nothing invented, nothing dropped (test-plan #E3).
- [x] 1.4 Byte-identity invariant E5 holds: plain user session with no classification and no identity · projected and `JSON.stringify`d · output contains neither key (test-plan #E4).
- [x] 1.5 Malformed identity does not break the scan: sidecar whose `automationRun` is present but missing `runId` · cold-start scan reads the directory · scan completes and yields the session, no throw and no skipped directory (test-plan #X1).

## 2. Server persistence implementation (green)

- [x] 2.1 Enumerate `kind` and `automationRun` in `sessionToMeta` (`packages/server/src/session/session-to-meta.ts`), each with the "MUST be enumerated — this save is a FULL overwrite" note its neighbours carry and a `See change:` reference. Verify: 1.1–1.4 pass.
- [x] 2.2 Restore `automationRun` in `sessionFromMeta` (`packages/server/src/session/session-scanner.ts`, beside the existing `kind: meta.kind`). Verify: 1.2, 1.3, 1.5 pass.
- [x] 2.3 Confirm no other write path clears the fields: grep the server for full-overwrite meta writes and check none omits them. Verify: `grep -rn "automationRun" packages/server/src --glob '!*.test.*'` shows the projection and the restore, and nothing that strips them.

## 3. Client surface tests (red → green)

- [x] 3.1 Visibility partition survives the round-trip: two restored runs, one `visibility: "hidden"` and one `visibility: "shown"` · each projected, rebuilt, and passed through the board filter with show-hidden off · the hidden run is filtered OUT and the shown run is RETAINED — the fix must not over-hide (test-plan #E5; extend `filter-automation-visibility.test.ts`).
- [x] 3.2 Legacy identity-less run badges with the fallback: session with `kind: "automation"` and no `automationRun` · badge rendered · fallback automation label renders, not `null` and not a run name (test-plan #E6).

## 4. End-to-end restart behaviour

New spec `tests/e2e/automation-identity-restart.spec.ts`; copy harness glue from
`archive-fold.spec.ts` (sidecar seeding) and `ended-session-endedat.spec.ts`.
Spec must self-isolate its seeded folder.

- [x] 4.1 Hidden run does not resurface after a restart: folder seeded with an ended automation-run session (`kind` + `automationRun {visibility:"hidden"}`) plus one ordinary ended user session · dashboard restarted so the session set is rebuilt from disk · folder group converges to the user session only, and the run appears when show-hidden is toggled on (test-plan #F1).
- [x] 4.2 Restart is invisible to the run surface: same seeded run with show-hidden ON · restart, then open the run's card · the automation slot contribution mounts and the badge shows the run name (test-plan #F2).

## 5. Validate

- [x] 5.1 Run the full suite: `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log` then `grep -nE 'FAIL|Error|✗|✘|Tests +[0-9]+ (failed|passed)' /tmp/pi-test.log`. Verify: no failures.
- [x] 5.2 Manual check on the live install: restart the dashboard and confirm the `/Users/robson` folder group gains no NEW `consolidate-hermes-memory` cards after the next automation run. Verify: the run's sidecar carries `kind` (`grep -l '"kind": "automation"' ~/.pi/agent/sessions/--Users-robson--/*.meta.json` is non-empty) and no new card renders. Note: the six already-orphaned cards are NOT cleared by this change (forward-only, stated in the proposal).
- [x] 5.3 Confirm the two behaviour-change consumers named in the proposal: `predicates.ts` slot contributions mount for a restored run (covered by 4.2) and `FlowGraph.tsx` renders unchanged for a restored automation session. Verify: flows graph opens without error on a folder containing a restored run.
- [x] 5.4 Update `packages/server/src/session/AGENTS.md` rows for `session-to-meta.ts` and `session-scanner.ts` with the new enumerated/restored fields and a `See change:` reference.
