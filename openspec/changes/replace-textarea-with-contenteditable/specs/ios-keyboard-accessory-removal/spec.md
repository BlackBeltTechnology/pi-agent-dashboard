## ADDED Requirements

### Requirement: Chat input uses contenteditable div

The chat input field in the dashboard SHALL be backed by a `<div contentEditable="plaintext-only">` element instead of a `<textarea>` element.

#### Scenario: iOS keyboard accessory bar does not appear
- **WHEN** user focuses the chat input on iOS Safari
- **THEN** the native iOS keyboard accessory bar (⬆️⬇️ «Done») does NOT appear above the software keyboard

#### Scenario: Text input remains functional
- **WHEN** user types text into the chat input
- **THEN** text appears in the input field identically to the previous textarea behavior

#### Scenario: Plaintext-only attribute is set
- **WHEN** the component mounts
- **THEN** the underlying DOM element SHALL have `contenteditable="plaintext-only"` attribute

### Requirement: Plaintext enforcement

The contenteditable input SHALL only accept plaintext. HTML formatting from paste or drag-and-drop SHALL be stripped.

#### Scenario: HTML paste is stripped
- **WHEN** user pastes rich HTML content (e.g., `<b>bold</b>`)
- **THEN** only the plaintext representation ("bold") is inserted into the input

#### Scenario: Special characters are preserved as literal text
- **WHEN** user types or pastes `<b>&x</b>`
- **THEN** the input contains the literal string `<b>&x</b>`, not rendered HTML

### Requirement: Multiline input

The contenteditable input SHALL support multiline text input.

#### Scenario: Shift+Enter inserts newline
- **WHEN** user presses Shift+Enter
- **THEN** a newline (`\n`) is inserted into the input without sending

#### Scenario: Newline is preserved in sent message
- **WHEN** user sends a message containing newlines
- **THEN** the message dispatched via `onSend` contains literal `\n` characters (not HTML tags)

### Requirement: All existing input behaviors preserved

The contenteditable-based input SHALL support all behaviors previously supported by the textarea-based input.

#### Scenario: Enter sends message on desktop
- **WHEN** user presses Enter (without Shift) on desktop and no IME composition is active
- **THEN** the message is sent and the input is cleared

#### Scenario: Enter does not send during IME composition
- **WHEN** user presses Enter while an IME composition is in progress (e.g., Chinese pinyin)
- **THEN** the message is NOT sent; the Enter confirms the IME composition instead

#### Scenario: ArrowUp recalls previous message
- **WHEN** user presses ArrowUp with caret on the first line
- **THEN** the previous sent message is loaded into the input

#### Scenario: ArrowDown navigates forward in history
- **WHEN** user presses ArrowDown while navigating history
- **THEN** the next (more recent) message is loaded, or the in-progress draft is restored

#### Scenario: @-autocomplete opens on @ symbol
- **WHEN** user types @ followed by characters and cursor is within the contenteditable field
- **THEN** the file autocomplete dropdown appears with matching files, based on the cursor position in the plaintext representation

#### Scenario: /-autocomplete opens on / prefix
- **WHEN** input text starts with / and contains no newline
- **THEN** the command autocomplete dropdown appears with matching commands

#### Scenario: Auto-resize adjusts height
- **WHEN** user types multiple lines of text
- **THEN** the input grows in height from 40px up to 120px, then shows a vertical scrollbar

#### Scenario: Image paste works
- **WHEN** user pastes an image from clipboard
- **THEN** the image appears in the preview strip and will be sent with the message

#### Scenario: Send button dispatches text
- **WHEN** user clicks the send button
- **THEN** the message text (and any pasted images) are dispatched via `onSend`

#### Scenario: File insertion preserves cursor
- **WHEN** user selects a file from @-autocomplete in the middle of existing text
- **THEN** the file path is inserted at the correct cursor position and cursor is placed after the inserted path

#### Scenario: History recall Escape restores draft
- **WHEN** user navigates history with ArrowUp, then presses Escape
- **THEN** the in-progress draft is restored and cursor is placed at the end

### Requirement: Accessibility

The contenteditable input SHALL maintain equivalent accessibility to a native textarea.

#### Scenario: Screen reader announces as textbox
- **WHEN** a screen reader encounters the input
- **THEN** it is identified as a multiline text input with the placeholder text announced

#### Scenario: Disabled state is announced
- **WHEN** the input is disabled
- **THEN** the disabled state is reflected in ARIA attributes and keyboard navigation skips it
