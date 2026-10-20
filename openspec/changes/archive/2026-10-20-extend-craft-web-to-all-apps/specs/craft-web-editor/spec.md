## RENAMED Requirements

- FROM: `### Requirement: The plugin claims Office extensions per verified app`
- TO: `### Requirement: The plugin claims file extensions per verified app`

## MODIFIED Requirements

### Requirement: The plugin claims file extensions per verified app
When enabled, the plugin SHALL contribute file handlers only for apps that have a verified web build version. It SHALL claim at most the extensions below, and each extension only after the app's opening and saving of that extension passed its end-to-end verification and, for edit modes, a content validator exists for it and for every sibling type:

| Extension(s) | App | Mode | Saves in another type become |
|---|---|---|---|
| `.docx` | WordCraft | edit | device download |
| `.xlsx` | GridCraft | edit | device download |
| `.pdf` | PdfCraft | edit | device download |
| `.dxf` | CADCraft | edit | device download |
| `.designcraft` | DesignCraft | edit | device download |
| `.scraftz` | SoundCraft | edit | device download |
| `.psd` | PhotoCraft | edit | device download |
| `.png` `.jpg` `.jpeg` `.webp` `.tif` `.tiff` | PhotoCraft | edit | `.psd` sibling |
| `.svg` | VectorCraft | edit | `.vectorcraft` sibling |
| `.deckcraft` | DeckCraft | edit | device download |
| `.pptx` | DeckCraft | edit | `.deckcraft` sibling |
| `.dng` `.cr2` `.cr3` `.nef` `.arw` `.raf` `.orf` `.rw2` | LightCraft | preview | device download |

Each edit handler SHALL use a size limit: the docx office cap for `.docx`, the sheet office cap for `.xlsx`, the pptx office cap for `.pptx`, and the core handler ceiling otherwise. It SHALL ask to be kept alive, carry the app's fidelity notice as its first-overwrite notice, and use the app id as its copy suffix. For an app known not to signal which document it opened, that notice SHALL also ask the user to check that the app shows the tab's file. An app without a verified web build version SHALL contribute no handler; if one is nevertheless present, it SHALL show as not verified and load nothing. An app disabled in the plugin settings SHALL show its mode as unavailable with that reason, and the server SHALL refuse to prepare it or save through it. FilmCraft, EffectCraft and FigCraft SHALL contribute no handler.

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

#### Scenario: Non-Office app offered
- **WHEN** CADCraft has a verified web version and the user opens `plan.dxf`
- **THEN** the mode switcher offers "Edit in CADCraft"

#### Scenario: Two apps on one extension are not offered
- **WHEN** the user opens `photo.jpg`
- **THEN** exactly one craft mode is offered for it, PhotoCraft's, and LightCraft offers none

#### Scenario: Media project apps excluded
- **WHEN** the user opens `cut.fcproj` or `comp.ecproj`
- **THEN** no craft mode is offered

#### Scenario: Extension that failed verification is not offered
- **WHEN** CADCraft's `.dwg` verification failed and the user opens `plan.dwg`
- **THEN** no CADCraft mode is offered for `plan.dwg`, while `plan.dxf` still offers "Edit in CADCraft"

#### Scenario: Preview-only app
- **WHEN** LightCraft has a verified web version, its `.dng` verification passed, and the user opens `IMG_0001.dng`
- **THEN** the mode switcher offers a LightCraft view mode and no LightCraft edit mode

### Requirement: Builds are prepared only on authenticated request and served read-only
The plugin SHALL download and install an app's web build only when a client with control authority asks to prepare it. A static asset request SHALL never trigger a download. Concurrent prepare requests for the same app and version SHALL yield one download.

Prepared builds SHALL be served without sign-in, cross-origin and without credentials, only for the app's currently prepared build. Unprepared builds SHALL answer "unavailable". A build prepared with a host shim older than the oldest one the app still supports SHALL be reported as needing preparation. A build whose host shim is older than current but still supported SHALL stay available and SHALL be reported as having an update. After the plugin or an app is disabled, its public build MAY remain served until the next server restart, while preparation and saves are refused immediately.

Each app SHALL have a version channel setting, `pinned` (default) or `latest`, read without a restart. With `pinned`, preparation SHALL use the verified version unless an env override decides it. With `latest`, preparation SHALL use the latest published web build. The status request MAY refresh the latest-version metadata in the background but SHALL NOT download a build. When a newer latest version than the prepared build is known, the app SHALL be reported as needing preparation with that version. When updating fails while a valid build is prepared, the prepared build SHALL stay available.

