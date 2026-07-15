## Context

`ChatView` renders an open session's transcript. `SessionList` renders the
sidebar: pinned/unpinned + workspace tiers, folder grouping, ended-collapse,
show-hidden toggle, and tag/phase/text filters. The two are siblings under
`App`, which owns `selectedId` and the session/workspace data.

A card can be buried by four independent mechanisms, and they are **not**
morally equal:

| Container | Keyed by | State store | Mutator | Sync? |
|---|---|---|---|---|
| Workspace tier | `folderWorkspaceMap.get(cwd)` → ws.id | **server** (`ws.collapsed`) | `onSetWorkspaceCollapsed(id, false)` | ⚠️ async (echo) |
| Folder | `session.cwd` | localStorage `dashboard:collapsedGroups` | `handleToggleCollapse(cwd)` | ✅ sync |
| Ended group | `session.cwd` | local `endedExpanded: Set` | `setEndedExpanded(add cwd)` | ✅ sync |
| Hidden | per-session `hidden` flag (server) + `showHidden` **local `useState`** toggle | mixed | `onUnhideSession` / local `showHidden` | out of scope |
| Filter | n/a (predicate) | local filter state (incl. folder-path `workspaceFilter`) | clear filters | out of scope |

Note: `showHidden` is a local view toggle (`SessionList.tsx` `useState(false)`),
not server state; only the per-session `hidden` flag is persisted. Collapsed
folders/workspaces animate via `grid-template-rows: 0fr; opacity: 0`
(`index.css`), **not** `display:none`.

**Key trace result:** the fold ancestors (workspace, folder, ended) are all
derivable from `session.cwd` + `session.status` alone. No graph walk — a flat
three-level lookup.

## Goals / Non-Goals

Goals:
- One-gesture reveal of the active session's card from ChatView.
- Correct sequencing across the async workspace-collapse boundary.
- Preserve user intent for hidden/filtered cards (no silent global mutation).

Non-Goals:
- Auto-revealing hidden sessions (server state; all-or-nothing toggle).
- Auto-clearing active filters.
- Changing the passive first-mount scroll behavior or `FolderNeedsYouPill`.

## Decisions

### Decision 1: One-shot reveal request `{ sessionId, nonce }`, not a bare id

`App` holds `revealRequest: { sessionId: string; nonce: number } | null`. The
ChatView Seek button calls `onSeek(sessionId)`, which bumps `nonce`. `SessionList`
runs a `useEffect` keyed on `revealRequest.nonce`.

Why a nonce and not just reuse `selectedId`:
- Seeking the **same** already-selected session must re-fire (the card may have
  been re-collapsed since). A bare id `useEffect` would not re-run.
- The existing first-mount effect *deliberately* refuses to scroll on
  `selectedId` changes. The nonce is an explicit user gesture, semantically
  distinct from selection, and is *allowed* to hijack scroll.

### Decision 2: Retry-until-present reveal, event-driven across the async boundary

`FolderNeedsYouPill` does `expand → requestAnimationFrame → scrollIntoView` and
**stays unchanged** (non-goal). It works because it only crosses the **folder**
boundary (sync localStorage). The new seek path is a *separate* mechanism that
can cross the **workspace** boundary, whose expand is an async server round-trip
(`set_workspace_collapsed` → `workspaces_updated` echo → `workspaces` prop
re-render). A single rAF fires before the card exists in the DOM.

Reveal algorithm (guards + correct predicate + event-driven wait + cleanup):

```
expandAncestors(session)   // GUARDED: ws only if collapsed (idempotent server call);
                           // folder only if collapsedGroups.has(cwd) (toggle!);
                           // ended via ADD-ONLY setter (never toggle)
onSelect(session.id)

// Presence = laid out, NOT offsetParent (collapsed rows keep non-null offsetParent)
function present() {
  const el = listRef.current?.querySelector(`[data-session-id="${escape(id)}"]`)
  return el && el.getBoundingClientRect().height > 0 ? el : null
}
function reveal(el){ el.scrollIntoView({behavior:"smooth",block:"center"}); flash(el) }

// Try now; else the `workspaces` prop change (echo) drives completion; a fixed
// generous backstop only catches a never-arriving echo. Cancel on unmount / new nonce.
if (present()) reveal(present())
else subscribe-until: workspaces-updated OR timeout(5000 /* backstop only */)
     → present() ? reveal() : retryToast("couldn't reveal the card", onRetry: reseek)
```

Why not a bare frame cap: a ~160ms/10-frame budget is calibrated for a local
60fps echo. On a remote / zrok / Docker topology (all supported) the WS
round-trip routinely exceeds it, and rAF throttles on backgrounded tabs
(`useAppHidden`). Waiting on the actual `workspaces` prop update (the echo
landing) is correct; the timer is only a give-up bound. `flash(el)` reuses the
existing `card-ring-fx` / selected-ring treatment.

### Decision 7: Event-primary completion; the timeout is a fixed backstop only

The adaptivity lives in the **event**, not the timeout. The `workspaces_updated`
echo landing (a `workspaces` prop change) is what actually completes the reveal
— it fires exactly when the async workspace expand resolves, fast on localhost
and slow on zrok/Docker, with no computation. The fallback timer is a **pure
give-up backstop** for the case where the echo *never* arrives (genuine
failure), so a fixed generous value (**5s**) is correct: it never gates the
happy path (the event wins first) and only bounds the failure case.

