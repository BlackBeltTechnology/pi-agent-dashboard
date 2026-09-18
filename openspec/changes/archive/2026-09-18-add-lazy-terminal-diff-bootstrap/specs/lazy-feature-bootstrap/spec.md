# lazy-feature-bootstrap

## Purpose

Keeps heavyweight optional feature code — the terminal emulator family and the
rich diff-viewer family — out of the dashboard's cold-landing dependency graph,
so a first paint downloads and parses only what the chat surface needs, while
each feature still loads on demand the moment its surface opens.

## ADDED Requirements

### Requirement: Cold landing excludes terminal and diff feature code

For a cold landing whose default view contains no terminal surface and no diff
surface, the dashboard SHALL NOT fetch, preload, or execute the terminal-emulator
code or the rich diff-viewer code — including their styles. Both feature families
SHALL be reachable only through asynchronous boundaries entered when their
surface is opened.

A transcript that itself contains a terminal surface (an inline terminal card in
session history) is a view *with* that surface and is outside this requirement;
it is governed by the load-on-open requirement below.

#### Scenario: Landing document does not preload the feature bundles

- **WHEN** a production build is produced and its landing document is inspected
- **THEN** neither the terminal-emulator bundle nor the rich diff-viewer bundle
  is referenced by the entry script or by any module-preload directive of that
  document

#### Scenario: Landing document does not link the feature stylesheets

- **WHEN** a production build is produced and its landing document is inspected
- **THEN** no stylesheet link of that document resolves to the terminal-emulator
  styles or the rich diff-viewer styles

#### Scenario: Restored background terminal tabs do not load terminal code

- **WHEN** the page is loaded in a session whose previously-open tabs include a
  terminal tab that is **not** the restored active tab, and the user has not yet
  viewed a terminal
- **THEN** the terminal code is not fetched
- **AND** the restored terminal tabs are still listed and selectable

#### Scenario: Auto-surfaced terminal tabs open in the background

- **WHEN** a folder view automatically surfaces a tab for each live terminal in
  its working directory
- **THEN** those tabs are opened without taking focus, marked unread, and the
  previously active tab stays active
- **AND** the terminal code is not fetched

#### Scenario: Feature bundles still exist for their routes


- **WHEN** a production build is produced
- **THEN** a terminal-emulator bundle and a rich diff-viewer bundle are both
  still emitted as separately loadable artifacts, in both their code and their
  style form
- **AND** a build missing any of those artifacts fails the check rather than
  passing vacuously

#### Scenario: Chat-path text-diff utility does not drag in the diff viewer

- **WHEN** the chat surface computes per-turn added/removed line counts using
  the plain text-diff utility
- **THEN** loading that utility SHALL NOT cause the rich diff-viewer code to be
  fetched

### Requirement: Feature code loads when its surface opens

Each deferred surface SHALL load its feature code on first open and render its
normal content once loaded, showing a non-blocking loading affordance in the
meantime.

#### Scenario: Viewing a terminal tab

- **WHEN** the user makes a terminal tab the active tab for the first time in a
  page session — whether newly created, restored from a previous session, or
  auto-surfaced by the folder view
- **THEN** the terminal code is fetched and the terminal renders and connects

#### Scenario: Loading affordance fills the pane body

- **WHEN** the terminal surface is still fetching its code
- **THEN** the loading affordance occupies the same pane body region the terminal
  will occupy, so the pane does not visibly collapse

#### Scenario: Opening an inline terminal card in chat

- **WHEN** a chat transcript first renders an inline terminal card
- **THEN** the terminal code is fetched and the card renders its terminal

#### Scenario: Opening a diff surface

- **WHEN** the user opens the session diff view, the diff pseudo-tab, or a file
  edit whose renderer shows a rich diff
- **THEN** the rich diff-viewer code is fetched and the diff renders

#### Scenario: Loading state stays inside the opened surface

- **WHEN** a deferred surface is still fetching its feature code
- **THEN** the loading affordance is confined to that surface's own region
- **AND** the surrounding shell, chat transcript, and tab strip stay rendered
  and interactive

### Requirement: Terminal keep-alive contract is preserved

Deferring the terminal code SHALL NOT change terminal mount lifecycle: a
terminal with a given id is mounted at most once, stays mounted (hidden) while
another tab is active, and is torn down only when its tab is closed.

#### Scenario: Switching away from and back to a terminal tab

- **WHEN** the user switches from a terminal tab to a file tab and back
- **THEN** the terminal is not unmounted or remounted and its connection is not
  re-established
- **AND** the terminal code is not fetched a second time

#### Scenario: Closing the last terminal tab

- **WHEN** the user closes the only open terminal tab
- **THEN** the terminal is unmounted

#### Scenario: No duplicate terminal mount

- **WHEN** a terminal tab is active in an editor pane
- **THEN** exactly one terminal instance exists for that terminal id **within
  that pane**

#### Scenario: Collapsing and reopening the pane does not tear down terminals

- **WHEN** the user collapses the editor pane while terminal tabs are open and
  then reopens it
- **THEN** the open terminals are restored as live terminals, not left listed
  but disconnected
- **AND** no terminal tab is closed by the collapse

### Requirement: Viewer-registry cycle boundary is preserved

The viewer registry and its capped-viewer wrapper SHALL NOT depend on any
pseudo-tab viewer, so that deferring the diff pseudo-tab does not reintroduce a
dependency cycle.

#### Scenario: Registry resolves the diff pseudo-tab without importing it eagerly

- **WHEN** the diff pseudo-tab is requested by key
- **THEN** it resolves to a diff viewer
- **AND** the viewer registry and capped-viewer modules contain no static
  dependency on that viewer