The plugin SHALL report per app: availability, version channel, resolved version, prepared state, approximate download size, and the reason when unavailable. Before the first load of an unprepared build, the editor SHALL state the approximate download size.

#### Scenario: Anonymous request never provisions
- **WHEN** an unauthenticated client requests an asset of an unprepared build
- **THEN** the server answers unavailable and makes no outbound request

#### Scenario: Offline first Edit
- **WHEN** the user selects the WordCraft mode on `report.docx`, the build is not prepared, and the server is offline
- **THEN** the mode shows that WordCraft could not be prepared, and the built-in preview still works

#### Scenario: Enabled but not yet restarted
- **WHEN** the plugin was enabled without a server restart and the user selects the WordCraft mode
- **THEN** the mode states that a server restart is required and loads nothing

#### Scenario: Newer latest release offered as update
- **WHEN** WordCraft's channel is `latest`, `0.8.0` is prepared, and the latest web build `0.9.0` is known
- **THEN** status reports WordCraft as needing preparation with version `0.9.0`, and preparing installs `0.9.0`

#### Scenario: Failed update keeps the prepared build
- **WHEN** WordCraft's channel is `latest`, `0.8.0` is prepared, and preparing `0.9.0` fails
- **THEN** status reports WordCraft available with version `0.8.0`

#### Scenario: Pinned channel ignores newer releases
- **WHEN** WordCraft's channel is `pinned` and a newer release exists
- **THEN** status makes no latest-release lookup and reports the verified version

#### Scenario: Supported older shim keeps the build usable
- **WHEN** WordCraft's prepared build carries an older host shim that WordCraft still supports and the server is offline
- **THEN** the WordCraft mode loads that build, and the settings page offers an update

#### Scenario: Unsupported shim requires preparation
- **WHEN** GridCraft's prepared build carries a host shim older than GridCraft supports
- **THEN** status reports GridCraft as needing preparation and the mode loads nothing until it is prepared

### Requirement: The app is loaded only after it is ready, with the tab's file only
The plugin SHALL deliver the tab's snapshot to the app once per instance, only after the app reports it has finished starting, whichever start-up sequence the app's build uses. It SHALL use a per-instance message channel bound by a fresh nonce and accept messages only from its own frame with that nonce, of a known type, within the claim's size limit. Document content SHALL NOT be placed in any URL.

For an app that signals window titles, the document SHALL count as opened when the title names the delivered document; otherwise the editor SHALL report that the document could not be opened. For an app known not to signal titles, the document SHALL count as opened, unconfirmed, when a bounded time has passed since delivery while the app is still running and has reported no start error. If the app fails while starting, the editor SHALL report that the app could not start.

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

#### Scenario: App without a title signal opens
- **WHEN** the user selects "Edit in CADCraft" on `plan.dxf` and CADCraft never reports a window title
- **THEN** the editor shows CADCraft and does not report that the document could not be opened

#### Scenario: Title with a different dash style
- **WHEN** PhotoCraft reports the title `photo.jpg — PhotoCraft` after `photo.jpg` was delivered
- **THEN** the document counts as opened

#### Scenario: App panics while starting
- **WHEN** the app's build fails during start-up before the document is opened
- **THEN** the editor reports that the app could not start and offers to retry, and no document content is sent again

#### Scenario: App with its own loader
- **WHEN** the user selects the LightCraft view mode on `IMG_0001.dng`
- **THEN** the document is delivered only after LightCraft has finished starting

### Requirement: Saves map to the core save path; other formats go to the device
A save SHALL be classified by its file type before its name. A save of the tab's file type under a different file name than the tab's (an in-app "Save As") SHALL first ask the user whether to save it as a copy next to the tab's file, overwrite the tab's file, or cancel. For an app whose saves are named after an inner document title rather than the file (SoundCraft sessions), the first save of the tab's file type in an instance SHALL always ask the same question, whatever its name, and the answer SHALL apply to later saves in that instance under the same suggested name. A save from the app whose file type and name match the tab SHALL be passed to the core handler save as an overwrite or a copy, according to a save-target choice that is always available in the editor and shared by all tabs of the same file. Its outcome SHALL be reported back to the app, so a save that did not happen leaves the document marked unsaved.

The first overwrite from an instance whose document was opened unconfirmed SHALL be preceded by exactly one question, core's first-overwrite notice, which asks the user to check that the app shows the tab's file. Before any save, an edit mode whose app cannot save the tab's file type in place SHALL state which file a save creates, and a view-only mode SHALL state that exports go to the device. For an app whose saves are named after an inner document title, the Save As question SHALL say so. A save in a file type that the handler declares as the app's native sibling type SHALL ask the user whether to create a new file of that type next to the tab's file (also offering to open it for further editing when that type has an available mode), download it to the device instead, or cancel; it SHALL never overwrite an existing file. A save of any other file type (for example an export to PDF), and every save from a view-only mode, SHALL NOT be written to the workspace. The browser SHALL instead offer it as a download to the user's device.

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

