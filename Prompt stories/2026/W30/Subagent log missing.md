---
session: 019f85db
week: 2026/W30
type: planning
model: "@fast"
premium: true
premium_reason: "created 0 skill(s) / 2 memory(ies); heavy steering (8 user prompts)"
upgrade_status: pending
openspec_changes: [fix-subagent-live-detail-durable-hydration]
proposal_excerpt: "A running subagent's inspector timeline (`SubagentDetailView`, inline expand + popout + the `/session/:sessionId/subagent/:agentId` route) is sourced **only** from `session.subagents.get(agentId)`. That map is fed **o…"
---

# How we did it: Fixing the "Subagent not found" empty inspector — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The operator opened with a screenshot and one line: *"Missing subagent's details in
'Server side lifecycle control' session."* A running subagent's card in the dashboard
inspector showed its header (name, model, tokens, "1 tool use") but the body rendered
the **"Subagent not found in this session."** placeholder while the subagent was still
streaming.

The *real* objective — clarified across the steering turns — was not "make the card
render" but: **root-cause why the live timeline is empty mid-run, prove it's a real
channel-loss bug (not a cosmetic replay delay), fix it minimally, deploy, verify live
with a dummy subagent, and land it as a traceable OpenSpec change + commit.**

## 2. TL;DR playbook

1. **Load the diagnostic skill first.** `trace-subagent-not-found` already exists for
   exactly this signature — invoke it before touching source.
2. **Trace live server state, not just code.** Find the parent session + the subagent's
   v4 `agentId` from `/api/sessions` and `~/.pi/dashboard/server.log`; classify whether
   the card is empty *because the parent is still streaming* (replay gap) or because
   frames never arrive.
3. **Distinguish the two channels.** The card **header** rides the *durable* message
   channel (`partialResult` → `tool_execution_update` → `message.toolDetails`); the
   **timeline body** rides the *ephemeral* `subagents:*` `event_forward` channel (lossy
   at the bridge-not-ready buffer + server→browser WS back-pressure). Prove the durable
   `partialResult.details` *already carries the full `entries[]`* — the fix data is
   already on the client, unused.
4. **Pick the reducer-side fix.** `SubagentDetailView` reads only
   `session.subagents.get(agentId)`. The `tool_execution_end` arm already hydrates that
   map from the durable snapshot at completion — mirror that same hydration into the
   `tool_execution_update` (partial) arm so it runs *mid-run* too. ~40 lines, no
   protocol/bridge/producer/view change.
5. **TDD red → green.** Write two reducer tests first (live-partial hydrates the map;
   no-regression on terminal), confirm RED, implement, confirm GREEN. Run the full
   reducer + subagents-plugin suites + typecheck + Biome changed-files ratchet.
6. **Deploy + verify live.** `npm run build && curl -X POST .../api/restart`; then spawn
   a **dummy `Explore` subagent** and expand its card mid-run — it must show the live
   timeline, never "Subagent not found."
7. **Land it.** Create the OpenSpec change (proposal + tasks + spec delta), sync the
   additive requirement into the main spec, archive, then commit *only* your files.

## 3. How the collaboration unfolded

**Phase 1 — Diagnose from live state (Discovery).** The AI recognized the signature and
loaded `trace-subagent-not-found`, then traced the *running* system: `/api/sessions`,
`server.log` gateway/register lines, and the parent session's JSONL. It found the card
was the `doubt-driven-review` cross-model reviewer (`Explore` on `@propose-review-1` →
glm-5.2) and that the parent was **still streaming** — the JSONL ended at the toolCall,
the toolResult (carrying `details.agentId`) hadn't returned. First read: a transient
replay gap, "not a real bug."

*Why it worked:* it probed the live server and transcript before reading any source, so
the diagnosis was grounded in the actual failing instance, not a guess.

