## Why

The per-turn inline change block (`ChangeSummaryBlock`) has two presentation gaps:

1. **No file-type signal.** Each row leads with a status glyph only — green `+` for an added file, gray `●` for a modified one (`file.status` is `"added" | "modified"`; there is no `"deleted"` on this surface). The type of file is invisible; a `.ts`, a `.css`, a `.png`, and a `.json` all read identically. The app already ships extension-keyed mime icons (`lib/file-icon.ts`, `fileIcon()`) used by the editor-pane file tree, so the diff list is the odd surface out.

2. **A large changeset shoves messages off-screen.** The block mounts **expanded** (`defaultExpanded = true`). At the tail of a streaming turn, as Edit/Write events arrive, the file list grows unbounded and pushes the assistant's text messages out of view — the reader loses the narration because the changed-file list took the space. The `change-summary-table` spec's existing "Overflow collapse" scenario (show first N rows + "+M more") is **not implemented** (the component renders the full list) and does not address the mounting-height problem.

## What Changes

- **Mime icons replace the status glyph** (explored options A/B/C; A chosen). Each file row SHALL lead with an extension-keyed mime icon from the shared `fileIcon()` helper (blue TS mark, orange JSON braces, green image glyph, …) in place of the `+ / ●` status glyph. Added-vs-modified is already conveyed by the `+X −Y` count badges, so no status information is lost.
- **Add a `.css` / `.scss` / `.less` glyph** to `lib/file-icon.ts` (currently falls through to the generic file glyph) so the common stylesheet case — and the file in the reference screenshot (`index.css`) — reads distinctly. Benefits the editor file tree too, since it shares the helper.
- **Auto-fold on a file-count threshold.** The block's effective expanded state SHALL derive from the file count until the user takes manual control: expanded when `fileCount < 8`, collapsed when `fileCount >= 8`. A streaming turn that crosses 8 files SHALL auto-collapse to its one-line header so it stops displacing messages.
- **Sticky manual override.** Once the user clicks the header to toggle, their choice wins and auto-fold stops fighting them — even as more files stream in.
- **Replace the unimplemented "Overflow collapse" spec scenario** with the auto-fold behavior above.

Out of scope (explored, rejected): option B (status glyph + mime icon — two competing glyphs, eats horizontal space the truncated path needs); option C (mime icon tinted by status — color already encodes file type, overloading it with status is a semantic collision); partial "+M more" row reveal (does not solve the mount-height problem and adds a second collapse affordance).

## Discipline Skills

None — single-component client presentation change with a shared-helper extension; covered by the component test. `code-simplification` may apply at the end if the derived-state + override logic reads heavy.

## Capabilities

### Modified Capabilities
- `change-summary-table`: the per-turn inline change block SHALL lead each row with a mime-type icon (not a status glyph), and SHALL auto-collapse when the changed-file count reaches the threshold (≥ 8) unless the user has manually toggled it.

## Impact

- **Code**:
  - `packages/client/src/components/ChangeSummaryBlock.tsx` — row leading glyph → `fileIcon()` mime icon; expanded state becomes derived (`fileCount < THRESHOLD`) with a sticky manual-override flag; `THRESHOLD = 8`.
  - `packages/client/src/lib/file-icon.ts` — add `.css` / `.scss` / `.less` → `mdiLanguageCss3` mapping.
- **Tests**:
  - `packages/client/src/components/__tests__/ChangeSummaryBlock.test.tsx` — mime icon renders per row; ≥ 8 files mounts collapsed; a list growing from 7→8 auto-collapses; a manual expand at ≥ 8 stays expanded as the count grows (sticky); < 8 stays expanded.
  - `packages/client/src/lib/__tests__/file-icon.test.ts` — `.css`/`.scss`/`.less` map to the CSS glyph.
- **APIs / protocol**: none.
- **Persistence**: none — auto-fold is ephemeral, derived per mount from the live file count; manual override lives in component state only.
- **Mockup**: `mockups/index.html` (current vs A/B/C option comparison; shipped choice is A).
