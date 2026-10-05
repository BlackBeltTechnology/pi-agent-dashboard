## Why

`set-copilot`'s live wall is a board that a meeting copilot fills while people talk. The board shows decisions, open questions, alerts, figures and graphs. Producers append to `<runtimeDir>/wall-events.jsonl`, and the wall tails it (`set-copilot@32b6a7d` `src/wall/event-source.ts`). Operator typing goes back through `<runtimeDir>/wall-input.jsonl` (`src/wall/input.ts`, read by `src/poll.ts:188`).

The earlier plan for this change ran upstream's own wall page in a child process behind `/live/<id>/`. That made it an operator-only tool:
- anyone reaching it needed dashboard network access plus an 8-character id;
- it needed two upstream patches (relative URLs and an input gate);
- it skipped CSP and loaded cytoscape/dagre from `unpkg.com`;
- it wrote live-server rows and left orphan processes after a crash.

The audience is actually **a room screen and meeting participants on their own devices**. Participants have no dashboard account, and only some of them should be able to type to the copilot. Decided 2026-10-04/05: the wall becomes our own app, **served by the dashboard**:
- embedded in the dashboard as a folder app, like the OpenSpec board;
- standalone at `/apps/wall/` for share links and projectors.

Mockups and UX plan: `mockups/` (see `mockups/ui-plan.md`).

## What Changes

- **Package `packages/voice-wall-plugin`** (server and client entries, `defaultEnabled: false`).
- **Vendored upstream, used in-process.**
  - Vendor `set-copilot@32b6a7d`'s wall server modules and the pure client modules (`wall-core.mjs`, `text-format.mjs`), SHA pinned in `NOTICE`.
  - Each meeting's wall is a vendored `WallServer` on `127.0.0.1:0` inside the dashboard process, built from a pure read of `set-copilot.config.json`.
  - Config comes from upstream `loadConfig` run inside a `process.env` snapshot that is restored exactly, so no `.env` value stays in the dashboard. `runWall`, `wall.categoriesModule` (project code), the upstream page and its CDN scripts are **not** used.
  - No child process and no live-server rows. One named vendored patch (`proxy-secret.patch`) closes upstream's unauthenticated loopback input and media endpoints.
- **Plugin routes per audience** under `/api/plugins/voice-wall/`.
  - The plugin proxies upstream's SSE stream, bootstrap, transcript and media, and **forces the wall window by caller**.
  - Share-link viewers get a public-audience window, so upstream withholds private-zone events (`src/wall/server.ts:884` `payloadFor`).
  - Operators get any window.
  - Transcript visibility is a meeting-level policy (members, viewers), off by default.
  - Media is served by the plugin, limited per meeting and audience to files referenced by delivered public events, with a sandboxing CSP.
- **Share links.** The owner mints a per-meeting, read-only, revocable token that expires with the meeting at the latest. It is shown with a QR code. The token travels in the URL fragment and is sent as a header. Viewers are admitted through the new core capability-route seam (`add-plugin-capability-routes`).
- **Typing.** `POST …/m/:id/input` requires a principal (`ctx.requestPrincipal`) that is the owner, the local operator, or on the meeting's allow-list. Being allowed to type grants no extra viewing scope.
  - The text is validated (upstream `normalizeWallInput`, 400 characters) and rate-limited.
  - It is appended to `wall-input.jsonl`, prefixed with the sender's display name.
  - This replaces the earlier draft's per-project `wallInput.allowedProjects` switch.
- **Wall app** (`src/app/`):
  - one React app;
  - **embedded** through `add-plugin-app-host`: folder entry `● Live wall →`, folder-menu items, pages `/folder/:encodedCwd/wall` and `/wall/:meetingId` in the content area;
  - **standalone** at `/apps/wall/` (`ctx.serveApp` with `appId: "wall"`, enforced strict CSP).
  - Views: board, graph (cytoscape + dagre bundled), transcript, figures, presentation mode, input bar. The UI follows the mockups.
- **No-meeting state.** `/folder/<cwd>/wall` shows "No live meeting", *Start meeting…*, and a read-only replay of the last meeting's wall from the archived `.wall.jsonl` file. The replay is for operators only.
- **Service `voice-wall` v2**: `ensureWall`, `stopWall` (with `archiveTo`; the plugin copies the events file after the wall stops), `status`, `appendEvent`, `scratchRoot`. A pure `./emit` subpath export is provided for producers.

## Capabilities

### New Capabilities
- `voice-wall-server`: package scaffold, vendoring scope, in-process wall hosts, service v2, `./emit`, teardown, runtime-dir confinement, replay host.
- `voice-wall-access`: audience-forcing proxy routes, share links, authenticated input, media and transcript scope, CSP and text-only rendering.
- `voice-wall-app`: standalone mount, embedded folder app (slot, menu, routes), views, presentation mode, participant states, no-meeting state.

### Modified Capabilities
(none — net-new package; the earlier draft's `voice-wall-exposure` capability is replaced by `voice-wall-access` before ever shipping)

## Discipline Skills

- **`security-hardening`**: anonymous viewers on the dashboard origin, share tokens, a write path into a tool-capable pi session, model-generated content rendered same-origin, media serving.
- **`doubt-driven-review`**: in-process `WallServer` (the crash surface lives in the dashboard process) and audience forcing are load-bearing. Review before they stand.
- **`observability-instrumentation`**: wall host start and stop, share mint, revoke and expiry, input accept and reject, and viewer-stream counts must each be diagnosable from `server.log`.
- **`performance-optimization`**: the app library must stay in the plugin's lazy chunk; measure the dashboard's initial bundle before and after. Also check the SSE fan-out per meeting.
- **`review-code`**: before commit.

## Impact

- New package `packages/voice-wall-plugin/` (server, client, app builds). Follow `add-new-plugin-package-checklist`; `pnpm-workspace.yaml` already globs `packages/*`. Registrations: `packages/server/package.json#piDashboard.bundledPlugins` (Electron, capability trust), Tailwind `@source` in `packages/client/src/index.css`, `ROUTE_TIERS` and MCP denylist rows for every route, app build in `npm run build`.
- New runtime deps: `cytoscape`, `dagre`, `cytoscape-dagre` (bundled into the app), `qrcode` (QR in the share dialog). No CDN.
- **Depends on (land first):**
  - `extract-standalone-app-kit`;
  - `add-plugin-app-host` (`AppHost`, `<EmbeddedApp>`, `presentation: "content"`);
  - `add-plugin-capability-routes` (capability prefix, `requestPrincipal`, `serveApp`).
- **Consumers:** `add-voice-assistant-dashboard-plugin`.
  - It calls `ensureWall`/`stopWall` (the signatures change: meeting id, owner, `archiveTo`).
  - It links to `/folder/<cwd>/wall`.
  - It passes `docs/meetings/<date>-<slug>.wall.jsonl` as `archiveTo` instead of copying the file itself.
  - Its own `wall-input` gating becomes defence in depth, because only authorized input reaches the file.
- Rollback: disable the plugin. Walls stop, share links die, and nothing persists except the last-replay pointer in plugin config.
