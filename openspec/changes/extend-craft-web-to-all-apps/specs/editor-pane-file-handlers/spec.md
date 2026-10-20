## MODIFIED Requirements

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

## ADDED Requirements

### Requirement: The binary-file notice offers matching handler modes
When a file tab's built-in view shows the binary-file notice and at least one enabled handler claim matches the file, the notice SHALL offer each matching mode as a button labelled like that mode in the mode switcher, and choosing it SHALL behave exactly like selecting that mode in the switcher. With no matching enabled claim, the notice SHALL be unchanged.

#### Scenario: Binary file with a matching mode
- **WHEN** the user opens `photo.psd`, PhotoCraft's edit claim is enabled, and the built-in view shows the binary-file notice
- **THEN** the notice offers "Edit in PhotoCraft", and choosing it switches the tab to that mode

#### Scenario: Binary file without a matching mode
- **WHEN** the user opens `archive.bin` and no handler claim matches it
- **THEN** the binary-file notice shows no mode button
