# use-loopback-link-open.ts — index

`useLoopbackLinkOpen()` → `(e,href)` click handler shared by `MarkdownContent.a()` + `UrlLink`. Plain primary-click of an `isLoopbackUrl(href)` when `useOptionalSplitWorkspace()` present → `preventDefault` + `ctx.openLiveTarget(href)`; modifier/middle-click, non-loopback, and null-context no-op (native `target="_blank"` fallback). UX router, not a trust boundary. See change: open-loopback-links-in-split-viewer.
