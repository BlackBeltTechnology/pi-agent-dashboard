## Why

Users can now hide session-card sections, but the controls are coarse and incomplete: several switches govern more than one block (`openspec` hides both the subcard and the progress badge; `tags` leaks the OpenSpec phase chip; `status` hides Goals, Automations and Browser-relay badges together), the directory (folder) card has no switch at all, and the animated card gradients cannot be turned off. Users asked for (a) per-block control — e.g. "switch off just the Automations pill" or "turn off the animated gradient" — as normal settings, and (b) a one-click minimalist **Focus mode** that shows only the cards and the chat, like earlier versions.

This change replaces `focus-driven-folder-compaction` (never started; 0/46 tasks): its opt-in accordion folder list is folded in here, rebased on the current server-side collapse persistence, and becomes one of the things Focus mode can switch on.

## What Changes

- **Split coupled session-card switches** (each new id falls back to its legacy parent when unset, so existing stored preferences keep their meaning):
  - `openspec` → `openspec` (OPENSPEC subcard) + `openspec-badge` (phase / change / task-progress line, incl. the mobile attached-proposal chip).
  - `tags` → the tags strip no longer renders the OpenSpec phase pseudo-chip (phase is shown once, by `openspec-badge`).
  - `status` → one switch **per contributing plugin**: `badge-<pluginId>` (e.g. `badge-automation`, `badge-goal`, `badge-browser`); `status` remains as the parent fallback.
  - New per-plugin switch for the card footer slot: `actionbar-<pluginId>` (e.g. Goal control).
- **Make the directory card configurable** with the same tri-state model (global default + per-folder override, server-synced), new ids:
  - `folder-git` (branch/dirty row), `folder-banner` (setup/init call-to-action banner — hidden ⇒ compact warning chip when the folder is blocked, mirroring the PROCESS safety chip), `pill-<pluginId>` (plugin folder pills, e.g. `pill-automation`, `pill-goal`, `pill-kb`), `folder-openspec` (OpenSpec proposal-state section), `folder-create` (CREATE divider + spawn buttons, and the SESSIONS divider), `folder-ended` (ended-sessions expander).
- **Visual effects as standalone global settings** (independent of Focus mode): `fx-status-animation` (animated status gradients/stripes on cards) and `fx-selected-glow` (rotating glow ring on the selected card). Off ⇒ a static, flat status cue remains; status meaning is never lost.
- **Folder list mode** (from the replaced change): global `folderListMode: "classic" | "accordion"` (default `"classic"`) + `folderAttentionPeek`. Accordion: one focused folder renders fully; unfocused folders show only attention-demanding cards (or a "N sessions — click to view" row); a user can pin extra folders open.
- **Focus mode**: a server-synced on/off plus a **focus profile** — a sparse map of block / effect values plus an optional `folderListMode` — applied as an overlay with highest precedence (focus profile → folder override → global → visible). Turning Focus off restores the user's normal setup exactly. Ships with a built-in minimalist default profile (optional blocks hidden, both effects off, accordion on); "Save current as my focus profile" copies the current global values into the profile; the profile is editable in Settings. Toggle reachable from the sidebar header and Settings; safety chips (PROCESS, folder banner) still surface.
- Settings UI: the global "Session card sections" block and the per-folder "Session cards" page gain the new rows, grouped Session card / Directory card / Effects; plugin rows render only for installed plugins that contribute to that slot.

## Capabilities

### New Capabilities
- `focus-mode`: server-synced Focus toggle, focus profile overlay, built-in default profile, save-current-as-profile, and the toggle entry points.
- `card-visual-effects`: global switches for animated card status gradients and the selected-card glow ring, with the flat fallback cue.
- `folder-focus`: accordion folder list — folder list mode setting, active-folder derivation, header-click focus vs chevron collapse, user-pinned-open folders, render-mode resolution.

### Modified Capabilities
- `ask-user-card-indicator`: requirement restated in current stripe vocabulary (`card-input-stripes`) with the effects-off static tint; stale `card-input-pulse` CSS requirement removed (no such class exists).
- `ui-animation-energy`: with animated status effects off, the stripe overlay does not animate; a static tint replaces the gradient.
- `session-card-status`: the running / unread sweep requirements and their reduced-motion static indicators gain the effects-off static path; stale "ask_user pulse-only" requirement removed (superseded by stripes).
- `openspec-board-status-visuals`: board rows stay identical to cards with effects off (static tint).
- `session-card-selection`: with the glow effect off, the selected card shows only the static blue border + ring.
- `session-card-section-visibility`: toggleable set gains split session-card ids, per-plugin badge/action-bar ids and directory-card ids; resolution order gains the focus layer and legacy-parent fallback; settings pages gain directory-card and effects groups; folder-banner safety chip.
- `collapsible-groups`: chevron vs header-body click split and compact unfocused render apply in accordion mode; classic unchanged.
- `session-filtering`: attention predicate and unfocused-folder attention filter / compact-empty affordance (accordion mode only).

## Discipline Skills

- `security-hardening` — new browser→server preference messages (focus profile, expanded-folder set) carry untrusted input; reuse and extend the existing section-id / path / cap validation.
- `doubt-driven-review` — the preference-file shape and legacy-parent fallback are persisted contracts; review before they ship.
- `review-code` — non-trivial client change across `SessionCard`, `SessionList` and the plugin slot consumers.

## Impact

- **Shared**: `packages/shared/src/card-sections.ts` (ids, resolver with focus layer + parent fallback, per-plugin id helpers), `browser-protocol.ts` (focus-mode / focus-profile / expanded-folder messages; additive), `config.ts` (`folderListMode`, `folderAttentionPeek`, written through the existing `/api/config` PATCH path like `questionFirst`).
- **Server**: card-sections preference store (focus block, validation, caps), browser gateway routing, expanded-folder persistence next to collapsed folders.
- **Plugin runtime**: `packages/dashboard-plugin-runtime/src/slot-consumers.tsx` — badge, action-bar and folder-section consumers accept a per-plugin visibility filter.
- **Client**: `SessionCard.tsx`, `SessionList.tsx`, `CardSectionsContext.tsx`, `card-section-meta.ts`, `CardSectionsPage.tsx`, `settings/CardSectionsSection.tsx`, Settings → Sessions, `index.css` (`data-fx` effect gates), new `lib/folder-focus.ts`.
- **Protocol**: additive only. Older servers accept and store the new section ids (handler validates by id regex, `packages/server/src/browser-handlers/directory-handler.ts:208`; load keeps any valid id, `preferences-store.ts:400`) but drop `focus` / `expandedFolders` (snapshot rebuilds only `global` + `folders`, `preferences-store.ts:437`). Older clients ignore the new fields.
- **Supersedes**: `openspec/changes/focus-driven-folder-compaction` (removed).
