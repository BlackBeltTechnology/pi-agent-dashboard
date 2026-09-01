---
session: 83c66861
week: 2026/W14
type: development
model: "@fast"
premium: true
premium_reason: "heavy steering (23 user prompts); large facts sheet (~11628 tok)"
upgrade_status: pending
openspec_changes: [catch-all-event-forwarding, server-side-event-processing]
proposal_excerpt: "The bridge extension forwards only a hardcoded whitelist of 12 pi core event types to the dashboard server. Any event outside this list — from other extensions, future pi core additions, or custom tool interactions —…"
---

# How we did it: Make the bridge a dumb pipe (emit all events) — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The operator opened with (lightly paraphrased from a fast, typo-heavy prompt):

> "Think ultrahard. Currently there are events (extensions) which are not emitted to
> the dashboard, because the dashboard gets a selected scope of messages. It can lead
> to problems — it can block working when an unknown tool call arrives, and it can get
> stuck. Is it possible that we emit all messages, just render JSON — as another
> message type — an expandable message type with JSON content?"

The **real objective**, once the follow-ups clarified it, was two coupled changes:

1. **`catch-all-event-forwarding`** — stop the bridge extension from forwarding only a
   hardcoded 12-event whitelist. Make it a *dumb pipe*: forward every pi core event and
   every EventBus (flow/subagent/custom) emission, so the dashboard never goes blind on
   unknown activity.
2. **`server-side-event-processing`** — now that the server receives *all* raw events,
   move the enrichment logic (OpenSpec activity detection, stats extraction) out of the
   bridge and into the server, shrinking the bridge to pure transport.

Crucially, the client side was **already built** (a `RawEventCard` + reducer path for
unknown events existed) — so the whole job was extension + server + spec/archive work.

## 2. TL;DR playbook

1. **Ask for a plan, not code, first.** Prompt: *"I would like to make a plan, not
   changes. Think ultrahard…"* — force the discovery pass before any edit.
2. **Let the AI map the event system.** It will find pi has **two** event systems, and
   that **neither supports a wildcard** — `pi.on()` is a `Map<string,handler[]>` lookup,
   `pi.events` is a Node `EventEmitter` with no `onAny()`.
3. **Pick the mechanism explicitly.** Catch-all = (a) subscribe to *all* core event
   types by name minus the payload-heavy ones, plus (b) **monkey-patch `pi.events.emit`**
   to intercept the EventBus. State this so the AI doesn't chase an impossible clean API.
4. **Scaffold the change with OpenSpec:** `/opsx:ff catch-all-event-forwarding`
   (proposal → design → specs → tasks in one shot).
5. **Resolve the "which events stay special" question up front.** Session lifecycle
   events (`session_start/switch/fork/shutdown`) have dedicated handlers — decide "skip
   them, but *document* that they're handled specially and not forwarded."
6. **Apply, then split off the server change.** `/opsx:apply`, then recognize OpenSpec +
   stats detection can now move server-side → open `server-side-event-processing`.
7. **Verify → archive → sync specs → fix stale spec references → commit + push.**
   Use `/opsx:verify`, `/opsx:archive`, then hand-sync the delta specs and correct any
   requirement text the *second* change made stale in the *first* change's archived spec.

## 3. How the collaboration unfolded

**Phase 1 — Discovery (why the bridge was blind).** The AI grepped `bridge.ts`,
`event-reducer.ts`, and the pi `dist/core/extensions/*` internals. Key finding: the
**client was already done** — `RawEventCard` renders unknown event types as collapsed
JSON. The only gap was the bridge whitelist. *Why it worked:* reading the pi runtime
source (`runner.js`, `event-bus.js`, `loader.js`) proved there is **no `*` wildcard**,
which killed the naive "just subscribe to everything" idea before it wasted edits.

**Phase 2 — Constraint framing.** The AI reduced the design space to two real options:
monkey-patch `pi.events.emit`, or enumerate every core event by name. It picked *both*
(names for `pi.on` core events, emit-intercept for the EventBus). The human steered the
scope with *"What if I catch all in the bridge and deliver to server?"* and *"make the
bridge a dummy that just delivers messages."*

