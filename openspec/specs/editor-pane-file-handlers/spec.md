# editor-pane-file-handlers Specification

## Purpose
Let dashboard plugins contribute alternative preview and edit modes for workspace files by extension. Core owns the safety-critical parts every handler needs: a consistent read, contained and conflict-checked writes, unsaved-edit protection, and bounded resources for heavy editors.

## Requirements

### Requirement: File tabs offer claimed handler modes
A file tab SHALL show a mode switcher when at least one enabled plugin claims the file's extension as a file handler.
- Extensions SHALL be compared case-insensitively, using the same extension normalization as the shared file-kind classifier.
- The switcher SHALL list the built-in view first, then each claimed mode ordered by plugin priority, then plugin id, then claim id.
- While a claimed mode is selected, the built-in view SHALL NOT load the file.
- Handler modes SHALL be offered only for files under the session working directory; for other files they SHALL be shown unavailable.
- Selecting a mode SHALL NOT be possible while a handler instance it would replace holds unsaved edits, unless the user confirms.
- The built-in view SHALL be selected when the tab opens and SHALL behave exactly as without handler plugins.
- The selected mode SHALL persist with the tab.
- A persisted mode whose claim is missing or disabled SHALL fall back to the built-in view for that tab only.
- Files whose extension no enabled claim matches SHALL show no switcher.

#### Scenario: Claimed extension shows the switcher
- **WHEN** an enabled plugin claims `.docx` with an edit mode labelled "Edit in WordCraft" and the user opens `report.docx`
- **THEN** the tab shows the built-in preview, with a switcher offering "Preview" and "Edit in WordCraft"

#### Scenario: No handler plugins
- **WHEN** no enabled plugin claims `.docx` and the user opens `report.docx`
- **THEN** the tab renders exactly as before this capability, with no switcher

#### Scenario: Disabled plugin after reload
- **WHEN** a tab was left in a plugin's mode and that plugin is disabled before the page reloads
- **THEN** the tab reopens in the built-in view and other tabs keep their state

#### Scenario: Upper-case extension
- **WHEN** an enabled plugin claims `.docx` and the user opens `REPORT.DOCX`
- **THEN** the claimed mode is offered

#### Scenario: File outside the session folder
- **WHEN** a claimed file is opened from outside the session working directory
- **THEN** the claimed mode is shown unavailable and the built-in view works as before

#### Scenario: Two plugins claim one extension
- **WHEN** two enabled plugins both claim `.pptx`
- **THEN** both modes appear in the switcher in priority order and neither replaces the other

### Requirement: Handlers read a consistent snapshot
Core SHALL give a handler the file's bytes together with a content-based conflict token that describes the same content. A change of the file's timestamp alone SHALL NOT make the snapshot inconsistent. Taking a snapshot SHALL set the tab's changed-on-disk baseline to that version. When the file exceeds the claim's size limit, the snapshot SHALL be refused before any content is transferred, and the mode SHALL be shown as unavailable with the limit.

#### Scenario: File changes while being read
- **WHEN** the agent rewrites `report.docx` while a handler is taking its snapshot
- **THEN** the handler receives one consistent version, and a later save is conflict-checked against that version

#### Scenario: File above the claim limit
- **WHEN** `deck.pptx` is larger than the claim's size limit
- **THEN** the mode is shown unavailable with the limit and no content is fetched

### Requirement: Handler saves are contained, authorized and conflict-checked
A handler SHALL save only through core, as either an overwrite of the tab's file or a new copy. Core SHALL accept a save only when all of these hold; otherwise it SHALL reject it without changing any file:
- the requester holds control authority;
- the working directory is a known session's working directory;
- the target, after resolving symlinks and `..`, lies under that directory (for a copy: the directory it is created in);
- the saving claim's plugin is enabled and the claim is an edit mode;
- the extension of both the requested path and the resolved file is one the claim declares (for a sibling copy: the new file's extension is one of the claim's declared sibling extensions);
- the body does not exceed the claim's size limit;
- every content validator its plugin registered for that claim accepts the bytes.

A validator SHALL only be able to reject, never to admit what core refuses. A plugin SHALL only register validators for its own claims. A validator that fails, hangs or exceeds its time limit SHALL cause a rejection without blocking other requests. A claim that declares a validator SHALL NOT be writable while that validator is not registered (for example between enabling its plugin and the server restart that loads it). A plugin MAY also refuse saves for one of its claims through a switch it controls.

