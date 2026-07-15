## Why

When a session is open in `ChatView`, its card in the sidebar `SessionList` is
often buried behind one or more collapsed containers — a collapsed workspace
tier, a collapsed folder group, and/or a collapsed "ended" sub-group. The user
loses the spatial anchor: they are reading a transcript but cannot see where the
session lives, cannot reach its card actions (fork, resume, worktree, hide), and
cannot orient among sibling sessions.

The reveal primitive already exists — `FolderNeedsYouPill.onActivate`
(`SessionList.tsx` ~line 732) expands a collapsed folder, selects a session, and
scrolls its card into view. But it is wired to exactly one entry point (a folder
rollup pill) and only ever crosses the **folder** boundary (synchronous
localStorage state). There is no way to trigger the same "take me to my card"
move from the open ChatView, and the pill's single-`requestAnimationFrame`
scroll cannot survive the **workspace** boundary, whose collapse state is
async server state.

The current first-mount scroll effect (`SessionList.tsx` ~line 264)
**deliberately refuses** to scroll on later selection changes
(`// User clicked / programmatic switch — do not hijack scroll position.`), so a
passive "select re-scrolls" approach is intentionally ruled out. An explicit
user gesture is the correct trigger — it is allowed to hijack scroll because the
user asked for it.

## What Changes

- Add a **Seek to card** control to the **session header** (`SessionHeader`,
  rendered by `App` above the ChatView body — ChatView itself has no header) for
  the active session. Clicking it reveals that session's card in the sidebar:
  expand every collapsed ancestor, select the card, scroll it to center, and
  flash it. **Desktop-only for v1** — hidden when `useMobile()` is true (the
  mobile sidebar is a separate overlay; support deferred to a follow-up).

- Cross the ChatView → SessionList gap with a one-shot **reveal request**
  signal `{ sessionId, nonce }` in App state. A `nonce` (monotonic counter),
  not a bare id, so seeking the *same* session twice re-fires, and so the signal
  is distinguishable from ordinary selection (which must not hijack scroll).

- In `SessionList`, resolve the card's ancestor chain from the session alone —
  no graph walk. Each expand is **guarded on the container currently being
  collapsed** (the mutators are toggles/add-only; blindly calling them would
  re-collapse an already-open container on a repeat seek):
  - **Workspace ancestor** = `folderWorkspaceMap.get(session.cwd)` → if the ws
    is collapsed, expand via `onSetWorkspaceCollapsed(wsId, false)` (server
    round-trip, idempotent).
  - **Folder ancestor** = `session.cwd` → if `collapsedGroups.has(cwd)`, expand
    via `handleToggleCollapse(cwd)` (a **toggle** — call only when collapsed;
    localStorage `dashboard:collapsedGroups`).
  - **Ended ancestor** = `session.status === "ended"` → add the cwd to the
    ended-expanded set via the **add-only** setter (never the toggle variant),
    so a repeat seek keeps it open (local component state).

- The new seek path uses a **retry-until-present** reveal (distinct from, and
  not a modification of, `FolderNeedsYouPill` — which stays single-rAF and is
  untouched). After expanding ancestors, wait for the target card to be **laid
  out** before scrolling, because the workspace-collapse expand is an async
  server round-trip (`workspaces_updated` echo) and collapsed folders animate
  open over ~250ms:
  - **Presence predicate** = the `listRef`-scoped `[data-session-id]` element
    exists AND `getBoundingClientRect().height > 0`. NOT `offsetParent !== null`
    — collapsed folders use `grid-template-rows: 0fr; opacity: 0` (not
    `display:none`), so `offsetParent` stays non-null on a 0-height card and
    would scroll to a collapsed row.
  - **Scope the query to `listRef.current`**, not `document` — `[data-session-id]`
    is emitted by both SessionCard variants and the OpenSpec board.
  - **Cross the async workspace boundary by event, not just frames**: prefer
    re-running the presence check when the `workspaces` prop updates (the echo
    landing), with a bounded fallback timer. A short frame cap alone cannot
    survive a remote/zrok/Docker round-trip.
  - **The echo event drives completion; the timeout is a fixed backstop.** The
    `workspaces_updated` echo landing completes the reveal (adaptive by nature).
    A fixed generous backstop (**5s**) only catches a never-arriving echo; it
    never gates the happy path. (Rejected deriving the bound from heartbeat/RTT
    — the tunnel watchdog is the wrong signal and no browser-side RTT exists.)
  - **Cancel any pending rAF/timer** on unmount or a new nonce (backgrounded
    tabs pause rAF via `useAppHidden`; a leaked callback must not fire after
    unmount).
  - **On timeout** (echo never lands within the 5s backstop): surface a toast
    with a **Retry** action that re-fires the seek.

- Extend the shared `Toast` component with an optional action `{ label, onClick }`
  and an optional no-auto-dismiss flag (today it is display-only, auto-dismiss
  ~3s) — used only by the reveal-timeout toast's Retry (auto-dismiss would make
  the button unusable). The hidden/filtered toasts stay informational (no action).

- **Graceful degradation for non-fold containers** (the regression surface the
  reveal must NOT trample). Classify the target **up front** from the full
  `sessions` prop + filter predicates — not via the retry layer:
  - **Hidden** session (`showHidden` is a local all-or-nothing view toggle;
    flipping it un-hides *every* hidden session; the per-session `hidden` flag
    itself is the server-persisted state, the toggle is ephemeral `useState`):
    do NOT auto-flip. Surface an **informational** toast (the shared `Toast` is
    display-only — no action button) telling the user to enable *Show hidden*.
  - **Filtered-out** session (excluded by any active filter — tag, phase, text
    search, **or the folder-path `workspaceFilter`**): do NOT auto-clear
    filters. Surface an **informational** toast that a filter is hiding the card.

## Capabilities

### New Capabilities

- `session-card-seek` — reveal a session's sidebar card from ChatView by
  expanding its collapsed ancestor chain, then selecting, scrolling, and
  flashing it; degrade gracefully when the card is hidden or filtered out.

## Discipline Skills

- `doubt-driven-review` — the retry-until-present reveal crosses an async
  server-state boundary (workspace collapse echo); stress-test the sequencing
  and frame cap before it stands.
