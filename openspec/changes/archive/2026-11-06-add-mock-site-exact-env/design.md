# Design: add-mock-site-exact-env

## Context

See proposal.md (Why). Current state, with citations:

- **Hand-mirrored environment.**
  - `serve_mock_site` spawns the host's Vite bin on `mockups/mock-site.config.ts`, and
    errors if that file is missing (`packages/mockup-loop/src/mock-site-serve.ts:77-89`).
  - The plugin takes `projectRoot`, `app`, `themes`, `appRoot` and `aliases`
    (`packages/mockup-loop/src/mock-site/plugin.mjs:21-26`).
  - The plugin hardcodes React dedupe and pre-bundling (`plugin.mjs:90-95`).
  - This repo copies the client's aliases by hand (`mockups/mock-site.config.ts:30`).
  - `npm run mocks` is bare `vite --config mockups/mock-site.config.ts`
    (`package.json:125`).
- **Root discovery depends on the config file.** `findProjectRoot` looks for
  `mockups/mock-site.config.ts`, then the git top level
  (`packages/mockup-loop/src/mock-site/cli.mjs:21-31`).
- **Browser decide path.**
  - `/__mock/decide` accepts loopback POSTs (`plugin.mjs:160-190`).
  - `/__mock/decisions` reports `canDecide` (`plugin.mjs:154-157`).
  - The sticky bar renders Accept / Reject / Reopen (`packages/mockup-loop/site/Site.tsx:318-322`).
  - The shared writer already refuses symlinks (`src/mock-site/decisions.mjs:59`) and
    holds `NOTE_MAX = 500` (`decisions.mjs:15`).
  - The CLI calls `writeDecision` without a note-length check or try/catch
    (`cli.mjs:62-69`).
- **Host leakage in the package.**
  - Tool result text says "For canvas(), use the local URL"
    (`packages/mockup-loop/src/extension.ts:249,285`).
  - The serve description and the LAN line mention Accept/Reject
    (`extension.ts:265,285`).
  - The skill names `pi-dashboard-ensure` and "the dashboard's" port
    (`packages/mockup-loop/.pi/skills/frontend-mockup-loop/SKILL.md:191,198`).
  - `forbiddenPorts` reads `~/.pi/dashboard/config.json` (`src/mock-site-serve.ts:23-35`).
- **No behaviour.** `steps` / `play` swap pre-drawn nodes (`site/Site.tsx:13-25`).
- **App boot is project-specific.**
  - The client's `dev` script is bare `vite` (`packages/client/package.json:25`), while
    `build` goes through `scripts/vite-build.mjs`, which calls tsx `register()` first
    (`packages/client/package.json:26`).
  - The client config sets `root: "src"`, a `publicDir` (`packages/client/vite.config.ts:83,87`),
    `server.port: 3000` and `hmr.clientPort: 3000` (`vite.config.ts:182-185`).
- **Convention script ceiling.** `scripts/check-conventions.mjs:16` caps the script at
  five rules.

## Spike evidence (2026-11-06, throwaway: /tmp + untracked cache dir)

| # | Observation | Consequence |
|---|---|---|
| F1 | Bare `vite` on the client config fails: `ERR_MODULE_NOT_FOUND .../shared/src/platform/npm.js`. `--configLoader runner` fails with `__dirname is not defined`. | D1: explicit launcher declaration |
| F3 | Through `scripts/vite-build.mjs`, the client is ready in about 1.1s, and the inheriting config is ready in about 0.95s | D1 |
| F4 | A wrapper config outside the project cannot resolve `vite`. A mock root outside the project cannot resolve the app's `optimizeDeps`. | D2 |
| F6 | The inherited `server.*` sends HMR to `ws://localhost:3000` | D1: drop `server.*` |
| F7 | Vite does not watch a mock root under `node_modules` | D2 + discovery exclusion |
| F8 | The real editor calls host APIs `/api/roles` and `/api/acp/agents`; with no fixture they returned 404 | D3: missing-fixture report |
| F5 | Playwright 1.62.1 wants build 1234; the cache holds 1228 and 1243, so the launch fails | D7 |
| S1 | The real `AutomationBoard` on stateful fixtures from real `run.json` / `automation.yaml`, scripted Run now, Stop, Edit and type cron: **10/10 loops, 0 errors**, about 11s per loop, recorded to webm | D4 is feasible |
| S2 | The same DOM driver and fixture layer on a Vue 3 app: **10/10** | The driver and fixtures are framework-agnostic |
| S3 | The editor sometimes opens in raw-cron mode, so a blind toggle click inverted the state | D4: `unless` / `expect` |
| S4 | The real editor shows the daily cron `20 9 * * *` as weekly Mon 09:00. This is a product bug, routed to `polish-automation-board`. | Real-component mocks surface real bugs |

