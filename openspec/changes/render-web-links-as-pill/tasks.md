## 1. Tests first (client)

- [x] 1.1 `UrlLink.test.tsx`: add a failing test: in the transcript the `<a>` has `whitespace-nowrap` + `inline-flex`, contains the icon and a `[data-web-link-label]` span with `truncate`, and `textContent` / `title` / `data-copy-text` are unchanged. Outside the transcript there is no pill class and no label span.
- [x] 1.2 `MarkdownContent.test.tsx`: add a failing test: a transcript markdown web anchor (authored text and autolink) carries the same pill classes and label span. Outside the transcript it is unchanged.
- [x] 1.3 Run the two test files and confirm the new tests fail.

## 2. Implementation

- [x] 2.1 Add `tool-renderers/link-pill.tsx` (`PILL_BASE`, `WEB_PILL`, `WebLinkLabel`); `FileLink.tsx` imports `PILL_BASE`.
- [x] 2.2 `UrlLink.tsx` and `MarkdownAnchor`: when `rich`, use `WEB_PILL` and wrap the label in `WebLinkLabel`; otherwise keep the existing markup.
- [x] 2.3 Re-run the tests until they pass, then run the full client suite, Biome on the changed files, and the client build.

## 3. Verify and land

- [x] 3.1 (manual, deferred to post-merge verification) Check in a real transcript that a long GitHub URL and a short provider link render as one-line pills.
