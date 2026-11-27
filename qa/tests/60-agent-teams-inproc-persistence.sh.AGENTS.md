# 60-agent-teams-inproc-persistence.sh — index

L2 process-level smoke of in-process agent-teams (test-plan #S103-#S106 = tasks 13.5-13.8). Hermetic: own prefix (HOME), port 18980 (`QA_PORT`), faux provider staged under the prefix. Thin bash: skip checks, `dist-only-lib.sh` install/boot, then `lib/agent-teams-inproc-persistence.cjs`.

FIXTURE mode only: lead `pi --mode rpc -e qa/fixtures/fake-subagents.ext.ts` (opt-in, never installed). Proves dashboard side vs the RECORDED contract. Real-upstream smoke = task 14.1.

Sections (`QA_INPROC_SECTIONS`, default all):
- `restart` S103: 2 busy children (`QA_INPROC_RESTART_RUN_MS`, 15000) + `/api/restart`. Asserts lead pid alive + same session, team `active` no closeReason, members idle, mail ids unique + acked, no `inproc_unknown_event`, fake state: exactly 2 completed runs, activation 1. Prints whether completion fell before the restart (outbox flush not exercised then).
- `reload` S104: `POST /api/session/<lead>/prompt {text:"/reload"}`. Asserts team closed `lead_reloaded`, both members gone `lead_reloaded`, no in_progress/owned task, exactly one new `notice` mail, lead alive, fake activation >= 2 with empty child list.
- `kill` S105: SIGKILL lead. Asserts never `orphaned`, closed `lead_ended` within `QA_INPROC_KILL_WAIT_S` (240; heartbeat timeout 180 s), members gone, lead + pre-kill descendants dead.
- `absent` S106: no fake, no package. Session team (`agent-teams-lead-spawn`) reaches alice idle; `agent-teams-inproc-unavailable` echoes `mode_unavailable` + `subagents_extension_missing` + `pi-dashboard-subagents`; no team; server log has 0 agent-teams error lines, <=100 lines. Pill = L3 (`tests/e2e/team/team-inproc.spec.ts`).

SKIP (first line, exit 0): no `pi`, or fixtures/driver files absent (VM upload carries only `qa/tests`). Plugin routes missing after boot = FAIL. Registered in `run-all.sh`.

NOT executed at authoring time (no VM/docker): validated by `bash -n`, `node --check`, `scripts/__tests__/qa-agent-teams-inproc-scripts.test.mjs`. Assertions on snapshot shapes (`notice` mail kind, `goneReason`, `closeReason`) follow `shared/snapshot.ts` / `inproc-lead.ts`; first VM run may need tuning.

See change: add-agent-teams-in-process.
