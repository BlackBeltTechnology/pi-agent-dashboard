# Design

## Context

- `frontend-mockup-loop` ships static tooling only: `serve_mockup` is a zero-dep
  `node:http` static server bound to `0.0.0.0`
  (`packages/mockup-loop/src/extension.ts:75`, `:112`), registered at
  `packages/mockup-loop/src/extension.ts:196`. Mocks are hand-built HTML boards.
- Root `mockups/` holds explore-mode mockups; a row ending
  `Pending change: <intent>` in `mockups/AGENTS.md` makes an entry adoptable into
  a change (`openspec/specs/explore-mockup-adoption/spec.md:27`,
  `openspec/config.yaml:27`, `.pi/skills/plan-proposal/SKILL.md` Step 1b).
- Dashboard theme preference defaults to `system` and follows
  `prefers-color-scheme` (`packages/client/src/hooks/useTheme.ts:4`, `:15`, `:28`).
- Dashboard tokens are CSS custom properties in `packages/client/src/index.css`;
  `body` takes `background-color: var(--bg-primary)`
  (`packages/client/src/index.css:361-364`).
- Prototype (explore session), copied into this change at
  `mockups/prototype/` (reference only, not built) —
  `site/{Site.tsx,kit.tsx,main.tsx,site.css}`, `vite.config.ts` (plugin with
  `/__mock/decisions` + `/__mock/decide` middlewares, `virtual:mock-config`),
  `mockup.app.tsx` (project adapter), `decide.mjs` (agent CLI),
  `mocks/2026-11-03-session-pills.mock.tsx`. It is the reference for the shell,
  kit, rings, refs, themes, and token bridge. It does NOT cover multi-root
  discovery, per-mock `decision.json`, duplicate ids, or decision travel on
  adoption (single `mocks/` glob + single `decisions.json`) — those are new here.

## Goals / Non-Goals

**Goals:**
- Real components, real CSS, real `@media` in every mock pane.
- One generic, English-only site reusable by any React + Vite project.
- Page-level accept/reject recorded in git, writable by human (UI) and agent (CLI).
- Stable `#ref` addressing of page / frame / side / ring.
- Mock decision travels with the mock through adoption (`git mv` of one dir).

**Non-Goals:**
- No per-frame decisions (rejected in review: "we reject and accept full pages").
- No i18n / localized labels / configurable vocabulary.
- No production build or hosting of the mock site; dev server only.
- No change to dashboard server, client runtime, or bridge extension.
- Not replacing `serve_mockup` / `score_mockup` / `validate_mockup`; static
  HTML boards stay for no-app and pure-geometry work.
- No store/provider bootstrapping beyond the project's `Providers` hook; mocks use
  prop-driven components.
- Base themes only (dashboard System/Dark/Light via `data-theme`); named dashboard
  themes applied through inline vars (`applyThemeVars`) are out of scope.
  Theme labels are project config, not mock vocabulary.
- Not move-on-approval: accepting never moves files. Approval gates *adoption*
  (D12), which still happens when a proposal is written.

## Decisions

### D1 — Package placement
Generic code lives in `packages/mockup-loop/`:
- `site/` (browser, shipped as source; no `index.html`, see below): `main.tsx`, `Site.tsx`,
  `kit.tsx`, `site.css`.
- `src/mock-site/` (node), **plain ESM JavaScript** (`.mjs`, `// @ts-check` +
  JSDoc types): `plugin.mjs` (`mockSite(options)` Vite plugin), `discover.mjs`,
  `decisions.mjs`, `refs.mjs` (`parseRef`, shared by plugin, CLI, site),
  `cli.mjs` (`#!/usr/bin/env node`, `bin.mock-decide`). Why JS: Vite loads config
  deps from `node_modules` with plain Node, and Node refuses to strip types under
  `node_modules`; the package ships source with no build step
  (`packages/mockup-loop/package.json` `files: ["src/", …]`), so `.ts` here would
  work in the monorepo but break for any installed consumer. The TS extension
  (`src/extension.ts`, loaded by pi's own loader) lazy-`import()`s the `.mjs`
  modules inside `serve_mock_site` only; no mock-site module imports `vite` at
  runtime (types via JSDoc only), so a pi session without Vite still loads the
  extension. `tsconfig` gains `allowJs` + `checkJs` for `src/mock-site/*.mjs`.
- No `exports` map is added (the package has none today; adding one would hide
  every other subpath). Consumers deep-import
  `@blackbelt-technology/frontend-mockup-loop/src/mock-site/plugin.mjs`.
- Vite `root` = the project's `mockups/` dir (project-owned: Tailwind's default
  scan base, Fast Refresh for mocks). `cacheDir` =
  `<projectRoot>/node_modules/.vite-mock-site` (never inside the package, which
  may be a read-only / shared pnpm store). `server.fs.allow` =
  `[siteDir, projectRoot, appRoot]`. `siteDir` resolved via
  `fileURLToPath(new URL("../../site/", import.meta.url))` with a
  `createRequire(projectRoot).resolve` fallback (config bundling may inline the
  plugin).
