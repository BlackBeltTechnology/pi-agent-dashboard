# plano-pi-integration — index

Plan (2026-04-01, research): integrate Plano AI (proxy/dataplane) with pi. Dashboard = unified control plane.

## Overview
- Combine Plano routing/orchestration/guardrails/observability with pi coding agent.
- Dashboard commands `/flows /provider /roles /catalog`, `Ctrl+A` auto-routing map to UI layer.

## What is Plano AI
- Repo katanemo/plano (~6K stars, Rust). Install `uv tool install planoai==0.4.15`. Docs docs.planoai.dev.
- AI-native proxy/dataplane on Envoy+WASM. Core: LLM gateway (OpenAI-compat `/v1/chat/completions`), model routing (model/alias/preference-aligned), agent orchestration, guardrails, observability, context engineering, on-prem.
- Single YAML config. `planoai up`/`down`.
- Routing methods: model-based (`provider/model`), alias-based (`model_aliases`), preference-aligned (Arch-Router 1.5B, self-hostable Ollama/vLLM).
- Agent orchestration: routes to HTTP agents (`/v1/chat/completions`), Plano-Orchestrator 30B-A3B, multi-turn handoffs.

## What is pi
- Repo badlogic/pi-mono. Install `npm i -g @mariozechner/pi-coding-agent`. Docs pi.dev.
- Four modes: interactive, print/JSON, RPC, SDK.
- Extension points: custom providers (`pi.registerProvider()`), `models.json`, SDK (`createAgentSession()`), RPC mode, extensions, skills, 15+ providers.
- Custom provider registration + models.json examples.

## Integration Paths
- Path 1 Plano as LLM Gateway for pi (⭐ low): pi calls proxy. Option A models.json zero-code, Option B extension alias routing, Option C preference-aligned auto-routing (maps `Ctrl+A`).
- Path 2 Pi as Plano-Orchestrated Agent (⭐⭐⭐ medium): wrap pi as HTTP services. SDK wrapper (Fastify, streaming SSE, ports 10510/10520/10530) or RPC wrapper. Plano orchestration config with agent descriptions.
- Path 3 Combined Full Integration (⭐⭐⭐⭐ high): pi agents route through gateway + orchestrator picks agent. Architecture diagram, combined config.

## Plano Routing Capabilities — Deep Dive
- Model-based, alias-based, preference-aligned (Arch-Router-1.5B, infers domain+action, no multimodal/function-calling/system-prompt), agent orchestration (Plano-Orchestrator-30B-A3B, NVIDIA GPU + vLLM).

## Pi Extension Points — Deep Dive
- `pi.registerProvider()` fields: baseUrl, apiKey, api, models[], compat, oauth, streamSimple, headers, authHeader.
- `models.json` `~/.pi/agent/models.json`: providers, baseUrl override, modelOverrides, shell key resolution, reload on picker.
- SDK: tools/extensions/skills/prompts, session mgmt, event streaming, model switch, compaction, steering.
- RPC: JSON-over-stdin/stdout, JSONL events, extension UI subprotocol, language-agnostic.

## Caveats and Limitations
- API feature loss through proxy table: Anthropic caching ❌, extended thinking ⚠️, Responses API ❌, image ✅, streaming ✅, tool calls ✅, cost ⚠️ estimated.
- Recommendation: keep direct provider for cache/thinking, Plano for routing/observability.
- Plano reqs: Python 3.10+, prebuilt binaries, optional Docker, Arch-Router needs Ollama/vLLM, Orchestrator needs GPU.
- Pi HTTP-service limits: fresh session per request, filesystem-scoped tools, memory scales, no rate limiting.

## Recommendation Matrix
- Table by approach/complexity/setup-time/value/best-for. Phased rollout: models.json → extension+auto-route → single agent → full combined.

## Dashboard UI Concepts
- Commands table (`/flows /flows:new /flows:edit /flows:delete /provider /roles /catalog` map to Plano configs). `Ctrl+A` shortcut.
- Views: Provider Panel, Flow Designer, Model Catalog, Role Assignment, Routing Dashboard, Trace Viewer.

## References
- Plano docs/GitHub/quickstart/router/orchestration/config, Arch-Router, Plano-Orchestrator, pi docs (custom-provider.md, sdk.md, rpc.md, models.md, extensions.md).