A save performed through a handler SHALL count as the pane's own save for the changed-on-disk banner, including a change signal that arrives while the save is in flight.

**Overwrite.**
- It SHALL succeed only if the file's content is unchanged since the handler's snapshot or last successful save, judged by content, not by timestamp; a missing file counts as changed. An overwrite without that version reference SHALL be rejected. The only exception is the user explicitly choosing Overwrite anyway in the conflict dialog, which replaces the content currently on disk.
- Two writes to the same file, including one through a symbolic link, SHALL never run at the same time.
- It SHALL replace the file atomically and keep its permissions.
- It SHALL NOT raise the changed-on-disk banner for that tab.

**Copy.**
- It SHALL create `<stem>.<suffix>.<ext>`, using the first free `<stem>.<suffix>-<n>.<ext>` when taken.
- It SHALL never overwrite an existing file, including under concurrent copies.
- It SHALL take the source file's permissions, or default permissions when the source no longer exists.
- Except for a sibling copy (below), the copy's extension SHALL be the tab file's extension, which the claim declares.

**Sibling copy.** A claim MAY declare sibling extensions for the app's native file type.
- A sibling copy SHALL create `<stem>.<ext>` next to the tab's file, where `<stem>` is the tab file's stem and `<ext>` is a declared sibling extension, using the first free `<stem>-<n>.<ext>` when taken.
- It SHALL never overwrite an existing file, including under concurrent saves, and SHALL take the source file's permissions, or default permissions when the source no longer exists.
- It SHALL pass the same authority, containment, size and validator checks as a copy, with the validator judging the bytes as the sibling extension.
- An overwrite SHALL never target a sibling extension.
- A sibling copy SHALL NOT show the first-overwrite notice; when every sibling name is taken it SHALL be reported to the handler as an unresolved conflict.

After a successful save a handler MAY ask core to open a workspace file in a new tab, optionally in one of its own plugin's modes; a core without that ability leaves the request unavailable rather than failing the save.

#### Scenario: Clean overwrite
- **WHEN** a handler saves `report.docx` as an overwrite while it is unchanged on disk
- **THEN** `report.docx` contains the saved bytes and no changed-on-disk banner appears on its tab

#### Scenario: Extension not claimed
- **WHEN** a handler claiming only `.docx` saves to `notes.md`
- **THEN** the save is rejected and nothing is written

#### Scenario: Timestamp-preserving rewrite is still a conflict
- **WHEN** the agent rewrites `report.docx` with different content but the same modification time after the handler's snapshot, and the handler overwrites it
- **THEN** nothing is written and the conflict choices are shown

#### Scenario: Unknown working directory
- **WHEN** a save names a working directory that belongs to no session
- **THEN** the save is rejected

#### Scenario: Symlink to an unclaimed extension
- **WHEN** `<cwd>/report.docx` is a symlink to `<cwd>/notes.md` and a `.docx` handler saves it
- **THEN** the save is rejected and `notes.md` is unchanged

#### Scenario: Symlink escape
- **WHEN** `<cwd>/report.docx` is a symlink to a file outside the cwd and a handler saves it
- **THEN** the save is rejected

#### Scenario: Declared validator not loaded
- **WHEN** a claim declares a validator, its plugin was just re-enabled, and the server has not restarted
- **THEN** a save through that claim is refused and nothing is written

#### Scenario: Change signal during an own save
- **WHEN** the file's watch fires while a handler overwrite of `report.docx` is in flight and the save then succeeds
- **THEN** no changed-on-disk banner appears on that tab

#### Scenario: Validator rejects
- **WHEN** the plugin's validator rejects the bytes of a `.docx` save
- **THEN** the save is rejected, nothing is written, and the handler is told it was rejected

#### Scenario: Observe-only client
- **WHEN** a non-loopback observe-only device triggers a handler save
- **THEN** the save is rejected and nothing is written

#### Scenario: Concurrent copies
- **WHEN** two copies of `report.docx` with suffix `wordcraft` are saved at the same time
- **THEN** two distinct files are created and neither overwrites another file