- The plugin serves the HTML entry itself (middleware for `/` and `/?pane=…`,
  passed through `server.transformIndexHtml`) with
  `<script type="module" src="/@fs/<siteDir>/main.tsx">`; the package ships no
  `index.html` whose path depends on `root`.
- `site/*.tsx` live under `node_modules` for installed consumers:
  `@vitejs/plugin-react` skips `/node_modules/` ids
  (`node_modules/@vitejs/plugin-react/dist/index.js:166-170`), so the shell gets
  no Fast Refresh (full reload on change — shell edits are package-dev only);
  `vite:esbuild` still transforms the `.tsx` (JSX automatic runtime configured by
  plugin-react's config hook). Verified by an install-from-tarball smoke test.
- `resolve.dedupe` += `react`, `react-dom` (prototype did the same); optimizeDeps
  include `react`, `react-dom/client`; `optimizeDeps.entries` =
  `[<siteDir>/main.tsx, ...discovered mock.tsx]` so the dep scan never walks the
  static HTML boards in `mockups/` and finds app deps up front (no mid-session
  re-optimize reloads).
- `site/tsconfig.json` + `site/virtual.d.ts` (`declare module "virtual:mock-site/*"`)
  give the browser side its own type-check (`packages/mockup-loop/tsconfig.json`
  only includes `src`).
- `vite`, `@vitejs/plugin-react`, `react`, `react-dom` = optional peer deps,
  resolved from the host project (the host already has them; the mock must use
  the host's React instance — prototype used `resolve.dedupe`).
- Alternative rejected: separate package (more release surface for ~600 LoC);
  skill-template copy (drifts per project).

### D2 — Project files (per adopting project)
- `mockups/mock-site.config.ts` — Vite config: `export default mockSite({ appRoot,
  title, themes, aliases, app: "./mock-site.app.tsx", port })` plus the project's
  own plugins (React, Tailwind) passed through.
- `mockups/mock-site.css` — project stylesheet: app CSS + Tailwind `@source` lines (D10).
- `mockups/mock-site.app.tsx` — `setup()` (import `mock-site.css`, inject `--mk-*` →
  app token bridge) and `Providers` component. The only app-specific runtime file.
- Import rule for `mock.tsx`: kit via the plugin alias `mock-site/kit`, app code
  via project aliases (dashboard: `@app/*`), never a relative import outside the
  mock dir — so moving the dir (adoption) needs no import rewrite.
- Dashboard bridge maps `--mk-page→--bg-secondary`, `--mk-panel→--bg-primary`,
  `--mk-fg→--text-primary`, `--mk-muted→--text-secondary`, `--mk-line→--border-primary`,
  `--mk-line-2→--border-secondary`, `--mk-accent→--accent-blue`,
  `--mk-bad→--accent-red`, `--mk-ok→--accent-green` (prototype `mockup.app.tsx`).
- `site.css` sets the body colour with `html body` specificity: the app's
  `body { background-color }` (`packages/client/src/index.css:364`) loads later and
  otherwise wins, which made the sticky bar (`--mk-page`) a different hue from the
  page (bug found in prototype review).

### D3 — Mock layout + discovery
- One mock = one directory `<root>/<id>/` with `mock.tsx` (default export `Mock`)
  and optional `decision.json`. `<id>` matches `^\d{4}-\d{2}-\d{2}-[a-z0-9-]+$`
  and equals the directory name (the `Mock.id` field is dropped; dir name is the
  single source of truth).
- Roots: `<projectRoot>/mockups/` and `<projectRoot>/openspec/changes/*/mockups/`,
  `openspec/changes/archive/**` excluded. Duplicate id across roots → plugin
  reports an overlay error naming both paths.
- Discovery runs in node (`discoverMocks(projectRoot)`), and the virtual module
  `virtual:mock-site/mocks` is generated as explicit absolute-path dynamic
  `import()`s of each discovered `mock.tsx` (no `import.meta.glob`: the site root
  is the package dir, so a glob would resolve against the wrong root, and one
  discovery function keeps the archive exclusion in one place). Mock roots are
  watched with `server.watcher.add(<root>)`; a `mock.tsx` add/unlink invalidates
  the virtual module and triggers a full reload.
- `PaneOnly` with a frame index out of range / non-numeric renders an error
  panel naming the spec, never a blank pane.
- Sort: newest id first (date prefix).
- Why a directory, not `<id>.mock.tsx`: adoption moves exactly one entry directly
  under `mockups/`; a file + sidecar pair would split.

### D4 — Decisions
- Shape: `{ "status": "accepted"|"rejected", "by": "user"|"agent", "note"?: string, "at": ISO-8601 }`.
  `open` = file absent (reopen deletes it).
- Page level only. UI: Accept page / Reject page in the sticky bar; Reopen when
  decided; header shows status + `by` + note.
- Agent reject requires a non-empty note (CLI exits non-zero without one); UI
  reject note optional.
- Endpoints (plugin middleware): `GET /__mock/decisions` → map id → decision;
  `POST /__mock/decide {id, status, note?}`. The plugin watches each mock
  **directory** (not files — a not-yet-existing `decision.json` cannot be
  watched) and on `add` / `change` / `unlink` of a `decision.json` pushes
  `mock:decisions` over Vite HMR ws so all tabs refresh (agent CLI edits
  included).
- Writes are atomic: write `.decision.json.tmp-<pid>` (dot-prefixed) then
  `rename`; the temp file is removed on failure, and adoption ignores `.*.tmp-*`.
- Malformed `decision.json` (parse error, unknown `status`) is treated as `open`
  everywhere (site, CLI `list`, adoption) and reported with its path; it never
  throws and never blocks.
- After Accept/Reject the current page stays rendered (header shows the new
  status + Reopen) until the user navigates; deep links into a decided mock open
  it even when `Show accepted / rejected` is off.
- CLI `mock-decide` (package `bin`): `list`, `accept <ref> [note]`,
  `reject <ref> <note>`, `reopen <ref>`; `<ref>` = id, any `#ref`, or full URL;
  reduced to the page id via `parseRef` (URL without a hash → error; `?pane=`
  query ignored). Runs against files directly (no server needed). Project root =
  nearest ancestor of `cwd` containing `mockups/mock-site.config.ts`, else the
  git toplevel (`git rev-parse --show-toplevel`, worktree-aware).

### D5 — Security of the decide endpoint
- Dev server binds `127.0.0.1` by default; `lan: true` binds `0.0.0.0` for
  phone review. Vite's own `server.allowedHosts` default stays on (Vite 6,
  repo has `vite@6.4.3`), blocking DNS-rebinding Host headers.
- **Writes only from loopback**: `POST /__mock/decide` answers 403 unless
  `req.socket.remoteAddress` matches `^127\.`, `::1`, or `^::ffff:127\.` (the
  IPv6 forms only occur when bound to `0.0.0.0` / `::` in LAN mode). LAN clients (phone) can view, not decide — the UI hides the
  buttons when `GET /__mock/decisions` reports `canDecide: false`.
- Method POST only (else 405); `content-type` must start with `application/json`
  (else 415; `; charset=utf-8` allowed); body > 4 KiB → 413; JSON parse error or
  invalid field → 400; `note` limit counted in code points.
- `id` must be a discovered mock id (allow-list — no path built from raw input),
  `status` ∈ {accepted, rejected, open}, `note` ≤ 500 chars.
- `Origin` present and not one of the server's own origins (`http://localhost:<port>`,
  `http://127.0.0.1:<port>`) → 403 (blocks cross-site posts from other local pages).
