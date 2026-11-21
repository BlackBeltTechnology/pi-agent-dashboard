# chat-input-state

## Purpose

Defines the lifecycle and persistence rules for the chat input's typed-but-unsent text ("drafts") and for navigating previously sent user prompts ("history recall") inside `CommandInput`. Drafts are scoped per-session and survive navigation and page reload; history recall is derived from the session's in-memory user messages and navigated bash-style with `ArrowUp` / `ArrowDown`.

## Requirements

### Requirement: Per-session draft text persistence

The chat input SHALL preserve typed-but-unsent text on a per-session basis. The draft for session `S` SHALL be retained when the user navigates to any view that unmounts the chat area (Settings, OpenSpec preview, file diff view, pi resources view, readme preview, archive browser, or any other `detailPanel` branch) and SHALL be re-displayed when the user returns to the chat view with session `S` selected. The draft for session `S` SHALL NOT appear in any other session's input.

#### Scenario: Draft survives navigation to Settings
- **WHEN** the user has typed "hello world" into the chat input for session A and then navigates to the Settings panel
- **THEN** on returning to session A's chat view the input SHALL contain "hello world"

#### Scenario: Draft does not leak between sessions
- **WHEN** the user has typed "foo" into the chat input for session A and then switches to session B
- **THEN** session B's chat input SHALL show session B's draft (empty if none) and SHALL NOT show "foo"

#### Scenario: Draft survives a page reload
- **WHEN** the user has typed "remember me" into the chat input for session A and then reloads the page
- **THEN** after reconnecting and selecting session A, the chat input SHALL contain "remember me"

#### Scenario: Draft cleared on successful send
- **WHEN** the user sends the current draft text via the Send button or Enter key
- **THEN** the draft for that session SHALL be cleared from both in-memory state and persistent storage

#### Scenario: Pasted images are NOT persisted across page reload
- **WHEN** the user has pasted an image into the input and then reloads the page
- **THEN** the pasted image SHALL NOT be restored after reload (image attachments are kept in-memory only and not written to `localStorage`)

### Requirement: Per-session pending image attachments

The chat input SHALL preserve pasted-image attachments on a per-session basis, in-memory, for as long as the application tab is open. Pending images for session `S` SHALL be retained when the user navigates to any view that unmounts the chat area (Settings, OpenSpec preview, file diff view, pi resources view, readme preview, archive browser, terminals view, editor view, or any other `detailPanel` branch) and SHALL be re-displayed when the user returns to the chat view with session `S` selected. Pending images for session `S` SHALL NOT appear in any other session's input.

#### Scenario: Pending images survive navigation to Settings
- **WHEN** the user has pasted a PNG into the chat input for session A and then navigates to the Settings panel
- **THEN** on returning to session A's chat view the input's image preview strip SHALL show that PNG thumbnail

#### Scenario: Pending images survive navigation to a folder terminals view
- **WHEN** the user has pasted an image into the chat input for session A and then navigates to `/folder/<cwd>/terminals`
- **THEN** on returning to session A's chat view the image preview strip SHALL still show the pasted image

#### Scenario: Pending images do not leak between sessions
- **WHEN** the user has pasted an image into the chat input for session A and then switches the active session to session B
- **THEN** session B's chat input SHALL show session B's pending images (empty if none) and SHALL NOT show session A's image

#### Scenario: Sending in session A after switching back does not send to session B
- **WHEN** the user pastes an image while session A is selected, switches to session B, then switches back to session A and presses Send with text
- **THEN** the `send_prompt` message SHALL be addressed to session A and SHALL include the pasted image

#### Scenario: Sending in a different session does not attach another session's images
- **WHEN** the user pastes an image while session A is selected, switches to session B, types text in session B, and presses Send
- **THEN** the `send_prompt` message SHALL be addressed to session B and SHALL contain `images: undefined` (or an empty array)

#### Scenario: Pending images cleared on successful send
- **WHEN** the user sends a message with pasted images attached for session A
- **THEN** session A's pending images SHALL be empty after the send and the preview strip SHALL render no thumbnails

### Requirement: Draft storage location

Chat input drafts SHALL be persisted in `window.localStorage` under keys of the form `chat-draft:<sessionId>`. Writes SHALL be debounced to avoid thrashing during typing. On application mount, all existing `chat-draft:*` keys SHALL be loaded into an in-memory map keyed by session id.

