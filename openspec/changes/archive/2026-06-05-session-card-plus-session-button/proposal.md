## Why

Today the session card has three lifecycle actions, all of which require the parent session to be ended: `▶ Resume`, `⑂ Fork`. Live sessions have no on-card spawn affordance — to start a sibling session in the same folder (and, if relevant, attached to the same OpenSpec change), the user must scroll up to the folder header, find `+Session`, and re-attach the change manually.

This proposal adds two on-card spawn buttons, **always visible**:

1. `+Session` — spawns a clean sibling session inheriting:
   - `cwd` from the parent session
   - `attachedProposal` from the parent session (when set)
2. `+Worktree` — opens the existing `WorktreeSpawnDialog` scoped to the parent session's `cwd`, pre-attaching the parent's proposal. Lets the user create a git worktree (if none fits) and spawn a session inside it, running the standard bootstrap/init (`worktree_bootstrap_*`) before the session starts. Reuses all existing worktree-creation + dependency-install machinery — no new spawn logic.

The semantic is deliberately distinct from Fork:

| Action      | New id | History    | cwd       | proposal |
|-------------|--------|------------|-----------|----------|
| Resume      | no     | continues  | inherited | inherited |
| Fork        | yes    | copied     | inherited | inherited |
| **+Session** | yes   | **empty**  | inherited | inherited |
| folder +Session | yes | empty     | folder cwd | none |

This unlocks three workflows the dashboard currently fumbles:
1. Run a different role/skill (e.g. `code-review`) against the same change without polluting the main session's history.
2. Start a clean context window on the same problem when the active session has accumulated noise.
3. Spawn a sibling for a parallel sub-task without copying history a Fork would unnecessarily carry.

## What Changes

- **New `+Session` button** on `SessionCard.tsx`, rendered alongside the existing Fork pill, but **always visible** (not gated by `session.status === "ended"` or `session.sessionFile`). Distinguished visually from Fork via the `mdiPlus` (or `mdiPlusCircleOutline`) icon and label `+Session`.
- **New `+Worktree` button** on `SessionCard.tsx`, rendered next to `+Session`, **always visible** (gated only by the `gitWorktreeEnabled` config flag, mirroring the folder-header `+Worktree`). Uses `mdiSourceBranchPlus` icon + label `+Worktree`, orange styling matching the folder button.
  - **Click semantics**: opens the existing `WorktreeSpawnDialog` scoped to `session.cwd`. When `session.attachedProposal` is set, routes through the proposal-aware dialog path (`worktreeForChange`: pre-fills branch `os/<change>` + carries `attachProposal`); otherwise the plain dialog path (`worktreeDialogCwd`).
  - **No new server work**: dialog already POSTs `/api/git/worktree`, runs bootstrap, then emits `spawn_session` with `gitWorktreeBase` + `attachProposal`.
  - **Disabled when `session.cwdMissing`** (same as `+Session`/Fork/Resume).
  - **Hidden when the session is already a worktree session** (`session.gitWorktree` set) — spawning a worktree from inside a worktree is redundant.
  - Non-git cwd degrades gracefully — the dialog surfaces its existing load error.
- **On-card pill polish**: the Resume/Fork/+Session/+Worktree pills shrink uniformly (`text-[9px]`, `px-1 py-px`, icon `0.35`) so the 4-button row stays compact. Labels read `Session` / `Worktree` (the `+`/branch-plus icon supplies the plus) — no redundant `+ +Session` doubling.
- **Global `Spawn` → `+Session` relabel**: every user-facing occurrence of the word `Spawn` in the client UI becomes `+Session` (or `+Sessions`), for consistency with the new buttons. Covers `WorktreeSpawnDialog` row/submit buttons (`Spawn →`, `Create + Spawn →`, `Install deps + Spawn →`), `SettingsPanel` field labels, `ToolsSection` panel heading, `LandingPage` CTA copy, `FolderOpenSpecSection` tooltip, and spawn-failure toast/error messages. `+ Spawn` collapses to `+Session` (no double plus). Code identifiers, testids, `spawn_session` protocol strings, and comments are untouched.
- **Click semantics**: emits a `spawn_session` ws message with:
  - `cwd: session.cwd`
  - `attachProposal: session.attachedProposal` (omitted when null/empty)
  - `requestId`: fresh UUIDv4 (existing client-correlation pattern)
  - No `gitWorktreeBase` — this is the "clean sibling" semantic, not a worktree spawn. (The `+Worktree` button covers the worktree-spawn case via the dialog.)
- **No new server work**: every field is already accepted by the `spawn_session` handler. `pendingAttachRegistry` will fire on the new session's first `session_register` and attach the proposal.
- **Disabled when `session.cwdMissing`**: mirrors the existing Fork/Resume disabled-state pattern (tooltip: `session's directory no longer exists`).
- **No interaction with worktrees**: if the parent session is itself a worktree session, `+Session` spawns in the same worktree cwd (NOT in the main repo). Same-cwd inheritance is unconditional. (If a user wants a worktree-sibling, the folder `+Worktree` or the per-change `⑂+` button from the sister proposal `openspec-worktree-spawn-button` covers that.)

Out of scope:
- Inheriting other parent fields (selected model, thinking level, custom env). +Session is a clean spawn; it inherits only the two things the user can't easily restate from the card UI (cwd, attached proposal).
- Mobile-specific layout work. Desktop card gets the buttons; mobile card layout decisions deferred.
- Copying uncommitted `openspec/changes/<name>/` files into a new worktree. Worktree spawns rely on committing the proposal then basing the worktree off that branch (git-native inheritance). Decided 2026-06.

## Capabilities

### Modified Capabilities

- **`session-card-subcards`**: Adds always-visible `+Session` button (`onSpawnSibling?(session)`) and a `+Worktree` button (`onSpawnWorktree?(session)`, gated by `gitWorktreeEnabled`, hidden on worktree sessions) in the fork/resume button group. Pills shrink to a compact size. Global `Spawn` → `+Session` relabel of client UI text.

## Impact

- **Modified files**:
  - `packages/client/src/components/SessionCard.tsx` — new button; `onSpawnSibling?: (session: Session) => void` prop; wire `disabled={!!session.cwdMissing}` + tooltip mirroring Fork.
  - Whichever file owns the `SessionCard` render call site (likely `SessionList.tsx` and/or `SessionHeader.tsx` — verify during implementation). Plumb the new prop down to a single handler that mints a `requestId` and emits `spawn_session` over the existing ws send path.
- **Protocol**: none — `spawn_session.attachProposal` already exists.
- **Server**: none.
- **Tests**:
  - `SessionCard.test.tsx`:
    - Button renders for live AND ended sessions.
    - Button renders even when `session.sessionFile` is absent (Fork-gating not inherited).
    - Click → handler called with the session.
    - `session.cwdMissing === true` → button disabled + tooltip text.
  - Wiring test (jsdom) — click → ws send carries `{ cwd, attachProposal, requestId }`; verifies `attachProposal` omitted when parent has none.
- **Backward compat**: purely additive UI.
- **Visual**: `+Session` pill matches existing Fork pill styling; icon-only on narrow widths if the existing pill row already has a responsive collapse rule (verify in implementation; otherwise full label).
