# pi-image-fit Specification

## Purpose
TBD - created by archiving change pi-image-fit-extension. Update Purpose after archive.
## Requirements
### Requirement: Pi extension package distribution

The system SHALL ship a standalone pi extension package at `packages/image-fit-extension/` in this monorepo, published to npm as `@blackbelt-technology/pi-image-fit`, that declares a single pi extension entry point via the `pi.extensions` field in its `package.json` and is installable via `pi install @blackbelt-technology/pi-image-fit` without requiring any other monorepo package or the dashboard.

#### Scenario: Standalone install without dashboard

- **WHEN** a user runs `pi install @blackbelt-technology/pi-image-fit` on a machine that has pi but not the dashboard installed
- **THEN** the install completes successfully, the extension loads into the next pi session, and the `tool_call` hook activates without any dashboard-related dependency resolution

#### Scenario: Workspace publish via existing release pipeline

- **WHEN** the monorepo release pipeline runs `npm version --workspaces --include-workspace-root` followed by the per-workspace publish loop
- **THEN** `@blackbelt-technology/pi-image-fit` is bumped to the same version as every other workspace package and published to npm with no workflow-file changes required

### Requirement: Tool-call mutation seam

The extension SHALL register a single `pi.on("tool_call", ...)` handler that intercepts calls where `event.toolName === "read"` and `event.input.path` ends with one of `.png`, `.jpg`, `.jpeg`, `.webp`, `.gif` (case-insensitive). For non-matching calls the handler MUST return immediately without I/O.

#### Scenario: Non-read tool call passes through

- **WHEN** the agent invokes any tool other than `read` (e.g. `bash`, `write`, `edit`)
- **THEN** the handler returns without reading the filesystem, without invoking jimp, and without mutating `event.input`

#### Scenario: Non-image read passes through

- **WHEN** the agent invokes `read` with a path whose extension is not in the image allowlist (e.g. `src/app.ts`, `README.md`)
- **THEN** the handler returns without reading the filesystem, without invoking jimp, and without mutating `event.input.path`

#### Scenario: Image read triggers the resize pipeline

- **WHEN** the agent invokes `read` with a path ending in `.png`, `.jpg`, `.jpeg`, `.webp`, or `.gif`
- **THEN** the handler proceeds to threshold evaluation per the resize policy requirement

### Requirement: Resize threshold policy

The extension SHALL resize an image when EITHER its byte size exceeds the configured byte threshold OR its long-edge pixel dimension exceeds the configured pixel threshold. Default thresholds SHALL be 1568 pixels for the long edge AND 4,194,304 bytes (4 MiB). When both byte size and long edge are at or below their thresholds, the extension MUST NOT mutate `event.input.path` and MUST NOT write a temp file.

#### Scenario: Already-small image passes through untouched

- **WHEN** the agent reads an image whose file size is ≤ 4 MiB and whose long edge is ≤ 1568 px
- **THEN** the handler completes without resizing, without writing a temp file, and without modifying `event.input.path`

#### Scenario: Oversize byte count triggers resize

- **WHEN** the agent reads an image whose byte size exceeds the byte threshold (regardless of dimensions)
- **THEN** the extension produces a resized webp temp file and mutates `event.input.path` to point at it

#### Scenario: Oversize dimensions trigger resize

- **WHEN** the agent reads an image whose long edge exceeds the pixel threshold (regardless of byte size)
- **THEN** the extension produces a resized webp temp file and mutates `event.input.path` to point at it

#### Scenario: Dimension probe short-circuit on small byte size

- **WHEN** the source image's byte size is below the byte threshold
- **THEN** the extension MAY skip dimension probing if the image was confirmed by metadata alone to be under the long-edge threshold, but MUST decode dimensions before declaring the image already-small whenever a metadata-only probe is not available

### Requirement: Resize implementation

