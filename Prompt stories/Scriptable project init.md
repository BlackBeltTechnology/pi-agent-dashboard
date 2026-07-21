# How we did it: Multi-model proposal review — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was asked, how
> it was built with the AI, what had to be steered, and how to reproduce the result faster
> next time.** This session captures an OpenSpec planning cycle where doubt-driven-review
> caught fundamental architectural flaws early, before implementation was attempted.

---

## 1. Goal (the ask)

The user wanted to explore whether the dashboard bus-client scripting API (just shipped)
could close a gap in the `project-init` skill: enabling an automated Initialize flow that
spans proposal scaffolding → skill installation → verification, all in one pass instead of
requiring manual re-clicks. The initial question was straightforward — *"Is it possible to
add add-dashboard-bus-client-scripting API to project-init to perform indexing, openspec
init, etc?"* — but the real objective, which emerged through steering, was to close a UX
dead-end in the Initialize flow (state ① → ②) using the bus-client's newly-shipped
orchestration primitives.

---

## 2. TL;DR playbook

1. **Gather the shipped surface** — Read the bus-client v0.5.4 code (connect/spawn/until/plugin methods, KNOWN_PLUGIN_HANDLERS, denylist) and the Initialize architecture (state machine from archived `distinguish-initialize-actions` change).
2. **Reframe the mechanism** — Clarify what the bus-client *can* do (spawn sessions, orchestrate via until-events) vs. what it *cannot* (route kb verbs, toggle plugin config). Identify the one real win: post-scaffold bootstrap via spawn → trigger hook → wait-for-completion.
3. **Draft the proposal** — Author proposal.md + design.md + tasks.md + delta spec describing the mechanism (optional Step 8: spawn, wait for `worktree_init_done`).
4. **Single-model adversarial review** — Load the drafted artifacts + claim + contract into doubt-driven-review (single model, fresh context). Surface findings.
5. **Cross-model confirmation** — Re-run adversarial review with a different model family (@propose-review-1 GLM-5.2). Both models must pass; if one finds fatal flaws, reconcile against code and decide: patch or shelve.
6. **Reconcile findings against code** — For each finding, open the actual source files (bus-client, git-routes, project-init hooks, trust store) and verify. Do not rubber-stamp; the AI can hallucinate method names. Update the design if findings are valid.
7. **Execute or archive** — If findings are patched, fold scenarios and proceed to `ship-it`. If findings are fatal (e.g., mechanism is incoherent), archive the change with a NOTES.md explaining why, and record a shelved-never-implement memory so it doesn't resurface.

---

## 3. How the collaboration unfolded

### Phase 1: Investigation (01:17–01:28, ~11 min)

The user loaded the explore-mode skill and asked about the bus-client API. I investigated
three parallel extraction targets: (A) skills/extensions already in the codebase, (B) what
the `project-init` profile template offers, and (C) memory-based skills from global hermes
and project memory. The user's steering hint — *"Don't forget to check the memory based
skills too"* — meant: broaden the inventory to include procedural memory as a reusable
asset, not just pre-packaged skills.

**Why this phase worked:** It grounded the exploration in code reality (shipped packages,
hook mechanisms, denylist) rather than speculating. By listing KNOWN_PLUGIN_HANDLERS and
the denylist, I could immediately tell the user: "plugin('kb', ...) will throw; kb is not
a wired handler."

### Phase 2: Scoped reframing (01:28–10:31, ~9h)

The user asked the key steering question: *"Is it possible to add bus-client scripting API
to project-init to perform indexing, openspec init, etc?"* I answered honestly: *mostly
no, but here's the one real win.* The bus-client is an orchestration seam (spawn/until),
not a verb-router. Indexing and openspec-init are CLI/hook side-effects, not bus verbs.

Then the user noted: *"The bus-client implemented, on develop and checked out."* This was
the green light — the shipped bus-client v0.5.4 made the narrow mechanism (spawn →
trigger hook → until-idle) possible.

**Decision point:** Should the proposal assume (A) the bus-client stays untouched (kb stays
off the plugin handler list, denylist stays as-is) and leverage only spawn/until for
orchestration, or (B) propose wiring kb onto the bus first? I chose (A) — degradable and
ships-with-what-exists.

