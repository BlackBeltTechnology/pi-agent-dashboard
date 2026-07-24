# Hermes-Memory Pressure & a kb-Indexed Cold Archive Tier

**Type:** Research dossier (explore-mode). No OpenSpec change, no implementation.
**Question:** The hermes-memory stores (`MEMORY.md`, `USER.md`, `failures.md`, project stores) sit at/near capacity. How do we (a) decrease the pressure, (b) store + clean up more efficiently, and (c) keep the *most relevant* entries — ideally by distilling into a persisted `.md` that `kb` can index and recall on demand, with a pointer injected so agents can get those entries back when needed.

**Backend under study:** `pi-hermes-memory` (loaded globally via `npm:pi-hermes-memory`). Source read at `~/.pi/agent/npm/node_modules/pi-hermes-memory/src/`. Live stores at `~/.pi/agent/pi-hermes-memory/` + SQLite index `sessions.db`.

---

## 1. Executive summary

- **Pressure is concentrated, not global.** At probe time `MEMORY.md` was 63% and `USER.md` 76% full; only `failures.md` (97%) and a handful of the 89 project `MEMORY.md` stores sit at the wall. The global stores were briefly at 100% and auto-consolidate reclaimed them mid-session — the mechanism works.
- **Context cost is already minimal.** `memoryMode = "policy-only"` means **full markdown memories are NOT injected**. Only a ~1 KB policy prompt + up to 5 recent (≤7 day) failures load per turn. So "stores are full" does **not** bloat context. The felt pressure is purely **storage eviction destroying entries**.
- **There is no durable cold tier today.** Consolidation/eviction deletes from **both** the `.md` and the SQLite index (`DELETE FROM memories`). An evicted failure is gone from `memory_search` too. This is the real gap.
- **The distill-to-kb idea fills that gap.** `kb` can index arbitrary external dirs (`kb index --source <dir>`, `kb init --global`), so an uncapped archive `.md` becomes a `kb_search`-able cold tier below the capped hermes hot store.
- **The AGENTS.md piece is a one-line pointer, not the entries.** Repo doctrine forbids injecting content into AGENTS.md (every byte loads every turn). The natural home for the retrieval pointer is hermes' own `memoryPolicyCustomText` config — appended to the always-injected memory policy, globally, in every project.
- **A real relevance signal already exists.** `memory_search` bumps each returned entry's `last=` timestamp (LRU). Consolidation already drops >30-day-unreferenced entries and preserves user prefs. "Keep the most relevant" is wired — the levers are capacity, consolidation-model quality, and inflow cleanliness.

---

## 2. The mechanism (with evidence)

### 2.1 Char ceilings — `src/constants.ts`

```
DEFAULT_MEMORY_CHAR_LIMIT  = 5000
DEFAULT_USER_CHAR_LIMIT    = 5000
DEFAULT_PROJECT_CHAR_LIMIT = 5000
failure store              = memory × 2 = 10000
ENTRY_DELIMITER            = "\n§\n"
```

Usage is measured in **characters** (model-independent) and **includes** the per-entry `<!-- created=…, last=… -->` comment bytes.

### 2.2 Overflow strategy — `src/config.ts` `DEFAULT_CONFIG`

```
memoryOverflowStrategy : "auto-consolidate"   (default)
                          | "reject"
                          | "fifo-evict"
autoConsolidate        : true
memoryMode             : "policy-only"
reviewEnabled          : true
correctionDetection    : true
failureInjectionEnabled: true
failureInjectionMaxAgeDays : 7
failureInjectionMaxEntries : 5
```

### 2.3 Write → overflow → consolidate flow

