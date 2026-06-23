> **SUPERSEDED** by `distill-session-knowledge` (2026-06-23). This proposal builds a
> heavyweight Honcho/Docker/pgvector summarization stack (0/75 tasks, untouched since
> 2026-04-15). The successor takes a lean approach — extract verified signals from
> session JSONL and route them into already-installed sinks (skill_manage + memory +
> context-mode FTS5), no new infrastructure. Kept for reference; do not implement.

## Why

Pi conversation logs contain rich institutional knowledge — architectural decisions, debugging insights, failure patterns, subtle side-effects — that is lost once a session ends. There is no way to extract, search, or share this knowledge across sessions or team members.

A skill that mines these logs using a cost-efficient rolling summarization pipeline enables persistent project knowledge that grows over time. By using Haiku-level models with a forked knowledge seed, analysis costs ~$0.02 per session while producing categorized, topic-aware summaries with surprise/contradiction/gap detection.

Honcho provides the memory infrastructure — background reasoning, semantic search, peer representations — while the dashboard server manages the Honcho stack (PostgreSQL + Honcho server) via Docker so there's zero manual setup.

## What Changes

### Skill & Pipeline (standalone, no dashboard dependency for core analysis)
- New pi skill `pi-log-miner` under `.pi/skills/pi-log-miner/`
- TypeScript orchestrator using pi SDK (`createAgentSession`, fork mechanics) — not headless `pi --print`
- **Knowledge seed**: Per-project persisted Haiku session that digests AGENTS.md, architecture docs, specs, AND Honcho's accumulated project representation + conclusions from previous mining runs. Stored at `~/.pi/agent/log-miner/<cwd-hash>/knowledge-seed.jsonl`. Content-hashed for staleness detection; recreated when source docs change or contradictions accumulate.
- **Topic-aware chunking**: JSONL parser groups entries into agent rounds, then a hybrid topic detector (file-cluster changes, time gaps, user prompt keywords, tool pattern shifts) marks topic boundaries. Haiku confirms/refines topic labels during chunk analysis — no separate LLM call for topic detection.
- **Rolling summarization with fork-per-chunk**: For each chunk, fork the knowledge seed session (inherits project context without re-reading files). The fork receives the accumulated rolling summary + new chunk + a structured analysis prompt. It returns JSON with: summary, surprises, contradictions, gaps_filled, decisions, patterns, importance, topic label, and topicChanged flag. The rolling summary is organized by topic sections, with new topics created at detected boundaries.
- **Surprise/contradiction/gap detection**: Three-way comparison of knowledge base (from seed) × rolling summary (accumulated) × new chunk. Surprises = unexpected given project knowledge. Contradictions = conflicts with known architecture (also trigger seed staleness). Gaps = new knowledge not in base docs.
- **Output**: Categorized markdown report at `.pi/memories/session-summaries/<session-id>.md` with topic sections, decision lists, discovery highlights, pattern observations, and a "knowledge for seed update" section when contradictions are found.
- Fork session files are deleted after each chunk by default (no debris).

### Honcho Integration (replaces Shodh)
- **Docker-managed Honcho stack**: The dashboard server detects Docker availability and manages a `pi-dashboard-honcho` Docker Compose stack (PostgreSQL + pgvector + Honcho server). Lifecycle tied to dashboard: auto-start on `pi-dashboard start`, auto-stop on `pi-dashboard stop`. Data persisted in Docker named volumes (`pi-dashboard-honcho-db`). Health-checked before pipeline runs.
- **LLM via pi-model-proxy**: Honcho's background reasoning (deriver, summarizer, dream, dialectic) connects to `pi-model-proxy` (`@blackbelt-technology/pi-model-proxy`) on `localhost:9876` instead of needing its own API keys. The proxy is a pi extension that exposes pi's authenticated models as OpenAI-compatible and Anthropic-compatible endpoints — including OAuth subscription tokens. Honcho's Docker container is configured with `OPENAI_BASE_URL=http://host.docker.internal:9876/v1` so all LLM calls route through the proxy. This means zero API key duplication, and Honcho benefits from whatever models/subscriptions the user has in pi.
- **Two-peer model per workspace**:
  - `project` peer — represents the codebase. Our pipeline writes conclusions about architecture, decisions, patterns, gaps. Honcho's background deriver adds supplemental observations.
  - `developer` peer — represents the human user. If the community `pi-honcho-memory` extension is installed, it already populates this peer in real-time. Our pipeline reads from it (developer patterns/preferences) but doesn't write to it.
