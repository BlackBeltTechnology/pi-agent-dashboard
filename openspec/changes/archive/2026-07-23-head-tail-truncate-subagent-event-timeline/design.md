## Context

The dashboard event store bounds every event's serialized `data` to a ceiling
(`DEFAULT_MAX_EVENT_DATA_SIZE = 20_000`) as an OOM guard on the persist/broadcast path
(`change: bound-subagent-event-serialization`). The guard is all-or-nothing: over-ceiling → whole
`data` replaced with `{ __truncated: true, reason, thresholdBytes, eventType }`.

An in-memory subagent forwards a `tool_execution_update` whose payload carries the FULL running
timeline snapshot at `event.data.partialResult.details.entries[]` (latest snapshot supersedes older
ones). Per-field string truncation is disabled by default (`shared/src/config.ts`
`maxStringFieldSize: 0`), so each entry embeds the tool's raw input+output. ~3–4 entries reach 20 KB,
the ceiling trips, `data` is nuked, and the client reducer (`readSubagentDetails`, which only adopts
`entries` when the incoming array is non-empty) stops updating the subagent — the timeline "freezes
at ~3 steps" and the final result never renders.

Relevant code (verified):
- `capString(s, maxSize)` — memory-event-store.ts. Generic branch: `` `${s.slice(0, maxSize)}\n…[truncated]` `` (head only). A skill-envelope branch preserves header + `</skill>` + trailing args.
- `truncateStrings(obj, maxSize, depth)` — recursive per-field trim. Arrays of length > 20 → `"[array truncated]"`. PRESERVES base64 image blocks (`data` string + sibling `mimeType`) at any depth. Runs only when `stringPass` (`maxStringSize > 0`), i.e. off by default.
- `walkSize`/`exceedsSerializedSize(value, cap)` — early-exit size estimate. CHAR-approximate: `+2` per string (ignores JSON escape expansion + UTF-8 width) and counts a base64 image `data` as **8 bytes**. Bounded-cost (stops once the running total crosses `cap`).
- `createTruncator(maxStringSize, maxEventDataSize)` — `stringPass`/`sizePass` flags; over-ceiling → placeholder.
- `readSubagentDetails(details)` — client; adopts `details.entries` only when non-empty.
- `SubagentTimelineEntry` — union `tool | text | thinking | error`. `MinimalChatEntry` (client-utils) — union `tool | text | thinking | error`; its consumer switch in `MinimalChatView` is `default: return null` (NOT `never`-exhaustive). `mapSubagentEntries` default returns `{ kind: "error", text: "(unknown entry)" }`.

## Goals / Non-Goals

**Goals:**
- Over-ceiling subagent events keep the BEGINNING and END of the timeline (steps + final result),
  eliding the middle, while the stored/broadcast event stays ≤ the ceiling (+ a small constant) in
  ACTUAL bytes — for any input incl. base64 images, CJK, and escape-heavy strings.
- Make the size accounting BYTE-ACCURATE and keep it BOUNDED-COST (no full `JSON.stringify` anywhere
  on the persist/broadcast path). This also fixes the pre-existing broadcast-OOM where an
  image-bearing NON-subagent event undercounts (image=8 bytes) and escapes the ceiling (in scope per
  the cycle-2 decision).
- Zero behavior change for non-subagent events except the byte-accurate detection (which only makes
  the EXISTING placeholder fire correctly for previously-undercounted events), and for under-ceiling
  subagent events.

**Non-Goals:**
- Raising or config-wiring the ceiling (stays 20 KB, still constructor-injectable, `0` = disabled).
- Globally enabling per-field string truncation (`maxStringFieldSize` default stays `0`).
- Client-side union/merge of successive snapshots (latest-replaces preserved).
- Any change to the parent's in-process `AgentToolResult`.
- A new `SubagentTimelineEntry` / `MinimalChatEntry` wire kind (the elision marker is a `text`
  sentinel — see D5).