### Phase 3: Artifact drafting (10:31–10:46, ~15 min)

Using `openspec change new`, I scaffolded the four artifacts (proposal, design, tasks,
delta spec). The key constraint was coherence with shipped code: no hypothetical verbs,
no speculative handler slots, only spawn/until and the existing `worktree_init_done`
event. Validation passed.

**Why this worked:** Grounding every mechanism in the actual bus-client source (`connect`,
`spawn`, `until`, `plugin`, error codes, denylist) meant the proposal could be reviewed
without having to re-verify basic facts. The reviewer could focus on architectural logic.

### Phase 4: Doubt-driven single-model review (10:47–11:33, ~46 min)

I loaded doubt-driven-review with the proposal + design + claim + contract. The claim was:
*"project-init can close the Initialize handoff with an optional, degradable bus-client
spawn→until(idle) step, while correctly leaving indexing/openspec-init in the hook/CLI
layer."* The model returned 6 substantive findings, including:

- `connect-failed` error code doesn't exist (later verified: it does, but nothing throws it).
- `until(sid,"idle")` awaits a session idle, but `/worktree/init` doesn't spawn a session;
  it emits `worktree_init_done` keyed by `requestId`+`cwd`.
- The design auto-trusts the hook (TOFU bypass), poisoning the durable trust store.

**Why this worked:** Fresh-context review caught the mismatch between "what the proposal
assumes the server does" and "what the server actually does." The model wasn't hallucinating;
it was reading the shipped code and finding real gaps.

### Phase 5: Cross-model confirmation (11:33–11:53, ~20 min)

I re-ran adversarial review with @propose-review-1 (GLM-5.2, different architecture family).
Same ARTIFACT + CONTRACT, same model role, fresh context. GLM independently confirmed the
biggest findings AND surfaced three more:

- Naive `spawn({cwd})` **re-launches project-init** (initialPrompt is always "/skill:project-init"), causing recursion, not provisioning.
- No bus primitive exists to await `worktree_init_done` by requestId.
- Auto-confirming TOFU **poisons the trust store**, affecting subsequent manual runs.

**Why this worked:** Two models from different families (Claude + GLM) converging on the
same mechanical flaws is a strong signal. If one were hallucinating, the other wouldn't
independently re-discover the same "bug" in the mechanism.

### Phase 6: Code reconciliation & verdict (11:53–21:39, ~10h)

I opened the actual source files (git-routes.ts, errors.ts, bus-client/src/, project-init
hooks, worktree-init-trust.json semantics) and verified every finding. Result: the mechanism
has **three fatal gaps**:

1. **No session spawned** → `until(sid,"idle")` watches the wrong thing; a new primitive is needed.
2. **Trust-store poisoning** → auto-confirm bypasses TOFU and poisons the durable hook, affecting future manual runs.
3. **Recursion hazard** → spawn with no override of initialPrompt re-launches project-init.

**Decision:** The findings are valid. The design is not salvageable with minor patches (each
gap is architectural). Per doubt-driven-review, shelve the change and do not proceed to
scenario-design / implementation. Record why so it doesn't resurface.

### Phase 7: Archive & record (21:39–21:45, ~6 min)

I moved the change to `openspec/changes/archive/2026-07-16-SHELVED-close-initialize-handoff-via-bus/`
with a NOTES.md explaining the three fatal gaps + the three revival prerequisites (new primitives
needed: an event-await that doesn't require a session; a TOFU confirmation that doesn't poison
the store; a spawn override for initialPrompt). Committed to develop. Recorded a project memory
so the change won't be re-proposed.

**Why this worked:** Shelving *with recorded findings* is better than shelving *silently*. A
future proposal on this area can read NOTES.md and either (a) implement the prerequisites first,
or (b) pivot to a different mechanism. It's on the record, indexed by kb, discoverable.

---

## 4. Prompts that worked

### The goal prompt

> _"Is it possible to add add-dashboard-bus-client-scripting API to project-init to be able
> to perform indexing, openspec init etc?"_

This was good because it was **specific** (names the API, the target skill, the operations)
and **grounded** (the user had already read the bus-client docs). The steering follow-ups
refined what "perform indexing/openspec init" meant — the real win wasn't routing these
through the bus, but closing a UX loop (Initialize state ① → ②) with opt-in orchestration.

