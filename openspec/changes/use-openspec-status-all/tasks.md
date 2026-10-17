## 1. Recipe, envelope and fallback detection (shared)

- [ ] 1.1 Write the failing envelope test for a partial failure (test-plan #E1). Exemplar: `packages/shared/src/__tests__/openspec-poller-1.6.0-compat.test.ts`. Input: fake `status --all` stdout with 102 entries, one an error entry, exit 1. Trigger: build. Observable: 102 changes, `initialized:true`, `bad.error.code==="change_error"`, empty artifacts on `bad`.
- [ ] 1.2 Write the failing root-null whole-call failure test (test-plan #E2). Exemplar: `packages/shared/src/__tests__/openspec-poller-1.6.0-compat.test.ts`. Input: stdout `{"changes":[],"root":null,"status":[{"severity":"error",…}]}`, exit 1. Expect `{initialized:false}` + `cli-failed`, then exactly one more `--all` spawn on the next tick.
- [ ] 1.2a Write the failing implicit-root test (test-plan #E3), same exemplar. Input: `root.source:"implicit"`, exit 0. Expect classification as whole-call failure (`cli-failed`, not `READY`).
- [ ] 1.2b Write the failing no-JSON test (test-plan #E4), same exemplar. Input: stdout `Error: boom`, exit 1. Expect `cli-failed`, data not `initialized:true`.
- [ ] 1.3 Write the failing sanitization BVA test (test-plan #E5), same exemplar. Messages of 499/500/501/4000 chars containing `\n` and `\x1b`, codes of 64/100 chars. Expect: one line, no control characters, message ≤ 500, code ≤ 64.
- [ ] 1.4 Write the failing unknown-entry test (test-plan #E6), same exemplar. An entry with neither `artifacts` nor `status` must map to `error.code==="unknown-entry"`.
- [ ] 1.5 Write the failing fallback-detection decision-table test (test-plan #E15). Exemplar: `packages/shared/src/__tests__/platform-exec.test.ts`. Rows:
  - unknown-option text on stderr / on stdout / alongside JSON;
  - package `version` unchanged / changed;
  - no `package.json` (cached for the process, re-tried on force refresh).
- [ ] 1.6 Implement in `packages/shared/src/platform/openspec.ts`:
  - `OPENSPEC_STATUS_ALL`, 30 s timeout, returning raw stdout (+ stderr on non-zero exit, from the failed-execution result, not `tolerate`);
  - envelope classification + sanitization in a pure module usable by the worker;
  - fallback classification keyed by the resolved package `version` (realpath of the entry → nearest `@fission-ai/openspec` `package.json`).

  Verify #E1–#E6 and #E15 are green.
- [ ] 1.7 Add `yaml` to `packages/shared/package.json`, using the version already in the repo (2.9.0). Verify with `pnpm install` and `npx tsc --noEmit -p packages/shared`.
- [ ] 1.8 Add `error?: { code: string; message: string }` to `OpenSpecChange` in `packages/shared/src/types.ts`; verify `npx tsc --noEmit -p packages/shared`.

## 2. Task counting, ordering, build (shared / worker)

- [ ] 2.1 Write the failing task-line counting test (test-plan #E7). Exemplar: `packages/shared/src/__tests__/openspec-poller-derive.test.ts`. The fixture contains indented, fenced, `* [X]` and CRLF lines. Counts must equal OpenSpec's `countTasksFromContent` on the same text (37/16 on the base fixture).
- [ ] 2.2 Write the failing tracked-file selection decision-table test (test-plan #E8), same exemplar. Cases and expected counts:
  - project `apply.tracks: plan.md` → counts `plan.md`;
  - project schema with no `apply.tracks` → counts artifact `tasks`;
  - unmatched `apply.tracks` → counts top-level `tasks.md`;
  - user-dir `spec-driven` shadow → counts `other.md`;
  - broken change → `totalTasks` 9.
- [ ] 2.3 Write the failing canonical-order test (test-plan #E9), same exemplar. CLI order `proposal, specs, dependencies, design, tasks` must come out as `proposal, design, specs, tasks, dependencies` on both the gated and the force build.
- [ ] 2.4 Write the failing change-order test (test-plan #E10), same exemplar. Cold cache; probe enumerates `changes/*`; expected order `b, c, a` (newest first, ties by name).
- [ ] 2.5 Implement in `packages/shared/src/openspec-poller.ts`:
  - `countTasks` (OpenSpec `TASK_LINE_PATTERN`);
  - schema `apply.tracks` resolution (project → `$XDG_DATA_HOME` → built-in, memoized by mtime);
  - `buildOpenSpecDataFromStatusAll` with canonical artifact order, mtime-sorted changes, and the existing promote-only overrides.

  Keep `deriveArtifactStatus` for the fallback path. Verify #E7–#E10 are green.
- [ ] 2.6 Write the failing worker-crash fallback test (test-plan #X6). Exemplar: `packages/server/src/__tests__/openspec-poll-worker.test.ts`. A crash during the build request must yield in-process data equal to the worker result, and the broadcast must still be emitted.
- [ ] 2.7 In `packages/server/src/openspec/openspec-poll-worker.ts` and `openspec-poll-worker-pool.ts`, add `probe` (tracked-path effective mtimes, enumerating `changes/*`) and `build` (parse + classify + counts + build + serialize + post-call re-stat) requests, with in-process async fallbacks. Verify #X6 is green and the existing `openspec-poll-worker.test.ts` is green.

## 3. Server poll paths (directory-service)

- [ ] 3.1 Write the failing force-refresh spawn test (test-plan #E17). Exemplar: `packages/server/src/__tests__/directory-service-refresh-force.test.ts`. With 102 changes: a force refresh spawns exactly 1 `status --all`; a failing force refresh spawns no second process and never calls `pollOpenSpecAsync`.
- [ ] 3.1a Write the failing gated-tick spawn test (test-plan #E18), same exemplar. 102 changes, one `tasks.md` edited → 1 `status --all`, 0 `list`, 0 `status --change`.
- [ ] 3.2 Write the failing short-circuit test (test-plan #E11). Exemplar: `packages/server/src/__tests__/directory-service-readiness.test.ts`. `openspec/` without `changes/` → zero spawns and `missing-changes-dir`.
- [ ] 3.3 Write the failing first-detection test (test-plan #E16). Exemplar: `packages/server/src/__tests__/cold-boot-openspec-broadcast.test.ts`. An old fake CLI rejecting `--all` on a cold bootstrap `refreshOpenSpec` must continue on the fallback in the same poll and broadcast 3 changes (not `cli-failed`); the next gated tick spawns no `--all`.
- [ ] 3.4 Write the failing timeout test (test-plan #X1). Exemplar: `packages/server/src/__tests__/directory-service-refresh-force.test.ts`. A fake CLI that never exits, with fake timers, must abort at 30 s → `cli-failed`, and the next tick spawns once.
- [ ] 3.5 Write the failing enabled-gate test (test-plan #X7). Exemplar: `packages/server/src/__tests__/directory-service-openspec-enabled.test.ts`. With `openspec.enabled=false`, 5 dirs, one interval plus `openspec_refresh`: zero `status --all`/`list`/`status --change` spawns.
- [ ] 3.6 Write the failing pending-ordering test (test-plan #F9). Exemplar: `packages/server/src/__tests__/directory-service-pending-emit.test.ts`. On a cold cwd, `pending:true` is broadcast before the probe request is dispatched, then the final payload.
- [ ] 3.7 Implement the `--all` path in `packages/server/src/directory-service.ts`:
  - turns `dirPollPre` → probe → `dirPollGate` → spawn → `dirPollCli` → build → `dirPollPost`;
  - whole-call failure handled like today's failed call (retry next tick);
  - replace the `refreshOpenSpec` catch so it no longer calls `pollOpenSpecAsync`;
  - fallback branch with same-poll continuation.

  Verify #E11, #E16–#E18, #X1, #X7 and #F9 are green.

## 4. Gate, TOCTOU, watcher

- [ ] 4.1 Write the failing gate decision-table test (test-plan #E12). Exemplar: `packages/server/src/__tests__/directory-service-specs-mtime.test.ts`. Each row's next-tick spawn count is 1, except `README.md` and no-mutation, which are 0. Rows:
  - in-place `tasks.md`;
  - first `dependencies.yaml`;
  - `.openspec.yaml`;
  - `config.yaml` edit / delete;
  - `schemas/foo`→`bar` rename;
  - first file in an empty nested glob dir;
  - `README.md`;
  - no mutation.
- [ ] 4.2 Write the failing path-mapping test (test-plan #E14), same exemplar. Server cwd is a `/tmp` symlink while the CLI emits `/private/tmp` paths: outputs map onto the canonical `openspec/`, the escaping path is ignored, and editing a mapped file trips the gate.
- [ ] 4.3 Extend `perChangeArtifactPaths` in `packages/server/src/openspec/openspec-poll-fs-helpers.ts`:
  - cwd-level set: `openspec/`, `changes/`, `config.yaml`, dirs+files under `schemas/`;
  - outputs: `existingOutputPaths` + parents, `resolvedOutputPath` + parent, every dir under a glob prefix;
  - mapping via `realpathSync.native` of the server's `openspec/`.

  Verify #E12 and #E14 are green.
- [ ] 4.4 Write the failing write-during-call TOCTOU test (test-plan #X2). Exemplar: `packages/server/src/__tests__/directory-service-toctou.test.ts`. `changes/foo/tasks.md` written during the fake `--all` → `foo` keeps its previous entry and stamp, other changes are updated, and the next tick spawns again.
- [ ] 4.4a Write the failing delete-during-call test (test-plan #X3), same exemplar. `changes/bar/` removed during the call → `bar` absent from this and later broadcasts.
- [ ] 4.4b Write the failing created-between-probe-and-spawn test (test-plan #X4), same exemplar. `new` is broadcast this tick, re-polled exactly once on the next tick, and causes 0 spawns on the third.
- [ ] 4.4c Write the failing cwd-level race test (test-plan #X5), same exemplar. `config.yaml` edited during the call → cwd stamp not advanced; the next tick spawns `--all`.
- [ ] 4.5 Implement per-change racy detection plus cwd-level pre-call stamping (DEBUG-only `console.warn` per discard); verify #X2–#X5 are green.
- [ ] 4.6 Write the failing watcher-filter test (test-plan #E13). Exemplar: `packages/server/src/__tests__/openspec-change-watcher-filter.test.ts`. Re-poll for:
  - new change dir;
  - unknown-change `proposal.md`;
  - known-change `dependencies.yaml`;
  - `.openspec.yaml`;
  - `config.yaml`;
  - `schemas/**`.

  No re-poll for `README.md` or `openspec/specs/**`.
- [ ] 4.7 Update `matchesOpenSpecArtifact` and `createOpenSpecChangeWatcher` in `packages/server/src/openspec/openspec-change-watcher.ts`: keep the recursive `changes/` watcher; add a non-recursive `openspec/` watcher and a recursive `openspec/schemas/` watcher; glob-match against per-cwd `resolvedOutputPath`s. Verify #E13 is green and `openspec-change-watcher-debounce.test.ts` is green.

## 5. Per-turn budget

- [ ] 5.1 Write the failing no-op-tick budget test (test-plan #P1). Exemplar: `packages/server/src/__tests__/directory-service-eventloop-turns.test.ts`. With 107 unchanged fixtures and `useWorker:true`, no `dirPollPre/Gate/Cli/Post` turn self-records above the floor over 3 ticks.
- [ ] 5.2 Write the failing in-process budget test (test-plan #P2), same exemplar. With `useWorker:false`, same fixture: no turn above the floor, and zero `statSync` calls (spy).
- [ ] 5.3 Add the `dirPollGate` and `dirPollCli` turn labels plus async in-process I/O; verify #P1 and #P2 are green.

## 6. Client

- [ ] 6.1 Write the failing board error-badge test (test-plan #F1). Exemplar: `packages/client/src/components/__tests__/OpenSpecBoardView.test.tsx`. For `add-auth` with an `error`:
  - a labelled badge contains the message;
  - all stepper segments are `todo`;
  - the other 2 cards are unchanged;
  - `New session` stays enabled.
- [ ] 6.2 Write the failing broken-change derivation test (test-plan #F2). Exemplar: `packages/client/src/components/__tests__/openspec-actions.test.ts`. Broken change, continue+ff enabled, not streaming → primary `continue` and `ff` are blocked with the literal reason; `explore`/`detach` are not blocked by the rule; no `archive` key.
- [ ] 6.2a Write the failing continue-disabled test (test-plan #F3), same exemplar. With the `continue` workflow disabled → the `ff` primary is blocked with the message, and no `continue` action exists.
- [ ] 6.2b Write the failing error-plus-streaming test (test-plan #F6), same exemplar. Broken change while streaming → the reason shown is the error message, and `detach` stays enabled.
- [ ] 6.3 Write the failing mobile-menu test (test-plan #F4). Exemplar: `packages/client/src/components/__tests__/MobileActionMenu.test.tsx`. Continue/Fast-Forward rows natively `disabled` for a broken attached change.
- [ ] 6.4 Write the failing composer test (test-plan #F5). Exemplar: `packages/client/src/components/__tests__/ComposerSessionActions.test.tsx`. Continue primary has `aria-disabled="true"`, is focusable, and its `aria-describedby` contains the message.
- [ ] 6.5 Write the failing error-clears test (test-plan #F7). Exemplar: `packages/client/src/components/__tests__/SessionOpenSpecActions.test.tsx`. Rerender without `error` → badge removed, normal `PLANNING` actions.
- [ ] 6.6 Implement:
  - the board badge (`OpenSpecBoardView.tsx`);
  - the `ActionSpec` literal-reason field and error blocking in `packages/client/src/components/openspec/openspec-actions.ts`;
  - `MobileActionMenu.tsx` blocking;
  - the OPENSPEC subcard error badge.

  Verify #F1–#F7 are green and `npm run build` succeeds.
- [ ] 6.7 Write the L3 convergence spec (test-plan #F8). Exemplar: `tests/e2e/archived-attachment.spec.ts`. Docker-harness project with 3 changes: corrupt `changes/c2/.openspec.yaml` on disk → the board shows an error badge on `c2` only; restore it → the badge disappears with no manual refresh. Verify it is green against the harness (`npm run test:e2e -- archived-attachment openspec-status-all`).

## 7. Parity, measurement, docs

- [ ] 7.1 Add the parity test (test-plan #X8). Exemplar: `packages/shared/src/__tests__/openspec-poller-parity.test.ts`. Real CLI with a bounded pool:
  - `--all` artifact sets equal `status --change`;
  - an error in `--all` ⇔ the per-change call fails;
  - local counts equal `openspec list`;
  - unparseable output fails rather than skips.

  Verify it is green on this repo.
- [ ] 7.2 Keep the fallback-scoped parity suite (test-plan #X9). Exemplar: `packages/shared/src/__tests__/openspec-poller-parity.test.ts`. Run the existing local-derivation parity tests after the change; they must stay green.
- [ ] 7.3 (test-plan: manual-only) #P3: measure on macOS and the Windows 11 QA VM the `status --all` wall time, the gated no-op probe time and the force-refresh wall time, before and after. Record them in design.md Context.
- [ ] 7.4 Delegate to DocScribe the `docs/architecture.md` "OpenSpec polling cost model" update: `--all` path, envelope classes, local counting + schema resolution, worker probe/build turns, watcher roots, fallback detection. Verify with `grep -n "status --all" docs/architecture.md`.
- [ ] 7.5 Update the AGENTS.md rows for every touched file:
  - `openspec-poller.ts`, `platform/openspec.ts`, `types.ts`;
  - `directory-service.ts`, `openspec-poll-worker*.ts`, `openspec-poll-fs-helpers.ts`, `openspec-change-watcher.ts`;
  - `openspec-actions.ts`, `MobileActionMenu.tsx`, `OpenSpecBoardView.tsx`.

  Verify `kb dox lint` reports nothing stale for them.
- [ ] 7.6 Run the full suite (`set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log`) and confirm no failures.