**Phase 2 — Human upgrades the diagnosis (decision point).** The operator corrected the
"cosmetic" framing: *"earlier — while streaming it was not worked."* That single
observation reclassified the bug from a benign delay to a **real live-path gap** and
unlocked the deep root-cause trace. The AI then read the `subagent-live-detail-reliability`
spec + the producer/reducer/view source and built the decisive two-channel table:
durable message channel (survives loss, carries `entries[]`) vs ephemeral `event_forward`
(dropped and gone; 13.8k back-pressure drops logged). Root cause confirmed with a clean
data trail — **no code changed yet.**

**Phase 3 — Gated fix draft (design).** The AI drafted the exact edit but explicitly did
*not* apply it, waiting for a go. It found the cleanest variant: the `tool_execution_end`
arm *already* hydrates the map durably at completion — the fix is to mirror that into the
partial arm, reusing `readSubagentDetails` + `setSubagentState` (which dual-indexes v7
deep-links).

**Phase 4 — TDD implement + verify.** On the "A"/go, the AI followed the `implement`
skill: failing tests first (RED), minimal ~40-line hydration (GREEN), 1341/1341 green,
type-clean, Biome parity with the mirrored arm, plus an inline `review-code` self-pass.

**Phase 5 — Deploy + live proof.** Both approved → `npm run build` + `/api/restart` to
the live prod instance, then the operator asked to **run a dummy subagent to test**. The
AI spawned an `Explore` subagent; its card hydrated mid-run from the durable channel —
verified live.

**Phase 6 — Land it.** OpenSpec change created, additive requirement synced into the main
spec, archived, then a surgical commit staging *only* the six files of this change
(leaving unrelated untracked work alone): `947588cfd`.

## 4. Prompts that worked

- **The goal prompt** (screenshot + *"Missing subagent's details in '…' session"*) —
  effective because it named the exact session, letting the AI locate the live instance
  immediately. A stronger version states the *when*: *"the subagent body shows 'not
  found' **while it's still streaming**, then fills in when it finishes — root-cause the
  live path."*
- **"earlier — while streaming it was not worked"** — the single highest-leverage turn.
  It overturned the "cosmetic" diagnosis and pointed at the real live-path gap. Bake this
  in by always reporting *whether the failure reproduces mid-stream vs only on replay.*
- **"A" / "Go it is"** — a one-token unlock that authorized the gated fix draft to become
  a real TDD implementation.
- **"Run a dummy subagent to test"** — turned an assertion into a live end-to-end proof.
  Reuse this pattern: never call a live-path fix verified without a fresh subagent run.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Call the empty body a transient/cosmetic replay gap ("not a real bug") | "earlier — while streaming it was not worked" | Always test the *mid-stream* window, not just the settled state, before declaring a bug cosmetic |
| Ask "did you mean option 1?" / wait for UI clicks it can't perform | Answered "1" then confirmed the variant | State up front that the AI can't click the UI — give it the observed behavior, not a request to interact |
| Stop after diagnosis, holding the fix as a gated draft | "A" (go) to authorize applying | Fine as a safety default; the operator explicitly unlocks each disruptive step |
| Pause before deploying to the shared live instance (~30 active sessions) | Approved build + restart | Keep the "won't act unilaterally on disruptive/consequential steps" default — it's a feature, not friction |
| Nearly write the durable insight to project memory | Memory was at capacity (4858/5000) — AI skipped rather than evict | Prefer the OpenSpec change as the durable record when memory is full; don't evict existing entries |

## 6. Skills, tools & memory created — and why they're effective

- **Reused skill `trace-subagent-not-found`** (not created here, but the backbone).
  Captures the v4-`agentId` vs v7-`sessionId` dual-identity trace for the exact "Subagent
  not found" signature. *Invoke it first* on any subagent-inspector emptiness — it saves
  re-deriving the channel topology from scratch.
- **2 project memories saved** (insights): both record the architectural crux — the
  subagent inspector timeline has **two client channels carrying the same
  `buildDetails()` snapshot**: DURABLE (`partialResult` → `tool_execution_update` →
  `message.toolDetails`, survives replay/back-pressure) and EPHEMERAL (`subagents:*`
  `event_forward`, lossy). *Why effective:* the next person who sees an empty-mid-run card
  can jump straight to "hydrate the map from the durable arm" instead of re-tracing.
  *Invoke by:* recalling this whenever a subagent/inspector field renders on one surface
  (header) but not another (body).
