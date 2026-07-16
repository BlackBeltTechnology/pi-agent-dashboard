# auto-canvas — delta

## MODIFIED Requirements

### Requirement: Auto-open drives the split-workspace surface without disrupting the reader

On desktop/tablet the auto-canvas driver SHALL open the winning target through the
existing split-workspace openers (`openInSplit` for file targets, `openLiveTarget`
for loopback urls, `openUrlTarget` for generic urls). The auto-open SHALL be
**non-disruptive**: it SHALL reveal `split` only when the current mode is `closed`;
when the editor is already shown (`split` or `full`) it SHALL leave the mode
unchanged, add the target's tab **without** changing the active tab, mark it
**unread**, and play a one-time highlight — for all three target kinds. On mobile the
driver SHALL NEVER yank chat; it SHALL surface a tap-to-open chip. The chip tap is a
**user** action and SHALL be **foreground** (activates the tab), even though the
auto-open path that shares its handler is background.

#### Scenario: Auto-open from closed reveals the split
- **GIVEN** `closed` mode (chat only) on desktop
- **WHEN** the session's canvas target changes to a renderable file
- **THEN** the mode becomes `split` and the file opens as the active tab

#### Scenario: Auto-open while reading is silent
- **GIVEN** `split` or `full` mode on desktop with a tab being read
- **WHEN** the session's canvas target changes to a different file
- **THEN** the mode is unchanged
- **AND** the active tab is unchanged
- **AND** the canvas target's tab is added, marked unread, with a one-time highlight

#### Scenario: Mobile still surfaces a chip
- **GIVEN** a mobile viewport (`<768w` OR `<600h`)
- **WHEN** the canvas target changes
- **THEN** no pane is yanked and a tap-to-open chip is shown

#### Scenario: Tapping the chip activates (foreground), not silent
- **GIVEN** the mobile tap-to-open chip is shown
- **WHEN** the user taps it
- **THEN** the target opens and becomes the active tab (foreground)
- **AND** it is not left unread — the shared `useOpenTarget` handler passes
  foreground intent for the chip tap while the auto-open effect passes background
