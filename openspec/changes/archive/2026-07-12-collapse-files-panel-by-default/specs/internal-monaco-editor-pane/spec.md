## MODIFIED Requirements

### Requirement: Pane SHALL host a collapsible file-tree rail

The pane SHALL render a file-tree browse rail on the left, rooted at the session's
`cwd`, collapsible via a **labelled, discoverable toggle at the rail↔viewer boundary**
(not a bare unlabelled icon buried among header actions). Rail visibility SHALL persist
per session. In the **absence of a persisted preference** for a session, the rail SHALL
default to **collapsed** so the opened viewer fills the pane width; a user's explicit
toggle SHALL persist per session and override the collapsed default on subsequent opens
(the rail SHALL NOT re-collapse each time the split reopens once the user has revealed
it for that session).

The rail SHALL list a directory's entries from a **single tree-listing source of truth**
returning `{ name: string; isDir: boolean }` per entry, so **hidden directories
(`.`-prefixed, e.g. `.git`, `.pi`) render and expand as folders** — never as files. The
rail SHALL NOT infer directory-ness by intersecting a full name list with a
hidden-stripped directory list.

Each row SHALL show a **per-kind mime icon** derived from the shared `fileKind`
classifier (distinct icon/colour for code, json, markdown, pdf, image, video, audio,
mermaid, folder, hidden-folder). Clicking a file SHALL invoke the file-open path with
the classifier's viewer kind; clicking a directory SHALL expand/collapse it.

#### Scenario: Hidden directory renders and expands as a folder
- **GIVEN** a session cwd containing `.git/` and `.pi/`
- **WHEN** the rail lists the cwd
- **THEN** `.git` and `.pi` render as folders with an expand chevron
- **AND** clicking one expands to show its child entries
- **AND** neither is treated as a file / passed to `openFile`

#### Scenario: Rows show per-kind icons
- **WHEN** the rail lists `index.ts`, `config.json`, `logo.png`, `demo.mp4`, `chime.mp3`, `arch.mmd`, `spec.pdf`
- **THEN** each row shows a distinct mime icon derived from `fileKind`

#### Scenario: Rail toggle is labelled and persistent
- **WHEN** the user collapses the rail via the labelled toggle
- **THEN** the rail hides and the viewer fills the freed width
- **AND** the collapsed state persists across reload

#### Scenario: Rail defaults to collapsed with no persisted preference
- **GIVEN** a session with no persisted rail-visibility preference
- **WHEN** the split content viewer opens (e.g. via `openInSplit`)
- **THEN** the Files rail SHALL be collapsed and the viewer SHALL fill the pane width
- **AND** the labelled `[Files]` toggle SHALL remain present so the rail can be revealed

#### Scenario: Revealed rail stays revealed for the session
- **GIVEN** a session whose split viewer opened with the rail collapsed by default
- **WHEN** the user reveals the rail via the `[Files]` toggle
- **THEN** the revealed state SHALL persist for that session across reload
- **AND** reopening the split for that session SHALL NOT re-collapse the rail