When the resize policy triggers, the extension SHALL re-encode the image with the long edge scaled to the configured maximum (default 1568 px) preserving aspect ratio. Output format SHALL be chosen adaptively from the source: PNG input produces PNG output (lossless); all other input formats (`.jpg`, `.jpeg`, `.webp`, `.gif`) produce JPEG output at the configured quality (default 85, configurable via `PI_IMAGE_FIT_QUALITY`). The extension SHALL use the `jimp` library and MUST NOT depend on `sharp`, `@napi-rs/image`, or any other native-binary image processor.

#### Scenario: Long-edge scaling preserves aspect ratio

- **WHEN** a 4032×3024 image is resized with a 1568 px long-edge target
- **THEN** the output dimensions are 1568×1176 (or within ±1 px of the proportional value)

#### Scenario: Portrait orientation respects long edge

- **WHEN** a 3024×4032 portrait image is resized with a 1568 px long-edge target
- **THEN** the output dimensions are 1176×1568

#### Scenario: PNG input produces PNG output

- **WHEN** the source path ends in `.png` (case-insensitive) and a resize fires
- **THEN** the temp file is written as `.png` (lossless re-encoding)

#### Scenario: Non-PNG input produces JPEG output

- **WHEN** the source path ends in `.jpg`, `.jpeg`, `.webp`, or `.gif` and a resize fires
- **THEN** the temp file is written as `.jpg` at the configured quality (default 85)

#### Scenario: No native dependency

- **WHEN** the package's `dependencies` are inspected after install
- **THEN** the dependency tree contains `jimp` and does not contain `sharp`, `@napi-rs/image`, or any other package that downloads platform-specific prebuilt binaries

### Requirement: Temp-file cache

The extension SHALL cache resized output keyed by a SHA-256 hash of `${absolutePath}|${mtime}|${maxEdge}|${maxBytes}|${quality}`. Cache files SHALL live in a session-scoped subdirectory under `os.tmpdir()/pi-image-fit/`. Cache file extension SHALL match the output format chosen per the Resize implementation requirement (`.png` for PNG-in, `.jpg` for other inputs). On the `session_shutdown` event the extension MUST remove its session-scoped cache directory.

#### Scenario: Cache hit on repeat read

- **WHEN** the agent reads the same image twice in the same session with no file modification between reads
- **THEN** the second read uses the cached webp file (no jimp re-encode) and `event.input.path` points at the same temp file as the first read

#### Scenario: Cache invalidation on mtime change

- **WHEN** the agent reads an image, the source file's mtime changes, and the agent reads it again
- **THEN** the second read produces a fresh resize (new cache key, new temp file) rather than serving stale output

#### Scenario: Cache invalidation on threshold change

- **WHEN** the user changes `PI_IMAGE_FIT_MAX_EDGE` mid-session and the agent reads a previously-cached image
- **THEN** the new threshold produces a new cache key and a fresh resize

#### Scenario: Session-scoped cleanup

- **WHEN** the pi session emits `session_shutdown`
- **THEN** the extension's session-scoped cache directory under `os.tmpdir()/pi-image-fit/` is removed before the handler returns

#### Scenario: Orphan cleanup on extension load

- **WHEN** the extension loads
- **THEN** any subdirectory under `os.tmpdir()/pi-image-fit/` whose modification time is older than 24 hours is removed (best-effort; failures are logged and ignored)

### Requirement: Environment-variable configuration

The extension SHALL accept the following environment variables, read once on extension load:

- `PI_IMAGE_FIT_DISABLE` — when set to a truthy value (`1`, `true`, `yes`, case-insensitive), the extension MUST register no hooks and MUST log a single-line message indicating it is disabled.
- `PI_IMAGE_FIT_MAX_EDGE` — positive integer overriding the long-edge pixel threshold; default 1568.
- `PI_IMAGE_FIT_MAX_BYTES` — positive integer overriding the byte-size threshold; default 4194304.
- `PI_IMAGE_FIT_QUALITY` — integer 1–100 overriding the webp output quality; default 85.