## Goals / Non-Goals

**Goals:**
- Zero hand-mirrored config, through build-tool and framework adapter seams.
- One fixture layer for HTTP and WebSocket that works for loopback and LAN viewers.
- Scripted, assertable, animated interaction on real components, isolated per pane.
- Decisions written by the CLI only.
- Package text free of host names.

**Non-Goals:**
- Build-tool adapters beyond Vite, and framework adapters beyond React. Only the
  seams and actionable errors ship.
- Booting a real backend, or proxying to a live server.
- Pixel-diffing against a live deployment, which needs auth. Fidelity comes from
  rendering shipped components in the inherited environment.
- Recording WebSocket traffic. WS fixtures are hand-written.

## Decisions

**D1. Launcher and app config: explicit declaration first, then adapter detection.**
- **Declaration.** The project manifest (`package.json` `mockSite: { launcher, config }`)
  wins; both paths are project-relative.
- **Vite adapter detection fallback.** A single `vite.config.*` at the root, or the
  `dev` script's config, with the plain Vite bin as the launcher.
- **This repo declares it explicitly:** `launcher: packages/client/scripts/vite-build.mjs`,
  `config: packages/client/vite.config.ts`. Detection would pick the bare `vite` dev
  script, which F1 shows is broken.
- **Generated config.** It loads the app config (a function export is called with
  `{ command: "serve", mode: "development" }`). It first resolves every root-relative
  setting (`publicDir`, `envDir`, `cacheDir`) against the app config's own `root`.
  For this repo, `publicDir: "../../../public"` against `root: "src"`
  (`packages/client/vite.config.ts:83-87`) gives `<repo>/public`. Only then does it
  strip `server`, `build` and `root`. `publicDir` is served read-only. It then
  `mergeConfig`s the mock-site layer: plugin, mock roots, `fs.allow`, and the framework
  adapter's dedupe and pre-bundling.
- **Launcher safety.** The real paths (symlinks followed) of the launcher and config
  must sit inside the project root. Both are logged on every start.

*Alternatives:*
- Re-run the project's dev script: F1 shows it is fragile.
- The `runner` config loader: breaks CJS globals.
- Storybook's builder: rejected in explore, because it is heavy and loses compare,
  rings and refs.

**D2. Placement.** The generated config is plain `.mjs`, not `.mts` (no TS stripping
under `node_modules`). It is written to `<project>/node_modules/.vite-mock-site/` and
**regenerated on every start**. Mock roots stay `mockups/` and `openspec/changes/*/mockups/`.
Discovery skips anything under `node_modules`. Add/remove reload already comes from
the plugin's watcher (`src/mock-site/plugin.mjs:130-144`). `findProjectRoot` order: the manifest
`mockSite` key, then a `mockups/` dir, then the git top level.

**D3. Fixtures: in-page interception, isolated per pane.** No service worker. Service
workers need a secure context (the LAN URL is plain HTTP), share one scope per origin,
and conflict with HAR routing. Each fixture-backed pane runs in a same-origin iframe
(the existing phone-iframe mechanism, generalised). The iframe installs fetch, XHR and
WebSocket interceptors (the interceptor layer under Mock Service Worker) in its own
window, from a fresh call of the mock's `fixtures()` factory. A request with no handler
is recorded into the page's missing-fixtures panel and answered with 501, unless it
matches the factory's `passthrough` patterns. Capture records HAR with Playwright,
redacts header, cookie, query and JSON-body keys, runs a secret-pattern scan that
refuses the write on a match, and converts the result to `fixtures.har.json`. HTTP only.

