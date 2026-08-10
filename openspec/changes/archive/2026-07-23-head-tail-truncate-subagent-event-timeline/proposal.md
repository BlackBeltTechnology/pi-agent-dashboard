## Why

An in-memory subagent's live timeline freezes after ~3 steps and its later output (including a large
final result) never appears in the dashboard. The root cause is **not** a `.slice(-3)` — it is the
per-event serialized-size ceiling in the in-memory event store.

- `packages/server/src/persistence/memory-event-store.ts` bounds each event's `data` to
  `DEFAULT_MAX_EVENT_DATA_SIZE = 20_000` bytes. When a `tool_execution_update` carrying the
  subagent's full `entries[]` snapshot (`event.data.partialResult.details.entries[]`) crosses that
  ceiling, the truncator (`createTruncator`) replaces the **entire** `data` with a placeholder
  `{ __truncated: true, … }`. The client reducer (`readSubagentDetails`) then finds no `entries` →
  the subagent state stops updating. Each entry carries the tool's raw input+output because per-field
  string truncation is disabled by default (`shared/src/config.ts` `maxStringFieldSize: 0`), so
  ~3–4 entries fill 20 KB and trip the all-or-nothing nuke.
- This is a **display/observability** bug: the dashboard event store is a passive observer. The real
  `AgentToolResult` handed to the parent session flows in-process and is unaffected — the parent's
  reasoning is intact; only the dashboard's view is clipped.

The existing 20 KB nuke exists for a real reason: it is an OOM guard on the persist/broadcast path
(`change: bound-subagent-event-serialization`). Any fix MUST keep the output bounded. The problem is
that the guard is *all-or-nothing* — it discards everything instead of preserving what fits.

## What Changes

Replace the all-or-nothing nuke, for subagent-timeline events only, with a **structure-aware
head+tail reduction** that keeps the beginning and the end of the run and drops the middle — so the
first steps and the final result both remain visible, while the event stays under the ceiling.
Two composed levers ("A + B"):

- **A — `capString` becomes head+tail.** Today `capString` (memory-event-store.ts) keeps only the
  head of an over-long string (`s.slice(0, maxSize) + "…[truncated]"`). Change the generic branch to
  keep the first half AND the last half with a `…[N chars hidden]…` middle marker, so a big tool
  output shows both its start and its end. The existing skill-envelope branch (which preserves the
  closing `</skill>` tag) is left unchanged.
- **B — over-ceiling subagent events reduce `entries[]` head+tail instead of nuking.** The bug is a
  *lost tail* (the head is already visible; the missing thing is the final result), so the reduction
  is **tail-weighted** and protects the final entry. **Detection is type-scoped** (`toolName=="Agent"`
  / a `details.agentId`, not shape alone) and runs on the ORIGINAL event BEFORE the generic per-field
  trim (so the generic `>20`-array clobber can never reach `entries[]`, independent of
  `maxStringFieldSize`). Keep the first entry + last 4 (`K_HEAD=1`, `K_TAIL=4`) around a marker;
  reduce in priority order: cap ALL big non-`entries` strings, drop the middle, shrink intermediate
  entries, shrink the **final entry last**. Budgets are **per-ENTRY**, enforced by an entry-level
  shrink loop (`measureBytes(entry) ≤ budget`, sound even when `input` is an object with many
  leaves). The bound is proven by a **byte-accurate BOUNDED measure** (D8 — no full `JSON.stringify`
  anywhere; the char walk under-counted escapes/UTF-8/images). **Unreducible** (e.g. empty `entries[]`)
  → **falls back to `{ __truncated }`** (built without stringifying the original). The reducer returns
  a NEW event (cloned spine) — never mutates the in-flight event. Non-subagent over-ceiling events
  keep the placeholder — no behavior change off-path.
- **Cap ALL large non-`entries` strings, incl. base64 images.** `data.args.prompt`,
  `details.description`, and EVERY string inside `data.partialResult.content[*]` — both `.text` AND
  base64 image `.data` (recursing container blocks) — live outside `entries[]`; uncapped, any one
  starves the timeline OR (an image) makes a later serialization allocate multi-MB. The reducer
  head+tail-caps them all (`PROMPT_CAP≈2 KB`, `DESC_CAP`/`CONTENT_CAP≈1.5 KB`); no image is preserved
  on this path, so no large field survives uncapped.
