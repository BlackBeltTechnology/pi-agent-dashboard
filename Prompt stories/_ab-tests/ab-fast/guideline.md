# How we did it: Hermes memory pressure — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

Investigate why pi-hermes memory stores feel "full" and whether evicted entries are lost forever — then design a viable hot/cold archive tier that preserves evicted memories in a searchable, kb-indexed cold store.

The initial prompt invoked `openspec-explore` in thinking-only mode. The real objective crystallised over three steering turns: first, get current memory usage numbers; second, distill the investigation into a persistent Markdown file indexable by `kb`; third, save a comprehensive research dossier under `docs/research/`.

---

## 2. TL;DR playbook

1. **Enter explore mode** — invoke `openspec-explore` (or skip straight to facts-gathering if you already know the shape of the investigation).
2. **Probe live usage** — run `ctx_batch_execute` with commands that read hermes store files + constants to surface the current byte usage per store, the char ceilings, and the overflow strategy.
3. **Read the mechanism** — examine `constants.ts` (limits), the memory-tool (add/evict), `prompt-context` (injection), and `auto-consolidate` (eviction handler). Use `ctx_execute` to grep file:line evidence.
4. **Confirm the relevance signal** — check whether the `last=` timestamp on memory entries actually bumps on search/use (it does not — only on write).
5. **Verify kb capability** — test that `kb init --global` and `kb --source <dir>` can index directories outside the repo (they can — this closes the architecture question).
6. **Synthesise findings** — write a 10-section research dossier (`docs/research/<topic>.md`) with all file:line evidence, mechanism diagrams, current usage snapshot, proposed architecture, and open decisions.
7. **Add the AGENTS.md tree row** — a dense one-liner per the Documentation Update Protocol so `kb agents` surfaces the doc.

---

## 3. How the collaboration unfolded

**Phase 1: Ground-truth exploration** (Jul 21, ~9 min)

The AI started by reading pi-hermes memory store files and the core engine code. It surfaced real ceiling constants (`DEFAULT_MEMORY_CHAR_LIMIT=5000`), the `auto-consolidate` overflow strategy, and discovered the critical insight: when hermes evicts, it deletes from **both** the `.md` file and the SQLite search index — so evicted entries are gone from `memory_search` too. No cold tier exists.

*What worked:* The AI self-directed through the codebase, reading 5+ key files and producing a grounded "what full actually means" diagram before the user asked a single follow-up. The `openspec-explore` stance gave it permission to explore freely.

**Phase 2: Quantitative snapshot** (Jul 21, ~2 min)

The user asked "what is current memory usage?" The AI re-probed the live stores and found that auto-consolidate had already reclaimed space in MEMORY.md and USER.md (now 63% / 76%), while `failures.md` was still at 97%. It also surfaced the 89 project stores with 5 of them over/approaching their limit.

*Decision point:* The user chose to focus on the eviction gap rather than the (already-working) auto-consolidate mechanism.

**Phase 3: Architecture design** (Jul 21, ~1 min)

The user asked whether the investigation could be distilled into a persistent kb-indexed Markdown file. The AI verified that `kb --source <dir>` and `kb init --global` can index external directories. It then reframed the goal: the problem is **retention, not context bloat** — `memoryMode = "policy-only"` already keeps injection tiny. The win is preserving evicted entries in a cold archive.

*What worked:* The user's steering turn ("distill it to persisted md file") shifted the AI from open-ended thinking to artifact production. The AI independently verified the kb capability before designing.

**Phase 4: Save research dossier** (Jul 23, ~3 min)

Two days later, the user returned and said "Save this session as a comprehensive research doc to docs/research." The AI re-read the current docs layout, wrote the full 10-section dossier with file:line evidence, and added the dense `docs/AGENTS.md` tree row — all in one clean write.

---

## 4. Prompts that worked

**The goal prompt** (openspec-explore invocation)
```
<skill name="openspec-explore"> … </skill>
Enter explore mode. Think deeply. Visualize freely.
```
*Why effective:* Openspec-explore's permissive stance let the AI self-direct through the codebase without needing micro-direction. It naturally produced a grounded map of the mechanism before the user asked any follow-up.

**High-leverage steering #1** — unlocked hard numbers
```
what i current memory usage?
```
*Why effective:* Simple, pointed request. The AI had explored the mechanism abstractly; this forced a live reading of actual store byte counts — revealing that auto-consolidate had already reclaimed space mid-session, which was a crucial observation.

