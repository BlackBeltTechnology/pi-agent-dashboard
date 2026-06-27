# inline-agent-screenshot-artifacts

## Why

The robust fix for the "Failed to load image" screenshot failure (see
`serve-agent-artifact-previews`, Fix A) is to remove the failure mode entirely:
deliver the screenshot **inline at capture time** so there is never a
containment-guarded path-link to break.

Today the `browser` skill's `screenshot` command emits a **text** result
`Screenshot saved: /Users/…/.agent-browser/tmp/screenshots/…png`. The dashboard
linkifies that absolute path; clicking it loads the image via
`/api/file/raw`, which contains paths to the session repo and 403s for an
out-of-repo artifact. Fix A widens the route (best-effort) but cannot cover a
`--screenshot-dir` CLI path, and serving from a shared root leaks screenshots
across projects.

Inlining sidesteps all of it. The bridge runs **inside the pi session process
with unrestricted filesystem access**, and it already inlines local images for
markdown: `markdown-image-inliner.ts` reads bytes → mime → base64 with per-image
(5 MB) and per-message (20 MB) caps. The `Read`-tool inline path
(`2026-04-04-inline-image-tool-results`) already renders `type:"image"` content
blocks inline client-side. Fix B connects these two existing mechanisms for
**path-referenced** tool results.

When the bridge inlines the bytes at capture, there is no path-link, no
`/api/file/raw` call, no containment check, no `--screenshot-dir` gap, and no
cross-project leak (each event self-carries only its own image).

## What Changes

- At `tool_execution_end` extraction (bridge `event-forwarder.ts`), detect
  tool-result text that references an **existing local image file** by absolute
  path (recognized image extension) and inline it as a `type:"image"` content
  block, reusing `markdown-image-inliner.ts` helpers (`resolveLocalPath`,
  `mimeFromExtension`, byte read, base64, `hashBytes`, the existing caps).
- Respect the existing caps: skip files over `MAX_PER_IMAGE_BYTES`; stop at
  `MAX_PER_MESSAGE_BYTES` total per result. Over-cap images are **left as a
  path-link** (they fall back to Fix A serving). Bound the number of images
  inlined per result.
- Emit the same content-block shape the client already renders inline; confirm
  the generic tool-call renderer (not only `ReadToolRenderer`) displays inlined
  image blocks, extending it minimally if not.
- No new route, no protocol change beyond the already-supported image content
  block, no server containment change.

## Relationship to Fix A (`serve-agent-artifact-previews`)

Complementary, not exclusive:

```
 Fix B (this)   inline at capture   → primary path; no link, no route, no leak
 Fix A          serve over /raw     → fallback for over-cap images + legacy
                                       events captured before B shipped
```

When B inlines, A is never reached for that image. A remains the safety net for
images too large to inline and for historical path-links already in the store.

## Impact

- Affected specs: `inline-artifact-image-paths` (new); touches the existing
  `inline-image-tool-results` / `tool-renderers` capabilities.
- Affected code:
  - `packages/extension/src/event-forwarder.ts` — inline path-referenced image
    results at `tool_execution_end`.
  - `packages/extension/src/markdown-image-inliner.ts` — reuse; extract a
    shared `inlineLocalImagePath(absPath, opts)` if a clean seam does not exist.
  - `packages/client/src/components/tool-renderers/*` — ensure generic renderer
    shows inlined image blocks (may already work via the archived change).
- Bridge reload required after merge (`npm run reload`).

## Security / cost notes

- The bridge can inline **any** local image the agent references, including
  paths outside any artifact root. This matches existing trust: the bridge runs
  as the user and the agent already reads arbitrary files. Mitigated by
  inlining only recognized image extensions, only existing files, and within the
  per-image / per-message byte caps.
- Base64 images persist in the event store (same tradeoff the `Read`-tool inline
  change already accepted). The caps bound growth; over-cap images stay as
  links.

## Out of Scope

Changing `agent-browser` itself to emit a structured image block (rather than a
text path) would be cleaner still but is an upstream-CLI change. This proposal
keeps the fix dashboard-side by inlining at the bridge.