- **Dummy `Explore` subagent** as a live test fixture. *Why effective:* it turns a
  live-path fix from "should work" into "verified on a fresh run." *When:* after any fix
  to the subagent streaming/hydration path.
- **Skill worth creating:** a short `verify-live-subagent-hydration` recipe (deploy →
  spawn dummy `Explore` → expand card mid-run → assert no "Subagent not found") would
  formalize Phase 5 for future subagent-channel work.

## 7. Pitfalls & dead ends

- **Don't trust the "cosmetic replay" first read.** The empty body during streaming was a
  *real* channel-loss bug. Reproduce mid-stream before dismissing.
- **The 13.8k logged back-pressure drops were a red herring for *this* instance** — the
  last drop (log line 683429) predated the session's registration (693739). Check
  timestamps before blaming server→browser back-pressure.
- **250 ms progress throttle is *not* the cause.** Frames *are* emitted every 250 ms; the
  loss is the ephemeral transport, not the emit cadence.
- **Pre-existing noise to ignore:** 2 unrelated `tsc` errors (faux-scenarios `rootDir`,
  `node:sqlite` in `kb`) and 46 pre-existing Biome warnings (`noExplicitAny` at line 1234)
  — none in `event-reducer.ts`. Use the changed-files ratchet to prove your lines add none.
- **Project memory at capacity (5000).** The AI correctly skipped the write rather than
  evict; rely on the OpenSpec change as the durable record.
- **One failed command:** the config-port/health one-liner (`cat config.json | python3 …`)
  errored — fall back to `/api/sessions` + `server.log` directly.
- **Commit surgically.** The tree had unrelated untracked work
  (`harden-worktree-init-corepack/`); stage only your six files.

## 8. Reproduce it faster — checklist

- [ ] Load `trace-subagent-not-found`; get the parent session + subagent v4 `agentId`
      from `/api/sessions` + `~/.pi/dashboard/server.log`.
- [ ] Confirm the failure reproduces **mid-stream** (not just on replay).
- [ ] Read `subagent-live-detail-reliability` spec + the producer/reducer/view source;
      map the durable vs ephemeral channels; verify `partialResult.details.entries[]` is
      already on the client.
- [ ] Draft the reducer-side fix: mirror the `tool_execution_end` durable hydration into
      the `tool_execution_update` Agent arm (`readSubagentDetails` + `setSubagentState`).
- [ ] TDD: 2 reducer tests (live-partial hydrates; no-regression on terminal) → RED →
      implement → GREEN; full reducer + subagents-plugin suites + typecheck + Biome ratchet.
- [ ] Deploy: `npm run build && curl -X POST .../api/restart`; confirm `mode=production`.
- [ ] Verify live: spawn a dummy `Explore` subagent, expand its card mid-run — no
      "Subagent not found."
- [ ] Create OpenSpec change (proposal + tasks + spec delta), sync additive requirement
      into the main spec, archive.
- [ ] Commit only your files.

**Key inputs:** a running dashboard (`localhost:8000`), the failing session name,
`~/.pi/dashboard/server.log`, permission to build + restart the shared live instance.

**Final artifacts:**
- `packages/client/src/lib/chat/event-reducer.ts` — durable live hydration in the
  `tool_execution_update` Agent arm (~40 lines).
- `packages/client/src/lib/__tests__/event-reducer.test.ts` — 2 new tests.
- `openspec/changes/archive/2026-07-21-fix-subagent-live-detail-durable-hydration/` +
  synced `openspec/specs/subagent-live-detail-reliability/spec.md`.
- Commit `947588cfd fix(subagents): hydrate running subagent timeline from the durable channel`.

---

_Generated from session `019f85db-24fd-72e6-9b5a-f93afa54d0ed` · `/Users/robson/Project/pi-agent-dashboard` · 2026-07-21. Source extract: `/var/folders/qb/m1_q3v6d5bnfzbpmc0dkkqx40000gn/T/facts.q82sfZfrJm.md`._