Invalid values (non-numeric, out of range) MUST fall back to the documented default and emit a single warning line naming the variable and the fallback.

#### Scenario: Disable kill switch

- **WHEN** the user starts a pi session with `PI_IMAGE_FIT_DISABLE=1` and reads an image larger than the default thresholds
- **THEN** the extension performs no resize, writes no temp file, and the agent receives the original image bytes via the built-in Read

#### Scenario: Custom threshold override

- **WHEN** the user starts a pi session with `PI_IMAGE_FIT_MAX_EDGE=1024` and reads a 1200×800 image
- **THEN** the extension resizes to 1024×683 (long edge ≤ 1024) even though the image was under the default 1568 px threshold

#### Scenario: Invalid value falls back to default

- **WHEN** the user starts a pi session with `PI_IMAGE_FIT_QUALITY=abc`
- **THEN** the extension uses quality 85, logs a single warning line naming `PI_IMAGE_FIT_QUALITY` and the fallback value, and continues normally

### Requirement: Defensive fall-through on failure

The extension SHALL wrap the entire hook body in a try/catch that, on any thrown error (file read error, jimp decode error, fs write error, dimension probe error, cache I/O error), leaves `event.input.path` unmodified so the built-in Read receives the original file path. The catch MUST log a single warning line including the source path and the error message, and MUST NOT re-throw. A handler failure MUST NOT block the agent's Read call.

#### Scenario: Jimp decode failure falls through

- **WHEN** the agent reads a file with an image extension whose contents jimp cannot decode (corrupted, truncated, or otherwise malformed)
- **THEN** `event.input.path` retains its original value, a single warning line is logged, the built-in Read receives the original path, and the Read tool result is whatever pi's built-in Read produces for that file

#### Scenario: Source file missing falls through

- **WHEN** the agent reads a non-existent path with an image extension
- **THEN** the handler logs a warning, leaves `event.input.path` unmodified, and lets the built-in Read produce its normal ENOENT error path

#### Scenario: Temp-file write failure falls through

- **WHEN** the temp-file write fails (e.g. disk full, permission denied)
- **THEN** `event.input.path` is reverted to its original value, a warning is logged, and the built-in Read uses the original file

#### Scenario: Handler never re-throws

- **WHEN** any error occurs anywhere inside the hook body
- **THEN** the handler returns normally and pi's tool-execution pipeline proceeds without seeing a thrown exception from the extension

### Requirement: Resize telemetry

When a resize occurs, the extension SHALL emit exactly one `console.log` line in the format `[pi-image-fit] <relativeOrAbsolutePath> <srcW>×<srcH> <srcBytes>B → <dstW>×<dstH> <dstBytes>B`. No telemetry SHALL be emitted on already-small pass-throughs, on non-image reads, or on non-read tool calls.

#### Scenario: Resize emits one log line

- **WHEN** the extension resizes an image
- **THEN** exactly one log line in the documented format is emitted on stdout via `console.log`

#### Scenario: Pass-through emits no log line

- **WHEN** the extension processes a read of an already-small image (no resize)
- **THEN** no log line is emitted

#### Scenario: Failure emits warning, not info

- **WHEN** the extension's defensive fall-through fires
- **THEN** the warning line uses `console.warn` (or a `[pi-image-fit] WARN ` prefix) and is distinguishable from a normal resize log line

### Requirement: Default-on behavior

The extension SHALL be active when installed, with no opt-in flag required. The on/off contract is governed solely by `PI_IMAGE_FIT_DISABLE` per the configuration requirement. Installation MUST be sufficient to enable the feature for all subsequent pi sessions on that machine.

#### Scenario: Active immediately after install

- **WHEN** a user installs the extension and starts a new pi session with no environment-variable overrides
- **THEN** the next image Read that exceeds default thresholds is resized

### Requirement: Pi peer-dependency compatibility