#### Scenario: Sibling copy in a declared extension
- **WHEN** a handler for `photo.jpg` whose claim declares the sibling extension `.psd` saves a sibling copy with `.psd` bytes
- **THEN** `photo.psd` is created next to `photo.jpg` and `photo.jpg` is unchanged

#### Scenario: Sibling copy never overwrites
- **WHEN** `photo.psd` exists and a handler for `photo.jpg` saves a `.psd` sibling copy
- **THEN** `photo-2.psd` is created and `photo.psd` is unchanged

#### Scenario: Undeclared sibling extension refused
- **WHEN** a handler for `photo.jpg` whose claim declares only `.psd` as a sibling extension saves a sibling copy as `.exe`
- **THEN** the save is rejected and nothing is written

#### Scenario: Overwrite cannot change the extension
- **WHEN** a handler for `photo.jpg` requests an overwrite with the target `photo.psd`
- **THEN** the save is rejected and nothing is written

### Requirement: Core resolves conflicts and confirms first overwrites
When an overwrite conflicts with a change on disk, core SHALL keep the handler mounted with its edits and offer:
- Reload from disk, confirming first when the handler has unsaved edits;
- Save as copy;
- Overwrite anyway;
- Cancel.

When the claim declares a first-overwrite notice, the first overwrite of a file by one open handler instance SHALL show that notice with Overwrite, Save as copy and Cancel. Later overwrites by that instance SHALL NOT ask again; closing its tabs, reloading the page, or the instance being closed SHALL reset this.

Cancelled or failed saves SHALL be reported to the handler as not saved. A save refused because the server is temporarily busy SHALL be reported as retryable.

Overwrite anyway SHALL state that the version currently on disk will be lost.

#### Scenario: Agent changed the file meanwhile
- **WHEN** the agent rewrites `report.docx` after the handler's snapshot and the handler then overwrites it
- **THEN** nothing is written, the conflict choices are shown, and the handler still holds its edits

#### Scenario: Overwrite anyway replaces the agent's change
- **WHEN** a conflict is shown for `report.docx` and the user chooses Overwrite anyway after the warning
- **THEN** `report.docx` contains the handler's bytes

#### Scenario: Cancel the first overwrite
- **WHEN** a claim declares a first-overwrite notice and the user cancels the first overwrite of an instance
- **THEN** nothing is written and the handler is told the save did not happen

#### Scenario: Copy from the notice
- **WHEN** the user chooses Save as copy in the first-overwrite notice for `report.docx`
- **THEN** a sibling copy is created, the user is shown its path with an action to open it, and the tab stays bound to `report.docx`

### Requirement: Unsaved edits are guarded
A handler SHALL report whether it holds unsaved edits. Until it reports, its state SHALL be treated as unknown, and core SHALL treat unknown as unsaved, except in a bulk close as stated below.

Core SHALL ask for confirmation before discarding a handler instance that holds unsaved edits or is in an unknown state. That applies when:
- switching to another mode;
- closing the tab;
- reloading from disk via the changed-on-disk banner, manual refresh or the conflict dialog;
- leaving or reloading the page, including the reload that applies a plugin being disabled.

When several tabs close in one bulk action (see `editor-pane-chrome`), one summary confirmation listing every instance that holds unsaved edits SHALL serve as this confirmation for each listed instance; choosing to discard there SHALL NOT prompt again per instance, and choosing to keep them SHALL leave those tabs and instances open. In a bulk close only, an instance whose state is unknown SHALL be treated as saved: it is not listed and closes with its tab without a confirmation. Closing a single tab keeps treating unknown as unsaved.

Switching tabs, switching sessions, closing the editor pane or changing the layout SHALL NOT discard handler instances.

When the plugin providing an instance with unsaved edits or an unknown state is disabled, the instance SHALL stay open and tell the user to re-enable the plugin to save or to discard the edits; an instance with no unsaved edits SHALL close and its tab SHALL show the built-in view. A handler that reports no unsaved edits while holding some MAY lose them when its instance is closed to free resources; the handler contract SHALL state this.

#### Scenario: Switch away with unsaved edits
- **WHEN** a handler reports unsaved edits and the user selects the built-in Preview
- **THEN** a confirmation is shown, and Cancel keeps the handler with its edits

