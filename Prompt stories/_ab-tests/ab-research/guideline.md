# How we did it: Diagnosing hermes memory pressure & designing a kb archive tier — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal:
> *"my agent memory feels full — is it a real problem, and what's the fix?"*

---

## 1. Goal (the ask)

The session opened in **OpenSpec explore mode** (a *think, don't implement* stance).
The operator's real question surfaced two turns in: **"what is my current memory
usage?"** and then **"is it possible to distill it to a persisted `.md` file which can
be indexed with `kb` and used when needed?"**

The true objective, once steering clarified it: **not** "make my context smaller," but
**diagnose whether hermes memory pressure is real, find where entries are actually
being lost, and design a cold archive tier so evicted memories stay searchable** —
captured as a comprehensive research dossier, not code.

## 2. TL;DR playbook

1. **Enter explore mode** (`openspec-explore`) so the AI investigates and designs but
   never implements — the right stance for an architecture question.
2. **Ask for hard numbers first:** "what is my current memory usage?" Force the AI to
   read the real stores (`MEMORY.md`, `USER.md`, `failures.md`, project stores) and the
   ceiling constants — not describe the mechanism from memory.
3. **Make it read the engine, not guess it:** point it at `constants.ts` (limits),
   the memory-tool add/evict path, `prompt-context` (injection), and the
   auto-consolidate handler. Demand file:line evidence.
4. **Pin the two crux mechanics:** (a) does `last=` get bumped on search/use (the real
   LRU relevance signal), and (b) what does eviction actually delete — `.md` only, or
   the SQLite search index too?
5. **Reframe from the findings:** if injection is `policy-only`, the problem is
   *retention* (eviction destroys entries) — **not** context bloat. State the corrected
   goal out loud before designing.
6. **Check the tool you want to build on:** confirm `kb` can index external dirs
   (`--source <dir>`, `kb init --global`) before proposing a kb-backed archive.
7. **Ask for the dossier explicitly:** "save this session as a comprehensive research
   doc to `docs/research`." Let the AI ground the docs layout and add the required
   `docs/AGENTS.md` tree row itself.

## 3. How the collaboration unfolded

**Phase 1 — Ground the reality (probe the live stores).** The AI ran `ctx_execute` /
`ctx_batch_execute` against the actual hermes stores and read the ceiling constants.
First probe showed all three global stores at/over 100% — then a *second* probe minutes
later showed `MEMORY.md`/`USER.md` back at 63%/76%. **Why it worked:** re-probing caught
`auto-consolidate` firing between reads, which proved the mechanism is alive and
narrowed the real pressure to one store (`failures.md`, 97%).

**Phase 2 — Read the engine, not the vibe.** The AI opened `constants.ts`, the
memory-tool eviction path, `prompt-context`, and the consolidate handler. **Decision
point:** the operator's instinct ("distill to a persisted md + kb") turned out to point
at a *real gap*, confirmed by two load-bearing findings with file:line evidence.

**Phase 3 — The two decisive findings.**
- *Eviction deletes from both tiers.* `removeSyncedMemories` /
  `removeExactSyncedMemories` run `DELETE FROM memories` — so an evicted failure
  vanishes from `memory_search` too. **There is no cold searchable tier today.**
- *Context cost is already tiny.* `memoryMode = "policy-only"` → full markdown is NOT
  injected; only a ~1 KB policy prompt + ≤5 recent (≤7d) failures load per turn. So
  "stores are full" is **not** bloating context. The pain is pure eviction loss.

**Phase 4 — Design & write.** Two days later the operator asked to persist it. The AI
grounded the `docs/` layout, wrote the ~15 KB / 10-section dossier with evidence, and
added the dense `docs/AGENTS.md` tree row per the Documentation Update Protocol.

## 4. Prompts that worked

- **Goal / stance prompt** — entering `openspec-explore` first. *Why effective:* it
  locks the AI into investigate-and-design mode, preventing premature implementation of
  an architecture that wasn't decided yet.
- **"what is my current memory usage?"** — short, forces measurement over description.
  *Why effective:* it made the AI produce real numbers and (by luck of a re-probe)
  observe the consolidation mechanism in motion.
- **"Is it possible to distill it to a persisted md file which can be indexed with kb…
  Recheck what can be injected to AGENTS.md to get back those entries when needed"** —
  a two-part ask: propose an architecture *and* verify the injection/pointer path.
  *Why effective:* the "recheck" clause forced grounding instead of assertion.
- **"Save this session as a comprehensive research doc to `docs/research`"** — a clean
  hand-off to persistence with an explicit location. *Why effective:* names the output
  path so the AI doesn't guess, and "comprehensive" sets the quality bar.

**Rewrite of the weak spot:** prompt 2 ("what i current memory usage?") works but is
vague — a stronger version: *"Read the actual hermes stores and ceiling constants and
give me usage % per store with file:line evidence for the limits."*

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human steered by… | Bake in next time by… |
|-------------------|-----------------------|------------------------|
| Describe the memory mechanism abstractly | Asking for *current usage* numbers | Open with "read the real stores + constants, cite file:line" |
| Frame the goal as "shrink what loads" | The distill-to-kb question implicitly reframing it to *retention* | State up front: "injection is policy-only — I care about eviction loss, not context size" |
| Trust the "SQLite superset" as a durable archive | Implicitly, via the "used when needed" clause | Verify what eviction actually `DELETE`s before assuming a cold tier exists |
| Risk building on an unverified tool capability | "which can be indexed with kb" | Confirm `kb --source`/`--global` can index external dirs first |
| Leave the doc undocumented | "save as a comprehensive research doc" | Require the `docs/AGENTS.md` tree row as part of any `docs/` write |

## 6. Skills, tools & memory created — and why they're effective

No new skill or memory was created this session — but the workflow is clearly
repeatable and **should** be captured:

- **A "diagnose-memory-pressure" investigation recipe** — probe stores → read
  constants → trace eviction path → check injection mode → reframe. *Why effective:* it
  turns a vague "memory feels full" into a numbers-backed diagnosis in one pass and
  stops the AI from guessing the mechanism.
- **The dossier itself is the reusable asset:**
  `docs/research/hermes-memory-pressure-kb-archive.md` (10 sections, file:line evidence)
  — indexable by `kb`, so the next operator searches it instead of re-investigating.

If you repeat this, save a project memory: *"hermes memoryMode is policy-only — full
markdown is NOT injected; pressure = eviction loss, not context bloat."*

## 7. Pitfalls & dead ends

- **Don't trust a single usage probe.** The first read showed 100%+; a re-probe showed
  63% because auto-consolidate fired between them. Probe twice, or you'll misdiagnose.
- **Don't assume an archive tier exists.** The consolidate skill's "SQLite superset" is
  accumulated dups/session rows, *not* a durable archive — eviction `DELETE`s from both
  the `.md` and the search index.
- **Don't optimize context size for this problem.** `policy-only` mode means full
  memories never inject; shrinking stores buys nothing. The lever is *retention*.
- **Avoid `fifo-evict`** as an overflow strategy — it's the path that destroys the
  oldest entries; the dossier's lever grid explicitly recommends against it.

## 8. Reproduce it faster — checklist

- [ ] Enter `openspec-explore` (think/design, don't implement).
- [ ] Probe real hermes stores **twice** for usage % (catch auto-consolidate).
- [ ] Read `constants.ts` ceilings + memory-tool eviction path + `prompt-context`
      injection mode, with file:line evidence.
- [ ] Confirm `memoryMode` (is full markdown even injected?) before framing the goal.
- [ ] Verify eviction deletes from `.md` **and** SQLite → no cold tier today.
- [ ] Confirm `kb --source <dir>` / `kb init --global` can index external dirs.
- [ ] Write the dossier to `docs/research/<topic>.md` + add the `docs/AGENTS.md` row.

**Key inputs to have ready:** access to `~/.pi/agent/pi-hermes-memory/` stores, the
hermes engine source (`constants.ts`, memory-tool, `prompt-context`, consolidate
handler), and `kb` for the index-capability check.

**Final artifacts produced:**
- `docs/research/hermes-memory-pressure-kb-archive.md` (~15 KB, 10 sections)
- `docs/AGENTS.md` (dense tree row added)

---

_Generated from session `019f8680-2eea-7d6c-8f06-c9d2982bba17` ·
`pi-agent-dashboard` · 2026-07-23._
