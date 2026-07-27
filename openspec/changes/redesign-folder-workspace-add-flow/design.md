## Context

Three surfaces conspire to make adding a folder harder than using one. `SessionList.renderGroup` renders a group
for any cwd it can group — pinned, workspace-owned, or loose (a cwd that merely has sessions). Every such row
navigates to `/folder/<encodedCwd>` (`directory-card-clickable-select`), but `DirectoryHomeView`'s
eligibility guard only renders for pinned-or-workspace cwds, so loose folders hit a dead end. The single escape
was a "Pin this folder" CTA; the alternative organise gesture, `renderGroupWithWorkspaceMenu`'s `+ws` token, is
10px text in an `absolute top-1 right-7` layer outside the row's icon cluster. Bulk adding is impossible:
`PinDirectoryDialog` wraps `PathPicker` in single-select mode where row activation both descends and commits.

Interactive mockup for all surfaces below (dark + light, verified 420 → 1440 px): `mockups/add-flow.html`.

Relevant existing invariants this design must respect:

- **Single membership** (`folder-workspaces`): a folder belongs to at most one workspace; adding to B detaches
  from A server-side.
- **Pin/workspace orthogonality** (`folder-workspaces`): `add_folder_to_workspace` never mutates
  `pinnedDirectories`.
- **No double-render** (`SessionList.visibleTopPinned` / `visibleTopUnpinned`): top-level groups filter out any
  cwd claimed by a workspace, so a folder that is both pinned and workspace-owned renders once, in its tier.
- **Pin control scoping** (`renderGroup`): the pin button already renders only when `!inWorkspace`.

## Goals / Non-Goals

**Goals:**

- No sidebar surface can strand the user: any groupable cwd renders a usable home page.
- One learnable glyph for "add this folder to a workspace", present on both the folder row and the session card.
- Add many folders in one pass, choosing the destination once.
- Deterministic iconography (MDI paths, `currentColor`) in place of emoji.
- The folder-header icon cluster never wraps or escapes the top-right, at any sidebar width.

**Non-Goals:**

- Drag-and-drop of OS folders onto the sidebar (a fast path worth having, but orthogonal and larger).
- Multi-workspace membership — the single-membership invariant stands.
- Reworking pin persistence, the workspace protocol, or `GET /api/browse` itself.
- Recursive/tree-style multi-select (expanding several directories simultaneously in one view).
- Changing how loose cwds are grouped or ordered.

## Decisions

### 1. Delete the eligibility guard rather than add a second CTA

The mockup's first iteration gave the dead-end page a second "Add to workspace" button. That treats the symptom:
the page still refuses to render the thing the row promised. Since a groupable cwd always carries enough state to
render its home (a session list plus a spawn prompt), the eligibility question has no useful answer — so the
guard, its notice, its three i18n keys, and the `pinnedDirectoriesLoaded && workspacesLoaded` cold-load gate all
go. This also retires the two-message race the guard existed to arbitrate.

*Alternative considered:* keep the guard but auto-pin on first visit. Rejected — a silent write as a side effect
of navigation is surprising and hard to undo.

### 2. Pin becomes an implicit visibility primitive, not a destination

Adding always pins. Pin state *is* what makes a dashboard-root folder visible, so offering it as a choice asks
the user to opt into visibility for a folder they just asked to see. The dialog therefore poses exactly one
question (which workspace, if any) and the popover drops its pin entry.

Always-pinning is safe *because* of `visibleTopPinned`: a folder that is both pinned and workspace-owned is
filtered out of the top-level list and renders once inside its tier. The redundant pin is deliberate — it is a
fallback so that removing the folder from its workspace later leaves it visible at root instead of vanishing.

The corollary — "unpin removes it instantly" — applies only to dashboard-root rows, since `renderGroup` already
hides the pin control when `inWorkspace`. Workspace membership is its own visibility source. No change needed;
this is the reason the semantics are coherent.

*Alternative considered:* make unpin also detach from the workspace, so pin is the single visibility switch
everywhere. Rejected — it destroys workspace organisation as a side effect of a visibility gesture.

### 3. `mdiFolderPlus` + `mdiMenuDown`, sized into the existing cluster

The affordance must read without a text label at ~20px. Folder-plus is the established glyph for "add a folder to
a collection" (VS Code, Finder, Drive); the caret is the Material convention for "opens a menu", which pre-empts
the fear of a destructive one-click; placing it inside the cluster next to `pin` borrows that group's meaning by
proximity. `aria-label` + `title` carry the full verb so the icon is never the sole cue. Cluster order:
`sort · add-to · home · pin`.

*Alternatives considered:* icon-only (8px narrower, but loses the menu signal, so the popover is a surprise);
hover-expand to a labelled pill (teaches the verb once, but reflows the cluster on hover and is useless on
touch). Both are mocked in `mockups/add-flow.html` for comparison; V1 wins on signal-per-pixel.

