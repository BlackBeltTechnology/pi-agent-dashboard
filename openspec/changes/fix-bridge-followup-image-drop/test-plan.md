# Test Plan — fix-bridge-followup-image-drop

Stage: design   Generated: 2026-08-13   Rechecked: 2026-08-21

Recheck added E25, X11 (design D3c — nested image-block shape) and F8 (the
display half closed by `fix-pasted-image-message-vanishes`).

HARD gate cleared: C1 (injectable ceiling), C2 (`queue-followup-attachments`
testid), C3 (no perf scenarios) were resolved before this catalog was written.
No open clarifications.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | Follow-up send appends | EP | L1 | automated | agent streaming; buffer `[]`; `send_prompt { delivery:"followUp", text:"describe", images:[PNG,JPEG] }` | bridge handles the message | `bridgeFollowUp` is `[{text:"describe", images:[PNG,JPEG]}]`; emitted `queue_update` entry has `imageCount:2` |
| E2 | Follow-up send appends | EP | L1 | automated | agent streaming; buffer `[]`; `send_prompt` with no `images` | bridge handles the message | entry is `{text:"plain"}`; `queue_update` reports `imageCount:0` |
| E3 | Drain preserves image attachments | state-transition | L1 | automated | buffer `[{text:"describe", images:[PNG]}]`; `isIdle()` true; `hasPendingMessages()` false | `agent_end` fires | `pi.sendUserMessage` called with `[{type:"text",text:"describe"},{type:"image",data:<PNG>,mimeType:"image/png"}]` and **zero** send-option arguments |
| E4 | Drain: text-only sends a bare string | EP | L1 | automated | buffer `[{text:"plain"}]`; drain gates pass | `agent_end` fires | `pi.sendUserMessage` called with the string `"plain"`, not a one-element array; no send options |
| E5 | Byte ceiling (BVA, just below) | BVA | L1 | automated | ceiling injected at 1 KiB; buffer holds 900 B | send whose entry size is 100 B | entry appended; buffer holds 2 entries |
| E6 | Byte ceiling (BVA, at limit) | BVA | L1 | automated | ceiling 1 KiB; buffer holds 900 B | send whose entry size is exactly 124 B (total = 1024 B) | entry appended; no `command_feedback` emitted |
| E7 | Byte ceiling (BVA, just above) | BVA | L1 | automated | ceiling 1 KiB; buffer holds 900 B | send whose entry size is 125 B (total = 1025 B) | entry NOT appended; buffer unchanged; `command_feedback { command:"send_prompt", status:"error" }` naming the byte ceiling |
| E8 | Entry larger than the whole ceiling | BVA | L1 | automated | ceiling 1 KiB; buffer `[]` | send whose images total 4 KiB | refused entirely; buffer stays `[]`; **no** text-only or image-stripped entry appended; `command_feedback` error |
| E9 | Ceiling independent of count cap | decision-table | L1 | automated | ceiling 1 KiB; buffer holds 3 entries totalling 1000 B | send of 100 B | refused on bytes despite count 3 « 20 |
| E10 | Count cap independent of ceiling | decision-table | L1 | automated | ceiling 32 MiB (default); buffer holds 20 tiny entries | send of 10 B | refused on count; `command_feedback { command:"send_prompt", status:"error" }` naming the queue-depth limit |
| E11 | Ceiling override changes only the threshold | EP | L1 | automated | buffer constructed with ceiling 1 KiB | send exceeding 1 KiB | refusal shape identical to the 32 MiB-default refusal (same `command_feedback` fields) |
| E12 | Size computation | BVA | L1 | automated | entry `{text:"héllo wörld", images:[{data:<base64 of known length>}]}` | size is computed | result equals `Buffer.byteLength(text) + data.length`; multi-byte text is NOT under-counted; `JSON.stringify` not invoked |
| E13 | Edit preserves images | state-transition | L1 | automated | buffer `[{text:"describe", images:[PNG]}]` | `edit_followup_entry { index:0, text:"describe in detail" }` | entry becomes `{text:"describe in detail", images:[PNG]}`; `queue_update` still reports `imageCount:1` |
| E14 | Edit refused at the ceiling | BVA | L1 | automated | ceiling 1 KiB; buffer at 1000 B incl. an entry with text `"short"` | `edit_followup_entry` replacing it with 200 B of text | entry unchanged; `command_feedback { command:"edit_followup_entry", status:"error" }`; **no** `queue_update` |
| E15 | Promote carries images | state-transition | L1 | automated | buffer `[{text:"a"},{text:"b",images:[PNG]}]` | `promote_followup_entry { index:1 }` | `bridgeFollowUp[0]` is `{text:"b",images:[PNG]}`; `queue_update` reports `imageCount` 1 then 0 |
| E16 | Remove/clear release bytes | state-transition | L1 | automated | ceiling 1 KiB; buffer at 1000 B; a send was just refused | remove an entry accounting for 400 B, then retry the refused send | retry is admitted |
| E17 | Derived (not accumulated) total | state-transition | L1 | automated | ceiling 1 KiB; sequence: push, push, drain, remove, promote, clear-selected, push | after each mutation, attempt an admission | admission decision always matches the sum over entries actually present; no drift after the sequence |
| E18 | Four mutation handlers only | decision-table | L1 | automated | buffer with 3 entries | send each of `edit`/`remove`/`promote`/`clear_followup_entries`, plus an unknown `pull_followup_to_editor` message | the four mutate the buffer; the unknown message is not handled; **no** pi method is called by any of them |
| E19 | Out-of-range index | BVA | L1 | automated | buffer `[{text:"a"}]` | `edit_followup_entry { index:5, text:"x" }` | no mutation; `command_feedback { command:"edit_followup_entry", status:"error", message:"Index out of range" }`; no `queue_update` |
| E20 | System follow-up refused at count cap | EP | L1 | automated | buffer holds 20 entries | plugin fires `dashboard:enqueue-followup` | not appended; `command_feedback { command:"enqueue_followup", status:"error" }` — **not** `send_prompt` |
| E21 | System follow-up refused at byte ceiling | BVA | L1 | automated | ceiling 1 KiB; buffer at 1000 B | plugin fires `dashboard:enqueue-followup` with 100 B of text | not appended; `command_feedback { command:"enqueue_followup", status:"error" }` |
| E22 | Session-change releases bytes | state-transition | L1 | automated | buffer holds an image-bearing entry | `session_start { reason:"resume" }` | `bridgeFollowUp` is `[]`; a subsequent admission check sees a zero total; one `queue_update { followUp: [] }` emitted |
| E23 | Server forwards entries verbatim | EP | L1 | automated | server receives `queue_update { followUp:[{text:"c",imageCount:2}] }` | cache update + broadcast | `SessionUiState.pendingQueues.followUp` equals the input; broadcast payload contains `imageCount:2` and **no** `data` field anywhere |
| E24 | Steering stays `string[]` | EP | L1 | automated | `queue_update { steering:["a"], followUp:[{text:"c",imageCount:0}] }` | cache update | `steering` remains a string array; no entry-object coercion applied to it |
| E25 | Nested-shape image sizes by its real bytes (D3c) | BVA | L1 | automated | ceiling injected at 1 KiB; buffer `[]`; one image in the nested Anthropic shape `{type:"image",source:{type:"base64",media_type:"image/png",data:<4 KiB base64>}}` | admission check runs | refused; the entry does **not** size at zero and is not admitted — fails if sizing reads `.data` directly |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | Chip indicates attached images | state-transition | L3 | automated | session streaming; follow-up sent with 2 images | `queue_update` arrives | converges to: `queue-chip-followup` shows the text AND `queue-followup-attachments` present showing 2; no `img` thumbnail inside the chip |
| F2 | Text-only chip unchanged | state-transition | L3 | automated | follow-up sent with no images | `queue_update` arrives | converges to: chip shows text; `queue-followup-attachments` absent from the DOM |
| F3 | Indicator survives an edit | state-transition | L3 | automated | chip showing `queue-followup-attachments` = 1 | user edits the text via `queue-followup-edit` and submits | converges to: updated text rendered AND `queue-followup-attachments` still present with count 1 |
| F4 | Legacy string entry tolerated | state-transition | L1 | automated | reducer receives `pendingQueues.followUp = ["hello"]` | state derived | normalises to `{text:"hello", imageCount:0}`; no `[object Object]` in derived text |
| F5 | Legacy string renders safely | state-transition | L3 | automated | server broadcast carrying a legacy `string[]` followUp | chip renders | converges to: chip text `"hello"`; `queue-followup-attachments` absent; no `[object Object]` anywhere in `queue-panel` |
| F6 | Refusal is user-visible | state-transition | L3 | automated | buffer at the entry-count cap | user sends another follow-up | converges to: a `commandFeedback` row appears in chat carrying the refusal message; buffer chip count unchanged at 20 |
| F7 | Dropped attachment is user-visible | state-transition | L3 | automated | follow-up sent with 3 images, one `image/svg+xml` | `queue_update` + feedback arrive | converges to: `queue-followup-attachments` shows 2 AND a `commandFeedback` row states one attachment was dropped as unsupported |
| F8 | Drained image-bearing message renders a chat row | state-transition | L3 | automated | image-bearing follow-up buffered mid-turn; image large enough to bust the 256 KiB per-event ceiling | turn ends; buffer drains | converges to: a user row carrying the prompt text AND an image slot (thumbnail or the explicit unavailable slot); the row does NOT vanish. Guards the display half closed by `fix-pasted-image-message-vanishes` against regression by this change's new drain payload |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | Drain: pi throws | fault-injection (abort) | L1 | automated | `pi.sendUserMessage` throws synchronously | `agent_end` fires with buffer `[{text:"a"}]` | warning logged containing "drainFollowupQueue" and "entry lost"; buffer `[]`; entry NOT re-pushed; next `agent_end` no-ops |
| X2 | Drain: image-bearing entry lost on throw | fault-injection (abort) | L1 | automated | `pi.sendUserMessage` throws | drain of `{text:"a", images:[PNG]}` | entry (and its bytes) dropped, not re-pushed; a subsequent admission sees the bytes released |
| X3 | Pop-before-send ordering | state-transition | L1 | automated | spies on `shift` and `pi.sendUserMessage` | drain runs | `shift` recorded strictly before `sendUserMessage` in the call log |
| X4 | Idle never settles | fault-injection (delay) | L1 | automated | `ctx.isIdle()` returns false for >2 s | `agent_end` fires with a non-empty buffer | logs `"drainFollowupQueue: pi never idled after 2s; giving up"`; entry remains buffered with its images intact |
| X5 | TUI coexistence | fault-injection (delay) | L1 | automated | `hasPendingMessages()` true | `agent_end` fires | bridge does not drain; buffer unchanged; drains on a later `agent_end` once it returns false |
| X6 | Re-entrant drain | state-transition | L1 | automated | drain mid-execution | second `agent_end` fires synchronously | second invocation early-returns without popping; original completes; next non-re-entrant `agent_end` drains the following entry |
| X7 | Abort does not clear the buffer | state-transition | L1 | automated | buffer holds 2 entries, one image-bearing | `abort` command invoked | `cachedCtx.abort()` invoked; buffer still holds both entries with images; **no** `queue_update` emitted from the abort path; `abortLatch.request` called before `cachedCtx.abort` |
| X8 | Invalid image shapes | fault-injection (bad input) | L1 | automated | images array containing a non-object, one with missing `data`, one with `mimeType:"image/svg+xml"` | follow-up buffered while streaming | all three dropped; valid ones retained; `command_feedback { status:"error" }` emitted stating how many were dropped; process log alone is insufficient |
| X9 | All-invalid attachment set | fault-injection (bad input) | L1 | automated | every supplied image invalid | follow-up buffered | entry buffered as text-only with `imageCount:0`; `command_feedback` error emitted |
| X10 | No feedback when all valid | fault-injection (control) | L1 | automated | two valid images | follow-up buffered | entry carries both; **no** validation `command_feedback` emitted (guards against a false-positive warning) |
| X11 | Nested-shape image is not dropped as invalid (D3c) | fault-injection (shape) | L1 | automated | one image in the nested Anthropic shape carrying `source.media_type:"image/png"` | follow-up buffered | retained with `imageCount:1`; **no** validation `command_feedback` — fails if the mime filter reads `img.mimeType` directly |

