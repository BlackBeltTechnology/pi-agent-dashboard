## Context

`FolderOpenSpecSection` (`packages/client/src/components/FolderOpenSpecSection.tsx`) renders one row per change in the folder's expanded change list, currently of the shape:

```
add-auth   [s1] [s2]   3/8 tasks   [P D T S]
                       ─────────   ───────────
                       static      ArtifactLettersButton
                       text span   (clickable)
```

`TasksPopover` (`packages/client/src/components/TasksPopover.tsx`) is already a drop-in component that takes `{ cwd, change, onClose }`, fetches tasks via `/api/openspec/tasks`, optimistic-toggles via `/api/openspec/tasks/toggle`, refetches on 409. Session cards mount it from `SessionOpenSpecActions.tsx`.

`spawn_session` (`packages/shared/src/browser-protocol.ts`) carries only `{ type, cwd }` and is handled in `session-action-handler.ts → handleSpawnSession`, which awaits `spawnPiSession(cwd, …)` and returns a `spawn_result`. The new pi process boots independently and the bridge later issues `session_register` over the pi-gateway WebSocket — that is when `sessionManager.register(...)` runs in `pi-gateway.ts` (around line 277). The browser only learns about the new session through the subsequent `session_updated`/`session_added` broadcast.

`handleAttachProposal` (`session-meta-handler.ts`) already encapsulates the idempotent auto-rename rule via `attachRenameTarget(session, changeName)`. We will reuse it verbatim — the new flow is purely about *when* it fires, not *how*.

## Goals / Non-Goals

**Goals:**
- One-click toggle of any task on any change visible in the folder card, without first attaching to a session.
- One-click spawn-and-attach for a specific change, with no observable "unattached then attached" intermediate state in the UI.
- Zero new HTTP routes. Zero new WebSocket message types. Backward-compatible protocol extension.
- Reuse `TasksPopover` and `attachRenameTarget` verbatim — no parallel logic.

**Non-Goals:**
- Implicit attach when the bare `+Session` button is clicked. Bare spawn stays bare.
- Auto-attaching to the *only in-progress* proposal in a folder. Explicit selection only.
- Per-folder "remember last attach intent" preference. Future work, captured as an open question.
- Surfacing the spawn-with-attach button on mobile in this change. The desktop folder card is the only entry point initially; mobile follows in a separate change if validated.

## Decisions

### Decision 1: Server-side intent (over client-side latch)

When the user clicks "spawn with this change attached", the browser sends `spawn_session` with an optional `attachProposal: <name>` field. The server stores `(cwd, changeName)` in an in-memory FIFO queue keyed by `cwd`. When the next `session_register` arrives in `pi-gateway.ts` for that `cwd`, the server pops one entry and runs the existing `handleAttachProposal` logic with the resolved `sessionId`.

**Alternatives considered:**
- **Client-side latch.** Client stores `pendingAttachByCwd`; on incoming `session_added` whose `cwd` matches, fires `attach_proposal`. Rejected: extra round-trip (visible "unattached" flash on the session card), races if two concurrent spawns target the same cwd before either registers, and split-brain across multiple browser tabs.
- **Pass `attachProposal` through `spawnPiSession` → CLI flag → bridge → `session_register`.** Rejected: requires plumbing through pi's CLI surface (`session_register` is sent by the bridge inside the spawned pi process, which we don't own end-to-end), and would not work for tmux/wt strategies where the actual session start is asynchronous.

**Why server-side wins:** the server is already the rendezvous point for the spawn (it issued the spawn, holds the pi-gateway connection, and runs `sessionManager.register`). The intent never leaves the server's memory; pop-on-register is atomic with the broadcast.

### Decision 2: FIFO consume-once map keyed by `cwd`

`pendingAttachByCwd: Map<string, string[]>` — value is a queue (array) of pending change names. On `spawn_session` with `attachProposal`, push to the queue. On `session_register` for that `cwd`, shift the head. If the queue is empty, no attach happens.

**Why a queue, not a single value:** multiple concurrent spawn-with-attach requests for the same cwd are rare but legal (e.g., user clicks two different changes in fast succession). A queue preserves intent ordering instead of overwriting.

**Why not key by spawn-id:** there is no client-visible spawn-id today — `spawn_session` returns `spawn_result { cwd, success, message }`. Adding a spawn-id is more surface area than the feature warrants.

