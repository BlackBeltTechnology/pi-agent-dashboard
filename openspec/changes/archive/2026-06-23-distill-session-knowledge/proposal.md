# distill-session-knowledge

> Supersedes `pi-log-miner-skill` (0/75 tasks, untouched since 2026-04-15). That
> proposal stands up a heavyweight Honcho/Docker/pgvector summarization stack and
> produces per-session *summaries*. This proposal does the opposite: a lean,
> offline miner that *distills* reusable artifacts and routes them into sinks
> already installed here (skill_manage + the memory tool + docs/ indexed by
> context-mode's FTS5 KB). No new infrastructure. See `design.md` → "Relationship
> to pi-log-miner-skill".

## Why

Every pi session under `~/.pi/agent/sessions/<project>/` is a JSONL trace that
already records the things worth keeping — and, critically, an **objective success
signal** (`toolResult.isError`). Today that knowledge dies when the session ends:

- **Faults / tool-usage corrections** — an `isError=true` result followed by a
  retry that flips to `isError=false` is a recorded "wrong way → right way" pair.
- **ask_user decisions** — `toolCall name=ask_user` (the question) + the next
  `toolResult` (the answer) is a recorded human decision.
- **Rules / corrections** — a `user` message that corrects the assistant
  ("no", "actually", "don't", "instead") is human ground truth.
- **Skills / procedures** — a span of >5 tool calls resolving one goal and ending
  in a verified-good state is a candidate reusable procedure.
- **Documentation** — assistant summaries that recur across many sessions are
  candidate docs.

Current research (Voyager, Trace2Skill, Memp, ReMe, Reflexion/RAR, plus the
nibzard/AgentPatterns practitioner patterns) converges on three rules this design
must honor:

1. **Anchor every lesson to a verifiable signal** — self-critique without an
   objective check makes models rationalize failures into false lessons. The
   `isError` flip, "tests pass", and user-confirmation are the anchors.
2. **Distill, don't dump** — raw trajectory chunks retrieved by surface similarity
   degrade and compete for attention; a structured artifact transfers better.
3. **Two-tier synthesis** — single sessions are noisy; value comes from a pass that
   reviews *many* logs and promotes only *recurring* patterns.

context-mode hooks already auto-capture session events in real time, but only
per-session and heuristically — they cannot detect *recurrence across sessions*.
That gap is exactly this miner's reason to exist.

## What Changes

A new pi skill `distill-session-knowledge` under `.pi/skills/`, plus a TypeScript
orchestrator. No dashboard server changes, no Docker, no Honcho.

### Scope (per exploration decisions)
- **Sources**: only this project's session dir
  (`~/.pi/agent/sessions/--Users-robson-Project-pi-agent-dashboard--`).
- **Cadence**: incremental — a watermark records the last-mined session timestamp;
  each run processes only newer sessions.
- **Destinations**: route by artifact class —
  - procedures → `skill_manage` (SKILL.md)
  - durable facts / faults / corrections → `memory` tool
    (`failure` w/ category, `project`, `user`)
  - narrative how-tos → `docs/` (e.g. `faq.md` / topic doc) then `ctx_index` for FTS5.

### Pipeline (see `design.md` for detail)
1. **Harvest** — walk JSONL newer than watermark → normalized trajectory model.
2. **Segment** — split into task episodes (boundaries: user prompt, `session_info`
   name, long time gaps, goal shift).
3. **Detect signals** — classify spans: error-recovery, ask_user decision,
   correction, multi-step procedure.
4. **Anchor on verification** — drop any span that never reached a verified-good
   end (no `isError` flip-to-ok / no user confirmation / no passing check).
5. **Cross-session cluster** — group similar episodes; recurrence ≥ N → promote.
6. **Distill** — write structured artifact with provenance (session id, model,
   date) + confidence + optional expiry.
7. **Dedup & route** — match against existing skills/memory/docs; merge or create;
   route to the correct sink.
8. **Index** — `ctx_index` the doc-class outputs.

### Retire superseded change
- Add a SUPERSEDED banner to `openspec/changes/pi-log-miner-skill/proposal.md`
  pointing here; do not delete it (preserve its design notes for reference).

## Capabilities

### New Capabilities
- `session-trajectory-harvest`: incremental JSONL walk (watermark), normalize
  events (message/toolCall/toolResult/custom) into a trajectory model, segment into
  task episodes.
- `verified-signal-extraction`: detect + anchor the five signal classes on
  objective outcomes (`isError` flip, user correction, passing check).
- `cross-session-distillation`: cluster recurring episodes, distill structured
  artifacts with provenance/confidence/expiry, dedup + route to
  skill_manage / memory / docs+ctx_index.

## Non-Goals
- No Honcho, no Docker, no pgvector, no new server process.
- No real-time / in-session tracking (offline, post-hoc only; complements the
  existing context-mode hooks).
- No cross-project mining (this project's sessions only).
- No dashboard UI surface (CLI / skill-invoked only).
- No automatic write without dedup; routing always reconciles with existing sinks.