- LAN mode widens READ access: `/@fs` under `fs.allow` is served to LAN clients
  (Vite's default `fs.deny` only covers `.env*`, certs, `.git`). In LAN mode the
  plugin adds `server.fs.deny` for `**/.pi/**`, `**/*secret*`, `**/*.key`,
  `**/.npmrc`, and the tool result warns that project sources are readable on the
  LAN. Opening the LAN URL on the host itself is view-only too (documented).
- Target `decision.json` (and its dir) is `lstat`-checked: a symlink → 400, never
  followed.

### D6 — Rings
- `Issue` (red) on Current, `Fix` (green) on Proposed; numbers match across sides.
- Badge = absolutely positioned child of the ring (`left/top: -15px`), so it
  scrolls with the element with zero JS (prototype's portal + scroll-listener
  version lagged a frame behind). Sticky bar `z-index` > badge `z-index`, so
  badges slide under the bar.
- Tip = portal into `document.body`, position measured on hover/focus, closed on
  any scroll (cannot drift). Tip > 40 chars → `TIP > 40` badge (authoring lint).
- `block` prop keeps grid/block layout of the wrapped element.
- Inside phone panes (`body.mk-pane-only`, zero padding so the content viewport is
  exactly 375px) the badge sits inside the ring corner (`left/top: 2px`) so the
  iframe edge never clips it.
- Trade-off: the ring adds one wrapper element, which can affect `space-x-*`,
  `>`/`first:` selectors, and flex/grid children; `block` is the mitigation and
  the skill documents it.
- Ring `n` is constrained to `[A-Za-z0-9-]+` (it is a ref segment); an invalid
  `n` renders a visible `BAD N` badge and no ref (authoring lint, like `TIP > 40`).
- Pane containment: `.mk-canvas` gets `contain: layout paint; isolation: isolate`
  so app `position: fixed` / high-`z-index` parts (headers, drawers, dialogs)
  anchor to and stay inside their pane and never cover the sticky bar. Canvas
  padding (16px) ≥ badge offset (15px), so badges at a pane edge are not clipped.
  Components that need the real viewport use a phone frame.
- Portaled app overlays (`createPortal(…, document.body)`, e.g.
  `packages/client/src/components/questions/QuestionStack.tsx:236`,
  `components/session/SessionCard.tsx:1713`) escape pane containment by
  construction. Stacking order is therefore fixed by z-index: sticky bar
  `z-index: 2147483000`, tip `2147483647`; app overlays sit below the bar.
  Mocks needing an open dialog render it inline (or in a phone frame); the
  containment scenario covers non-portaled parts only.

### D7 — References
- Grammar: `<id>` | `<id>/<frame>` | `<id>/<frame>/<side>` | `<id>/<frame>/<side>/<ring>`;
  `<frame>` 1-based, `<side>` ∈ {current, proposed}, `<ring>` = ring `n`.
- DOM id = `r-<ref>`; URL = `<origin><path>#<ref>` (never `?pane=`), opened with
  `target="_top"` so links from inside phone iframes navigate the top page.
- `RefBase` React context carries `<id>/<frame>/<side>` into panes (incl. the
  iframe `PaneOnly` render) so rings derive their ref.
- On hash change: scroll to the deepest existing `r-<prefix>` (ring → side →
  frame), flash `.mk-hit` outline. Page-only ref scrolls to top.
- Rings inside phone iframes: when the deepest top-document match is a phone
  pane, the parent posts `{ mkFind: ref }` to that iframe; the iframe replies
  `{ mkFound: ref, top }` (ring offset in its document) and flashes the ring; the
  parent scrolls to `iframe top + top`. No reply in 500 ms → pane-level scroll.
- All `message` handlers check `event.source` is the expected iframe (parent) or
  `parent` (iframe) and `event.origin === location.origin`.
- Click on a ref copies its URL (clipboard failure ignored) and navigates.
- Visible refs: grey `#ref` after page title and frame title; Current/Proposed
  labels and ring badges are links.

### D8 — Themes
- `themes: Array<{ id, label, attrs?: Record<string,string|null>, system?: { dark, light } }>`;
  first entry default; `system` entry resolves via `prefers-color-scheme` and
  re-applies on change. Choice persisted in `localStorage["mk-theme"]`; phone
  iframes follow via the `storage` event.
- Dashboard: System (default) / Dark (`data-theme` removed) / Light
  (`data-theme="light"`).

### D9 — Phone frames
- `phone: true` → each side is an `<iframe src="?pane=<id>/<frame>/<side>">` whose
  content box is exactly 375px (`box-sizing: content-box`, border outside);
  the iframe renders only that pane (`PaneOnly`) and posts its height to the
  parent (`postMessage {mkPane, h}`), parent sizes the iframe.

### D10 — Tailwind sources (project-owned stylesheet)
- Tailwind v4 resolves `@source` against the directory of the stylesheet that
  holds it, and only stylesheets using Tailwind get a scanner
  (`node_modules/@tailwindcss/vite/dist/index.mjs`); a virtual CSS module has no
  real dir, so it cannot carry `@source` (prototype's `sources.css` proved
  nothing). The app's `index.css` scans only the Vite root plus its listed
  `@source` paths (`packages/client/src/index.css:6-11`).
- So the PROJECT owns a real file `mockups/mock-site.css`: `@import` of the app's
  real CSS, then `@source` lines for the app's component sources and every mock
  root (dashboard: `../packages/client/src`, `.`, `../openspec/changes`).
  `mock-site.app.tsx` `setup()` imports it. The plugin generates no CSS.
- Generic `site.css` is plain CSS (no Tailwind), so it never competes with the
  app's preflight.

### D11 — `serve_mock_site` tool
- Params `{ dir?, port?, lan?, stop? }`; `dir` = project root (default cwd);
  finds `mockups/mock-site.config.ts`; resolves the host's `vite/bin/vite.js`
  from `dir`; spawns `node vite.js --config <cfg> --port <port> --strictPort`;
  `cwd` = `dir`; `lan` passed to the plugin via env `MOCK_SITE_LAN=1` (no `--host`
  flag, so the plugin owns host selection); default port 5299; refuses 8000,
  `PI_DASHBOARD_PORT` when set, and `~/.pi/dashboard/config.json` `port` when
  present; readiness = `GET /__mock/decisions` answers JSON with
  `mockSite: true` (polled, 30 s timeout; not stdout parsing — ANSI), and a child
  `exit` during polling fails the start immediately (so a foreign process on the
  port is never mistaken for the site);
  returns local (+ LAN when `lan`) URL; children kept in their own Map keyed by
  port (separate from `serve_mockup`'s `servers`); `stop` kills it; all children
  are killed on `session_shutdown` and process `exit`. Missing config / vite →
  actionable error text.

### D12 — Skills + adoption
- Generic SKILL.md: new "Live-component mock site" section (layout, kit API, ref
  grammar, accept/reject, CLI, serve tool, "default for React+Vite projects").
- Dashboard adapter: MOCKUP binding points at `mockups/<id>/mock.tsx` +
  `serve_mock_site`; HTML boards only for geometry repros / no-component surfaces.
  A live mock made before its change still gets the `Pending change:` row.
- Adoption (`rules.proposal`, plan-proposal Step 1b): for a marked entry that is
  a live mock dir (has `mock.tsx`), read `decision.json`: `rejected` → not
  offered (reported as skipped); `accepted` → listed first, label suffix
  `(accepted)`; absent → label suffix `(open)`. Non-live entries unchanged.
  `ask_user` has no preselect, so "pre-selected" is realised as order + label.
- The filter and the unit move are code, not prose: `listAdoptable(root)` and
  `moveMockDir(src, changeDir)` in `src/mock-site/discover.mjs`; `rules.proposal`
  and Step 1b tell the agent to run them via `node -e` / the CLI
  (`mock-decide adoptable`), so the mechanics are unit-tested.
- Live mock dirs move as a unit: try `git mv <dir>`; if it fails (untracked
  content) or leaves files behind, `mv` the remaining files / whole dir and
  `git add -A` both paths. Verdict: the source dir must not exist after the move,
  else the move counts as failed (row kept). Explore mocks are often fully
  untracked; `decision.json` usually is.
- Skill text: a rejected mock is either revised and reopened, or deleted with
  its `mockups/AGENTS.md` row (rows of rejected mocks are not auto-removed).
- Default scope: the live site is the default for React projects whose components
  and CSS Vite can process; other stacks keep static HTML boards.

## Risks / Trade-offs

- **Host React / Vite version skew** → peers are optional and resolved from the
  host; the tool reports the resolved Vite version; kit uses only stable React 18+
  APIs (`createContext`, `createPortal`).
- **Discovered mocks import app code that needs stores** → `Providers` hook; mocks
  stay prop-driven; failures surface in the Vite overlay, not silently.
- **Two badge z-layers**: badge under sticky bar is intended; a badge at the
  very top-left of a pane can be clipped by an ancestor with `overflow: hidden` in
  app markup → authors wrap a non-clipped ancestor; documented in SKILL.md.
- **LAN exposure** of a file-writing endpoint → localhost default; writes only
  from loopback; allow-list, Origin, method/type/size checks (D5).
- **Prototype drift** → `mockups/prototype/` is reference only; shipped files are
  re-created at D1/D2 paths and the prototype dir is deleted in the final task, so
  two copies never coexist after merge.
