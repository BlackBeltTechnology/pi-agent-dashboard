## Why

Opening a `.md` file in the dashboard preview shows a native broken-image glyph
for any embedded local image (`![alt](hero-landing.png)`). The image file sits on
disk next to the document, but `MarkdownPreview` hands the raw text to
`MarkdownContent` with no directory context, so a relative `src` renders as a bare
`<img src="hero-landing.png">` that the browser resolves against the dashboard
origin and 404s. Chat messages already inline local images via the bridge
(`pi-asset:` scheme); the file-preview surface has no equivalent, so authored docs
with figures are unreadable in preview.

## What Changes

- `MarkdownContent` gains an opt-in `imageBase?: { cwd: string; dir: string }` prop
  (delivered via a small `ImageBaseContext`, not a per-render closure). When set, the
  `img` override rewrites **local** image `src`s to `/api/file/raw?cwd=<cwd>&path=<resolved>`
  (via the existing `rawUrl` helper) before the fall-through `<img>`.
- "Local" = no URI scheme prefix AND not protocol-relative (`//`) AND not a fragment.
  `http(s):`/`data:`/`blob:`/`pi-asset:`/`file:`/`cid:`/`//…` all fall through unchanged;
  rewriting is `img`-only. Relative paths resolve against `dir` with browser-safe POSIX
  logic (no `node:path`); POSIX-absolute paths are used verbatim.
- The on-disk file surfaces that already carry `cwd`+`path` pass `imageBase`:
  `FilePreviewOverlay` (primary .md modal), editor-pane `MarkdownViewer`, and
  `MarkdownPreview`. Chat/thinking keep the `pi-asset:` path. `MarkdownPreviewView`-hosted
  README/spec/skill dialogs have no `cwd`/`path` — **out of scope**, unchanged.
- A rewritten image that fails to load renders a neutral "couldn't load image"
  placeholder (via `img` `onError`) instead of the native broken-image glyph.
- No server changes. `/api/file/raw` already serves image bytes gated by
  known-session cwd + `isAllowed` containment; a sibling image under the session
  cwd is already a supported, contained request.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `markdown-preview-view`: the generic markdown preview component gains
  base-path-aware resolution of embedded local image sources. New requirement
  covering relative/absolute rewrite, scheme pass-through, and out-of-cwd handling.

## Discipline Skills

- `security-hardening`: the rewrite feeds user-authored paths into `/api/file/raw`; verify the existing containment gate fully covers relative/absolute/traversal cases (no new bypass).
- `review-code`: non-trivial client change to a shared renderer used by many surfaces — review the scheme-guard ordering and the no-`imageBase` no-regression path before commit.

## Impact

- Client: `packages/client/src/components/preview/MarkdownContent.tsx` (`PiAssetImg`
  img override, new prop + `ImageBaseContext`, `onError` placeholder), and the three
  opt-in call-sites `FilePreviewOverlay.tsx`, editor-pane `MarkdownViewer.tsx`,
  `MarkdownPreview.tsx` (each threads `{cwd, dir}`). New browser-safe POSIX resolve helper.
- Server: none (reuses `/api/file/raw`).
- Security: relies on the existing `/api/file/raw` containment gate. Honest caveat: the
  rewrite is a file-existence oracle within the session cwd (bounded by that gate).
  Global-scope (`~/.pi/agent`, no session) and Windows-native cwds are non-targets.
