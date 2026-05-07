# File Index — Infrastructure (seed, sandbox, skills)

Covers: `seed/`, `sandbox/`, `.pi/skills/sandbox-designer/`. Read this split when locating an infrastructure file or understanding its responsibilities.

> **Update protocol**: see `AGENTS.md` → "Documentation Update Protocol". Rows included here are ≤ 200 characters for AGENTS.md consumption; full annotations live here.

## Rows

| File | Purpose |
|---|---|
| `seed/active-project/` | Fake workspace: 3 sessions (ask_user waiting, streaming, completed), 2 pinned dirs, flows |
| `seed/empty-workspace/` | Fake workspace: 0 sessions, landing-page state, spawn-cta affordance |
| `seed/error-states/` | Fake workspace: disconnected session card, failed tool calls, error banner |
| `seed/multi-folder/` | Fake workspace: 4 pinned dirs with 2-4 sessions each, folder focus/compaction |
| `seed/openspec-heavy/` | Fake workspace: 3 active OpenSpec changes, 2 archived, attach/detach flow |
| `sandbox/Dockerfile` | Docker image: node:22-bookworm-slim + pi + openspec + dashboard deps |
| `sandbox/docker-compose.yml` | Two-service composition: dashboard (:8000) + headless Chromium (:9222) |
| `sandbox/entrypoint.sh` | Dashboard container entrypoint: start pi-dashboard → poll /api/health → tail logs |
| `.pi/skills/sandbox-designer/SKILL.md` | Vision-capable design agent: before-screenshots + user story → Tailwind HTML mockup |

## Seed workspace format

Each workspace under `seed/` is a self-contained subdirectory:

- `*.jsonl` — Session event files in native pi format (one JSON object per line).
- `*.meta.json` — Session metadata sidecars (cwd, status, model, tokens, cost, attachedProposal).
- `preferences.json` — Pinned directories + per-directory session order.
- `README.md` — Documents covered UI states.

Dashboard server reads these natively — no mock adapter, no fixtures. Format matches real `~/.pi/agent/sessions/` layout.

## Growth via archive-merge

Seed data grows when OpenSpec changes contribute `seed.patch` / `Dockerfile.patch`. Applied by `openspec-archive-change` skill BEFORE `openspec archive` moves the change directory.