#### Scenario: Draft key naming
- **WHEN** a draft for session `abc-123` is persisted
- **THEN** it SHALL be stored under the `localStorage` key `chat-draft:abc-123`

#### Scenario: Hydration on mount
- **WHEN** the application mounts and `localStorage` contains `chat-draft:abc-123` = "hi" and `chat-draft:def-456` = "bye"
- **THEN** the in-memory drafts map SHALL contain `{"abc-123": "hi", "def-456": "bye"}` before any user interaction

#### Scenario: Debounced write
- **WHEN** the user types multiple characters in quick succession
- **THEN** `localStorage.setItem` SHALL NOT be invoked on every keystroke; it SHALL be invoked at most once per debounce window

### Requirement: History recall for sent user prompts

Within a session, the user SHALL be able to recall previously sent user prompts using the `ArrowUp` and `ArrowDown` keys in the chat input. The history source SHALL be the current session's chat messages filtered to `role === "user"`. Consecutive duplicate entries SHALL collapse to a single history entry. History SHALL NOT cross session boundaries.

#### Scenario: Recall the most recent prompt
- **WHEN** the chat input is empty and the user presses `ArrowUp` (with the caret at the top row and no autocomplete dropdown open)
- **THEN** the input SHALL be populated with the most recently sent user prompt in this session

#### Scenario: Walk further back in history
- **WHEN** the input already shows history entry `N` and the user presses `ArrowUp` again
- **THEN** the input SHALL be populated with history entry `N + 1` (the next older prompt), bounded by the oldest available entry

#### Scenario: Walk forward toward current draft
- **WHEN** the input shows history entry `N` (N > 0) and the user presses `ArrowDown`
- **THEN** the input SHALL be populated with history entry `N - 1` (the next newer prompt)

#### Scenario: Walk past the newest entry restores in-progress draft
- **WHEN** the input shows the newest history entry and the user presses `ArrowDown`
- **THEN** the input SHALL be restored to the in-progress draft that was active when the user first entered history mode

#### Scenario: Consecutive duplicates are collapsed
- **WHEN** the user has sent "ping" three times in a row and then presses `ArrowUp` from an empty input
- **THEN** a single `ArrowUp` press SHALL land on "ping" and a second `ArrowUp` press SHALL land on the prompt before "ping" — not on "ping" again

#### Scenario: History does not cross sessions
- **WHEN** session A contains sent prompts ["X", "Y"] and session B contains sent prompts ["P", "Q"], and the user is on session B
- **THEN** pressing `ArrowUp` from empty input SHALL walk B's history ("Q", then "P") and SHALL never surface "X" or "Y"

#### Scenario: Slash commands and shell lines are in history
- **WHEN** the user has sent `/compact`, `!ls`, and `fix the bug` in that order
- **THEN** all three SHALL appear in history, retrievable via `ArrowUp`

### Requirement: In-progress draft buffer during history navigation

When the user first enters history mode (first `ArrowUp` press that triggers a recall), the input's current content SHALL be saved as the "in-progress draft". Walking forward past the newest history entry with `ArrowDown` SHALL restore the in-progress draft. Pressing `Escape` while in history mode SHALL also restore the in-progress draft and exit history mode. Any editing keystroke (other than `ArrowUp`/`ArrowDown`/`Escape`) while in history mode SHALL exit history mode without further restoration (the user is now editing the recalled entry).

#### Scenario: Draft is saved on entering history mode
- **WHEN** the input contains "half-typed" and the user presses `ArrowUp` to enter history mode
- **THEN** "half-typed" SHALL be preserved as the in-progress draft for later restoration

#### Scenario: Draft is restored on leaving history past the newest entry
- **WHEN** the user is at the newest history entry after having entered history from "half-typed" and presses `ArrowDown`
- **THEN** the input SHALL contain "half-typed" and history mode SHALL be exited

#### Scenario: Escape restores the draft
- **WHEN** the user is at any history entry after having entered history from "half-typed" and presses `Escape`
- **THEN** the input SHALL contain "half-typed" and history mode SHALL be exited

#### Scenario: Editing a recalled entry exits history mode without restoration
- **WHEN** the user has recalled a history entry "fix bug X" and starts editing it to "fix bug Y"
- **THEN** history mode SHALL be exited and subsequent `ArrowUp` presses (from the appropriate caret position) SHALL start a new history walk based on the edited text

