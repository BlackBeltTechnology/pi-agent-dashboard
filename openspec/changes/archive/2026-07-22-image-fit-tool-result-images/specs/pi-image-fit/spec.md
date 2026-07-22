## ADDED Requirements

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
