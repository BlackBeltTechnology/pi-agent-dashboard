## ADDED Requirements

### Requirement: Embedded local images resolve against the file's directory

When `MarkdownContent` renders markdown that was loaded from a file on disk, the
caller SHALL be able to supply the file's location via an `imageBase?: { cwd: string; dir: string }`
prop, where `cwd` is the owning session working directory and `dir` is the
directory containing the markdown file (both absolute). When `imageBase` is
present, the `img` renderer SHALL rewrite embedded local image sources to the
`/api/file/raw?cwd=<cwd>&path=<resolved>` endpoint so the sibling image bytes are
served instead of 404ing against the dashboard origin.

Rewriting SHALL apply ONLY to `img` elements, and ONLY when the `src` is a
**local path** — defined as a `src` that (a) does NOT match a URI scheme prefix
(`/^[a-z][a-z0-9+.-]*:/i`), (b) does NOT start with `//` (protocol-relative), and
(c) does NOT start with `#` (fragment). A **relative** local path (`hero.png`,
`./hero.png`, `../assets/hero.png`) SHALL be resolved against `dir` using
browser-safe POSIX segment logic (no `node:path`); a **POSIX-absolute** local path
(`/w/doc/hero.png`) SHALL be used as the resolved path directly (not re-joined).
The resolved path SHALL be URL-encoded when placed in the `path` query parameter
so filenames containing spaces or non-ASCII characters load correctly. When
`imageBase` is absent (chat, thinking, and other non-file surfaces), behavior
SHALL be unchanged.

#### Scenario: Relative image resolves to the raw endpoint
- **GIVEN** `MarkdownContent` rendered with `imageBase={{ cwd: "/w", dir: "/w/docs" }}`
- **WHEN** the markdown contains `![Hero](hero-landing.png)`
- **THEN** the `img` src SHALL be `/api/file/raw?cwd=/w&path=/w/docs/hero-landing.png` (query values URL-encoded)
- **AND** the browser SHALL load the sibling file rather than showing a broken-image glyph

#### Scenario: Dot and parent relative paths resolve against dir
- **GIVEN** `imageBase={{ cwd: "/w", dir: "/w/docs/design" }}`
- **WHEN** the markdown contains `![x](../assets/x.png)`
- **THEN** the resolved `path` SHALL be `/w/docs/assets/x.png`

#### Scenario: Local-absolute path used directly
- **GIVEN** `imageBase={{ cwd: "/w", dir: "/w/docs" }}`
- **WHEN** the markdown contains `![x](/w/media/x.svg)`
- **THEN** the resolved `path` SHALL be `/w/media/x.svg` (not re-joined with `dir`)
- **AND** the SVG SHALL be served with an image content type by the raw endpoint

#### Scenario: Filenames with spaces or accents are URL-encoded
- **GIVEN** `imageBase={{ cwd: "/w", dir: "/w/docs" }}`
- **WHEN** the markdown contains `![x](kép áttekintés.png)`
- **THEN** the `path` query parameter SHALL be percent-encoded so the request targets `/w/docs/kép áttekintés.png`

#### Scenario: Non-local schemes and protocol-relative srcs fall through unchanged
- **GIVEN** `imageBase` is present
- **WHEN** the image `src` carries a URI scheme (`http(s):`, `data:`, `blob:`, `pi-asset:<hash>`, `file:`, `cid:`) OR starts with `//` (protocol-relative)
- **THEN** the src SHALL NOT be rewritten to the raw endpoint
- **AND** `pi-asset:` SHALL still resolve via `SessionAssetsContext` as before

#### Scenario: No base means no rewrite
- **GIVEN** `MarkdownContent` rendered without `imageBase` (chat/thinking surface)
- **WHEN** the markdown contains `![x](hero.png)`
- **THEN** the `img` SHALL render with the original `src` verbatim (existing behavior)

#### Scenario: A rewritten image that fails to load shows a neutral placeholder
- **GIVEN** `imageBase={{ cwd: "/w", dir: "/w/docs" }}` and a rewritten image whose request fails (out-of-cwd 403, missing-file 404, or network error — indistinguishable to `onError`)
- **WHEN** the `img` `onError` fires
- **THEN** the component SHALL render (in place of the `<img>`, unmounting it so no `minHeight` reserve leaks) an inline neutral "couldn't load image" placeholder (styled like the dashed `pi-asset:` placeholder, non-interactive) rather than the native broken-image glyph

#### Scenario: The verbatim (non-rewritten) path keeps its current failure behavior
- **GIVEN** a chat surface (`imageBase` absent) rendering an external `<img>` whose request fails
- **WHEN** the image errors
- **THEN** the placeholder SHALL NOT be shown and the existing verbatim behavior (broken image still click-opens the lightbox) SHALL be preserved unchanged

### Requirement: On-disk markdown surfaces that carry cwd+path supply the image base

The markdown FILE surfaces that already have `cwd`+`path` in scope SHALL pass
`imageBase={{ cwd, dir }}` to `MarkdownContent`, where `dir` is the previewed file's
directory: `FilePreviewOverlay` (the primary open-a-`.md` modal), the editor-pane
`MarkdownViewer`, and `MarkdownPreview` (the `PreviewCard`/`/view` path). Chat and
thinking surfaces SHALL NOT pass `imageBase`. Surfaces hosted by
`MarkdownPreviewView` (README / spec / skill dialogs, `PackageReadmeDialog`,
`WhatsNewDialog`) have no `cwd`/`path` and are explicitly OUT OF SCOPE — they keep
today's behavior.

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
