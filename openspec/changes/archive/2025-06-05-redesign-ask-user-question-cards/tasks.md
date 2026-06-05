# Tasks

## 1. Confirm → Yes/No
- [x] 1.1 In `ConfirmRenderer.tsx`, rename pending buttons `Allow`→`Yes`, `Deny`→`No` (keep green/red). Update resolved-state text (`Allowed`/`Denied`) to highlight `Yes`/`No`.
- [x] 1.2 Resolved confirm renders BOTH `Yes` and `No` with the chosen one highlighted (not a one-liner).
- [x] 1.3 Update/extend `ConfirmRenderer` tests for the new labels + resolved layout.

## 2. Select — vertical rows + answered context
- [x] 2.1 In `SelectRenderer.tsx`, replace the `flex flex-wrap` button block with a vertical full-width row list (one option per line). Cancel becomes a dashed full-width row.
- [x] 2.2 Parse an optional description sub-line from each option (split on first ` — ` or ` · `); render title + dimmed description.
- [x] 2.3 Resolved state: render ALL options dimmed, chosen one highlighted. No `+N more`, no fold. Remove the one-liner collapse.
- [x] 2.4 Tests: pending renders N rows; description split; resolved shows full list with pick highlighted (incl. a 10-option case).

## 3. Multiselect — answered context
- [x] 3.1 In `MultiselectRenderer.tsx`, keep pending checkbox rows + Select-all + live count.
- [x] 3.2 Resolved state: render ALL options, selected checked/highlighted, unselected dimmed/unchecked, with an `X of N` count. Remove the one-liner collapse.
- [x] 3.3 Tests: resolved shows full list with checked/unchecked split + count.

## 4. Input — answered field
- [x] 4.1 In `InputRenderer.tsx`, resolved state keeps question as title and shows value in a read-only field.
- [x] 4.2 Empty submit renders `(left blank)` dimmed/italic; cancelled still shows `Cancelled` with no field.
- [x] 4.3 Tests: resolved-with-value, resolved-empty, cancelled.

## 5. Shared protocol — `batch` method
- [x] 5.1 Add `"batch"` to the interactive method union in `packages/shared/src/*` (and any browser-protocol mirror).
- [x] 5.2 Define batch request params (`questions[]` with per-question `method/title/message/options/placeholder`) and response result (`answers[]`, index-aligned union of `{confirmed}|{value}|{values}`).
- [x] 5.3 Update protocol type tests to cover `batch` as a valid discriminant.

## 6. Bridge — single-request batch dispatch
- [x] 6.1 In `packages/extension/src/ask-user-tool.ts`, replace the sequential per-sub-question loop with ONE UI request carrying `method:"batch"` + `questions[]`.
- [x] 6.2 Await the single `{answers}` response; map to existing text + `details.results` (index-aligned); preserve the "User cancelled batch …" summary on cancel.
- [x] 6.3 Keep all single-method dispatch paths unchanged. Keep `prepareArguments`/normalization for batch sub-questions.
- [x] 6.4 Tests: batch issues one request; answers mapped index-aligned; multiselect sub-question returns `{values}`; cancel summary; single-method unchanged.

## 7. Client — BatchRenderer wizard
- [x] 7.1 New `packages/client/src/components/interactive-renderers/BatchRenderer.tsx`: stepper header, one sub-question per page, Back/Next, Review page with per-row Edit, final Submit. Reuse the vertical-row / checkbox / input sub-renderers per sub-question method.
- [x] 7.2 Hold per-step answers in component state; send nothing until Review Submit; then `onRespond({answers})`. Cancel → `onCancel`.
- [x] 7.3 Multiselect step → multiple values, rendered as pills in step + Review + resolved summary.
- [x] 7.4 Resolved state: read-only Q→A summary (no Back/Next/Edit), multiselect answers as pills.
- [x] 7.5 Register `"batch"` → `BatchRenderer` in `registry.ts`.
- [x] 7.6 Tests: one-question-per-page; Back preserves answer; Edit-from-review preserves others; answers withheld until submit; multiselect multi-answer; resolved summary read-only.

## 8. Verify
- [x] 8.1 `npm test 2>&1 | tee /tmp/pi-test.log` green; `grep -nE 'FAIL|Error' /tmp/pi-test.log` clean.
- [x] 8.2 `npm run build` succeeds. Manual: trigger a long-option `select`, a `multiselect`, an `input`, a `confirm`, and a `batch` (with a multiselect step) from a real session; verify pending + answered states match `mockups/`.
- [x] 8.3 After bridge change, `npm run reload`; after client change, `npm run build` + `POST /api/restart`.
- [x] 8.4 Update `docs/file-index-client.md` (renderer rows + new `BatchRenderer.tsx`), `docs/file-index-extension.md` (`ask-user-tool.ts` batch dispatch), `docs/file-index-shared.md` (`batch` method) and `docs/architecture.md` ask_user notes. Delegate `docs/` writes to a subagent, caveman style.
