## Why

A follow-up prompt sent while the agent is streaming loses its images. The
bridge buffers the entry as a bare string (`bridge.ts:409`,
`let bridgeFollowUp: string[]`), so `msg.images` is discarded at
`command-handler.ts:773` and the drain ships text only
(`bridge.ts:525`, `pi.sendUserMessage(entry)` on a `string`). The failure is
silent: the client accepts the image, the chip renders the text, and the model
never receives the attachment. Nothing in the UI reports the loss.

The spec on this point is **internally contradictory**, and the code followed
the wrong half:

- `mid-turn-prompt-queue` requires *"Drain preserves image attachments"*
  (`spec.md:149-152`) and types `edit_followup_entry { …, images? }`
  (`spec.md:613`).
- The same spec defines the buffer as `bridgeFollowUp: string[]`
  (`spec.md:200`) — which cannot hold an image.

`rework-mid-turn-prompt-queue` replaced the image-carrying `PendingPrompt`
buffer with the `string[]`, recorded the loss as a code comment ("Known
Limitation", `bridge.ts:440-443`), and left the drain requirement stale. This
change reconciles the two halves in favour of delivery.

Delivery is the bug. This is distinct from the display-only bugs fixed by
`fit-attachments-for-display` and by `fix-pasted-image-message-vanishes`.
The latter matters here: before it landed, a drained image-bearing message
busted the 256 KiB per-event ceiling and collapsed to a `{ __truncated }`
placeholder, so the user saw **no chat row at all**. Delivering images on the
drain would have shipped a second, quieter half of this bug. That half is now
closed upstream (the store preserves the message envelope and strips only the
bytes), so this change fixes delivery alone — but the drained row rendering is
an observable it MUST verify, not assume. Tracked as issue #415.

## What Changes

- `bridgeFollowUp` becomes an entry array carrying `{ text, images? }` instead
  of `string[]`. The drain hands the entry to pi as a content array
  (`[{type:"text"}, {type:"image"}…]`), the shape pi already accepts on the
  idle and steer paths.
- `onFollowupSent` gains the images parameter so `command-handler.ts` stops
  discarding `msg.images` on the buffer path.
- The image-validation + content-array assembly currently private to
  `sendUserMessageWithImages` (`command-handler.ts:1027`) is extracted so the
  bridge drain reuses it — **without** its `deliverAs` behaviour. The drain
  MUST call `pi.sendUserMessage` with no send options; passing
  `{deliverAs:"followUp"}` is a known-broken path (the entry never drains —
  `rework-mid-turn-prompt-queue` design D2, restated at `bridge.ts:466-476`).
  The extraction therefore separates *validation + content assembly* from
  *send options*.
- **Image-block shape**: sizing and validation read image bytes and mime
  through the canonical accessors in `packages/shared/src/image-block.ts`
  (`imageBlockData`, `imageBlockMime`), never through a direct `.data` /
  `.mimeType` property read. Two block shapes circulate in this codebase (flat
  pi + nested Anthropic `source`), and a direct read sizes a nested block at
  **zero bytes** — a silent bypass of the byte ceiling below — and drops it as
  "invalid mime" on the validation path. `send_prompt` carries the flat shape
  today (`useImagePaste.ts:118`), so this is defence against drift, not a
  behaviour change.
- **Wire shape**: `pendingQueues.followUp` gains a per-entry image **count**
  so a queued chip can show an attachment indicator. Image bytes stay
  extension-side and never cross the wire — the count is display-only.
  **BREAKING**: `followUp` elements stop being bare strings, so every consumer
  changes. Retires the v1 requirement *"Image attachments are not displayed on
  chips in v1"* (`spec.md:139`) and the stale optimistic-card scenario it
  carries (`spec.md:141-147`), which contradicts `optimistic-prompt/spec.md:8`
  (mid-turn sends never set `pendingPrompt`).
- **Byte budget**: the follow-up buffer gains an aggregate byte ceiling
  alongside the existing 20-entry `FOLLOWUP_QUEUE_CAP` (`bridge.ts:428`).
  Entry count alone bounds nothing:
  - The send path applies no downscale — `useImagePaste.ts:113` admits
    anything under `MAX_IMAGE_SIZE = 10 * 1024 * 1024` (`:38`). The 768 px
    derivative is a *server-side storage* fit and does not apply here.
  - There is **no per-send image-count cap** anywhere: `image-paste/spec.md:40`
    permits multiple images per send, and every client `images.length` use is a
    `> 0` presence check, never a ceiling. So the worst case is
    `20 entries × N images × 10 MB`, **unbounded in N** — not a fixed 200 MB.
  - The text path is already unbounded today: `bufferFollowupSend`
    (`bridge.ts:445`) pushes a string of any length under the count cap. The
    ceiling therefore closes a pre-existing hole, not only the image one.

  `design.md` MUST set the ceiling against total bytes per entry across all its
  images, not against a per-image size times an assumed count of one.
- **Mutation semantics**: `edit_followup_entry` replaces the entry's text and
  preserves its images. `remove` / `promote` / `clear` are unchanged in
  semantics and operate on whole entries. The `images?` field currently spec'd
  on `edit_followup_entry` (`spec.md:613`) becomes **unpopulatable** under the
  count-only wire decision — the client never holds the bytes after the initial
  `send_prompt` — so this change retires that field rather than leaving it
  spec'd and dead.
- `enqueueSystemFollowup` (plugin path) stays text-only: it wraps into a
  `{ text }` entry with no images. Its external signature is unchanged.
- **Not in scope**: pull-to-editor. It was removed per user direction (see
  `QueuePanel.test.tsx:42`) and exists today only as stale prose in
  `bridge.ts:355-357`, `spec.md:200` and `QueuePanel.tsx.AGENTS.md`. This
  change corrects that prose; it does not reintroduce the affordance.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `mid-turn-prompt-queue`: the follow-up buffer carries image attachments
  through buffering, mutation, and drain. Redefines the buffer from
  `string[]` to an entry array (`spec.md:200`); retires *"Image attachments
  are not displayed on chips in v1"* (`:139`) including its stale
  optimistic-card scenario; corrects *"Per-entry follow-up mutation…"*
  (`:609`) for image-preserving edit and for the four handlers that actually
  exist; adds an aggregate byte bound to the buffer-cap requirement; makes the
  already-present *"Drain preserves image attachments"* scenario (`:149`) true
  of the bridge-owned buffer.

Explicitly cleared as unaffected (requirements unchanged):

- `image-paste` — obliges the *client* to place images on `send_prompt`, which
  it already does correctly. The defect is downstream of that contract; no
  `image-paste` requirement changes.
- `optimistic-prompt` — already correct in stating mid-turn sends never set
  `pendingPrompt` (`spec.md:8`, `:37`). The contradicting text lives in
  `mid-turn-prompt-queue` and is corrected there.
- `embed-session-lifecycle` — consumes `pendingQueues.followUp` at
  `spec.md:129,159,183,200,211` but only tests emptiness/length, so it is
  shape-agnostic to the entry change.
- `shared-protocol` — defines message-type unions but does not enumerate
  `queue_update`; `mid-turn-prompt-queue:206` owns that wire shape.
- `inline-image-block-shapes` — this change *consumes* its accessors on the
  sizing and validation paths (above) but adds no shape, changes no accessor
  contract, and puts no image block on the wire. Requirements unchanged.

## Impact

- `packages/extension/src/bridge.ts` — buffer type (`:409`),
  `bufferFollowupSend` (`:445`), `drainFollowupQueue` (`:489`),
  `enqueueSystemFollowup` (`:561`), `emitQueueUpdate` (`:410`), the
  `message_start` drain matcher (`:1896`, an `indexOf(text)` over the buffer),
  the session reset (`:2920`), and the **four** mutation handlers at
  `:1096-1155` (`edit` `:1096`, `remove` `:1112`, `promote` `:1129`, `clear`
  `:1140`). Two stale block comments claim "five handlers" — `:395-400` and
  `:1082` — and both need correcting.
- `packages/extension/src/command-handler.ts` — `onFollowupSent` signature
  (`:413`), the buffer-path call site (`:773`), extraction of
  `sendUserMessageWithImages` (`:1027`) with the `deliverAs` split above.
- `packages/shared/src/types.ts` — `pendingQueues` (`:387`) / `queue_update`
  payload. `packages/shared/src/image-block.ts` is consumed, not modified.
- `packages/server/src/` — type-level only; `event-wiring.ts` forwards the
  arrays wholesale and does not inspect elements.
- `packages/client/src/` — mechanical `.text` mapping in every consumer
  (`QueuePanel.tsx`, `FollowupCycler`, `SessionCard.tsx` length read) plus the
  new attachment indicator on the chip.
- Memory envelope of the extension process — currently unbounded in bytes,
  bounded by this change.

## Discipline Skills

- `doubt-driven-review` — this change alters a wire shape shared by extension,
  server and client; the shape stands before the code does.
- `security-hardening` — the change widens a path that carries untrusted
  base64 blobs from the browser into extension memory and on to the model;
  the byte budget and the reused MIME allow-list are the mitigations.
- `performance-optimization` — the aggregate byte ceiling is a memory-envelope
  decision. `design.md` MUST state the constant and its basis; a placeholder
  ceiling would leave the security rationale unbacked.
- `review-code` — non-trivial change across four packages plus a protocol
  shape; inline review before commit.
- `systematic-debugging` — only if the drain-path behaviour under a real pi
  turn diverges from the unit-level expectation.

Accepted trade-off: this proposal carries more mechanism than a proposal
usually would (the `deliverAs` split, the content-array shape). That detail is
retained deliberately — the `deliverAs` reuse trap silently breaks the drain,
and burying it in `design.md` risks an implementer reusing the helper wholesale
before reading it.
