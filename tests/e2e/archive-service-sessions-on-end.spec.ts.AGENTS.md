# archive-service-sessions-on-end.spec.ts — index

L3 (test-plan #F1/#F5, change: archive-service-sessions-on-end). Seeds an ended, unarchived, `archiveOnEnd:true` shown automation run session (1 h old) + run-store parent/child records + `result.md` via `docker exec`, then `POST /api/restart`.
F1: boot scan declared leg archives it — absent from `/api/sessions` + board, present in `/api/sessions/archived` + folder `Archive (N)` fold row; Automation view still lists `automation-run-<parentRunId>`.
F5: `/folder/<base64url cwd>/automations/run/<sid>` monitor → run-store status `done`, findings, `run-archived-transcript` → read-only `/session/<sid>?archived=1` (no `send-button`).
Seeded, not fired: harness automation engine init fails (`Fastify instance is already listening … addHook`, #683 root), so a live run never ends; runtime on-end timer covered at L1.
Folder route param is base64url (`encodeFolderPath`), NOT the `~` form. Prefix-isolated (`e2e-svc-archive`) cleanup on entry/exit.