### 4. Multi-select is an opt-in mode on `PathPicker`, not a new component

`PathPicker` already owns debounced browsing, the network-guard denial surface, `mkdir`, keyboard navigation, and
platform-aware path parsing. Forking it would duplicate all of that. Instead a `selection` mode flag changes two
behaviours: row activation navigates instead of calling `onSelect`, and rows render a checkbox. Single-select
callers (session spawn, etc.) are untouched.

The gesture split is the crux of the redesign: **row body = navigate, checkbox = select**, with a trailing
`mdiChevronRight` making "descend" explicit rather than merely implied by the row being clickable. The checkbox
stops propagation so ticking never navigates.

### 5. Batch commit reuses existing per-path messages

Committing N paths sends N `pin_directory` messages and, when a workspace is chosen, N
`add_folder_to_workspace` messages — no new protocol. N is a human-selected handful, and each message is already
idempotent (`add_folder_to_workspace` no-ops when the path is already present). Pins are sent before workspace
adds so the folder is never momentarily invisible.

*Alternative considered:* a new batched message type. Deferred — it buys fewer broadcasts at the cost of new
protocol surface, server handling, and migration. Revisit only if the broadcast churn below proves visible.

### 6. Cluster fit is a layout contract, not a media query

`flex: none` + `white-space: nowrap` on the cluster, `min-width: 0` on the name region. Truncation priority is
explicit: the parent path is `flex: 0 1 auto; min-width: 0` (may collapse entirely) while the leaf keeps a
legible floor. Building the 220px mock proved this matters — the naive version truncated `general` to `g` while
the long parent path kept its space, i.e. it discarded the payload and preserved the context.

## Risks / Trade-offs

- **N×2 broadcasts on commit cause sidebar reorder churn/flicker** → Send pins first, then workspace adds; each
  handler already broadcasts a full snapshot, so the final state is correct regardless of interleaving. Measure
  with ~10 paths; if visible, coalesce behind one batched message (Decision 5's deferred option).
- **Removing the guard exposes home pages for cwds whose directory no longer exists** → Already handled
  elsewhere: `CwdGonePill` covers missing directories, and the empty-state prompt renders for zero sessions.
- **Nested interactive controls (checkbox inside a clickable row) can break keyboard/AT semantics** → The
  checkbox is a real focusable `button`/`input` with its own accessible name, `stopPropagation` on activation,
  and Space toggles selection while Enter activates the row. Needs explicit a11y coverage in tests.
- **Icon-only affordance is less discoverable than `+ws` text for existing users** → Tooltip plus accessible
  name; the glyph is conventional; and the same verb remains reachable from the Add Folders dialog and the
  workspace-scoped Add Folder button, so it is not the only path.
- **Test churn**: `PathPicker.test.tsx`, `PinDirectoryDialog.test.tsx`, and `SessionList.test.tsx` assert
  single-select, `+ws`, and guard behaviour → Update alongside each phase, not in one sweep.
- **Always-pinning writes state the user did not explicitly request** → Mitigated by it being the visibility
  mechanism itself (the folder they asked to add), reversible from the row's pin control, and non-duplicating.

## Migration Plan

Three independently shippable phases, ordered by user-visible payoff:

1. **Guard removal** — deletes `DirectoryHomeView`'s eligibility branch and its i18n keys. Fixes the reported
   dead end on its own; no other surface depends on it. Lowest risk, ship first.
2. **Cluster affordance** — `+ws` → icon+caret button in `renderGroupWithWorkspaceMenu`, pin entry removed from
   `AddToWorkspaceMenu`, same button added to the session card header, plus the cluster no-wrap/truncation CSS.
3. **Multi-select picker** — `PathPicker` selection mode + MDI glyph swap, `PinDirectoryDialog` becomes the Add
   Folders dialog with basket and destination, wired to both `dashboard-add-buttons` entry points.

Rollback: each phase is a self-contained client-side revert; no persisted-state or protocol migration is
involved, so reverting restores prior behaviour with no data cleanup. Existing `pinnedDirectories` and
`workspaces[].folders` are read and written in their current shapes throughout.

## Open Questions

- **Session-count badge source**: the picker is client-side and already has the session list, so the badge can be
  a local join of browse entries against session cwds — no `/api/browse` change. Confirm the join handles
  platform-normalised path comparison (reuse `pathKey` from `session-grouping`) rather than raw string equality.
- **Should the workspace-scoped Add Folder button allow overriding its preselected destination?** Preselecting
  is clearly right; whether the radio group stays editable (letting the user retarget mid-flow) or is locked to
  that workspace is a UX call worth one round of feedback.
- **Does `+ New workspace…` inside the dialog need to create eagerly or on commit?** Eager creation is simpler
  but leaves an empty workspace behind if the user then cancels.