Rejected: deriving the bound from the bridge heartbeat/RTT (an earlier
direction). A cross-model review disproved it — `watchdog.intervalMs` is the
*tunnel* watchdog (wrong semantics), `heartbeat_ack` is server→bridge and never
reaches the browser (no browser-side RTT exists without net-new protocol), and
`K × interval` reduces to a runtime constant anyway (config is fixed
mid-session). The event already provides the only adaptivity that matters.

### Decision 8: The timeout toast carries a retry action (Toast gains an action)

Unlike the hidden/filtered toasts (intentional user state → informational only),
a reveal *timeout* is a transient failure worth retrying. The timeout toast
carries a **Retry** affordance that re-fires the seek (bumps the nonce). Two
constraints surfaced by cross-model review:

- **Suppress auto-dismiss** for this toast. The shared `Toast` auto-dismisses at
  ~3s (`Toast.tsx`), too short to notice + read + click Retry. The
  action-bearing toast must stay until dismissed (or use a much longer TTL).
- **Thread the retry dispatcher into `SessionList`.** The reveal effect and
  `useToast` live in `SessionList`, but `seekToCard` lives in `App`. Pass a
  retry callback (or `seekToCard`) into `SessionList` so the Retry `onClick`,
  captured at show-time, can re-dispatch the reveal.

This requires extending the shared `Toast` (`ToastMessage` / `ToastVariant`)
with an optional action `{ label, onClick }` and an optional no-auto-dismiss
flag — today it is display-only. Scope minimally; existing call sites and the
hidden/filtered toasts are unaffected (no action → current behavior).

### Decision 3: Hidden / filtered degrade to an informational toast, never a flip

Classify the target **up front** (statically decidable from the full `sessions`
prop + the same predicates the list uses — `session.hidden && !showHidden`,
`passesTagAxes`, text search, and the folder-path `workspaceFilter`), not inside
the retry loop:
- **hidden** (and `showHidden` off) → skip reveal; informational toast telling
  the user to enable *Show hidden*.
- **filtered out** by any active filter (tag / phase / text / folder-path) →
  skip reveal; informational toast that a filter is hiding the card.
- otherwise → run the fold-ancestor reveal.

Both toasts are **informational only**: the shared `Toast` component is
display-only (no action button/callback), and — more importantly — `showHidden`
un-hides *all* hidden sessions and clearing filters discards the user's active
query. Those are broad side effects the user did not ask for. The fold
containers, by contrast, are pure density affordances — expanding them is
exactly what the user wants and is fully reversible.

### Decision 4: Button placement — `SessionHeader`, next to the title

The title bar above the chat is `SessionHeader`, rendered by `App` — ChatView's
own return is the scroll body with no header. The button lives in `SessionHeader`
and `seekToCard` is wired from `App` (which already owns `selectedId`,
`workspaces`, and the `SessionList` props). Visible, one-click, matches the
mockup. Alternative (ChatViewMenu kebab) is less discoverable; rejected for a
primary navigation affordance.

### Decision 5: Desktop-only for v1

On mobile the sidebar is a `MobileOverlay` gated by `mobileOpen`, mutually
exclusive with ChatView. A mobile Seek would have to `setMobileOpen(true)` and
survive the overlay-mount boundary before the ancestor-expand + scroll — a
second async boundary on top of the workspace echo. For v1 the Seek button is
**hidden when `useMobile()` is true**. Mobile support is a follow-up (open
question below).

### Decision 6: Filtered-out toast is informational only

When an active filter excludes the card, the toast explains why ("Card hidden by
active filter") and takes no action. No "clear & seek" button in v1: clearing
filters is a broad, surprising side effect from a navigation gesture, and the
user can clear filters themselves in one place. Revisit if users ask for it.

## Risks / Trade-offs

- **Cold-boot workspaces race** (accepted): `folderWorkspaceMap` is empty until
  the first `workspaces_updated` lands. A seek fired in that window skips the
  workspace-ancestor expand; if the card sits in a collapsed workspace it won't
  appear → timeout toast. Narrow (requires seeking within ~1s of first paint);
  the event-driven wait already re-checks on the `workspaces` update, which
  covers most of this.
- **Mid-drag `forceCollapsed`** (accepted): during a workspace DnD drag,
  `displayCollapsed = forceCollapsed.has(ws.id) || ws.collapsed` masks the
  server expand, so a seek issued mid-drag silent-fails into the timeout toast.
  Seeking while dragging is not a real workflow; documented, not handled.
- **Competing scroll** (accepted): the first-mount fingerprint effect scrolls
  `block:"nearest"` on an unchanged selection when a background re-sort perturbs
  the fingerprint; the nonce effect scrolls `block:"center"`. If both fire in
  one window the last wins — by design the explicit seek gesture should win, and
  `center` is the intended target. Low-frequency; no coordination added.
- **Flash reuse**: depends on the `card-ring-fx` / selected-ring treatment
  staying stable. It is already the selection affordance, low churn risk.

## Migration Plan

Additive. No data migration, no protocol change beyond the existing
`onSetWorkspaceCollapsed` path (already wired). Feature is inert until the Seek
button is clicked.

## Open Questions

Both v1 open questions are now resolved (Decisions 5 and 6). Deferred to a
follow-up:

- **Mobile Seek** — open the `MobileOverlay`, then expand ancestors + scroll,
  with the retry-loop extended to survive the overlay-mount boundary. Deferred
  from v1 (Decision 5).