```
   write (add)                         over ceiling?
   ┌──────────┐  memory tool / bg      ┌──────────────────────────────┐
   │ new entry├──review / correction──▶│ overflowStrategy:            │
   └──────────┘  / flush-on-compact    │  • auto-consolidate (DEFAULT)│
                                        │  • reject                    │
                                        │  • fifo-evict                │
                                        └───────────────┬──────────────┘
                                                        ▼
                          DIRECT_CONSOLIDATION_SYSTEM_PROMPT (in-process LLM,
                          scoped to ONE store):
                          - merge related entries
                          - drop entries >30d w/ no recent reference
                          - keep frequently-referenced
                          - preserve user prefs (highest priority)
```

Consolidation is a single `completeSimple()`-style call per target store (`handlers/auto-consolidate.ts` → `triggerConsolidation`). Manual trigger: `/memory-consolidate` command. A lock dir (`.consolidation-locks`) serializes concurrent consolidations.

### 2.4 The relevance signal (LRU)

`src/tools/memory-search-tool.ts:73` bumps `lastReferenced` on every returned entry; the store persists it as `last=` in the entry comment (`store/sqlite-memory-store.ts`). Entries never surfaced by search go stale → become the first consolidation drop candidates. **`last=` is a live LRU clock.**

### 2.5 What actually injects — `memoryMode = "policy-only"`

`src/prompt-context.ts` + `handlers/preview-context.ts`:

> *"Mode: policy-only … Full Markdown memories are NOT injected in this mode."*

Per-turn injection = compact `MEMORY_POLICY_PROMPT` (~1 KB) **only**, plus the failure-injection path (`failureInjectionEnabled`, ≤7 days, ≤5 entries). Everything else is retrieval-on-demand via `memory_search`. `legacy-inject` mode would inject full blocks, but is not the default.

### 2.6 THE GAP — eviction deletes from both tiers

`store/sqlite-memory-store.ts`:

```
removeSyncedMemories       → DELETE FROM memories WHERE id IN (...)
removeExactSyncedMemories  → DELETE FROM memories WHERE id IN (...)   (FIFO eviction path)
```

When hermes consolidates or FIFO-evicts, the entry is removed from the `.md` **and** the SQLite search index. So evicted entries vanish from `memory_search` entirely. **No cold searchable tier survives eviction.** (The "SQLite superset" noted in the `consolidate-pi-memory-store` skill is accumulated dup/session-index rows, not a durable archive of evicted memories.)

---

## 3. Current usage snapshot (session-time)

Global stores:

```
STORE          BYTES   LIMIT   USE%    ENTRIES   STATE
──────────────────────────────────────────────────────────
MEMORY.md       3139    5000   62.8%      7      healthy
USER.md         3803    5000   76.1%      7      comfortable
failures.md     9733   10000   97.3%     12      at the wall
```

(First probe minutes earlier showed 100.5% / 98.8% / 100.7% — auto-consolidate reclaimed MEMORY/USER between probes. The store is *live*; row counts shift mid-run as background review/consolidation children write.)

Project stores: **254** dirs under `~/.pi/agent/projects-memory/`, **89** with a `MEMORY.md` (5000 cap each). Several over ceiling:

```
Documents                            5045 / 5000   over
os-add-change-summary-table          5038 / 5000   over
os-electron-attach-ownership-fixes   5002 / 5000   over
pi-dashboard-subagents               4972 / 5000   99%
os-fix-thinking-level-supported...   4862 / 5000   97%
```

Diagnosis: pressure is concentrated in **`failures.md`** (highest inflow — background review + correction detector both feed it) and a few hot project stores. Not a global "everything is full" condition.

---

## 4. kb capability check (grounds the archive idea)

`kb --help` (binary at `node_modules/.bin/kb`; `kb-extension` already loaded in global settings):

```
kb init   [--global] [--source <ref>]...        # add a source root; --global = cross-project index
kb index  [--source <dir>...] [--force] [--refresh]
kb search "<q>" [--doc-type doc|agents|source-md] [--rerank] [--expand-graph] [--json]
kb get <path> [--section "<heading_path>"]
kb neighbors / backlinks / dox init / dox lint / config show
```

