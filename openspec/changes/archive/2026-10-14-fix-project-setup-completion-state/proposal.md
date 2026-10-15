## Why

Project setup reports done before the dashboard reflects it. Two observed failures on one folder (`OBS-Transcribe`):

1. The "Not a pi project yet" banner survives a successful project-init. The banner re-probes init-status only when the spawned session reaches `ended`, but an interactive project-init session finishes its work and sits `idle` — it never ends, so the banner never clears. The tracking state also lives in a per-banner-instance `useState`/`useRef`, so collapsing the folder, toggling compact mode, or reloading the page loses it; setups started from the folder menu or a terminal are never tracked at all.
2. OpenSpec stays half-initialized. Project-init Step 3b treats any pre-existing `openspec/` directory as "already initialized" and skips OpenSpec entirely — but a directory initialized earlier without pi tools has no `.pi/skills/openspec-explore/`, so readiness reports `STALE · missing-skills` right after a "successful" setup.

## What Changes

- **Banner re-probe trigger**: while the setup rung is showing (project root AND `.pi/settings.json` absent), the row's init-status is re-probed whenever a session in the row enters `idle`/`ended` (turn finished, or ended) or first appears already idle/ended (turn completed while unobserved). Ownership moves from `FolderActionBanner` (two instances per row) to the per-row `FolderInitScope`/`useInitStatus`, so it survives banner remounts and covers setups not launched from the banner. The spawned-session-id bookkeeping (`knownIdsRef`, `spawnedIdRef`, `pendingSpawn`) is removed. Clearing the setup rung may correctly reveal the next rung (re-trust of the freshly scaffolded `worktreeInit` hook).
- **Visibility re-probe**: same gate, on `visibilitychange` → `visible`, throttled to once per 30 s per row — a safety net for out-of-band changes (terminal, editor).
- **Latest-wins probes**: overlapping init-status probes for a row keep only the most recently issued result.
- **Project-init OpenSpec detection** (coding profile):
  - dashboard config unreadable (fail closed), OpenSpec disabled / directory opted out, or a linked worktree / checkout subdirectory / undeterminable git placement → skip;
  - no `openspec/` and the fleet `offerInitialization` switch off → skip;
  - no `openspec/` → unchanged opt-in confirm, then `openspec init --tools pi --force`;
  - `openspec/` present but `.pi/skills/openspec-explore/` missing → no question; disclosed in the preview as a repair, then `openspec init --tools pi --force`;
  - both present → skip.
  - The preview discloses side effects for both offer and repair: generated `openspec-*` skills overwritten; each detected legacy `OPENSPEC:START/END` marker block and legacy command path named as "may be removed". The preview confirmation is the overwrite confirmation.
- Spec deltas: `folder-action-banner` (re-probe trigger) and `project-init-skill` (OpenSpec detection).

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `folder-action-banner`: "Banner reflects the per-artifact setup state" — the re-probe trigger changes from "spawned session reaches `ended`" to "any session in the cwd finishes a turn or ends, or the tab becomes visible"; abandoned-setup behavior is preserved.
- `project-init-skill`: "Project-init MAY initialize OpenSpec for coding profiles" — a pre-existing `openspec/` without pi skills is repaired (no prompt) instead of skipped, unless opted out or in a linked worktree; side-effect disclosure covers legacy cleanup.

## Discipline Skills

- `review-code` — before commit, per repo doctrine.
- `doubt-driven-review` — the repair path runs `openspec init --tools pi` unprompted, which overwrites generated `openspec-*` skills and may edit root agent-config files (legacy cleanup); confirm the disclosure is sufficient before it stands.

## Non-goals

- Server-side push of init-status changes (fs-watch on `<cwd>/.pi/settings.json`). Deferred: the target `.pi/` usually does not exist yet, so it needs a parent-dir watch plus a new WS event.
- Changing `openspec-readiness` derivation or the folder OpenSpec pill's own repair action.
- Re-running OpenSpec repair outside project-init (the pill already offers it).

## Impact

- `packages/client/src/hooks/useInitStatus.ts` — status-change + throttled visibility re-probes, latest-wins guard; accepts `{ sessions, isProjectRoot }`.
- `packages/client/src/lib/init-setup-state.ts` — new home of `setupState`.
- `packages/client/src/components/session/SessionList.tsx` — `FolderInitScope` passes `group.sessions` + hoisted `isProjectRoot` into the hook.
- `packages/client/src/components/folder/FolderActionBanner.tsx` — drop spawn-tracking effect; `sessions` prop removed.
- `packages/extension/.pi/skills/project-init/SKILL.md` — Steps 3b, 3c, 6 and the idempotent-re-run note.
- Tests: new `useInitStatus` hook tests, `FolderActionBanner.test.tsx` setup-action case, new project-init SKILL.md text-guard test.
- No server, protocol, or persistence change. Rollback = revert; no migration.
