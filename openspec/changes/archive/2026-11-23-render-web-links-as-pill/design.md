## Context

`render-file-links-as-pill` wraps a file link's button and HTML chevron in a `<span data-file-link-pill>`. Its classes live as `PILL_BASE` / `pillClass` inside `FileLink.tsx`. Web links have one element, the `<a>`, with an optional `LinkIconSlot` and a text node. They are rendered in two places: `UrlLink` (linkified tool output) and `MarkdownAnchor` (markdown).

## D1 — The anchor is the pill

The `<a>` gets the pill classes directly instead of a wrapper `<span>`. There is only one interactive element, so no wrapper is needed, and the href, click routing, `title`, `aria-description` and `data-copy-text` stay on the same element as today. Applied only when `rich` is set (transcript + http(s) + classified), which is exactly when the icon shows today.

## D2 — Shared helper

New `tool-renderers/link-pill.tsx`:
- `PILL_BASE`, moved from `FileLink.tsx` without changes: no-wrap inline-flex, rounded, border, inline-code descendant variant.
- `WEB_PILL`: `PILL_BASE` + `border-[var(--border-secondary)] bg-[var(--bg-secondary)] text-[var(--link)] hover:border-[var(--link)]`. These are the same tokens as a found file link.
- `WebLinkLabel`: `<span data-web-link-label class="truncate min-w-0">`.
- `WebLinkBody` (icon + label) and `webLinkClass(rich, plain)` keep both anchors within the Biome complexity limit; `MarkdownAnchor` also moves its `rich` / `autolink` classification into `classifyWebAnchor`. It truncates at the end, in normal LTR direction, so the domain stays visible.

`FileLink` imports `PILL_BASE`; its behaviour is unchanged.

## D3 — Truncation direction

URLs are read from the left: scheme and host identify the target. File paths are read from the right: the file name identifies the target. Hence start truncation for files and end truncation for URLs. The full URL is in `title` either way.

## Accessibility

- The accessible name is still the full DOM text (label) plus `aria-description` with the full URL.
- Focus stays on the `<a>`.
- Colours are `--link` on `--bg-secondary`, the same pair as file links, already checked in both themes.
