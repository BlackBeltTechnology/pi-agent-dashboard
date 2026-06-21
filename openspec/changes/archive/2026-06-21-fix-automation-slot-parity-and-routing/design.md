## Context

Two sibling rows live in each folder card in `SessionList.tsx`:

```
folder card
  ├─ <SidebarFolderSectionSlot folder={{cwd}}/>   → plugin: FolderAutomationSection
  └─ <FolderOpenSpecSection .../>                  → first-class shell component
```

They were authored independently, so they diverge in both look and wiring.

## Decision 1 — Sidebar parity (re-skin, don't rebuild)

Mirror `FolderOpenSpecSection`'s proven markup rather than invent a new style. Target anatomy:

```
┌ folder card ───────────────────────────────────────────┐
│ ⚡ AUTOMATIONS (N) →     ⟳            [ + New ]          │  ← new (this change)
│    OPENSPEC (61) →       ⟳   [▤ Archive] [▤ Specs]      │  ← unchanged reference
└─────────────────────────────────────────────────────────┘
```

Concrete rules (copied from `FolderOpenSpecSection`):
- Title button: `text-[10px] font-semibold uppercase text-[var(--text-tertiary)] hover:text-blue-400`, content `AUTOMATIONS (N)` + `mdiArrowRight` (size 0.45).
- Refresh icon button: `mdiRefresh` size 0.5, `text-[var(--text-muted)] hover:text-[var(--text-secondary)]`.
- `flex-1` spacer, then right-aligned action chip(s).
- `+ New` chip styled like the blue convention chips: `text-[10px] px-1.5 py-0.5 rounded border text-blue-400 border-blue-500/40 bg-blue-500/5` (blue = run/play/add per sidebar color convention; green reserved for session spawn, purple for OpenSpec).
- Invalid count: keep `⚠ N` in `--danger` after the count.
- `onClick` handlers `stopPropagation()` (folder header row is itself a collapse trigger).

Keep the existing "render nothing until first load resolves, then always render even at N=0" behavior — the row doubles as the create entry point.

## Decision 2 — Routing: command-route → shell-overlay-route

`command-route` is retired. Evidence:
- `CommandRouteSlot` exists in `dashboard-plugin-runtime/src/slot-consumers.tsx` but `grep -rn CommandRouteSlot packages/client/src` returns nothing — never mounted.
- `flows-plugin/src/client/index.tsx` documents the retirement: *"FlowsCommandRoutes … no longer exported … Restore … if/when the dashboard re-introduces command-route."*
- Flows + OpenSpec board both render full-page UI via `shell-overlay-route` (wouter paths) which IS mounted: `App.tsx` renders `<ShellOverlayRouteSlot>` and `useShellOverlayRouteMatched`.

So claim the board as a `shell-overlay-route` with a wouter path, matching the OpenSpec board path shape:

```
OpenSpec board:  /folder/:encodedCwd/openspec
Automation board: /folder/:encodedCwd/automations   ← new claim
Automation run:   /automation/run/:sid              ← already shell-overlay-route, keep
```

Manifest claim change:
```jsonc
// before
{ "slot": "command-route", "component": "AutomationBoard", "command": "/automation" }
// after
{ "slot": "shell-overlay-route", "component": "AutomationBoard",
  "path": "/folder/:encodedCwd/automations" }
```

`AutomationBoard` currently reads `session?.cwd`. shell-overlay-route claims receive `routeParams` + `onBack` (not a `session`). So decode cwd from the param:

```ts
const cwd = routeParams?.encodedCwd
  ? decodeFolderPath(routeParams.encodedCwd) : undefined;
```

Use the shared `decodeFolderPath`/`encodeFolderPath` helpers (already used by OpenSpec routes) for symmetry. Sidebar navigates with the encoded form:

```ts
setLocation(`/folder/${encodeFolderPath(folder.cwd)}/automations`);
```

## Decision 3 — Page chrome

Wrap the board body in the same shell-overlay page chrome OpenSpec board uses (sticky title + back via `onBack`), so it presents as a full page, not an inline panel. The existing Definitions/Triage sections and `CreateAutomationDialog` are reused unchanged except for the cwd source.

## Alternatives considered

- **Re-mount `CommandRouteSlot` in the shell.** Rejected: revives a slot the project intentionally retired; larger blast radius than moving one claim to the live slot.
- **Make the sidebar row a custom non-OpenSpec style.** Rejected: the request is explicit parity; reusing OpenSpec's markup is less code and guarantees consistency.

## Risks

- Run-monitor deep link `/automation/run/:sid` is unaffected (already shell-overlay-route).
- Any external bookmark to `/automation` breaks — acceptable, the link never worked.
- `routeParams` prop shape for shell-overlay-route claims must be confirmed against `ShellOverlayRouteSlot` (param name `encodedCwd` must match the `path` template).
