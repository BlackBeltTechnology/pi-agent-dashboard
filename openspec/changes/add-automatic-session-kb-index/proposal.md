# Automatically index distilled session knowledge into the searchable KB

> Research basis: `docs/research/lora-dataset-from-pi-logs.md` Parts 7–9. This change
> implements the **automatic** downstream (KB index); the on-demand LoRA export is a
> separate change (`add-lora-dataset-export-skill`).

## Why

`packages/session-distiller` extracts five verified signal classes from pi session
JSONL (fault, correction, decision, procedure, documentation) but routes only **one**
(`documentation`) into a searchable index (`docs/ + ctx_index`). The other four go to
`memory`/`skills`, which are searchable separately but never land in the unified
`packages/kb` FTS5 index next to repo docs. There is no single query surface that
answers "what did I learn / fix / decide across my past sessions."

Indexing (RAG) — not fine-tuning — is the right default for *recall*: cheap, CPU-only,
always-fresh, attributable, and a wrong entry is one row to delete. And it can run
**transparently**: the `kb` sink is the only distiller sink that is pure code (chunk →
FTS5 upsert), so it needs no live agent, unlike the judgment-bearing skill/memory/docs
sinks (which stay agent-gated by design — silent auto-writes there are a footgun).

## What Changes

- **Add `--index-only` headless mode** to `packages/session-distiller/src/main.ts`. It
  runs the existing harvest → segment → extract pipeline but routes to a new `kb` sink
  instead of emitting an agent-executed routing plan. No agent in the loop.
- **Add a `kb` sink** (`route.ts`): every **verified** artifact (all five classes)
  emits a chunked entry into `packages/kb` FTS5 with structured metadata the raw layers
  lose — `signal` type, source `sessionId`, `cwd`, `model`, `confidence`, `verified`,
  and recency. `kb_search` then retrieves distilled session knowledge alongside repo
  docs, filterable by `signal`.
- **Mandatory in-code scrub** in the headless path (no agent to catch leaks): secrets /
  tokens / `auth.json` contents, PII, absolute local paths → normalized, and inline
  base64 `image` blocks dropped. Gate: the index step SHALL refuse to write a chunk that
  fails the secret scan.
- **Decouple the recurrence gate per sink.** Today promotion requires `N≥3` sightings
  (right for skills). For *search*, `index if verified` (low bar); `promote to
  skill/dataset if verified AND recurring` (high bar) stays unchanged.
- **Lifecycle-triggered auto-index** in the dashboard server: subscribe to the session
  lifecycle the server already tracks (`bridge` `agent_end` + `isIdle`, the
  `alive→ended` transition in `reattach-placement.ts`) and fire `--index-only` on
  `LiveIdle` (sustained ≥ `T_idle`) and `Ended`. No new idle heuristic — reuse the
  existing lifecycle. File-mtime sweep is a fallback for no-bridge sessions only.
- **Idempotency via watermark + content hash.** `packages/session-distiller` already
  advances a watermark; `packages/kb` already stores content hashes for staleness.
  Re-indexing a resumed or double-triggered session is a no-op.
- **Subagent-origin sessions excluded by default** (derivative + noisy); an `--include-
  subagents` flag opts in. Origin detected via the bridge subagent guard signal.

## Capabilities

### Added Capabilities

- `session-knowledge-indexing`: a headless, idempotent path that indexes every verified
  distilled session artifact into the `packages/kb` FTS5 store with signal/provenance
  metadata, triggered automatically by session-lifecycle transitions, with mandatory
  secret/PII scrubbing and subagent exclusion.

## Impact

- **Scope**: `packages/session-distiller` (`--index-only` mode, `kb` sink, scrub module,
  decoupled gate) + `packages/kb` (accept externally-provided chunks with metadata) +
  `packages/server` (lifecycle subscriber that spawns the index run). ~250–350 LOC + tests.
- **Runtime**: index runs off the live session's critical path (server-side, on
  transition). CPU-only; no GPU, no model.
- **Data safety**: scrubbing becomes a hard gate in the headless path — a failed secret
  scan blocks the write. This is the primary risk surface and is explicitly tested.
- **User-visible**: `kb_search` returns distilled session knowledge (fixes, decisions,
  procedures) with source-session attribution, filterable by `signal`. No manual step.
- **Out of scope**: the LoRA dataset export (separate change); any change to the
  agent-gated skill/memory/docs sinks; the `--apply` path (untouched).
- **Sequencing**: independent of `add-kb-semantic-annotation-plane` (that enriches
  frontmatter; this indexes session artifacts). Ships before `add-lora-dataset-export-
  skill` — the shared scrub module lands here.

## Discipline Skills

- `security-hardening` — the headless path scrubs secrets/PII/paths from untrusted
  session content with no human in the loop; the scrub gate is the core safety control.
- `performance-optimization` — the corpus is large (≈842 MB across projects); the FTS5
  write path and per-transition trigger must stay off the live session's critical path.
- `observability-instrumentation` — a background auto-index job needs runtime evidence
  (what indexed, when, what was scrubbed/skipped) or "can't tell what happened" bites.
