# hermes-memory-integration — index

Plan (2026-04-01, research): integrate Hermes-Agent memory subsystem into pi dashboard.

## 1. Hermes Memory Architecture (As-Is)
- Five-layer memory system.
- Layer 1 Short-term context: compresses at 50% util, caps 90 iterations, lost on restart.
- Layer 2 Procedural Skills (SKILL.md): agentskills.io standard, `~/.hermes/memories/skills/`, complexity-triggered, nudged every N iterations (`creation_nudge_interval` default 10), no dedup/version/expiry. Code `tools/skill_manager_tool.py`.
- Layer 3 Curated Memory: MEMORY.md (2,200 chars/~800 tok, env facts/conventions) + USER.md (1,375 chars/~500 tok, profile). Code `tools/memory_tool.py`. Delimiter `§`. Actions add/replace/remove via substring match. Frozen snapshot (system prompt captured at session start, mid-session writes hit disk only, preserves prefix cache). Nudge every N turns (default 10). Security scanning (injection/exfiltration regex). `fcntl.flock`, atomic temp+`os.replace()`, dedup.
- Layer 5 FTS5 Session Search: SQLite FTS5, LLM summarization (Gemini Flash), flow search→group→truncate ~100k→summarize. WAL mode. Code `hermes_state.py` (1274 lines), `tools/session_search_tool.py`.
- Closed learning loop diagram. Config yaml `~/.hermes/config.yaml`.

## 2. Pi Dashboard Current State
- Has: skills (agentskills.io), directory-level session grouping, `session-persistence.ts`, `memory-event-store.ts`, `/compact`, extensions.
- Lacks: cross-session memory, cross-session search, memory/skill nudges, user modeling.

## 3. Proposed Integration: Three Features
- A Curated Memory (P0), B Session Search FTS5 (P1), C Skill Creation Nudges (P2).

## 4. Feature A: Curated Memory (MEMORY.md / USER.md)
- Two-level scoping: Global `~/.pi/agent/memories/`, Directory `<project>/.pi/memories/`.
- Merge at session start (global then project, usage % headers).
- Tool: `{action, target:memory|user, scope:global|project, content?, old_text?}`.
- Implement as pi extension (registers tool at `session_start`, injects prompt, nudge, security scan, atomic locked writes).
- Char limits table. Frozen snapshot pattern. Nudge every N turns, counter resets on use, non-persisted system message.

## 5. Feature B: Session Search (FTS5)
- Directory-scoped SQLite DBs: `<project>/.pi/sessions.db`, `~/.pi/agent/sessions.db` fallback.
- Indexes assistant/user messages, tool names/results, metadata. Not raw binary/large files/base64.
- Schema: sessions + messages + messages_fts (fts5). Search flow (BM25→group→top 3→truncate ~100k→cheap model summarize).
- Location: `src/server/session-search.ts`, bridge feeds server, `session_search` tool, search bar UI. Directory isolation.

## 6. Feature C: Skill Creation Nudges
- Track iterations, nudge every N (`skill_nudge_interval` default 10), counter resets on skill action. Bridge extension counter, dashboard config, disable with 0.

## 7. Scoping: Global vs Directory Level
- Memory + session-search directory trees. Resolution: load global, walk up for nearest `.pi/memories/`, merge global-first, nearest `.pi/sessions.db`.
- Why directory-level: per-project conventions, avoid cross-project pollution.

## 8. Dashboard UI Integration
- Memory Management view (tab, inline edit, usage bar, scope toggle). Session Search (input, expandable cards). Settings JSON (memory/session_search/skill_nudges).

## 9. Design Lessons from Hermes
- 10 lessons: bounded>unbounded, frozen snapshot, nudge-don't-automate, two-stores, substring edits, security scanning, atomic ops, file locking, no-forgetting=problem, search needs summarization.

## 10. What We Are NOT Integrating
- Vector store for skills (name-matching enough). Automatic skill creation (unpredictable threshold).

## 11. Implementation Priority
- Phase 1 Curated Memory (P0), Phase 2 Session Search (P1), Phase 3 Skill Nudges (P2).

## 12. Open Questions
- 8 questions: memory location git-tracked?, migration, concurrent writes (Node lockfile), FTS5 pruning, summarization model, prompt visibility, export/import, nudge injection mechanism.

## Appendix: Hermes Source Files Analyzed
- Table: memory_tool.py 380, hermes_state.py 1274, session_search_tool.py 500, skill_manager_tool.py 700, skills_tool.py 1345, skill_commands.py 300, insights.py 790, run_agent.py 8400+. External refs (dev.to, nousresearch docs, agentskills.io).
