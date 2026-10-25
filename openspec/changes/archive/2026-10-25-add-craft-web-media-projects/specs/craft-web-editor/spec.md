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
| `.fcproj` | FilmCraft | edit | device download |
| `.pptx` | DeckCraft | edit | `.deckcraft` sibling |
| `.dng` `.cr2` `.cr3` `.nef` `.arw` `.raf` `.orf` `.rw2` | LightCraft | preview | device download |

Each edit handler SHALL use a size limit: the docx office cap for `.docx`, the sheet office cap for `.xlsx`, the pptx office cap for `.pptx`, and the core handler ceiling otherwise. It SHALL ask to be kept alive, carry the app's fidelity notice as its first-overwrite notice, and use the app id as its copy suffix. For an app known not to signal which document it opened, that notice SHALL also ask the user to check that the app shows the tab's file. An app without a verified web build version SHALL contribute no handler; if one is nevertheless present, it SHALL show as not verified and load nothing. An app disabled in the plugin settings SHALL show its mode as unavailable with that reason, and the server SHALL refuse to prepare it or save through it. EffectCraft and FigCraft SHALL contribute no handler. A FilmCraft handler SHALL open a project together with its media as the media-project requirement states.

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
- **WHEN** the user opens `comp.ecproj`, or opens `cut.fcproj` while FilmCraft has no verified web version
- **THEN** no craft mode is offered

#### Scenario: FilmCraft project offered
- **WHEN** FilmCraft has a verified web version and the user opens `cut.fcproj`
- **THEN** the mode switcher offers "Edit in FilmCraft"

#### Scenario: Extension that failed verification is not offered
- **WHEN** CADCraft's `.dwg` verification failed and the user opens `plan.dwg`
- **THEN** no CADCraft mode is offered for `plan.dwg`, while `plan.dxf` still offers "Edit in CADCraft"

#### Scenario: Preview-only app
- **WHEN** LightCraft has a verified web version, its `.dng` verification passed, and the user opens `IMG_0001.dng`
- **THEN** the mode switcher offers a LightCraft view mode and no LightCraft edit mode

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
| `.fcproj` | a FilmCraft JSON document: an object whose `format` member is `filmcraft.project`, declaring a `schema_version` and a `project` object |
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

### Requirement: The app is loaded only after it is ready, with the tab's file only
The plugin SHALL deliver the tab's snapshot to the app once per instance, only after the app reports it has finished starting, whichever start-up sequence the app's build uses. It SHALL use a per-instance message channel bound by a fresh nonce and accept messages only from its own frame with that nonce, of a known type, within the claim's size limit. Document content SHALL NOT be placed in any URL. For an app whose profile declares a media project, the plugin MAY also deliver the media the project references before the project, each as a host-originated drop acknowledged by the app's shim before the next is sent; no other file reaches the app.

For an app that signals window titles, the document SHALL count as opened when the title names the delivered document; otherwise the editor SHALL report that the document could not be opened. For an app known not to signal titles, the document SHALL count as opened, unconfirmed, when a bounded time has passed since delivery while the app is still running and has reported no start error. If the app fails while starting, the editor SHALL report that the app could not start.

Attempts inside the app to open another file — file chooser, open picker, a drag-and-drop from outside the browser page, or pasting a file — SHALL be refused (host-originated media drops are not such attempts), and the user SHALL be told to open files from the dashboard. Pasting text or image content into the document SHALL keep working.

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

## ADDED Requirements

### Requirement: A media project opens with its media online
For an app whose profile declares a media project format, the plugin SHALL open a project file together with the media it references. It SHALL read the project, find each referenced media file, deliver those media to the app before the project, and give the app a project in which every delivered medium is named by the app's own in-app path. Media SHALL be read only through the authenticated workspace read, and only from the project's own folder and its subfolders. A medium that cannot be delivered (not found, outside the working directory, over a size or count bound) SHALL be left unchanged in the project, and the user SHALL be told how many media are missing.

#### Scenario: Project with media opens online
- **WHEN** the user selects "Edit in FilmCraft" on `edit/story.fcproj` that references `clips/a.mp4` relative to its folder
- **THEN** FilmCraft shows the project with `a.mp4` online, and every media file was read through the workspace read

#### Scenario: Missing medium
- **WHEN** the project references `clips/gone.mp4` and the file does not exist
- **THEN** FilmCraft shows that item offline and the editor reports one missing medium

#### Scenario: Path outside the project folder
- **WHEN** the project references `../../etc/passwd`, `../footage/a.mp4`, or an absolute path outside the project's folder
- **THEN** the file's bytes never reach the app, the item stays offline, and it is counted as missing

#### Scenario: Same file name in two folders
- **WHEN** the project references `a/clip.mp4` and `b/clip.mp4`
- **THEN** both are delivered under distinct in-app names and each project item resolves to its own file

#### Scenario: Size bound
- **WHEN** the project references more media than the per-project count or total-size bound allows
- **THEN** media are delivered in the order the project first references them until the bound is reached, the rest stay offline and are counted as missing

### Requirement: Saving a media project restores the original media paths
When a media project is saved, the plugin SHALL write the project with each medium it delivered named by the exact path string the file had when opened. Media that were not delivered SHALL keep their original path string. Saved bytes SHALL be accepted only if they are a project of the tab's kind.

#### Scenario: Round trip
- **WHEN** the user opens `story.fcproj`, edits a clip's in-point, and saves
- **THEN** `story.fcproj` in the workspace still names `clips/a.mp4` as before and contains the edit

#### Scenario: Missing medium survives a save
- **WHEN** the project references `clips/gone.mp4`, which was missing at open, and the user saves
- **THEN** the saved project still names `clips/gone.mp4` exactly as before

#### Scenario: Not a FilmCraft project
- **WHEN** the app produces bytes that are not a FilmCraft project JSON
- **THEN** the save is refused and the file on disk is unchanged