- **Workspace** = one per project directory (keyed by cwd)
- **Conclusion categories via metadata**: decisions, discoveries, patterns, gaps, errors — stored as Honcho Conclusions with `category`, `importance`, `topic`, `sessionId` metadata fields. Semantically searchable via `conclusions.query()`.
- **Knowledge feedback loop**: Seed creation queries Honcho for the project peer's representation + top conclusions. Each mining run enriches the next run's knowledge base automatically.
- **Honcho session per analysis**: Each pi session analyzed becomes a Honcho session. Chunk analysis results are stored as messages, so Honcho's built-in summarizer generates meta-summaries for free.
- **Community extension interop**: Shares the same Honcho instance and workspace. Users with `pi-honcho-memory` get richer context (developer peer already populated). Users without it still get full pipeline value.
- **Graceful degradation**: If Docker is unavailable or Honcho fails to start, pipeline works identically but outputs only to `.pi/memories/` as markdown. No semantic search, no knowledge compounding — seed uses only static docs.

### Docker Lifecycle Management
- **Detection**: `docker compose version` check at dashboard startup, cached result
- **Compose file**: Generated at `~/.pi/dashboard/honcho/docker-compose.yml` with PostgreSQL (pgvector) + Honcho server containers. Honcho configured with auth disabled (localhost-only), LLM keys sourced from dashboard config or pi's auth.json.
- **Start**: `docker compose -p pi-dashboard-honcho up -d` during dashboard server startup (non-blocking, background). Health probe on Honcho's `/health` endpoint before marking available.
- **Stop**: `docker compose -p pi-dashboard-honcho stop` during dashboard shutdown. Containers stopped but not removed (fast restart). `pi-dashboard stop` stops everything.
- **Port**: Honcho server on `localhost:8008` (configurable in dashboard config as `honcho.port`). PostgreSQL internal to the compose network (not exposed).
- **Volumes**: `pi-dashboard-honcho-db` named volume for PostgreSQL data. Survives container removal.
- **Config**: New `honcho` section in `~/.pi/dashboard/config.json`:
  ```json
  {
    "honcho": {
      "enabled": true,
      "port": 8008,
      "mode": "docker",
      "externalUrl": null,
      "proxyPort": 9876,
      "liveTrackingDefault": true
    }
  }
  ```
  `mode: "docker"` (managed) or `mode: "external"` (user-managed instance at `externalUrl`). Supports hosted `api.honcho.dev` via external mode too. `proxyPort` points to the pi-model-proxy port (default 9876).
- **pi-model-proxy dependency**: The Docker-managed mode requires `pi-model-proxy` to be installed and running in the active pi session. The dashboard checks proxy health (`GET localhost:9876/health`) before starting Honcho's Docker stack. If the proxy is not available, Honcho starts without reasoning features (CRUD-only, no deriver/summarizer/dream) — the pipeline still works but without Honcho's supplemental background insights.

### Live Automatic Tracking
- **Per-session live tracking toggle**: A toggle switch in the session content-area header enables/disables live knowledge tracking for that session. Default value comes from the global setting `honcho.liveTrackingDefault` (boolean, default false).
- **Event-driven accumulation**: When live tracking is on, the server hooks into `agent_end` events in `event-wiring.ts`. Each completed agent round is accumulated in a per-session buffer.
- **Debounced analysis**: Analysis triggers when: topic changes (heuristic detection), N rounds buffered (default 3), or session goes idle for 30 seconds — whichever comes first.
- **Incremental pipeline**: Same core modules as post-hoc (topic detector, knowledge seed fork, rolling analyzer). The knowledge seed is created once per project and reused across all live sessions.
- **Dual output**: Each analysis batch writes conclusions to Honcho (if available) AND appends to an in-memory rolling summary. On session end (or when tracking is toggled off), the rolling summary is persisted to `.pi/memories/session-summaries/<session-id>.md`.
- **Cost-bounded**: One Haiku fork per batch of rounds (not per turn). A typical 20-round session produces ~4-6 Haiku calls ≈ $0.008.

### Dashboard Integration
- **Summarize button**: Appears on ended session cards (kebab menu) AND active sessions (partial "in-progress" summary). Also in session header actions.
- **Server routes**: `POST /api/session/:id/summarize` (spawns background pipeline, returns taskId), `GET /api/session/:id/summary` (returns status: pending/processing/ready/error, progress, and summary content), `GET /api/honcho/status` (Docker/Honcho health)
- **Progress via WebSocket**: `summary_progress` events (chunk/total/currentTopic) and `summary_complete` event
- **Summary view**: New content-area view showing the markdown summary with collapsible topic sections, colored badges for surprises/contradictions, and a "re-analyze" button when the session has new activity since last summarization
- **Re-analyze badge**: If a session gets more activity after summarization, show staleness indicator
- **Honcho status indicator**: Small indicator in dashboard footer/settings showing Honcho connection state (Docker running / external / offline)
- **Live tracking toggle in session header**: Toggle switch in the content-area session header (next to existing action buttons). Green when active. Per-session override of the global default. State stored in-memory (not persisted — resets to global default on server restart).
- **Live tracking default in Settings**: ToggleField in the Honcho settings section: "Live Knowledge Tracking" on/off. Controls the default state for new sessions.

