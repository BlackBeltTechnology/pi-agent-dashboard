## ADDED Requirements

### Requirement: Files outside the session folder SHALL edit and save only through the path grant gate

A tab outside the session cwd (opened by an absolute or `~/` link) SHALL read via `GET /api/file` under the usual containment and grant prompt, and SHALL offer the same Edit toggle as any tab. Saving SHALL be admitted only by the `scoped-markdown-editing` write-mode grant gate (a read grant does not admit it); a refused save SHALL show the error and keep the buffer. Such tabs are not watched for disk changes.

#### Scenario: outside markdown keeps the Edit toggle
- **GIVEN** cwd `/work/repo` and a granted tab for `/Users/u/Downloads/x.md`
- **WHEN** the tab renders
- **THEN** the Edit toggle SHALL be present

#### Scenario: ungranted outside path shows the access notice
- **GIVEN** an operator click opened `/Users/u/Downloads/x.md` and no grant covers it
- **WHEN** the viewer loads
- **THEN** the existing denial notice and grant prompt flow SHALL run, and no file bytes SHALL render before a grant

#### Scenario: Denied outside save keeps the buffer
- **GIVEN** an edited buffer for a tab outside the cwd whose write is not granted
- **WHEN** the user saves and the server answers `403`
- **THEN** the error SHALL be shown, the buffer SHALL stay dirty and the tab SHALL stay open

#### Scenario: Granted outside save succeeds
- **GIVEN** an edited buffer for `/Users/u/Downloads/x.md` and a write-mode grant covering `/Users/u/Downloads`
- **WHEN** the user saves
- **THEN** the file SHALL be written, the dirty indicator SHALL clear and a concurrent disk change SHALL still yield the `409` banner

#### Scenario: inside-cwd markdown keeps Edit
- **GIVEN** a tab for `docs/a.md` under the cwd
- **WHEN** the tab renders
- **THEN** the Edit toggle SHALL be present

### Requirement: Leaving with an unsaved built-in buffer SHALL ask first

When a built-in editable tab (`MarkdownViewer`, `EditablePreviewTab`) holds an unsaved buffer (`buffer !== content`), closing that tab, closing the editor pane, switching session from the sidebar, or unloading the page (`beforeunload`) SHALL first ask. A clean buffer SHALL leave without a prompt.

#### Scenario: Dirty tab close asks
- **GIVEN** a markdown tab in Edit mode with an unsaved buffer
- **WHEN** the user closes the tab
- **THEN** a Save / Discard / Cancel dialog SHALL appear and the tab SHALL stay open until a choice is made

#### Scenario: Dirty session switch asks
- **GIVEN** an unsaved buffer in session `a`
- **WHEN** the user selects session `b` in the sidebar
- **THEN** the dialog SHALL appear and navigation SHALL happen only after Save or Discard

#### Scenario: Dirty pane close asks
- **GIVEN** an unsaved buffer
- **WHEN** the user presses the editor-pane close button
- **THEN** the dialog SHALL appear before the pane closes

#### Scenario: Clean buffer leaves silently
- **GIVEN** a tab with no unsaved changes, including one just saved
- **WHEN** the user closes the tab, closes the pane or switches session
- **THEN** no dialog SHALL appear

#### Scenario: Browser reload is warned
- **GIVEN** an unsaved buffer
- **WHEN** the page is about to unload
- **THEN** a `beforeunload` handler SHALL be armed, and SHALL be removed once no buffer is unsaved

### Requirement: The unsaved dialog SHALL offer Save, Discard and Cancel

In-app leaves SHALL show Save / Discard / Cancel. Cancel keeps the tab and buffer; Discard proceeds and drops the buffer; Save writes through `POST /api/file/write` and proceeds only on success (a 409 shows `ChangedOnDiskBanner`, a 403 shows the error; neither proceeds).

#### Scenario: One dialog lists every dirty tab
- **GIVEN** two dirty built-in tabs in scope of one leave (pane close, session switch or layout switch)
- **WHEN** the leave is attempted
- **THEN** one dialog SHALL list both tabs; Save SHALL save them in order and proceed only if every save succeeds (a failing tab stops the sequence, keeps its buffer and shows its error, and tabs already saved stay saved); Discard SHALL drop all listed buffers; Cancel SHALL change nothing

#### Scenario: An overlapping leave joins the open dialog
- **GIVEN** the unsaved dialog is open from one leave attempt
- **WHEN** a second leave is attempted (e.g. pane close while a session switch is pending)
- **THEN** no second dialog SHALL stack; the second leave SHALL wait on the open dialog and receive the same verdict

#### Scenario: Dialog keyboard and focus
- **GIVEN** the unsaved dialog opens
- **WHEN** it receives focus, then the user presses Escape or clicks the backdrop
- **THEN** initial focus SHALL be on Cancel, Escape and a backdrop click SHALL both act as Cancel, and Enter SHALL NOT trigger Discard by default

#### Scenario: Cancel keeps the buffer
- **GIVEN** the dialog above
- **WHEN** the user chooses Cancel
- **THEN** the tab SHALL stay open with the buffer intact

#### Scenario: Save persists then leaves
- **GIVEN** the dialog above
- **WHEN** the user chooses Save and the write succeeds
- **THEN** the file SHALL be written with the loaded `mtime` and the tab SHALL close

#### Scenario: Save conflict does not leave
- **GIVEN** the dialog above and the file changed on disk
- **WHEN** the user chooses Save and the server answers 409
- **THEN** `ChangedOnDiskBanner` SHALL show and the tab SHALL stay open

#### Scenario: Save refused by the grant gate does not leave
- **GIVEN** the dialog above for a tab outside the cwd and no write grant
- **WHEN** the user chooses Save and the server answers 403
- **THEN** the error SHALL show, the tab SHALL stay open and the buffer SHALL be kept
