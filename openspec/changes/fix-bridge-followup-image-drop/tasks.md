# Tasks — fix-bridge-followup-image-drop

Test tasks are folded from `test-plan.md` (the manifest). Every row with
disposition `automated` has exactly one task below; there are no `manual-only`
rows in this change.

Build/restart per the `implement` skill. Deploy order is **client-first**
(design D2b/Migration Plan): shared → client build + restart → server restart →
extension reload **last**.

## 1. Shared types

- [x] 1.1 Add `FollowUpEntryView = { text: string; imageCount: number }` to `packages/shared/src/types.ts` and change `pendingQueues.followUp` (`:387`) from `string[]` to `FollowUpEntryView[]`; leave `steering` as `string[]`
- [x] 1.2 Remove the `images?` field from the `edit_followup_entry` message type (design D5 — unpopulatable under the count-only wire)

## 2. Extension — buffer entry shape

- [x] 2.1 Change `bridgeFollowUp` (`bridge.ts:409`) to `FollowUpEntry[]` where `FollowUpEntry = { text: string; images?: ImageContent[] }`
- [x] 2.2 Update `emitQueueUpdate` (`:410`) to project entries to `{ text, imageCount }`; image bytes must never enter the payload
- [x] 2.3 Update the `message_start` follow-up matcher at `:1896` — `bridgeFollowUp.indexOf(text)` becomes `findIndex((e) => e.text === text)`; the `splice` below it is unchanged
- [x] 2.4 Confirm the session reset at `:2920` (`bridgeFollowUp = []`) still type-checks and releases image bytes
- [x] 2.5 Correct the two stale "five mutation handlers" comments (`:395-400`, `:1082`) to four, and drop the `pull_followup_to_editor` mention

## 3. Extension — content assembly + delivery

- [x] 3.1 Extract `buildUserMessageContent(text, images)` from `sendUserMessageWithImages` (`command-handler.ts:1027`) returning `string | ContentBlock[]`, carrying the existing MIME allow-list unchanged; place it in `command-handler.ts` to avoid a `bridge → command-handler → bridge` cycle (design D7b)
- [x] 3.2 Repoint the steer/idle call site at the helper, keeping `{ deliverAs }` at the call site
- [x] 3.3 Update `drainFollowupQueue` (`:489`, pi call at `:525`) to send `buildUserMessageContent(entry.text, entry.images)` with **no** send options (spec invariant 7 — `deliverAs` breaks the drain)
- [x] 3.4 Add the images parameter to `onFollowupSent` (`command-handler.ts:413`) and pass `msg.images` at the buffer-path call site (`:773`)
- [x] 3.5 Read mime through `imageBlockMime()` from `packages/shared/src/image-block.ts` in the validation filter (`:1041`) instead of `img.mimeType`; the allow-list values are unchanged (design D3c)

## 4. Extension — bounds and visibility

- [x] 4.1 Add `FOLLOWUP_BUFFER_MAX_BYTES = 32 * 1024 * 1024`, read from an injected value rather than compared as a literal at the admission site (design D3b)
- [x] 4.2 Implement entry sizing as `Buffer.byteLength(text) + Σ (imageBlockData(image)?.length ?? 0)` using the shared accessor — a direct `.data` read sizes a nested-shape block at zero and bypasses the ceiling (design D3c); recompute the total from live entries at each admission check — never maintain a running counter (design D3)
- [x] 4.3 Gate `bufferFollowupSend` on both the entry-count cap and the byte ceiling; refuse whole entries only (never strip images to fit)
- [x] 4.4 Gate `edit_followup_entry` on the byte ceiling; refuse and leave the entry unchanged, emitting no `queue_update`
- [x] 4.5 Preserve the entry's images on edit; carry them on promote; discard on remove/clear
- [x] 4.6 Emit `command_feedback { command:"send_prompt", status:"error" }` on both user-send refusals (replaces the silent `console.warn` at `:447`)
- [x] 4.7 Emit `command_feedback { command:"enqueue_followup", status:"error" }` on system-push refusal (replaces the silent warn at `:564`); wrap system pushes into `{ text }` entries
- [x] 4.8 Emit `command_feedback { status:"error" }` when image validation drops attachments, reporting how many and why (design D7)

## 5. Client

- [x] 5.1 Normalise `pendingQueues.followUp` at the event-reducer boundary, accepting `string | { text, imageCount }` and yielding one shape downstream (design D2b)
- [x] 5.2 Update the `followUp` prop types through `App.tsx` → `QueuePanel`, and `SessionCard`'s `.length` read
- [x] 5.3 Render the attachment indicator with `data-testid="queue-followup-attachments"` on chips whose `imageCount > 0`; no thumbnails