### Requirement: History navigation must not interfere with multiline editing or autocomplete

`ArrowUp` / `ArrowDown` key presses without modifier keys SHALL activate history navigation only when ALL of the following conditions are true:

1. No autocomplete dropdown is currently open (no `/`-command list, no `@`-file list).
2. No pending prompt is awaiting server response.
3. The caret is a single (non-selection) position.
4. The textarea's current text value is the empty string.
5. There are no pending image attachments staged in the input.

When any condition is false, the bare `ArrowUp` / `ArrowDown` event SHALL NOT be intercepted, and the textarea's native behavior (cursor movement between lines, or dropdown navigation) SHALL apply.

#### Scenario: Multiline editing is preserved
- **WHEN** the input contains "line one\nline two\nline three" and the caret is on "line two"
- **THEN** pressing `ArrowUp` SHALL move the caret to "line one" (native behavior), NOT trigger history recall

#### Scenario: Single-line draft cursor movement is preserved
- **WHEN** the input contains "fix the bug" and the caret is at any position
- **THEN** pressing `ArrowUp` SHALL leave the caret at its current column on the same (only) line per native textarea behavior, NOT trigger history recall

#### Scenario: Autocomplete dropdown takes priority
- **WHEN** the `/`-command dropdown is open and the user presses `ArrowUp`
- **THEN** the dropdown selection SHALL move (existing behavior), NOT history recall

#### Scenario: History activates on empty input
- **WHEN** the input is empty (no text, no pending images) and no autocomplete dropdown is open and no prompt is pending
- **THEN** pressing `ArrowUp` SHALL trigger history recall and populate the input with the most recent prompt

#### Scenario: History does not activate when only pending images are present
- **WHEN** the input has empty text but one or more pasted images attached
- **THEN** pressing `ArrowUp` SHALL NOT trigger history recall and SHALL NOT overwrite the staged image set

### Requirement: Session switch resets history navigation state

When the selected session changes, the chat input SHALL reset its history-navigation state: history cursor SHALL be cleared (`null`), and the in-progress draft buffer used for history navigation SHALL be cleared. The displayed draft text SHALL switch to the incoming session's stored draft.

#### Scenario: History cursor resets on session switch
- **WHEN** the user has walked to history entry 2 in session A and then switches to session B
- **THEN** on returning to session A later, pressing `ArrowUp` from A's draft SHALL start a fresh history walk at the newest entry (not resume at entry 2)

#### Scenario: Incoming session's draft is displayed
- **WHEN** session A has draft "foo" and session B has draft "bar", and the user switches from A to B
- **THEN** the chat input SHALL immediately show "bar"

<!-- Appended by render-skill-invocations-collapsibly. -->

### Requirement: Up-arrow recalls condensed slash form for skill invocations

The chat input's `ArrowUp` history-recall SHALL pull the most recently sent user prompts in newest-first order. When a user message was originally a skill invocation (its persisted content is wrapped in `<skill name="..." location="...">…</skill>`), the recall SHALL substitute the condensed slash form (`/skill:name args` or `/skill:name` if no args) for that entry. Plain user messages SHALL be recalled verbatim. The substitution SHALL apply at history-list construction time inside `extractUserPromptHistory(messages)` so `CommandInput` itself sees a uniform `string[]`.

This requirement supersedes the previous behavior in which `extractUserPromptHistory` returned the raw expanded body for every user message.

#### Scenario: Skill invocation with args is recalled as slash form
- **WHEN** the session contains a single user message whose stored content is `<skill name="openspec-explore" location="/x">\nbody\n</skill>\n\ncontinue with X`
- **AND** the user presses `ArrowUp` in an empty input
- **THEN** the input SHALL contain `/skill:openspec-explore continue with X`

#### Scenario: Skill invocation without args is recalled as bare slash form
- **WHEN** the session contains a single user message whose stored content is `<skill name="openspec-explore" location="/x">\nbody\n</skill>`
- **AND** the user presses `ArrowUp` in an empty input
- **THEN** the input SHALL contain `/skill:openspec-explore`

#### Scenario: Plain user messages are recalled verbatim
- **WHEN** the session's user-message history (newest-first) is `["fix the bug", "/compact", "!ls -la"]`
- **AND** the user presses `ArrowUp` repeatedly
- **THEN** the input SHALL contain `"fix the bug"`, then `"/compact"`, then `"!ls -la"`, in that order

