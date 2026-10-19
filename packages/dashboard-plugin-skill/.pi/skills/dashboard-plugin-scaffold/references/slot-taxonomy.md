# Slot Taxonomy

The 23 React-accepting slots a dashboard plugin can claim. Frozen for v0.x. The source of truth is `SLOT_DEFINITIONS` in `packages/shared/src/dashboard-plugin/slot-types.ts`; this table mirrors its ids (docs only, no taxonomy change).

For the full slot table including descriptor-only slots (`management-modal`, `footer-segment`, `agent-metric`, `breadcrumb`, `gate`, `toast`, `rjsf-form`), see the archived design at `openspec/changes/archive/2026-04-26-dashboard-plugin-architecture/design.md` § "Slot taxonomy".

| Slot id | Multiplicity | Lifetime | When to use |
|---|---|---|---|
| `sidebar-folder-section` | many per folder | persistent | Collapsible block above the session list per workspace folder. Use for folder-scoped tools (e.g. OpenSpec change browser per folder). |
| `session-card-badge` | many per session | persistent | Compact info chip in the session card header. Use for at-a-glance status (e.g. OpenSpec activity badge, flow activity badge). |
| `session-card-action-bar` | many per session | persistent | Action buttons in the session card footer. Use for per-session actions (e.g. attach proposal, launch flow). |
| `content-view` | one active per session | persistent | Full-screen content area replacing the chat view. Use for rich content browsers (e.g. archive browser, specs browser). Pair with a `command-route` claim. |
| `content-header-sticky` | many per session | persistent | Sticky element above the content view. Use for breadcrumbs, action bars (e.g. flow architect bar). |
| `content-inline-footer` | many per session | persistent | Inline element below the content view, above the chat input. Use for status summaries (e.g. flow summary). |
| `anchored-popover` | one at a time | one-shot | Popover anchored to a triggering UI element. Use for transient detail (e.g. tasks popover). |
| `command-route` | many globally | persistent | Maps a slash command (`/specs`) or URL route to a `content-view` claim. The `command` field names the slash command; the `component` field names the content-view component. |
| `settings-section` | many globally | persistent | A section in the dashboard's Settings page. Use for plugin config UI. Use `usePluginConfig<T>()` to read; `pluginRouter.send({ type: "plugin_config_write", id, config })` to write. |
| `tool-renderer` | many globally | persistent | A custom React component rendering `tool_call` events with a specific `toolName`. Use to give a tool richer rendering than the default tool card. The `toolName` field selects which tool. |
| `session-card-memory` | many per session | persistent | Contributions inside the MEMORY subcard of a session card. |
| `session-card-flows` | many per session | persistent | Contributions inside the FLOWS subcard of a session card. |
| `workspace-action-bar` | many per session | persistent | Action buttons inside the WORKSPACE subcard of a session card (git workspace tooling). |
| `worktree-card-section` | many per worktree card | persistent | Folder-scoped block inside a worktree session card, scoped to the worktree's own cwd (e.g. the KB row). |
| `composer-context-group` | many | persistent | Labelled context group in the chat composer's session-action strip, after the Git group and before the Status group. Read-only; not disabled while streaming. Pair with the runtime's `ComposerContextGroup` primitive. |
| `composer-panel` | many | persistent | Panel rendered below the chat composer input; receives a read-only draft (and language). |
| `shell-overlay-route` | many globally | persistent | Plugin-owned full-screen route mounted at the top of the shell (desktop and mobile). Each claim ships a wouter path pattern in `config.path` and a component receiving `{ params, onBack, session? }`. |
| `login-provider` | one active | persistent | Identity plane: a trusted resolver plugin supplies the browser login mechanics (OIDC discovery, PKCE, callback exchange). Component-only; core renders it before the shell. |
| `custom-entry-renderer` | many globally | persistent | Custom renderer for a chat custom entry, keyed by the entry's `customType`. |
| `automation-action-editor` | many globally | persistent | Custom payload editor for one automation action id (`config.actionId`), rendered by the create-automation dialog below the generic payload form. |
| `editor-pane-tab` | many globally | persistent | Editor-pane tab owned by a virtual-path prefix (`claim.pathPrefix`); an optional `labelComponent` renders in the tab strip and stays mounted for background tabs. |
| `resource-page-section` | many per resource page | persistent | Section above the resource grid on the folder and global resource pages (Skills, Agents, Extensions, Prompts, Themes); `claim.resourceType` restricts it to one page. |
| `shell-headless` | many globally | persistent | Always-mounted, zero-UI host for plugin-wide hooks (e.g. message subscriptions). Takes empty props, renders null, and must not declare a predicate. |

## Prop contracts

Every claimed component receives `SlotProps<SlotId>` from `@blackbelt-technology/pi-dashboard-shared`:

```ts
import type { SlotProps } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/slot-props";

// Example: a session-card-badge claim
export function MyBadge(props: SlotProps<"session-card-badge">) {
  // props.session: DashboardSession
  // props.pluginContext: PluginContext
  return <span>…</span>;
}

// Example: a content-view claim
export function MyView(props: SlotProps<"content-view">) {
  // props.session: DashboardSession
  // props.routeParams: Record<string, string>
  // props.pluginContext: PluginContext
  return <div>…</div>;
}
```

Refer to `packages/shared/src/dashboard-plugin/slot-props.ts` in the dashboard repo for the full prop type per slot.

## Multiplicity and ordering

- "one active per session" / "one at a time": the active route or most-recent show wins; collisions on the same key (route pattern, trigger id) are a load-time error.
- "many ...": all claims render. Order = `priority` (lower first), then alphabetical plugin id.

## Conflict examples

Two plugins claim `command-route` with `command: "/specs"` → load-time error, both plugins flagged failed via `/api/health.plugins[]`.

Two plugins claim `session-card-badge` → both render in priority order. No conflict.

Two plugins claim `content-view` with non-overlapping `command-route`s → both fine; the active route picks the winner per session.

## When in doubt

- Want to render an at-a-glance indicator? `session-card-badge`.
- Want to add an action button? `session-card-action-bar`.
- Want a full-screen view tied to a slash command? `content-view` + `command-route` (paired).
- Want to add to the Settings page? `settings-section`.
- Want a richer tool result card? `tool-renderer`.

If your need doesn't fit any of the 10 slots, the slot taxonomy is frozen — adding a new slot requires an OpenSpec change proposal against `dashboard-shell-slots`.
