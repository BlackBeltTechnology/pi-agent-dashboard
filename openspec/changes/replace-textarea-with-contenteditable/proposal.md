## Why

iOS Safari shows a native keyboard accessory bar (⬆️⬇️ «Done»/«Принять») above the software keyboard when a `<textarea>` is focused. There is no web API to hide this bar. Replacing the `<textarea>` with a `<div contentEditable="plaintext-only">` bypasses this native iOS UI, because iOS does not attach the accessory bar to contenteditable elements. This makes the chat input feel like a native messenger send bar on mobile.

## What Changes

- Replace `<textarea>` in `CommandInput` with a `<div contentEditable="plaintext-only">` via the `react-contenteditable` library (with imperative `plaintext-only` attribute fix after mount)
- Add utility helpers for cursor position (get/set via Selection API), plaintext↔HTML conversion, and IME composition guard
- Adapt key handling (Enter/Shift-Enter via `beforeinput`), auto-resize (via `onChange`), cursor-based autocomplete, and history recall to contenteditable semantics
- Add accessibility attributes: `role="textbox"`, `aria-multiline`, `aria-placeholder`, `aria-disabled`
- Keep all existing behaviors intact: @-autocomplete, file autocomplete, image paste, command dropdown, history recall

## Capabilities

### New Capabilities

- `ios-keyboard-accessory-removal`: Chat input field is backed by a contenteditable div, which does not trigger the native iOS keyboard accessory bar, making the input feel like a messenger-style send bar on mobile.

### Modified Capabilities

None. All existing behaviors are preserved; the change is purely an implementation swap from `<textarea>` to `<div contentEditable>`.

## Impact

- **Dependency**: new npm package `react-contenteditable` (~7.6 KB gzipped) in `packages/client/package.json`
- **New file**: `packages/client/src/components/contenteditable-utils.ts` — cursor and plaintext conversion helpers
- **Affected file**: `packages/client/src/components/CommandInput.tsx` — the core refactor
- **Tests**: `packages/client/src/components/__tests__/CommandInput.test.tsx` — adapt to contenteditable DOM semantics + add new test cases
- **API/Protocol**: none — props and behavior contract unchanged
