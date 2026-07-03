# Design — add-kb-folder-slot

## 1. Problem framing

The KB is a per-cwd SQLite/FTS5 index. Its freshness is driven entirely by the **in-session** `pi-dashboard-kb-extension`:

```
write/edit .md  ──debounce 800ms──▶ reindexNow(cwd)      (proactive)
kb_search       ──inline──────────▶ reindexNow(cwd)       (reactive)
```

Both paths require a **live pi session** in that cwd. A git worktree:
- resolves its **own** `dbAbsPath` via `loadConfig(cwd)` (config layering: project `.pi/dashboard/knowledge_base.json` → global → defaults),
- is frequently opened **without** an attached session (just a folder in the sidebar),

⇒ its KB db is absent/empty and never gets built. `kb_search` there returns nothing, silently. This change makes the count visible and the reindex triggerable from the dashboard, independent of any session.

## 1b. Packaging: a new `kb-plugin` (dashboard plugin), not the session extension

The KB spans three layers; this change adds the third:

```
LAYER 1  packages/kb            @…/pi-dashboard-kb            engine library
         indexer · SqliteFtsStore · loadConfig · validateConfig · counts()
         (imported by everything; neither plugin nor extension)

LAYER 2  packages/kb-extension  @…/pi-dashboard-kb-extension  pi SESSION extension
         kb_search/neighbors/get tools + tool_result reindex hook.
         Runs inside a pi session. Untouched by this change.

LAYER 3  packages/kb-plugin     (NEW)                         DASHBOARD plugin
         client claims (FolderKbSection, KbSettingsPanel, /folder/:cwd/kb route)
         + server routes (/api/kb/stats|reindex|config).
         Runs in the dashboard server + browser. No pi session required.
```

**Decision: scaffold a new `packages/kb-plugin`, do not fold into an existing plugin.**
- No existing dashboard plugin is KB-related (goal / automation / flows / roles / subagents are unrelated domains) — folding in would couple unrelated concerns.
- Layer 3 needs the **dashboard** substrate (server routes + UI slots), which the Layer-2 session extension cannot provide (it dies with the session; a cold worktree has none).
- `kb-plugin` **imports Layer 1** (`loadConfig`, `indexSource`, `counts`, `validateConfig`) and is **independent of Layer 2**. Same package shape as `goal-plugin` / `automation-plugin`: `package.json` `claims` + `src/client` + `src/server`.
- Scaffold via the `dashboard-plugin-scaffold` skill (`packages/dashboard-plugin-skill`).

Extension vs plugin, why it matters here:

| | Layer 2 extension | Layer 3 `kb-plugin` |
|---|---|---|
| runs in | pi session | dashboard server + browser |
| surfaces | agent tools, hooks | UI slots, REST routes |
| live session needed | yes | no (the worktree case) |

## 2. Architecture: why the server owns reindex

```
        ┌──────────────── REJECTED ────────────────┐
        │ Client → in-session extension.reindexNow  │
        │  ✗ needs a live pi session in the cwd     │
        │  ✗ worktree cold-start = no session = no-op│
        └───────────────────────────────────────────┘

        ┌──────────────── CHOSEN ───────────────────┐
        │ Client → dashboard-server route           │
        │        → import @…/pi-dashboard-kb         │
        │        → indexSource(store, source, opts)  │
        │  ✓ works with zero live sessions          │
        │  ✓ same shape as goal/automation plugins  │
        └───────────────────────────────────────────┘
```

The dashboard server already runs as a long-lived Node process and already hosts plugin routes (goal-routes, automation-routes). Adding `kb-routes.ts` that imports the kb package and calls `indexSource` is consistent and needs no pi session.

**Contract with the in-session extension:** both write to the *same* per-cwd db (`loadConfig(cwd).dbAbsPath`). `indexSource` is transactional (`deleteByPath` + upsert per file) and hash-gated (mtime→sha256), so a server reindex and a later in-session reindex converge safely — neither corrupts the other. No lock needed for correctness; the job registry (§4) only prevents wasteful concurrent walks.

## 3. REST surface

