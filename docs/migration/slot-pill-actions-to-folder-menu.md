# Migration: SlotPill actions → folder actions menu

## Overview

Breaking plugin-API change, `move-slot-actions-to-menu`.

`SlotPill.actions?: ReactNode` REMOVED from `packages/dashboard-plugin-runtime/src/SlotPill.tsx`.

Compile-time break. No runtime shim. Prop not silently ignored — TypeScript rejects it.

Slot actions now declarative items contributed to the folder actions menu.

## Replacement

Exported from `@blackbelt-technology/dashboard-plugin-runtime`:

| Export | Kind | Role |
|---|---|---|
| `useFolderMenuItem(scope, contribution)` | hook | Registers one menu item while mounted |
| `useFolderMenuRefresher(scope, refresh)` | hook | Registers refresh callback, no item of its own |
| `FolderMenuContribution` | type | Declarative item shape |
| `FolderMenuGroup` | type | Group id union |
| `FOLDER_MENU_GROUPS` | const | Group ids, render order |

Source: `packages/dashboard-plugin-runtime/src/folder-menu-contributions.tsx`.

## Contribution shape

```ts
interface FolderMenuContribution {
  id: string;              // required — stable; test id `folder-menu-item-<id>`
  group: FolderMenuGroup;  // required
  label: string;           // required
  icon: string;            // required — mdi path string
  onSelect: () => void;    // required
  badge?: string;          // state marker, folded into accessible name
  disabled?: boolean;      // renders disabled; callback never invoked
}
```

No `node`. No `pressed` — host-only (`FolderMenuItem` keeps `pressed` for `aria-pressed`, e.g. urgency sort).

## Group taxonomy

`workspace | directory | create | open | maintenance`.

Grouping by verb, never one group per plugin.

Unknown group → item DROPPED. Version mismatch; no ungrouped fallback home.

Missing required field → item skipped. Siblings unaffected.

## Scope

`scope` = folder cwd.

Pass `null` when section renders in placement with no folder actions menu. Example: `placement === "card"` (worktree-card placement). `null` scope registers nothing — no stranded items.

## Identity and ordering

`pluginId` stamped by registry from plugin context (`useCurrentPluginId`). NOT from payload — plugin cannot declare itself as another.

Within a group: host items first, then contributions by `pluginId`, then by `id`.

Same `id` from two plugins → lower `pluginId` wins. Load-order independent.

Same `(pluginId, id)` re-registered → latest wins; live callback never dropped. Development double-mount safe.

Unmount deregisters.

## Refresher fan-out

`useFolderMenuRefresher` contributes callback only, no item.

Host renders single `MAINTENANCE` refresh item. Item calls `useFolderMenuRefreshRunner()` → `runRefreshers(scope)`.

One throwing refresher does not stop the rest (`console.error("[folder-menu] refresher threw:", err)`).

## Worked example — goal plugin

Real diff shape: `packages/goal-plugin/src/client/FolderGoalsSection.tsx`.

Before:

```tsx
<SlotPill
  onActivate={() => navigate(goalsBoardUrl(cwd))}
  actions={
    <>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); refetch(); }}
        data-testid="folder-goals-refresh"
      >
        <Icon path={mdiRefresh} size={0.5} />
      </button>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setCreating(true); }}
        data-testid="folder-goal-new-btn"
      >
        <Icon path={mdiPlus} size={0.5} />
      </button>
    </>
  }
>
  <span data-testid="folder-goals-count">{goals.length}</span>
</SlotPill>
```

After:

```tsx
const newGoalLabel = t("goalButton", undefined, "New goal");
useFolderMenuItem(
  cwd,
  useMemo(
    () => ({
      id: "new-goal",
      group: "create" as const,
      label: newGoalLabel,
      icon: mdiPlus,
      onSelect: () => setCreating(true),
    }),
    [newGoalLabel],
  ),
);
useFolderMenuRefresher(cwd, refetch);

<SlotPill
  onActivate={() => navigate(goalsBoardUrl(cwd))}
>
  <span data-testid="folder-goals-count">{goals.length}</span>
</SlotPill>
```

`+ Goal` button → `create`-group `useFolderMenuItem`.

`refetch` → `useFolderMenuRefresher`.

Wrap contribution in `useMemo` keyed on rendered fields; state-driven `label`/`badge`/`disabled` change reaches open menu without re-register churn. `onSelect` read through ref — current closure always invoked.

## Rationale

Host cannot group, order, keyboard-navigate, or mobile-adapt opaque nodes.

Nested real `<button>` inside `role="button"` pill = ARIA anti-pattern.

## What stays

Pill renders no controls.

State markers that are FACTS, not controls, stay as children — KB pill `⚠ N stale`.

## See change

`move-slot-actions-to-menu` (folder-actions-menu spec).
