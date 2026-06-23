# Research & Planning Docs

This directory is the single home for forward-looking research, exploration, and planning documents — work that captures thinking *before* (or alongside) an OpenSpec change, and that is worth keeping after the change is archived.

**What belongs here:** research findings, option evaluations, integration plans, roadmaps, and explore-mode artifacts that outlive the change that spawned them. These are reference documents, not commitments — many describe ideas that may never ship, or that ship in modified form.

**What does not belong here:** the rationale for a single in-flight change. That goes in the change's own `openspec/changes/<name>/design.md`, which is archived with the change. Only promote research to this directory when it is reusable across changes or needs to survive past the archive.

**How to find it from a new session:** this directory is indexed in [`../file-index.md`](../file-index.md) under "Standalone topic docs," so the index-first Investigation Protocol will surface it. When a doc here backs an active change, the change's `proposal.md` should link to it.

## Index

| Document | Summary | Status |
|---|---|---|
| [`electron-app.md`](./electron-app.md) | Comprehensive plan for the Electron desktop wrapper — connection UI, build, packaging, signing. | Plan (partially implemented) |
| [`charts.md`](./charts.md) | Exploration of diagram renderers and inline chart options for the client. | Exploration |
| [`command-palette-future.md`](./command-palette-future.md) | Future slash commands for the command palette. Design-ahead capture; nothing built yet. | Forward-looking design |
| [`hermes-memory-integration.md`](./hermes-memory-integration.md) | Plan to integrate the Hermes memory system. | Research & planning |
| [`honcho-integration-research.md`](./honcho-integration-research.md) | Research into integrating Honcho. | Research / exploration |
| [`openspec-jj-bridge.md`](./openspec-jj-bridge.md) | Design for an OpenSpec ↔ Jujutsu bridge. Live proposal at `openspec/changes/add-openspec-jj-bridge/`. | Explore-mode artifact |
| [`plano-pi-integration.md`](./plano-pi-integration.md) | Plan for Plano AI + pi integration (routing / orchestration). | Research / exploration |
| [`pi-logs-knowledge-graph-training.md`](./pi-logs-knowledge-graph-training.md) | Research on processing pi session logs into a knowledge-graph / neural training pipeline. | Research capture (to be processed) |
| [`worker-offload-roadmap.md`](./worker-offload-roadmap.md) | Roadmap for offloading server work to worker threads (rule-of-three extraction trigger). | Roadmap |

## Adding a document

1. Drop the markdown file in this directory.
2. Add a row to the **Index** table above (title, one-line summary, status).
3. If it backs an active OpenSpec change, link to it from that change's `proposal.md`.
4. No `file-index.md` change is needed — this directory is indexed as a single entry there.
