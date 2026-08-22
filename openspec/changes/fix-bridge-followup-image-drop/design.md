## Context

`bridgeFollowUp` is a bridge-owned buffer holding dashboard-originated
follow-up prompts while the agent streams; the drain ships one entry per
`agent_end` as a fresh turn. It is typed `string[]` (`bridge.ts:409`), so an
image-bearing follow-up loses its images between `send_prompt` and delivery.

Constraints that shape every decision below:

- **The drain must send with NO `deliverAs`.** `mid-turn-prompt-queue` spec
  invariant 7 (`spec.md:557`) records a failed attempt: with
  `{deliverAs:"followUp"}` pi accepts the message into `Agent.followUpQueue`
  but `getFollowUpMessages()` has already exited, so the entry never drains.
  Any reuse of `sendUserMessageWithImages` must not inherit its send options.
- **Pop-before-send is load-bearing** (invariant 5). The entry lives only on
  the call stack between `shift()` and the pi call; on a throw it is dropped
  deliberately. Images ride the same lifetime — no separate store.
- **The buffer is in-memory and per-session.** Bridge restart loses it
  (spec `:207`), and session-change resets it. Images inherit both.
- **The client is the only source of image bytes.** They arrive once on
  `send_prompt` (`image-paste/spec.md:49`) and are never re-sent.
- **Two inline image block shapes exist in this codebase.**
  `fix-pasted-image-message-vanishes` made that explicit and shipped the
  canonical accessors (`packages/shared/src/image-block.ts`): flat pi
  `{type:"image", data, mimeType}` and nested Anthropic
  `{type:"image", source:{media_type, data}}`. Any code that reads `.data` or
  `.mimeType` directly is correct only for the flat shape. See D3c.
- **The display half of this bug is already fixed.** Pre-`#528`, a drained
  image-bearing `message_start` over the 256 KiB event ceiling collapsed to
  `{ __truncated }` and vanished from history. The store now preserves the
  envelope and strips only the bytes, so delivery is the only half left — but
  the rendered row is an observable to verify, not assume (F8).

## Goals / Non-Goals

**Goals**

- An image-bearing follow-up sent while streaming delivers its images to the
  model when the buffer drains.
- The queued chip shows that an attachment is present.
- The buffer's memory hold is bounded in bytes, and a refusal is visible.

**Non-Goals**

- Reintroducing pull-to-editor (removed per user direction).
- Rendering image thumbnails on the chip — an indicator only.
- Persisting the buffer across bridge restart.
- Carrying images on `enqueueSystemFollowup` (the plugin path has no image
  source).
- Bounding any other buffer (`bridgeSteering` is pi-owned and display-only).

## Decisions

### D1 — Buffer entry shape: `{ text, images? }`

`bridgeFollowUp: FollowUpEntry[]` where
`FollowUpEntry = { text: string; images?: ImageContent[] }`.

*Alternative rejected — parallel `images[]` array keyed by index.* Every
mutation handler (`splice`, `unshift`, `shift`) would have to keep two arrays
in sync; a single missed splice silently reassociates an image with the wrong
prompt. One array of whole entries makes the association structural.

*Alternative rejected — store images out-of-band (disk, like
`persistAnswerImages`).* Adds a filesystem lifecycle (cleanup on drain, on
session end, on crash) to a buffer that is explicitly ephemeral, to solve a
memory problem already solved by D3.

### D2 — Wire carries a count, not bytes

`queue_update` / `pendingQueues.followUp` becomes
`Array<{ text: string; imageCount: number }>`. Image bytes never cross back to
the browser.

Rationale: the client already had the bytes when it sent them; echoing them
back doubles the hold (extension + every subscribed browser) and puts
megabytes on the WebSocket on every queue mutation. The chip only needs to
show *that* an attachment exists.

*Consequence, accepted:* no client-side feature can ever re-materialise the
image bytes from the queue. This is what makes D5 necessary.

**BREAKING.** `followUp` elements stop being strings. All consumers change.

### D2b — Client reads the wire shape tolerantly

The client normalises `string | { text, imageCount }` on read for one release.
A browser tab holding pre-change JS against a post-change extension would
otherwise render `[object Object]` in the chip. The dashboard ships as one
version, but a stale open tab is a realistic skew source, and the cost is a
three-line normaliser at the reducer boundary.

