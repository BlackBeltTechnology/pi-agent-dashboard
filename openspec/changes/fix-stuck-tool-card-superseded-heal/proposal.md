## Why

A tool card can stay stuck on the running spinner **permanently** — observed at 2 min+
with no recovery — while the session keeps rendering later cards normally. The base
change `fix-stuck-tool-card-on-dropped-event` heals the common case (terminal event
dropped on the server→browser hop, still recorded in the store) via an HTTP reconcile
at `STALE_TOOL_MS` (~25 s). But that reconcile is **recovery-only**: it flips the row
only on an HTTP 200 carrying the authoritative result, and on 404 it deliberately
leaves the row running and never synthesizes a completion.

That leaves a documented **known limitation** unhealed — the base change's own
`Scenario: Evicted result cannot reconcile` states the client "SHALL leave the row
running", recovered only by an in-app full replay (`lastSeq:0`) or a bridge reconnect
re-sync. Neither happens automatically. So whenever the authoritative result is
**unrecoverable**, the card spins forever:

1. **Store eviction.** `MemoryEventStore` caps a session at `DEFAULT_MAX_EVENTS_PER_SESSION`
   (20 000). A subagent-heavy turn trims the oldest events, including the
   `tool_execution_end`. The reconcile route 404s indefinitely → permanent stuck card.
2. **Bridge→server ring eviction with no reconnect re-sync.** `connection.ts` evicts the
   oldest buffered message on overflow (`buffer.shift()`, cap 10 000) while the WS is not
   `OPEN`. The event is never recorded server-side, so the reconcile 404s. The base
   change relies on `replaySessionEntries()` on bridge reconnect — but if the WS blips
   without a full reconnect re-sync, nothing recovers it.

In every one of these cases the tool **did finish** — proven by the same evidence the
base change already relies on: **a strictly-later assistant inference exists in the
transcript.** The model cannot emit a new inference until every prior tool result returns
(true even for parallel tool calls). If the session moved past the tool's turn, the tool
is complete; the card is stale, not the agent. Today the client has no backstop that
acts on that proof when the result body is gone.

## What Changes

Add a **supersede-proof terminal fallback** — a client-side heal of last resort that
finalizes a stuck card when (a) recovery is exhausted and (b) the transcript proves the
tool finished. It runs strictly **after** the base reconcile, so a recoverable real
result always wins (better fidelity); the fallback only fires when the real result is
unrecoverable.

- **Superseded terminal heal (client).** A `running` tool row whose recovery is exhausted
  (base reconcile returned HTTP 404 at least `SUPERSEDE_MIN_404` times, i.e. the store
  has no result) AND for which a **later assistant inference (a later assistant
  `message_start`) exists after the tool call's own inference** SHALL be finalized to a
  terminal state via the existing `toolCallId`-keyed
  reducer path, carrying a sentinel body (`result unavailable — recovered by supersede
  heal`) and a `healedBy: "superseded"` detail. The card stops spinning and renders a
  small "result not captured" note.

- **Real result still wins if it later arrives.** A genuine `tool_execution_end` (from a
  late reconcile 200, an in-app full replay, or a bridge reconnect re-sync) SHALL
  overwrite a supersede-healed placeholder — the only case where a terminal row is
  allowed to be re-reduced.

- **Supersede signal is inference-scoped, not sibling-scoped.** The proof MUST be a
  *later assistant `message_start`* after the tool call's inference — NOT merely another
  `tool_start` in the same inference — so parallel in-flight tools within the current
  inference are
  never falsely completed.

Non-goals: raising store/ring caps; changing the base reconcile's HTTP path; per-event
acks; healing a tool whose inference is still the active/in-flight one (no later
assistant inference yet); healing an **aborted** tool (user abort / `agent_end` with no
later inference — the tool did not finish, so no later-inference proof exists and the card
correctly stays running; the abort-stuck-card class is a separate concern).

## Capabilities

- `incremental-event-sync` (MODIFIED reconcile requirement; ADDED superseded-heal
  requirement) — carve the unrecoverable-but-superseded case out of the base change's
  "leave the row running" rule, and define the fallback that finalizes it.

## Dependencies

- Builds on `fix-stuck-tool-card-on-dropped-event` (still active). This change MUST
  archive after, or together with, that base change. The MODIFIED requirement below
  edits a requirement that base change ADDs.

## Open Caveats (pick up later)

Captured here so they can be scoped into this change or split into follow-ups; not
blocking the fallback above.

- **C1 — This is a display heal, not a recovery.** In the eviction case the real tool
  output is genuinely lost; the fallback finalizes the card with a sentinel body and a
  loud badge (masking a real result loss as a bodyless success is deliberately visible,
  not hidden). The true source fix — never-evict the latest `tool_execution_end` per live
  tool call, or a bounded terminal-event keepalive ring in `MemoryEventStore` — is parked
  in design.md "Deferred". Decide whether to pull it into this change or a follow-up.

- **C2 — Attribution is still inferential.** The base change already noted its incident
  attribution was inferential from stall telemetry; this change has not proven *which* hop
  dropped the 2 min+ observed cards. Before implementing, a live confirmation should run:
  grep the running server/bridge for `droppedBufferedCount > 0` and a persistent HTTP 404
  on `GET /api/sessions/:id/tool-result/:toolCallId` to distinguish store-eviction from a
  transport drop. Gates whether C1's source fix is worth pulling forward.

## Discipline Skills

- `doubt-driven-review` — this deliberately relaxes the base change's explicit "SHALL NOT
  synthesize a completion" invariant; stress-test the supersede condition for false
  positives (parallel tools, active turn) before it stands.
- `systematic-debugging` — reproduce the unrecoverable path (404 forever + later turn)
  before adding the fallback.
- `observability-instrumentation` — count + badge every supersede-synthesized completion
  so a real result loss is never silently masked as success.
