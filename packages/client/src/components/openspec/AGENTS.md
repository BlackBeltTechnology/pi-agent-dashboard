# DOX — packages/client/src/components/openspec

Files in this directory. One row per source file. See change: fold-oversized-agents-directories.

| File | Purpose |
|------|---------|
| `ArchiveBrowserView.tsx` | Browser view for archived OpenSpec changes. Exports `ArchiveBrowserView`. → see `ArchiveBrowserView.tsx.AGENTS.md` |
| `ExploreDialog.tsx` | Modal dialog for OpenSpec Explore prompts. Textarea + `useImagePaste` for pasted images; `Cmd/Ctrl+Enter` sends `onSend(text, images?)`. Renders shared `ImagePreviewStrip`. Exports `ExploreDialog`. |
| `FolderOpenSpecSection.tsx` | Slim single-line navigation entry `OpenSpec (N) →` to board route + Refresh + Specs/Archive buttons. → see `FolderOpenSpecSection.tsx.AGENTS.md` |
| `NewChangeDialog.tsx` | Dialog launching `/skill:openspec-new-change`. Exports `NewChangeDialog`, `formatNewChangePrompt(name,… → see `NewChangeDialog.tsx.AGENTS.md` |
| `openspec-helpers.tsx` | Shared OpenSpec UI helpers. Exports `LETTER_MAP`, `artifactLetter(id)`, `statusColor(status)`,… → see `openspec-helpers.tsx.AGENTS.md` |
| `OpenSpecActivityBadge.tsx` | Session-card sub-badge showing active OpenSpec phase. Exports `OpenSpecActivityBadge`. → see `OpenSpecActivityBadge.tsx.AGENTS.md` |
| `OpenSpecArtifactDialog.tsx` | Non-mobile artifact reader in a flush full `Dialog` (URL unchanged). → see `OpenSpecArtifactDialog.tsx.AGENTS.md` |
| `OpenSpecBoardView.tsx` | Full-page OpenSpec kanban board. Route `/folder/:encodedCwd/openspec`. → see `OpenSpecBoardView.tsx.AGENTS.md` |
| `OpenSpecGroupManager.tsx` | CRUD manager: create/rename/recolor/reorder(dnd-kit)/delete groups. See change: add-openspec-change-grouping. |
| `OpenSpecGroupPicker.tsx` | Per-row chip+dropdown assigning change to group; inline create. See change: add-openspec-change-grouping. |
| `OpenSpecGroupPills.tsx` | Pill row filtering OpenSpec changes by group; single-select; "Manage groups…" link. See change: add-openspec-change-grouping. |
| `OpenSpecGroupSection.tsx` | Collapsible group section header with color swatch, name, count, body slot. See change: add-openspec-change-grouping. |
| `OpenSpecGroupsSettingsSection.tsx` | Settings section listing cwds with per-cwd group manager. See change: add-openspec-change-grouping. |
| `OpenSpecProfileSection.tsx` | Settings section. Sets global OpenSpec profile (core/expanded/custom) + workflow multiselect. → see `OpenSpecProfileSection.tsx.AGENTS.md` |
| `OpenSpecStepper.tsx` | 7-node pills+lines stepper. Exports OpenSpecStepper, deriveStepperState. Variants sidebar \| compact. See change: redesign-session-card-and-composer. |
| `ProposeDialog.tsx` | Name-only dialog launching `/skill:openspec-propose`. Exports `ProposeDialog`, `formatProposePrompt(name)`. → see `ProposeDialog.tsx.AGENTS.md` |
| `SessionOpenSpecActions.tsx` | OpenSpec action panel for a session (attach/detach, New/Propose/Explore, Continue/FF/Apply/Verify/Archive,… → see `SessionOpenSpecActions.tsx.AGENTS.md` |
| `SpecsBrowserView.tsx` | Full-page main specs reader for a cwd. Combobox jump-to-spec + `MarkdownPreviewView` (searchable). Backed by `useMainSpecsReader`. Props: `cwd`, `onBack`. Exports `SpecsBrowserView`. |
