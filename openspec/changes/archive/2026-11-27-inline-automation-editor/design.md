# Design: inline-automation-editor

## Context

See proposal.md (Why). Current state:

- The board mounts the editor as a sibling of the card list, twice: create and edit (`packages/automation-plugin/src/client/AutomationBoard.tsx:305-318`). The editor's root is a hand-built modal shell `fixed inset-0 z-50 … bg-black/40` with a `max-w-lg` card that closes on backdrop click; it has no Esc handler (`packages/automation-plugin/src/client/CreateAutomationDialog.tsx:500-508`). It takes `onClose` and `onCreated` (`AutomationBoard.tsx:306`, `:311-312`).
- `openEditor` awaits `getAutomationDefinition` before mounting the editor (`AutomationBoard.tsx:186-200`). Edit and the name open section `identity`; the trigger summary opens `trigger` (`AutomationBoard.tsx:490-500`, `:530`, `:600-611`). The section effect scrolls/focuses the section and silently no-ops when the section ref is missing (`CreateAutomationDialog.tsx:388-398`).
- Editor state, validation (`submitDisabled`), the dirty count (`draftFields`, 20 values, baseline frozen on first render via `initialDraft.current ??=`) live in the component (`CreateAutomationDialog.tsx:366-416`). A post-mount effect flips `mode: worktree` to `local` when the folder is not git-capable (`CreateAutomationDialog.tsx:361`), after the baseline is frozen. `submit()` builds the config from form fields only (`CreateAutomationDialog.tsx:424-490`), so Save drops every key the form does not own: `disabled` (a disabled automation is re-armed) and `maxConcurrentSpawns` (`packages/automation-plugin/src/shared/automation-types.ts:110-130`). The only vertical scroller inside the editor is the modal card itself (`:507`).
- 21 controls carry `className="input…"`, and `packages/flows-plugin/src/client/FlowInputWiring.tsx` (rendered inside the editor through `AutomationActionEditorSlot`) has 2 more. `packages/client/src/index.css` defines no `.input` (its `@utility` blocks are `text-code`, `z-*`, `tint-action-*`, `tap-target`), so in the dashboard they render unstyled.
- Each card `<li>` selects on click (`AutomationBoard.tsx:468-474`) and is `overflow-hidden` so the selected header's `-mx-3 -mt-3` bleed and the rail stay inside `rounded-xl` (`:471-486`).
- The board root is the overlay's single vertical scroller with a `sticky top-0 z-10` header (`AutomationBoard.tsx:278-279`); the main spec requires exactly one scroller and Back staying visible (`openspec/specs/automation-content-view/spec.md:371-408`; probe `tests/e2e/overlay-layout.spec.ts:927-936`). Back calls the shell `onBack`; the spec forbids plugin-local back logic (`spec.md:253`).
- The folder actions menu "New automation" item opens the dialog in the sidebar via a lazy import (`packages/automation-plugin/src/client/FolderAutomationSection.tsx:33-35`, `:64-76`, `:109-117`).
- Ratchets keyed on the file name: `scripts/settings-kit-baseline.json:11-13` (`CreateAutomationDialog.tsx::checkbox|muted-text|select`) and `packages/client/src/lib/__tests__/aligned-surfaces-no-literals.test.ts:44`.
- E2E hooks on the modal: `tests/e2e/overlay-layout.spec.ts:1014-1043` (F3) and `tests/e2e/ui-token-alignment.spec.ts:441-467` (`editor-subtitle`, `max-w-lg` ancestor, `create-name-locked`, `create-file-path-help`, `armed-chip`, Esc).
- Approved mock: `mockups/2026-11-25-automation-inline-editor/mock.tsx` (variant A). The mock's per-field "Changed" pills are not built (scope cut, below).

## Goals / Non-Goals

**Goals:**
- One editor component, rendered inline in a card, for create and edit.
- Exactly one open editor per board; in-board actions never drop dirty edits without a prompt.
- Same save payloads and validation as today, except keys the form does not own (`disabled`, `maxConcurrentSpawns`) are carried through Save.
- Editor text controls render with a visible, token-styled border.

