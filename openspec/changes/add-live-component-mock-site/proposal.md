# Proposal

## Why

Mockups today are hand-built static HTML boards (`serve_mockup` serves a folder of
`.html`). They drift from the real app: copied markup, re-derived tokens, no real
`@media` rules, no real component states. Review is also unstructured — the
human says "looks good" in chat and nothing records which mock was accepted or
rejected, or which element a comment refers to.

A prototype (built in an explore session, copied to `mockups/prototype/` in this change, modelled on
the invoice-bot dashboard's mock site) proved a better loop: render the **real
app components** in Current / Proposed frames, circle the elements that change
with numbered rings, decide **per page** with Accept / Reject (from the UI or
from the agent), and address any part by a stable `#ref` link. This change ships
that loop as a generic, English-only feature of `frontend-mockup-loop`, with the
dashboard as first adopter.

## What Changes

- **Generic live-component mock site** shipped in
  `@blackbelt-technology/frontend-mockup-loop` under `packages/mockup-loop/site/`:
  shell (`Site.tsx`), kit (`kit.tsx`: `Mock`, `Frame`, `Issue`, `Fix`,
  `RefLink`), styles (`site.css`, generic `--mk-*` tokens only), and a Vite
  plugin `mockSite(options)` that discovers mocks, serves decisions, and
  generates the Tailwind `@source` list. English only; no app names; no i18n.
- **Mock layout**: one directory per mock, `mockups/<id>/mock.tsx` +
  `mockups/<id>/decision.json`, `<id>` = `<yyyy-mm-dd>-<slug>`. Discovered under
  root `mockups/` and `openspec/changes/*/mockups/` (archive excluded), so a mock
  keeps working after it is adopted into a change.
- **Frames**: Current | Proposed (or New) panes of real components; `phone: true`
  renders each side in a real 375px iframe so the app's `@media` rules apply.
- **Rings**: `<Issue n tip>` (red, Current) / `<Fix n tip>` (green, Proposed)
  wrap any element; the number badge is a child of the ring (scrolls natively,
  no JS tracking, sits under the sticky bar); the hover tip lives in a body layer;
  tips > 40 chars show a `TIP > 40` badge.
- **Page-level decisions**: Accept page / Reject page / Reopen in the sticky top
  bar; decisions are per mock page (never per frame). Written to the mock's
  `decision.json` as `{ status, by: "user"|"agent", note?, at }`; reject from the
  agent requires a note. Only open mocks are listed unless "Show accepted /
  rejected" is ticked. Agent CLI `mock-decide list|accept|reject|reopen <ref>`
  writes the same file; open tabs refresh live.
- **References**: every part is addressable — `#<id>`, `#<id>/<frame>`,
  `#<id>/<frame>/<side>`, `#<id>/<frame>/<side>/<ring>`. Clicking a ref copies
  its URL; opening one scrolls to the deepest existing part and flashes it. The
  CLI accepts any ref or full URL.
- **Themes**: project-configured list; first entry default; `system` follows
  `prefers-color-scheme` live (the dashboard's own default).
- **Serve tool**: new `serve_mock_site{dir?, port?, lan?, stop?}` tool starts the
  project's Vite on the project's mock-site config on an isolated port (never
  8000), localhost-only unless `lan: true`; in LAN mode only loopback clients may
  decide (phones view only).
- **Skills**: generic `frontend-mockup-loop` SKILL.md gains a "Live-component
  mock site" section and makes it the default mock path for React projects
  (static HTML boards remain for no-app / pure-geometry work); dashboard adapter
  `frontend-mockup-loop-dashboard` binds it to `mockups/mock-site.config.ts` +
  `mockups/mock-site.app.tsx`.
- **Dashboard adoption**: `mockups/mock-site.config.ts` (app root, aliases,
  themes System/Dark/Light, title), `mockups/mock-site.app.tsx` (real
  `packages/client/src/index.css` + `--mk-*` → dashboard token bridge), and the
  first example mock `mockups/2026-11-03-session-pills/` (from the prototype).
- Mockup: mockups/prototype (in this change) — explore prototype, reference only.
- **Adoption gate**: plan-proposal Step 1b / `rules.proposal` adoption reads
  each live mock's `decision.json`: accepted → offered first, labelled
  `(accepted)`; open → offered, labelled `(open)`; rejected → never offered.

## Capabilities

### New Capabilities
- `mockup-live-component-site`: generic live-component mock site — mock
  discovery, frames, rings, page-level accept/reject (UI + CLI), `#ref`
  addressing, themes, serve tool, and decision persistence.

### Modified Capabilities
- `explore-mockup-adoption`: adoption offer filters and labels live-component
  mocks by their `decision.json` status (rejected never offered); live mock dirs
  move as a unit incl. untracked files.
- `plan-proposal-orchestrator`: Step 1b offers only rows offerable under that
  decision filter.

## Impact

- `packages/mockup-loop/`: new `site/` dir (shipped via `files`), new
  `src/mock-site/*.mjs` (plain ESM JS — plugin, discovery, decisions store, CLI;
  no build step, no `exports` map), new tool in
  `src/extension.ts`, `bin` entry `mock-decide`, optional peers `vite`,
  `@vitejs/plugin-react`, `react`, `react-dom` (resolved from the host project).
- `packages/mockup-loop/.pi/skills/frontend-mockup-loop/SKILL.md`,
  `.pi/skills/frontend-mockup-loop-dashboard/SKILL.md`,
  `.pi/skills/plan-proposal/SKILL.md` (Step 1b label/filter), `openspec/config.yaml`
  `rules.proposal` text.
- Root `mockups/`: new config/app files + example mock + AGENTS.md rows.
- No runtime change to the dashboard server, client, or extension.

## Discipline Skills

- `security-hardening` — the decide endpoint writes files from HTTP input
  (id allow-list, status enum, body cap, localhost default).
- `doubt-driven-review` — the public kit API (`Issue`/`Fix`/`Frame` props, mock
  directory layout, `#ref` grammar) is a published-package contract.
- `review-code` — before commit.
