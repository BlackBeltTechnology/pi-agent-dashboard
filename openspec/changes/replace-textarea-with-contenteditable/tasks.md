## 1. Setup

- [x] 1.1 Move `react-contenteditable` dependency from root `package.json` to `packages/client/package.json`

## 2. Utility helpers

- [x] 2.1 Create `packages/client/src/components/contenteditable-utils.ts` with:
  - `getPlainTextCursor(root: HTMLElement): number | null` — walk text nodes to find cursor offset
  - `setPlainTextCursor(root: HTMLElement, offset: number): void` — place cursor at character offset
  - `plainToSafeHtml(text: string): string` — escape `&<>`, map `\n` → `<br>`
  - `safeHtmlToPlain(html: string): string` — strip tags, decode entities, normalize newlines

## 3. Core Refactor — CommandInput

- [x] 3.1 Import `ContentEditable` from `react-contenteditable`, replace `<textarea>` with `<ContentEditable>`
- [x] 3.2 Add `innerRef` for DOM access (replaces current `ref`); switch ref type from `HTMLTextAreaElement` to `HTMLElement`
- [x] 3.3 Wire controlled text: convert `draft` via `plainToSafeHtml()` for the `html` prop, convert `onChange` `evt.target.value` via `safeHtmlToPlain()` for `onDraftChange`
- [x] 3.4 Add `useLayoutEffect` to imperatively set `contentEditable="plaintext-only"` on the underlying DOM element via `innerRef`
- [x] 3.5 Replace `selectionStart`-based cursor tracking with `getPlainTextCursor()` for @-autocomplete (`extractAtQuery`)
- [x] 3.6 Adapt Enter/Shift-Enter: add `onBeforeInput` handler that `preventDefault()` on `insertParagraph` / `insertLineBreak`, dispatches send or inserts `\n` respectively. Keep `onKeyDown` Enter as fallback
- [x] 3.7 Add IME composition guard: track `isComposing` via `onCompositionStart`/`onCompositionEnd`, suppress Enter-to-send while composing
- [x] 3.8 Adapt file insertion (`selectFile`): use `getPlainTextCursor` + `setPlainTextCursor` for correct middle-of-text insertion
- [x] 3.9 Adapt history navigation (ArrowUp/Down/Escape): use `getPlainTextCursor`/`setPlainTextCursor` for cursor restore
- [x] 3.10 Adapt auto-resize: trigger in `onChange` and `useLayoutEffect` keyed on `text`/images; read `scrollHeight` from `innerRef`, clamp 40–120px, add `overflow-y-auto` CSS class
- [x] 3.11 Add accessibility attributes: `role="textbox"`, `aria-multiline="true"`, `aria-placeholder`, `aria-disabled`
- [x] 3.12 Add placeholder: use `data-placeholder` attribute, CSS `[data-placeholder]:empty:before { content: attr(data-placeholder) }`, toggle attribute based on text content
- [x] 3.13 Add dropdown focus-loss guard: `onMouseDown={(e) => e.preventDefault()}` on autocomplete dropdown buttons
- [x] 3.14 Carry over iOS-specific HTML attributes: `autoCorrect="off"`, `autoCapitalize="none"`, `spellCheck={false}`, `enterKeyHint="send"` (where supported on div)
- [x] 3.15 Remove textarea-specific props: `rows`, native `placeholder` attribute

## 4. Tests

- [x] 4.1 Update existing tests: query `[contenteditable]`/`role="textbox"` instead of `textarea`, use `textContent` instead of `.value`, mock `window.getSelection()`
- [x] 4.2 Add test: `contentEditable="plaintext-only"` attribute is set on DOM element
- [x] 4.3 Add test: typing `<b>&x</b>` produces literal plaintext, not HTML
- [ ] 4.4 Add test: rich HTML paste is stripped to plaintext (blocked: jsdom)
- [ ] 4.5 Add test: Shift+Enter produces `\n` in sent message, not `<br>` or `<div>` (blocked: jsdom)
- [ ] 4.6 Add test: @-file insertion at middle caret position works correctly (blocked: jsdom)
- [ ] 4.7 Add test: dropdown click selection preserves cursor (blocked: jsdom)
- [ ] 4.8 Add test: history recall (ArrowUp/Escape) with contenteditable cursor (blocked: jsdom)
- [ ] 4.9 Add test: auto-resize after typing, history restore, and clearing (blocked: jsdom)
- [ ] 4.10 Add test: Enter during IME composition does NOT send (blocked: jsdom)
- [x] 4.11 Add test: disabled state reflected in `aria-disabled`
- [x] 4.12 Verify all tests pass (39/39)

### Altman review fixes applied:
- [x] Rewrote cursor walker (`contenteditable-utils.ts`) — recursive, handles `<br>`, multiline correctly
- [x] Fixed `safeHtmlToPlain` — no longer collapses newlines or trims trailing newlines
- [x] Added `isDisabled` guard in `useLayoutEffect` — doesn't override `contentEditable="false"` when disabled
- [x] Added IME composition guard to `beforeinput` send path and dropdown Enter path
- [x] Added `onDrop` handler — prevents rich-text drag-and-drop

## 5. Build & Verify

- [x] 5.1 Build client: `npm run build`
- [x] 5.2 Restart server: `curl -X POST http://localhost:8000/api/restart`
- [x] 5.3 Manual smoke test: open dashboard, send a message, verify @-autocomplete, command dropdown, image paste, history, auto-resize, mobile keyboard behavior
