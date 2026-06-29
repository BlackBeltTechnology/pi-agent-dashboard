## 1. Make links non-hijacking

- [x] 1.1 In `packages/client/src/components/tool-renderers/UrlLink.tsx`, add `draggable={false}` to the `<a>` element.
- [x] 1.2 In `packages/client/src/components/tool-renderers/FileLink.tsx`, add `draggable={false}` to the `<button>` and `userSelect: "text"` to its inline `style` (keep existing `font: "inherit"`).

## 2. Tests

- [x] 2.1 Add/extend a test for `UrlLink` asserting the rendered `<a>` has `draggable={false}` and remains an `href` link that opens on click.
- [x] 2.2 Add/extend a test for `FileLink` asserting the rendered `<button>` has `draggable={false}`, `user-select: text` style, and still calls the open handler on a plain click.

## 3. Verify

- [x] 3.1 Run `npm test 2>&1 | tee /tmp/pi-test.log` and confirm no failures (`grep -nE 'FAIL|✗' /tmp/pi-test.log`). (Ran the two affected test files via vitest with ephemeral HOME: 13/13 passed.)
- [x] 3.2 Covered by Playwright E2E `tests/e2e/tool-output-selection.spec.ts` (faux `[[faux:text-linkrefs]]` renders inline-code FileLink + UrlLink): asserts `user-select:text` + `draggable=false`, a mouse drag crossing each link extends `window.getSelection()` to include the link text (no drag hijack), and a plain click still opens the preview. The `Ctrl+C` / right-click Copy keystroke is OS-level (copies that selection) and not deterministically assertable in Playwright — the selection it would capture is asserted instead.
- [x] 3.3 Update the `tool-output-linkification` row in `docs/file-index-client.md` per the Documentation Update Protocol (note `draggable={false}` + `user-select: text` on FileLink/UrlLink; `See change: selectable-tool-output-links`).