The package SHALL declare `@earendil-works/pi-coding-agent` and `@mariozechner/pi-coding-agent` as optional peer dependencies (mirroring the bridge extension's dual-org pattern) and SHALL function with either dual-org pi runtime that exposes the documented `tool_call` event with mutable `event.input`.

#### Scenario: Earendil-org pi runtime

- **WHEN** the package is installed alongside `@earendil-works/pi-coding-agent`
- **THEN** the extension loads and the `tool_call` handler fires

#### Scenario: Mariozechner-org pi runtime

- **WHEN** the package is installed alongside `@mariozechner/pi-coding-agent`
- **THEN** the extension loads and the `tool_call` handler fires

### Requirement: Documentation updates

The change SHALL update the following monorepo documentation surfaces to reflect the new package:

- `AGENTS.md`: the "5 packages" reference near the release flow updated to "6 packages".
- `docs/file-index.md`: the splits table updated with a row for the new package's area (own split file or folded into the extension split — implementer's choice with rationale captured in the task list).
- `release-cut` skill description: "5 npm packages" → "6 npm packages".
- `ci-troubleshoot` skill description: "5 npm packages" → "6 npm packages".
- Package README at `packages/image-fit-extension/README.md` documenting install, environment variables, default thresholds, telemetry shape, and the silent-quality-loss caveat.

#### Scenario: Docs grep returns zero "5 packages" hits after change

- **WHEN** the change lands
- **THEN** `grep -rn '5 packages\|5 npm packages' AGENTS.md docs/ .pi/skills/` returns no matches that refer to the workspace package count

#### Scenario: File-index has a row for the new package

- **WHEN** the change lands
- **THEN** the path `packages/image-fit-extension/` (or a representative file within it) appears in exactly one `docs/file-index-*.md` split file with a caveman-style one-line purpose

### Requirement: Surfaced in the dashboard recommended-extensions manifest

The dashboard SHALL include `@blackbelt-technology/pi-image-fit` as an entry in the curated `RECOMMENDED_EXTENSIONS` manifest (`packages/shared/src/recommended-extensions.ts`) so the extension appears in the Recommended Extensions card and is installable via the standard recommended-extension install path. The entry MUST declare `source: "npm:@blackbelt-technology/pi-image-fit"`, `status: "optional"`, a non-empty `fallbackDescription` naming the resize thresholds, and a non-empty `unlocks` list. The entry MUST NOT declare `dashboardPlugin` or `toolsRegistered`, since the extension registers no tools and has no companion dashboard plugin. The entry MUST NOT be added to `BUNDLED_EXTENSION_IDS`.

#### Scenario: Entry present in the manifest

- **WHEN** `RECOMMENDED_EXTENSIONS` is read
- **THEN** exactly one entry has id `@blackbelt-technology/pi-image-fit` with `source` `npm:@blackbelt-technology/pi-image-fit` and `status` `optional`

#### Scenario: npm-source prefix invariant holds

- **WHEN** the manifest test checks that every npm-sourced entry uses the `npm:` prefix
- **THEN** the `pi-image-fit` entry satisfies the invariant (no git HTTPS URL)

#### Scenario: Not bundled in the Electron offline set

- **WHEN** `BUNDLED_EXTENSION_IDS` is checked against `RECOMMENDED_EXTENSIONS`
- **THEN** `@blackbelt-technology/pi-image-fit` is a recommended id but is NOT in `BUNDLED_EXTENSION_IDS`, and the bundled-set-is-subset-of-recommended invariant still holds

#### Scenario: Rendered in the Recommended Extensions card

- **WHEN** the dashboard fetches `/api/packages/recommended` and renders `RecommendedExtensions.tsx`
- **THEN** a card for `pi-image-fit` is shown with its enriched description and an install affordance, with no component code change required

### Requirement: Message-content interception seam

