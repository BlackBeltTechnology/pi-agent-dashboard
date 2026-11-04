# GitHub dismissal-comment sync (#1062) — 2026-11-03

Script: `sync-dismissal-comments.mjs`. Table: `dismissal-comments.json` (33 alerts). Per-alert old/new text, for rollback: `comment-sync.log.jsonl`.

## Doubt review (task 2.1, test-plan M1)

Reviewer `@propose-review-3`, read-only, each gate traced from route to sink at HEAD, tier checked in `route-tiers.ts`.

- Cycle 1: FIX FIRST. 3 texts wrong:
  - #67–#72: "no separator" was false. `isValidNpmPackageName` accepts `@scope/name`. Reworded.
  - #244: "not request-reachable" was false. WS/REST resume probes pass `msg.sessionId`, but only after `sessionManager.get` (`session-action-handler.ts:552`). Reworded.
  - #493: the check is post-open, and only for ALWAYS-REFUSED files. "callers pass only containment-admitted paths" was false: the openspec route uses an allowlist. Reworded.
- Cycle 2 (the 3 corrected texts): #67–#72 OK. #244 OK. #493 still overstated ("dashboard secret file"). Narrowed to "always-refused handle; gated state is path-checked pre-open".
- The other 10 distinct texts: OK in cycle 1.
- `gate-table.md` rows were updated to match.

## Dry run (task 2.5, test-plan X7)

- 33 alerts. Pre-flight: all `dismissed` with reason `won't fix`.
- 0 reason changes. 0 comments over 280 chars (max 279).
- Every comment matches `^(operator-authz: (gate|control-tier): |false-positive: )`.

## Canary #57 (task 2.6, test-plan X8) — plan changed

- Try 1: `PATCH state=dismissed` + new comment → HTTP 400 "Alert is already dismissed". Alert byte-identical afterwards.
- GitHub does not allow editing the comment of a dismissed alert. Design D1 step 4 assumed it did.
- Owner decision (2026-11-03): reopen (`state=open`), then re-dismiss with the same reason and the new comment.
- Script extended: a `reopened` record is logged before the reopen; on re-run, an alert left open by a crash between the 2 PATCHes is re-dismissed; any other open alert still aborts the pre-flight. Tested with a fake `gh` in `scripts/__tests__/codeql-local-mirror.test.mjs`.
- Try 2: before/after JSON diff = `dismissed_comment`, `dismissed_at`, `updated_at`. `most_recent_instance.commit_sha` also moved; cause = a new develop analysis at `fb9a5af` (the new `origin/develop` tip), not the PATCH.
- `state`, `dismissed_reason` and `dismissed_by` (robertcsakany) unchanged.
- Accepted cost: `dismissed_at` now reads 2026-11-03.

## Run (task 2.7, test-plan X9)

- Run 1 was killed after 7 s. The kill landed in the pre-flight reads: 0 PATCHes, no alert touched. Resume after a kill mid-PATCH is covered by the fake-`gh` test (#X10), not live.
- Run 2: 32 patched, 1 unchanged (#57, already done). This proved live idempotence.
- Run 3: 0 patched, 33 unchanged.
- Final re-read: 33/33 `dismissed`, `won't fix`, dismissed by robertcsakany. 0 comments contain "behind the universal network guard". Max 277 chars.

## Historical, not edited

- #128 #129 #136 #137 #138 have no baseline entry and no result at HEAD (design D1 Non-Goals).
- Re-read after the run: still `dismissed`, `dismissed_at` unchanged (2026-10-22 / 2026-10-24).