### D3 — Aggregate byte ceiling of 32 MiB, enforced by refusal

*(Sizing reads bytes through the shared accessor — see D3c.)*

`FOLLOWUP_BUFFER_MAX_BYTES = 32 * 1024 * 1024`, held alongside the existing
`FOLLOWUP_QUEUE_CAP = 20`.

Basis: the send path applies no downscale (`useImagePaste.ts:113` admits up to
`MAX_IMAGE_SIZE = 10 MB`) and there is **no per-send image-count cap**, so the
pre-change worst case is `20 × N × 10 MB`, unbounded in `N`. 32 MiB holds
roughly 10–30 typical pasted screenshots (1–3 MB base64 each), or three
maximum-size images — comfortable for real use, while capping a runaway
session at a fixed, per-session cost.

**Measurement is recomputed on demand, never accumulated.** The total is
derived by summing over the (at most 20) live entries at each admission check:
`Buffer.byteLength(text) + Σ imageBlockData(image)?.length ?? 0`.
Image `data` is base64, so its
string length is exactly its byte count; `text` uses `byteLength` because
`String.length` counts UTF-16 code units and under-counts non-Latin-1 text.
`JSON.stringify` is never used — it would allocate a copy of the megabyte
payload just to measure it.

*Alternative rejected — a running counter incremented on push and decremented on
removal.* The buffer is mutated from at least ten sites (push, system push,
drain shift, edit, remove, promote, clear-all, clear-selected, matcher splice,
session reset) and one of them — abort — is currently in dispute between spec
and code (see Risks). A single forgotten decrement permanently mis-enforces the
ceiling with no visible symptom until sends start being refused for no reason.
Recomputation over ≤20 entries is trivially cheap and makes drift structurally
impossible. This also means abort, session reset, and any future mutation site
release bytes correctly without knowing the budget exists.

Enforcement is **refusal, not eviction**: a push that would exceed the ceiling
is rejected and the entry is not buffered. Eviction was rejected because
silently discarding a *previously accepted* prompt is the same class of defect
this change exists to fix — the user believes a queued prompt will run.

**Every admission path is gated, not just the initial push.** `edit_followup_entry`
can grow an entry's text without bound through the inline editor, so an edit
that would push the total over the ceiling is refused with feedback and the
entry is left unchanged. Gating push alone would leave the "bounded in bytes"
goal false.

*Whole-entry refusal.* An entry is never partially admitted; images are never
stripped to make it fit. Partial admission would deliver a prompt whose
attachment vanished — again the original bug.

### D3c — Byte sizing and MIME validation read through the shared accessors

Both the D3 size walk and the D6/D7 validation filter read image bytes and mime
via `imageBlockData()` / `imageBlockMime()` from
`packages/shared/src/image-block.ts`, never via a direct `.data` / `.mimeType`
property read.

Rationale: a direct read is correct only for the flat pi shape. Against a
nested Anthropic block it returns `undefined`, so the entry sizes at **zero
bytes** — an unbounded hold that passes every ceiling check, which is exactly
the exposure D3 exists to close — and the D7 filter drops the block as
"invalid mimeType", silently destroying a valid attachment.

`send_prompt.images` carries the flat shape today (`useImagePaste.ts:118`), so
this costs nothing at runtime and is not a behaviour change. It is defence
against drift: `#528` shipped the shared module precisely because two
independent sites had already drifted on this question.

*Alternative rejected — assert flat-only at the wire boundary and keep direct
reads.* An assertion that rejects a nested block would turn a future shape
change into a user-visible refusal rather than transparent handling, and would
add a second definition of "what an image block is" next to the canonical one.

*Not adopted:* `isRenderableImageBlock` / `isTruncatedImageBlock`. Those encode
rendering and rescue concerns; this path only needs bytes + mime.

### D3b — The ceiling is injectable so boundary tests stay cheap

32 MiB is the default, not a hardcoded literal at the comparison site. The
buffer reads its ceiling from an injected option (falling back to the default),
so boundary tests drive the real comparison logic with a small ceiling (e.g.
1 KiB) instead of allocating tens of megabytes of base64 per case.

