## ADDED Requirements

### Requirement: method:"input" supports optional image attachments via a disk-backed side channel

The `ask_user` tool's standalone `method:"input"` branch and the `input` step of the `method:"batch"` wizard SHALL accept an optional `images?: ImageContent[]` side channel. When images are present, the tool SHALL persist each image to disk under `~/.pi/dashboard/attachments/<sessionId>/<hash>.<ext>` and include the resulting absolute paths in the tool result so the calling LLM may invoke its own `Read` tool to view them.

The two methods use different transports (since change `redesign-ask-user-question-cards`, #76):

1. **Standalone** `method:"input"` rides `PromptResponse.images`. The dashboard's `InputRenderer` SHALL be permitted to call `onRespond({ value: string, images?: ImageContent[] })` where `images` is an array of `{type: "image", data: <base64>, mimeType: <"image/jpeg" | "image/png" | "image/gif" | "image/webp">}`. The `PromptResponse` interface in `packages/extension/src/prompt-bus.ts` SHALL gain an optional `images?: ImageContent[]` field (purely additive). The matching `PromptResponseBrowserMessage` in `packages/shared/src/browser-protocol.ts` SHALL gain the same optional field.
2. **Batch** rides `ctx.ui.batch`. The `input` variant of `BatchAnswer` in `packages/shared/src/protocol.ts` SHALL gain an optional `images?: ImageContent[]` field; `BatchRenderer` includes pasted images in the per-step answer, and they ride inside the `{answers}` payload (JSON-encoded into the bus `answer` string). No per-sub-question `PromptResponse.images` channel is used.
3. The bridge SHALL patch `(ctx.ui as any).inputWithImages` (next to the existing `ctx.ui.input` patch, where `bus`/`sessionId`/`connection` are in scope). For **standalone** `method:"input"`, the `ask_user` tool SHALL dispatch through `ctx.ui.inputWithImages(...)` when present (else fall back to `ctx.ui.input(...)`, text-only). For **batch**, the tool SHALL keep its single `ctx.ui.batch(...)` dispatch; the bridge SHALL extend that patch to process `answers[].images`. Attachment persistence and `asset_register` emission live in the bridge (importing the pure `ask-user-attachments.ts` helper), not in the tool. All other methods (`confirm`, `select`, `multiselect`) SHALL continue to dispatch through `ctx.ui.*` unchanged.
4. When a resolved input answer carries no `images` (or an empty array), the tool's behavior and result shape SHALL be byte-for-byte identical to the pre-change behavior for both standalone `method:"input"` and the batch `input` step.

#### Scenario: input response with no images (backward compat)
- **WHEN** the dashboard renderer resolves `method:"input"` with `{ value: "hello world" }` (no `images`)
- **THEN** the tool SHALL return `{content: [{type: "text", text: 'User responded: "hello world"'}], details: {method: "input", result: "hello world"}}`
- **AND** no files SHALL be written to `~/.pi/dashboard/attachments/`
- **AND** no `asset_register` events SHALL be emitted

#### Scenario: input response with one image
- **WHEN** the dashboard renderer resolves `method:"input"` with `{ value: "check this", images: [{type: "image", data: "<base64 png>", mimeType: "image/png"}] }`
- **THEN** the tool SHALL write the decoded bytes to `~/.pi/dashboard/attachments/<sessionId>/<hash>.png` where `<hash> = sha256(bytes).slice(0,16)`
- **AND** the tool SHALL return `{content: [{type: "text", text: 'User responded: {"value":"check this","attachments":[{"path":"<absolute path>","mimeType":"image/png","bytes":<N>}]}'}], details: {method: "input", result: {value: "check this", attachments: [...]}}}`

#### Scenario: input response with multiple images of different types
- **WHEN** the dashboard renderer resolves with `{ value: "screenshots", images: [{type: "image", data: "<png>", mimeType: "image/png"}, {type: "image", data: "<jpg>", mimeType: "image/jpeg"}] }`
- **THEN** the tool SHALL write two files with extensions `.png` and `.jpg` respectively
- **AND** the `attachments` array in the result SHALL have two entries in the same order as the incoming `images` array

#### Scenario: input change does not affect confirm/select/multiselect
- **WHEN** the `ask_user` tool dispatches `method:"confirm"`, `method:"select"`, or `method:"multiselect"`
- **THEN** the call SHALL continue to flow through `ctx.ui.confirm` / `ctx.ui.select` / `polyfillMultiselect` exactly as before this change
- **AND** the result shape for these methods SHALL be unchanged

#### Scenario: batch sub-question with input + images
- **WHEN** a `method:"batch"` call has a sub-question `{method: "input", title: "Paste the error"}` and the user pastes an image while answering that step in the `BatchRenderer` wizard
- **THEN** the image SHALL ride in that step's `BatchAnswer.images` inside the single `{answers}` payload (no per-question bypass)
- **AND** the bridge's `ctx.ui.batch` patch SHALL persist that answer's images and rewrite its mapped result to `{value, attachments}` before returning to the tool
- **AND** the index-aligned `details.results[i]` and the numbered summary line for that sub-question SHALL carry `{value, attachments}` instead of a bare string
- **AND** other sub-questions in the same batch SHALL be unaffected

### Requirement: Pasted images are persisted under ~/.pi/dashboard/attachments/<sessionId>/

The `ask_user` attachment writer SHALL persist each `ImageContent` from a `method:"input"` response to a content-addressable file under `~/.pi/dashboard/attachments/<sessionId>/<hash>.<ext>`. Hash is `sha256(bytes).slice(0,16)` (matching `markdown-image-inliner.hashBytes`). The extension is derived from the MIME type via the allowlist: `image/png` → `.png`, `image/jpeg` → `.jpg`, `image/gif` → `.gif`, `image/webp` → `.webp`.

The writer SHALL be idempotent: if a file at the resolved path already exists, the write SHALL be skipped (content-addressable means re-writing the same bytes is a no-op anyway). The per-session directory SHALL be created (`mkdir -p` semantics) before the first write to it. Writes that fail SHALL be logged and the image silently dropped from the resulting `attachments[]` array — partial success is preferred over rejecting the entire response.

#### Scenario: Per-session directory is created lazily
- **GIVEN** `~/.pi/dashboard/attachments/<sessionId>/` does not yet exist
- **WHEN** the first image is persisted for `<sessionId>`
- **THEN** the directory SHALL be created with mkdir -p semantics
- **AND** the file SHALL land inside it

#### Scenario: Same image pasted twice dedups by hash
- **WHEN** the user pastes the same image twice across two separate `ask_user{method:"input"}` calls in the same session
- **THEN** the file at `~/.pi/dashboard/attachments/<sessionId>/<hash>.<ext>` SHALL be written once (the second call SHALL detect the existing file and skip the write)
- **AND** both tool results SHALL include the same absolute path in their `attachments[]` array

#### Scenario: Filename uses MIME-derived extension
- **WHEN** an image with `mimeType: "image/jpeg"` is persisted
- **THEN** the resulting filename SHALL end with `.jpg` (not `.jpeg`)
- **WHEN** an image with `mimeType: "image/png"` is persisted
- **THEN** the resulting filename SHALL end with `.png`

#### Scenario: Disk write failure is non-fatal
- **GIVEN** writing one of several images fails (e.g. ENOSPC, EACCES)
- **WHEN** the tool builds the result
- **THEN** the failed image SHALL be omitted from `attachments[]`
- **AND** an error SHALL be logged
- **AND** the surrounding tool call SHALL still resolve with the remaining successful attachments

### Requirement: Per-image and per-response byte caps mirror markdown-image-inliner

The attachment side channel SHALL enforce the same caps as `markdown-image-inliner`: 5 MB per image (`MAX_PER_IMAGE_BYTES`) and 20 MB cumulative per `ask_user` response (`MAX_PER_MESSAGE_BYTES`). Caps SHALL be enforced both client-side (by `useImagePaste`, which already drops oversize blobs with a transient banner) and bridge-side as a defense-in-depth check (inside the bridge's `persistAnswerImages` helper).

#### Scenario: Bridge re-validates per-image cap
- **WHEN** an image larger than 5 MB somehow reaches the bridge (e.g. client-side cap was bypassed)
- **THEN** the bridge SHALL drop that image from the `attachments[]` array
- **AND** an error SHALL be logged identifying the image's hash and size

#### Scenario: Cumulative cap caps total response bytes
- **WHEN** a single response carries images whose summed base64 size exceeds 20 MB
- **THEN** the bridge SHALL drop images in array order until cumulative bytes are within the cap
- **AND** dropped images SHALL be logged

### Requirement: Pasted images surface as thumbnails in the ask_user tool card

For each successfully persisted image, the bridge SHALL emit one `asset_register` message (per-session-deduplicated by hash) so the dashboard's `AskUserToolRenderer` card can render a thumbnail. This is independent of the disk-write path: the disk file is for the LLM's `Read`, the `asset_register` is for the user's chat-history view. Both fire on resolve.

The emission SHALL use the same `connection.send({type: "asset_register", sessionId, hash, mimeType, data})` shape established by `markdown-image-inliner` callsites in `bridge.ts`.

#### Scenario: asset_register fires once per new hash per session
- **WHEN** an image with hash `H1` is pasted in `ask_user{method:"input"}`
- **THEN** the bridge SHALL emit `asset_register {sessionId, hash: H1, mimeType, data}` exactly once for that session
- **WHEN** the same image (same hash `H1`) is pasted again later in the same session
- **THEN** the bridge SHALL NOT emit a second `asset_register` for `H1` (the dashboard already has the bytes)

#### Scenario: Multiple images emit multiple asset_register events
- **WHEN** an `ask_user{method:"input"}` response carries three distinct images
- **THEN** the bridge SHALL emit three `asset_register` events (one per unique hash) BEFORE returning the tool result

### Requirement: Tool result JSON shape evolves only when attachments are present

The `ask_user` tool's text-content result SHALL preserve its current `User responded: ${JSON.stringify(result)}` shape unchanged when no attachments are present. When attachments are present, the `result` object embedded in the JSON SHALL be `{value: string, attachments: Array<{path: string, mimeType: string, bytes: number}>}` instead of a bare string.

This rule applies to both the standalone `method:"input"` result and the per-sub-question entries in the `method:"batch"` numbered summary.

#### Scenario: Text-only input preserves bare-string result
- **WHEN** the user submits "hello" with no images
- **THEN** the tool result text SHALL be exactly `User responded: "hello"`
- **AND** the `details.result` field SHALL be the bare string `"hello"`

#### Scenario: Input with attachments emits object result
- **WHEN** the user submits "see attached" with one image
- **THEN** the tool result text SHALL be `User responded: {"value":"see attached","attachments":[{"path":"<abs>","mimeType":"image/png","bytes":<N>}]}`
- **AND** the `details.result` field SHALL be `{value: "see attached", attachments: [{path, mimeType, bytes}]}`

#### Scenario: Batch summary line uses same shape for input sub-questions
- **WHEN** a batch contains an `input` sub-question whose answer carried attachments
- **THEN** the numbered summary line for that sub-question SHALL be `${i+1}. ${title}: {"value":"...","attachments":[...]}` and `details.results[i]` SHALL be `{value, attachments}`
- **AND** other sub-question types (confirm→boolean / select→string / multiselect→string[]) in the same batch SHALL keep their existing `JSON.stringify` rendering

### Requirement: Attachment directory is cleaned up on session_end (best-effort)

When a session ends (the bridge's existing `session_end` hook fires), the attachment writer SHALL attempt to remove the session's attachment directory (`~/.pi/dashboard/attachments/<sessionId>/`) recursively. Failures SHALL be logged and swallowed. Orphans from crashed dashboards are tolerated; no separate prune CLI is part of this change.

#### Scenario: session_end deletes the per-session directory
- **GIVEN** `~/.pi/dashboard/attachments/<sid>/` contains one or more attachment files from a session
- **WHEN** the bridge's `session_end` hook fires for `<sid>`
- **THEN** the attachment cleanup SHALL be invoked
- **AND** the directory SHALL be removed recursively (`fs.rmSync(dir, { recursive: true, force: true })` semantics)

#### Scenario: session_end cleanup tolerates a missing directory
- **GIVEN** no attachments were ever written for `<sid>` (so the directory does not exist)
- **WHEN** the bridge's `session_end` hook fires
- **THEN** the cleanup SHALL be a no-op (no error thrown, no log noise)

#### Scenario: session_end cleanup tolerates errors
- **GIVEN** the per-session attachment directory cannot be removed (e.g. EACCES)
- **WHEN** cleanup is invoked
- **THEN** the failure SHALL be logged at warn-or-error level
- **AND** the session_end handler SHALL still complete normally (no exception propagates)

### Requirement: InputRenderer is multiline with image-paste support

The `InputRenderer` component at `packages/client/src/components/interactive-renderers/InputRenderer.tsx` SHALL render an autosizing `<textarea>` instead of a single-line `<input type="text">`. The textarea SHALL accept clipboard image paste via the existing `useImagePaste` hook in controlled mode and SHALL display a thumbnail preview strip (the existing `ImagePreviewStrip`) above itself. The Submit button and the `Cmd/Ctrl+Enter` keyboard shortcut SHALL invoke `onRespond({value, images})` where `images` is omitted (or empty) when no images were pasted. The bare `Enter` key SHALL insert a newline. The `Esc` key SHALL invoke `onCancel`.

The textarea SHALL NOT advertise image-paste support via a placeholder hint, helper text, or visual affordance — the paste capability is silent, matching the main composer's `CommandInput`.

The textarea + paste wiring SHALL be extracted into a shared `<InputComposer>` component consumed by both `InputRenderer` (registry `type:"input"`) and `BatchRenderer`'s `StepBody` `input` arm (registry `type:"batch"`), since #76 routes standalone-input and batch through separate renderers. Via `InputRenderer`, the upgrade SHALL apply uniformly to every callsite routing `type:"input"` through `PromptBus`: standalone `ask_user{method:"input"}`, the `polyfillMultiselect` input fallback path, and any third-party extension issuing input prompts. The batch `input` step gets the same UX via `BatchRenderer`'s `StepBody`.

#### Scenario: Enter inserts a newline, Cmd/Ctrl+Enter submits
- **GIVEN** the textarea has focus and the user has typed "line one"
- **WHEN** the user presses `Enter`
- **THEN** a newline SHALL be inserted at the cursor
- **AND** `onRespond` SHALL NOT be called
- **WHEN** the user then presses `Cmd+Enter` (or `Ctrl+Enter` on non-Mac)
- **THEN** `onRespond({value: "line one\n"})` SHALL be called

#### Scenario: Paste an image attaches it without inserting text
- **GIVEN** the textarea has focus
- **WHEN** the user pastes an image from the clipboard
- **THEN** the image SHALL be added to the controlled `pendingImages` array via `useImagePaste`
- **AND** the textarea text SHALL NOT change (no base64 data URL inserted as text)
- **AND** a thumbnail SHALL appear in the `ImagePreviewStrip` above the textarea

#### Scenario: Submit with both text and images
- **GIVEN** the textarea contains "describe this:" and one image is in the preview strip
- **WHEN** the user clicks Submit
- **THEN** `onRespond({value: "describe this:", images: [<the image>]})` SHALL be called
- **AND** the preview strip SHALL clear

#### Scenario: Cancel discards pending images
- **GIVEN** one or more images are in the preview strip
- **WHEN** the user presses `Esc` or clicks Cancel
- **THEN** `onCancel()` SHALL be called
- **AND** the pending images SHALL be discarded (not persisted, not sent)

#### Scenario: No image-paste discoverability hint
- **WHEN** the textarea is rendered in its idle (no-input) state
- **THEN** its placeholder SHALL NOT mention images, paste, attachments, or any related affordance
- **AND** no separate helper text or icon SHALL advertise paste support
