## Why

Session cards stack up to seven subcards (OPENSPEC, KB, GIT, STATUS, PROCESS, FLOWS, MEMORY) plus a tags strip and spawn buttons. Some folders never need some of them. For example, a docs repo doesn't need FLOWS, and a scratch folder doesn't need GIT or OPENSPEC. The only control today is automatic hiding when a section is empty. Users can't declutter cards per folder, so scanning a busy sidebar costs vertical space and attention.

## What Changes

- Users can switch each session-card section on or off:
  - globally, as the default for all folders
  - per folder, overriding the global value
- Resolution order: built-in default (visible) → global → folder override → the existing hide-when-empty rule. Folder overrides are sparse: they store only the sections that differ, and each can be reset to "inherit".
- Toggleable sections:
  - built-in subcards: OPENSPEC, GIT, PROCESS
  - plugin subcards: KB, STATUS, FLOWS, MEMORY
  - card lines: tags strip, `+Session`/`+Worktree` buttons
  - The context usage bar stays a display preference. It is linked from the new UI but not duplicated there.
- Preferences persist server-side in `~/.pi/dashboard/preferences.json`, keyed by the canonical folder key. They sync to every connected browser.
- Worktree sessions use the settings of the folder group they render under (`gitWorktree.mainPath`).
- New **Directory Settings › Session cards** page: one tri-state control per section (Default / Show / Hide), plus a "Reset to global" button and a live preview.
- New **Settings › Display › Session card sections** block: global on/off switches, each showing how many folders override it.
- Inline menu on each subcard's title (the ⋯ in the legend capsule):
  - Hide in this folder
  - Hide everywhere
  - Section settings…
  - Each action shows an Undo toast.
- Safety valve: when PROCESS is hidden and a background process is running, the card still shows a compact ⚠ background-process chip.
- The mobile compact card follows the same settings for the sections it renders. **This changes** the "Mobile session card layout is unchanged" requirement.
- Hiding OPENSPEC is only cosmetic. It does not opt the folder out of OpenSpec; the settings row links to the existing opt-out.

## Capabilities

### New Capabilities
- `session-card-section-visibility`: Global and per-folder visibility preferences for session-card sections. Covers the resolution order, persistence and sync, worktree folder mapping, the Directory Settings page, the global settings block, the inline legend menu, and the PROCESS safety chip.

### Modified Capabilities
- `session-card-subcards`: The mobile card layout requirement changes. The mobile card now omits sections the resolved visibility hides.

## Impact

- **shared**:
  - new `card-sections.ts`: section ids and the resolve/merge helper
  - `browser-protocol.ts`: new messages `set_card_section_visibility`, `reset_folder_card_sections`, `card_sections_updated`
- **server**:
  - `preferences-store.ts`: new `cardSections` field with getters/setters
  - browser handler + gateway: validate the new messages, persist, broadcast, and send a snapshot on connect
- **client**:
  - `SessionCard.tsx`: gate each section on desktop and mobile
  - `SessionSubcard.tsx`: optional legend menu
  - new `CardSectionsContext` and `useCardSectionVisible`
  - new `DirectorySettings` page `cards`
  - new `SettingsPanel` Display block
  - new i18n keys
- **Compatibility**: additive. If the field is absent, every section is visible, which is the behavior today. An older server ignores the new messages. On rollback, the preferences field may be dropped the next time the file is written, and cards return to all-visible. No data loss beyond the preference itself.
- No new dependencies.

## Discipline Skills

- `security-hardening`: the new browser→server messages carry a folder path and a section id from the client. The server validates the section id (allowlisted charset and length), caps the map size, and canonicalizes the path before persisting.
- `review-code`: non-trivial client render gating across desktop and mobile card branches, done before commit.
- No `performance-optimization` or `observability-instrumentation` trigger: resolution is an O(1) map lookup per section per render, and there's no new external call or background job.