#### Scenario: Native sibling save
- **WHEN** the user edits `photo.jpg` in PhotoCraft, saves, and PhotoCraft produces `photo.psd`, and the user chooses to create it
- **THEN** `photo.psd` is created next to `photo.jpg`, `photo.jpg` is unchanged, and the tab still shows unsaved edits

#### Scenario: Native sibling never overwrites
- **WHEN** `photo.psd` already exists and the user creates the PhotoCraft sibling of `photo.jpg`
- **THEN** a new file `photo-2.psd` is created and the existing `photo.psd` is unchanged

#### Scenario: Session-named save asks once
- **WHEN** the user edits `mix.scraftz` in SoundCraft, whose session is named "Midnight Groove", saves, chooses to overwrite `mix.scraftz`, edits again and saves again
- **THEN** the first save asks, saying that SoundCraft names saves after the session, and the second save overwrites `mix.scraftz` without asking

#### Scenario: Unconfirmed open is checked in one question
- **WHEN** the user opened `plan.dxf` in CADCraft, which signals no title, and saves for the first time with the save target "overwrite"
- **THEN** a single question asks the user to check that CADCraft shows the file, offering to overwrite, save as a copy or cancel; nothing is written before choosing and no second question follows

#### Scenario: Where a save goes is shown before saving
- **WHEN** the user opens `photo.jpg` in PhotoCraft
- **THEN** the editor states that saving creates `photo.psd`, before any save

#### Scenario: Create and open the native sibling
- **WHEN** PhotoCraft produces `photo.psd` while editing `photo.jpg` and the user chooses to create and open it
- **THEN** `photo.psd` is created and opens in PhotoCraft's `.psd` edit mode, and later saves there overwrite `photo.psd` in place

#### Scenario: View mode never writes
- **WHEN** the user exports a developed JPEG from the LightCraft view mode on `IMG_0001.dng`
- **THEN** nothing is written to the workspace and the browser offers the JPEG as a download

### Requirement: The editor reports unsaved state conservatively
The plugin SHALL report the instance's unsaved state to core. It SHALL report unsaved after any user input that follows the app's last saved indication. It SHALL report saved only when the last save went to the tab's own file (after a save as copy or a native sibling save the tab's file still lacks the edits), no input followed it, and either the app indicates saved or, for an app that does not clear its own edited indication, core acknowledged that save. Until the app has given any indication, it SHALL report the state as unknown, except that for an app known not to signal its saved state, a freshly opened document SHALL count as saved until the first input.

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

#### Scenario: Freshly opened title-less document counts as saved
- **WHEN** the user opens `plan.dxf` in CADCraft, which signals neither title nor saved state, and closes the tab without input
- **THEN** the tab closes without an unsaved-edits prompt

#### Scenario: Acknowledged save marks saved without an app signal
- **WHEN** the user edits `data.xlsx` in GridCraft, saves it to the tab's file successfully, and types nothing afterwards, while GridCraft keeps showing its document as edited
- **THEN** core sees the instance as saved

### Requirement: Saved bytes must be a document of the tab's kind
The plugin SHALL register a content validator for each of its edit handlers that rejects a save unless the bytes match the structure of the target file type. Validators SHALL only reject, SHALL read archives through their directory only, and SHALL never expand an XML document type or entity declaration; a declaration in a checked XML part SHALL be rejected:

| Extension | Accepted bytes |
|---|---|
| `.docx` `.xlsx` `.pptx` | zip package whose content-types part declares, and whose archive contains, the kind's main document part |
| `.pdf` | PDF header at the start and end-of-file marker at the end |
| `.odt` | OpenDocument zip package whose first member declares the text-document type and which contains its content part |
| `.rtf` | RTF header at the start |
| `.dxf` | ASCII or binary DXF section structure ending in the end-of-file group |
| `.dwg` | DWG version signature of a supported release |
| `.designcraft` `.scraftz` `.deckcraft` | zip package containing the app's required document members |
| `.psd` | Photoshop document signature and a supported version |
| `.png` `.jpg` `.jpeg` `.webp` `.tif` `.tiff` | the signature of the image format the extension names |
| `.vectorcraft` | a VectorCraft JSON document: an object starting with the `"format": "vectorcraft"` member and declaring a version |
| `.svg` | an XML document without a document type declaration whose first element is `svg`, checked in full, that cannot run script when opened directly in a browser: no script-capable or foreign-content element, no event-handler attribute, no animation that sets an event handler or link, and no script URL, also when written with namespace prefixes or character references |

