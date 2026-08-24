## MODIFIED Requirements

### Requirement: Overlay and editor-pane surfaces share renderers

Every renderer (`MarkdownPreview`, `AsciiDocPreview`, `HtmlPreview`, `PdfPreview`, `VideoPreview`, `ImagePreview`, `YouTubePreview`, `DocxPreview`, `PptxPreview`, `SpreadsheetPreview`, `EmlPreview`, `FallbackPreview`) SHALL be usable in two contexts: the `/pi-view` / `…/view` overlay route (FileLink / OpenFileButton / canvas) and the internal editor pane (`viewer-registry` + `UrlViewer`). The renderer component SHALL NOT contain navigation or surface chrome; the shell is owned by the overlay route component or the editor-pane viewer wrapper. There is no longer an in-chat `PreviewCard` surface.

The overlay route SHALL render in a route-backed overlay container: a `Dialog` over a scrim over the pinned background underlay on desktop, and a `MobileShell` depth panel on mobile. It is no longer full-screen on desktop. The URL SHALL be unchanged by this container choice, and the renderer components SHALL be unaffected — the container is owned by the overlay route component, which is exactly the boundary this requirement already draws.

#### Scenario: Same component, two shells

- **GIVEN** a `.pdf` target opens in the editor pane via `/view`
- **WHEN** the same file is opened through a FileLink overlay
- **THEN** both mount the SAME `PdfPreview` component with the same `target` prop (no separate variant component)

#### Scenario: Overlay route renders in a dialog container on desktop

- **WHEN** `/pi-view?url=…` or `/folder/:cwd/view?path=…` matches on a desktop viewport
- **THEN** the preview SHALL render in a `Dialog` over a scrim over the pinned underlay
- **AND** the URL SHALL be unchanged from the pre-conversion path

#### Scenario: Renderers are unchanged by the container swap

- **GIVEN** the overlay route renders inside a dialog container
- **WHEN** any renderer mounts within it
- **THEN** the renderer SHALL receive the same `target` prop as before
- **AND** SHALL NOT contain navigation or surface chrome of its own
