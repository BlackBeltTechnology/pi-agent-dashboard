# craft-web-editor Specification

## Purpose
A dashboard plugin that lets a user edit workspace Office documents (`.docx`, `.xlsx`, `.pptx`) in the editor pane by embedding the matching ArtCraft web build (WordCraft, GridCraft, DeckCraft) as a file-handler edit mode. The app is isolated from the dashboard and from programmatic network access, edits only the tab's file, and saves only through the core handler save path.

## Requirements

### Requirement: The plugin claims Office extensions per verified app
When enabled, the plugin SHALL contribute one edit-mode file handler per app that has a verified web build version:

| Extension | App |
|---|---|
| `.docx` | WordCraft |
| `.xlsx` | GridCraft |
| `.pptx` | DeckCraft |

Each handler SHALL use the kind's office size cap as its size limit, ask to be kept alive, carry the app's fidelity notice as its first-overwrite notice, and use the app id as its copy suffix. An app without a verified web build version SHALL contribute no handler; if one is nevertheless present, it SHALL show as not verified and load nothing. An app disabled in the plugin settings SHALL show its mode as unavailable with that reason, and the server SHALL refuse to prepare it or save through it.

#### Scenario: Verified app
- **WHEN** the plugin is enabled, WordCraft has a verified web version, and the user opens `report.docx`
- **THEN** the mode switcher offers "Edit in WordCraft"

#### Scenario: Unverified app
- **WHEN** DeckCraft has no verified web version and the user opens `deck.pptx`
- **THEN** no DeckCraft mode is offered

#### Scenario: App disabled in settings
- **WHEN** GridCraft has a verified web version, is disabled in the plugin settings and the user selects its mode on `data.xlsx`
- **THEN** the mode shows that GridCraft is disabled and loads nothing

#### Scenario: Save through a disabled app refused
- **WHEN** GridCraft has a verified web version and is disabled while an instance is open and the user saves in it
- **THEN** the save is rejected and `data.xlsx` is unchanged

### Requirement: Builds are prepared only on authenticated request and served read-only
The plugin SHALL download and install an app's web build only when a client with control authority asks to prepare it. A static asset request SHALL never trigger a download. Concurrent prepare requests for the same app and version SHALL yield one download.

Prepared builds SHALL be served without sign-in, cross-origin and without credentials, only for the app's currently prepared build. Unprepared builds SHALL answer "unavailable". A build prepared with an outdated host shim SHALL be reported as needing preparation. After the plugin or an app is disabled, its public build MAY remain served until the next server restart, while preparation and saves are refused immediately.

The plugin SHALL report per app: availability, resolved version, prepared state, approximate download size, and the reason when unavailable. Before the first load of an unprepared build, the editor SHALL state the approximate download size.

#### Scenario: Anonymous request never provisions
- **WHEN** an unauthenticated client requests an asset of an unprepared build
- **THEN** the server answers unavailable and makes no outbound request

#### Scenario: Offline first Edit
- **WHEN** the user selects the WordCraft mode on `report.docx`, the build is not prepared, and the server is offline
- **THEN** the mode shows that WordCraft could not be prepared, and the built-in preview still works

#### Scenario: Enabled but not yet restarted
- **WHEN** the plugin was enabled without a server restart and the user selects the WordCraft mode
- **THEN** the mode states that a server restart is required and loads nothing

### Requirement: Embedded app is isolated and has no programmatic network access
The app SHALL run in a sandboxed frame with an opaque origin and these restrictions:
- no same-origin access to the dashboard;
- no top-level navigation, popups, modals, form submission or downloads;
- no dashboard credentials on its requests;
- its document SHALL forbid fetch, XHR, WebSocket and EventSource connections to anything other than its own build's location, which excludes the dashboard API;
- peer-to-peer (WebRTC) connection interfaces SHALL be removed before the app starts.

Where the browser supports cancelling a document's own navigation, the plugin SHALL cancel every navigation the app attempts and offer to open the target in a new browser tab after confirmation.

When the frame navigates or reloads anyway, the plugin SHALL NOT send document content to it again. It SHALL tell the user that the editor reloaded, stating that unsaved edits were lost when the last known state was unsaved or unknown, and offer to resume from disk.

#### Scenario: No programmatic exfiltration
- **WHEN** code inside the embedded app attempts `fetch("https://example.com")`
- **THEN** the browser blocks it under the frame's content security policy

#### Scenario: Hyperlink in a document
- **WHEN** the user activates a hyperlink inside a document in WordCraft in a browser that supports cancelling navigation
- **THEN** the editor stays loaded with its edits, and the user is offered to open the link in a new tab

#### Scenario: Frame navigated away
- **WHEN** the embedded frame navigates to another URL after loading
- **THEN** the plugin sends it nothing further, tells the user the editor reloaded (and that unsaved edits were lost, when there were any), and offers to resume editing from disk

### Requirement: The app is loaded only after it is ready, with the tab's file only
The plugin SHALL deliver the tab's snapshot to the app once per instance, only after the app reports it has finished starting. It SHALL use a per-instance message channel bound by a fresh nonce and accept messages only from its own frame with that nonce, of a known type, within the claim's size limit. Document content SHALL NOT be placed in any URL. If the app does not show the delivered document within a bounded time, the editor SHALL report that the document could not be opened.