A save in an extension the handler does not declare as its own or sibling type SHALL be rejected.

#### Scenario: Garbage save rejected
- **WHEN** a WordCraft save for `report.docx` carries bytes that are not a zip package
- **THEN** the save is rejected and `report.docx` is unchanged

#### Scenario: Wrong kind rejected
- **WHEN** a save for `report.docx` carries a valid spreadsheet package
- **THEN** the save is rejected and `report.docx` is unchanged

#### Scenario: Wrong format for a non-Office file rejected
- **WHEN** a CADCraft save for `plan.dxf` carries PDF bytes
- **THEN** the save is rejected and `plan.dxf` is unchanged

#### Scenario: Script in SVG rejected
- **WHEN** a VectorCraft save for `logo.svg` carries an SVG document with a `script` element or an `onload` attribute
- **THEN** the save is rejected and `logo.svg` is unchanged

#### Scenario: Entity declaration in SVG rejected
- **WHEN** a VectorCraft save for `logo.svg` carries an SVG document containing an entity declaration
- **THEN** the save is rejected and `logo.svg` is unchanged

### Requirement: Settings page edits per-app enable and version channel
The plugin SHALL contribute a section to its own settings page showing, per claimed app, an enable switch, a version channel selector, the installed and known latest versions, and the app status. For an app whose channel is fixed to its verified version, the page SHALL show that version as read-only text with the reason instead of a selector. Apps SHALL be grouped by what they do to files (edit in place, save in their own format next to the file, view only), and each app SHALL list the file extensions it opens. Edits SHALL be saved through the page's global Save without dropping other stored config keys.

#### Scenario: Switch to latest from the settings page
- **WHEN** the user selects "Latest release" for WordCraft and saves
- **THEN** `plugins["craft-web"].apps.wordcraft.version` is `"latest"` and other stored keys are unchanged

#### Scenario: Fixed channel shown with its reason
- **WHEN** the settings page shows DeckCraft, whose channel is fixed to its verified version
- **THEN** it shows "Verified 0.7.0" with the reason and offers no channel selector, and DeckCraft appears under the apps that save in their own format

## ADDED Requirements

### Requirement: Every app runs under the same isolation
Each app's build SHALL start under the same sandbox flags and content security policy as WordCraft, with no inline executable script left in its document, whatever loader the build ships. Background workers the app starts SHALL load only scripts from the app's own build location. An app that would register a service worker SHALL start with that registration skipped. Preparation SHALL fail, keeping any previously prepared build, when the build's start-up cannot be adapted unambiguously.

#### Scenario: App with workers starts in the sandbox
- **WHEN** a build that starts background workers from its own build location is opened in its mode
- **THEN** the app starts without granting the frame same-origin access, and its workers run

#### Scenario: Worker script outside the build refused
- **WHEN** code inside the frame starts a worker from a script outside the app's build location
- **THEN** the worker's script is blocked under the frame's content security policy

#### Scenario: Unrecognised start-up refused at preparation
- **WHEN** a new release changes its loader so the start-up step the plugin adapts cannot be found exactly once
- **THEN** preparing that release fails, and the previously prepared build stays available

### Requirement: View-only modes have no workspace write path
A view-only craft mode SHALL load the tab's file into the app like an edit mode but SHALL NOT offer a save target, SHALL NOT report unsaved edits to core, and SHALL route every save or export the app produces to a device download.

#### Scenario: Closing a view mode never asks to save
- **WHEN** the user adjusts exposure in the LightCraft view mode on `IMG_0001.dng` and closes the tab
- **THEN** the tab closes without an unsaved-edits prompt and `IMG_0001.dng` is unchanged

### Requirement: An app's version channel can be fixed to its verified version
For an app whose latest web builds are not verified, or are known not to start, the plugin SHALL prepare only the verified version, SHALL ignore a stored latest-channel setting for it, and the settings page SHALL show its channel as fixed with the reason.

#### Scenario: Latest channel ignored for DeckCraft
- **WHEN** DeckCraft's verified version is `0.7.0`, its stored channel is `latest`, and `0.8.0` is the latest web build
- **THEN** status reports DeckCraft with version `0.7.0`, preparing installs `0.7.0`, and the settings page shows the channel fixed with its reason

#### Scenario: New app starts with its channel fixed
- **WHEN** GridCraft has just been added with verified version `0.8.0` and a newer GridCraft web build is published
- **THEN** status reports GridCraft with version `0.8.0` and makes no latest-release lookup for it
