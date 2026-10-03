## MODIFIED Requirements

### Requirement: On-disk markdown surfaces that carry cwd+path supply the image base

The markdown FILE surfaces that already have `cwd`+`path` in scope SHALL pass
`imageBase={{ cwd, dir }}` to `MarkdownContent`, where `dir` is the previewed file's
directory: `FilePreviewOverlay` (the primary open-a-`.md` modal), the editor-pane
`MarkdownViewer`, and `MarkdownPreview` (the `PreviewCard`/`/view` path). Chat and
thinking surfaces SHALL NOT pass `imageBase`. Surfaces hosted by
`MarkdownPreviewView` (README / spec / skill dialogs, `PackageReadmeDialog`,
`WhatsNewDialog`) have no `cwd`/`path` and are explicitly OUT OF SCOPE — they keep
today's behavior.

The value passed SHALL have a **stable identity** for a given `cwd` and file
path, rather than being constructed fresh on each render. `MarkdownContent` is
wrapped in `React.memo`, which shallow-compares each prop, so a per-render object
literal fails the comparison on every render and defeats the guard entirely.

#### Scenario: FilePreviewOverlay threads the file directory
- **GIVEN** `FilePreviewOverlay` previewing `{ cwd: "/w", path: "docs/review.md" }`
- **WHEN** it renders the `.md` body via `MarkdownContent`
- **THEN** it SHALL pass `imageBase={{ cwd: "/w", dir: "/w/docs" }}`

#### Scenario: Editor-pane MarkdownViewer opts in
- **GIVEN** `MarkdownViewer` in preview mode for `{ cwd: "/w", path: "a/b/n.md" }`
- **WHEN** it renders `MarkdownContent`
- **THEN** it SHALL pass `imageBase={{ cwd: "/w", dir: "/w/a/b" }}`

#### Scenario: Chat surface does not opt in
- **GIVEN** a chat message rendered via `MarkdownContent`
- **WHEN** it renders
- **THEN** no `imageBase` SHALL be passed and local images continue to rely on the `pi-asset:` inliner

#### Scenario: MarkdownPreviewView-hosted surfaces stay out of scope
- **GIVEN** a README rendered through `MarkdownPreviewView` (no `cwd`/`path` prop)
- **WHEN** it renders
- **THEN** no `imageBase` SHALL be passed and the surface keeps its current behavior (not regressed)

#### Scenario: Identity is stable across re-renders of the caller
- **GIVEN** any of the three on-disk surfaces rendering a fixed `cwd` and path
- **WHEN** the surface re-renders without changing `cwd` or path
- **THEN** the `imageBase` value passed SHALL be the same object instance as before, and `MarkdownContent` SHALL NOT re-render

#### Scenario: Identity changes when the file changes
- **GIVEN** one of the three on-disk surfaces
- **WHEN** the previewed `cwd` or path changes
- **THEN** a new `imageBase` value SHALL be passed and `MarkdownContent` SHALL re-render

#### Scenario: Two on-disk surfaces mounted at once
- **GIVEN** two `MarkdownContent` instances rendered with different `imageBase` values
- **WHEN** both are mounted simultaneously
- **THEN** each SHALL resolve its local images against its own base