#### Scenario: Mixed history preserves newest-first ordering and dedupes consecutive equals
- **WHEN** the session contains messages in order: `<skill foo>`, plain `"check it"`, `<skill foo>` (again, non-consecutive duplicate), `"check it"` (consecutive duplicate)
- **THEN** `extractUserPromptHistory` SHALL return `["check it", "/skill:foo", "check it", "/skill:foo"]` (newest-first, consecutive collapsing applied to the condensed strings, non-consecutive duplicates preserved)

### Requirement: Force-history modifier shortcut

The chat input SHALL support an explicit force-history shortcut that activates history recall regardless of input content. Pressing `ArrowUp` or `ArrowDown` while either `Ctrl` or `Meta` (Cmd on macOS) is held SHALL trigger history recall, subject only to the autocomplete-not-open and no-pending-prompt gates from the bare-arrow rule. The current input content (text and pending images) SHALL be captured as the in-progress draft on first invocation, exactly as for the bare-arrow path, and SHALL be restored by the existing walk-past-newest, `Escape`, or session-switch paths.

#### Scenario: Ctrl+ArrowUp recalls history with text already in the input
- **WHEN** the input contains "half-typed" and the user presses `Ctrl+ArrowUp` (no autocomplete dropdown open, no pending prompt)
- **THEN** the input SHALL be replaced with the most recent prompt from session history AND "half-typed" SHALL be preserved as the in-progress draft for later restoration

#### Scenario: Cmd+ArrowUp on macOS recalls history with text already in the input
- **WHEN** the input contains "half-typed" and the user presses `Cmd+ArrowUp` (no autocomplete dropdown open, no pending prompt)
- **THEN** the input SHALL be replaced with the most recent prompt from session history AND "half-typed" SHALL be preserved as the in-progress draft

#### Scenario: Ctrl+ArrowDown walks forward in history
- **WHEN** the input is showing history entry `N` (N > 0) after a force-history activation and the user presses `Ctrl+ArrowDown`
- **THEN** the input SHALL be populated with history entry `N - 1` (the next newer prompt)

#### Scenario: Walking past newest with force-history restores the in-progress draft
- **WHEN** the user is at the newest history entry after entering history mode via `Ctrl+ArrowUp` from "half-typed" and presses `Ctrl+ArrowDown` (or bare `ArrowDown`)
- **THEN** the input SHALL contain "half-typed" and history mode SHALL be exited

#### Scenario: Force-history is suppressed while autocomplete is open
- **WHEN** the `/`-command dropdown is open and the user presses `Ctrl+ArrowUp`
- **THEN** the dropdown selection SHALL move (or the event SHALL be passed through), and history recall SHALL NOT be triggered

#### Scenario: Force-history is suppressed while a prompt is pending
- **WHEN** a prompt is awaiting server response and the user presses `Ctrl+ArrowUp`
- **THEN** history recall SHALL NOT be triggered (matches bare-arrow gating)

#### Scenario: Pending images are preserved when entering force-history
- **WHEN** the input has empty text but a pasted image attached, and the user presses `Ctrl+ArrowUp`
- **THEN** the input text SHALL be replaced with the most recent history entry AND the pending images SHALL remain attached to the input

### Requirement: Per-prompt answer draft persistence
The partial answer of an unanswered ask-user prompt (`select`/`multiselect` checks and Other, `input` text, `batch` step and answers) SHALL be restored after switching session and back and after a page reload. Every surface mounting the same prompt SHALL share its text and selections, including the latest edit; no other session or prompt SHALL show it.

#### Scenario: Other text survives session switch
- **WHEN** the user activates "Other" on a pending `select` in session A, types `"foo"`, switches to session B and back
- **THEN** the "Other" row SHALL be active with text `"foo"`

#### Scenario: Multiselect and input restored
- **WHEN** the user checks options on a pending `multiselect`, or types in a pending `input`, and navigates away and back
- **THEN** the same options SHALL be checked, or the same text SHALL be shown

#### Scenario: Batch step and answers restored
- **WHEN** the user answers steps 1–2 of a pending `batch` and is on step 3, then reloads the page
- **THEN** the wizard SHALL open on step 3 with steps 1–2 answered

#### Scenario: Shared across surfaces
- **WHEN** the user types an Other text on the chat card and opens the same question in the question dialog
- **THEN** the dialog SHALL show the same text

