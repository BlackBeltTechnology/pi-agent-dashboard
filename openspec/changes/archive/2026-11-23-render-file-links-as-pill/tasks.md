## 1. Tests first (client)

- [x] 1.1 In `packages/client/src/components/tool-renderers/__tests__/FileLink.test.tsx`, add a failing test: an active transcript link to `mockups/link-report.html` renders one pill element (`data-file-link-pill`) containing the glyph, the name and `link-html-menu-trigger`, and the pill has `whitespace-nowrap`.
- [x] 1.2 Add a failing test: the name span is truncated with `direction: rtl` and wraps the children in `<bdi dir="ltr">`; `textContent` equals the full path (including a `~/other-repo/secrets.ts` case).
- [x] 1.3 Add failing tests: the `recovered`, `missing`, `gated` and `ambiguous` states put the expected pill/name classes on the pill and keep `data-link-state` / `aria-disabled` on the inner button.
- [x] 1.4 Add a test: a link rendered without a `LinkResolutionProvider` (tool output) has no pill wrapper and no glyph. This guards the existing behaviour, so it passes before the change.
- [x] 1.5 Run `npx vitest run packages/client/src/components/tool-renderers/__tests__/FileLink` and confirm 1.1–1.3 fail.

## 2. Implementation

- [x] 2.1 `FileLink.tsx`: split `linkClass` into `pillClass(state)` and `nameClass(state)` (design D3); when `active`, wrap the `<button>` and `HtmlModeMenu` in the pill `<span data-file-link-pill>`, and keep `MentionPicker` and `FilePreviewOverlay` outside it (D1).
- [x] 2.2 `FileLink.tsx`: render the name as a truncating `rtl` span with `<bdi dir="ltr">` (D2); add the inline-code descendant variant classes to the pill (D4).
- [x] 2.3 `HtmlModeMenu.tsx`: in-pill divider styling (D5), with no behaviour change. No prop needed: the menu only ever renders inside the pill.
- [x] 2.4 Re-run the FileLink tests until they pass; run the full client suite (`set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log`).

## 3. Verify and land

- [x] 3.1 Point the mock's Proposed pane at the real `FileLink` (or delete the mock-local `PillLink`) and check on the mock site that it matches the approved mockup, in dark and light themes at 375 px and 1440 px widths.
- [x] 3.2 Build the client and restart the server (`npm run build && npx tsx .pi/skills/implement/scripts/restart-server.ts`). Done.
- [x] 3.3 Run `npm run quality:changed`, then the `review-code` inline review, then commit. `quality:changed` found 0 changed files, so Biome was run directly on the 3 files: clean after extracting LinkLabel / LinkPill to stay within complexity 15.
- [x] 3.4 (manual, deferred to post-merge verification) Check a real transcript: a long path, an `.html` link with the editor pane open, and a link in inline code. The automated headless check could not run: local-proof returned 403.
