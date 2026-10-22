# Spec Delta

## Purpose

Defines where the editor pane's controls live and how users manage its set of open tabs. Pane-level controls sit in a pane bar with the tabs. Controls for the active document sit in a document bar. Bulk close and a searchable tab list cover many open tabs.

## ADDED Requirements

### Requirement: Pane bar SHALL host pane-level controls and the tab strip

The editor pane SHALL render one pane bar, holding in this order:
- the labelled Files rail toggle;
- the tab strip;
- a New tab control immediately after the tab strip (after the last tab when all tabs fit);
- a Search tabs control;
- a Close editor pane control.

The Files toggle SHALL show its text label at every pane width, its accessible name SHALL begin with that visible label, and it SHALL read as pressed exactly when the rail is visible, including when the rail's Search view revealed it. With zero open tabs, the pane bar SHALL still show the Files toggle, the New tab control and the Close editor pane control, and the Search tabs control SHALL be disabled. When tabs overflow, the tab strip SHALL scroll horizontally, and the New tab, Search tabs and Close editor pane controls SHALL stay visible.

Every pointer target in the pane bar, the document bar, their menus and the Search tabs popover SHALL be at least 24 × 24 CSS px, and every icon-only control SHALL have an accessible name. This includes the handler mode-switcher buttons and breadcrumb segments once in the document bar. A tab's close control SHALL also become visible when its tab has keyboard focus. When tabs overflow, only the tab strip shrinks and scrolls; the New tab control follows the last visible tab position at the strip's end.

The Files toggle (`data-testid="tree-toggle"`), the New tab control (`new-tab-menu-toggle`), the Search tabs control (`tab-search-toggle`) and the Close editor pane control (`editor-pane-close`) SHALL carry the given test ids.

#### Scenario: Pane bar order
- **WHEN** the editor pane is open with three file tabs
- **THEN** the pane bar shows, left to right, the Files toggle, the three tabs, the New tab control, the Search tabs control and the Close editor pane control

#### Scenario: Overflowing tabs keep the controls reachable
- **GIVEN** more tabs than fit the pane width
- **WHEN** the pane bar renders
- **THEN** the tab strip scrolls horizontally
- **AND** the New tab, Search tabs and Close editor pane controls remain visible and operable

#### Scenario: Empty pane bar
- **WHEN** the last tab is closed
- **THEN** the pane bar shows the Files toggle, the New tab control and the Close editor pane control, the Search tabs control is disabled, and no document bar is shown

#### Scenario: Narrow pane keeps the Files label
- **WHEN** the pane is narrower than 640 px
- **THEN** the Files toggle still shows the text "Files"

#### Scenario: Icon controls are named and large enough
- **WHEN** the pane bar and document bar render
- **THEN** each icon-only control has an accessible name and a bounding box of at least 24 × 24 px

#### Scenario: Tab close control appears on keyboard focus
- **WHEN** a background tab receives keyboard focus
- **THEN** its close control is visible without hovering

### Requirement: New tab control SHALL offer every tab-creating action

Activating the New tab control SHALL open a menu offering:
- **Terminal:** creates a terminal at the pane cwd and opens its tab active.
- **Live preview:** opens the live-server tab.
- **Open file…:** opens the rail's Search view in Filenames mode; offered only where file search is available.

The Terminal and Live preview items SHALL carry `data-testid="new-terminal-launch"` and `live-preview-launch`. No tab-creating action SHALL remain elsewhere in the pane bar.

#### Scenario: New terminal from the menu
- **WHEN** the user opens the New tab menu and chooses Terminal in a pane rooted at `/home/u/proj`
- **THEN** a terminal is created with cwd `/home/u/proj` and its tab opens active

#### Scenario: Open file from the menu
- **WHEN** the user chooses Open file… from the New tab menu
- **THEN** the rail shows its Search view in Filenames mode with focus in the query field

### Requirement: Document bar SHALL host the active document's controls

Below the pane bar, the editor pane SHALL render a document bar whose content depends on the active tab:

- **File tab:**
  - a breadcrumb of the file's path relative to the pane cwd (the absolute path for a file outside the pane cwd, whose folder segments then do not reveal anything and whose More menu omits Copy relative path and Show in file tree);
  - the handler mode switcher when at least one enabled handler claims the file, showing the claimed modes as unavailable for a file outside the session folder;
  - a Reload control;
  - Open in default app and a Reveal control, both shown only when the server is desktop-capable;
  - a More menu offering Show in file tree, Copy full path, Copy relative path and Copy file name.
