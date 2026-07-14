---
name: distill-session-knowledge
description: Offline-mine this project's pi session JSONL logs into reusable, verified knowledge. Walks sessions newer than a watermark, extracts five signal classes (faults, ask_user decisions, corrections, procedures, docs) anchored on objective outcomes, promotes only patterns recurring across >= N sessions, and routes distilled artifacts into existing sinks (skill_manage, memory, docs + ctx_index). Use when the user says "mine my sessions", "distill session knowledge", "what have I learned across sessions", "extract lessons from logs", or "turn my pi history into skills/memory".
---

# distill-session-knowledge

Offline miner. Turns past pi session traces into durable artifacts. No new
infrastructure — routes into `skill_manage`, the `memory` tool, and `docs/`
(indexed by context-mode FTS5). Dry-run by default; nothing is written until you
review the plan and explicitly apply.

Engine: the published `@blackbelt-technology/pi-dashboard-session-distiller`
package, invoked through its `distill-session-knowledge` bin (this skill package
declares it as a runtime dependency).

## When to use

- "Mine / distill my pi sessions", "what recurring mistakes do I keep making",
  "extract reusable procedures from my history", "turn session logs into skills".
- After a stretch of work, to harvest verified lessons before they decay.

## Procedure

1. **Dry-run the miner** (no writes) for this project:
   ```bash
   npx --no distill-session-knowledge --cwd "$(git rev-parse --show-toplevel)"
   ```
   Add `--n <k>` to change the recurrence threshold (default 3). Add `--json` to
   emit the full routing plan as JSON for programmatic review.

2. **Review the routing plan.** Each entry shows `signal -> sink [action] conf=…`:
   - `procedure -> skill_manage` — candidate reusable SKILL.md.
   - `fault -> memory(failure/tool-quirk)` — a wrong-way→right-way tool fix.
   - `user_correction -> memory(failure/correction)` — `+AGENTS.md` flag means it
     establishes a rule and should also patch the relevant AGENTS.md row.
   - `ask_user_decision -> memory(project/convention)` — a recorded human decision.
   - `documentation -> docs` — a recurring how-to summary.
   - `STALE` flag = confidence below floor; skip or prune, do not write.

3. **Apply** once the plan looks right — persists the watermark + below-threshold
   candidates store and prints the final plan:
   ```bash
   npx --no distill-session-knowledge --cwd "$(git rev-parse --show-toplevel)" --apply --json
   ```

4. **Execute the routed writes** from the plan, using your tools (this is the
   haiku-class subagent distillation step). For each non-stale entry:
   - `skill_manage` → `mcp__pi__skill_manage` create/patch (query existing first).
   - `memory` → `mcp__pi__memory` add with the entry's target + category
     (`memory_search` first to dedup; merge into a match instead of duplicating).
   - `docs` → delegate the write to a docs subagent in **caveman style** per the
     Documentation Update Protocol, then `ctx_index` the new doc so it is
     FTS5-searchable (task 5.2).
   - `+AGENTS.md` entries → patch the relevant AGENTS.md rule via the docs subagent
     (≤200 chars/row, caveman style) in addition to the memory write.

## Guardrails

- Dedup before every write — re-running over the same corpus must create zero
  duplicates (the planner marks `merge` when a sink already holds the artifact;
  still query the live sink, the planner's `exists` is conservative).
- Never write a `STALE` artifact.
- Stay within this project's sessions (the miner already scopes to the cwd dir).
- Respect the doc protocol: main agent orchestrates, a subagent writes under `docs/`.

## Verification

- `npx --no distill-session-knowledge --cwd "$(pwd)"` prints a routing plan and
  mutates nothing (dry-run default; no watermark advance).
- Re-running the dry-run over the same corpus yields the same plan (idempotent).
- After apply + routed writes, `ctx_search` returns a freshly distilled doc.
