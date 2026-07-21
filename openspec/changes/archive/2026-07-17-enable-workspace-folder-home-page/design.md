# Design

## Context

Amends the archived `add-directory-home-page` change. That change deliberately gated
both the sidebar open affordance (D3) and the page itself (D4) to pinned,
non-workspace folders. This change relaxes both gates for workspace-owned folders
only. The page component and route are reused verbatim.

## Decisions

### D1 — Eligibility source: pass workspace-folder paths (A1), not "any known dir" (A2)

`DirectoryHomeView`'s guard becomes `pinnedDirectories.includes(cwd) ||
workspaceFolders.has(cwd)`. `App.tsx` already holds `workspaces` state; derive the
flat set `new Set(workspaces.flatMap(w => w.folders))` **memoized on `workspaces`**
(a fresh Set every render would break any future `React.memo` on the view) and pass
it as a prop. The guard then renders precisely for real pinned dirs and real
workspace folders — nothing else.

**Path-normalization caveat (S1):** in-app navigation is safe — the affordance
round-trips the canonical `group.cwd` the server already stored. But a hand-typed /
pasted non-canonical `/folder/<path>` (trailing slash, symlink, macOS case) misses a
raw `Set.has(cwd)`. This exactly matches the *pre-existing* pinned-guard behavior
(`pinDirectory` stores raw, `preferences-store.ts:343`), so it is not a net-new
regression; we accept parity here rather than introduce `pathKey` normalization
only on the workspace arm (would create an inconsistency). Flagged, not fixed.

**Alternative rejected (A2 — "any known dir": pinned ∪ workspace ∪ has-sessions):**
looser mental model, over-accepts transient session cwds that were never organized,
and would render the page for folders with no sidebar entry point (dead surface).

### D2 — Navigation stays on the distinct open affordance; the name click is untouched

The sidebar change is the affordance condition `isPinned && !inWorkspace` →
`isPinned || inWorkspace` (see the corrected proposal: `folder.pinned` is `false`
for an unpinned workspace folder, so `isPinned` alone would keep the button hidden
on the very folders this change targets). The folder-name row keeps
`handleToggleCollapse` — never repurposed. Cross-model review confirmed the
affordance button is a distinct sibling of the header-click code, so this is
orthogonal to `accordion-workspace-folders` (expand-one) and
`focus-driven-folder-compaction` (set `activeCwd`), which both bind that header click.

### D3 — Cold-load guard needs a SEPARATE `workspacesLoaded` flag (corrected)

**Earlier premise was wrong** (both doubt reviewers, code-verified): pinned dirs and
workspaces do NOT share a message. On connect the server sends three sequential,
un-batched messages — `sessions_snapshot` (`browser-gateway.ts:413`),
`pinned_dirs_updated` (`:418`), `workspaces_updated` (`:429`) — each with its own
handler (`useMessageHandler.ts:865/874/883`). After `pinned_dirs_updated` lands,
`pinnedDirectoriesLoaded` is `true` while `workspaces` is still `[]`; a cold direct
URL to a workspace-only folder would render the guard-miss notice for one tick, then
flip — the exact flash the spec forbids.

Fix: add `workspacesLoaded`, flipped on the first `workspaces_updated`. The guard's
ready condition is `pinnedDirectoriesLoaded && workspacesLoaded`. Safe because
`workspaces_updated` is sent **unconditionally** on modern connect — even when the
list is empty (`browser-gateway.ts:428-430`, guarded only by `typeof
getWorkspaces === "function"`). **Legacy-stub caveat:** a pre-workspaces
`PreferencesStore` stub (tests only) sends no `workspaces_updated`; treat missing
workspace data as "loaded-empty" for those, or the guard hangs. Real servers always
send it.

### D4 — Guard-miss copy is de-pinned

The notice currently reads "This folder is not pinned". Once D3 is fixed, the only
remaining miss case is "neither pinned nor a workspace folder" — for which the **pin
CTA is the correct remediation** (a workspace member never reaches the notice).
Reword to a neutral "This folder isn't available as a home page" and keep the pin CTA.

### D5 — Dual-membership + reconnect edge cases (documented, no new behavior)

- **Pinned AND workspace-owned:** `visibleTopPinned`/`visibleTopUnpinned`
  (`SessionList.tsx:421-433`) already strip any `workspaces[].folders` cwd from the
  top-level tier, so such a folder renders once, inside the workspace, with
  `inWorkspace=true`. Affordance shows via `inWorkspace`; guard passes via either
  set. No double-render, no new logic — the invariant is load-bearing and called
  out so a future grouping change doesn't silently break it.
- **Reconnect:** `workspaces` state is retained across reconnect (not reset with
  subscriptions) until a fresh `workspaces_updated` replaces it. The guard tolerates
  the retained set; a transiently stale membership is benign (one tick, corrected on
  the next `workspaces_updated`).

## Risks / Open Questions

- **Copy wording** for the reworded notice is a UX-writing detail, not a blocker;
  final string chosen at implementation.
- **No route change** — the route was always cwd-generic; only the guard gated it.
- **`workspacesLoaded` legacy-stub handling** — implementation must not hang the
  guard when a test stub never sends `workspaces_updated` (treat as loaded-empty).
