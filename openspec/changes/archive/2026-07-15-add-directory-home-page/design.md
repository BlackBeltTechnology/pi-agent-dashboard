## Context

The dashboard client renders content surfaces via **independent `useRoute()` hooks**
in `App.tsx` feeding a large ternary chain (desktop) and a parallel mobile chain —
there is no `<Switch>`/route-registry. Folder surfaces live under
`/folder/:encodedCwd/{terminals,editor,settings,openspec,pi-resources,view}`; the
bare `/folder/:encodedCwd` index is unclaimed.

Sessions are spawned via `handleSpawnSession(cwd, attachProposal?, opts?)`
(`useSessionActions.ts`), which mints a `requestId`, records it in
`pendingSpawnsRef`, and sends `spawn_session`. The already-shipped
`initialPrompt` field is queued server-side (`pending-initial-prompt-registry`) and
dispatched on the next matching `session_register`. `session_added` echoes
`spawnRequestId`; `useMessageHandler` uses Tier-1 exact-`requestId` correlation to
auto-select/navigate, with a weaker pathKey (cwd) fallback for legacy servers.

`CommandInput` is today always mounted **inside** `sessionDetail` (i.e. only when
`selectedId` is set). Every current binding (`onSend`, model selector, images,
draft, `/view`, inline-terminal) closes over `selectedId`. The sidebar's
`renderGroup` (`SessionList.tsx`) is shared across pinned, unpinned, and workspace
folders; the folder-name row is itself the collapse toggle.

Models in pi-flows/pi-coding-agent are **global**, applied by a bridge handler that
runs inside a live pi process (a `set_model` routed through any live session sets it
globally).

## Goals / Non-Goals

**Goals:**
- A `/folder/:encodedCwd` home page (desktop + mobile) for **pinned** directories.
- A vertically-centered prompt that, on send, spawns a session with the typed text
  as `initialPrompt` and navigates to it.
- Folder header, existing-session list, quick actions (terminals/editor/settings).
- Doubles as the folder's empty state without conflicting with root `LandingPage`.

**Non-Goals:**
- Workspace-group folders as selectable home targets (pinned only).
- Carrying pasted images or `delivery` (steer/followUp) through the initial spawn —
  the transport has no field for them; v1 sends text only.
- Any new server/bridge/protocol message. v1 is strictly client-only.
- A functional model picker (DEFERRED to a follow-up — see D5). v1 spawns with
  pi's default model.
- Per-folder persisted default model.

## Decisions

### D1 — Bare route via a new `useRoute` + branch in both chains
Add `const [folderHomeMatch, folderHomeParams] = useRoute("/folder/:encodedCwd")`.
wouter's regexparam compiles `^/folder/([^/]+?)/?$`; `[^/]+?` never crosses `/`, so
it cannot match `/folder/:enc/terminals` — **no shadowing**, independent of order.
Render `DirectoryHomeView` in the desktop ternary AND the mobile chain, with a
mobile back-depth entry. **Alternative rejected:** relying on declaration order —
meaningless here, the chains are independent hooks.

### D2 — Spawn-mode adapter, not "CommandInput reused unchanged"
`DirectoryHomeView` mounts `CommandInput` for presentation but passes a spawn `onSend`:
`onSend={(text) => { setGlobalModelIfChanged(); handleSpawnSession(cwd, undefined, { initialPrompt: text }); }}`.
It supplies **local** draft state (no `selectedId`, no per-session draft/image maps),
passes no `sessionId`/`sessionStatus`, and omits session-only affordances
(`/view`, inline-terminal) or stubs them out. **Correct arg form is 3-positional**
(`cwd, undefined, { initialPrompt }`) — the 2nd arg is `attachProposal`; passing an
options object there would serialize `[object Object]` as the attach proposal.
**Alternative rejected:** a brand-new bespoke input — loses the model chip, styling,
keybindings, and a11y that `CommandInput` already carries.

### D3 — Distinct "open" affordance on pinned rows
The folder-name row already fires `handleToggleCollapse`. Add a separate control
(e.g. an "open" icon-button or the folder-icon click) that `navigate("/folder/<enc>")`
and `stopPropagation()`s so it neither toggles collapse nor starts a drag-reorder
(the drag listeners live on `FolderDragGutter`, a sibling of the name row, so the
new control is already outside them; `stopPropagation` guards the collapse click).
Added on **pinned rows only**. **Alternative rejected:** repurposing the name click
— destroys the established collapse gesture and breaks muscle memory.

