## MODIFIED Requirements

### Requirement: Document bar SHALL host the active document's controls

Below the pane bar, the editor pane SHALL render a document bar whose content depends on the active tab:

- **File tab:**
  - a breadcrumb of the file's path relative to the pane cwd (the absolute path for a file outside the pane cwd, whose folder segments then do not reveal anything and whose More menu omits Copy relative path and Show in file tree);
  - the handler mode switcher when at least one enabled handler claims the file, showing the claimed modes as unavailable for a file outside the session folder;
  - a Reload control;
  - Open in default app and a Reveal control, both shown only when the server is desktop-capable;
  - a More menu offering Show in file tree, Copy full path, Copy relative path, Copy file name and Download.
- **Url tab:** the url and Open in system browser.
- **Terminal, diff, live-server or plugin tab:** a title line showing the same live label as the tab strip (a terminal rename or a plugin label update shows in both; a plugin tab's claimed label is rendered in both places) and no file actions. A plugin tab's own in-body toolbar is unaffected.
- **No tab open:** no document bar.

The handler mode switcher SHALL NOT render as a separate row. The document bar SHALL carry `data-testid="doc-bar"`; Open in default app, Reveal and Open in system browser SHALL keep `tab-open-in-app`, `tab-reveal-in-file-manager` and `tab-open-in-browser`, including when shown as More-menu items. The More-menu Download item SHALL carry `data-testid="doc-download"`.

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

Activating a folder segment of the breadcrumb SHALL reveal that folder in the file rail: the rail SHALL be shown in its Files view (leaving the Search view if open), and the folder and its ancestors SHALL be expanded without collapsing any folder already expanded. Activating the file-name segment SHALL open the More menu. Show in file tree SHALL do the same reveal for the file itself. The copy items SHALL copy the absolute path, the path relative to the pane cwd, or the file name, with the same confirmation and Clipboard-API fallback as the file-tree row actions menu.

For file tabs the More menu SHALL offer a **Download** item that saves the file's on-disk bytes from `GET /api/file/raw` in download mode (`download=1`), addressing the file exactly as the tab's viewer does. URL, terminal, plugin and `source:` tabs SHALL NOT offer Download. When the tab's buffer has unsaved changes (a built-in buffer or a file-handler instance reporting dirty), the Download item SHALL stay enabled and SHALL show the hint "Unsaved changes not included"; the downloaded bytes SHALL be the on-disk content.

Delivery SHALL be hybrid. When the API base is same-origin and the file is inside the pane cwd, the client SHALL trigger a direct link download of the `download=1` URL (streamed by the browser). Otherwise (a cross-origin API base, or a file outside the pane cwd) the client SHALL fetch the `download=1` URL through the dashboard's `fetch` layer — so bearer authentication and access-grant handling (including the grant prompt) apply exactly as for previews — and save the response body under the file's basename; when that fetch fails (non-OK status or network error) the client SHALL show an error notification and SHALL NOT save a file.

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

#### Scenario: Download the active file
- **GIVEN** a same-origin API base and `notes/summary.md` is the active file tab in a pane whose cwd is `/Users/u/proj`
- **WHEN** the user chooses Download from the More menu
- **THEN** a direct link download is triggered for `/api/file/raw?cwd=%2FUsers%2Fu%2Fproj&path=notes%2Fsummary.md&download=1` and the menu closes

#### Scenario: Cross-origin base downloads through fetch
- **GIVEN** the client talks to a cross-origin API base with a paired-device bearer
- **WHEN** the user chooses Download for `notes/summary.md`
- **THEN** the `download=1` URL is fetched with the bearer attached, and the body is saved as `summary.md`

#### Scenario: File outside the pane cwd downloads through fetch
- **GIVEN** the active tab shows a file outside the pane cwd
- **WHEN** the user chooses Download
- **THEN** the `download=1` URL is fetched through the dashboard fetch layer, so an access-grant prompt can appear exactly as for its preview

#### Scenario: Failed fetch download shows an error
- **GIVEN** the fetch path is used and the server answers 403 or 404
- **WHEN** the user chooses Download
- **THEN** an error notification is shown and no file is saved

#### Scenario: Dirty buffer shows the hint
- **GIVEN** the active file tab has unsaved changes
- **WHEN** the user opens the More menu
- **THEN** the Download item is enabled and shows "Unsaved changes not included"

#### Scenario: Non-file tabs offer no Download
- **GIVEN** the active tab is a URL tab, a terminal, a plugin tab or a `source:` tab
- **THEN** no Download item is rendered for it

### Requirement: Pane menus SHALL follow the menu keyboard model

The New tab menu, the document More menu, the tab context menu and the file-tree row actions menu SHALL each open with focus on their first enabled item. ↑ / ↓ SHALL move between items (wrapping), Home / End SHALL jump to the first / last item, Enter or Space SHALL activate the focused item, and Escape SHALL close the menu and return focus to the control that opened it. Disabled items SHALL be skipped.

#### Scenario: Keyboard through the New tab menu
- **WHEN** the user focuses the New tab control, presses Enter, then ↓ and Enter
- **THEN** the second menu item runs and the menu closes

#### Scenario: Escape returns focus
- **WHEN** a tab context menu is open and the user presses Escape
- **THEN** the menu closes and focus returns to that tab

#### Scenario: Keyboard through the file-tree row actions menu
- **WHEN** the user focuses a file row, presses Shift+F10, then ↓ and Enter
- **THEN** the menu opened with focus on Copy full path, and Copy relative path runs
