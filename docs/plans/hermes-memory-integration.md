# Hermes Memory System Integration Plan

**Date:** 2026-04-01
**Status:** Research & Planning
**Source:** Analysis of [NousResearch/Hermes-Agent](https://github.com/NousResearch/Hermes-Agent) memory subsystem

---

## Table of Contents

- [1. Hermes Memory Architecture (As-Is)](#1-hermes-memory-architecture-as-is)
- [2. Pi Dashboard Current State](#2-pi-dashboard-current-state)
- [3. Proposed Integration: Three Features](#3-proposed-integration-three-features)
- [4. Feature A: Curated Memory (MEMORY.md / USER.md)](#4-feature-a-curated-memory-memorymd--usermd)
- [5. Feature B: Session Search (FTS5)](#5-feature-b-session-search-fts5)
- [6. Feature C: Skill Creation Nudges](#6-feature-c-skill-creation-nudges)
- [7. Scoping: Global vs Directory Level](#7-scoping-global-vs-directory-level)
- [8. Dashboard UI Integration](#8-dashboard-ui-integration)
- [9. Design Lessons from Hermes](#9-design-lessons-from-hermes)
- [10. What We Are NOT Integrating](#10-what-we-are-not-integrating)
- [11. Implementation Priority](#11-implementation-priority)
- [12. Open Questions](#12-open-questions)

---

## 1. Hermes Memory Architecture (As-Is)

Hermes Agent (by Nous Research) has a **five-layer memory system**. Each layer solves a different temporal problem. The layers are:

### Layer 1: Short-term Context Window
- Standard transformer working memory for the current session
- Compresses at 50% context utilization (configurable via `context_compression_threshold`)
- Caps tool orchestration at 90 iteration steps by default
- Nothing survives a restart — this layer exists to be lost

### Layer 2: Procedural Skills (SKILL.md)
- After complex tasks, the agent autonomously writes a `SKILL.md` capturing the step-by-step solution
- Follows the [agentskills.io](https://agentskills.io/specification) open standard
- Stored at `~/.hermes/memories/skills/`
- Creation triggered by complexity heuristics (iteration count, tool calls, solution novelty)
- The agent is **nudged** every N tool-calling iterations (`creation_nudge_interval`, default 10) to consider persisting knowledge as a skill
- Skills are plain files — inspectable, editable, portable
- No deduplication, no versioning, no expiration (skills accumulate indefinitely)

**Key code:** `tools/skill_manager_tool.py` — actions: `create`, `edit`, `patch`, `delete`, `write_file`, `remove_file`

### Layer 3: Curated Persistent Memory (MEMORY.md / USER.md)
Two bounded, file-backed markdown stores:

| Store | Purpose | Default Char Limit | ~Token Budget |
|-------|---------|-------------------|---------------|
| `MEMORY.md` | Agent's personal notes — environment facts, project conventions, tool quirks, lessons learned | 2,200 chars | ~800 tokens |
| `USER.md` | User profile — preferences, communication style, expectations, workflow habits | 1,375 chars | ~500 tokens |

**Implementation details** (from `tools/memory_tool.py`):
- Entry delimiter: `§` (section sign), entries can be multiline
- Single `memory` tool with `action` parameter: `add`, `replace`, `remove`
- `replace`/`remove` use short unique substring matching (not full text or IDs)
- **Frozen snapshot pattern**: system prompt captures memory state at session start. Mid-session writes update files on disk immediately but do NOT change the running system prompt. This preserves the prefix cache for the entire session. The snapshot refreshes on the next session start.
- **Proactive nudge system**: every N user turns (`nudge_interval`, default 10), the agent is reminded to review and update memory. Counter resets when the memory tool is actually used.
- **Security scanning**: content is scanned against regex patterns for prompt injection (`ignore previous instructions`, `you are now`, `system prompt override`) and exfiltration (`curl` with secrets, `cat .env`, SSH backdoors, invisible unicode characters). Blocked entries return descriptive errors.
- **File locking**: uses `fcntl.flock` with separate `.lock` files for read-modify-write safety across concurrent sessions
- **Atomic writes**: temp file + `os.replace()` to avoid truncation race conditions
- **Deduplication**: exact duplicate entries are rejected on `add`

**Behavioral guidance** lives in the tool schema description — the agent is told:
- Save proactively when: user corrects you, shares preferences, you discover environment facts, learn conventions
- Priority: user preferences/corrections > environment facts > procedural knowledge
- Do NOT save: task progress, session outcomes, completed-work logs, temporary TODO state
- Skip: trivial/obvious info, things easily re-discovered, raw data dumps

### Layer 5: Full-text Session Search (FTS5)
- SQLite FTS5 indexes all past session messages
- LLM-powered summarization of matching sessions (uses Gemini Flash or similar cheap model)
- Flow: FTS5 search → group by session → load top N sessions → truncate to ~100k chars centered on matches → LLM summarize → return per-session summaries with metadata
- Cross-session recall for temporal queries: "What did I do last Tuesday?"
- Session persistence uses WAL mode for concurrent readers + one writer
- Schema includes: sessions table (metadata, tokens, costs, model config) + messages table + messages_fts virtual table

**Key code:** `hermes_state.py` (SQLite schema, 1274 lines), `tools/session_search_tool.py` (FTS5 search + summarization)

### The Closed Learning Loop
```
Task completed → Skill created (Layer 2)
                → Memory updated (Layer 3)
                → FTS5 indexes session (Layer 5)

Next similar task → Skill retrieved by similarity (Layer 2)
                  → Memory provides context (Layer 3)
                  → FTS5 recalls past work (Layer 5)
```

### Hermes Memory Configuration
```yaml
# ~/.hermes/config.yaml
memory:
  memory_enabled: true
  user_profile_enabled: true
  memory_char_limit: 2200       # ~800 tokens for MEMORY.md
  user_char_limit: 1375         # ~500 tokens for USER.md
  nudge_interval: 10            # remind agent every N user turns

skills:
  creation_nudge_interval: 10   # remind agent every N tool iterations
```

---

## 2. Pi Dashboard Current State

### What Pi Already Has
- **Skills system**: Pi implements the agentskills.io standard — same as Hermes. Skills at `~/.pi/agent/skills/`, `.pi/skills/`, etc.
- **Directory-level session management**: The dashboard groups sessions by working directory (cwd). Each pinned directory shows its sessions.
- **Session persistence**: `session-persistence.ts` persists session metadata to JSON for server restarts
- **Event store**: `memory-event-store.ts` — in-memory event buffer with LRU eviction
- **Context compaction**: Pi has `/compact` command
- **Extension system**: Bridge extension architecture allows adding new capabilities

### What Pi Does NOT Have
- ❌ No persistent cross-session memory (MEMORY.md / USER.md equivalent)
- ❌ No cross-session search (FTS5 or similar)
- ❌ No memory nudge system
- ❌ No skill creation nudges
- ❌ No user modeling

---

## 3. Proposed Integration: Three Features

Based on the Hermes analysis, three features are worth integrating:

| Feature | Effort | Value | Priority |
|---------|--------|-------|----------|
| **A. Curated Memory** (MEMORY.md / USER.md) | Medium | ⭐⭐⭐⭐⭐ | P0 |
| **B. Session Search** (FTS5 per directory) | Medium-High | ⭐⭐⭐⭐ | P1 |
| **C. Skill Creation Nudges** | Low | ⭐⭐⭐ | P2 |

---

## 4. Feature A: Curated Memory (MEMORY.md / USER.md)

### Design: Two-Level Scoping

Unlike Hermes (which has a single global memory), pi's memory must work at **two levels** because sessions are organized by directory:

#### Global Memory (`~/.pi/agent/memories/`)
- `MEMORY.md` — Cross-project agent notes (OS, installed tools, general preferences)
- `USER.md` — User profile (name, role, timezone, communication style, workflow habits)
- Injected into ALL sessions regardless of directory
- Example entries:
  - MEMORY: "macOS Sequoia, Homebrew, Node 22, uses tmux"
  - USER: "Prefers concise responses. Senior full-stack dev. Timezone: UTC-3"

#### Directory-Level Memory (`<project>/.pi/memories/`)
- `MEMORY.md` — Project-specific agent notes (project conventions, architecture quirks, build commands, API patterns)
- `USER.md` — Project-specific user preferences (coding style for this project, review standards)
- Only injected into sessions whose cwd is within that directory
- Example entries:
  - MEMORY: "Uses Vite + React 19. Build: npm run build. Test: npm test (vitest)"
  - USER: "Wants TDD approach in this project. Prefers functional components"

#### Memory Merging at Session Start
When a session starts in `/Users/robson/Project/pi-agent-dashboard/`:
```
System prompt includes:
  ══════════════════════════════════════════════
  GLOBAL MEMORY (your personal notes) [45% — 990/2,200 chars]
  ══════════════════════════════════════════════
  <global MEMORY.md entries>

  ══════════════════════════════════════════════
  GLOBAL USER PROFILE [60% — 825/1,375 chars]
  ══════════════════════════════════════════════
  <global USER.md entries>

  ══════════════════════════════════════════════
  PROJECT MEMORY (pi-agent-dashboard) [30% — 660/2,200 chars]
  ══════════════════════════════════════════════
  <directory MEMORY.md entries>

  ══════════════════════════════════════════════
  PROJECT USER PROFILE [20% — 275/1,375 chars]
  ══════════════════════════════════════════════
  <directory USER.md entries>
```

#### Memory Tool Design
Single `memory` tool with parameters:
```typescript
{
  action: "add" | "replace" | "remove",
  target: "memory" | "user",
  scope: "global" | "project",  // NEW: which level to write to
  content?: string,              // for add/replace
  old_text?: string,             // for replace/remove (substring match)
}
```

#### Implementation as Pi Extension
The memory system should be a **pi extension** (not baked into the dashboard):
- Registers the `memory` tool at `session_start`
- Reads memory files and injects into system prompt
- Handles nudge timing (configurable interval)
- Security scanning on content before persisting
- Atomic file writes with locking

#### Character Limits (per store, per level)
| Store | Global Limit | Project Limit |
|-------|-------------|---------------|
| MEMORY.md | 2,200 chars (~800 tokens) | 2,200 chars (~800 tokens) |
| USER.md | 1,375 chars (~500 tokens) | 1,375 chars (~500 tokens) |

Total worst-case system prompt overhead: ~2,600 tokens (all four stores at capacity).

#### Frozen Snapshot Pattern (from Hermes)
- Memory state is captured once at session start
- Mid-session `memory` tool calls update files on disk immediately
- The system prompt is NOT modified mid-session (preserves prefix cache)
- Next session gets the updated memory
- Tool responses always show the live (post-mutation) state so the agent sees its edits

#### Nudge System
- Every N user turns (configurable, default 10), append a system-level reminder:
  > "You have a persistent memory tool. If you've learned anything useful about the user, their preferences, the project, or the environment during this conversation, consider saving it now."
- Counter resets when the memory tool is actually used
- Nudge is injected as a non-persisted system message (not saved to session history)

---

## 5. Feature B: Session Search (FTS5)

### Design: Directory-Scoped SQLite Databases

Each pinned directory gets its own SQLite database for session search:

```
<project>/.pi/sessions.db       # per-directory session index
~/.pi/agent/sessions.db         # global fallback (for non-pinned dirs)
```

#### What Gets Indexed
- All assistant messages (text content)
- All user messages
- Tool call names and results (truncated)
- Session metadata (start time, model used, title)
- NOT indexed: raw binary data, large file contents, base64 images

#### Schema (SQLite with FTS5)
```sql
CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    started_at REAL NOT NULL,
    ended_at REAL,
    model TEXT,
    title TEXT,
    message_count INTEGER DEFAULT 0,
    tool_call_count INTEGER DEFAULT 0
);

CREATE TABLE messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL REFERENCES sessions(id),
    role TEXT NOT NULL,
    content TEXT,
    tool_name TEXT,
    timestamp REAL NOT NULL
);

CREATE VIRTUAL TABLE messages_fts USING fts5(
    content,
    content=messages,
    content_rowid=id
);
```

#### Search Flow (Hermes Pattern)
1. User asks: "What was the auth bug I fixed last week?"
2. FTS5 search finds matching messages ranked by BM25 relevance
3. Group results by session, take top 3 unique sessions
4. Load each session's conversation, truncate to ~100k chars centered on matches
5. Send to a cheap/fast model (e.g., Gemini Flash) with a focused summarization prompt
6. Return per-session summaries with metadata (date, model, title)

#### Implementation Location
- **Server-side**: `src/server/session-search.ts` — SQLite management, FTS5 queries
- **Indexing**: The bridge extension feeds session events to the server, which indexes them into the per-directory SQLite DB
- **Search tool**: Registered as a `session_search` tool in the bridge extension
- **Dashboard UI**: Search bar in the directory view, results shown inline

#### Directory-Level Isolation
- Sessions in `/Users/robson/Project/pi-agent-dashboard/` only search that project's database
- Prevents cross-project information leakage
- Global search (`scope: "all"`) could search across all directory databases if needed

---

## 6. Feature C: Skill Creation Nudges

### Design
Lightweight nudge system that reminds the agent to create skills after complex tasks:

- Track tool-calling iterations per turn
- Every N iterations (`skill_nudge_interval`, default 10), inject a reminder:
  > "This task involved many steps. If you've developed a reusable approach, consider creating a skill with the appropriate skill creation workflow."
- Counter resets when a skill-related action is taken
- This leverages pi's existing skills system — no new skill infrastructure needed

### Implementation
- Simple counter in the bridge extension
- Configurable via dashboard settings
- Can be disabled (`skill_nudge_interval: 0`)

---

## 7. Scoping: Global vs Directory Level

### Memory Scoping

```
~/.pi/agent/memories/
├── MEMORY.md          # Global agent memory
└── USER.md            # Global user profile

<project-dir>/.pi/memories/
├── MEMORY.md          # Project-specific agent memory
└── USER.md            # Project-specific user profile
```

### Session Search Scoping

```
~/.pi/agent/sessions.db           # Global session index (fallback)

<project-dir>/.pi/sessions.db     # Per-directory session index
```

### Resolution Order
When a session starts in a directory:
1. Load global `MEMORY.md` + `USER.md` from `~/.pi/agent/memories/`
2. Walk up from cwd to find the nearest `.pi/memories/` directory (similar to how pi discovers skills)
3. Merge both levels into the system prompt (global first, then project)
4. For session search, use the nearest `.pi/sessions.db`

### Why Directory-Level?
- Different projects have different conventions, build systems, architectures
- "Always use yarn" in project A, "always use pnpm" in project B — global memory can't handle this
- Cross-project memory pollution is a real problem (Hermes has this issue with no scoping)
- Aligns with pi's existing directory-based session grouping in the dashboard

---

## 8. Dashboard UI Integration

### Memory Management View
Per directory in the dashboard sidebar:
- **Memory tab** showing current MEMORY.md and USER.md entries (both global and project)
- Inline editing: click an entry to edit, delete button per entry
- Usage bar showing character consumption vs limit
- "Scope" toggle to switch between viewing global vs project memory

### Session Search
- Search input in the directory view header
- Results shown as expandable session cards with:
  - Session date and model used
  - LLM-generated summary of matching content
  - Link to jump to the full session
- Search scope: current directory (default), or all directories

### Settings
New configuration fields in the dashboard settings panel:
```json
{
  "memory": {
    "enabled": true,
    "global_memory_char_limit": 2200,
    "global_user_char_limit": 1375,
    "project_memory_char_limit": 2200,
    "project_user_char_limit": 1375,
    "nudge_interval": 10,
    "security_scanning": true
  },
  "session_search": {
    "enabled": true,
    "max_sessions_per_query": 3,
    "summarization_model": "gemini-flash"
  },
  "skill_nudges": {
    "enabled": true,
    "nudge_interval": 10
  }
}
```

---

## 9. Design Lessons from Hermes

Key architectural decisions learned from studying Hermes's implementation:

1. **Bounded memory is better than unbounded** — Character limits force the agent to curate. Without limits, memory becomes a dumping ground and retrieval quality degrades over time.

2. **Frozen snapshot pattern** — Never mutate the system prompt mid-session. Capture memory state once at session start. This preserves the LLM's prefix cache, which is critical for performance with large context windows.

3. **Nudge, don't automate** — The agent decides what's worth remembering, but needs periodic reminders. Fully automatic memory extraction (like Mem0) adds LLM calls per write and can produce low-quality entries. Nudges let the agent exercise judgment.

4. **Two stores, not one** — Separating "about the user" from "about the environment" keeps memory organized and makes it clear what goes where. The tool schema description provides behavioral guidance.

5. **Substring matching for edits** — Hermes's `replace`/`remove` use short unique substring matching, not IDs or full-text match. This is natural for LLMs to use ("find the entry about yarn and replace it").

6. **Security scanning is essential** — Memory entries get injected into system prompts. Without scanning, an adversarial tool output could write injection payloads into memory that persist across sessions. Hermes scans for: prompt injection patterns, exfiltration attempts (curl/wget with secrets), invisible unicode characters.

7. **Atomic file operations** — Use temp file + `os.replace()` (or equivalent) for writes. Never truncate-then-write, which creates race windows where concurrent readers see empty files.

8. **File locking for concurrent access** — Multiple sessions can share the same memory files. Hermes uses `fcntl.flock` with separate `.lock` files. In Node.js, we'll need `proper-lockfile` or similar.

9. **No forgetting = eventual problem** — Hermes has no pruning, no decay, no expiration. Skills and FTS5 logs grow indefinitely. Any integration should plan for eventual cleanup (manual or automatic).

10. **Session search needs summarization** — Raw FTS5 results are noisy. Hermes sends matching session transcripts through a cheap LLM for focused summarization before returning results. This keeps the main model's context clean.

---

## 10. What We Are NOT Integrating

### Vector Store for Skills (Layer 3)
- **Why not**: Pi already has skill discovery via directory scanning and name matching
- **Hermes's vector store** makes skills findable by task description similarity — useful at scale (100+ skills) but overkill for typical usage
- **Revisit if**: Users accumulate enough skills that name-based discovery becomes insufficient

### Automatic Skill Creation
- **Why not**: Hermes's automatic creation threshold is undocumented and unpredictable — sometimes creates skills for trivial tasks, sometimes misses complex ones
- **Our approach**: Nudge the agent to consider skill creation, but let the user/agent decide. Pi already supports agent-driven skill creation via the existing skills system.

---

## 11. Implementation Priority

### Phase 1: Curated Memory (P0)
1. Create `memory` pi extension with `memory` tool
2. File storage at `~/.pi/agent/memories/` (global) and `<project>/.pi/memories/` (directory)
3. Frozen snapshot injection into system prompt
4. Nudge system with configurable interval
5. Security scanning on memory content
6. Dashboard UI: memory viewer/editor per directory
7. Dashboard settings for memory configuration

### Phase 2: Session Search (P1)
1. SQLite + FTS5 per-directory database
2. Indexing pipeline: bridge extension → server → SQLite
3. `session_search` tool registration
4. LLM summarization of search results
5. Dashboard UI: search bar in directory view

### Phase 3: Skill Nudges (P2)
1. Iteration counter in bridge extension
2. Configurable nudge interval
3. Dashboard settings toggle

---

## 12. Open Questions

1. **Memory file location**: Should project-level memory be in `.pi/memories/` (tracked by git) or `.pi/agent/memories/` (gitignored)? Hermes uses a global location. Project memory likely should NOT be committed to git (personal preferences, environment-specific facts).

2. **Memory migration**: When a user starts using memory for the first time in an existing project, should we offer to populate initial entries from recent session history?

3. **Concurrent write handling**: Multiple pi sessions in the same directory can write to the same memory files. Need file locking strategy for Node.js (Hermes uses `fcntl.flock`).

4. **FTS5 database size management**: Should we auto-prune old sessions from the index? What's the retention policy? Hermes has no pruning.

5. **Search summarization model**: Which model to use for summarizing FTS5 results? Hermes uses Gemini Flash. Should this be configurable?

6. **Memory visibility in system prompt**: Should the memory block be visible to the user in the dashboard (like seeing what context the agent has)?

7. **Memory export/import**: Should we support exporting memory to share across machines or importing from Hermes format?

8. **Nudge injection mechanism**: How to inject nudge messages via pi's extension API without persisting them to session history?

---

## Appendix: Hermes Source Files Analyzed

| File | Lines | Purpose |
|------|-------|---------|
| `tools/memory_tool.py` | ~380 | Memory tool: MemoryStore class, security scanning, tool schema |
| `hermes_state.py` | 1,274 | SQLite state store: schema, FTS5, session persistence |
| `tools/session_search_tool.py` | ~500 | FTS5 search + LLM summarization |
| `tools/skill_manager_tool.py` | ~700 | Skill CRUD: create, edit, patch, delete, write_file |
| `tools/skills_tool.py` | ~1,345 | Skill listing and viewing with progressive disclosure |
| `agent/skill_commands.py` | ~300 | Slash command helpers for skills |
| `agent/insights.py` | ~790 | Session analytics engine |
| `run_agent.py` | ~8,400+ | Main agent loop (nudge logic, memory injection) |

### External References
- [Hermes memory: five layers, one learning loop](https://dev.to/openwalrus/hermes-memory-five-layers-one-learning-loop-39gd) — Independent deep-dive analysis
- [Hermes Agent Architecture](https://hermes-agent.nousresearch.com/docs/developer-guide/architecture/) — Official docs
- [agentskills.io specification](https://agentskills.io/specification) — Portable skill format (shared with pi)
