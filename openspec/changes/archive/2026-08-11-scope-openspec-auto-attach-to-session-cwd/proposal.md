## Why

The server auto-attaches a session to an OpenSpec change detected from its tool-event stream, but `detectOpenSpecActivity(toolName, args)` takes no `cwd` and the auto-attach branch never checks that the detected change exists in the session's own directory. A session whose tool args merely *mention* a foreign change gets attached to it.

Observed in production: session `019fec3d` (`cwd=/Users/robson/Project/pi-agent-dashboard`) ran

```
cd /Users/robson/Project/pi-dashboard-subagents && npx openspec new change fix-stale-pi-handle-on-reactivation
```

`CLI_NEW_CHANGE_RE` matched the command — the `cd` prefix into a different repository is invisible to the regex — so the session was stamped `openspecChange` + `attachedProposal` + auto-renamed to a change that exists only in `pi-dashboard-subagents` and has never existed in this repo. The dashboard then rendered that card, with foreign task counts, inside the `pi-agent-dashboard` group.

Existing validation is shape-only (`isValidOpenSpecChangeSlug`) — it proves the token *looks* like a change name, never that it *is one here*. The adjacent canvas detector already documents the correct posture on the same event stream: "cwd comes from server session state, never the model (anti-traversal)". The OpenSpec detector has no such guard.

## What Changes

- **Gate auto-attach on locality.** Before stamping `attachedProposal`, verify the detected change is resolvable in the session's own project. Adds a **tri-state** resolver (`present` / `absent` / `unknown`) over the in-memory poll cache, rejecting only on a positive absence; the existing `openSpecChangeExistsInCache` is left untouched because the deleted-proposal bypass depends on its fail-open answer. Today that helper is consulted only against the *previously* attached name, never the newly detected one.
- **Add an explicit `gitWorktreeReported` indicator.** Session state cannot currently distinguish "not a worktree" from "worktree state not yet reported" — both are `undefined` — and conflating them would make the gate a no-op for every non-worktree session, i.e. the incident case. A dedicated server-internal flag makes the distinction real; a session also counts as resolved when `isGitRepo === false`, since a non-git session never receives a worktree report at all.
- **Gate the `openspecChange` activity stamp on the same check.** It is written before the attach branch, so gating the attach alone still leaves the activity badge advertising a foreign change.
- **Thread `cwd` into the detector (anti-traversal).** `detectOpenSpecActivity` gains a session-`cwd` parameter and rejects matches that provably refer to another root:
  - `CHANGE_PATH_RE` matches on **absolute** paths into any repo on disk — require the matched path to be contained by the session `cwd`.
  - CLI patterns (`CLI_NEW_CHANGE_RE`, `CLI_ARCHIVE_RE`, `CLI_CHANGE_FLAG_RE`) match anywhere in a command string — reject when the command relocates out of the session `cwd` **anywhere** in the command, before or after the OpenSpec invocation, uniformly across all three patterns.
  - Use the boundary-correct helper from `cwd-session-containment` rather than string-prefix matching, so a sibling like `/repo-other` never counts as inside `/repo`. **This requires relocating `isPathInside` from `packages/server` into `packages/shared`** — shared cannot import from server — and re-pointing its existing server callers.
- **Widen the deleted-proposal bypass to the same candidate roots.** Branch 4 currently consults the session `cwd` only, so a worktree session manually attached to a main-only change is judged "deleted" on every detection and silently re-attaches without the replace dialog. Same defect class, parallel path; fixed here so one definition of "belongs to this session's project" exists in the module.
- Manual attach paths (browser handler, REST) are unchanged — they accept any name from a server-curated list and are already user-intentional.

Restrictive on an automatic inference only. **One behavioural caveat, stated honestly:** creating a change in the session's *own* repo (`openspec new change <name>`) is rejected until the next poll cycle, because the already-initialized cache does not yet list it. The attach lands one cycle later, and the misleading notice is suppressed for the whole create flow — including the follow-up writes into the new change's own files, which are path detections rather than CLI ones. Auto-attach is therefore *delayed*, not "unchanged", on the canonical create path.

## Capabilities

### New Capabilities

None. This tightens existing behavior.

### Modified Capabilities

- `proposal-attachment`: `Server-side auto-attach from activity detection` gains a cwd-locality precondition alongside the existing shape re-validation; `Detect change name from openspec new change command` gains cwd-scoping. Adds the locality counterpart to `Auto-attach branch re-validates change-name shape`, plus the resolution rule (session cwd + worktree main path), the cache tri-state rule, and the rejection notice.

The branch-4 deleted-proposal bypass inside `Server-side auto-attach from activity detection` also changes (candidate-root widening).

This capability owns **all** activity-detector requirements (`Case-insensitive tool name matching in activity detector`, `Activity detector rejects flag-shaped change names`, `Activity detector rejects non-slug change names`, `Detect change name from openspec new change command`), so it is the only spec touched. `openspec-detection` was considered and ruled out: it owns artifact-*status* evaluation (R1/R2/R3 promotion, the shared skill helper), not tool-event activity detection.

## Impact

- `packages/shared/src/openspec-activity-detector.ts` — `detectOpenSpecActivity` signature (required `cwd`) + path/CLI locality guards. Exactly **one** production consumer (`event-wiring.ts`), but its test suite lives in `packages/extension/src/__tests__/`, so the signature change crosses a package boundary and every existing detector test needs a `cwd` fixture.
- `packages/server/src/session/active-sessions-in-cwd.ts` → **`isPathInside` relocates to `packages/shared`**; this module and its test re-import from there. Behaviour-preserving move (`git-routes.ts` consumes it transitively).
- `packages/server/src/event-wiring.ts` (~line 880-960) — pass session `cwd`; add the tri-state locality resolver; gate the `openspecChange` stamp and the auto-attach branch; widen the branch-4 bypass to the same candidate roots; emit the deduped notice; clear dedupe state on unregister.
- `packages/server/src/event-wiring.ts` (~line 1484-1524, git-info handling) + `packages/shared/src/types.ts` — new `gitWorktreeReported` field on `DashboardSession`, set on every bridge worktree report **including the cleared case**. In-memory only; deliberately not persisted to `.meta.json`, and deliberately excluded from the `broadcastSessionUpdated` payload (that helper forwards its whole updates object to clients).
- No API change and no client-visible schema change — `gitWorktreeReported` is store-only and must be kept out of the broadcast payload. The client renders whatever the server stamps. `packages/extension` is touched for tests only — no `npm run reload` needed.
- Rebuild path: shared + server → `curl -X POST http://localhost:8000/api/restart` (jiti, no build).

### Known live bad state

Any session already carrying a foreign attachment keeps it until detached — the fix is preventive, not retroactive. `019fec3d` was cleared manually via `POST /api/session/:id/detach-proposal` during investigation.

## Discipline Skills

- `security-hardening` — the detector consumes model-authored tool arguments (untrusted input) and derives a filesystem-scoped identity from them; this is the anti-traversal boundary the neighbouring canvas detector already enforces.
- `review-code` — non-trivial change to a shared package with two consumers, before commit.