```
GET  /api/kb/stats?cwd=<abs>
     → 200 { files, chunks, indexed, staleCount, indexing, jobStatus, lastError }
        indexed    = chunks > 0
        staleCount = count of drifted rows from dox-staleness.json (source files only)
        indexing   = a job is currently running for this cwd (jobStatus === "running")
        jobStatus  = last/current reindex job state: "idle" | "running" | "error"
        lastError  = error string from the last failed job (present iff jobStatus === "error")

POST /api/kb/reindex?cwd=<abs>
     → 202 { jobId, status: "running" }   (job started or already running)
     → 200 { changed, chunks }            (if run synchronously and fast)
     on failure → 500 { error }
```

`jobStatus` / `lastError` are sourced from the §4 job registry, not recomputed. They
let the client distinguish the `error` row state (a *failed* reindex → `Retry`) from the
`not-indexed` state (`chunks: 0`, never run → `Index now`). Without them a folder that
failed its first index would poll back `{ indexing:false, chunks:0 }` and misrender as
`not-indexed`. `jobStatus` resets to `"idle"` once a subsequent job succeeds.

Both resolve the store via `loadConfig(cwd)` → `new SqliteFtsStore(cfg.dbAbsPath)`. `cwd` MUST be validated against known folder cwds (the dashboard already tracks folder descriptors) to avoid arbitrary-path indexing.

## 4. Job registry (indexing state)

A module-level `Map<cwd, { status, startedAt, changed?, chunks?, error? }>` in `kb-routes.ts`:
- `POST /reindex` for a cwd with an in-flight job → returns the existing job (coalesce), does not start a second walk.
- On completion, the entry holds the result for a short TTL so `GET /stats` can report `indexing:false` + last result.
- No cross-process durability needed — reindex is idempotent; a lost job just reruns on next click.

Client polls `GET /stats` (e.g. 1 s) only while `indexing` is true; otherwise fetches once on folder expand + on a `kb_stats_update` broadcast (optional v1.1).

## 5. Client — FolderKbSection

Structural copy of `FolderGoalsSection.tsx`:

```
useKbStats(cwd) → { files, chunks, indexed, staleCount, indexing, reindex() }

render state = derive(stats):
  jobStatus==="error" → "KB · index failed"  [↻ Retry]        (red)
  indexing            → "KB · indexing… N files"  ↻(spin)
  !indexed            → "KB · not indexed"   [Index now]      (teal, prominent)
  staleCount > 0      → "KB · C chunks · S stale"  ↻          (amber flag)
  indexed             → "KB · C chunks"  ↻                    (default)

Derivation is ordered: `error` (from `jobStatus`) wins over `not-indexed`, so a failed
first index shows `Retry`, not `Index now`. `indexing` outranks the count states.
```

- `e.stopPropagation()` on all clicks (matches sibling sections — folder header owns the row click).
- Tooltip on the count = `${files} files · ${chunks} chunks`.
- The `→` arrow (KB detail page) is **out of scope v1**; leave count non-navigational or point at a stub disabled affordance.

Mockup: `openspec/changes/add-kb-folder-slot/mockups/sidebar-kb-slot.html` (all five states rendered side by side).

## 6. Stale count — honest scope

`dox-staleness.json` is written by the kb extension's `acknowledgeRows` / `decideNudge` and tracks **non-md source file** drift against AGENTS.md rows. It does **not** track markdown drift. So `staleCount` in v1 = "source files changed since their AGENTS.md row was acknowledged," surfaced as an amber hint. True md-chunk staleness would require a stat-walk diff against stored `mtimeMs`; deferred. The spec scopes `staleCount` to the dox source and MUST NOT claim md coverage.

## 6b. Path management — the `→` settings page

### Placement: folder-scoped, not the global panel

```
        ┌──────────────── REJECTED ────────────────┐
        │ settings-section slot → GLOBAL panel       │
        │  ✗ KB config is per-cwd; global panel is   │
        │    not folder-aware → needs a folder picker│
        │  ✗ two clicks away from the folder it edits│
        └────────────────────────────────────────────┘

        ┌──────────────── CHOSEN ───────────────────┐
        │ KB folder row `→` → per-folder settings    │
        │  ✓ config IS per-folder → surface is too    │
        │  ✓ reuses the deferred `→` affordance      │
        │  ✓ same overlay-route pattern as the       │
        │    goals board (`/folder/:cwd/...`)         │
        └────────────────────────────────────────────┘
```

