## Why

A session's `attachedProposal` keeps the bare change name after the change is archived (`openspec/changes/<name>/` → `openspec/changes/archive/<date>-<name>/`). The client resolves the attachment only against the **active** changes of `session.cwd`. So every archived attachment falls into the "not found" branch: a bare name plus a Detach-only `⋯` menu, with no state and no way to open its artifacts.

Live data on 2026-10-01: 9 of 19 attached sessions hit this dead end.
- 5 were archived in place.
- 4 ran in a removed ship-it worktree (`.worktrees/os-<name>`). Their archive lives in the main checkout (`session.gitWorktree.mainPath`), not in `session.cwd`.

Running sessions hit it too: right after `/skill:openspec-archive-change` the attached change disappears from the active list.

## What Changes

- **Attachment resolution.** A pure client resolver maps `(session, active OpenSpec data, archive listings)` to `active | archived | missing | unresolved`. `unresolved` covers data not yet settled, and OpenSpec turned off for the folder; it renders as today. Lookup order: active changes in `session.cwd`, then active changes in `gitWorktree.mainPath`, then the archive in `session.cwd`, then the archive in `mainPath`, else `missing`. When several archive entries match a name, it picks the newest entry dated on or after the session start date, else the newest entry overall.
- **Archived attachment UI** (session card, desktop header, mobile chip and menu; running AND ended sessions). Shows the paperclip and name, then an `Archived <date>` badge, then archive artifact letters (in archive-browser order) that open the archived artifact, then `⋯` → **Detach**. The mobile chip stays read-only and keeps Detach in its `MobileAttachButton` popover. No lifecycle bar and no primary action. A removed-worktree attachment still active in the main checkout renders read-only with an `In main checkout` badge. `missing` keeps today's Detach-only rendering and adds a muted `Not found` badge.
- **Archive deep link.** New route `/folder/:encodedCwd/openspec/archive/:entry/:artifact` opens `ArchiveArtifactReader` directly. Back returns to the previous view.
- **Reverse link.** Each Archive browser entry lists the sessions attached to that change name. These are sessions whose `cwd`, or whose `gitWorktree.mainPath`, is the folder. Each is a clickable chip that navigates to the session.
- **OpenSpec data for attachment folders.** `useOpenSpecReconcile` also requests `openspec_get` for the `cwd` and `gitWorktree.mainPath` of every rendered session that has an attachment, including ended sessions, so active-vs-archived is decided on settled data. The archive-browser route does the same for its folder and its candidate sessions.
- **Archive listing cache.** A shared per-cwd cache replaces the per-mount fetch in `useArchiveListing`, so N cards fetch `/api/openspec-archive` at most once per cwd. The cache invalidates when that cwd's active change set changes, which catches the archive-while-running transition. It also uses a 5 min TTL and evicts on error, with a 30 s retry.
- No server code, protocol or persistence change; the widened reconcile only issues more of the existing mtime-gated `openspec_get` polls. `attachedProposal` keeps its bare name, and `GET /api/openspec-archive` is reused unchanged.

## Capabilities

### New Capabilities

- `openspec-attachment-resolution`: resolves an attached change name to an active change, an archive entry, or missing. Covers the worktree → main checkout fallback, same-name disambiguation, and the shared archive cache.

### Modified Capabilities

- `openspec-attach-combo`: the "attached change not in OpenSpec data" rendering splits into *archived* (badge, date, artifact letters, Detach) and *missing* (Detach only). This applies to both running and ended sessions.
- `openspec-archive-browser`: entries show their attached sessions. The listing hook uses the shared cache. "Two-level navigation" is scoped so that a deep-linked reader goes back through history.
- `url-routing`: adds the archive-artifact deep-link route.

## Impact

- Client only:
  - `packages/client/src/lib/openspec/` (new resolver + archive cache)
  - `hooks/useArchiveListing.ts`, `hooks/useOpenSpecReconcile.ts` (wider cwd set)
  - `components/openspec/SessionOpenSpecActions.tsx`, `ArchiveBrowserView.tsx`
  - `components/session/SessionCard.tsx`, `SessionHeader.tsx`, `ComposerSessionActions.tsx`
  - `components/shell/MobileActionMenu.tsx`
  - `lib/nav/route-builders.ts` + route table, `App.tsx`
  - i18n (en/hu)
- Compatibility: none broken. Sessions already persisted with an archived name resolve retroactively.
- Rollback: revert the client files. No data migration.

## Discipline Skills

- `review-code`: non-trivial client change across ≥3 components before commit.
- Otherwise none apply. The archive endpoint and session data are already trusted dashboard-internal data. There is no new endpoint, no latency budget and no irreversible step.
