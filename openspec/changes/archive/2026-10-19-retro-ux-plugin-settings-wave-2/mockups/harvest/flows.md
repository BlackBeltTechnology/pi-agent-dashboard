# Harvest — flows (`packages/flows-plugin/src/client/FlowsSettings.tsx`, 68 lines)

## Purpose
Global default for pi-flows edit mode (`editFlow`): exposes `edit-flow` skill + `flow_agents`/`flow_write` tools to the main session.

## Structure
1. Root `<div>` (explicitly no self-header, comment `FlowsSettings.tsx:44`).
2. Intro `<p>` xs `--text-tertiary` mb-3: "Multi-agent workflow orchestration. Applies globally; sessions inherit this default." `:46-48` — hard-coded English (no `t()`).
3. Checkbox row `<label>` 13px: checkbox + `<span font-medium>` "Edit mode" + " — allow the main session to author flows & agents" + hint span `:49-65`.

## Fields
| label | control | key | hint | unit | validation |
|---|---|---|---|---|---|
| "Edit mode — allow the main session to author flows & agents" (only "Edit mode" via `t`) | native checkbox `mt-0.5` `:50-56` | `editFlow` (plugin config, dflt false) | "Activates `flow_agents` / `flow_write` and makes the edit-flow skill model-visible. Off by default." 11px `--text-muted` with `<code>` `:60-63` (not translated, not aria-describedby) | — | none |

## Status & read-only displays
None.

## Actions
None.

## Save model
Host Save bar: `useSettingsDraftSource({ id: "plugin:flows", isDirty, commit, reset })` `:41`; commit sends `plugin_config_write { editFlow }` `:37-39`. Note: commit writes ONLY `{ editFlow }` (drops any other config keys).
Draft init from `config.editFlow` once (`useState` `:28`) — no re-sync when config broadcast changes while clean (unlike subagents `:37`).

## States
- Single state; no loading/error. Dirty → host bar.

## Protected
- testid: `flows-edit-mode-toggle` (on input) `:55`.
- draft source id `plugin:flows`.
- i18n ns `plugin.flows.*` (`src/i18n.ts`): only `editModeLabel` used here.
- aria: none.

## Off-contract
- Hard-coded English: intro `:47`, label suffix `:59`, hint `:61-62`.
- `--text-tertiary` for intro `:46`; `--text-muted` for hint `:60`.
- Native checkbox not via kit `:50`; wrapping label, no htmlFor; hint not aria-describedby.
- Em-dash label concatenation " — allow…" `:59` (label + description jammed into one line).
- No hex/palette; uses `<code>` properly.

## Kit mapping
- Intro → intro text (custom) at `--text-secondary`.
- Checkbox → `ToggleField` label "Edit mode", hint = "Lets the main session author flows and agents. Activates `flow_agents` / `flow_write` and the edit-flow skill. Off by default." (code chips), `keyLabel="editFlow"` optional.
