## Why

Chat web links can wrap in the wrong places. In the transcript, a web link shows a provider icon (`LinkIconSlot`) followed by its text. Both `UrlLink.tsx` (tool output) and `MarkdownAnchor` in `MarkdownContent.tsx` (assistant markdown) render the icon and the text as separate inline pieces inside a plain `<a>`. A long URL that doesn't fit leaves the icon at the end of one line and the URL on the next. `render-file-links-as-pill` fixed the same problem for file links and listed web links as a non-goal; this change covers them.

## What Changes

- In the transcript (inside a `LinkResolutionProvider`), a web link that shows a provider icon renders as **one no-wrap pill**: the `<a>` itself becomes the pill (icon + label), with the same chrome as file-link pills. It never breaks inside; when it does not fit, the whole pill moves to the next line.
- **Long URLs shorten at the end** with an ellipsis, so the scheme and domain stay visible (`https://github.com/BlackBelt…`). File links shorten at the start instead, because their file name is at the end. The DOM text, `title`, `aria-description` and `data-copy-text` keep the full URL, so copy and assistive tech are unchanged.
- **Inside inline code**, the pill drops its border, background and padding, like file links.
- **Shared styling:** the pill classes move to one helper used by `FileLink`, `UrlLink` and `MarkdownAnchor`, so file and web pills stay identical.
- **Not affected:**
  - anchors outside the transcript, which keep their current DOM
  - links with a non-http href (`#…`, `/…`, mailto)
  - relative anchors, which already render as file links

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `tool-output-linkification`: ADDED requirement "Transcript web links render as a single no-wrap pill".

## Non-goals

- Changing provider recognition, labels, icons, click routing or the pane / live-viewer behaviour.
- Middle-truncation of URLs.

## Relationship

- Follows `render-file-links-as-pill` (archived 2026-11-23) and reuses its pill styling.
- Mockup: none new. The visual design is the approved file-link pill (`openspec/changes/archive/2026-11-23-render-file-links-as-pill/mockups/`), applied to web links with end truncation.

## Discipline Skills

- `review-code`: non-trivial client change across 3 components; run inline review once tests pass.
- No security, performance, observability or irreversible-step trigger: presentational only. The href gate (`classifyUrl`, `safeUrlTransform`) is untouched.

## Impact

- New `packages/client/src/components/tool-renderers/link-pill.tsx` (shared pill classes + web label).
- `FileLink.tsx` (imports the shared base), `UrlLink.tsx`, `preview/MarkdownContent.tsx` (`MarkdownAnchor`).
- Tests: `UrlLink.test.tsx`, `MarkdownContent.test.tsx`.
- No server, protocol or persistence change; no migration. Rollback = revert the client commit.