The extension SHALL register a single `pi.on("context", ...)` handler that inspects the `event.messages` deep copy before each LLM call, fits every oversize image content block (`{ type: "image", data, mimeType }`) per the Content-block resize policy, and returns `{ messages }` ONLY when at least one image was resized. The handler MUST traverse EVERY message whose `content` is an array regardless of message role (user, tool result, and custom/injected messages), because all of them reach the provider; it MUST NOT branch on role. A message whose `content` is a plain string MUST be skipped without error (it carries no image). When no image is resized the handler MUST return `undefined` (or nothing) so the original message list is used unchanged. The handler MUST NOT be registered when `PI_IMAGE_FIT_DISABLE` is truthy. This seam operates on pi's in-flight deep copy and MUST NOT rewrite the on-disk session transcript.

#### Scenario: Oversize tool-result image is fitted before the provider call

- **WHEN** a message contains an image content block produced by a tool result (e.g. a browser screenshot) whose long edge exceeds the pixel threshold
- **THEN** the handler resizes that block and returns `{ messages }` with the block's `data` replaced by the smaller encoding, so the request sent to the provider is within limits

#### Scenario: Oversize user-pasted image is fitted

- **WHEN** a user message contains a pasted/attached image content block that exceeds the byte or pixel threshold
- **THEN** the handler resizes that block the same way, regardless of the image's origin

#### Scenario: Already-persisted oversize session is rescued on reload

- **WHEN** a session whose transcript already contains an oversize image content block is resumed and the next LLM call fires
- **THEN** the `context` handler resizes the block in the deep copy before the call, producing a within-limits request without any change to the on-disk transcript

#### Scenario: All-small messages pass through unmodified

- **WHEN** no image content block in `event.messages` exceeds either threshold
- **THEN** the handler returns `undefined` (no `{ messages }`), performing no re-encode and no message-list allocation

#### Scenario: Non-image content is never mutated

- **WHEN** messages contain text, tool-call, or other non-image content blocks
- **THEN** the handler leaves those blocks untouched and only ever modifies `type === "image"` blocks

#### Scenario: Oversize image in a custom/injected message is fitted regardless of role

- **WHEN** an oversize image content block appears in a message whose role is not `user` or `tool` (e.g. a custom or extension-injected message that still carries `content: (TextContent | ImageContent)[]` and will be converted for the provider)
- **THEN** the handler resizes it the same as any other block, because traversal is role-agnostic

#### Scenario: String message content is skipped without error

- **WHEN** a message's `content` is a plain string rather than a content-block array
- **THEN** the handler skips that message without throwing and without logging a warning

#### Scenario: Disabled via environment variable

- **WHEN** `PI_IMAGE_FIT_DISABLE` is truthy at extension load
- **THEN** the `context` handler is not registered and no message content is inspected

### Requirement: Content-block resize policy

The extension SHALL resize an image content block when EITHER its decoded byte size exceeds the configured byte threshold OR its long-edge pixel dimension exceeds the configured pixel threshold, reusing the same defaults as the read-path seam (1568 px long edge, 4 MiB bytes). Because a small byte size does not bound pixel dimensions, the extension MUST determine the image's dimensions before declaring a block already-small; a byte-size-only short-circuit is NOT sufficient. To keep the steady-state cost low, the extension SHALL determine dimensions via a cheap image-header probe (no full pixel decode) and estimate byte size from the encoded data length; a block within both thresholds MUST be skipped at this gate without a full decode, without hashing, and without a cache entry. A full decode SHALL occur only when a block is an oversize candidate and no cache entry exists (i.e. only on an actual resize). On resize the long edge SHALL be scaled to at most `maxEdge` preserving aspect ratio. Output format SHALL be adaptive from the block's `mimeType`: `image/png` produces PNG output (lossless); all other mime types produce JPEG output at the configured quality (default 85). The block's `mimeType` MUST be updated to match the output format. The extension MUST use `jimp` and MUST NOT depend on `sharp`, `@napi-rs/image`, or any other native-binary image processor.

#### Scenario: Oversize dimensions under the byte threshold still trigger a resize