**Stronger version for future use:** *"I want to close the Initialize dead-end (state ①
→ ②) by using bus-client to spawn a hook-triggered session and wait for it to idle. But
I need to verify the bus-client API supports this and doesn't violate the trust model.
Should I draft a proposal?"*

### High-leverage follow-up: steering #2

> _"The bus-client implemented, on develop and checked out"_

This was a **fact update** — green-lighting the scoped mechanism because the shipped
surface now existed. The agent immediately reframed: "OK, spawn/until is real and works
with worktree_init_done events; here's what's possible within that constraint."

### High-leverage follow-up: steering #3

> _"Dont forget to ceck the memory based skills too"_

This was a **scope expansion** — broadening the inventory search from npm packages to
recorded procedural memory. It ensured the final recommendation considered both pre-packaged
and ad-hoc/custom skills.

### Unlock prompt (steering #5, implicit)

> _"\<plan-proposal skill load\>"_

The user loaded the plan-proposal skill, which trigged the orchestrated planning phase:
draft → doubt-review → scenario-design → manifest. This is how a user signals "I'm ready
to validate this properly, not just brainstorm."

---

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|---|---|---|
| Brainstorm the bus-client capability without reading the shipped code first | User's steering #1: "check memory-based skills too" + context of shipped bus-client | **Always ground in code first:** load the actual denylist, KNOWN_PLUGIN_HANDLERS, type signatures. Don't hypothesize about a library's surface. |
| Assume "perform indexing" meant wiring kb onto the bus (a big coupling) | User's steering #2: reframing to shipped surface only | **Name the constraints up front:** "I'm assuming we don't add new plugin handlers or denylist exceptions; is that right?" clarifies the scope. |
| Propose a mechanism before stress-testing it | User's steering #4 + the loaded plan-proposal skill | **Always follow doubt-driven-review when a proposal involves cross-boundary assumptions** (bus verbs, hook triggers, trust models). Don't skip to scenario-design until both single + cross-model review pass. |
| Rubber-stamp the first model's findings without reconciliation | The actual code-reading phase (Phase 6) | **For each doubt-review finding, open the actual source file.** Don't trust the model's summary of method names or type semantics. Verify. |

---

## 6. Skills, tools & memory created — and why they're effective

### Skill: `doubt-driven-review` (invoked, not created)

The session heavily used the existing doubt-driven-review skill — it was the critical
gate between proposal-drafting and implementation. Why it's effective here:

- **Catches architectural gaps before code** — The review found that the mechanism relied
  on bus primitives that don't exist (e.g., awaiting an event keyed by requestId, not a
  session id). Opening 50 test files wouldn't have caught this; the model reading the
  shipped code did.
- **Forces code grounding** — The doubt-review claim/contract model makes you articulate
  what you're assuming the server does. The reviewer can then verify or refute each
  assumption by reading the code.
- **Cross-model confirmation** — Running the same review with a different model family
  (Claude + GLM) increased confidence that the findings weren't hallucinations.

**When to invoke next time:** Whenever a proposal spans a system boundary (bus client ↔
server, hook ↔ plugin handler, trust model ↔ durable state). Don't skip it even if the
proposal looks solid.

### Memory: Shelved never-implement (created)

Recorded in project memory (failure · insight scope):

> "close-initialize-handoff-via-bus" (2026-07-16) — do NOT re-propose. Shelved by
> doubt-review after findings showed: (1) mechanism relies on event-await keyed by
> requestId, not session; (2) auto-confirm TOFU bypass poisons the trust store; (3)
> spawn-with-default-prompt causes recursion. Revival requires new primitives. Full
> findings in openspec/changes/archive/2026-07-16-SHELVED-*/NOTES.md.

**Why it's effective:** This prevents silent re-proposal of the same idea. A future
developer reading NOTES.md can (a) implement the prerequisite primitives, or (b) pivot
to a different Initialize-closure mechanism. It's a durable do-not-re-propose record.

---

## 7. Pitfalls & dead ends

### Pitfall 1: Assuming the bus-client can route kb verbs

