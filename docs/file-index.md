# File Index

Per-area maps of every architecturally significant file in pi-agent-dashboard. Loaded on demand — for high-level orientation read `AGENTS.md` (top files only) and `docs/architecture.md` first.

> **Change-history annotations** in entries (e.g. *"See change: foo-bar"*) refer to OpenSpec changes archived under `openspec/changes/archive/`. Read the archived `proposal.md` / `design.md` for full context.

> **Update protocol**: see `AGENTS.md` → "Documentation Update Protocol". Long annotations belong in the appropriate split file below; AGENTS.md rows stay ≤ 200 chars.

## Splits by area

| Area | File | Covers |
|---|---|---|
| Shared types & protocols | [`file-index-shared.md`](./file-index-shared.md) | `src/shared/`, `packages/shared/` |
| Bridge extension | [`file-index-extension.md`](./file-index-extension.md) | `src/extension/`, `packages/extension/` |
| Dashboard server | [`file-index-server.md`](./file-index-server.md) | `src/server/`, `packages/server/` |
| Web client | [`file-index-client.md`](./file-index-client.md) | `src/client/`, `packages/client/` |
| Electron app | [`file-index-electron.md`](./file-index-electron.md) | `packages/electron/` |
| Docker packaging | [`file-index-docker.md`](./file-index-docker.md) | `docker/` |
| Dashboard plugins | [`file-index-plugins.md`](./file-index-plugins.md) | `packages/dashboard-plugin-runtime/`, `packages/{jj,flows,demo}-plugin/` |
| Skills, scripts, CI | [`file-index-skills-misc.md`](./file-index-skills-misc.md) | `.pi/skills/`, `scripts/`, `public/`, `.github/`, misc |

## Standalone topic docs

| File | Covers |
|---|---|
| [`faq.md`](./faq.md) | Recurring how-to questions. Answers point at README.md + docs/ sources. |
| [`chat-display-preferences.md`](./chat-display-preferences.md) | `DisplayPrefs` storage, merge rule, transport, migration, first-launch. See change: configurable-chat-display. |

## Adding a new file

1. Pick the split that matches its path prefix.
2. Add a row in alphabetical-by-path order.
3. Keep the row purpose concise but complete — full annotations and "See change: …" details belong here, NOT in `AGENTS.md`.
4. If a file doesn't fit any existing split (e.g. a brand-new top-level area), add a new split file and link it from the table above.