## Decisions

### D1 — Reduce on the over-ceiling path, TYPE-scoped to subagent events, detected BEFORE the generic trim
`createTruncator` detects a subagent-timeline event on the ORIGINAL `event` (before the generic
`truncateStrings` pass runs), and for such events routes to `reduceSubagentEvent(event, ceiling)`
INSTEAD of the generic per-field pass + `{ __truncated }` placeholder. Non-subagent events keep the
existing path unchanged.

**Detection is type-scoped, not shape-only** (closes the false-positive hole): an event qualifies
ONLY when it is a subagent-carrying tool event — `event.data.toolName === "Agent"` (or
`eventType ∈ {tool_execution_update, tool_execution_end}` with a `details.agentId`) AND an
`entries[]` array is reachable at `data.partialResult.details.entries` (live update) or
`data.details.entries` (started/end snapshot). A bare array at those paths on an unrelated event does
NOT qualify — shape alone is insufficient. The resolved `details` reference (whichever shape matched)
is carried forward so `description`/`content` are capped on the SAME object `entries` came from.

**Detect-before-generic-trim** (closes the `>20`-array clobber, contract 3): because the generic
`truncateStrings` collapses any array of length > 20 to `"[array truncated]"` and runs before the
size check, a >20-entry `entries[]` would be clobbered to a string BEFORE detection when
`maxStringFieldSize > 0`. Detecting on the original event and SKIPPING the generic pass for subagent
events makes the protection independent of the `maxStringFieldSize` value — not merely a consequence
of the `0` default.

Alternative rejected: flip `maxStringFieldSize` to a non-zero default so `truncateStrings` runs for
all events. Broad, changes chat rendering everywhere, and still hits the `obj.length > 20` array
clobber. Rejected for blast radius.

### D2 — `capString` head+tail, 50/50 (generic branch only)
Generic branch becomes: keep `floor(maxSize/2)` head + `maxSize - floor(maxSize/2)` tail (a 50/50
split — the safe universal across tool outputs and errors), joined by a
`\n…[N chars hidden]…\n` marker (N = original length − kept). The skill-envelope branch is unchanged
— head+tail on a skill body risks the client `parseSkillBlock` contract, and that branch already
bounds the body while keeping the closing tag. `capString` is a pure helper; making it head+tail is a
correctness improvement wherever it is used (today only inside the reduction path, since global
per-field trim is off).

### D3 — `reduceSubagentEvent` algorithm (tail-weighted, final-protected, BYTE-bounded, no full stringify)
The bug is a *lost tail* (the user already sees the head; the missing thing is the final result), so
the reduction is tail-weighted and protects the final entry above all else. Every measurement uses
the byte-accurate BOUNDED walk `measureBytes` (D8) — there is NO full `JSON.stringify` anywhere.

Parameters (constants where fixed, else derived):
- `K_HEAD = 1`, `K_TAIL = 4` — keep 1 opening entry + up to 4 closing entries around the marker.
- Non-`entries` string caps: `PROMPT_CAP = 2_000` (`data.args.prompt`), `DESC_CAP = 1_500`
  (`details.description`), `CONTENT_CAP = 1_500` (applied to EVERY string reachable inside
  `data.partialResult.content[*]` — both `.text` AND base64 image `.data`, recursing container blocks
  such as `tool_result.content[j]`). **No image preservation on this path** — a truncated base64
  image is acceptable; the timeline renders steps + text, not an embedded image. This guarantees NO
  large string outside `entries[]` survives uncapped (the hole that let the byte-gate self-OOM).
- `E = ceiling − measureBytes(data-without-entries, post-cap) − markerReserve` — dynamic entries
  budget. `markerReserve` covers the sentinel entry + per-field `…hidden…` markers.
