## 1. SessionCard button

- [x] 1.1 Add `onSpawnSibling?: (session: Session) => void` prop to `SessionCard.tsx`.
- [x] 1.2 Render `<button>` in the existing fork/resume pill row with `mdiPlus` (or `mdiPlusCircleOutline`) icon + label `+Session`. `data-testid="session-card-spawn-sibling"`.
- [x] 1.3 Visibility: render unconditionally when `onSpawnSibling` is supplied. NO gating on `session.status === "ended"` or `session.sessionFile`.
- [x] 1.4 `disabled={!!session.cwdMissing}`; tooltip: `cwdMissing ? "session's directory no longer exists" : "Spawn clean sibling session in same folder"`.
- [x] 1.5 Click: `e.stopPropagation(); onSpawnSibling(session);`.

## 2. SessionCard tests

- [x] 2.1 Renders button for live session (`status !== "ended"`).
- [x] 2.2 Renders button for ended session (Fork visible) — both buttons coexist.
- [x] 2.3 Renders button when `sessionFile` absent (regression guard against accidental Fork-style gating).
- [x] 2.4 Click invokes handler with the session.
- [x] 2.5 `cwdMissing === true` → `disabled` attribute set; tooltip changes.
- [x] 2.6 No handler → button absent (parity with existing optional props).

## 3. Wiring

- [x] 3.1 Locate every `<SessionCard>` render site. Pass `onSpawnSibling={(s) => handleSpawnSibling(s)}` from the same level that owns ws send (likely `SessionList.tsx` and/or `App.tsx`).
- [x] 3.2 Implement `handleSpawnSibling(session)`:
  - Mint `requestId = uuidv4()`.
  - Send `{ type: "spawn_session", cwd: session.cwd, ...(session.attachedProposal ? { attachProposal: session.attachedProposal } : {}), requestId }` over the existing ws send channel.
  - On success toast: rely on existing `spawn_result` handler for feedback (no new toast).
- [x] 3.3 Confirm there is exactly ONE handler implementation. If the codebase has parallel ws send helpers (mobile vs desktop), share via a single `spawnSibling(session)` helper.

## 4. Wiring tests

- [x] 4.1 jsdom test: render a session with `attachedProposal: "add-dark-mode"`, click `+Session`, assert ws.send called with payload containing `attachProposal: "add-dark-mode"` + `cwd: session.cwd`.
- [x] 4.2 jsdom test: session with `attachedProposal: undefined`, click → payload omits `attachProposal` key entirely.
- [x] 4.3 jsdom test: session with `cwdMissing: true` → button disabled, click does NOT send.

## 7. +Worktree button (SessionCard)

- [x] 7.1 Add `onSpawnWorktree?: (session: Session) => void` prop to `SessionCard.tsx`.
- [x] 7.2 Render `<button>` next to `+Session` with `mdiSourceBranchPlus` icon + label `+Worktree`, orange styling. `data-testid="session-card-spawn-worktree"`.
- [x] 7.3 Visibility: render when `onSpawnWorktree` supplied. `disabled={!!session.cwdMissing}`; tooltip mirrors Fork on cwdMissing else `Create git worktree + spawn session inside it`.
- [x] 7.4 Click: `e.stopPropagation(); onSpawnWorktree(session);`.

## 8. +Worktree wiring + tests

- [x] 8.1 In `SessionList.tsx`, pass `onSpawnWorktree` (gated on `onSpawnSession && gitWorktreeEnabled`). Route: `attachedProposal` set → `setWorktreeForChange({ cwd, changeName })`; else → `setWorktreeDialogCwd(cwd)`. Reuse existing dialogs — NO new dialog/state.
- [x] 8.2 SessionCard tests: renders when handler supplied; absent without; `cwdMissing` → disabled; click invokes handler.
- [x] 8.3 jsdom routing test: click with `attachedProposal` opens proposal-aware `WorktreeSpawnDialog` (branch `os/<change>`); click without opens plain dialog.

## 5. Docs

- [x] 5.1 `docs/file-index-client.md` — append the new prop + behavior to the `SessionCard.tsx` row (caveman style, delegated subagent).
- [x] 5.2 No `docs/architecture.md` change.

## 6. Verification

- [x] 6.1 `npm test` all green.
- [x] 6.2 Manual: live session with attached proposal — click `+Session`, confirm new session lands in same folder with proposal pre-attached.
- [x] 6.3 Manual: live session without proposal — click `+Session`, confirm new session lands in same folder with no proposal.
- [x] 6.4 Manual: ended session — `Resume`, `Fork`, AND `+Session` all coexist on the card.
- [x] 6.5 Manual: worktree session — `+Session` spawns inside the worktree cwd, NOT the main repo. Document this in the new SessionCard test as a comment so future reviewers don't break it.

## 9. Pill polish + global Spawn→+Session relabel

- [x] 9.1 Shrink Resume/Fork/+Session/+Worktree pills uniformly (`text-[9px]`, `px-1 py-px`, icon `0.35`).
- [x] 9.2 Drop redundant `+` from card labels — render `Session`/`Worktree` (icon supplies the plus); no `+ +Session` doubling. Update label assertion.
- [x] 9.3 Hide `+Worktree` on worktree sessions (`!session.gitWorktree`); add test + spec scenario.
- [x] 9.4 Global relabel: user-facing `Spawn`→`+Session` (`Spawns`→`+Sessions`) across `WorktreeSpawnDialog` (row/submit/install-deps buttons), `SettingsPanel` labels, `ToolsSection` heading, `LandingPage` CTA, `FolderOpenSpecSection` tooltip, spawn-failure toast (`SessionList`) + error (`useMessageHandler`). Collapse `+ Spawn`→`+Session`. No identifiers/testids/`spawn_session`/comments touched.
- [x] 9.5 Update affected tests (`WorktreeSpawnDialog.test.tsx` `Spawn →`→`+Session →` regexes); full `npm test` green (7144 passed).