**What happened:** The initial question treated "perform indexing" as "call it via the bus."
The code shows kb is not in KNOWN_PLUGIN_HANDLERS and the config-write verb is denied.

**Lesson:** Check the denylist and handler list before proposing bus verbs. They're
hardcoded and won't change without a separate (slower) proposal.

### Pitfall 2: Conflating "event exists in the code" with "you can await it"

**What happened:** The design assumed `until(sid, "idle")` would work because
`worktree_init_done` exists. But the code emits it keyed by `requestId`+`cwd`, not a
session id. The await primitive doesn't exist for that shape.

**Lesson:** When proposing to await an event, check the event's *emitter* (who fires it,
with what keys). Don't assume the bus-client's `until` method handles arbitrary keys.

### Pitfall 3: Bypassing TOFU confirmation as a "non-issue"

**What happened:** The design said "auto-confirm the hook TOFU during Step 8" (provision step).
The code shows this poisons the durable worktree-init-trust.json. The next *manual* click
(user uses Initialize again later) will run the hook without TOFU prompt, violating the
security model.

**Lesson:** When a step touches trust/security state, ask: *"Does this affect the same
state a future user action uses?"* If yes, can't auto-confirm. The provision step and the
manual click share the same trust store.

### Pitfall 4: Not reconciling model findings against code

**What happened:** The first finding said "`connect-failed` code doesn't exist." It does
exist (BusErrorCode enum), but nothing throws it. The AI was partially right (no code
path throws it) but incomplete (the enum exists). Opening the file clarified.

**Lesson:** When doubt-review flags something as false, open the actual file. The model
might be summarizing correctly but incompletely.

### Pitfall 5: Skipping cross-model review when time-limited

**What happened:** After single-model review, the pressure was to patch and proceed. But
cross-model review (GLM-5.2) surfaced the recursion hazard and trust-store poisoning,
both fatal. Single model alone would have missed one or both.

**Lesson:** Treat cross-model review as non-optional for proposals that span system
boundaries. The 20 minutes it takes pays for itself by preventing a 2-week implementation
dead-end.

---

## 8. Reproduce it faster — checklist

### Inputs (have these ready)
- [ ] Source OpenSpec change name (or `latest` if this is the current session)
- [ ] Bus-client shipped version + public API surface (denylist, KNOWN_PLUGIN_HANDLERS)
- [ ] Existing changes that set precedent (e.g., `distinguish-initialize-actions` state model)
- [ ] Key source files (bus-client/src/\*, git-routes.ts, hook definitions, trust-store schema)

### Steps (the distilled, no-narrative sequence)
1. Read the shipped API surface (denylist, handler list, event emitters, method signatures)
2. Reframe the proposal to use only what ships (no hypothetical new verbs)
3. Author proposal + design + tasks + delta spec
4. Run `doubt-driven-review` (single model) with ARTIFACT + CONTRACT; reconcile findings vs. code
5. Run `doubt-driven-review` again with a different model family (@propose-review-N)
6. Compare findings; if overlapping fatal flaws, decide: patch or shelve
7. If shelving: move to archive/ + NOTES.md explaining why + record shelved-never-implement memory
8. If proceeding: fold scenarios via scenario-design and proceed to ship-it

### Final artifacts produced
- If archived: `openspec/changes/archive/<YYYY-MM-DD>-SHELVED-<name>/` with proposal, design, tasks, spec, NOTES.md
- If shipped: same structure but in `openspec/changes/<name>/` (active), + a landed commit on develop

### Quick re-trigger command
```bash
# List candidate sessions (this project)
npx tsx packages/authoring-toolkit/.pi/skills/session-to-guideline/scripts/list_sessions.ts --cwd "$(pwd)" --limit 20

# Extract facts sheet
FACTS=$(mktemp /tmp/session_facts.XXXXXX.md)
npx tsx packages/authoring-toolkit/.pi/skills/session-to-guideline/scripts/extract_session.ts latest --cwd "$(pwd)" --out-md "$FACTS"
cat "$FACTS"

# Load plan-proposal to start the cycle
# /plan-proposal <change-name>
```

---

_Generated from session `019f6810-e9ec-7e66-b15c-bc12964f97b7` · `/Users/robson/Project/pi-agent-dashboard` · 2026-07-16._
