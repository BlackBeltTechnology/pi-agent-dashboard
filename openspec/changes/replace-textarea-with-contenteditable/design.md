## Context

`CommandInput` (`packages/client/src/components/CommandInput.tsx`) uses a `<textarea>` for the chat input field. On iOS Safari, focusing a `<textarea>` triggers a native keyboard accessory bar (⬆️⬇️ «Done»/«Принять») above the software keyboard. This bar cannot be hidden via CSS or web APIs and disrupts the messenger-style UX. iOS does **not** attach this bar to `<div contentEditable>` elements.

The `react-contenteditable` library (1.6K stars, 196K weekly downloads, Apache 2.0) wraps a `<div contentEditable>` and solves the core React/contentEditable friction: cursor position loss on re-render. It only calls `element.innerHTML = html` when the `html` prop actually changes (via deep equality), preserving the user's cursor during unrelated re-renders.

**Caveat discovered during review:** `react-contenteditable` unconditionally sets `contentEditable={true}` in its render method, overwriting any `contentEditable="plaintext-only"` passed as a prop. We will use `useLayoutEffect` to imperatively force the attribute to `"plaintext-only"` on the DOM element after mount. This ensures the browser treats the element as plaintext-only (Chrome/Safari), while Firefox gracefully degrades to regular contentEditable.

## Goals / Non-Goals

**Goals:**
- Remove the iOS keyboard accessory bar from the chat input
- Preserve ALL existing behaviors: Enter to send, Shift+Enter for newline, @-autocomplete, file autocomplete, image paste, command dropdown, history recall (ArrowUp/Down), auto-resize
- Keep the component API (props) unchanged — no callers need modification
- Add minimal dependency footprint (`react-contenteditable` ~7.6 KB gzipped)
- Maintain accessibility: `role="textbox"`, `aria-multiline`, `aria-placeholder`, `aria-disabled`

**Non-Goals:**
- Rich text editing, markdown formatting, emoji picker, or any new input features
- Changing the visual design of the input field
- Modifying other textarea-based inputs in the codebase (e.g., NewChangeDialog, ExploreDialog)

## Decisions

### Decision 1: Use `react-contenteditable` instead of a plain `<div contentEditable>`

**Alternatives considered:**
- Plain `<div contentEditable="plaintext-only">` — simple but React resets cursor position on every state-driven re-render. `CommandInput` has many state changes (dropdown, images, history, controlled text) that would clobber the cursor.
- Custom cursor save/restore — requires `onSelect` → save selection → `useLayoutEffect` → restore. Brittle across React versions and browser quirks.

**Choice:** `react-contenteditable` handles the cursor by only calling `element.innerHTML = html` when the `html` prop actually changes (via deep equality). For `CommandInput` in controlled mode, text changes come from the parent as `draft` — which is exactly when we want the cursor reset anyway.

### Decision 2: Imperative `contentEditable="plaintext-only"` via `useLayoutEffect`

**Problem:** `react-contenteditable` unconditionally sets `contentEditable={true}` in render, overwriting any passed `contentEditable` prop.

**Choice:** After mount, use `useLayoutEffect` + `innerRef` to imperatively call `el.setAttribute("contenteditable", "plaintext-only")`. This runs before the browser paints, so the user never sees `contentEditable="true"` state. On unmount, no cleanup needed.

**Firefox fallback:** Firefox ignores `plaintext-only` and treats the element as regular contentEditable. Acceptable — the primary target is iOS Safari.

### Decision 3: Enter/Shift+Enter via `onBeforeInput` (not `onKeyDown`)

**Correction from review:** `react-contenteditable` spreads unrecognized props onto the underlying div, so `onBeforeInput` IS available as a pass-through prop.

**Choice:** Use `onBeforeInput` to intercept Enter/Shift+Enter. Benefits over `onKeyDown`:
- Catches all input methods including IME composition, mobile soft keyboard "send" key, and voice input
- `e.preventDefault()` in `beforeinput` prevents DOM modification without needing to clean up after
- `e.inputType === "insertParagraph"` or `"insertLineBreak"` reliably identifies newlines

Fallback: keep `onKeyDown` for Enter handling as a secondary defense for browsers with incomplete `beforeinput` support.

### Decision 4: Auto-resize in `onChange` (not `onInput`)

**Problem:** `react-contenteditable` overwrites `onInput` with its internal `emitChange` handler. A passed `onInput` prop will not fire.

**Choice:** Trigger auto-resize in the `onChange` callback (which IS exposed), and in a `useLayoutEffect` that runs whenever text/pendingImages change. Read `scrollHeight` from the contenteditable div's ref, clamp between 40px and 120px, and set `style.height`.

**CSS addition:** Add `overflow-y: auto` class to the contenteditable div (current textarea CSS has no overflow rule since textarea handles it natively).

### Decision 5: Cursor helpers for both reading and setting position

**Current textarea approach:** `inputRef.current.selectionStart` / `selectionEnd` / `setSelectionRange()`. These are textarea-specific APIs unavailable on contenteditable.

**New approach — two helpers:**

1. **`getPlainTextCursor(root: HTMLElement): number | null`** — walks text nodes from the beginning of `root` to the current `Selection` anchor, counting characters. Returns cursor offset in the plaintext representation. Used by `extractAtQuery()`.

