# Proposal: add-mock-site-exact-env

## Why

A mock is only as faithful as the glue its author hand-writes. Today every project
hand-mirrors its build config into `mockups/mock-site.config.ts`, mocks show a bare
component with no surroundings and no behaviour (`steps` are pre-drawn states, never
real clicks), and nothing makes an agent use the live mock site at all. An explore
session produced an off-loop static HTML board for the automation board (now in
`polish-automation-board`) because the installed skill still said "diverge in HTML" and
no rule, check or tool forced the live site. A spike (2026-11-06, findings F1-F8 in
`design.md`) showed the fix is practical with standard tools: inherit the project's
own build shape, feed real-data fixtures through MSW, and script real interactions
with `user-event`: 10/10 clean loops on the real `AutomationBoard`, and the same
driver 10/10 on a Vue app.

## What Changes

- **Environment inheritance (generic, with adapter seams).** The mock site boots
  through the project's own launcher, either declared in the project manifest or
  detected. It inherits the build shape (resolve, plugins, css, define, optimizeDeps,
  static assets) and drops runtime `server.*`. Build-tool and component-framework
  adapters are the seams: Vite and React ship, and others fail with an actionable
  error. `mockups/mock-site.config.ts` becomes an optional options object
  (`defineMockSite`), never a second build config.
- **Fixture layer.** A mock declares a fixture factory for HTTP and WebSocket. It runs
  in an isolated pane document per pane, intercepts in-page (works for LAN viewers
  too), and passes through only allowed patterns. A `mock-capture` command records
  real HTTP traffic, redacts it, refuses on remaining secrets, and converts it to
  fixtures. The page reports unhandled requests as missing fixtures.
- **Scripted interaction.** A frame may declare `script` steps (click, type, clear,
  hover, press, wait). They are driven by `user-event` and carry `unless`/`expect`
  state assertions. The frame gets:
  - isolated panes
  - a visible cursor and step caption
  - a fixed-start clock
  - looping
  - a reduced-motion fallback of live panes paused per step
  - `mock-check` (flake) and `mock-video` (export) commands
- **Fidelity rules (R1-R4).** Current renders today from shipped components. Both
  panes share the same surroundings (an optional app-shell/route frame). Only ringed
  parts may differ. Data uses real shapes.
- **Mock site UX.** The site stays and improves. **BREAKING:** the Accept / Reject /
  Reopen buttons and the browser decide endpoint are removed. Decisions are recorded
  only by the agent through the `mock-decide` CLI; the site shows decision status
  read-only.
- **Skill discipline.** The repo copy of `frontend-mockup-loop` is the source of truth:
  - Live-component mock is the mandatory default. The static-HTML exception narrows
    to geometry repros and projects with no buildable components.
  - Mocks are shown to the user through the package's own tools, and every question
    about a mock carries its `#ref` links.
  - Wording stays host-agnostic: it says "show it to the user" and names no
    host-specific tool.
- **Capture tooling.** When Playwright's pinned build is missing, `score_mockup` and
  video export try the cached Chromium builds instead of failing.
- **Host-agnostic package text.** Tool strings no longer say `canvas()` and the skill
  no longer names a host helper. The port guard becomes a generic reserved-ports list.
- **This repo as a consumer.**
  - Root `AGENTS.md` gains a routing line for mock work to the dashboard adapter skill.
  - The adapter loads the workspace copy of the generic skill.
  - `mockups/mock-site.config.ts` shrinks to inheritance plus overrides.
  - The root `package.json` declares `mockSite` (launcher and app config), and
    `npm run mocks` uses it.
  - A new advisory `scripts/check-mockups.mjs` (the conventions script is at its
    five-rule ceiling) flags new non-live mock entries. A static board must be a
    directory with `STATIC.md`.
- No single-package bump or publish. The npm copy updates with the next monorepo
  release.

## Capabilities

### New Capabilities
- `mockup-site-environment`: Covers:
  - inheriting the project's build shape through its own launcher
  - the build-tool and framework adapter seams
  - the mock options object
  - launcher safety
  - where mock roots may live
  - MSW HTTP/WS fixtures and HAR capture
  - the unhandled-request report
  - the optional app-shell/route frame
- `mockup-site-scripted-interaction`: Covers frame `script` steps, state assertions,
  cursor and caption, fake clock, looping, reduced-motion fallback, and video export.
- `mockup-loop-skill-discipline`: Covers the package's agent-facing rules:
  - live mock as the mandatory default, with a narrow static exception
  - fidelity R1-R4
  - showing mocks through package tools with `#ref` links
  - host-agnostic package text
  - CLI decisions
- `dashboard-mockup-wiring`: Covers this repository as a consumer:
  - the adapter loads the workspace skill
  - no single-package publish
  - the root routing line
  - the advisory mock check

### Modified Capabilities
- `mockup-live-component-site`: Changes six requirements:
  - Discovery excludes dependency dirs and reloads on edits.
  - Frames mount through the framework adapter.
  - The reference grammar gains a `step-<k>` segment on either side, and reserves
    `step-` against ring names.
  - Page-level decisions become read-only in the site, written by the CLI only.
  - The CLI enforces note length and exits cleanly on a refused write.
  - The serve tool launches through the project's launcher with an inherited config
    and host-agnostic text.

  The decide endpoint is removed.
- `mockup-loop-preview-and-capture`: `score_mockup` falls back to an installed
  Chromium build when Playwright's pinned browser is absent.

## Impact

- `packages/mockup-loop/`:
  - `src/mock-site/{plugin,cli,decisions,discover,refs}.mjs`, plus new adapter, fixture
    and script modules
  - `site/` (`Site.tsx`, `site.css`), `src/mock-site-serve.ts`, `src/extension.ts`
  - `package.json` (optional peers; `bin` for `mock-capture`, `mock-check`, `mock-video`)
  - `README.md`, `references/live-mock-site.md`, `.pi/skills/frontend-mockup-loop/SKILL.md`
  - the example mock
  - `src/__tests__/*`
- New optional peers, lazy-loaded: the HTTP/WS interceptor layer,
  `@testing-library/user-event`, `@testing-library/dom`. `playwright` stays optional.
- Tests: `tests/e2e/mock-site/mock-site.spec.ts` (decide-UI flows replaced).
- Repo consumer side:
  - `AGENTS.md` (one routing line)
  - `package.json` (`mockSite`, `mocks` script)
  - `.pi/skills/frontend-mockup-loop-dashboard/SKILL.md`
  - `mockups/mock-site.config.ts`
  - `scripts/check-mockups.mjs` (standalone and advisory; ship-it 4.4 wiring is a
    follow-up change)
  - `CHANGELOG.md`
- Existing mocks under `openspec/changes/*/mockups/` keep rendering, because
  `current`/`proposed`/`steps` stay valid. Any `decision.json` files are still read.
- Follow-up consumer: `polish-automation-board` re-mocks its static draft on the live
  site once this lands.

## Discipline Skills

- `security-hardening`: Three surfaces need it:
  - the site launches the project's own launcher command and serves project sources
    on LAN
  - fixtures and HAR captures may contain secrets or tokens
  - removing the decide endpoint shrinks the write surface
- `doubt-driven-review`: removing the Accept/Reject UI and the decide endpoint is a
  breaking public-API change of a published package.
- `review-code`: a non-trivial multi-module change before commit.