**Phase 3 — Spec scaffolding.** `/opsx:ff` produced proposal/design/specs/tasks. The AI
proactively **flagged the overlap** with dedicated session-lifecycle handlers and asked
whether to forward them too. The human's ruling: *skip, but document.* That became a
first-class spec requirement ("Control events handled specially and not forwarded").

**Phase 4 — Implementation (catch-all).** Split the event list into `enrichedEventTypes`
(12, special logic) + `passThroughEventTypes` (11, forward as-is), excluded `context` and
`before_provider_request` as too large, wrapped `pi.events.emit` with an `EVENT_BUS_MAP`
rename table + raw-channel fallback, and added cleanup to restore the original emit on
reload/shutdown. Type-check surfaced `pi.events` TS errors — the AI correctly identified
them as **pre-existing** (same `as any` pattern used everywhere), not regressions.

**Phase 5 — Second change (server-side processing).** Now that the server sees full
`tool_execution_start` args and `turn_end` usage, the AI audited *all* bridge logic and
found 3 items movable (OpenSpec detection, OpenSpec clear on `agent_end`, stats
extraction) and 6 that must stay (need pi process APIs: git polling, model list,
heartbeat, firstMessage, etc.). It moved `openspec-activity-detector.ts` and
`stats-extractor.ts` into `src/shared/`, inlined processing into the server's
`event_forward` handler, and **deleted** the `openspec_activity_update` + `stats_update`
protocol messages and their handlers.

**Phase 6 — Verify, archive, reconcile.** `/opsx:verify` (9/9 tasks, requirement-by-
requirement evidence), `/opsx:archive`, hand-sync delta specs into main specs. A subtle
catch: the *second* change made two requirement statements in the *first* change's
archived spec stale (`sendModelUpdateIfChanged()` gone, OpenSpec detection moved). The
human said *"fix"* → 4 files corrected. Then *"commit and push"* → `1d9e40d` on `develop`.

## 4. Prompts that worked

- **Goal prompt (make it plan-first):** the *second* prompt — *"I would like to make a
  plan, not changes. Think ultrahard…"* — was the effective kickoff. The very first
  prompt read as an implementation request and would have triggered edits; restating it
  as *plan-only* is what unlocked the clean discovery pass. **Lead with "plan, not
  changes" for any architectural ask.**
- **Scope-tightening follow-up:** *"make the bridge a dummy who is able to deliver
  messages"* — one sentence that set the entire architecture (transport vs. processing).
- **The reframe that spawned change #2:** *"Is it possible that OpenSpec events are
  handled server-side, not bridge-side?"* followed by *"check all other core functions…
  their messages can be processed server side."* This turned a single change into a
  clean two-change sequence.
- **High-leverage one-worders:** `yes`, `go on`, `fix`, `commit and push` — cheap
  unlocks once the plan was trusted.
- **The documentation guardrail:** *"skip them, but document what events are handled
  specially and not forwarded by the bridge"* — converted an ambiguous edge case into a
  spec requirement instead of silent behavior.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Treat the first prompt as "start editing" | *"make a plan, not changes"* | Open every architectural ask with **plan-only, think ultrahard** |
| Lump OpenSpec events in with pi core events | *"OpenSpec events are not core events"* | State the taxonomy: core (`pi.on`) vs EventBus (`pi.events`) vs bridge-synthesized |
| Leave enrichment on the bridge | *"handle OpenSpec server-side… check all other core functions"* | Ask "what can move server-side now that all events are forwarded?" as a checklist |
| Write an over-confident summary (claimed OpenSpec detection was a forwarded core event) | corrected inline; AI re-tabled the event categories | Demand a **category table** (enriched / pass-through / excluded / synthesized) in the summary |
| Reach for subagents mid-flow | *"do not use Agents"* | If you want single-context work, say so up front |
| Leave stale requirement text after change #2 | *"fix"* | After a follow-up change, re-verify the **prior** change's archived spec for staleness |

## 6. Skills, tools & memory created — and why they're effective

No new skills or memories were created this session. The workflow, however, is highly
repeatable and two assets *should* be captured:

- **A "dumb-pipe bridge" pattern note** — the reusable insight that pi has **two event
  systems, neither with a wildcard**, and the catch-all requires *(enumerate core types)
  + (monkey-patch `pi.events.emit`) + (restore on cleanup)*. Saving this as a project
  memory removes the ~30-command runtime-source spelunking next time.
- **A "push processing to the server once the bridge forwards everything" checklist** —
  audit bridge logic into *movable* (pure functions on forwarded data) vs *pinned* (needs
  pi process APIs like `getThinkingLevel`, git polling, model list). This is the exact
  decision that split one change into two clean ones.

The session leaned on existing OpenSpec skills (`/opsx:ff`, `/opsx:apply`, `/opsx:verify`,
`/opsx:archive`) and the `Explore` subagent — the right tools; nothing new needed authoring.

## 7. Pitfalls & dead ends

- **`npm run reload:check` failed** — the reload path type-checks and tripped on the
  known pre-existing `pi.events` TS errors. Fix: use `npm run reload` (skips the strict
  check for a known-good state); confirm your new lines match the *existing* `as any`
  `pi.events` pattern rather than "fixing" the whole file.
- **Don't hunt for a wildcard API.** `pi.on("*")` doesn't exist and `pi.events` has no
  `.onAny()`. Enumerate core events + intercept `emit`; stop looking for a clean hook.
- **Exclude the heavy events.** `context` and `before_provider_request` carry huge
  payloads — forwarding them floods the dashboard. Exclude explicitly and comment why.
- **Don't double-forward.** `turn_end` sits in the enriched loop *and* has a dedicated
  `pi.on("turn_end")` handler; put the `contextUsage` enrichment in the enriched loop,
  not the dedicated handler, to avoid duplicate `event_forward`s.
- **Moved files look "deleted" to git** until staged — `openspec-activity-detector.ts`
  and `stats-extractor.ts` moving to `src/shared/` shows as delete+add; git detects the
  rename on `git add`. Don't panic.
- **A follow-up change can rot the prior change's archived spec.** After
  `server-side-event-processing`, the archived `catch-all-event-forwarding` spec still
  claimed `sendModelUpdateIfChanged()` fired and OpenSpec ran bridge-side. Re-read and
  fix the *earlier* archived spec too.

## 8. Reproduce it faster — checklist

**Inputs to have ready:** a running dashboard (`/api/health` = live), the pi install path
for reading `dist/core/extensions/*`, and OpenSpec CLI available.

1. Prompt **plan-only, think ultrahard**; confirm the client already renders unknown
   events (grep `RawEventCard`, `rawEvent` in `src/client/`).
2. Confirm the two-event-system, no-wildcard constraint from pi source; don't seek a
   clean catch-all API.
3. `/opsx:ff catch-all-event-forwarding`. In the plan, split events into
   **enriched / pass-through / excluded (heavy) / control (dedicated handlers)**.
4. Implement: expand core subscriptions, monkey-patch `pi.events.emit` with a rename map
   + raw fallback, restore emit on cleanup. Use `npm run reload` (not `reload:check`).
5. `/opsx:apply`, then open **`server-side-event-processing`**: move pure detectors to
   `src/shared/`, inline them into the server `event_forward` handler, delete the now-dead
   `openspec_activity_update` + `stats_update` protocol messages.
6. `/opsx:verify` (evidence table) → `/opsx:archive` → hand-sync delta specs → **re-check
   the first change's archived spec for staleness** → `git commit && push`.

**Artifacts produced:** two archived OpenSpec changes; edits to
`src/extension/bridge.ts`, `src/extension/flow-event-wiring.ts`,
`src/server/event-wiring.ts`, `src/server/pi-gateway.ts`, `src/shared/protocol.ts`;
`openspec-activity-detector.ts` + `stats-extractor.ts` relocated to `src/shared/`;
new `src/server/__tests__/auto-attach.test.ts`. Landed on `develop` as `1d9e40d`.

---

_Generated from session `83c66861` · `/Users/robson/Project/pi-agent-dashboard` · 2026-04-08. Source extract: deterministic facts sheet._