The `→` opens a `shell-overlay-route` (or inline panel) at `/folder/:encodedCwd/kb`, mirroring the goals board route. It is a **sources/settings** page, not a search UI.

### What is editable (v1 = paths only)

`sources[]` (add / remove / reorder `priority` / optional `subdir`), `include[]`, `exclude[]`, `dbPath`. Everything else in `KbConfig` (ranking, chunking, rerank, tokenizer, graph, dedup) stays file-edited in v1 — the UI round-trips it untouched so a `PUT` never drops unknown fields.

### Config read/write routes

```
GET  /api/kb/config?cwd=<abs>
     → 200 { config: KbConfig, origin: "project"|"global"|"defaults", projectPath }
        origin tells the UI whether a project file exists (drives the
        "Create project config" / "Copy from parent" affordances)

PUT  /api/kb/config?cwd=<abs>   body: { sources, include, exclude, dbPath }
     → validateConfig(merged) MUST pass BEFORE any disk write
     → write .pi/dashboard/knowledge_base.json (atomic tmp+rename)
     → 200 { config, origin: "project" }   (+ optional reindex kick)
     on invalid → 400 { error }            (no file written)
```

`GET` reuses `loadConfig(cwd)` (already returns `origin`). `PUT` merges the edited path-fields over the current project file (preserving untouched fields), runs the existing `validateConfig` (rejects bad `sources`/`dbPath`/unknown kinds), then writes atomically. `init.ts` already knows how to scaffold a file; `PUT` on a folder with `origin !== project` performs that scaffold first.

### Worktree bootstrap

`origin === "global" | "defaults"` (no project file) ⇒ the panel shows **Create project config** (seed from resolved defaults) and **Copy from parent repo** (read the parent worktree's `knowledge_base.json`, rewrite `sources[]` relative to the worktree cwd, `PUT`). This closes the "worktree indexes nothing because `sources[]` is empty" gap that the folder-slot reindex button alone cannot fix.

### Security — writing `sources[]` = choosing what to index

- `cwd` MUST validate against known folder descriptors (same rule as §3).
- Each `source.ref` is resolved relative to `cwd`; the route SHOULD warn (not hard-block) when a resolved source escapes the folder root (`../`, absolute outside cwd), since KB **reads markdown only, never executes** — risk is disclosure of readable md, not code exec. Decision: warn + allow in v1, spec scenario covers the reject-unknown-cwd hard case.
- `PUT` is validated by `validateConfig`; malformed bodies never reach disk.

## 7. Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Reindex owner | dashboard server | works session-less (worktree cold start) |
| New infra | 2 routes + 1 client section | count + reindex already exist as primitives |
| Concurrency | per-cwd job registry, coalesce | avoid duplicate walks; reindex is idempotent |
| Stale source | `dox-staleness.json` (source files) | free, already tracked; md drift deferred |
| `→` opens | per-folder KB **settings** page | manage `sources`/globs where the config lives |
| Settings placement | folder-scoped behind `→` | KB config is per-cwd; global panel not folder-native |
| Editable fields v1 | `sources`/`include`/`exclude`/`dbPath` only | "paths" is the ask; round-trip the rest untouched |
| Config write | `validateConfig` then atomic write | reuse existing validator; never write invalid |
| Worktree config | Create / Copy-from-parent affordances | fixes empty-`sources[]` worktree indexes-nothing |
| Path safety | validate `cwd` ∈ known folders; warn on escaping source | prevent arbitrary-path indexing; md read-only → warn-not-block |

## 8. Risks

- **Large-repo reindex latency** — first index of a big folder blocks the job; mitigated by `202 + poll` (never blocks the request thread on a long walk) and mtime-gated incremental reruns.
- **Two writers, one db** — server + in-session extension both index the same db. `indexSource` is per-file transactional; worst case is redundant work, not corruption. Documented, no lock in v1.
- **cwd spoofing** — untrusted `cwd` query param → path validation against known folder descriptors is a hard requirement (applies to all four routes), covered by a spec scenario.
- **Config write dropping fields** — a naive `PUT` that replaces the whole file would drop ranking/chunking. Mitigated by merge-over-current-file + full-object round-trip; `validateConfig` guards shape.
- **Source path escape** — a user could point `sources[]` outside the folder. KB is read-only over markdown, so this is a disclosure not exec risk; v1 warns and allows, hard-blocks only unknown `cwd`.
