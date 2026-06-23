# Plano AI + pi Integration Plan

> **Date:** 2026-04-01
> **Status:** Research / Exploration
> **Sources:** [planoai.dev](https://planoai.dev/), [pi.dev](https://pi.dev/), [Plano Docs](https://docs.planoai.dev/), pi SDK/RPC/custom-provider docs

---

## Table of Contents

- [Overview](#overview)
- [What is Plano AI](#what-is-plano-ai)
- [What is pi](#what-is-pi)
- [Integration Paths](#integration-paths)
  - [Path 1: Plano as LLM Gateway for pi](#path-1-plano-as-llm-gateway-for-pi)
  - [Path 2: Pi as a Plano-Orchestrated Agent](#path-2-pi-as-a-plano-orchestrated-agent)
  - [Path 3: Combined Full Integration](#path-3-combined-full-integration)
- [Plano Routing Capabilities](#plano-routing-capabilities)
- [Pi Extension Points](#pi-extension-points)
- [Caveats and Limitations](#caveats-and-limitations)
- [Recommendation Matrix](#recommendation-matrix)
- [Dashboard UI Concepts](#dashboard-ui-concepts)

---

## Overview

This document captures research into integrating **Plano AI** (an open-source AI-native proxy and dataplane for agents) with **pi** (a minimal terminal coding agent harness). The goal is to combine Plano's LLM routing, orchestration, guardrails, and observability with pi's extensible coding agent capabilities.

The dashboard (`pi-agent-dashboard`) could serve as the unified control plane, exposing Plano's routing/orchestration features through its existing session management UI. The `/flows`, `/provider`, `/roles`, `/catalog` commands and `Ctrl+A` auto-routing toggle suggest a UI layer for managing these capabilities.

---

## What is Plano AI

**Repository:** [github.com/katanemo/plano](https://github.com/katanemo/plano) (~6K stars, Rust)
**Install:** `uv tool install planoai==0.4.15` or `pip install planoai==0.4.15`
**Docs:** [docs.planoai.dev](https://docs.planoai.dev/)

Plano is delivery infrastructure for agentic apps — an AI-native proxy server and data plane. It handles:

### Core Capabilities

| Feature | Description |
|---------|-------------|
| **LLM Gateway** | OpenAI-compatible proxy (`/v1/chat/completions`) that routes to multiple providers |
| **Model Routing** | Three methods: model-based (direct), alias-based (semantic names), preference-aligned (Arch-Router AI) |
| **Agent Orchestration** | Analyzes prompts and routes to specialized agents via Plano-Orchestrator |
| **Guardrails** | Jailbreak detection, safety policies, centralized security hooks |
| **Observability** | Rich agentic traces across all interactions |
| **Context Engineering** | Reusable filter chains for query rewriting and context enrichment |
| **On-Premises** | Full data control, self-hosted, no cloud dependency |

### Architecture

Plano runs as a local proxy (built on Envoy + WASM plugins). Configuration is via a single YAML file:

```yaml
version: v0.3.0
listeners:
  - type: model
    name: gateway
    address: 0.0.0.0
    port: 12000
model_providers:
  - access_key: $OPENAI_API_KEY
    model: openai/gpt-4o
    default: true
  - access_key: $ANTHROPIC_API_KEY
    model: anthropic/claude-sonnet-4-5
```

Start/stop: `planoai up plano_config.yaml` / `planoai down`

### Routing Methods

1. **Model-based routing** — Direct `provider/model-name` format (e.g., `openai/gpt-4o`)
2. **Alias-based routing** — Semantic names mapped to models:
   ```yaml
   model_aliases:
     fast-model:
       target: gpt-4o
     reasoning-model:
       target: claude-sonnet-4-5
   ```
3. **Preference-aligned routing (Arch-Router)** — A 1.5B model that infers domain + action from the prompt and routes to the best model based on configured preferences:
   ```yaml
   model_providers:
     - model: openai/gpt-4o
       routing_preferences:
         - name: code generation
           description: generating new code snippets and functions
     - model: anthropic/claude-sonnet-4-5
       routing_preferences:
         - name: creative writing
           description: creative content generation and storytelling
   ```
   Self-hostable via Ollama or vLLM.

### Agent Orchestration

Plano can route prompts to specialized HTTP agents:

```yaml
agents:
  - id: coding_agent
    url: http://localhost:10510
  - id: research_agent
    url: http://localhost:10520

listeners:
  - type: agent
    name: my_service
    port: 8001
    router: plano_orchestrator_v1
    agents:
      - id: coding_agent
        description: "Handles code generation, debugging, refactoring..."
      - id: research_agent
        description: "Handles web search, documentation analysis..."
```

Agents must expose `/v1/chat/completions` (OpenAI-compatible). Plano-Orchestrator (30B-A3B model) analyzes user intent and routes accordingly. Supports multi-turn with seamless handoffs.

---

## What is pi

**Repository:** [github.com/badlogic/pi-mono](https://github.com/badlogic/pi-mono)
**Install:** `npm install -g @mariozechner/pi-coding-agent`
**Docs:** [pi.dev](https://pi.dev/)

Pi is a minimal terminal coding harness with four modes: interactive, print/JSON, RPC, and SDK.

### Key Extension Points for Integration

| Feature | How it Helps |
|---------|-------------|
| **Custom Providers** (`pi.registerProvider()`) | Route LLM calls through Plano gateway |
| **`models.json`** | Zero-code provider configuration |
| **SDK** (`createAgentSession()`) | Embed pi in HTTP services for Plano orchestration |
| **RPC Mode** (`pi --mode rpc`) | Subprocess-based integration from any language |
| **Extensions** | Full lifecycle hooks, tools, commands, events |
| **Skills** | On-demand capability packages |
| **15+ built-in providers** | Anthropic, OpenAI, Google, Azure, Bedrock, etc. |

### Custom Provider Registration

Pi supports registering custom providers via extensions:

```typescript
pi.registerProvider("plano", {
  baseUrl: "http://localhost:12000/v1",
  apiKey: "plano",
  api: "openai-completions",
  models: [
    {
      id: "fast-model",
      name: "Plano Fast",
      reasoning: false,
      input: ["text", "image"],
      cost: { input: 2.5, output: 10, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128000,
      maxTokens: 16384
    }
  ]
});
```

Or via `~/.pi/agent/models.json`:

```json
{
  "providers": {
    "plano": {
      "baseUrl": "http://localhost:12000/v1",
      "api": "openai-completions",
      "apiKey": "plano",
      "models": [
        { "id": "openai/gpt-4o", "name": "GPT-4o (via Plano)" },
        { "id": "anthropic/claude-sonnet-4-5", "name": "Claude Sonnet (via Plano)" }
      ]
    }
  }
}
```

### SDK for Wrapping Pi as an HTTP Agent

```typescript
import { createAgentSession, SessionManager, AuthStorage, ModelRegistry } from "@mariozechner/pi-coding-agent";

const { session } = await createAgentSession({
  sessionManager: SessionManager.inMemory(),
  authStorage: AuthStorage.create(),
  modelRegistry: ModelRegistry.create(authStorage),
});

session.subscribe((event) => {
  // Stream events to HTTP response
});

await session.prompt("User's message");
```

---

## Integration Paths

### Path 1: Plano as LLM Gateway for pi

**Complexity:** ⭐ Low | **Value:** Centralized routing, observability, guardrails

Pi sends all LLM calls through Plano's OpenAI-compatible proxy. No changes to pi's core — just configuration.

#### Option A: `models.json` (zero code)

**Pi config** (`~/.pi/agent/models.json`):
```json
{
  "providers": {
    "plano": {
      "baseUrl": "http://localhost:12000/v1",
      "api": "openai-completions",
      "apiKey": "plano",
      "compat": {
        "supportsDeveloperRole": false,
        "supportsReasoningEffort": false,
        "maxTokensField": "max_tokens"
      },
      "models": [
        {
          "id": "openai/gpt-4o",
          "name": "GPT-4o (via Plano)",
          "reasoning": false,
          "input": ["text", "image"],
          "contextWindow": 128000,
          "maxTokens": 16384,
          "cost": { "input": 2.5, "output": 10, "cacheRead": 0, "cacheWrite": 0 }
        },
        {
          "id": "anthropic/claude-sonnet-4-5",
          "name": "Claude Sonnet 4.5 (via Plano)",
          "reasoning": true,
          "input": ["text", "image"],
          "contextWindow": 200000,
          "maxTokens": 16384,
          "cost": { "input": 3, "output": 15, "cacheRead": 0.3, "cacheWrite": 3.75 }
        }
      ]
    }
  }
}
```

**Plano config** (`plano_config.yaml`):
```yaml
version: v0.3.0
listeners:
  - type: model
    name: gateway
    address: 0.0.0.0
    port: 12000
model_providers:
  - access_key: $OPENAI_API_KEY
    model: openai/gpt-4o
    default: true
  - access_key: $ANTHROPIC_API_KEY
    model: anthropic/claude-sonnet-4-5
```

**Usage:** Select "GPT-4o (via Plano)" in pi's `/model` picker. All requests proxy through Plano.

#### Option B: Pi Extension (dynamic, alias routing)

```typescript
// .pi/extensions/plano-gateway.ts
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.registerProvider("plano", {
    baseUrl: "http://localhost:12000/v1",
    apiKey: "plano",
    api: "openai-completions",
    models: [
      {
        id: "fast-model",       // Plano alias → maps to gpt-4o
        name: "Plano Fast",
        reasoning: false,
        input: ["text", "image"],
        cost: { input: 2.5, output: 10, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128000,
        maxTokens: 16384,
        compat: {
          supportsDeveloperRole: false,
          supportsReasoningEffort: false,
          maxTokensField: "max_tokens"
        }
      },
      {
        id: "reasoning-model",  // Plano alias → maps to claude-sonnet-4-5
        name: "Plano Reasoning",
        reasoning: true,
        input: ["text", "image"],
        cost: { input: 3, output: 15, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 200000,
        maxTokens: 16384,
        compat: {
          supportsDeveloperRole: false,
          supportsReasoningEffort: false,
          maxTokensField: "max_tokens"
        }
      }
    ]
  });
}
```

**Plano config with aliases:**
```yaml
version: v0.3.0
listeners:
  - type: model
    name: gateway
    address: 0.0.0.0
    port: 12000
model_providers:
  - access_key: $OPENAI_API_KEY
    model: openai/gpt-4o
    default: true
  - access_key: $ANTHROPIC_API_KEY
    model: anthropic/claude-sonnet-4-5
model_aliases:
  fast-model:
    target: gpt-4o
  reasoning-model:
    target: claude-sonnet-4-5
```

#### Option C: Preference-Aligned Auto-Routing

The most advanced gateway setup — Plano's Arch-Router AI decides which model to use:

```yaml
version: v0.3.0
listeners:
  - type: model
    name: gateway
    address: 0.0.0.0
    port: 12000
model_providers:
  - access_key: $OPENAI_API_KEY
    model: openai/gpt-4o
    default: true
    routing_preferences:
      - name: code generation
        description: generating new code snippets, functions, or boilerplate
      - name: quick tasks
        description: simple questions, summaries, and fast responses
  - access_key: $ANTHROPIC_API_KEY
    model: anthropic/claude-sonnet-4-5
    routing_preferences:
      - name: complex reasoning
        description: deep analysis, debugging, architecture decisions
      - name: creative writing
        description: documentation, explanations, creative content
```

Pi would send requests without specifying a model (or with a catch-all model alias), and Plano's Arch-Router picks the optimal model per request. This maps to the `Ctrl+A` auto-routing toggle concept.

---

### Path 2: Pi as a Plano-Orchestrated Agent

**Complexity:** ⭐⭐⭐ Medium | **Value:** Multi-agent specialization and routing

Wrap pi instances as HTTP services. Plano's orchestrator routes user prompts to the best pi agent.

#### Architecture

```
User → Plano Orchestrator (port 8001)
         ├─→ pi-coding-agent   (port 10510) — Code tasks, full coding tools
         ├─→ pi-research-agent (port 10520) — Web search, doc analysis
         └─→ pi-devops-agent   (port 10530) — Deployment, infra tasks
```

#### Pi Agent HTTP Wrapper (SDK-based)

Each pi agent is a Node.js HTTP service wrapping `createAgentSession()`:

```typescript
// services/pi-coding-service.ts
import Fastify from "fastify";
import {
  createAgentSession,
  SessionManager,
  AuthStorage,
  ModelRegistry,
  codingTools,
} from "@mariozechner/pi-coding-agent";

const app = Fastify();
const authStorage = AuthStorage.create();
const modelRegistry = ModelRegistry.create(authStorage);

app.post("/v1/chat/completions", async (request, reply) => {
  const body = request.body as any;
  const messages = body.messages || [];
  const lastMessage = messages[messages.length - 1]?.content || "";
  const shouldStream = body.stream !== false;

  const { session } = await createAgentSession({
    sessionManager: SessionManager.inMemory(),
    authStorage,
    modelRegistry,
    tools: codingTools,
  });

  if (shouldStream) {
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    });

    session.subscribe((event) => {
      if (event.type === "message_update") {
        const ame = event.assistantMessageEvent;
        if (ame.type === "text_delta") {
          const chunk = {
            id: `chatcmpl-${Date.now()}`,
            object: "chat.completion.chunk",
            choices: [{
              index: 0,
              delta: { content: ame.delta },
              finish_reason: null,
            }],
          };
          reply.raw.write(`data: ${JSON.stringify(chunk)}\n\n`);
        }
      }
      if (event.type === "agent_end") {
        const done = {
          id: `chatcmpl-${Date.now()}`,
          object: "chat.completion.chunk",
          choices: [{
            index: 0,
            delta: {},
            finish_reason: "stop",
          }],
        };
        reply.raw.write(`data: ${JSON.stringify(done)}\n\n`);
        reply.raw.write("data: [DONE]\n\n");
        reply.raw.end();
        session.dispose();
      }
    });

    await session.prompt(lastMessage);
  } else {
    // Non-streaming: collect full response
    let fullText = "";
    session.subscribe((event) => {
      if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
        fullText += event.assistantMessageEvent.delta;
      }
    });

    await session.prompt(lastMessage);
    await session.agent.waitForIdle();

    reply.send({
      id: `chatcmpl-${Date.now()}`,
      object: "chat.completion",
      choices: [{
        index: 0,
        message: { role: "assistant", content: fullText },
        finish_reason: "stop",
      }],
    });
    session.dispose();
  }
});

app.listen({ port: 10510, host: "0.0.0.0" });
console.log("Pi coding agent listening on port 10510");
```

#### Alternative: RPC-based wrapper

For process isolation, wrap pi's RPC mode:

```typescript
// services/pi-rpc-wrapper.ts
import { spawn } from "child_process";
import Fastify from "fastify";

const app = Fastify();

app.post("/v1/chat/completions", async (request, reply) => {
  const body = request.body as any;
  const lastMessage = body.messages[body.messages.length - 1]?.content || "";

  const pi = spawn("pi", ["--mode", "rpc", "--no-session"]);

  reply.raw.writeHead(200, { "Content-Type": "text/event-stream" });

  let buffer = "";
  pi.stdout.on("data", (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.trim()) continue;
      const event = JSON.parse(line);

      if (event.type === "message_update" && event.assistantMessageEvent?.type === "text_delta") {
        const chunk = {
          choices: [{ delta: { content: event.assistantMessageEvent.delta }, index: 0 }]
        };
        reply.raw.write(`data: ${JSON.stringify(chunk)}\n\n`);
      }
      if (event.type === "agent_end") {
        reply.raw.write("data: [DONE]\n\n");
        reply.raw.end();
        pi.kill();
      }
    }
  });

  pi.stdin.write(JSON.stringify({ type: "prompt", message: lastMessage }) + "\n");
});

app.listen({ port: 10510 });
```

#### Plano Orchestration Config

```yaml
version: v0.3.0

agents:
  - id: coding_agent
    url: http://localhost:10510
  - id: research_agent
    url: http://localhost:10520
  - id: devops_agent
    url: http://localhost:10530

model_providers:
  - model: openai/gpt-4o
    access_key: $OPENAI_API_KEY
    default: true

listeners:
  - type: agent
    name: pi_multi_agent
    port: 8001
    router: plano_orchestrator_v1
    agents:
      - id: coding_agent
        description: |
          Pi Coding Agent — a specialized AI coding assistant with full file system access.
          
          Capabilities:
            * Read, write, edit files with precise text replacement
            * Execute bash commands with full shell access
            * Navigate codebases (grep, find, ls)
            * Generate, refactor, and debug code
            * Write and run tests (TDD workflow)
            * Handles requests like "fix this bug", "write a function", "refactor this code"
            * When queries include both coding and non-coding tasks, this agent handles ONLY the coding part

      - id: research_agent
        description: |
          Pi Research Agent — a specialized AI research assistant for documentation and web content.
          
          Capabilities:
            * Search the web for technical information
            * Fetch and analyze web pages and documentation
            * Read local files and documentation
            * Compare libraries and frameworks
            * Handles requests like "find a library for X", "how does Y work", "compare A vs B"
            * When queries include both research and coding tasks, this agent handles ONLY the research part

      - id: devops_agent
        description: |
          Pi DevOps Agent — a specialized AI assistant for deployment and infrastructure.
          
          Capabilities:
            * Execute deployment scripts and commands
            * Manage Docker containers and configurations
            * Configure CI/CD pipelines
            * Monitor system health and logs
            * Handles requests like "deploy to staging", "set up CI", "check server logs"
            * When queries include both devops and other tasks, this agent handles ONLY the devops part

tracing:
  random_sampling: 100
```

---

### Path 3: Combined Full Integration

**Complexity:** ⭐⭐⭐⭐ High | **Value:** Maximum — routing + orchestration + observability

Combines both paths: pi agents route their LLM calls through Plano's gateway, and Plano orchestrates which agent handles each request.

#### Architecture Diagram

```
                         ┌──────────────────────────┐
                         │   Plano LLM Gateway      │
                         │   Port 12000             │
                         │   - Smart model routing   │
                         │   - Guardrails            │
                         │   - Observability traces  │
                         └──────────▲───────────────┘
                                    │ All LLM calls
                    ┌───────────────┼───────────────────┐
                    │               │                   │
              ┌─────┴─────┐  ┌─────┴─────┐  ┌─────────┴───┐
              │ pi-coder  │  │ pi-search │  │ pi-devops   │
              │ :10510    │  │ :10520    │  │ :10530      │
              │           │  │           │  │             │
              │ Tools:    │  │ Tools:    │  │ Tools:      │
              │ read,bash │  │ web_search│  │ bash,ssh    │
              │ edit,write│  │ fetch,read│  │ deploy      │
              └─────▲─────┘  └─────▲────┘  └──────▲──────┘
                    │              │               │
                    └──────────────┼───────────────┘
                                   │ Routes prompts
                    ┌──────────────┴──────────────┐
                    │  Plano Orchestrator          │
                    │  Port 8001                   │
                    │  - Intent analysis           │
                    │  - Agent selection            │
                    │  - Multi-turn handoffs        │
                    └──────────────▲──────────────┘
                                   │
                              User / Dashboard
```

#### Combined Plano Config

```yaml
version: v0.3.0

# Agent definitions
agents:
  - id: coding_agent
    url: http://localhost:10510
  - id: research_agent
    url: http://localhost:10520
  - id: devops_agent
    url: http://localhost:10530

# LLM providers with routing preferences
model_providers:
  - access_key: $OPENAI_API_KEY
    model: openai/gpt-4o
    default: true
    routing_preferences:
      - name: code generation
        description: generating new code, quick tasks, simple edits
      - name: fast analysis
        description: quick summaries, simple questions
  - access_key: $ANTHROPIC_API_KEY
    model: anthropic/claude-sonnet-4-5
    routing_preferences:
      - name: complex reasoning
        description: deep debugging, architecture decisions, complex refactoring
      - name: detailed analysis
        description: thorough code review, documentation writing

# Aliases for explicit model selection from pi
model_aliases:
  fast-model:
    target: gpt-4o
  reasoning-model:
    target: claude-sonnet-4-5

# Listeners
listeners:
  # LLM Gateway (pi agents connect here for LLM calls)
  - type: model
    name: llm_gateway
    address: 0.0.0.0
    port: 12000

  # Agent Orchestrator (users/dashboard connect here)
  - type: agent
    name: pi_orchestrator
    port: 8001
    router: plano_orchestrator_v1
    agents:
      - id: coding_agent
        description: |
          Coding agent with file system access. Code generation, debugging,
          refactoring, testing. Handles "fix this", "write a function", "refactor".
      - id: research_agent
        description: |
          Research agent with web search. Library research, API exploration,
          documentation analysis. Handles "find a library", "how does X work".
      - id: devops_agent
        description: |
          DevOps agent with deployment tools. CI/CD, Docker, monitoring.
          Handles "deploy to staging", "check logs", "set up CI".

# Full tracing
tracing:
  random_sampling: 100
```

Each pi agent's SDK session would use Plano's gateway:

```typescript
// In each pi agent service, configure the model to use Plano gateway
import { getModel } from "@mariozechner/pi-ai";

// Option: Use models.json pointing to Plano, or register programmatically
const authStorage = AuthStorage.create();
authStorage.setRuntimeApiKey("plano", "plano"); // Plano doesn't need a real key

const { session } = await createAgentSession({
  // model configured via models.json to point to localhost:12000
  sessionManager: SessionManager.inMemory(),
  authStorage,
  modelRegistry: ModelRegistry.create(authStorage),
});
```

---

## Plano Routing Capabilities — Deep Dive

### Model-Based Routing
- Direct `provider/model-name` format
- Full control, predictable behavior
- Client specifies exact model: `model: "openai/gpt-4o"`

### Alias-Based Routing
- Semantic names decoupled from providers
- Easy A/B testing and provider switching
- Example: `fast-model` → `gpt-4o`, switch to `gpt-5` later without client changes

### Preference-Aligned Routing (Arch-Router)
- Uses [katanemo/Arch-Router-1.5B](https://huggingface.co/katanemo/Arch-Router-1.5B) model
- Infers **domain** (topic) and **action** (what user wants) from prompt
- Matches against configured routing preferences per model
- Self-hostable via Ollama or vLLM
- Does NOT support: multi-modality, function calling, system prompt dependency
- Best practices:
  - Use noun-centric descriptors
  - Clear, non-overlapping route descriptions
  - Always include a domain route as fallback

### Agent Orchestration (Plano-Orchestrator)
- Uses [Plano-Orchestrator-30B-A3B](https://huggingface.co/collections/katanemo/plano-orchestrator) model
- Analyzes prompts for intent → routes to best agent
- Seamless multi-turn handoffs between agents
- Agents are HTTP services with `/v1/chat/completions`
- Self-hostable via vLLM (requires NVIDIA GPU for production model)
- Agent descriptions are critical for routing quality

---

## Pi Extension Points — Deep Dive

### Custom Provider Registration (`pi.registerProvider()`)

Supports:
- `baseUrl` — API endpoint
- `apiKey` — Key or env var name
- `api` — One of: `openai-completions`, `anthropic-messages`, `openai-responses`, `google-generative-ai`, etc.
- `models[]` — Model definitions with id, name, reasoning, input types, cost, context window, max tokens
- `compat` — Compatibility flags for OpenAI-compatible servers
- `oauth` — Full OAuth/SSO flow integration
- `streamSimple` — Custom streaming implementation for non-standard APIs
- `headers` — Custom request headers
- `authHeader` — Auto-add `Authorization: Bearer` header

### `models.json` Configuration

Located at `~/.pi/agent/models.json`. Supports:
- Adding new providers with models
- Overriding built-in provider baseUrl (proxy routing)
- Per-model overrides via `modelOverrides`
- Shell commands for API key resolution (`"!command"`)
- Reloads on `/model` picker open (no restart needed)

### SDK (`createAgentSession()`)

Full programmatic access:
- Custom tools, extensions, skills, prompts
- Session management (in-memory, persistent, continue-recent)
- Event streaming with typed events
- Model switching, thinking level control
- Compaction control
- Steering and follow-up message queues

### RPC Mode

JSON-over-stdin/stdout protocol:
- All session features available as commands
- Events streamed as JSONL
- Extension UI sub-protocol for dialogs
- Language-agnostic (Python, Go, etc. clients)

---

## Caveats and Limitations

### API Feature Loss Through Plano Proxy

When routing pi's LLM calls through Plano's OpenAI-compatible proxy:

| Feature | Direct pi | Through Plano | Notes |
|---------|----------|---------------|-------|
| Anthropic prompt caching | ✅ | ❌ | Plano uses OpenAI format, no cache headers |
| Extended thinking (Anthropic) | ✅ | ⚠️ Partial | May work via OpenAI compat, untested |
| OpenAI Responses API | ✅ | ❌ | Plano exposes Completions API only |
| Image input | ✅ | ✅ | OpenAI format supported |
| Streaming | ✅ | ✅ | SSE streaming works |
| Tool calls | ✅ | ✅ | OpenAI tool call format |
| Cost tracking | ✅ Accurate | ⚠️ Estimated | Pi tracks usage per model, but Plano may route to different model than requested |

**Recommendation:** For features that require native API access (prompt caching, extended thinking), keep direct provider connections for those models and use Plano for routing/observability on others.

### Plano Requirements

- Python 3.10+ for CLI
- Pre-compiled binaries (Linux x86_64/aarch64, macOS Apple Silicon)
- Optional: Docker for containerized deployment
- Arch-Router self-hosting needs Ollama or vLLM
- Plano-Orchestrator production model needs NVIDIA GPU + vLLM

### Pi Agent as HTTP Service Limitations

- Each `createAgentSession()` creates a fresh agent — no persistent session across requests (would need session pooling)
- Tool execution (bash, file ops) scoped to server's filesystem
- Memory usage scales with concurrent sessions
- No built-in rate limiting or request queuing

---

## Recommendation Matrix

| Approach | Complexity | Setup Time | Value | Best For |
|----------|-----------|-----------|-------|----------|
| **`models.json` gateway** | ⭐ | 5 min | Cost tracking, centralized keys | Solo dev, trying it out |
| **Extension gateway** | ⭐⭐ | 15 min | Alias routing, dynamic config | Teams standardizing access |
| **Auto-routing (Arch-Router)** | ⭐⭐ | 30 min | AI picks best model per request | Cost optimization |
| **Pi as Plano agent (SDK)** | ⭐⭐⭐ | 2-4 hrs | Multi-agent orchestration | Specialized workflows |
| **Pi as Plano agent (RPC)** | ⭐⭐⭐ | 1-2 hrs | Process isolation | Production stability |
| **Full combined** | ⭐⭐⭐⭐ | 1-2 days | Everything above | Production multi-agent |

### Suggested Phased Rollout

1. **Phase 1:** `models.json` gateway — validate Plano works with pi, test routing
2. **Phase 2:** Extension with alias routing + Arch-Router auto-routing
3. **Phase 3:** Single pi agent wrapped as HTTP service for Plano orchestration
4. **Phase 4:** Multiple specialized pi agents with full combined architecture

---

## Dashboard UI Concepts

Based on the command list shown in the session, the dashboard could expose:

### Commands

| Command | Purpose | Maps To |
|---------|---------|---------|
| `/flows` | Manage flows (new, edit, delete) | Plano agent orchestration configs |
| `/flows:new` | Design & run a new flow | Create new Plano orchestration listener |
| `/flows:edit` | Edit an existing flow | Modify agent descriptions, routing |
| `/flows:delete` | Delete a flow | Remove orchestration config |
| `/provider` | Manage LLM providers | Plano `model_providers` config |
| `/roles` | Assign model roles | Plano `model_aliases` + `routing_preferences` |
| `/catalog` | Manage model catalog | Available models across all providers |

### Keyboard Shortcuts

| Shortcut | Purpose | Maps To |
|----------|---------|---------|
| `Ctrl+A` | Toggle auto-routing | Switch between direct model selection and Arch-Router preference-aligned routing |

### Potential Dashboard Views

1. **Provider Panel** — Configure Plano model providers, API keys, routing preferences
2. **Flow Designer** — Visual orchestration config: define agents, descriptions, routing
3. **Model Catalog** — Browse all available models across providers with cost/capability comparison
4. **Role Assignment** — Map semantic roles (fast, reasoning, creative) to specific models
5. **Routing Dashboard** — Live view of how requests are being routed (which model/agent per request)
6. **Trace Viewer** — Plano's observability traces embedded in session view

---

## References

- **Plano Docs:** https://docs.planoai.dev/
- **Plano GitHub:** https://github.com/katanemo/plano
- **Plano Quickstart:** https://docs.planoai.dev/get_started/quickstart
- **Plano LLM Routing:** https://docs.planoai.dev/guides/llm_router.html
- **Plano Orchestration:** https://docs.planoai.dev/guides/orchestration.html
- **Plano Config Reference:** https://docs.planoai.dev/resources/configuration_reference.html
- **Arch-Router Model:** https://huggingface.co/katanemo/Arch-Router-1.5B
- **Plano-Orchestrator:** https://huggingface.co/collections/katanemo/plano-orchestrator
- **Pi Docs:** https://pi.dev/
- **Pi Custom Providers:** docs/custom-provider.md
- **Pi SDK:** docs/sdk.md
- **Pi RPC:** docs/rpc.md
- **Pi Models Config:** docs/models.md
- **Pi Extensions:** docs/extensions.md