*Alternatives:*
- MSW `setupWorker`: fails on the LAN, and has a shared scope.
- A proxy injector: needs a server and breaks same-origin assumptions.

**D4. Script runner.**
- **Steps** are `{ say, target, act, text?, key?, unless?, expect?, timeout? }`.
  A frame adds `script`, `side` (`proposed` by default, `current` or `both`),
  `clockAt` and `loop`.
- **Isolation.** Each driven pane runs in its own iframe (D3), so the clock, fixtures
  and DOM are per pane.
- **Engine.** Testing Library `user-event` (DOM-only, spike S2). Lookup is pane root
  first, then the iframe `document` for portals.
- **Clock.** Fixed start at `clockAt` per loop, then advancing in real time, using a
  fake `Date` with timers resumed. Video is therefore real time with deterministic
  "now".
- **Overlay.** Pointer and caption are a framework-free DOM overlay painted with theme
  tokens, `pointer-events: none`, contained in the pane.
- **Loops** remount the iframe content.
- **Health counters** are posted to the parent so the check command can read them.

**D5. Reduced motion: live paused panes.** One iframe per step, reusing the phone-pane
iframe host (`packages/mockup-loop/site/Site.tsx:185`). Each runs the script silently
(no pointer, no delays) up to step k and stops, so every state is real components, not
a DOM snapshot.

Refs: the site already renders `step-${k + 1}` DOM refs for `steps` frames
(`site/Site.tsx:30`), but the parser knows only `id/frame/side/ring`, with
`RING_RE = /^[A-Za-z0-9-]+$/` (`src/mock-site/refs.mjs:14,40-50`). So `step-<k>`
becomes a distinct parsed segment, and a ring `n` starting with `step-` is rejected as
invalid (MODIFIED "Reference grammar").

**D6. Decisions via CLI only.**
- Delete `/__mock/decide`, `canDecide`, the sticky-bar buttons and their CSS.
- Keep the `/__mock/decisions` read endpoint and the live-refresh event.
- The CLI adds the 500-character note check and wraps `writeDecision` in a one-line
  error exit.
- Legacy `by: "user"` files still render.

**D7. Browser resolution.** On a "browser not installed" error, list the cached
`chromium-*` builds newest first and try `executablePath` for each until one launches.
If all fail, return guidance naming the builds tried. Used by `score_mockup` and video
export.

**D8. Framework adapter.**
- `framework: "react"` is the default. The React adapter owns mounting, `resolve.dedupe`,
  `optimizeDeps.include`, the kit and the `site/` rendering of nodes, moved out of
  `plugin.mjs:90-95`.
- A mock may export `framework`. With no adapter, its page shows the error; other mocks
  are unaffected.
- The DOM driver, fixtures and overlay sit outside the adapter (spike S2).

**D9. Mock options file.** `mockups/mock-site.config.ts` becomes
`export default defineMockSite({ title, themes, app, aliases, launcher?, config? })`,
a plain options object. Plugins are not allowed, so `react` and `tailwind` come only
from the inherited app config, and double registration cannot happen. The file is
optional.

**D10. Host-agnostic package text.**
- Tool strings say "show the URL to the user".
- The existing port guard (`forbiddenPorts`, `src/mock-site-serve.ts:20-35`) stays
  unchanged; it already works. Only the agent-facing error text (`:76`) changes, from
  "reserved for the dashboard" to "reserved".
- The skill drops `pi-dashboard-ensure` in favour of the generic `npx playwright install chromium`.
- The grep for verification covers the whole package, with word list `dashboard`,
  `canvas(`, `pi-dashboard-ensure`. Allowed hits: the `mk-canvas` CSS class, the
  repository URL, and the body of `forbiddenPorts()` (`src/mock-site-serve.ts:22-35`).
- Known hits to rewrite:
  - `examples/2026-11-03-session-pills/mock.tsx:76,112`
  - `references/live-mock-site.md:113,142`
  - `src/mock-site-serve.ts:76` (error text only)
  - the `canvas()` assertions in `src/__tests__/extension.test.ts:107,115`
  - the package `AGENTS.md` rows