Rationale: the alternative — generating true 32 MiB payloads in the unit suite —
makes every CI push pay the allocation, and a slow suite gets skipped. Testing
the comparison against a stubbed total instead would assert the arithmetic
without ever exercising admission, which is the vacuous-test failure mode.
An injectable ceiling tests the real path at proportional cost.

### D4 — Refusals are visible — all of them

There are three silent refusal sites today, all bare logs:
the 20-entry cap in `bufferFollowupSend` (`bridge.ts:447`), the same cap in
`enqueueSystemFollowup` (`:564`), and image-validation drops
(`command-handler.ts:1043`). This change adds a fourth (the byte ceiling).

All four emit `command_feedback { status: "error", message }`. The existing
spec explicitly left the entry-cap case as "implementation choice"
(`spec.md:484`); adding new silent refusals alongside it would ship the same
defect four times over. Deliberate scope addition, called out here rather than
smuggled in.

### D4b — Stale base requirements in the blast radius are retired, not merged

Three requirements in the base spec are already contradicted by the shipped
code, and all three collide with requirements this change modifies. Merging the
delta without addressing them produces a spec that requires and forbids the
same behaviour:

- `spec.md:410` "rewriteFollowupQueue requires active streaming" mandates
  `pi.clearFollowUpQueue()` + `pi.sendUserMessage(_, {deliverAs:"followUp"})`
  for `edit_followup_entry` / `promote` / `remove` — the exact handlers the
  modified mutation requirement forbids from touching pi. `rewriteFollowupQueue`
  was deleted (`bridge.ts:588`).
- `spec.md:299` "Follow-up queue surface is display-only" states
  `queue-followup-edit` / `-editor` / `-promote` / `-remove` SHALL NEVER be in
  the DOM; `QueuePanel` renders all four, and this change adds an indicator to
  that same chip.
- `spec.md:359` "User abort resets shadow queues" requires abort to empty
  `bridgeFollowUp`; the live abort deliberately persists them
  (`bridge.ts:1268`, `:1281`, per `honest-mid-turn-queue-surface`).

This change retires the first two (they directly contradict requirements it
rewrites) and corrects the third to match shipped behaviour. This is spec
hygiene forced by the delta, not opportunistic cleanup: without it, the archive
step writes a self-contradictory capability. The D3 recompute model makes the
abort question moot for the byte budget either way.

### D5 — Retire `images?` from `edit_followup_entry`

Under D2 the client never holds the bytes after the initial send, so the
`images?` field spec'd at `spec.md:613` is unpopulatable. It is removed from
the message schema. Edit replaces **text only** and preserves the entry's
existing images.

*Alternative rejected — keep the field for a future client that caches its own
sent images.* A field no producer can populate is a trap for the next reader.

### D6 — Extraction splits validation from send options

`sendUserMessageWithImages` (`command-handler.ts:1027`) currently fuses three
concerns: MIME validation, content-array assembly, and `deliverAs` options.
Extract the first two as `buildUserMessageContent(text, images) → string |
ContentBlock[]`, leaving send options at each call site:

- steer / idle path: `pi.sendUserMessage(buildUserMessageContent(...), { deliverAs })`
- drain path: `pi.sendUserMessage(buildUserMessageContent(...))` — **no options**

This is the rule-of-three-free version of the extraction: one shared validation
policy (the `image/jpeg|png|gif|webp` allow-list at `:1041`, read through
`imageBlockMime` per D3c), two send policies,
made structurally impossible to confuse.

### D7 — Validation happens at buffer time, and a dropped image is reported

Invalid images are filtered when the entry is buffered, so the byte accounting
in D3 reflects what will actually be sent, and a bad attachment is surfaced
while the user is still looking at the composer rather than one turn later.
`buildUserMessageContent` remains the single validation implementation.

Today that filter drops images with a bare `console.error`
(`command-handler.ts:1043-1052`), invisible to a dashboard user. Under D4's own
argument that is the same defect class this change exists to fix: a user pastes
three images, one has an unsupported MIME, and the chip silently reports two
with no explanation. So a filtered image SHALL also emit `command_feedback`.
Without this, D3's "never strip images to make it fit" guarantee holds while
validation quietly strips them anyway.

### D7b — Helper placement avoids an import cycle