## Capabilities

### New Capabilities
- `knowledge-seed-management`: Per-project persisted Haiku session creation, content-hash staleness detection, recreation with updated docs + Honcho project representation + top conclusions, storage at `~/.pi/agent/log-miner/<cwd-hash>/`
- `topic-aware-chunking`: JSONL parsing via session-file-reader, agent-round grouping, hybrid topic boundary detection (file clusters, time gaps, keywords, tool patterns), topic label confirmation by Haiku during analysis
- `rolling-summarization-pipeline`: Fork-per-chunk orchestration via pi SDK, three-way comparison (knowledge × rolling summary × chunk), structured JSON extraction (summary, surprises, contradictions, gaps, decisions, patterns), topic-organized rolling summary accumulation, automatic fork cleanup
- `summary-output`: Markdown report generation at `.pi/memories/session-summaries/`, categorized by topic with decisions/discoveries/patterns/surprises sections, seed update recommendations on contradictions
- `honcho-docker-lifecycle`: Docker Compose stack generation, auto-start/stop with dashboard, health probing, named volume persistence, pi-model-proxy connectivity check, `host.docker.internal` routing for LLM calls, port configuration, external mode support
- `honcho-memory-integration`: Two-peer model (project + developer), conclusion storage with category/importance/topic metadata, semantic search via conclusions.query(), peer representation queries, knowledge feedback loop into seed creation, Honcho session per analysis with built-in summarization, community extension interop
- `memory-portability`: Export project knowledge to human-readable markdown in `.pi/memories/`, Honcho conclusions available via API for external tools
- `live-automatic-tracking`: Event-driven per-session accumulator hooked into agent_end events, debounced analysis trigger (topic change / N rounds / idle timeout), incremental rolling summary, dual output to markdown + Honcho, per-session toggle with global default from settings
- `dashboard-summarize-ui`: Summarize button on session cards/header, background pipeline with WebSocket progress, content-area summary view with collapsible topics and re-analyze support, Honcho status indicator, live tracking toggle in session header

### Modified Capabilities
- `dashboard-config`: New `honcho` section in config schema (enabled, port, mode, externalUrl, liveTrackingDefault)
- `dashboard-server-lifecycle`: Docker Compose start/stop integrated into server startup/shutdown hooks

## Impact

- **New dependency**: Docker (for managed Honcho mode). Optional — external mode or graceful degradation without it.
- **New npm dependency**: `@honcho-ai/sdk` for TypeScript client
- **New skill files**: `.pi/skills/pi-log-miner/` with scripts, lib, prompts, and references
- **New dashboard files**: `packages/server/src/honcho-docker.ts` (Docker lifecycle), `packages/server/src/honcho-client.ts` (SDK wrapper), `packages/server/src/routes/summary-routes.ts`, `packages/server/src/routes/honcho-routes.ts`, `packages/server/src/summary-pipeline.ts`, `packages/client/src/components/SummaryView.tsx`, `packages/client/src/components/SummarizeButton.tsx`, `packages/shared/src/summary-types.ts`
- **New generated files**: `~/.pi/dashboard/honcho/docker-compose.yml`
- **Docker resources**: Two containers (PostgreSQL + Honcho), one named volume, ~500MB disk for images
- **pi-model-proxy dependency**: `@blackbelt-technology/pi-model-proxy` must be installed as a pi package for Honcho's reasoning features. Install via `pi install npm:@blackbelt-technology/pi-model-proxy`. Without it, Honcho runs in CRUD-only mode (storage works, reasoning disabled).
- **Pi sessions directory**: Read-only access to `~/.pi/agent/sessions/` for log processing
- **Storage**: `~/.pi/agent/log-miner/` for knowledge seeds, `.pi/memories/` for summary outputs, Docker volume for PostgreSQL data
- **API usage**: Knowledge seed creation ~$0.001 (one-time per project, recreated on doc changes). Per-session analysis ~$0.02 (Haiku, ~20 fork calls at ~4.5K tokens each). Fork session files cleaned up automatically. Honcho's background reasoning uses LLM tokens routed through pi-model-proxy — costs depend on which models Honcho is configured to use (configurable in Honcho's TOML config, defaults to Gemini for deriver/summarizer, Anthropic for dialectic). All calls go through the user's existing pi subscriptions/API keys.
- **Dashboard server**: New REST routes + WebSocket event types. Docker lifecycle hooks in server startup/shutdown. New config section.
- **No changes** to existing bridge extension, session sync, or event forwarding code