Attempts inside the app to open another file — file chooser, open picker, a drag-and-drop from outside the browser page, or pasting a file — SHALL be refused, and the user SHALL be told to open files from the dashboard. Pasting text or image content into the document SHALL keep working.

#### Scenario: Open in the app
- **WHEN** the user selects "Edit in WordCraft" on `report.docx`
- **THEN** WordCraft shows `report.docx`'s content, and the frame URL contains no document data

#### Scenario: Local file open refused
- **WHEN** the user tries to open a local `.docx` through WordCraft's Open command or by dropping a file from the desktop
- **THEN** the app does not load it, the user is told to open files from the dashboard, and a later save still targets the tab's file

#### Scenario: Foreign message ignored
- **WHEN** another window posts a save message carrying the current nonce
- **THEN** it is ignored and nothing is saved

### Requirement: Saves map to the core save path; other formats go to the device
A save from the app under a different file name than the tab's (an in-app "Save As") SHALL first ask the user whether to save it as a copy next to the tab's file, overwrite the tab's file, or cancel. A save from the app whose file type and name match the tab SHALL be passed to the core handler save as an overwrite or a copy, according to a save-target choice that is always available in the editor and shared by all tabs of the same file. Its outcome SHALL be reported back to the app, so a save that did not happen leaves the document marked unsaved.

A save of a different file type (for example an export to PDF) SHALL NOT be written to the workspace. The browser SHALL instead offer it as a download to the user's device.

#### Scenario: Save as copy via the target choice
- **WHEN** the save target is "copy" and the user saves in WordCraft
- **THEN** a sibling `report.wordcraft.docx` is created and `report.docx` is unchanged

#### Scenario: Save As to another name asks first
- **WHEN** the user chooses Save As in WordCraft and names the file `draft.docx` while editing `report.docx`
- **THEN** the user is asked to save a copy next to `report.docx` (named `report.wordcraft.docx`, not `draft.docx`), overwrite `report.docx`, or cancel, and nothing is written before choosing

#### Scenario: Export goes to the device
- **WHEN** the user exports `report.docx` to PDF inside WordCraft
- **THEN** nothing is written to the workspace and the browser offers `report.pdf` as a download

#### Scenario: Document grew past the size limit
- **WHEN** the user inserts images until `report.docx` exceeds the docx size limit and saves
- **THEN** nothing is written to the workspace, the user is told the document is too large to save there, and is offered a download of the document to their device

#### Scenario: Cancelled save keeps the document unsaved
- **WHEN** the user cancels the core first-overwrite notice
- **THEN** WordCraft still shows the document as unsaved

### Requirement: The editor reports unsaved state conservatively
The plugin SHALL report the instance's unsaved state to core. It SHALL report unsaved after any user input that follows the app's last saved indication. It SHALL report saved only when the app indicates saved, no input followed, and the last save went to the tab's own file (after a save as copy the tab's file still lacks the edits). Until the app has given any indication, it SHALL report the state as unknown.

#### Scenario: Typing marks unsaved
- **WHEN** the user types into a document in WordCraft
- **THEN** core sees the instance as having unsaved edits

#### Scenario: Save marks saved
- **WHEN** the user saves successfully and types nothing afterwards
- **THEN** core sees the instance as saved

#### Scenario: Copy save keeps the tab unsaved
- **WHEN** the user saves as a copy and types nothing afterwards
- **THEN** core still sees the instance as having unsaved edits relative to the tab's file

#### Scenario: No indication from the app
- **WHEN** the app never indicates its saved state
- **THEN** core sees the state as unknown

### Requirement: Saved bytes must be a document of the tab's kind
The plugin SHALL register a content validator for each of its handlers that rejects a save unless the bytes are a zip package whose content-types part declares, and whose archive contains, the main document part of the target kind. A content-types part containing a document type declaration or entity declaration SHALL be rejected, and no entity SHALL ever be expanded:

| Extension | Main document part |
|---|---|
| `.docx` | word-processing document |
| `.xlsx` | spreadsheet workbook |
| `.pptx` | presentation |

#### Scenario: Garbage save rejected
- **WHEN** a WordCraft save for `report.docx` carries bytes that are not a zip package
- **THEN** the save is rejected and `report.docx` is unchanged

#### Scenario: Wrong kind rejected
- **WHEN** a save for `report.docx` carries a valid spreadsheet package
- **THEN** the save is rejected and `report.docx` is unchanged

### Requirement: Rendering degrades gracefully
If the browser lacks WebGPU, the app SHALL start using WebGL2, chosen before the app loads. If the browser has neither, the editor SHALL show a message instead of loading the app, and the built-in preview SHALL keep working. If the app does not finish starting within a bounded time, the editor SHALL say so and offer to retry.

#### Scenario: No WebGPU
- **WHEN** the WordCraft mode is selected in a browser without WebGPU but with WebGL2
- **THEN** the app starts and the document is editable
