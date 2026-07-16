# split-editor-workspace — delta

## MODIFIED Requirements

### Requirement: Opening a file auto-opens the split

The pane SHALL route file-open entry points (chat file-link, tool-result file path,
file-tree click, search-result selection, auto-canvas target) through the shared
openers (`openInSplit` / `openLiveTarget` / `openUrlTarget`). Each opener, and the
param-less `/session/:id/editor` deep-link mode transition, SHALL reveal the split
**only when the current mode is `closed`**; when the editor is already shown (`split`
or `full`) the mode SHALL be left unchanged. The opener SHALL open the file in the
editor pane and scroll to the requested line when provided. (The `live:preview`
button in the editor pane dispatches `openFile` directly and never changes the mode;
it is exempt as a mode-preserving in-pane action.)

#### Scenario: Clicking a file-link in chat auto-splits
- **GIVEN** the split is closed
- **WHEN** the user clicks a file path rendered in a chat message or tool result
- **THEN** the split opens
- **AND** the clicked file opens in the editor pane as the active tab

#### Scenario: Opening a file in full keeps full
- **GIVEN** `full` mode (editor only, chat hidden)
- **WHEN** the user opens a file (file-tree click, chat file-link, or search select)
- **THEN** the mode stays `full`
- **AND** the opened file becomes the active tab
- **AND** chat stays hidden

#### Scenario: Opening a file in split stays split
- **GIVEN** `split` mode
- **WHEN** the user opens a file
- **THEN** the mode stays `split`
- **AND** the opened file becomes the active tab

#### Scenario: Deep-link route opens the split
- **GIVEN** the split is closed
- **WHEN** the user navigates to `/session/:id/editor?file=src/foo.ts&line=42`
- **THEN** the split opens with `src/foo.ts` active, scrolled to line 42
- **AND** `ChatView` remains rendered alongside the pane

### Requirement: Peek handles SHALL restore a collapsed pane

When a pane is collapsed the workspace SHALL render a peek/restore affordance on the
collapsed pane's edge so the pane is re-openable without the header. In `closed` mode
a right-edge "Editor" affordance SHALL re-open to `split`. In `full` mode a
leading-edge "Chat" affordance SHALL restore `split`. Activating a peek SHALL NOT
destroy the other pane's state. A content-driven opener SHALL NOT change the mode
when the editor is already shown.

#### Scenario: Editor peek reopens the split
- **GIVEN** `closed` mode (chat only)
- **WHEN** the user activates the right-edge "Editor" peek handle
- **THEN** the mode becomes `split` and the editor pane renders with its prior tabs

#### Scenario: Chat peek restores chat
- **GIVEN** `full` mode (editor only)
- **WHEN** the user activates the leading-edge "Chat" peek handle
- **THEN** the mode becomes `split` and the conversation is visible again

#### Scenario: Content opener from full stays full
- **GIVEN** `full` mode (editor only)
- **WHEN** a content-driven opener fires (e.g. the header Changed-Files chip, a chat
  file-link, or an auto-canvas target)
- **THEN** the mode stays `full` — the opener never forces `split` when the editor is
  already shown
- **AND** the opened content appears in the editor pane per the open-intent rules
  (foreground activates; agent-driven adds in the background)

## ADDED Requirements

### Requirement: File opens SHALL declare foreground or background intent

Every file-open call SHALL declare its intent so the pane can protect what the user
is reading. **User-initiated** opens (file-tree click, chat file-link, tool-result
file path, search-result select, Open-file button, change-summary diff link, the
mobile canvas chip tap) SHALL be **foreground**: reveal the split when `closed`,
keep the current mode otherwise, and activate the opened tab. The **only**
agent-initiated open is the **auto-canvas driver effect** (file, `live-server`, and
`url` targets); it SHALL be **background** when the editor is already shown (`split`
or `full`): the tab SHALL be added **without** changing the active tab, SHALL be
marked **unread**, and SHALL play a one-time highlight so it is noticed without
stealing focus. When the mode is `closed`, a background open SHALL reveal `split` and
activate the opened tab (no reading context exists to protect). A call site that does
not declare intent SHALL default to **foreground**.

#### Scenario: Agent auto-open while reading another tab does not steal focus
- **GIVEN** `split` or `full` mode with tab `a.ts` active and being read
- **WHEN** the agent auto-opens `b.ts` (auto-canvas or tool-result path)
- **THEN** `a.ts` stays the active tab and its content is undisturbed
- **AND** a new `b.ts` tab is added, marked unread, with a one-time highlight
- **AND** the mode is unchanged

#### Scenario: Agent auto-open from closed reveals and shows the file
- **GIVEN** `closed` mode (chat only)
- **WHEN** the agent auto-opens `b.ts`
- **THEN** the mode becomes `split`
- **AND** `b.ts` is the active tab (nothing was being read to protect)

#### Scenario: User click always activates
- **GIVEN** `split` or `full` mode with tab `a.ts` active
- **WHEN** the user clicks `b.ts` in the file tree, a chat file-link, or a search result
- **THEN** `b.ts` becomes the active tab
- **AND** `b.ts` is not marked unread

#### Scenario: Unread clears on activation
- **GIVEN** a background-added tab `b.ts` marked unread
- **WHEN** the user activates `b.ts` (click or keyboard)
- **THEN** the unread marker on `b.ts` is cleared

#### Scenario: Unread survives reload
- **GIVEN** a background-added tab `b.ts` marked unread, still not activated
- **WHEN** the page reloads
- **THEN** `b.ts` is still present and still marked unread