- `ENTRY_FINAL = clamp(round(E × 0.45), 1_500, 6_000)` — per-**ENTRY** byte budget for the LAST entry.
- `ENTRY_MID = (E − ENTRY_FINAL) / (kept − 1)`, `MID_FLOOR = 800`, `ENTRY_FLOOR = 256` — per-**ENTRY**
  byte budgets. Enforcement is at the ENTRY level, not per-leaf (D3a).

**Immutability (contract):** `reduceSubagentEvent` returns a NEW `{ ...event, data }` with the
touched paths (`data`, `data.args`, the resolved `details`, and `details.entries` reassigned)
shallow-cloned along the mutated spine — it NEVER mutates the in-flight `event` held by the
bridge/logger, matching the existing truncator's return-new-object contract.

On the clone, apply steps in this order — cheapest/least-valuable data first, the final result
squeezed LAST:
0. **Cap ALL big non-`entries` strings** (prompt, description, every `content[*]` text AND image
   `data`, recursing container blocks). After step 0 no non-`entries` string exceeds its cap, so the
   envelope — and every later `measureBytes` — is provably bounded.
1. **Compute `E`** via `measureBytes(data-without-entries)`; derive `ENTRY_FINAL`; **drop the middle**
   — keep first `K_HEAD` + last `K_TAIL` entries, splice the removed middle into ONE `text` sentinel
   entry `{ kind: "text", text: "⋯ N steps hidden ⋯", ts }` (D5; `ts` = first removed entry's `ts`).
2. **Shrink intermediate entries** to `ENTRY_MID` via the entry-level shrink loop (D3a). If
   `ENTRY_MID < MID_FLOOR`, decrement `K_TAIL` (fold into the sentinel count) and recompute.
3. **Shrink the final entry last** to `ENTRY_FINAL`, then progressively down to `ENTRY_FLOOR`.
4. **Byte-accurate terminal proof.** `measureBytes(reducedData) ≤ ceiling` — byte-accurate AND
   bounded (D8), NO `JSON.stringify`. If still over, shrink further (drop a tail entry / lower the
   entry floor); if unreducible (e.g. empty `entries[]`), **fall back to the `{ __truncated }`
   placeholder** — built as a small object, NEVER stringifying the oversized original. The
   all-or-nothing guard remains the terminal guarantee.
Return the new event with the reduced `entries[]` + capped strings; all other `data` fields intact.

### D3a — Entry-level shrink loop (per-ENTRY budget, sound over non-string fields)
`truncateStrings` caps each string LEAF at `maxSize`, so applying it to an entry whose `input` is an
OBJECT with N string leaves yields ≈ N×`maxSize` — the per-entry budget is NOT enforced (a cycle-2
blocker), and container-held base64 leaves would escape entirely. Instead, to shrink one entry to a
byte budget `B`: while `measureBytes(entry) > B`, head+tail-`capString` the entry's CURRENTLY-LARGEST
string leaf (located by one bounded walk) at a shrinking cap, down to `ENTRY_FLOOR`; stop when the
ENTRY's measured bytes ≤ `B` or all leaves are at the floor. This bounds the entry TOTAL regardless of
how many leaves `input`/`output` contain, and caps base64/image leaves inside entries too. It never
relies on the per-leaf `maxSize` semantics that made the naive split unsound.

### D4 — `entries[]` never hits the generic `obj.length > 20` clobber (config-independent)
The generic `truncateStrings` collapses any array of length > 20 to `"[array truncated]"` and runs
BEFORE the size check. Merely operating the reducer on the array is NOT enough — when
`maxStringFieldSize > 0` the generic pass would clobber `entries[]` to a string before the reducer is
reached. Per D1, subagent events are DETECTED on the original event and the generic pass is SKIPPED
for them entirely; the reducer then does its own per-INDIVIDUAL-entry trimming. This closes the
second landmine independently of the `maxStringFieldSize` value, not merely as a consequence of the
`0` production default.

### D5 — Elision marker: a graceful `text` sentinel (no new wire kind)
The marker is a normal `{ kind: "text", text: "⋯ N steps hidden ⋯", ts }` entry — NOT a new union
kind. Rationale (both reviewers, cycle 2):
- A dedicated `elided` kind has **no compile enforcement**: `FlowAgentDetail` switches on a DIFFERENT
  union (`FlowDetailEntry`), and `MinimalChatView`'s consumer switch is `default: return null` (not
  `never`), so a forgotten `case` renders NOTHING silently — the divider just never appears.