**Non-Goals:**
- No server / API / on-disk format change; no new trigger or action kinds.
- **No field-family migration** and no per-field "Changed" markers: controls keep their markup and today's whole-editor unsaved count. Moving to the runtime field family is a later change.
- **Leaving the board discards an open editor without a prompt**: board Back (stays plain `onBack`), sidebar navigation to another route, folder switch, browser Back, tab close. The folder menu "New automation" item for the same folder is in-board (it lands on this board) and is guarded.
- No Esc handling (none exists today). The host's overlay dismiss guard (`packages/client/src/components/overlay/RouteBackedOverlay.tsx:75-90`) is not exported to plugins; exporting it is a runtime API change for a later change.
- The action picker keeps today's grouping, filter and markup; its pre-existing WAI-ARIA listbox/combobox gap (`openspec/specs/automation-action-registry/spec.md:149-151`) stays a known gap. Registry and flow-input-wiring specs keep the word "dialog" for the editor.
- Variant B (list + detail) is not built.

## Decisions

### D1. Split the dialog into `AutomationEditor` (body) and drop the shell

`CreateAutomationDialog.tsx` → `AutomationEditor.tsx` (git mv): same state, validation and submit, minus the overlay shell and title. Props: `onClose`; `onCreated` → `onSaved(outcome: "save" | "switch")`, fired after a successful create/update; new `onDirtyChange(count)`; new `guard: { count: number; closing: boolean } | null` plus `onDiscard()`, which the editor renders in its save bar. Submit starts from `initialConfig` and overlays the form's fields, so keys the form does not own survive. The form renders disabled (loading line) until the git probe has settled and the `worktree → local` correction has applied in the same effect; that effect then sets `baselineReady` and freezes the baseline, so an untouched editor reports 0 changes and no edit can precede the freeze. The board renders it with `key={cwd + editor.key}`.
*Alternative:* keep the dialog with an `inline` prop. Rejected: two layouts in one 1.3k-line file and the modal path has no caller left.

### D2. Board owns a single `editor` state and the in-board guard

`editor: { key: "scope:name" | "new"; section: EditorSection; status: "loading" | "ready" | "error"; dirty: number; guardFor?: Next; opener: HTMLElement | null } | null`. Every in-board open, switch or close goes through `requestEditor(next | null)`: card Edit / name / trigger summary, + Create (header and empty state), the folder menu `?new=1` (D5), Close editor, Cancel.
- clean → apply now; dirty → set `guardFor = next`, the editor shows the guard (Discard / Save & switch, or Save & close when `next` is null). Discard applies `guardFor`. Save & switch → `onSaved("switch")` applies `guardFor` without re-checking dirty; a failed save keeps edits and the error.
- Applying an edit request sets `status: "loading"` and fetches the definition; the card shows a loading line in the editor area; a newer request supersedes it (last wins); a failed fetch shows an inline error with Retry and Close.
- `opener` is the control that requested the editor now open (`?new=1`: + Create). On close focus returns to it if connected, else to + Create.
- A request for the editor that is already open (name, trigger summary, + Create or `?new=1` while the draft is open) is a no-op apart from focusing the requested section; it never raises the guard or remounts.
- `editor` resets on `cwd` change. The open editor survives successful mutation refreshes (they revalidate in place, `AutomationBoard.tsx:111-112`) and closes when a refresh no longer lists its card, when the user deletes that card, or when a failed refresh clears the list (main spec "Failed reload clears the list"). The draft renders above the list section, outside its loading/error swap.

### D3. Card anatomy while editing

The editing card is the selected card. It keeps rail, header, summary, Stop and the orphaned-run notice. Edit reads **Close editor** (`aria-expanded="true"`). Run now and Disable hide while editing at every width (avoids a Disable-then-Save race on the same config). The last-run line and run history hide while editing and return on close. The editor wrapper stops click propagation so clicks inside it do not re-select the card. The card swaps `overflow-hidden` for `overflow-clip`: it still clips the header bleed and rail to `rounded-xl` but is not a scroll container, so the sticky save bar binds to the board root.
*Alternative:* drop the clip while editing. Rejected: the bleed and rail escape the rounded corners.

### D4. Layout: container query, one scroller

The editor body is `@container`; two columns (`minmax(0,1fr) minmax(0,1.5fr)`) only at `@3xl`, one column otherwise, because the board width depends on the sidebar. Every grid track is `minmax(0,…)` and grid children carry `min-w-0`. Action ids and descriptions use `break-words` / `overflow-wrap:anywhere`. Textareas (prompt, multiline payload) auto-grow to their content with `overflow-y: hidden`, so the board root stays the only vertical scroller with an editor open. Floating surfaces inside (model picker, popovers) already portal to `document.body`, so the container's containing block does not trap them.

### D5. `?new=1` is consumed on open