2. **`setPlainTextCursor(root: HTMLElement, offset: number): void`** — reverse of above: walks text nodes to find the character at `offset`, creates a collapsed `Range` at that position, and sets it as the window selection. Used by file insertion (`selectFile`), history recall, and Escape restore.

These helpers live as module-level utility functions in `CommandInput.tsx` or a sibling `contenteditable-utils.ts` file.

### Decision 6: Plaintext ↔ HTML conversion

**Problem:** `react-contenteditable` manages `innerHTML`, not `textContent`. Its `onChange` emits `evt.target.value` which is the element's `innerHTML`. Passing raw draft text directly to the `html` prop would misinterpret `&`, `<`, `>`, and newlines.

**Choice — two pure conversion functions:**

1. **`plainToSafeHtml(text: string): string`** — escapes `&` → `&amp;`, `<` → `&lt;`, `>` → `&gt;`, maps `\n` → `<br>`. Used when setting the `html` prop from controlled `draft`.

2. **`safeHtmlToPlain(html: string): string`** — strips all HTML tags, decodes entities (`&lt;` → `<`), normalizes `<br>`, `<div>`, `<p>` → `\n`, collapses multiple newlines. Used when reading `evt.target.value` from `onChange`.

### Decision 7: Accessibility

A `<div contentEditable>` does not inherit the ARIA semantics of `<textarea>`. Add:
- `role="textbox"` — screen reader identifies it as an input
- `aria-multiline="true"` — signals multiline input capability
- `aria-placeholder="Message, /command, !shell, or @file..."` — announces placeholder
- `aria-disabled={disabled}` — reflects disabled state
- `tabIndex={0}` — already the default for contentEditable, but explicit is clearer

### Decision 8: Placeholder via `data-placeholder` attribute

**Problem:** CSS `:empty:before` approach from `tasks.md` is fragile — `react-contenteditable` may insert text nodes during caret management, preventing `:empty` from matching.

**Choice:** Use a `data-placeholder` attribute:
- Render `<ContentEditable data-placeholder="Message, /command..." ...>`
- CSS: `[contenteditable][data-placeholder]:empty:before { content: attr(data-placeholder); color: ... }`
- Update `data-placeholder` to empty string when text is non-empty, so `:empty:before` never triggers with text

### Decision 9: Prevent focus loss on dropdown click

**Problem:** Clicking a dropdown item (command/file autocomplete) can move focus out of the contenteditable div before `selectFile()`/`selectCommand()` runs, losing the cursor position needed for text insertion.

**Choice:** Add `onMouseDown={(e) => e.preventDefault()}` to dropdown buttons. This prevents the mousedown from stealing focus, while still allowing the click handler to run and programmatically restore focus + cursor afterward.

## Risks / Trade-offs

- **[Risk] Cursor position mapping is fragile** — `Selection` API returns DOM offsets, not character offsets. Contenteditable can have `<br>` tags and mixed text/element nodes. → **Mitigation:** With `plaintext-only` mode (Chrome/Safari), the DOM is simple: only text nodes and occasional `<br>`. The helpers account for `<br>` as `\n`. Covered by tests.

- **[Risk] `plaintext-only` not supported in Firefox** — Firefox falls back to regular contentEditable, allowing rich text paste. → **Mitigation:** Acceptable trade-off. The change targets iOS Safari behavior. Additionally, `safeHtmlToPlain()` in `onChange` strips any HTML that might slip through in Firefox.

- **[Risk] `react-contenteditable` overwrites `contentEditable` attribute** — The library sets `contentEditable={true}` unconditionally. → **Mitigation:** Imperative `useLayoutEffect` + `setAttribute` after mount. Verified via test that `el.getAttribute("contenteditable") === "plaintext-only"`.

- **[Risk] Test suite breakage** — Existing tests use `@testing-library/user-event` with textarea semantics (`.value`, `selectionStart`, `textarea` selectors). → **Mitigation:** Update tests to query `[contenteditable]` / `role="textbox"`, assert `textContent`, mock `window.getSelection()` where needed.

- **[Risk] Mobile keyboard may behave differently** — Contenteditable divs may trigger different keyboard layouts or autocorrect behavior on some devices. → **Mitigation:** Keep HTML attributes: `autoCorrect="off"`, `autoCapitalize="none"`, `spellCheck={false}`, `enterKeyHint="send"`.

- **[Risk] IME composition may send on Enter** — During IME composition (e.g., Chinese pinyin), pressing Enter should confirm the composition, not send the message. → **Mitigation:** Track `composition` state via `onCompositionStart`/`onCompositionEnd`. Suppress Enter-to-send while `isComposing` is true. Add test coverage.

- **[Risk] Dropdown mouse selection loses cursor** — See Decision 9. → **Mitigation:** `onMouseDown={e => e.preventDefault()}` on dropdown items.

## Migration Plan

1. Install `react-contenteditable` as a dependency in `packages/client/package.json` (not root)
2. Create `packages/client/src/components/contenteditable-utils.ts` with cursor and plaintext helpers
3. Refactor `CommandInput.tsx` — replace `<textarea>` with `<ContentEditable>`, wire up all adapters
4. Update tests to work with contenteditable DOM semantics + add new test cases
5. Build client: `npm run build`
6. Manual QA on iOS Safari to verify the keyboard accessory bar is gone
7. Deploy via `curl -X POST http://localhost:8000/api/restart`

**Rollback:** Revert the commit. No data migration, no config changes.