**High-leverage steering #2** — shifted from thinking to artifact
```
Is it possible to distill it to persisted md file which can be indexed
with kb and used when needed? Recheck that what can be injected to
AGENTS.md to use to get back taht entries when needed
```
*Why effective:* This single turn reframed the entire session from "explore" to "produce a reusable asset." The misspellings didn't matter — the intent was clear. The "Recheck that what can be injected to AGENTS.md" part forced the AI to close a practical design loop (how does a user retrieve the archived info at runtime).

**Final save** — clean close
```
Save this session as a comprehensive research doc to docs/research
```
*Why effective:* Explicit path + explicit scope. No negotiation. The AI grounded itself in the docs layout, wrote the full dossier, and added the needed tree row — all autonomously.

---

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|---|---|---|
| Stay in abstract mechanism-exploration mode without producing a concrete deliverable | Asking for live numbers ("what is current memory usage?") | Starting with "probe live usage AND synthesize into a doc" as a single prompt — skip open-ended explore when the deliverable is known |
| Assume the problem was "too much context" (injection bloat) rather than "eviction destroying entries" (retention gap) | The steering turn didn't correct this — the AI self-corrected after reading the actual injection path. But the first framing was wrong. | State the two hypotheses explicitly up front: "Is the problem (A) context bloat or (B) eviction destroying entries? Find out." |
| Not produce a persistent file on its own — needed two explicit steering turns before committing findings to disk | "distill it to persisted md file" → "Save this session as a comprehensive research doc" | For any deep-dive investigation, include "write the findings to <path>" as part of the initial goal prompt |

---

## 6. Skills, tools & memory created — and why they're effective

**`docs/research/hermes-memory-pressure-kb-archive.md`** (research dossier)

- *What it captures:* The complete investigation — mechanism diagrams, live usage snapshots, kb capability verification, proposed hot/cold architecture, open decisions, and every file/command consulted.
- *Why effective:* Written in caveman style with file:line evidence, it's a one-stop reference that a future operator can re-read to understand pi-hermes memory pressure without re-doing the investigation. Indexed by `kb agents` via the `docs/AGENTS.md` tree row.
- *When to invoke:* Any time someone asks "why are my memory stores full," "what gets evicted," or "can I archive evicted memories."

**No formal skill was created** during this session, but the workflow is clearly repeatable. A recommended skill would be:

- **Memory pressure debug skill** — wraps the `ctx_batch_execute` probes (read store files, grep constants, check overflow strategies) into a one-shot "diagnose hermes memory pressure" command, producing the usage snapshot + mechanism summary + recommended action. Invoke it when stores feel full or entries seem to disappear.

---

## 7. Pitfalls & dead ends

| Situation | What to do |
|---|---|
| The facts sheet between two probes differs (auto-consolidate fires mid-session) | Probe twice and note the delta — it's evidence the mechanism is working, not a bug |
| Assumed SQLite was a durable superset of the .md files | It's not — `removeSyncedMemories` deletes from **both** tiers. Check the actual `DELETE FROM memories` calls before assuming a cold tier exists |
| `memoryMode = "policy-only"` is easy to miss as the injection path | Always confirm the actual injection pipeline (`prompt-context.ts`) before designing a "shrink what loads" fix — the answer may be "it's already minimal; the problem is retention" |

---

## 8. Reproduce it faster — checklist

**Key inputs needed:**
- Access to `~/.pi/agent/pi-hermes-memory/` (store files)
- The pi-hermes source tree (`constants.ts`, `memory-tool.ts`, `prompt-context.ts`, `auto-consolidate.ts`)
- `kb` CLI available (verify with `kb --help`)

**Fastest path:**
```
1. Run: ctx_batch_execute with commands that read store files + grep ceilings + check overflow strategy
2. Read: constants.ts (limits), memory-tool.ts (add/evict), prompt-context.ts (injection), auto-consolidate.ts
3. Run: ctx_execute to grep "last=" handling — does search bump the timestamp?
4. Run: kb --source ~/.pi/agent/ --init --global  (verify kb can index external dirs)
5. Write: docs/research/<topic>.md with all findings in caveman style
6. Edit: docs/AGENTS.md — add dense path-alphabetical tree row
```

**Final artifacts produced:**
- `docs/research/hermes-memory-pressure-kb-archive.md` — full research dossier
- `docs/AGENTS.md` — tree row (one-liner per Documentation Update Protocol)

---

_Generated from session `019f8680-2eea-7d6c-8f06-c9d2982bba17` · `/Users/robson/Project/pi-agent-dashboard` · 2026-07-23. Source extract: `/tmp/session_facts_XXXXXX.md`._