#### Scenario: Switch inside the write delay
- **WHEN** the user types in a pending `input` and switches session within 300 ms of the last keystroke, then reloads
- **THEN** the full typed text SHALL be restored

#### Scenario: Images are not restored in the question dialog
- **WHEN** the user pastes an image into a pending `input` on the chat card and opens the same question in the question dialog
- **THEN** the dialog SHALL show the text but SHALL NOT show the image, because the dialog's answer road is text-only

#### Scenario: Prompt change re-initialises
- **WHEN** one mounted renderer element receives a different prompt id
- **THEN** it SHALL show that prompt's draft (or empty), not the previous prompt's

#### Scenario: Prompt without id is not persisted
- **WHEN** a prompt reaches a surface without a prompt id (e.g. a question row from an older server)
- **THEN** no draft SHALL be stored or restored for it, and two such prompts SHALL NOT share a draft

#### Scenario: Renderer without a session id is not persisted
- **WHEN** an interactive renderer is mounted with a prompt id but no session id
- **THEN** no draft SHALL be stored or restored for it, and no `ask-draft` key SHALL be written for it, while typing still works within the mounted card

#### Scenario: No leak
- **WHEN** session B has its own pending prompt while session A has a draft
- **THEN** B's prompt SHALL show no content from A's draft

### Requirement: Prompt draft storage and lifecycle
Prompt drafts SHALL live in an in-memory store, mirrored debounced and size-capped (serialised entry at most 16 384 UTF-16 code units) to `sessionStorage` (per tab) under `ask-draft:<sessionId>:<promptId>` and flushed on unmount and page hide. Invalid entries SHALL be ignored. Pasted images SHALL stay in memory, scoped per session, prompt and step, never serialised. A draft SHALL be deleted when its prompt is no longer pending (from session state, mounted or not) or is older than 24 hours.

#### Scenario: Key naming
- **WHEN** a draft exists for session `s1`, prompt `p1`
- **THEN** it SHALL be stored under `ask-draft:s1:p1`

#### Scenario: Cleared when answered or cancelled
- **WHEN** the user submits or cancels the prompt and its request leaves `pending`
- **THEN** its `ask-draft:` entry, memory copy and in-memory images SHALL be removed and a later unmount SHALL NOT re-create it

#### Scenario: Kept when delivery fails
- **WHEN** a submit from the question dialog fails and the prompt stays pending
- **THEN** its draft SHALL remain

#### Scenario: Cleared when no longer pending, renderer unmounted
- **WHEN** the prompt becomes resolved, cancelled or dismissed (including answered in the terminal) while its session is not the selected one
- **THEN** its entry SHALL be removed without the renderer being mounted

#### Scenario: Old entry swept
- **WHEN** the store hydrates and an entry is older than 24 hours
- **THEN** that entry SHALL be removed

#### Scenario: Per-tab storage
- **WHEN** a draft is written and the page is reloaded in the same tab, or a second tab opens the same session
- **THEN** the reloaded tab SHALL restore it, the second tab SHALL NOT see it, and nothing SHALL be written to `localStorage`

#### Scenario: Per-entry size cap
- **WHEN** a draft's serialised entry is 16 384 UTF-16 code units or fewer
- **THEN** it SHALL be mirrored to `sessionStorage`; when it is 16 385 or more the mirror write SHALL be skipped while the in-memory draft is kept and still restorable within the tab

#### Scenario: Storage failure is non-fatal
- **WHEN** `sessionStorage` throws on read or write (quota exceeded, storage disabled, `SecurityError`)
- **THEN** the store SHALL stay memory-only without crashing or showing any user-visible notice, and the renderer SHALL still restore the in-memory draft within the tab

#### Scenario: Corrupt or stale entry
- **WHEN** an entry is invalid JSON, or a batch draft's step exceeds the question count
- **THEN** the renderer SHALL start empty and the entry SHALL be discarded

#### Scenario: Images are memory-only
- **WHEN** the user pastes an image into a pending `input` on the chat card and navigates away and back without reloading
- **THEN** the image SHALL still show; after a reload it SHALL NOT, while the text SHALL

#### Scenario: Images do not cross sessions
- **WHEN** sessions A and B each have a pending prompt with the same prompt id and A has a pasted image
- **THEN** B's prompt SHALL NOT show A's image
