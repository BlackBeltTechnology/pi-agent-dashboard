## 1. ToolCallStep — collapsed row

- [x] 1.1 In `packages/client/src/components/ToolCallStep.tsx`, remove `.slice(0, N)` from every entry of the `toolSummaries` map (`bash`, `ask_user`, `Agent`, `get_subagent_result`, `steer_subagent`). Pass the raw string through; CSS `truncate` handles overflow.
- [x] 1.2 In the row `<button>` (the one that toggles `expanded`), add `title={getSummary(toolName, args)}` so desktop hover exposes the full text.
- [x] 1.3 Update / add `packages/client/src/components/__tests__/ToolCallStep.test.tsx` cases:
  - Long `bash.command` (> 80 chars) renders the full string into the DOM (not sliced).
  - The row `<button>` carries a `title=` attribute equal to the full summary.

## 2. CollapsedToolGroup — grouped row

- [x] 2.1 In `packages/client/src/components/CollapsedToolGroup.tsx`, drop `.slice(0, 50)` from its `toolSummaries` map.
- [x] 2.2 Add `title={getSummary(group.toolName, firstArgs)}` to the same row element that already carries the `truncate` class.
- [x] 2.3 Test coverage parallel to 1.3 — long command in a grouped row keeps the full string and surfaces it via `title=`.

## 3. BashToolRenderer — expanded row

- [x] 3.1 In `packages/client/src/components/tool-renderers/BashToolRenderer.tsx`, replace `className="... truncate"` on the command `<span>` with wrapping classes: `whitespace-pre-wrap break-all` (drop `truncate`). The `$` and timeout pill remain on the same row.
- [x] 3.2 Update / add `packages/client/src/components/tool-renderers/__tests__/BashToolRenderer.test.tsx` (or equivalent) to assert that a long command renders without `truncate` and the full string is present in the DOM.

## 4. Manual verification

- [x] 4.1 In dev mode, run a session that issues a long `bash` command (e.g. `test -e openspec/changes/archive/2026-05-28-bump-pi-compat-to-0-75/proposal.md`) and confirm:
  - Collapsed row ellipsizes via CSS (not hard cut) and the full text appears in the desktop hover tooltip.
  - Clicking the chevron expands to show the **complete** command, wrapped if needed.
- [x] 4.2 Repeat the spot-check for `Agent` (long `description`) and `ask_user` (long `title`) to confirm the `slice()` removal is consistent.

## 5. Rebuild

- [x] 5.1 `npm run build` (client-only change).
- [x] 5.2 `curl -X POST http://localhost:8000/api/restart` to pick up the new bundle.