## 6. Server

- [x] 6.1 Update the `pendingQueues` type to carry `FollowUpEntryView[]`; confirm `event-wiring.ts` still forwards entries verbatim without inspecting elements

## 7. Spec hygiene (design D4b)

- [x] 7.1 Confirm the archive step retires `rewriteFollowupQueue requires active streaming` and `Follow-up queue surface is display-only with cycling navigation`, and lands the corrected abort requirement
- [x] 7.2 Update `packages/client/src/components/session/QueuePanel.tsx.AGENTS.md` to drop the stale pull-to-editor mention and record the attachment indicator

## 8. Tests — extension buffer and send (L1)

Exemplar for all rows in this section: `packages/extension/src/__tests__/bridge-followup-multi-entry.test.ts` (buffer/queue_update harness) and `bridge-followup-mutation.test.ts` (mutation handlers).

- [x] 8.1 Image-bearing follow-up buffers its images · input: streaming, empty buffer, `send_prompt{delivery:"followUp",text:"describe",images:[PNG,JPEG]}` · trigger: bridge handles it · observable: entry is `{text:"describe",images:[PNG,JPEG]}` and `queue_update` reports `imageCount:2` (test-plan #E1)
- [x] 8.2 Text-only follow-up reports zero images · input: streaming, `send_prompt` with no images · trigger: bridge handles it · observable: entry `{text:"plain"}`, `queue_update` `imageCount:0` (test-plan #E2)
- [x] 8.3 Session-change releases buffered bytes · input: buffer holds an image-bearing entry · trigger: `session_start{reason:"resume"}` · observable: buffer `[]`, admission sees zero total, one `queue_update{followUp:[]}` (test-plan #E22)

## 9. Tests — drain path (L1)

Exemplar for all rows in this section: `packages/extension/src/__tests__/bridge-followup-queue-drain.test.ts`.

- [x] 9.1 Drain preserves image attachments · input: buffer `[{text:"describe",images:[PNG]}]`, idle true, no pending messages · trigger: `agent_end` · observable: `sendUserMessage` receives the text+image content array and **zero** option arguments (test-plan #E3)
- [x] 9.2 Text-only entry drains as a bare string · input: buffer `[{text:"plain"}]`, gates pass · trigger: `agent_end` · observable: `sendUserMessage("plain")`, not a one-element array, no options (test-plan #E4)
- [x] 9.3 pi throws — entry lost, not re-queued · input: `sendUserMessage` throws · trigger: `agent_end` with `[{text:"a"}]` · observable: warn contains "drainFollowupQueue"+"entry lost", buffer `[]`, no re-push (test-plan #X1)
- [x] 9.4 Image-bearing entry dropped on throw releases bytes · input: `sendUserMessage` throws · trigger: drain of `{text:"a",images:[PNG]}` · observable: not re-pushed, subsequent admission sees bytes released (test-plan #X2)
- [x] 9.5 Pop precedes send · input: spies on `shift` and `sendUserMessage` · trigger: drain runs · observable: `shift` strictly before `sendUserMessage` in the call log (test-plan #X3)
- [x] 9.6 Idle never settles · input: `isIdle()` false >2s · trigger: `agent_end`, non-empty buffer · observable: logs "pi never idled after 2s; giving up", entry retained with images intact (test-plan #X4)
- [x] 9.7 TUI coexistence defers the drain · input: `hasPendingMessages()` true · trigger: `agent_end` · observable: no drain, buffer unchanged, drains on a later `agent_end` when false (test-plan #X5)
- [x] 9.8 Re-entrant drain early-returns · input: drain mid-execution · trigger: synchronous second `agent_end` · observable: second invocation pops nothing, original completes, next drains the following entry (test-plan #X6)

## 10. Tests — byte ceiling (L1)

Exemplar for all rows in this section: `packages/extension/src/__tests__/bridge-followup-multi-entry.test.ts`. All rows inject a small ceiling per design D3b.

- [x] 10.1 Just below the ceiling admits · input: ceiling 1 KiB, buffer 900 B · trigger: 100 B send · observable: appended, 2 entries (test-plan #E5)
- [x] 10.2 Exactly at the ceiling admits · input: ceiling 1 KiB, buffer 900 B · trigger: send totalling exactly 1024 B · observable: appended, no `command_feedback` (test-plan #E6)
- [x] 10.3 Just above the ceiling refuses · input: ceiling 1 KiB, buffer 900 B · trigger: send totalling 1025 B · observable: not appended, buffer unchanged, `command_feedback{command:"send_prompt",status:"error"}` naming the byte ceiling (test-plan #E7)
- [x] 10.4 Entry larger than the whole ceiling is refused whole · input: ceiling 1 KiB, empty buffer · trigger: 4 KiB of images · observable: buffer stays `[]`, no text-only or image-stripped entry appended, feedback error (test-plan #E8)
- [x] 10.5 Ceiling refuses independently of count · input: ceiling 1 KiB, 3 entries at 1000 B · trigger: 100 B send · observable: refused on bytes with count 3 (test-plan #E9)
- [x] 10.6 Count cap refuses independently of bytes · input: default ceiling, 20 tiny entries · trigger: 10 B send · observable: refused on count, feedback names the queue-depth limit (test-plan #E10)
- [x] 10.7 Override changes only the threshold · input: buffer constructed with ceiling 1 KiB · trigger: send exceeding it · observable: refusal shape identical to the default-ceiling refusal (test-plan #E11)
- [x] 10.8 Size computation is byte-accurate · input: entry with multi-byte text plus a known-length base64 image · trigger: size computed · observable: equals `Buffer.byteLength(text)+data.length`, multi-byte not under-counted, `JSON.stringify` not invoked (test-plan #E12)
- [x] 10.11 Nested-shape image sizes by its real bytes · input: ceiling 1 KiB, empty buffer, one image in the nested Anthropic shape `{type:"image",source:{media_type,data}}` whose base64 is 4 KiB · trigger: admission check · observable: refused; the entry does NOT size at zero and is not admitted (test-plan #E25)
- [x] 10.9 Total is derived, not accumulated · input: ceiling 1 KiB, sequence push/push/drain/remove/promote/clear/push · trigger: admission attempted after each mutation · observable: every decision matches the sum over present entries; no drift (test-plan #E17)
- [x] 10.10 Removal releases bytes · input: ceiling 1 KiB, buffer 1000 B, a send just refused · trigger: remove a 400 B entry then retry · observable: retry admitted (test-plan #E16)

## 11. Tests — mutation handlers (L1)

Exemplar for all rows in this section: `packages/extension/src/__tests__/bridge-followup-mutation.test.ts`; for 11.4 also `bridge-no-queue-mutation.test.ts`.

- [x] 11.1 Edit preserves images · input: `[{text:"describe",images:[PNG]}]` · trigger: `edit_followup_entry{index:0,text:"describe in detail"}` · observable: images retained, `queue_update` still `imageCount:1` (test-plan #E13)
- [x] 11.2 Edit refused at the ceiling · input: ceiling 1 KiB, buffer 1000 B with a `"short"` entry · trigger: edit replacing it with 200 B · observable: entry unchanged, `command_feedback{command:"edit_followup_entry",status:"error"}`, no `queue_update` (test-plan #E14)
- [x] 11.3 Promote carries images · input: `[{text:"a"},{text:"b",images:[PNG]}]` · trigger: `promote_followup_entry{index:1}` · observable: `[0]` is the image-bearing entry, counts reported 1 then 0 (test-plan #E15)
- [x] 11.4 Exactly four handlers, none touching pi · input: 3-entry buffer · trigger: each of edit/remove/promote/clear plus an unknown `pull_followup_to_editor` · observable: four mutate, unknown unhandled, no pi method called by any (test-plan #E18)
- [x] 11.5 Out-of-range index · input: `[{text:"a"}]` · trigger: `edit_followup_entry{index:5}` · observable: no mutation, `command_feedback` "Index out of range", no `queue_update` (test-plan #E19)
- [x] 11.6 Abort does not clear the buffer · input: 2 entries, one image-bearing · trigger: `abort` command · observable: `cachedCtx.abort()` invoked, both entries retained with images, no `queue_update` from the abort path, `abortLatch.request` before `cachedCtx.abort` (test-plan #X7) — exemplar: `bridge-shutdown-reset.test.ts`

## 12. Tests — system follow-up and validation (L1)

Exemplar for 12.1–12.2: `packages/extension/src/__tests__/bridge-system-followup.test.ts`. Exemplar for 12.3–12.5: `packages/extension/src/__tests__/command-handler.test.ts`.

- [x] 12.1 System push refused at the count cap · input: 20 entries · trigger: `dashboard:enqueue-followup` · observable: not appended, `command_feedback{command:"enqueue_followup"}` — not `send_prompt` (test-plan #E20)
- [x] 12.2 System push refused at the byte ceiling · input: ceiling 1 KiB, buffer 1000 B · trigger: `dashboard:enqueue-followup` with 100 B · observable: not appended, `command_feedback{command:"enqueue_followup",status:"error"}` (test-plan #E21)
- [x] 12.3 Invalid image shapes are dropped and reported · input: images containing a non-object, one missing `data`, one `image/svg+xml` · trigger: follow-up buffered while streaming · observable: all three dropped, valid retained, `command_feedback{status:"error"}` stating the count (test-plan #X8)
- [x] 12.4 All-invalid set buffers as text-only · input: every image invalid · trigger: follow-up buffered · observable: entry text-only with `imageCount:0`, feedback error emitted (test-plan #X9)
- [x] 12.5 No feedback when all images are valid · input: two valid images · trigger: follow-up buffered · observable: both retained, **no** validation `command_feedback` (test-plan #X10)
- [x] 12.6 Nested-shape image is not dropped as invalid · input: one image in the nested Anthropic shape with `source.media_type:"image/png"` · trigger: follow-up buffered · observable: retained (`imageCount:1`), no validation `command_feedback` (test-plan #X11)

## 13. Tests — server cache (L1)

Exemplar for all rows in this section: `packages/server/src/__tests__/event-wiring-queue-state.test.ts`.

- [x] 13.1 Entries forwarded verbatim · input: `queue_update{followUp:[{text:"c",imageCount:2}]}` · trigger: cache update + broadcast · observable: cache equals input, broadcast carries `imageCount:2` and no `data` field anywhere (test-plan #E23)
- [x] 13.2 Steering stays a string array · input: `queue_update` with both arrays · trigger: cache update · observable: `steering` unchanged as `string[]`, no entry-object coercion (test-plan #E24)

## 14. Tests — client reducer (L1)

Exemplar: `packages/client/src/lib/__tests__/event-reducer.replay-idempotency.test.ts`.

- [x] 14.1 Legacy string entry normalises · input: reducer receives `pendingQueues.followUp = ["hello"]` · trigger: state derived · observable: yields `{text:"hello",imageCount:0}`, no `[object Object]` in derived text (test-plan #F4)

## 15. Tests — rendered UI (L3)

Exemplar for all rows in this section: `tests/e2e/optimistic-prompt.spec.ts` (chat/queue surface against the docker harness). Read the harness port from `.pi-test-harness.json` `dashboardPort` — never hardcode `:18000`.

- [x] 15.1 Chip shows the attachment indicator · input: streaming session, follow-up sent with 2 images · trigger: `queue_update` arrives · observable: converges to chip text present AND `queue-followup-attachments` showing 2, with no `img` thumbnail inside the chip (test-plan #F1)
- [x] 15.2 Text-only chip has no indicator · input: follow-up sent with no images · trigger: `queue_update` arrives · observable: converges to chip text present, `queue-followup-attachments` absent from the DOM (test-plan #F2)
- [x] 15.3 Indicator survives an edit · input: chip showing the indicator at 1 · trigger: user edits via `queue-followup-edit` and submits · observable: converges to updated text AND indicator still present with count 1 (test-plan #F3)
- [x] 15.4 Legacy string payload renders safely · input: broadcast carrying a legacy `string[]` followUp · trigger: chip renders · observable: converges to text `"hello"`, indicator absent, no `[object Object]` anywhere in `queue-panel` (test-plan #F5)
- [x] 15.5 Refusal is visible in chat · input: buffer at the entry-count cap · trigger: user sends another follow-up · observable: converges to a `commandFeedback` row carrying the refusal message, chip count still 20 (test-plan #F6)
- [x] 15.6 Dropped attachment is visible · input: follow-up with 3 images, one `image/svg+xml` · trigger: `queue_update` + feedback arrive · observable: converges to indicator showing 2 AND a `commandFeedback` row stating one attachment was dropped (test-plan #F7)
- [x] 15.7 Drained image-bearing message renders a chat row · input: image-bearing follow-up buffered mid-turn, image large enough to bust the 256 KiB event ceiling · trigger: turn ends and the buffer drains · observable: converges to a user row carrying the prompt text AND an image slot (thumbnail or the explicit unavailable slot); the row does NOT vanish (test-plan #F8)

## 16. Validate

- [x] 16.1 `npm test` green (pipe once to a tmp file, then grep — per AGENTS.md)
- [x] 16.2 `npm run quality:changed` clean
- [x] 16.3 E2E rows verified against a harness built from this worktree (`run-dashboard-e2e-local-changes`)
- [ ] 16.4 Manual: send an image-bearing follow-up mid-turn against a real model and confirm the model receives the image
