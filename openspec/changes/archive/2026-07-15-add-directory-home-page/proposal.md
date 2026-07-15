## Why

Selecting a pinned directory in the sidebar has no dedicated landing surface — a
folder only "exists" in the UI through the sessions nested under it. New users who
do not yet understand pi's session model have no obvious "start here" entry point:
they must first find and click a spawn (+Session) affordance before they can type
anything. A directory home page with a vertically-centered prompt gives every
pinned folder a familiar, chat-like front door ("type here to start"), so a session
becomes a by-product of chatting rather than a prerequisite.

The spawn-with-initial-prompt transport this depends on is **already shipped**
(`spawn_session { cwd, initialPrompt }` → `pending-initial-prompt-registry`
dispatch after `session_register`; see archived `project-init-skill-and-profiles`),
so the send→create-session path needs no protocol or server work. This is a
**strictly client-only** surface in v1.

## What Changes

- Add a **directory home page** at a new bare route `/folder/:encodedCwd` — the
  index surface for a directory. No such route exists today (only
  `/folder/:encodedCwd/{terminals,editor,settings,openspec,pi-resources,view}`).
  wouter uses independent `useRoute()` hooks with **segment-exact matching**
  (`[^/]+?` never crosses `/`), so the bare pattern cannot match the deeper ones —
  the work is adding a `useRoute("/folder/:encodedCwd")` match and a render branch
  into **both** the desktop and mobile route ternaries in `App.tsx`, not managing
  declaration order.
- **Pinned directories become selectable**: add a **new, distinct "open" affordance**
  on the pinned-directory sidebar row that navigates to `/folder/:encodedCwd`.
  This is NOT the folder-name text — today the whole name row is already the
  collapse toggle (`onClick={handleToggleCollapse}` in `SessionList.tsx`), so
  reusing it would destroy the existing collapse gesture. The new affordance must
  sit outside the drag-handle listener (or `stopPropagation`) to avoid reorder
  conflicts.
- The home page renders a **vertically-centered prompt** built on the existing
  `CommandInput` **presentation**, wrapped in a **spawn-mode adapter**: its `onSend`
  does not send into a session (there is none) — it spawns one. `CommandInput` is
  NOT reused unchanged; the home page supplies its own local draft state and passes
  no `selectedId`. Alongside the prompt: a **folder-name header**, a **list of that
  folder's existing sessions**, and **quick actions** linking to the folder's
  terminals / editor / settings routes.
- **Model picker is DEFERRED to a follow-up.** v1 spawns with pi's default model.
  Rationale (verified against source): `pi.setModel()` is process-local
  (`extension/src/bridge.ts`) and a spawned session is a new process;
  `spawnPiSession` has no `model` parameter, so a picker cannot set the new
  session's model without adding a `model` field to the `spawn_session` transport
  (a server/protocol change). Keeping v1 client-only, the picker is out of scope
  and tracked separately.
- **On send**: spawn a session in that directory via
  `handleSpawnSession(cwd, undefined, { initialPrompt: <typed text> })` (correct
  3-arg form — the 2nd positional arg is `attachProposal`), then navigate to
  `/session/:newId` when the spawn correlates. Navigation reuses the existing
  Tier-1 `requestId` → `session_added` correlation in `useMessageHandler`; the
  design notes the concurrent-spawn edge (two spawns in the same cwd) that the
  weaker pathKey fallback could mis-route.
- The home page **doubles as the folder's empty state** (empty → centered prompt is
  the focal point; non-empty → prompt stays, existing-session list shown alongside).
  Design reconciles this with the existing root `/` `LandingPage` empty surface so
  the two do not present conflicting "start here" UX.
- **Scope: pinned directories only.** Because `/folder/:encodedCwd` is cwd-generic
  and the sidebar's `renderGroup` is shared by pinned, unpinned, AND workspace
  folders, the page needs an **explicit pinned-directory guard**: a non-pinned cwd
  reached by direct URL redirects (or shows a generic not-pinned state) rather than
  silently rendering. The "open" affordance is added on pinned rows only.

## Capabilities

### New Capabilities

- `directory-home-page`: A bare `/folder/:encodedCwd` route (desktop + mobile)
  rendering a directory landing surface for **pinned** directories — a
  vertically-centered `CommandInput`-based prompt whose send spawns a session with
  the typed text as `initialPrompt` and navigates to it, plus a folder header,
  existing-session list, and quick actions. Guards against non-pinned cwds and
  reconciles with the root `LandingPage` empty state. (Model picker deferred.)

### Modified Capabilities

_(none — the sidebar "open" affordance is additive and distinct from the existing
collapse toggle owned by `collapsible-groups` / `accordion-workspace-folders`; no
existing capability's requirements change.)_

## Impact

- **Client (new)**: `packages/client/src/components/DirectoryHomeView.tsx` — the home
  surface, owning local draft state, the spawn-mode `onSend` adapter, the pinned
  guard, and the model-picker→global-set-model wiring.
- **Client (routing)**: `packages/client/src/App.tsx` — `useRoute("/folder/:encodedCwd")`
  match + a render branch in **both** the desktop and mobile route chains; mobile
  back-depth handling for the new surface.
- **Client (sidebar)**: `packages/client/src/components/SessionList.tsx` (shared
  `renderGroup`) + the pinned-directory row — add a distinct "open" affordance
  (not the collapse-toggle name row, outside the drag handle).
- **Reused, unchanged transport**: `spawn_session { initialPrompt }` +
  `pending-initial-prompt-registry`; `pendingSpawnsRef` Tier-1 requestId
  auto-select/navigate correlation; `encodeFolderPath` / `decodeFolderPath`;
  the folder terminals/editor/settings route-builders.
- **Reused with a wrapper**: `handleSpawnSession` (3-arg form);
  `CommandInput` presentation (spawn-mode adapter, no `selectedId`, model selector
  omitted in v1).
- **No server / bridge / protocol changes** — v1 is strictly client-only.
- **Tests**: L1 unit for the spawn-mode adapter (correct `handleSpawnSession`
  args, initialPrompt passthrough), the pinned guard, and empty-vs-populated
  rendering; L3 e2e for click-open-folder → type → send → lands in the new session.

## Discipline Skills

- `doubt-driven-review` — the route wiring (dual desktop/mobile chains), the
  spawn→navigate correlation under concurrency, and the shared-`renderGroup` scope
  guard are the load-bearing, easy-to-get-wrong decisions; review before they stand.