**D11. Mock check, standalone; gate wiring deferred.**
- `scripts/check-mockups.mjs --base <rev>` sits next to the conventions script, which
  is at its five-rule ceiling (`scripts/check-conventions.mjs:16`). It reports new
  non-live entries under mock roots: a dated dir without `mock.tsx`, a slug dir, or a
  loose `.html`. Exemptions are `STATIC.md` for a dir and `<name>.STATIC.md` for a
  file. It runs as `npm run check:mockups`.
- Wiring it into ship-it 4.4 changes `ship-it-orchestrator` (the enforcer list at
  `openspec/specs/ship-it-orchestrator/spec.md:167`), `.pi/skills/ship-it/SKILL.md:204`,
  `SKILL.agent.md:44` and the contract test
  (`.pi/skills/ship-it/scripts/__tests__/skill-contract.test.ts:49,294`). That is a
  follow-up change, kept out of this one to bound its scope.
- Compatible with `explore-mockup-adoption` (`openspec/specs/explore-mockup-adoption/spec.md:10-17`):
  that spec still allows `mockups/<name>.html` and governs only its `Pending change:`
  marker row. The check reports new loose `.html` entries as advisory only, and the
  adapter now writes dated directories, which the marker and adoption already cover.

**D13. Surroundings frame.**
- A frame may declare `surroundings`: a render function receiving the content slot,
  built from real app components.
- Both panes render it inside their isolated pane document (D3), with fresh instances
  from the same fixture factory, and only the slot content differs.
- When `surroundings` is absent, both panes render bare content (R1: present in both
  or absent in both).
- A unit test compares the serialised pane DOM outside the slot between Current and
  Proposed.

**D12. Skill and consumer wiring.**
- The workspace `SKILL.md` step 3 becomes normative and adds fidelity R1-R4, scripts,
  the show-with-tools and `#ref` rule, and CLI decisions.
- The dashboard adapter loads the workspace skill path.
- Root `AGENTS.md` gets one routing line.
- `npm run mocks` delegates to the launcher-aware start.

- **Secret patterns (capture).** `Bearer <token>`, JWT (`eyJ…`.`…`.`…`), and the
  prefixes `sk-`, `ghp_`, `gho_`, `github_pat_`, `xox[abprs]-`, `AKIA`, `AIza`.
  Additions come via `--redact` and the options file.

## Risks / Trade-offs

- **[Launcher runs project code]** This is the same trust as the agent running
  `npm run dev`. Mitigations:
  - a project-relative path is required
  - the launcher is logged
  - the site binds to loopback by default

  No interactive confirmation (trade-off: the agent already runs project scripts
  routinely).
- **[Captured traffic holds secrets]** Mitigations:
  - key redaction across headers, query and JSON bodies
  - a pattern scan that refuses the write
  - fixtures are committed, so the refusal is the last guard
- **[BREAKING decide UI removal]** Mitigations:
  - the CLI is unchanged
  - legacy files are still read
  - a CHANGELOG `[Unreleased]` entry
  - shipped with the monorepo release (no single-package publish)
- **[iframe per scripted/fixture pane costs memory]** Mitigation: panes mount lazily
  when scrolled into view.
- **[Script flake]** Mitigations:
  - `expect` / `unless` and bounded waits
  - the check command is used on the example mock in CI
- **[Legacy names]** Some text cannot change in this change and is corrected at
  archive sync:
  - the base spec Purpose ("accept/reject")
  - the pinned scenario names "Accept from the UI" and "Result steers canvas to the
    localhost URL" (`openspec validate` rejects a MODIFIED block that omits an existing scenario name, as observed while drafting this change; their bodies are rewritten)
- **[Optional peers]** The interceptors and `user-event` are lazy-loaded only by
  fixture or script panes.

## Migration Plan

1. Add the adapters and inheritance (D1, D2, D8, D9). Declare `mockSite` in the root
   `package.json`. Shrink this repo's options file.
2. Add the iframe pane host, fixtures and scripts (D3-D5). Update the example mock.
3. Remove the decide UI (D6). Update the e2e spec, unit tests and docs.
4. Browser resolution and host-agnostic text (D7, D10).
5. Mock check and skill wiring (D11, D12).

Rollback: revert the change. `current` / `proposed` / `steps` stay valid throughout.

## Open Questions

- Default loop hold and step pacing constants. These are tunable and don't affect the specs.