### D4 — Pinned guard on the cwd-generic route
`renderGroup` is shared and the route accepts any cwd, so a direct URL to a
non-pinned folder must not silently render. `DirectoryHomeView` checks
`pinnedDirectories.includes(decodedCwd)`; a miss renders a "not pinned" notice with
a pin CTA. **Cold-load guard:** `pinnedDirectories` starts `[]` and populates
asynchronously from `sessions_snapshot` on WS connect, so the guard must gate on a
`pinnedDirectoriesLoaded` flag (or WS-connected + snapshot-received) and show a
loading skeleton until data arrives — otherwise a direct URL / refresh flashes the
not-pinned state on every load. **Alternative rejected:** trusting that only pinned
rows link here — deep-links/bookmarks bypass the sidebar; redirect-to-`/` before
data loads causes a flash loop.

### D5 — Model picker DEFERRED (not in v1)
A functional picker is impossible client-only: `pi.setModel()` is **process-local**
(`extension/src/bridge.ts`), the `set_model` bridge handler ignores its `sessionId`
and mutates only its own process, and `spawnPiSession` (`server/src/process-manager.ts`)
takes no `model` param — a new session loads `config.defaultModel`
(`bridge-default-model-gate.ts`). Routing `set_model` through an existing session
cannot influence a session that does not yet exist. The only correct mechanism is
adding a `model` field to `spawn_session` applied on `session_register` (mirroring
`initialPrompt`'s pending-registry pattern) — a **server/protocol change** out of
scope for a client-only v1. Therefore v1 renders **no model picker**; the spawn uses
pi's default model. Consequence for D2: `CommandInput`'s model-selector props
(`models`, `onSelectModel`) are omitted, so `DirectoryHomeView` needs no global
model-list aggregation. **Follow-up:** a separate change adds the `spawn_session`
`model` field + picker. **Alternative rejected:** faking it with pre-spawn
`set_model` — disproven above (no effect on the new process).

### D1a — Extend mobile back-depth for the new route
`getMobileDepth` currently derives `hasFolderRoute` from `folderTermCwd ||
folderEditorCwd` only (`App.tsx`). The bare `/folder/:encodedCwd` home must be
added to that derivation so mobile back navigation pops to the correct predecessor
instead of treating the home page as depth-0.

### D6 — Navigate on Tier-1 correlation
Reuse `pendingSpawnsRef` Tier-1 exact-`requestId` → `session_added` navigation. The
home page does not hand-roll navigation. On modern servers this is exact and
unambiguous.

## Risks / Trade-offs

- **Concurrent spawns in the same cwd** (rapid double-send, or worktree auto-init) →
  if a legacy server omits the `requestId` echo, the pathKey fallback could navigate
  to the wrong session. Mitigation: rely on Tier-1 requestId (present on current
  servers); debounce/disable the send button while a spawn from this page is in
  flight.
- **Draft + pasted-image loss on post-spawn navigation** (home page has no
  session-keyed draft store) → Mitigation: acceptable for v1; the text is consumed as
  `initialPrompt` so it is not "lost", and images are out of scope (Non-Goals).
- **Two empty surfaces** (`/` LandingPage vs `/folder/:enc` home) → Mitigation: D-note
  reconciliation — the folder home is folder-scoped and reached by an explicit open
  action; the root LandingPage stays the global onboarding. They do not render
  simultaneously.
- **No model choice at spawn** (D5 deferral) → Mitigation: v1 uses the default
  model; the follow-up adds the `spawn_session` `model` field. Acceptable because
  the model is changeable inside the session immediately after it opens.

## Migration Plan

Purely additive client change. New route + component + one sidebar affordance. No
data migration, no persisted-format change, no server deploy. Rollback = revert the
client change; existing `/folder/:enc/*` routes and spawn flow are untouched.

## Open Questions

- Q0 (follow-up change, not this one): the `spawn_session` `model` field + picker.
- Q1 (deferred to implementation): exact placement/icon of the D3 "open" affordance
  on the pinned row (folder-icon click vs a dedicated button) — pick during build to
  match existing row density.
- Q2: when the folder is non-empty, is the centered prompt still vertically centered
  above the session list, or does it dock to the top once sessions exist? Proposed
  default: centered when empty, docked-top with the session list below when non-empty.
