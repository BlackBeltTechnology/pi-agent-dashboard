# Honcho Integration Research

**Date:** 2026-04-01
**Status:** Research / Exploration
**Goal:** Evaluate integrating Honcho as a persistent memory layer for pi-agent-dashboard

---

## What is Honcho?

[Honcho](https://honcho.dev/) by Plastic Labs is **memory infrastructure for AI agents**. Unlike simple key-value memory stores, Honcho continuously *reasons* about conversation data using background LLM workers to build rich, evolving representations of users and entities over time.

- **Open source:** [github.com/plastic-labs/honcho](https://github.com/plastic-labs/honcho) (Python/FastAPI)
- **SDKs:** Python (`honcho`) and TypeScript (`honcho-node-core`, Apache 2.0)
- **Hosted option:** `api.honcho.dev` with free tier based on context ingested
- **Self-hosting:** Fully supported via Docker Compose or manual setup
- **Docs:** [docs.honcho.dev](https://docs.honcho.dev)

---

## Core Data Model

Honcho uses a hierarchical data model:

### Workspaces
Top-level isolation containers. Provide complete data separation between applications or environments (dev/staging/prod) or multi-tenant customers. Auth and configuration are scoped at workspace level.

### Peers
The central entity — represents any user, agent, or entity. Honcho builds *representations* (synthesized insights) of each peer across all their sessions. Cross-session context means conclusions drawn in one session inform interactions in completely different sessions. Peers can be configured to control whether Honcho reasons about them.

### Sessions
Interaction threads between peers. Provide temporal boundaries for interactions. Support multiple peers per session. Session-level configuration controls perspective-taking behavior (whether peers form representations of each other).

### Messages
Fundamental units of interaction. Attributed to a specific peer, ordered chronologically. When created, they trigger automatic background reasoning that updates peer representations. Support rich metadata via JSONB fields.

### Conclusions
Facts derived from messages via the reasoning layer. Stored in vector collections for semantic retrieval. Represent what Honcho has *learned* about a peer.

### Representations
Synthesized, queryable profiles built from conclusions. Can be scoped, filtered, and queried via natural language (the Chat endpoint) or structured retrieval (Get Context endpoint).

---

## How Reasoning Works

Honcho's value comes from its background reasoning pipeline:

1. **Message ingestion** — Messages are written to PostgreSQL; reasoning tasks are queued
2. **Deriver** — Background workers extract facts ("observations") from messages, building theory-of-mind representations of peers
3. **Summarizer** — Creates short summaries (every ~20 messages) and long summaries (every ~60 messages) of sessions
4. **Dream processing** — During idle periods, consolidates and refines peer representations (analogous to memory consolidation during sleep)
5. **Dialectic API** — When queried, uses tiered reasoning (5 levels: minimal → max) to answer questions about peers using gathered knowledge

### What Makes LLM Calls (requires API keys)
- Deriver (fact extraction from messages)
- Summarizer (session summaries)
- Dream processing (memory consolidation)
- Dialectic API / Chat endpoint (reasoning queries)
- Embeddings (vector search, if `EMBED_MESSAGES=true`)

### What Runs Locally Without LLM Calls
- Message storage and retrieval
- Session/peer/workspace management
- Webhooks
- All CRUD operations

---

## Self-Hosting Architecture

### Requirements
| Component | Purpose | Required? |
|-----------|---------|-----------|
| PostgreSQL + pgvector | Database + vector embeddings | Yes |
| Python (via `uv`) | Honcho server runtime | Yes |
| LLM API keys | Reasoning layer | Yes (for reasoning features) |
| Redis | Caching | Optional (for high-traffic) |

### Docker Compose Setup (Recommended)
```bash
git clone https://github.com/plastic-labs/honcho.git
cd honcho
cp docker-compose.yml.example docker-compose.yml
# Configure .env with LLM API keys
docker compose up -d
# Server available at http://localhost:8000
```

### Manual Setup
```bash
git clone https://github.com/plastic-labs/honcho.git
cd honcho
uv sync
source .venv/bin/activate

# Set up PostgreSQL with pgvector
# Run migrations: uv run alembic upgrade head
# Start server: fastapi dev src/main.py
```

### Configuration
Honcho uses a flexible config system (TOML + env vars + .env files):

- **`[app]`** — Log level, session limits, embedding settings
- **`[db]`** — Connection URI, pool settings
- **`[auth]`** — JWT auth (can be disabled for local: `AUTH_USE_AUTH=false`)
- **`[cache]`** — Redis caching
- **`[llm]`** — Provider API keys (Anthropic, OpenAI, Gemini, Groq, vLLM, OpenAI-compatible)
- **`[deriver]`** — Background worker settings, theory-of-mind config
- **`[dialectic]`** — Per-level reasoning configuration (5 tiers)
- **`[summary]`** — Summarization frequency and model settings
- **`[dream]`** — Memory consolidation settings
- **`[vector_store]`** — pgvector (default), Turbopuffer, or LanceDB

### Default LLM Provider Usage
- **Google Gemini** — Deriver, summarization, low-tier dialectic reasoning
- **Anthropic Claude** — Medium/high-tier dialectic reasoning, dream processing
- **OpenAI** — Embeddings

All providers are configurable per feature. A `vLLM` option exists for fully local models (air-gapped setup).

---

## TypeScript SDK (`honcho-node-core`)

- **Repo:** [github.com/plastic-labs/honcho-node-core](https://github.com/plastic-labs/honcho-node-core)
- **License:** Apache 2.0
- **Language:** TypeScript

### Basic Usage
```typescript
import { Honcho } from '@honcho-ai/sdk';

const client = new Honcho({
  baseUrl: 'http://localhost:8000',  // Local instance
  apiKey: 'your-api-key'            // If auth enabled
});

// Create/get workspace
const workspace = await client.workspaces.getOrCreate('my-workspace');

// Create/get peer
const peer = await client.workspaces.peers.getOrCreate(workspace.id, 'user-123');

// Create session
const session = await client.workspaces.sessions.getOrCreate(workspace.id, 'session-1');

// Add messages
await client.workspaces.sessions.messages.create(workspace.id, session.id, {
  messages: [
    { peer_id: peer.id, content: 'Hello world' }
  ]
});

// Query peer representation (triggers reasoning)
const response = await client.workspaces.peers.chat(workspace.id, peer.id, {
  query: 'What are this user\'s main interests?'
});

// Get session context for LLM injection
const context = await client.workspaces.sessions.context(workspace.id, session.id, {
  tokens: 4000,
  peer_target: peer.id
});
```

---

## Existing Pi Integration

A **community extension** already exists: [`pi-honcho-memory`](https://github.com/agneym/pi-honcho-memory) by @agneym.

### How It Works
- Hooks into pi's extension system
- Syncs user/assistant messages to Honcho after each agent response
- Injects cached user profile and project context into the system prompt (zero network latency)
- Exposes LLM tools: `honcho_search`, `honcho_chat`, `honcho_remember`
- Session scoping configurable: per repo, per git branch, or per directory
- Graceful degradation: if Honcho is unavailable, pi continues normally

### Installation
```bash
pi install npm:@agney/pi-honcho-memory
# Then run /honcho-setup inside pi, or set HONCHO_API_KEY env var
```

---

## Integration Possibilities for pi-agent-dashboard

### Approach 1: Dashboard as Honcho Viewer (Low-Med Complexity)
Show Honcho representations/conclusions for sessions in the dashboard UI. Read-only visualization of the memory state built from pi sessions.

**What it adds:** Users can see what Honcho has learned about them and their projects across sessions.

### Approach 2: Dashboard-Level Memory (Medium Complexity)
Use Honcho to remember user preferences, common workflows, and project context across dashboard sessions. The dashboard server itself becomes a Honcho client.

**What it adds:** Dashboard remembers user patterns, preferred configurations, common operations.

### Approach 3: Bridge Extension Enhancement (Medium Complexity)
Extend the bridge extension to forward session messages to Honcho, similar to the community extension but built-in to the dashboard.

**What it adds:** First-party memory integration without requiring a separate extension install.

### Approach 4: Cross-Session Context Injection (Medium Complexity)
When starting/resuming sessions, pull Honcho context and inject it. The dashboard already manages session lifecycle.

**What it adds:** New sessions automatically get relevant context from past sessions in the same workspace/project.

### Approach 5: MCP Server Integration (Low Complexity)
Honcho has an [MCP server](https://docs.honcho.dev/v3/guides/integrations/mcp) that could be configured as a tool source for pi sessions managed by the dashboard.

**What it adds:** Memory tools available to agents without any dashboard code changes.

---

## Key API Endpoints

| Endpoint | Purpose |
|----------|---------|
| `GET /health` | Health check |
| `GET /v3/workspaces` | List workspaces |
| `PUT /v3/workspaces/{id}` | Get or create workspace |
| `PUT /v3/workspaces/{id}/peers/{id}` | Get or create peer |
| `PUT /v3/workspaces/{id}/sessions/{id}` | Get or create session |
| `POST /v3/workspaces/{id}/sessions/{id}/messages` | Create messages (batch up to 100) |
| `GET /v3/workspaces/{id}/sessions/{id}/context` | Get formatted context for LLM injection |
| `POST /v3/workspaces/{id}/peers/{id}/chat` | Natural language query about a peer |
| `GET /v3/workspaces/{id}/peers/{id}/representation` | Get peer representation |
| `GET /v3/workspaces/{id}/peers/{id}/card` | Get peer card (stable biographical facts) |
| `GET /v3/workspaces/{id}/peers/{id}/conclusions` | List conclusions about a peer |
| `POST /v3/workspaces/{id}/peers/{id}/conclusions/query` | Semantic search conclusions |
| `GET /v3/workspaces/{id}/sessions/{id}/summaries` | Get session summaries |
| `POST /v3/workspaces/{id}/search` | Search messages across workspace |

---

## Trade-offs & Considerations

### Pros
- **Reasoning, not just storage** — Honcho extracts insights, not just stores messages
- **Cross-session learning** — Knowledge compounds over time
- **Self-hostable** — Full data control, no cloud dependency for core features
- **TypeScript SDK available** — Native integration with the dashboard stack
- **Existing pi community extension** — Proven pattern to build on
- **Flexible LLM providers** — Use any provider, or local models via vLLM

### Cons
- **Infrastructure overhead** — Requires PostgreSQL + pgvector, Python runtime
- **LLM API costs** — Reasoning features consume LLM tokens in the background
- **Background processing latency** — Representations aren't instant; reasoning is async
- **Python dependency** — Honcho server is Python/FastAPI (dashboard is Node/TypeScript)
- **Complexity** — Adds another service to manage alongside the dashboard server
- **Maturity** — Relatively new project, API may evolve (currently v3)

### Fully Local (Air-Gapped) Option
Using vLLM with local models eliminates all external API calls but requires:
- GPU hardware for reasonable performance
- Local model downloads (several GB)
- More complex setup and maintenance

---

## References

- **Honcho Docs:** https://docs.honcho.dev
- **Honcho Docs Index (llms.txt):** https://docs.honcho.dev/llms.txt
- **GitHub (Server):** https://github.com/plastic-labs/honcho
- **GitHub (Node SDK):** https://github.com/plastic-labs/honcho-node-core
- **Self-Hosting Guide:** https://docs.honcho.dev/v3/contributing/self-hosting
- **Configuration Guide:** https://docs.honcho.dev/v3/contributing/configuration
- **Architecture:** https://docs.honcho.dev/v3/documentation/core-concepts/architecture
- **SDK Reference:** https://docs.honcho.dev/v3/documentation/reference/sdk
- **Pi Integration Guide:** https://docs.honcho.dev/v3/guides/community/pi-honcho-memory
- **Community Extension:** https://github.com/agneym/pi-honcho-memory
- **MCP Server:** https://docs.honcho.dev/v3/guides/integrations/mcp
- **OpenAPI Spec:** https://docs.honcho.dev/v3/openapi.json
