# @blackbelt-technology/pi-image-fit-extension

Pi extension that resizes oversize images at Read-time so they fit model
byte and pixel ceilings.

The extension hooks `pi.on("tool_call", ...)`. When the agent runs the
built-in `read` tool with an image path (`.png`, `.jpg`, `.jpeg`, `.webp`,
`.gif`), the extension:

1. Stats the file and (lazily) probes dimensions via [jimp](https://github.com/jimp-dev/jimp).
2. If the image already fits both thresholds, leaves `event.input.path`
   untouched — built-in Read sees the original bytes, no temp file, no
   telemetry.
3. Otherwise, re-encodes the image (long-edge scaled, aspect-ratio
   preserved) into a session-scoped temp file under
   `os.tmpdir()/pi-image-fit/<session>/<sha256>.<ext>` and mutates
   `event.input.path` to point at it. Built-in Read attaches the smaller
   image to the agent's context window.

No native binary deps — `jimp` only. No `electron-rebuild` step, no
platform-specific prebuilt downloads. Pure JS install on every supported
pi target.

## Second seam: the `context` event (any-origin images)

The `read`-tool seam above only covers images the agent opens through the
built-in `read` tool. Images that enter a session as **message content** —
`tool_result` screenshots (browser / MCP), user-pasted / attached images, and
images already persisted in a transcript — never pass through `read`, so a
second seam catches them.

The extension also hooks `pi.on("context", ...)`, fired before every LLM call
on a deep copy of the message list. For every message (regardless of role) it
walks the content blocks and, for each oversize `ImageContent`
(`{ type: "image", data, mimeType }`), resizes the bytes in-memory with jimp
and replaces `data` + `mimeType`. Because it runs on the in-flight copy every
turn, it also **rescues already-persisted oversize sessions on reload** — a
case no creation-time hook can cover (e.g. a session poisoned by an 8956×5080
browser screenshot that is under the byte limit but over the pixel limit).

How it stays cheap on the per-turn hot path:

- A **cheap header-probe gate** reads dimensions from the image header bytes
  (PNG / JPEG / WEBP / GIF) and estimates size from the base64 length — no
  full pixel decode. An image already within limits costs only this probe.
- An oversize image is hashed (SHA-256 of
  `base64|mimeType|maxEdge|maxBytes|quality`) and its resized bytes cached in
  a **bounded in-memory LRU** (~64 MiB, evicted by byte budget). The same
  historical image reappearing every turn is served from the cache — no
  re-encode.

The on-disk transcript is **never rewritten** — only pi's per-turn deep copy
is mutated, so the request sent to the model is always within limits while the
original bytes stay on disk. This seam reuses the same `PI_IMAGE_FIT_*`
thresholds and honors `PI_IMAGE_FIT_DISABLE` (which disables both seams). Any
per-block failure falls open (one `WARN`, block passed through unchanged) so a
single bad image never blocks a turn.

> **GIF animation:** an oversize `image/gif` is re-encoded to a static JPEG
> (first frame only) — same trade-off as the `read`-path seam.

## Install

```bash
pi install @blackbelt-technology/pi-image-fit-extension
```

The next pi session loads the extension. No dashboard or other workspace
package required.

## Default thresholds

| Setting | Default | Env var |
| --- | --- | --- |
| Long-edge pixels | 1568 | `PI_IMAGE_FIT_MAX_EDGE` |
| Byte size | 4,194,304 (4 MiB) | `PI_IMAGE_FIT_MAX_BYTES` |
| JPEG quality | 85 | `PI_IMAGE_FIT_QUALITY` |
| Kill switch | off | `PI_IMAGE_FIT_DISABLE` |

Resize triggers when **either** the byte size **or** the long edge
exceeds its threshold. When both are at or below their thresholds, the
extension is a no-op.

## Environment variables

- `PI_IMAGE_FIT_DISABLE` — truthy (`1`, `true`, `yes`, case-insensitive)
  skips the `pi.on("tool_call", ...)` registration entirely; the
  extension logs a single disabled-message line on load and does nothing
  else.
- `PI_IMAGE_FIT_MAX_EDGE=<px>` — positive integer; override the
  long-edge threshold.
- `PI_IMAGE_FIT_MAX_BYTES=<bytes>` — positive integer; override the byte
  threshold.
- `PI_IMAGE_FIT_QUALITY=<1-100>` — JPEG output quality. Ignored for
  PNG-in → PNG-out path (always lossless).

Invalid values fall back to the documented default and log a single
warning line naming the variable.

## Output format

Format-adaptive:

- `.png` source → PNG output (lossless re-encode preserves transparency).
- everything else → JPEG at the configured quality.

Cache file extension matches the chosen output format.

## Telemetry

On a successful resize the extension emits exactly one line:

```
[pi-image-fit] <path> <srcW>×<srcH> <srcBytes>B → <dstW>×<dstH> <dstBytes>B
```

No log on already-small pass-throughs, on non-image reads, or on
non-`read` tool calls. Failures log a single `[pi-image-fit] WARN ...`
line and fall through to the original path (the agent's Read behaves
exactly as if the extension were not installed).

## Caveat: silent quality loss

A 4K screenshot squashed to 1568 px may lose fine text. The agent has no
way to tell that resize fired beyond the console log line. If pixel
perfect Read matters for a workflow, set `PI_IMAGE_FIT_DISABLE=1` in
that environment.

## License

MIT. Part of the [pi-agent-dashboard](https://github.com/BlackBeltTechnology/pi-agent-dashboard)
monorepo; versions move in lockstep with the rest of the workspace.