- A dedicated kind renders as a RED `(unknown entry)` error on ALREADY-DEPLOYED clients during the
  rollout window (`mapSubagentEntries` default returns `error`), violating "no misleading render".

A `text` sentinel renders as plain, readable text on EVERY client version (old and new), needs NO
`SubagentTimelineEntry` / `MinimalChatEntry` change, and drops the `FlowAgentDetail` cross-plugin
coupling entirely — so this change becomes effectively **server-only**. A future client MAY detect the
sentinel prefix to style it as a divider (optional, out of scope). Trade-off (user-accepted): slightly
less visually distinct than a bespoke divider, in exchange for zero wire-type surface and rollout
safety. Consequence: no `SubagentTimelineEntry.kind` change means the existing `mapSubagentEntries`
`never`-exhaustiveness guard is PRESERVED (a real future kind still fails compile, as desired).

### D6 — Latest-replaces tradeoff (accepted)
Because snapshots replace wholesale and `readSubagentDetails` adopts any non-empty incoming
`entries`, a later reduced snapshot ([first K, sentinel, last K]) replaces an earlier fuller
under-ceiling snapshot. A mid-run entry visible earlier can therefore disappear once the run grows
past the ceiling. Accepted: strictly better than today (all entries dropped), and client-side merge
(retain a superset) is deferred as unnecessary complexity.

### D7 — Budget derived from a MEASURED envelope, and the non-`entries` strings are capped
Measured against a realistic Agent `tool_execution_update` payload (`AgentDetails` wrapper + envelope
keys `type`/`toolCallId`/`toolName`/`args`/`partialResult`):
- Fixed scalar overhead (all metadata, `entries:[]`, near-empty `args`/`description`): **~921 B**.
- `data.args.prompt` (the subagent task) is echoed on every update, and `details.description` can be
  large. Uncapped, they scale the envelope 1.3 KB → 3.3 KB → 10.4 KB → 19.9 KB for prompts of
  0.3 KB / 2 KB / 8 KB / 16 KB — the 16 KB prompt leaves **81 B** for the timeline (starved).
- A THIRD large non-`entries` string exists: `partialResult.content[*].text` (the streaming partial
  answer). It must be capped too (`CONTENT_CAP`), else it re-opens the exact starvation via a field
  the first draft did not enumerate.
- With `PROMPT_CAP=2_000` + `DESC_CAP=1_500` + `CONTENT_CAP=1_500` head+tail caps, the envelope is
  bounded at **~6 KB** worst case, so the entries budget `E` never falls below **~14 KB** regardless
  of any single large field; `ENTRY_FINAL=6_000`, `ENTRY_MID≈2.3–3 KB`, `kept=5` hold across the range.

Consequences folded into D3: (a) budgets are DERIVED from the runtime `E`, not fixed constants;
(b) step 0 head+tail-caps ALL known large non-`entries` strings (`prompt`, `description`, `content`)
so no single field can starve the timeline. `prompt`/`content` are not the primary timeline UI, so
capping is display-safe; `description` (card header) keeps a 1.5 KB head+tail. **Char vs byte:** the
ORIGINAL walk was char-approximate (ignored JSON escapes + UTF-8 width, up to ~3–6× undercount for
CJK/escape-heavy input, and counted base64 images as 8 bytes). D8 replaces it with a byte-accurate
BOUNDED walk (`measureBytes`) used for BOTH `E` and the terminal proof — so no `JSON.stringify` is
ever materialized and the bound holds in ACTUAL bytes. The ~921 B / ~6 KB figures are a representative
reconstruction; the runtime uses the ACTUAL measured envelope — the constants are only caps/clamps.

