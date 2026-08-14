## Why

A follow-up prompt sent while the agent is streaming loses its images. The
bridge buffers the entry as a bare string (`bridge.ts:366`,
`let bridgeFollowUp: string[]`), so `msg.images` is discarded at
`command-handler.ts:629` and the drain ships text only
(`bridge.ts:485`, `pi.sendUserMessage(entry)` on a `string`). The failure is
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
Limitation", `bridge.ts:397-400`), and left the drain requirement stale. This
change reconciles the two halves in favour of delivery.

Delivery is the bug. This is distinct from the display-only bug fixed by
`fit-attachments-for-display`. Tracked as issue #415.

## What Changes

- `bridgeFollowUp` becomes an entry array carrying `{ text, images? }` instead
  of `string[]`. The drain hands the entry to pi as a content array
  (`[{type:"text"}, {type:"image"}…]`), the shape pi already accepts on the
  idle and steer paths.
- `onFollowupSent` gains the images parameter so `command-handler.ts` stops
  discarding `msg.images` on the buffer path.
- The image-validation + content-array assembly currently private to
  `sendUserMessageWithImages` (`command-handler.ts:866`) is extracted so the
  bridge drain reuses it — **without** its `deliverAs` behaviour. The drain
  MUST call `pi.sendUserMessage` with no send options; passing
  `{deliverAs:"followUp"}` is a known-broken path (the entry never drains —
  `rework-mid-turn-prompt-queue` design D2, restated at `bridge.ts:429-435`).
  The extraction therefore separates *validation + content assembly* from
  *send options*.
- **Wire shape**: `pendingQueues.followUp` gains a per-entry image **count**
  so a queued chip can show an attachment indicator. Image bytes stay
  extension-side and never cross the wire — the count is display-only.
  **BREAKING**: `followUp` elements stop being bare strings, so every consumer
  changes. Retires the v1 requirement *"Image attachments are not displayed on
  chips in v1"* (`spec.md:139`) and the stale optimistic-card scenario it
  carries (`spec.md:141-147`), which contradicts `optimistic-prompt/spec.md:8`
  (mid-turn sends never set `pendingPrompt`).
- **Byte budget**: the follow-up buffer gains an aggregate byte ceiling
  alongside the existing 20-entry `FOLLOWUP_QUEUE_CAP` (`bridge.ts:385`).
  Entry count alone bounds nothing:
  - The send path applies no downscale — `useImagePaste.ts:113` admits
    anything under `MAX_IMAGE_SIZE = 10 * 1024 * 1024` (`:38`). The 768 px
    derivative is a *server-side storage* fit and does not apply here.
  - There is **no per-send image-count cap** anywhere: `image-paste/spec.md:40`
    permits multiple images per send, and every client `images.length` use is a
    `> 0` presence check, never a ceiling. So the worst case is
    `20 entries × N images × 10 MB`, **unbounded in N** — not a fixed 200 MB.
  - The text path is already unbounded today: `bufferFollowupSend`
    (`bridge.ts:408`) pushes a string of any length under the count cap. The
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

## Impact

- `packages/extension/src/bridge.ts` — buffer type, `bufferFollowupSend`
  (`:402`), `drainFollowupQueue` (`:446`), `enqueueSystemFollowup` (`:518`),
  `emitQueueUpdate` (`:367`), and the **four** mutation handlers at
  `:1023-1090` (`edit` `:1023`, `remove` `:1039`, `promote` `:1055`, `clear`
  `:1066`). Two stale block comments claim "five handlers" — `:355-357` and
  `:1011` — and both need correcting.
- `packages/extension/src/command-handler.ts` — `onFollowupSent` signature
  (`:362`), the buffer-path call site (`:629`), extraction of
  `sendUserMessageWithImages` (`:866`) with the `deliverAs` split above.
- `packages/shared/src/types.ts` — `pendingQueues` (`:347`) / `queue_update`
  payload.
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