- **Can index external dirs** — `--source <dir>` accepts any path, including `~/.pi/agent/pi-hermes-memory/`.
- **Global index** — `kb init --global` for a cross-project kb root (matches memory's global nature).
- **Ranking** — BM25 + Porter-stemming + trigram-substring, fused via RRF, proximity re-rank, typo correction. Strictly richer retrieval than the hermes SQLite FTS.
- **Per-repo DB** lives at `.pi/dashboard/kb/index.db`; hermes DB is a separate `sessions.db`.

**Two-corpora reality:** `memory_search` → hermes SQLite. `kb_search` → kb index. An archive that lives only in the kb index is reachable **only** via `kb_search`. The agent must be told to reach for it.

---

## 5. Proposed architecture — hot/cold tiering

```
   HOT TIER  (hermes)                    COLD TIER  (kb-indexed archive)
   ─────────────────────                 ──────────────────────────────
   MEMORY / USER / failures.md           memory-archive.md   (uncapped)
   capped 5k / 5k / 10k                   distilled, curated
   auto-consolidate / evict ─on drop──▶   append dropped entry here
   memory_search                          kb_search (BM25+trigram+RRF+rerank)
   auto-injects (policy-only, ~1KB)       search-on-demand only
```

Retrieval fallback the pointer must teach:

```
 agent needs a fact
        │
        ▼
  memory_search ──found?──▶ use it            (hot tier, recent)
        │ empty
        ▼
  kb_search (archive) ────▶ recall evicted    (cold tier, distilled)
```

### 5.1 The one missing piece: the WRITE path

Hermes has no "append-to-archive on evict" hook. The distillation needs a trigger:

| Approach | How | Trade-off |
|---|---|---|
| **Manual / periodic distill** | Job reads stores + timestamps, writes curated `memory-archive.md`, `kb index --refresh` | Simple, zero hermes changes; must remember to run (or cron) |
| **Eviction hook** | Wrap/patch hermes so consolidate/evict appends dropped entries to archive first | Lossless & automatic; modifies a node_module (fork / upstream PR) |
| **Point kb at live stores** | `kb init --source ~/.pi/agent/pi-hermes-memory` | 2-minute win; better *ranking* over surviving entries but **does not** retain evicted ones |

---

## 6. The AGENTS.md / pointer question (explicitly rechecked)

Separate two things:

**(a) Do NOT inject the entries.** Repo doctrine: *"your update does NOT belong in AGENTS.md — it loads every turn, every byte costs tokens."* Injecting archived memories into AGENTS.md recreates the exact pressure being escaped. Only a **one-line retrieval pointer** belongs there — same pattern as the Docs-First Gate ("one-line purpose instead of raw bytes").

**(b) There is a better native hook than the repo AGENTS.md.** Hermes config exposes **`memoryPolicyCustomText`** (`src/prompt-context.ts`, `MemoryConfig`) — text appended to the memory policy that is **already injected every turn, globally, in every project**. That is the correct home because memory is global while a repo AGENTS.md is per-repo. Example pointer:

```
Archived/evicted memories live in kb (source: <archive path>).
For historical failures/decisions not found via memory_search, use kb_search.
```

Footprint: one line, entries retrieved on demand — exactly the kb doctrine.

---

## 7. Levers to reduce pressure / keep the best (independent of the archive)

```
 A. LESS INFLOW          B. MORE CAPACITY       C. SMARTER EVICTION   D. BETTER MERGE
 • reviewEnabled         • memoryCharLimit       • memoryOverflow      • llmModelOverride
 • correctionDetection   • userCharLimit           Strategy            • llmThinkingOverride
   patterns              • projectCharLimit        (avoid fifo-evict)  • consolidationTimeoutMs
 • nudgeToolCalls        • failure = mem×2       • failureInjection
```

All B/C/D are **settings.json knobs** the config layer already reads: `memoryCharLimit`, `userCharLimit`, `projectCharLimit`, `memoryOverflowStrategy`, `autoConsolidate`, `consolidationTimeoutMs`, `failureInjectionEnabled/MaxAgeDays/MaxEntries`, `llmModelOverride`, `llmThinkingOverride`, `correctionDetection`, `reviewEnabled`, `nudgeToolCalls`, `memoryPolicyCustomText`, `memoryMode`, `memoryPolicyStyle`. No code change to move them.

| Lever | Effect | Cost / risk |
|---|---|---|
| Raise ceilings (e.g. 5000→8000, failure→16000) | Instant relief, nothing lost | Defers the wall; more bytes to search |
| Keep auto-consolidate, upgrade its model (`llmModelOverride`) | Denser merges, smarter keep | Latency/cost per consolidation |
| Switch to `fifo-evict` | Deterministic, no LLM | **Drops oldest, not least-relevant** — discards the `last=` LRU signal. Avoid. |
| Trim inflow (tighten correction/review) | Less junk diluting LRU signal | May miss a genuine learning |
| One-shot `/memory-consolidate` | Reclaim now, keep the good stuff | One LLM pass per store |

**Steer away from `fifo-evict`:** age ≠ relevance; the `last=` LRU that auto-consolidate already uses is strictly better information.

---

## 8. Recommended shape (layered, not one lever)

```
1. RECLAIM NOW   → /memory-consolidate on failures.md + the over-cap project stores
2. RAISE FLOOR   → bump failure ceiling (and hot project stores) for headroom
3. IMPROVE KEEP  → llmModelOverride = strong model for the consolidation pass
4. RETAIN        → distill dropped entries into memory-archive.md, kb-index it
5. RECALL        → one-line kb_search pointer via memoryPolicyCustomText
6. CUT DILUTION  → audit whether background review saves low-value entries
```

Honest framing: because `memoryMode` is policy-only, this is about **retention + retrieval quality**, not context-size reduction (already minimal). If retention isn't actually the goal, steps 1–3 alone (reclaim + raise failure ceiling + better consolidation model) solve the felt pressure without an archive — but stay lossy over a long horizon.

---

## 9. Open decisions (before any implementation)

1. **Scope** — global archive (`~/.pi/agent/…` + `kb init --global`) matching memory's cross-project nature, vs in-repo (`docs/`/`.pi/`, git-versioned but this-repo-only)?
2. **Write trigger** — manual/periodic distill (no hermes changes) vs eviction hook (lossless, touches the package)?
3. **Retention vs simplicity** — build the archive tier, or just raise the failure ceiling + upgrade the consolidation model and accept long-horizon loss?
4. **Injection point** — `memoryPolicyCustomText` (global, native, always injected) vs a repo AGENTS.md Docs-First-Gate row (per-repo).

---

## 10. Sources

- `~/.pi/agent/npm/node_modules/pi-hermes-memory/src/constants.ts` — char limits, consolidation/review/correction prompts, correction patterns.
- `.../src/config.ts` — `DEFAULT_CONFIG`, overflow strategies, all settable knobs.
- `.../src/prompt-context.ts`, `handlers/preview-context.ts` — `memoryMode` policy-only injection; `memoryPolicyCustomText`.
- `.../src/tools/memory-search-tool.ts:73` — `lastReferenced` bump (LRU).
- `.../src/store/sqlite-memory-store.ts` — `removeSyncedMemories` / `removeExactSyncedMemories` → `DELETE FROM memories` (both-tier eviction).
- `.../src/handlers/auto-consolidate.ts` — `triggerConsolidation`, `/memory-consolidate`, consolidation locks.
- `kb --help` (`node_modules/.bin/kb`) — `--source`, `--global`, `--doc-type`, ranking pipeline.
- Live stores: `~/.pi/agent/pi-hermes-memory/{MEMORY,USER,failures}.md`, `sessions.db`; `~/.pi/agent/projects-memory/` (254 dirs, 89 `MEMORY.md`).
- `.pi/skills/consolidate-pi-memory-store/SKILL.md` — existing manual consolidation/prune procedure + pitfalls.