#### Scenario: Banner refresh on a handler tab
- **WHEN** the agent changes `report.docx` while a handler with unsaved edits is open, and the user chooses Refresh on the banner
- **THEN** a confirmation is shown before the handler reloads from disk

#### Scenario: Closing the editor pane keeps edits
- **WHEN** a handler holds unsaved edits and the user closes the editor pane and reopens it
- **THEN** the handler shows the edits without reloading

#### Scenario: Plugin disabled with unsaved edits
- **WHEN** a handler holds unsaved edits and its plugin is disabled
- **THEN** the edits are not discarded, and the user is told to re-enable the plugin to save or to discard them

#### Scenario: Handler never reports
- **WHEN** a handler never reports its saved state and the user closes its tab
- **THEN** a confirmation is shown

#### Scenario: Bulk close confirms once for several handlers
- **GIVEN** two handler tabs on different files, both holding unsaved edits
- **WHEN** the user chooses Close all tabs and then Close all & discard in the summary confirmation
- **THEN** both instances are discarded without any further prompt

#### Scenario: Bulk close does not prompt for an unknown state
- **GIVEN** a handler tab whose handler has never reported its saved state
- **WHEN** the user chooses Close all tabs and no other tab is at risk
- **THEN** all tabs close without a confirmation

#### Scenario: Single close still prompts for an unknown state
- **GIVEN** a handler tab whose handler has never reported its saved state
- **WHEN** the user closes that tab with its ×
- **THEN** a confirmation is shown

### Requirement: Heavy handlers are kept alive within a bound
A claim MAY ask to be kept alive.
- Kept-alive instances SHALL survive switching to other tabs.
- At most three handler instances SHALL be live per browser page, and a claim MAY lower its own limit.
- Handler modes SHALL be offered only in session editor panes; folder editor panes SHALL show no handler modes.
- Tabs of the same file and mode in the same session SHALL share one instance, including its unsaved state and overwrite confirmation.

**Eviction.**
- Opening a kept-alive mode at the limit SHALL close the least recently activated instance that reported no unsaved edits, and its tab SHALL offer to resume from disk.
- An instance with unsaved edits or an unknown state SHALL never be closed automatically.
- When none can be closed, the user SHALL be asked to save or discard one, and cancelling SHALL leave the new mode unopened.

Claims that do not ask to be kept alive SHALL be closed when their tab becomes inactive only if they report no unsaved edits; otherwise they SHALL stay open, hidden, until saved, discarded or their tab is closed.

#### Scenario: Tab switch keeps edits
- **WHEN** the user edits in a kept-alive handler, switches to another tab and back
- **THEN** the handler shows the edits without reloading

#### Scenario: Fourth instance evicts a clean one
- **WHEN** three kept-alive instances are live, the least recently used has no unsaved edits, and the user opens a fourth
- **THEN** that instance closes, its tab offers to resume, and the fourth opens

#### Scenario: All instances unsaved
- **WHEN** three kept-alive instances all hold unsaved edits and the user opens a fourth
- **THEN** none closes and the user is asked which one to save or discard

### Requirement: Built-in size limit does not gate handler modes
A handler mode is not a rich viewer for the purposes of the editor large-file limit. The limit SHALL continue to gate the built-in view only. Handler modes SHALL be gated by their claim's size limit, which SHALL NOT exceed the core handler ceiling.

#### Scenario: Large file, handler available
- **WHEN** `big.docx` exceeds the editor large-file limit but not the claim's size limit
- **THEN** the built-in view shows the too-large notice and the handler mode is available

### Requirement: The binary-file notice offers matching handler modes
When a file tab's built-in view shows the binary-file notice and at least one enabled handler claim matches the file, the notice SHALL offer each matching mode as a button labelled like that mode in the mode switcher, and choosing it SHALL behave exactly like selecting that mode in the switcher. With no matching enabled claim, the notice SHALL be unchanged.

#### Scenario: Binary file with a matching mode
- **WHEN** the user opens `photo.psd`, PhotoCraft's edit claim is enabled, and the built-in view shows the binary-file notice
- **THEN** the notice offers "Edit in PhotoCraft", and choosing it switches the tab to that mode

#### Scenario: Binary file without a matching mode
- **WHEN** the user opens `archive.bin` and no handler claim matches it
- **THEN** the binary-file notice shows no mode button