- **Byte-accurate, bounded size accounting (generic path).** `walkSize`/`exceedsSerializedSize` count
  each string's real JSON byte length (UTF-8 + escapes; short-circuit via the code-unit lower bound)
  and count base64 images at real size — staying early-exit/bounded (no full `JSON.stringify`). This
  also fixes the **pre-existing** broadcast-OOM where an image-bearing NON-subagent event undercounted
  (image=8 bytes) and escaped the ceiling; it now correctly gets the `{ __truncated }` placeholder.
- **Fix the `obj.length > 20` array landmine.** `truncateStrings` currently replaces any array of
  length > 20 with the string `"[array truncated]"`. The subagent-entries reduction path handles the
  `entries[]` array explicitly and MUST NOT let the generic rule clobber it to a string.
- **Elision marker is a graceful `text` sentinel — no client change.** The removed middle becomes a
  normal `{ kind: "text", text: "⋯ N steps hidden ⋯", ts }` entry — NOT a new wire kind. It renders
  as readable text on EVERY client version (incl. stale PWA bundles), so there is no red-error
  rollout window and no `MinimalChatEntry`/`FlowAgentDetail` change. This makes the change effectively
  **server-only** (a future client may optionally style the sentinel).

Non-goals: raising or config-wiring `MAX_EVENT_DATA_SIZE` (the ceiling stays 20 KB — this change
makes it non-destructive for subagent timelines, not larger); globally enabling per-field string
truncation for all events (`maxStringFieldSize` default stays `0`); any change to the parent's
in-process `AgentToolResult`; merging/union of successive snapshots on the client (latest-replaces
semantics are preserved).

## Capabilities

### Modified Capabilities
- `in-memory-event-buffer` — the "Per-event total-serialized-size ceiling" requirement gains a
  head+tail reduction branch for TYPE-scoped subagent-timeline events (first-K + last-K entries + a
  `text` elision sentinel, per-ENTRY byte budgets, all non-`entries` strings incl. base64 images
  capped) that replaces the blanket placeholder ON THAT PATH, with a `{ __truncated }` fallback when
  unreducible; non-subagent over-ceiling events keep the placeholder. The size accounting becomes
  BYTE-ACCURATE and stays BOUNDED (no full `JSON.stringify`), which also corrects the pre-existing
  image-bearing undercount for all events. `capString` becomes head+tail rather than head-only.

## Impact

- **Server (only):** `packages/server/src/persistence/memory-event-store.ts` — `capString` head+tail;
  byte-accurate BOUNDED `walkSize`/`measureBytes` (UTF-8 + escapes, code-unit short-circuit, real
  image sizing, no full stringify); a type-scoped subagent reducer detected BEFORE the generic trim
  and invoked from `createTruncator` (generic pass skipped for subagent events); caps ALL non-entries
  strings incl. base64 image `data`; entry-level per-ENTRY shrink loop; `text` sentinel marker;
  `{ __truncated }` fallback; returns a new (cloned) event.
- **Client:** none required for correctness — the `text` sentinel renders on any client. (Optional
  future nicety: style the sentinel prefix; out of scope.)
- **Tests:** `memory-event-store` truncation tests (head+tail `capString`; skill-envelope preserved;
  byte-accurate bound under CJK/escape input; over-ceiling subagent event keeps first/last entries +
  `text` sentinel and stays ≤ ceiling in ACTUAL bytes; base64 image in `content`/entry does not OOM
  and stays bounded; >20-entry array not clobbered; multi-leaf-object `input` respects the per-ENTRY
  budget; shape-only non-subagent event not reduced; unreducible empty-entries falls back to
  placeholder; reducer does not mutate the input event; pre-existing non-subagent image event now
  placeholdered).
- **Behavior:** the parent agent's received result is unchanged; only the dashboard's rendered view
  improves (from "frozen at ~3 steps" to "start + end of the run, middle elided").
- **Known tradeoff:** a later reduced snapshot replaces an earlier fuller (under-ceiling) one under
  latest-replaces semantics, so a mid-run entry visible earlier can drop once the run grows past the
  ceiling. Strictly better than today (all entries dropped), and avoids client-side merge complexity.

## Discipline Skills

`review-code` (non-trivial change to a shared persist/broadcast path), `performance-optimization`
(the change lives on a memory-bounded / OOM-guard path — the reduction must stay bounded-size and
bounded-cost), `doubt-driven-review` (modifies an existing OOM-safety invariant before it stands).