`buildUserMessageContent` lives in `command-handler.ts` (or a module both
import). `bridge.ts:38` already imports from `command-handler.js`; defining the
helper in `bridge.ts` and importing it back would create a
`bridge → command-handler → bridge` cycle.

### D8 — `enqueueSystemFollowup` wraps into `{ text }`

External signature unchanged (`text: string`). It constructs a text-only entry.
Its cap check participates in the byte budget for consistency, though a
text-only entry is unlikely to approach it.

Its refusal is a **third** cap site (`bridge.ts:564`), also silent today. A
refused system nudge is a lost plugin continuation, so it emits
`command_feedback` under its own command name (`enqueue_followup`) rather than
borrowing `send_prompt`, which would misattribute a programmatic refusal to a
user action.

## Risks / Trade-offs

- **[Wire-shape skew breaks a stale browser tab]** → D2b tolerant read; the
  normaliser is deleted in a later release.
- **[The base spec disagrees with shipped code on whether abort clears the
  buffer]** → `spec.md:359` says it does; `bridge.ts:1281` says queues persist
  by design. D4b corrects the requirement to match the code. The byte budget is
  unaffected either way because D3 recomputes rather than accumulates — chosen
  partly for this reason.
- **[Retiring three base requirements widens the diff beyond the bug fix]** →
  Accepted and bounded: all three are already false against shipped code, and
  all three collide with requirements this delta rewrites. The alternative is
  archiving a self-contradictory spec.
- **[32 MiB is a guess against real usage, not a measurement]** → It is derived
  from documented per-image limits and typical screenshot sizes, not from
  telemetry, because none exists for this buffer. Refusal (not eviction) makes
  a too-low ceiling *visible* (the user gets feedback) rather than silently
  destructive, which is the safer failure direction for an unvalidated
  constant.
- **[Refusal is a worse UX than eviction when the user genuinely wants the new
  prompt]** → Accepted. The user can remove a queued entry and retry; the
  inverse (silently dropping an accepted prompt) has no recovery.
- **[Extraction touches the steer/idle path, which is currently working]** →
  The shared helper is pure (input → content array); send options stay at the
  call sites. Covered by tests on both paths before the drain path changes.
- **[Images widen the untrusted-input surface into extension memory]** → The
  existing MIME allow-list is reused unchanged (never widened), validation
  moves earlier (D7), and the byte ceiling bounds the hold.
- **[Larger `queue_update` payloads from the added field]** → Negligible; one
  integer per entry, and bytes explicitly do not cross the wire (D2).
- **[D2b is more than "three lines"]** → The normaliser is small, but the prop
  types travel: `QueuePanel`'s `followUp` prop, the `App.tsx` prop hand-off, the
  event-reducer field, and `SessionCard`'s `.length` read. Normalise once at the
  reducer boundary so downstream consumers see one shape.

## Migration Plan

No data migration — the buffer is in-memory and ephemeral by construction.

**Deploy order is client-first, and this is load-bearing.** The tolerant read
(D2b) must be serving *before* any extension emits the new shape, otherwise the
rollout itself opens the exact skew window D2b exists to close: a reloaded
extension emitting `{text, imageCount}` to an old bundle whose `QueuePanel`
indexes entries as strings renders `[object Object]` in every chip.

Order: `shared` types → `client` build + restart → `server` restart →
`extension` reload. Rebuild commands per the `implement` skill: client →
`npm run build` + `/api/restart`; server/shared → `/api/restart` (jiti, no
build); extension → `npm run reload` **last**.

Rollback: revert the change set. Any buffered entries are lost on the
extension reload that rollback entails — which is already the documented
behaviour of a bridge restart (`spec.md:209`), not a new failure mode.

## Open Questions

None blocking. Two deliberately deferred:

- Whether 32 MiB should become configurable — deferred until a user actually
  hits the ceiling; the `command_feedback` from D4 is what will surface it.
- Whether a per-send image-count cap belongs in `image-paste` (the absence of
  one is what makes the pre-change exposure unbounded). Out of scope here: this
  change bounds the buffer regardless of how many images a single send carries.
- Whether `bridgeFollowUp` being a module-level singleton (`bridge.ts:409`)
  deserves an explicit per-session assertion. It is per-session only because
  each pi session is its own process — true today, and relied upon by the whole
  bridge, not just this buffer. Noted, not changed.
