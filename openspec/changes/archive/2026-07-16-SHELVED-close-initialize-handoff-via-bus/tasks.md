# Tasks — close-initialize-handoff-via-bus

## 1. Dependency wiring

- [ ] 1.1 Add `@blackbelt-technology/pi-dashboard-bus-client` to
  `packages/extension/package.json` dependencies (workspace `*` / matching
  version). Run install; confirm the extension package resolves the import.
- [ ] 1.2 Verify: `tsc --noEmit` in `packages/extension` resolves
  `import { connect } from "@blackbelt-technology/pi-dashboard-bus-client"`.

## 2. Spike — resolve Decision 1 (trigger mechanism)

- [ ] 2.1 Against a running dashboard, empirically confirm whether
  `dash.spawn({ cwd })` on a configured-but-unprovisioned dir fires the
  `worktreeInit` hook (mechanism A). Record the result in `design.md` (append a
  "Decision 1 — RESOLVED" note).
- [ ] 2.2 If A does not fire the hook, adopt mechanism B: trigger via
  `POST /api/git/worktree/init`, await readiness on the bus. Lock the chosen
  mechanism before writing the helper.

## 3. Helper — `provision-and-verify.ts` (TDD)

- [ ] 3.1 Add `packages/extension/.pi/skills/project-init/scripts/__tests__/provision-and-verify.test.ts`
  (failing) using the bus-client's `mock-server` support harness: (a) bus
  unreachable (`connect()` throws `off-box`/`connect-failed`) → helper exits 0
  with a `SKIPPED` structured result; (b) provisioning reaches idle → `PROVISIONED`
  result; (c) `until` times out → `RUNNING` result (not a failure exit); (d)
  already-provisioned (init-status `needsInit:false`) → `ALREADY` result without
  triggering.
- [ ] 3.2 Write `provision-and-verify.ts`: read init-status → idempotency skip;
  `connect()` with a short timeout + typed-error degradation; trigger provisioning
  (Decision 1 mechanism); `until(sid,"idle", { timeout: PROVISION_TIMEOUT })`;
  emit a single-line JSON result (`{ status, sessionId?, detail? }`) to stdout;
  always `close()`; never throw to a non-zero exit on the degradation paths.
- [ ] 3.3 Verify: the helper tests pass; helper exits 0 on every degradation
  branch (skip/timeout/already), non-zero only on an unexpected error.

## 4. Skill — Step 8 (provision + verify)

- [ ] 4.1 In `project-init/SKILL.md`, add **Step 8 — Provision & verify**
  (gated, after Step 7's hook-validate): an `ask_user` confirm (default no) that
  discloses it runs the repo `worktreeInit` hook; on yes, run
  `scripts/provision-and-verify.ts` via `bash`; relay its structured result to the
  user (`PROVISIONED` / `RUNNING` / `SKIPPED` / `ALREADY` / failure).
- [ ] 4.2 Update Step 7 wording: when Step 8 provisioned successfully, the "click
  Initialize again" instruction is replaced by the verified-result message; when
  skipped/declined, Step 7 stays verbatim.
- [ ] 4.3 Gate Step 8 to profiles with a build hook (`coding`); `docs` (no
  `worktreeInit` hook) skips it. Idempotent + opt-in + degradable per design.

## 5. Docs / tree

- [ ] 5.1 Add the `scripts/provision-and-verify.ts` row to the nearest directory
  `AGENTS.md` (project-init skill dir), caveman style, per the Documentation
  Update Protocol.
- [ ] 5.2 If a `docs/` note is warranted (bus-client as a project-init consumer),
  delegate the write to a general-purpose subagent per Rule 6 (caveman style).

## 6. Gates

- [ ] 6.1 `npm test` green (extension package + helper tests).
- [ ] 6.2 `tsc --noEmit` clean across touched packages.
- [ ] 6.3 Manual: on a running dashboard, run project-init on a bare dir, opt into
  Step 8, confirm the hook runs and the verified message replaces the manual
  click; then run in a bare `pi` terminal (no server) and confirm Step 8 skips
  cleanly to the Step 7 fallback.