- **Url tab:** the url and Open in system browser.
- **Terminal, diff, live-server or plugin tab:** a title line showing the same live label as the tab strip (a terminal rename or a plugin label update shows in both; a plugin tab's claimed label is rendered in both places) and no file actions. A plugin tab's own in-body toolbar is unaffected.
- **No tab open:** no document bar.

The handler mode switcher SHALL NOT render as a separate row. The document bar SHALL carry `data-testid="doc-bar"`; Open in default app, Reveal and Open in system browser SHALL keep `tab-open-in-app`, `tab-reveal-in-file-manager` and `tab-open-in-browser`, including when shown as More-menu items.

#### Scenario: Handler file shows mode switcher in the document bar
- **GIVEN** an enabled plugin claims `.pdf` with a mode labelled "Edit in PdfCraft"
- **WHEN** the user opens `Projektek/BOSCH/memo.pdf`
- **THEN** the document bar shows the breadcrumb `Projektek › BOSCH › memo.pdf`, a switcher offering "Preview" and "Edit in PdfCraft", and Reload
- **AND** no separate mode-switcher row is rendered

#### Scenario: Terminal tab shows a title line only
- **WHEN** a terminal tab titled `zsh` is active
- **THEN** the document bar shows `zsh` and no Reload, Open, Reveal or More control

#### Scenario: Terminal rename updates the title line
- **GIVEN** the active terminal tab is titled `zsh`
- **WHEN** the user renames the terminal to `build`
- **THEN** both the tab and the document bar title line show `build`

#### Scenario: System actions hidden on a headless server
- **GIVEN** the server reports it is not desktop-capable
- **WHEN** a file tab is active
- **THEN** the document bar shows no Open in default app or Reveal control, in the bar or in the More menu

### Requirement: Document bar breadcrumb and More menu SHALL navigate and copy

Activating a folder segment of the breadcrumb SHALL reveal that folder in the file rail: the rail SHALL be shown in its Files view (leaving the Search view if open), and the folder and its ancestors SHALL be expanded without collapsing any folder already expanded. Activating the file-name segment SHALL open the More menu. Show in file tree SHALL do the same reveal for the file itself. The copy items SHALL copy the absolute path, the path relative to the pane cwd, or the file name, with the same confirmation and Clipboard-API fallback as the file-tree copy-path popup.

#### Scenario: Breadcrumb folder reveals the tree
- **GIVEN** the rail is collapsed
- **WHEN** the user activates the `BOSCH` segment of `Projektek › BOSCH › memo.pdf`
- **THEN** the rail is shown with `Projektek/BOSCH` expanded and visible

#### Scenario: Show in file tree leaves the Search view
- **GIVEN** the rail shows its Search view
- **WHEN** the user chooses Show in file tree for the active file
- **THEN** the rail shows its Files view with the file's row highlighted and visible

#### Scenario: Copy relative path
- **WHEN** the user chooses Copy relative path from the More menu for `Projektek/BOSCH/memo.pdf`
- **THEN** the clipboard holds `Projektek/BOSCH/memo.pdf`

### Requirement: Document bar SHALL fold on narrow panes

When the editor pane's own width (rail included) is below 640 px:
- Open in default app and Reveal SHALL move into the More menu, appearing exactly once (as menu items, not as hidden bar buttons);
- the breadcrumb SHALL collapse its folder segments into an ellipsis whose tooltip is the full path.

#### Scenario: Narrow pane folds system actions into More
- **GIVEN** a desktop-capable server and a pane narrower than 640 px
- **WHEN** a file tab is active
- **THEN** Open in default app and Reveal appear as items in the More menu and not as bar buttons

#### Scenario: Narrow breadcrumb keeps the file name
- **GIVEN** a pane narrower than 640 px
- **WHEN** `Projektek/BOSCH/memo.pdf` is active
- **THEN** the breadcrumb shows `… › memo.pdf` and the ellipsis tooltip is `Projektek/BOSCH`

### Requirement: Tabs SHALL offer a context menu with bulk close

Opening the context menu on a tab (secondary click, or the keyboard context-menu key or Shift+F10 on a focused tab) SHALL offer:
- Close;
- Close other tabs;
- Close tabs to the right (disabled on the last tab);
- Close all tabs;
- Show in file tree and Copy relative path, for file tabs inside the pane cwd.

Close SHALL behave exactly like the tab's × control.

When bulk close leaves the active tab open, it SHALL stay active. When the active tab is closed, the nearest remaining tab to its right SHALL become active, otherwise the nearest to its left. When no tab remains, the pane SHALL show its empty state.

#### Scenario: Close other tabs
- **GIVEN** tabs `a.ts`, `b.ts`, `c.ts` with `c.ts` active and none at risk
- **WHEN** the user chooses Close other tabs on `b.ts`
- **THEN** only `b.ts` remains and it is active
- **AND** no confirmation is shown

#### Scenario: Close tabs to the right keeps the active tab
- **GIVEN** tabs `a.ts`, `b.ts`, `c.ts`, `d.ts` with `a.ts` active
- **WHEN** the user chooses Close tabs to the right on `b.ts`
- **THEN** `a.ts` and `b.ts` remain and `a.ts` stays active

#### Scenario: Close all tabs empties the pane
- **WHEN** the user chooses Close all tabs and nothing is at risk
- **THEN** no tab remains and the pane shows its empty state

### Requirement: Pane menus SHALL follow the menu keyboard model

The New tab menu, the document More menu and the tab context menu SHALL each open with focus on their first enabled item. ↑ / ↓ SHALL move between items (wrapping), Home / End SHALL jump to the first / last item, Enter or Space SHALL activate the focused item, and Escape SHALL close the menu and return focus to the control that opened it. Disabled items SHALL be skipped.

#### Scenario: Keyboard through the New tab menu
- **WHEN** the user focuses the New tab control, presses Enter, then ↓ and Enter
- **THEN** the second menu item runs and the menu closes

#### Scenario: Escape returns focus
- **WHEN** a tab context menu is open and the user presses Escape
- **THEN** the menu closes and focus returns to that tab

### Requirement: Bulk close SHALL confirm once when it would lose work

A bulk close (Close other tabs, Close tabs to the right, Close all tabs, Close N matching tabs) SHALL first determine which target tabs are at risk:
- a terminal tab, because closing ends the terminal;
- a handler tab whose instance holds unsaved edits, unless a tab that stays open shares that instance; an instance that has not reported its state is not at risk in a bulk close (see `editor-pane-file-handlers`).

When no target is at risk, the tabs SHALL close without a confirmation. Otherwise, one confirmation SHALL list each at-risk tab with its reason and offer:
- **Cancel:** closes nothing, and receives focus when the confirmation opens;
- **Close all but these N:** closes only the targets not at risk;
- **Close all & discard:** closes every target, ends the listed terminals and discards the listed edits, without a further prompt per tab.

The set of at-risk tabs SHALL be computed again from the current tabs when the user confirms. When it contains a tab the confirmation did not list, nothing SHALL close and the confirmation SHALL be shown again with the updated list; only listed terminals and listed edits are ever ended or discarded. An instance shared by several closing tabs SHALL be listed once, and "N" SHALL count the tabs that stay open. Opening the confirmation SHALL first close any open pane menu or Search tabs popover, so Escape in the confirmation dismisses only the confirmation, and the close-tab keyboard shortcut SHALL do nothing while the confirmation, the Search tabs popover or any pane menu is open. The confirmation SHALL carry `data-testid="bulk-close-confirm"`.

Closing a single tab SHALL keep its existing per-tab behaviour.

#### Scenario: Terminal and unsaved handler in a bulk close
- **GIVEN** five tabs including terminal `zsh` and `memo.pdf` whose handler holds unsaved edits
- **WHEN** the user chooses Close all tabs
- **THEN** one confirmation lists `zsh` (terminal will be ended) and `memo.pdf` (unsaved edits)
- **AND** no other prompt appears

#### Scenario: Close all but these
- **GIVEN** the confirmation from the previous scenario
- **WHEN** the user chooses Close all but these 2
- **THEN** `zsh` and `memo.pdf` remain open, the terminal keeps running and the edits are kept
- **AND** the other three tabs are closed

#### Scenario: Close all and discard
- **GIVEN** the same confirmation
- **WHEN** the user chooses Close all & discard
- **THEN** all five tabs close, terminal `zsh` is ended and the handler instance is discarded

#### Scenario: Cancel keeps everything
- **WHEN** the user chooses Cancel or presses Escape in the confirmation
- **THEN** no tab is closed

#### Scenario: Unreported handler state closes silently in bulk
- **GIVEN** three tabs, one a handler tab whose handler never reported its saved state
- **WHEN** the user chooses Close all tabs
- **THEN** all three close without a confirmation

#### Scenario: A tab edited during the confirmation is listed before anything closes
- **GIVEN** the confirmation for Close all tabs lists only terminal `zsh`
- **WHEN** `memo.pdf`'s handler reports unsaved edits and the user then chooses Close all & discard
- **THEN** no tab closes and the confirmation is shown again listing `zsh` and `memo.pdf`

#### Scenario: Close-tab shortcut is inert under the confirmation
- **GIVEN** the bulk-close confirmation lists terminal `zsh`
- **WHEN** the user presses Cmd/Ctrl-W
- **THEN** no tab closes and the terminal keeps running


### Requirement: Search tabs SHALL filter open tabs by text

Activating the Search tabs control SHALL open a popover with:
- a focused query field;
- the list of open tabs in tab-strip order, each showing its icon, label, location, an unsaved marker when its handler instance holds unsaved edits, and a close control.

The location SHALL be:
- the parent folder for file and diff tabs;
- the target for url and live tabs;
- "terminal" for terminal tabs;
- the path after its prefix for plugin tabs.

Typing SHALL filter the list live:
- the query is trimmed and splits on whitespace; a query with no words counts as empty;
- a tab matches when every word occurs in its displayed label or location (plugin tabs: location only, since their label is not plain text); internal path prefixes (`term:`, `url:`, `live:`, `diff:`, plugin prefixes) SHALL NOT take part in matching;
- matching SHALL ignore case and Latin combining diacritical marks (U+0300–U+036F after canonical decomposition); letters with no decomposition (for example `ß`, `ø`, `ł`) and marks of other scripts match only themselves;
- matched text SHALL be highlighted in the label (when it is plain text) and in the location.

Keyboard:
- ↑ / ↓ SHALL move the selection, with the first result preselected;
- Enter SHALL activate the selected tab and close the popover;
- Escape SHALL close the popover and return focus to the Search tabs control;
- Delete or Backspace with an empty query field SHALL close the selected tab through the single-close path;
- the query field SHALL act as a combobox controlling a listbox of options; each row's pointer close control SHALL sit outside its option and outside the tab order.


#### Scenario: Accent-insensitive match on name
- **GIVEN** open tabs `Status Beszámoló.pdf` and `Status Beszamolo 2.pdf`
- **WHEN** the user types `beszamolo`
- **THEN** both tabs are listed with the matched text highlighted

#### Scenario: Every word must match
- **GIVEN** an open tab `memo.pdf` in folder `Projektek/BOSCH`
- **WHEN** the user types `bosch memo`
- **THEN** `memo.pdf` is listed
- **AND** typing `bosch kickoff` lists no tab

#### Scenario: Keyboard close from the popover
- **GIVEN** the query field is empty and `arch.md` is selected
- **WHEN** the user presses Delete
- **THEN** `arch.md` closes and the list keeps focus

#### Scenario: Prefixes do not match
- **GIVEN** an open terminal tab `term:t1` titled `zsh`
- **WHEN** the user types `term:`
- **THEN** that tab is not listed through its internal prefix

#### Scenario: Enter activates the selected tab
- **WHEN** the user types `arch` and presses Enter
- **THEN** the first matching tab becomes active and the popover closes

### Requirement: Search tabs SHALL offer bulk close and fall through to file search

The Search tabs popover is also the pane's tab-list menu. Its footer SHALL offer:
- with an empty query: "Close all but the active tab" (every tab except the active one, regardless of the highlighted row) and Close all tabs;
- with a query that has matches: "Close N matching tabs".

These bulk actions SHALL follow the bulk-close confirmation rule.

When the query matches no tab and file search is available, Enter SHALL close the popover and open the rail's Search view in Filenames mode prefilled with the query. Without file search, the popover SHALL show "No open tab matches" and Enter SHALL do nothing.

#### Scenario: Close matching tabs
- **GIVEN** a query matching two tabs, neither at risk
- **WHEN** the user chooses Close 2 matching tabs
- **THEN** those two tabs close and the others stay open

#### Scenario: No match falls through to file search
- **GIVEN** the query `kickoff` matches no open tab
- **WHEN** the user presses Enter
- **THEN** the popover closes and the rail Search view opens in Filenames mode with `kickoff` in its query field