---

## Coverage summary

- Requirements covered: 11/11 delta requirements (4 MODIFIED incl. abort, 4 ADDED, 3 REMOVED verified by absence)
- Scenarios by class: edge 25 · perf 0 · frontend 8 · error 11
- Scenarios by level: L1 38 · L2 0 · L3 6
- Scenarios by disposition: automated 44 · manual-only 0

Notes on coverage shape:

- **No L2 (qa VM smoke) rows.** Nothing here is install-, spawn-, or OS-runtime
  shaped; routing a buffer-logic scenario to a shell smoke test would be the
  downgrade the skill warns against.
- **No perf rows** — per C3, the delta states no latency/throughput/RSS
  threshold, and inventing one would fabricate a requirement.
- **REMOVED requirements** are covered negatively: E18 asserts no handler calls
  a pi method (retiring `rewriteFollowupQueue`), and F1/F2 assert the chip
  renders an indicator (retiring the v1 "no attachments on chips" rule). The
  retired display-only requirement is covered by the existing mutation-control
  testids remaining present.

## New infra needed

None. All L1 rows extend existing vitest suites under
`packages/extension/src/__tests__/` and `packages/client/src/lib/chat/__tests__/`;
all L3 rows extend the existing Playwright suite against the docker harness
(port read from `.pi-test-harness.json` `dashboardPort`, never hardcoded).
