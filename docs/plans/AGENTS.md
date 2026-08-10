# DOX — docs/plans

Forward-looking plans + explore-mode research notes. Not implemented. One row per file.

| File | Purpose |
|------|---------|
| `charts.md` | Explore session. Add diagram renderers (PlantUML) beyond Mermaid + inline charts from markdown tables. `MarkdownContent.tsx` routes `language-mermaid` \u2192 `MermaidBlock.tsx`; new languages = new branches + renderer. Renderer comparison table. No implementation. |
| `command-palette-future.md` | Aspirational `/` slash-command surface for chat input. Not implemented today. Target commands `/flows`, `/roles`, `Ctrl+A` auto-route. Isolates command-palette UX from Plano routing (`plano-pi-integration.md`). Explains why Tab-completion fails today. |
| `hermes-memory-integration.md` | Integration plan. NousResearch Hermes-Agent 5-layer memory subsystem \u2192 dashboard. 3 features: curated memory (`MEMORY.md`/`USER.md`), session search (FTS5), skill-creation nudges. Scoping global vs directory. Research/planning, 2026-04-01. |
| `iroh-transport-research.md` | Explore-mode note. Evaluate iroh QUIC P2P for bridge \u2194 server \u2194 client comms. Verdict: not worth it now; revisit only Electron remote-mode path. 3-leg topology, no NAT except remote (zrok). 2026-06-25. |
| `plano-pi-integration.md` | Research/exploration. Integrate Plano AI proxy/dataplane with pi. 3 paths (Plano-as-gateway, pi-as-orchestrated-agent, combined). Dashboard as control plane exposing routing/orchestration via `/flows` `/provider` `/roles` `/catalog`. 2026-04-01. |