- **WHEN** an image content block is under the 4 MiB byte threshold but its long edge exceeds the pixel threshold (e.g. an 8956×5080 PNG at ~411 KB)
- **THEN** the extension resizes it, confirming the policy does not short-circuit on byte size alone

#### Scenario: Oversize byte count triggers a resize

- **WHEN** an image content block's decoded byte size exceeds the byte threshold regardless of its dimensions
- **THEN** the extension resizes and re-encodes it to a smaller block

#### Scenario: Within-limit image is skipped at the cheap-probe gate

- **WHEN** an image content block is at or below both the byte and pixel thresholds
- **THEN** the extension determines this from the header probe + byte estimate alone, performing no full pixel decode, no hash, and no cache write for that block

#### Scenario: Long-edge scaling preserves aspect ratio

- **WHEN** a 4032×3024 image content block is resized with a 1568 px long-edge target
- **THEN** the output dimensions are 1568×1176 (within ±1 px of the proportional value)

#### Scenario: PNG stays PNG, other formats become JPEG

- **WHEN** an oversize block has `mimeType` `image/png`
- **THEN** the output block is PNG with `mimeType` `image/png`; **AND WHEN** an oversize block has `mimeType` `image/webp`, `image/gif`, or `image/jpeg`, the output block is JPEG with `mimeType` `image/jpeg` at the configured quality

### Requirement: Content-hash cache for message-content fits

Because the `context` handler runs before every LLM call and re-sees the same historical image blocks each turn, the extension SHALL cache message-content resize results in memory keyed by a hash of `${base64Data}|${mimeType}|${maxEdge}|${maxBytes}|${quality}`, so that an unchanged oversize image block is decoded and re-encoded at most once per distinct content+format+threshold combination. The key MUST include `mimeType` so two blocks with identical bytes but different declared formats do not collide and serve the wrong output format. Only oversize candidates (those that fail the cheap-probe gate of the Content-block resize policy) are ever hashed or cached; images already within limits MUST NOT be hashed. The cache SHALL be bounded by a fixed byte budget with least-recently-used eviction so that long, image-heavy sessions cannot grow memory without limit. This in-memory cache is independent of the read-path temp-file cache; the `context` path MUST NOT write temp files.

#### Scenario: Repeat turn serves from cache without re-encoding

- **WHEN** the same oversize image block appears in `event.messages` on a subsequent turn with unchanged thresholds
- **THEN** the handler reuses the cached resized bytes and performs no additional jimp re-encode for that block

#### Scenario: Threshold change invalidates the cache entry

- **WHEN** `PI_IMAGE_FIT_MAX_EDGE` differs from a previously cached fit for the same image
- **THEN** the new threshold yields a different cache key and a fresh resize

#### Scenario: Same bytes, different declared format do not collide

- **WHEN** two oversize image blocks share identical base64 `data` but declare different `mimeType` values
- **THEN** the `mimeType` in the cache key yields two distinct entries, so each block is re-encoded to the output format its own mime dictates and neither serves the other's bytes

#### Scenario: Bounded eviction under many distinct images

- **WHEN** the number (or total bytes) of distinct cached fits exceeds the configured cap
- **THEN** the least-recently-used entries are evicted so the cache stays within its bound

### Requirement: Fail-open message-content fitting

Any failure while fitting an image content block (undecodable data, resize error, or unexpected exception) MUST leave the affected message content unmodified, emit at most one `[pi-image-fit] WARN ...` line, and MUST NOT block or fail the LLM call. A single unprocessable image MUST NOT prevent other oversize images in the same turn from being fitted.

#### Scenario: Undecodable image block passes through untouched

- **WHEN** an image content block's `data` cannot be decoded by jimp
- **THEN** that block is left unchanged, a single warning is logged, and the turn proceeds

#### Scenario: One bad image does not stop the others

- **WHEN** a turn contains one undecodable oversize block and one valid oversize block
- **THEN** the valid block is still resized while the undecodable block passes through unchanged