### D8 — Byte-accurate, bounded size accounting (generic path; also fixes a pre-existing image OOM)
The size measurement (`walkSize` / `exceedsSerializedSize`, and the reducer's `measureBytes`) becomes
byte-accurate while staying bounded-cost:
- Per string, add its JSON-serialized BYTE length (UTF-8 width + escape expansion), not `length + 2`.
  **Short-circuit:** UTF-8 bytes ≥ UTF-16 code units, so `str.length` is a lower bound — if
  `runningTotal + str.length` already exceeds the ceiling, stop WITHOUT scanning the string (bounded
  even for a 5 MB field; no full copy/stringify).
- Count a base64 image `data` string at its REAL size, not the current constant 8 bytes.
- Early-exit at the ceiling preserved; no full `JSON.stringify` ever materialized.
This is a GENERIC-path change (in scope per the cycle-2 decision): it makes the existing over-ceiling
detector byte-correct for ALL events, which ALSO fixes the pre-existing broadcast-OOM where an
image-bearing NON-subagent event undercounts (image=8 bytes) → stored at full size → unbounded
`JSON.stringify` on broadcast. With D8 such an event correctly trips the ceiling and gets the
`{ __truncated }` placeholder. The subagent reducer reuses `measureBytes` for `E` and its terminal
proof, so no code path performs an unbounded stringify. The non-subagent behavior change is strictly
from "silently over-ceiling" to "correctly placeholdered" — the intended guard behavior.

## Risks

- **OOM bound violable by char/byte mismatch + escaped images** (BLOCKER, both reviewers, cycles 1+2).
  The original walk under-counted JSON escapes/UTF-8 (3–6×) and counted images as 8 bytes; a naive
  `JSON.stringify` terminal gate would itself allocate a multi-MB image that escaped capping — the
  OOM inside the guard. Mitigation: D8 byte-accurate BOUNDED `measureBytes` (no stringify) is the
  proof; D3 step 0 caps EVERY non-`entries` string incl. base64 image `data`, so no large field
  survives; unreducible → `{ __truncated }` fallback built without stringifying the original.
- **Per-entry budget unsound over object fields** (BLOCKER, cycle 2). A per-leaf `maxSize` on an
  entry whose `input` is an object with N leaves yields N× the budget. Mitigation: D3a entry-level
  shrink loop bounds the ENTRY total via `measureBytes(entry)`, independent of leaf count, and caps
  base64 leaves inside entries.
- **Unreducible subagent event** (e.g. `entries: []` + still-oversized envelope). Mitigation: the
  terminal proof falls back to `{ __truncated }` — the all-or-nothing guard remains the final
  guarantee, so the bound holds even when there is nothing to head+tail.
- **Cost** of repeated size checks. Mitigation: `measureBytes` early-exits once the running total
  crosses the ceiling and short-circuits huge strings via the code-unit lower bound — bounded even
  for a 5 MB field. Total = O(steps × traversed), steps ≤ ~7 with `K` small — no full stringify.
- **Rollout render** of the sentinel: it is a plain `text` entry, so every client version (incl.
  stale PWA bundles) renders it as readable text, never a red error — no wire-type drift.
- **`args.prompt` may not appear on every update** (bridge forwarding could omit it on some frames).
  The cap is defensive — a no-op when absent — and `E` is always computed from the ACTUAL measured
  envelope, so a missing field just yields a larger timeline budget, never a smaller one.

## Migration / Rollout

Pure runtime behavior change on the persist/broadcast path; no persisted-schema or protocol-version
change, and (via the `text` sentinel) NO client wire-type change — effectively **server-only**.
Existing stored `{ __truncated }` placeholders are unaffected. Deploy = server restart
(`/api/restart`); no client build is required for correctness (the sentinel renders as text on any
client).