The folder menu "New automation" item calls `setLocation('/folder/<enc>/automations?new=1')`. The board reads `useSearch()` (wouter v3; peer `^3.9.0`). When `new=1` is present and the list is `ready` (including empty) it calls `requestEditor({ key: "new", section: "identity" })` and strips the param with a `replace` navigation in the same tick, so history never holds `?new=1`. While `loading` the param waits; on `error` it is stripped and the error state shows; with `invalidRoute` it is ignored. On an empty folder the explainer stays and the draft renders below it.
*Alternative:* a dedicated `/automations/new` route. Rejected: a new overlay claim and depth bookkeeping for board-local state.

### D6. A token-styled host `.input` class

`packages/client/src/index.css` gains `@layer components { :where(.input) { … } }` (zero specificity, so any app's own `.input`, e.g. `packages/team-app/src/styles/app.css:165`, wins where both load) built from tokens only: `--border-secondary` border, `--bg-tertiary` fill, `--text-primary` text, `rounded`, `px-2 py-1`, `text-sm`, focus ring via the existing `focus-ring` look, `aria-[invalid=true]` → `--severity-error-border`, disabled → reduced opacity. It applies to `input`, `select` and `textarea`. Plugins already rely on host global classes by name (FX classes), so automation and flows controls are fixed without markup changes. `.input` inherits `width: auto`; full-width call sites keep their `w-full`.
*Alternative:* migrate to the runtime field family. Deferred (Non-Goals): needs kit changes (`min`, stacked select, exported control classes), authored hints and per-control dirty tracking.

### D7. Save bar and read-only identity

`position: sticky; bottom: 0` inside the card, `z-[5]` (below the header's `z-10`). It shows the write target (`folder · <cwd>/.pi/automation/<name>/…` or `global · ~/.pi/automation/<name>/…`, `<name>` while the name is empty), the existing `aria-live` unsaved count, any error, the guard, Cancel and Save (edit; disabled when the count is 0 or `submitDisabled`) or Create with "Arms on create · next run …" (create). Every editor button (save bar, guard, Close editor, raw-cron toggle, add/remove action, Advanced toggle, picker rows) is ≥ 44 px below `sm` and ≥ 32 px from `sm` up with `focus-ring`; the caption, guard text and "+N coming soon" chip are ≥ 12 px in `--text-secondary`. In edit mode name and scope show only in the card header, the "Name is locked" note and the Identity group are dropped, and Edit / name open on section `trigger` (focus on its first control). The next-run preview keeps its pulsing dot.

### D8. Phone trigger pills

Below `sm`, planned trigger categories are hidden and one non-interactive "+N coming soon" chip replaces them; enabled categories keep 44 px targets.

## Risks / Trade-offs

- [Unsaved edits lost when leaving the board] → accepted Non-Goal; the save bar's live unsaved count makes the state visible.
- [A failed board refresh clears the list and the open editor with it] → accepted: needs a server/network failure during editing; the board's error state is shown.
- [A global `.input` rule restyles another surface that uses the class] → `rg 'className="input' packages/client packages/*-plugin` before landing; only automation + flows use it today; the zero-specificity `:where()` lets team-app's own rule win if both stylesheets ever load together.
- [Removing the `CreateAutomationDialog` export breaks an out-of-repo importer] → not a manifest claim, no in-repo importer; CHANGELOG notes it as BREAKING.
- [`useSearch` missing or not updating in the overlay route] → L1 test drives `?new=1` through the real board in a wouter memory location; L3 drives it from the folder menu. If 3.9.0 lacks it, raise the peer floor.
- [`overflow-clip`] → supported in every target browser (Chromium 90+, Safari 16+, Firefox 81+).
- [Long editor pushes other cards down] → variant A trade-off; closing restores the list.
- [Ratchets keyed on the old file name] → move the three `settings-kit-baseline.json` keys and the `aligned-surfaces-no-literals.test.ts` path to `AutomationEditor.tsx` with unchanged counts.
- [Main spec board `depth: 1` vs manifest `depth: 2`] → pre-existing drift, untouched: `?new=1` only changes the search string of the same route.

## Migration Plan

Client + plugin change; ships with the next release. Rollback = revert the commit. No data migration.

## Test ids

Kept: every control and section id (`create-*`, `group-*`, `edit-*`, `run-now-*`, `automation-*`). Dropped with their elements: `create-automation-dialog`, `editor-subtitle`, `armed-chip`, `create-name-locked`, `editor-footer-caption`. Added: `automation-editor-<key>` (editor root), `automation-draft` (draft card), `editor-save-bar`, `editor-write-path`, `editor-guard`, `editor-guard-discard`, `editor-guard-save`.