**Bounded growth:** the queue is bounded only by user clicks; we add a cap of 8 entries per cwd (silently drop further enqueues with a server-side warning). In practice users never queue more than 1–2.

**Stale-intent expiry:** entries older than 60 s are dropped on the next access. A failed spawn (no register ever arrives) otherwise leaves a permanent intent that would attach the *next* spawn to the wrong proposal — an annoying foot-gun. 60 s comfortably covers tmux/wt boot + bridge connect; if it expires, the user re-clicks.

### Decision 3: Reuse `attachRenameTarget`, do not duplicate

The pop-on-register path calls the same helpers as `handleAttachProposal`:

```
sessionManager.update(sessionId, { attachedProposal: changeName, name: newName? })
piGateway.sendToSession(sessionId, { type: "rename_session", ... }) // if newName
broadcast({ type: "session_updated", sessionId, updates })
```

`attachRenameTarget` already returns `undefined` when the session has a non-empty user-set name, so the auto-rename remains opt-in by emptiness. New sessions register with the bridge's default name (which `attachRenameTarget` treats as empty/witness), so the rename does fire as expected.

### Decision 4: Task-count button is a button, not a link

The `{n}/{m} tasks` indicator becomes a `<button>` (semantic, keyboard-accessible). It still right-aligns via `ml-auto`. Click stops propagation so the surrounding folder click handlers stay intact (the section already uses `onClick={(e) => e.stopPropagation()}`). Hover styling matches the existing `ArtifactLettersButton` neighbour.

When `totalTasks === 0`, the indicator stays as it is today (an empty `ml-auto` spacer) — there are no tasks to toggle.

### Decision 5: Spawn-with-attach button placement and icon

A small `mdiPlay` (or `mdiPlusBoxOutline`) icon button immediately after the artifact letters button, sized matching neighbours. `title="Spawn session attached to this change"` tooltip. `data-testid="spawn-attached-btn"`.

The button delegates to a new prop `onSpawnAttached?: (cwd: string, changeName: string) => void` so `FolderOpenSpecSection` stays a presentational component. The wiring in `App.tsx` calls the same `sendMessage` path used by `+Session`, with the new optional field set.

When `onSpawnAttached` is not provided, the button is hidden — same gating pattern used by `onOpenSpecs` / `onOpenArchive` / `onNavigateToSession`.

## Risks / Trade-offs

- **Stale intent attaches to the wrong session.** A spawn fails silently and the next unrelated spawn (within 60 s) inherits the intent. Mitigation: 60 s TTL + per-cwd queue cap of 8. Detection: server logs a warning whenever an intent expires unconsumed.
- **Concurrent register from a *different* spawn at the same cwd.** Two users / tabs spawn in the same cwd around the same time; our queue is FIFO so the second register pops the first user's intent. Mitigation: this is functionally identical to the user attaching the wrong proposal manually — recoverable via the existing detach UI. We accept this; the alternative (spawn-id correlation) is heavier.
- **`session_register` uses a different `cwd` string than the client sent.** Path normalization mismatches (trailing slash, symlink, case on macOS). Mitigation: normalize both keys via `realpathSync`/`normalizePath` before lookup, mirroring what `directory-service.ts` already does for openspec polling.
- **Unknown protocol field on old servers.** A new client talking to an old server that ignores `attachProposal` would spawn unattached. Mitigation: this is acceptable degraded behaviour (user sees an unattached session and can attach manually). The client does not depend on a server ack for the attach intent.

## Migration Plan

- **Forward compat:** server accepts the new field; old clients omit it; behaviour identical.
- **Backward compat:** new client → old server: the field is ignored, spawn happens, no attach. User sees the same outcome as the bare `+Session` button.
- **Rollback:** revert the change; pending-attach map is in-memory only and clears on restart.

## Open Questions

- Should the spawn-with-attach button respect a per-folder default ("attach default: <change>") shown alongside the bare `+Session` button? Out of scope here; capture as a follow-up if user-tested.
- Should the popover refresh `data` in the parent when a toggle succeeds, or rely on the next 5 s openspec poll tick? The popover already broadcasts an `openspec_update` server-side on toggle, so the folder section updates automatically — no client-side coordination needed.
- Mobile parity: do we add the same buttons in `MobileActionMenu` for the proposal context, or leave mobile to the next change? Decision: leave to a follow-up; this change is desktop-only.
