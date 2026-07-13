## Why

Worktree init runs in three places, and all three surface their execution badly:

1. **Manual `WorktreeInitButton`** (`packages/client/src/components/WorktreeInitButton.tsx`)
   dumps the running tail and the failure `stderr` into raw `<pre>` blocks inline in
   the sidebar folder-action-bar row — a scrolling wall of monospace that damages the
   row layout and reads like a terminal, not a UI.
2. **Auto-init on spawn** (`packages/client/src/lib/auto-init-worktree.ts`,
   `maybeAutoInitWorktreeOnSpawn`) mints a `winit-auto-…` requestId and **discards it**.
   Nothing subscribes, so a trusted-hook auto-init after spawn runs — and can **fail** —
   with **zero feedback**. A failed auto-init leaves a silently broken worktree.
3. **Page refresh mid-init** loses the running indicator entirely: the progress channel
   is keyed by a **client-minted `requestId`** (`worktree-init-bus.ts` +
   `worktree-init-registry.ts`, `Map<requestId → ws>`, dropped on ws close). After a
   refresh the page forgets the id, the old ws closes, the server drops the subscription,
   and the still-running process streams progress into the void. The remounted button
   re-probes gate-based `init-status`, sees `needsInit` still true, and shows an idle
   "Initialize" — inviting a double-run.

Root cause of (2) and (3): run state is keyed by an **ephemeral client `requestId`**, not
by anything that survives a refresh or is shared across trigger paths.

A fourth, orthogonal problem the button conflates (confirmed by investigating a fully
initialized checkout): the button's visibility is
`hasHook && (trusted === false || needsInit === true)`. When a project **is** initialized
(`needsInit === false`) but the `worktreeInit` hook was **edited after it was last trusted**,
TOFU trust invalidates (`trusted === false`, since trust is keyed by
`repoRoot + sha256(canonical(worktreeInit))` in `~/.pi/dashboard/worktree-init-trust.json`)
and the button reappears looking like a genuine "Initialize" — but the only pending action is
**re-approving the changed hook**, not initializing anything. Today both cases render as the
same amber "Initialize", which misleads.

## What Changes

- **Server: cwd-keyed active-run registry.** Track in-flight and recently-finished init
  runs by `cwd` (the natural single-run-per-checkout key), with a short TTL on terminal
  states so a refresh landing just after done/failed still sees the outcome.
- **Server: `GET /api/git/worktree/active-inits`** — returns the current per-cwd run state
  (`running | done | failed`, `startedAt`, `lastLine`, `code?`) for boot-time rehydration.
- **Progress subscription keyed by `cwd`** (stable) in addition to the existing
  `requestId`, so manual, auto-on-spawn, and post-refresh consumers all attach to the same
  channel without threading an id.
- **Client: friendly execution feedback** replacing the raw `<pre>` wall:
  - one-line status chip (`Initializing… · 8s`) + slim progress bar + **last log line as a
    muted ghost preview**; full log is **opt-in** behind a collapsed `<details>`.
  - success flashes `✓ Initialized` (~2s) then collapses; **failure is sticky** with a
    plain-language summary + **Retry** + opt-in log.
  - the chip distinguishes **“Initialize”** (`needsInit === true`) from **“Review & trust
    changes”** (`needsInit === false && trusted === false` — hook edited), so a fully
    initialized checkout with a stale-trust hook is not mislabeled as needing init.
- **Spawn/auto-init feedback surface**: the init sub-state renders on the existing
  **spawn placeholder / session card** (contextual, no floating element, no row damage).
- **Boot rehydration**: on load the client fetches `active-inits` and re-renders the
  correct chip/card state (running rehydrates + keeps streaming; terminal states within
  TTL show done-flash / failed-sticky).
- **Concurrent runs stack**: N cwds = N registry entries; a corner surface collapses them
  into one summary stack (auto-shrinks as runs finish; any failed row holds it open).

## Mockups

Static HTML mockup of every state lives at [`mockups/index.html`](mockups/index.html) (dark
theme, real `index.css` tokens). Serve it with the bundled `serve_mockup` tool, or open the
file directly. It is the visual reference for the client tasks in `tasks.md`.

Surfaces shown:
- **0 · Baseline** — today's inline raw `<pre>` wall (the problem).
- **A** — status chip + slim bar + ghost last-line + collapsed log (manual button, recommended).
- **B** — ultra-compact single pill.
- **C** — corner toast / drawer.
- **D1** — sub-state on the spawn placeholder / session card (running + failed).
- **D2** — spawn auto-triggering C's toast.
- **E1** — success flash filmstrip (running → `✓ Initialized` 2s → settled).
- **E2** — concurrent runs collapsed into one summary stack.

## Capabilities

### New Capabilities
- `worktree-init-feedback`: cwd-keyed run tracking + boot rehydration + the friendly,
  opt-in-log status surfaces (chip, session-card sub-state, concurrent stack) shared by the
  manual, auto-on-spawn, and refresh paths.

### Modified Capabilities
- `git-operations-api`: adds `GET /api/git/worktree/active-inits`; documents that the
  worktree-init progress channel is addressable by `cwd`.
- `worktree-init`: run execution registers a cwd-keyed entry and retains a TTL'd terminal
  result; progress is deliverable to late/reconnecting subscribers by `cwd`.
- `folder-action-bar`: the Initialize control renders as a status chip with opt-in log
  instead of an inline raw `<pre>` tail/stderr.

## Impact

- **Server** (`packages/server/src/worktree-init.ts`, `worktree-init-registry.ts`,
  `routes/git-routes.ts`): add a cwd-keyed active-run map with TTL'd terminal state; new
  `active-inits` route; emit progress/done/failed addressable by cwd. Existing
  requestId path stays for back-compat.
- **Client** (`packages/client/src/components/WorktreeInitButton.tsx`,
  `lib/worktree-init-bus.ts`, `lib/auto-init-worktree.ts`, spawn/placeholder card,
  `App.tsx` boot): subscribe by cwd, render the chip/sub-state, fetch `active-inits` on
  boot, drop the discarded-requestId pattern in auto-init.
- **Protocol** (`packages/shared/src/browser-protocol.ts`): worktree-init messages carry
  `cwd`; add the `active-inits` response type.

## Migration / Compatibility / Rollback

- **Migration**: none. New endpoint + additive registry keying; no persisted schema change
  (terminal state is in-memory + TTL).
- **Compatibility**: the existing requestId subscription keeps working; cwd keying is
  additive. Raw-`<pre>` removal is a pure view change.
- **Rollback**: revert the client surfaces to the inline `<pre>`; the server registry is
  inert if unused.

## Non-Goals

- Unifying `BashOutputCard` / `ToolCallStep` under a shared `<ExecutionChip>` (a larger
  refactor; this change is scoped to worktree init only).
- Persisting run history across server restarts (terminal state is TTL'd in-memory).
- Server-side auto-run on `POST /api/git/worktree` (still gated on TOFU trust, unchanged).

## Discipline Skills

- `security-hardening` — the newly-surfaced failure UI must not leak secrets from hook
  stderr, and the auto-init path must preserve the TOFU trust gate (untrusted hooks never
  auto-run).
- `observability-instrumentation` — new `active-inits` endpoint + cwd-keyed run registry
  are runtime-state surfaces that need to report state accurately across reconnects.
- `doubt-driven-review` — the cwd-keyed registry lifecycle (TTL, drop-on-close, concurrent
  runs) is cross-boundary state; review the transitions before they stand.
