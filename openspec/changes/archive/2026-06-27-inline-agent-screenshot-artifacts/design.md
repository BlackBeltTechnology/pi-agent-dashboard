# Design — inline-agent-screenshot-artifacts

## Context

Three mechanisms already exist; Fix B wires them together:

```
 markdown-image-inliner.ts   read bytes → mime → base64, caps 5MB/20MB   (bridge)
 inline-image-tool-results   client renders type:"image" blocks inline   (archived)
 browser screenshot          emits TEXT "Screenshot saved: <path>"        (the gap)
```

The gap: a CLI tool's result is a text *path*, not an image *block*. The bridge
has fs access and the base64 toolkit; the client has the renderer. Connect them
at `tool_execution_end`.

## Inline-at-capture flow

```
tool_execution_end
      │  result text contains an absolute path to an existing image file?
      ▼
  resolveLocalPath + stat
      │  exists, recognized image ext, size ≤ MAX_PER_IMAGE_BYTES,
      │  running total ≤ MAX_PER_MESSAGE_BYTES, under per-result count cap?
      ├─ yes ─► read bytes → base64 → attach type:"image" content block
      │          (no path-link emitted for that image)
      └─ no  ─► leave the path as text → linkified → Fix A serves it (fallback)
```

## Decisions

### D1 — Reuse `markdown-image-inliner.ts`, do not reimplement

`resolveLocalPath`, `mimeFromExtension`, `hashBytes`, and the `MAX_PER_IMAGE_BYTES`
/ `MAX_PER_MESSAGE_BYTES` caps already exist and are tested. Extract a shared
`inlineLocalImagePath(absPath, opts): AssetToEmit | ReadFileError` if the current
`inlineMessageText` seam does not expose single-path inlining cleanly. One
toolkit, two callers (markdown + tool-result paths).

### D2 — Detection: existing local image path, conservatively scoped

Inline a path only when it (a) is absolute, (b) ends in a recognized image
extension, and (c) resolves to an existing file. This deliberately does NOT try
to parse `Screenshot saved:` prose specifically — any tool result that surfaces a
real local image path benefits, and brittle per-tool string matching is avoided.
Cap the number of images inlined per result (e.g. ≤ 4) to bound work and payload.

### D3 — Caps decide inline-vs-link; over-cap falls back to Fix A

A file over `MAX_PER_IMAGE_BYTES`, or one that would push the result past
`MAX_PER_MESSAGE_BYTES`, is left as a text path. It then linkifies and is served
by Fix A's `/api/file/raw` artifact anchor. So large screenshots still preview
(via A), they just are not embedded. This is why A and B ship together.

### D4 — Emit the existing content-block shape

Inlined images use the same `type:"image"` block the `Read`-tool inline change
already produces and the client already renders. Verify the **generic** tool-call
renderer (not only `ReadToolRenderer`) displays inlined image blocks; extend it
minimally if it currently ignores image blocks for non-Read tools. Auto-expand
the tool call when it carries an image (matching the archived behavior).

### D5 — B primary, A fallback (no double-render)

When B inlines an image, the corresponding path is consumed (not also emitted as
a separate text link), so the dashboard shows exactly one inline image, not an
image plus a dead link. A is reached only for paths B did not inline (over-cap or
legacy events).

## Risks

| Risk | Mitigation |
|------|------------|
| Event-store / WS bloat from base64 | D3 caps (5MB/image, 20MB/result) + per-result count cap; same precedent as Read-tool inline |
| Over-eager inlining of unrelated paths | D2 — absolute + image-ext + must-exist; count-capped |
| Inlining a sensitive local image the agent referenced | Same trust as agent fs access; image-ext + existing-file only; bridge already runs as the user |
| Double render (inline image + dead link) | D5 — consume the path when inlined |
| Generic renderer ignores image blocks for non-Read tools | D4 — verify + minimal extension |

## Alternatives considered

- **Upstream `agent-browser` change** to emit a structured image result. Cleanest
  but an external-CLI change; out of scope. Dashboard-side bridge inlining is
  self-contained.
- **Server-side inlining** (read + base64 in the event store on the server).
  Rejected: the bridge already has the file locally and the inliner toolkit; the
  server would need its own containment-free read path, reintroducing the very
  trust question Fix A wrestles with.
