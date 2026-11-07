# Live-component mock site

Reference for `frontend-mockup-loop` step 3 (MOCKUP). The site renders a
project's **real components** in Current | Proposed frames, inside the app's own
build environment, circles the elements that change with numbered rings, drives
real interactions with scripts over network fixtures, and shows the page-level
decision the agent recorded with `mock-decide`. English only; nothing in it is
app-specific. See changes: add-live-component-mock-site, add-mock-site-exact-env.

## Project setup (once per project)

Install the package **in the project** (the site loads it from the project's
`node_modules`; `pi install` alone only gives pi the tools):

```bash
npm i -D @blackbelt-technology/frontend-mockup-loop
```

**Environment = the app's own build config.** The site starts through the
project's launcher and inherits the app config's build shape (resolve / aliases,
plugins, css, define, optimizeDeps, the static asset dir served read-only). It
drops dev-server runtime (`server.*`: port, HMR, proxies), `build` and `root`
(root-relative settings are resolved first). Nothing is copied by hand.

- Declared (wins): `package.json` → `"mockSite": { "launcher": "scripts/dev.mjs", "config": "app/vite.config.ts" }`.
  Use it when the app needs a loader (e.g. tsx) before Vite, or the config is
  not at the root. Both paths are project-relative; a real path outside the
  project (symlinks followed) is refused.
- Detected: a root `vite.config.*` (or `vite --config X` in `scripts.dev`) with
  the project's Vite bin as launcher.
- Adapters: build tool **vite**, framework **react**. Others fail with the
  reason, the supported adapters and the next step.
- The generated config is rewritten on every start at
  `node_modules/.vite-mock-site/mock-site.config.<hash>.mjs`.

```
package.json            optional "mockSite": { launcher, config }
mockups/
  mock-site.config.ts   optional OPTIONS (never a build config)
  mock-site.app.tsx     setup() (import mock-site.css, map --mk-* tokens) + Providers
  mock-site.css         @import your app CSS + @source lines (app sources, mock roots)
  tsconfig.json         optional: paths for your aliases + "mock-site/kit"
  2026-11-03-<slug>/
    mock.tsx            one mock page (default export: Mock)
    fixtures.har.json   optional, written by mock-capture
    decision.json       written by mock-decide (absent = open)
```

`mock-site.config.ts` (optional; without it: default themes, no setup module):

```ts
import path from "node:path";
import { defineMockSite } from "@blackbelt-technology/frontend-mockup-loop/src/mock-site/options.mjs";

export default defineMockSite({
  title: "My mocks",
  app: "./mock-site.app.tsx",
  // first = default; "system" follows prefers-color-scheme
  themes: [
    { id: "system", label: "System", system: { dark: "dark", light: "light" } },
    { id: "dark", label: "Dark", attrs: { "data-theme": "dark" } },
    { id: "light", label: "Light", attrs: { "data-theme": "light" } },
  ],
  aliases: { "@app": path.resolve(__dirname, "../src") }, // only aliases the app config lacks
  redact: ["x-tenant"],                                   // extra keys mock-capture redacts
});
```

Keys: `title`, `themes`, `app`, `aliases`, `launcher`, `config`, `redact`. A
build key (`plugins`, `resolve`, `server`, …) is refused: "mock options are not
a build config". `package.json` `mockSite` wins over `launcher` / `config` here.

`mock-site.css` must be a real file: Tailwind resolves `@source` against the
file that holds it.

```css
@import "../src/index.css";
@source "../src";
@source ".";
@source "../openspec/changes";
```

`mock-site.app.tsx` maps the generic chrome tokens onto yours: `--mk-page`,
`--mk-panel`, `--mk-fg`, `--mk-muted`, `--mk-faint`, `--mk-line`, `--mk-line-2`,
`--mk-hover`, `--mk-accent`, `--mk-bad`, `--mk-ok`, `--mk-bad-text`, `--mk-ok-text`.

## Writing a mock

```tsx
import { Fix, Issue, Tap, type Mock } from "mock-site/kit";
import { SessionCard } from "@app/components/SessionCard";

const mock: Mock = {
  title: "Sessions page - missing folder",   // key word first
  category: "Sessions",
  change: "my-change",                        // optional
  frames: [
    { title: "Sessions page - desktop", width: 1040,
      current: <Issue n={1} tip="Two pills compete"><SessionCard {...today} /></Issue>,
      proposed: <Fix n={1} tip="One pill wins"><SessionCard {...next} /></Fix> },
    { title: "Sessions page - phone", phone: true, current: <Page v="c" />, proposed: <Page v="p" /> },
  ],
};
export default mock;
```

- One mock = one PAGE or flow. Directory name = id = `yyyy-mm-dd-slug`.
- Import the kit as `mock-site/kit` and app code through aliases. Never use a
  relative import that leaves the mock dir: the dir moves when it is adopted
  into a change.
- `Issue` (red) on Current, `Fix` (green) on Proposed, same `n` on both sides.
  `n` is `[A-Za-z0-9-]+`. A tip over 40 characters shows `TIP > 40`; a bad `n`
  shows `BAD N`. Add `block` to keep a block / grid cell's layout.
- A frame without `current` shows one pane labelled `New`.
- `phone: true` renders each side in a real 375px iframe, so `@media` rules apply.
- Keep mocks prop-driven; wrap app context in `Providers` if a component needs it.
- `why`: one-line reason per frame (≤ 120 chars, else `WHY > 120`). Shown under
  the frame title and in the page overview (one card per frame, top of page).
- **State changes are drawn, never clicked.** Use `steps` instead of
  `current`/`proposed` for a flow: side by side by default (`3a`, `3b`, …, each
  linkable as `#<id>/<n>/proposed/step-<k>`), `play: true` animates them in one
  pane (reduced motion falls back to side by side). Wrap the element whose click
  leads to the next step in `<Tap>`. Ring numbers stay unique across the steps.
  `steps` with `current`/`proposed` is reported; steps win.

  ```tsx
  { title: "Re-link flow", why: "Each state is drawn.", steps: [
      { label: "folder gone", proposed: <Banner action={<Tap><Btn>Re-link</Btn></Tap>} /> },
      { label: "re-linked",   proposed: <Row relinked /> },
  ] }
  ```
- `phone: true` with `steps`: each step renders in its own 375px iframe.
- Start from the example (in the package's source repo only, not in the npm package):
  copy `packages/mockup-loop/examples/2026-11-03-session-pills/mock.tsx` to
  `mockups/<yyyy-mm-dd-slug>/mock.tsx`. `examples/` is not a mock root, so the
  example is never listed by default; a site with no mocks shows "No mocks yet".

## Fixtures (network)

A mock (or one frame) may declare `fixtures`: a factory called once per pane and
per script loop, so state never leaks between panes or loops. Fixture-backed
panes run in their own same-origin document (mounted when scrolled near) whose
fetch / XHR / WebSocket are intercepted in-page (no service worker: works on the
plain-HTTP LAN URL too). Optional peers: `@mswjs/interceptors`.

```tsx
const fixtures = (): Fixtures => {
  let runs = [{ id: 1, status: "done" }];
  return {
    http: {
      "GET /api/runs": () => runs,                                 // JSON 200
      "POST /api/runs": (r) => { runs = [...runs, r.json()]; return { ok: true }; },
      "GET /api/runs/:id": (r) => runs.find((x) => String(x.id) === r.params.id),
    },
    ws: { "/ws/feed": (s) => { s.send({ type: "hello" }); s.onMessage((m) => s.send(m)); } },
    har,                         // import har from "./fixtures.har.json" (mock-capture)
    passthrough: ["cdn.example"],
  };
};
```

- Handlers return a `Response` or a JSON value. HAR entries answer after `http`.
- An unanswered request gets **501** and is listed per page under
  **Missing fixtures** (`GET /api/roles` + the pane ref). Nothing reaches the
  network unless `passthrough` allows it.
- `mock-capture <url> <mockDir> [--redact key]... [--out file]` records a
  running app's HTTP traffic (Playwright HAR), redacts authorization / cookie /
  password / secret / token / api-key / session keys (headers, cookies, query,
  JSON bodies; plus `--redact` and the options' `redact`), then **refuses to
  write** if a bearer token, JWT, `sk-`, `ghp_` / `gho_` / `github_pat_`,
  `xox?-`, `AKIA` or `AIza` value survives, naming the entry and JSON path.
  WebSocket traffic is never captured: write WS fixtures by hand.

## Surroundings

`surroundings: (slot) => <AppShell route="/sessions">{slot}</AppShell>` renders
the same real shell around both panes; only the slot differs (fidelity R1).

## Scripts (behaviour)

```tsx
{ title: "Edit cron", fixtures, clockAt: "2026-01-01T12:00:00Z",
  proposed: <AutomationBoard />,
  script: [
    { say: "Open the editor", target: "edit-btn", act: "click" },
    { say: "Raw mode", target: "raw-toggle", act: "click", unless: "raw-input" },
    { say: "Type the cron", target: "raw-input", act: "type", text: "0 17 * * *",
      expect: (d) => d.querySelector("input")?.value === "0 17 * * *" },
  ] }
```

- `act`: `click` | `type` | `clear` | `hover` | `press` (`key`) | `wait`.
  `target`: a test id (tried first) or a CSS selector; portals are found too.
- Each step waits up to `timeout` (default 4000 ms) for its target. `unless`
  (selector or check) skips the step when it already holds; `expect` must hold
  after the act. A failure stops the pane at that step and shows
  `Step n/N "say" failed: …` with the selector.
- `side`: `proposed` (default) | `current` | `both`. `script` wins over `steps`
  (both set = reported problem).
- Clock: starts at `clockAt` (default: page load) on every loop, then real time,
  so "18m ago" reads the same each loop. Loops remount with fresh fixtures, hold,
  repeat; **Pause** under the pane; `loop: false` stops at the end. The pane
  label shows completed / failed loop counts.
- A pointer moves to each target before acting and a caption shows `n/N say`;
  both live inside the pane and ignore pointer events.
- Reduced motion: no animation; one live pane per step, paused after it, as
  `#<id>/<frame>/<side>/step-<k>`.
- `mock-check <ref> [--loops N] [--url U]` runs a frame headlessly against a
  running site (default 3 loops) and exits non-zero on any failed loop.
  `mock-video <ref> [--out f.webm]` records one loop; default
  `node_modules/.vite-mock-site/videos/` (never a mock dir), path printed.
- Playwright's pinned Chromium missing → the cached builds are tried newest
  first; none launches → `npx playwright install chromium`.

## References

| Ref | Points at |
|---|---|
| `#<id>` | the page |
| `#<id>/<frame>` | frame (1-based) |
| `#<id>/<frame>/current` / `proposed` | one side |
| `#<id>/<frame>/<side>/<n>` | one ring, phone frames included |
| `#<id>/<frame>/<side>/step-<k>` | step k (`steps` cards; a script step pane under reduced motion) |

A ring `n` never starts with `step-` (shown as `BAD N`).

Clicking a ref (page/frame `#ref`, side label, ring badge) copies its URL.
Opening one scrolls to the deepest existing part and flashes it. Quote refs when
discussing a mock: "reject `#2026-11-03-x/1/proposed/2`: label too long".

## Deciding

- The site is read-only: it shows `open`, `accepted by <by>` or `rejected by <by>`
  with the note, and offers no decision control.
- The agent records the user's verdict (or its own scored review):
  `mock-decide list`, `mock-decide accept <ref> [note]`,
  `mock-decide reject <ref> "why"` (a reason is required),
  `mock-decide reopen <ref>`. `<ref>` may be an id, any `#ref`, or a full URL.
  A note over 500 characters, an unknown id or a refused write (symlink) exits
  non-zero with one line and writes nothing.
- `decision.json` = `{ status: "accepted"|"rejected", by: "agent", note?, at }`
  (legacy `by: "user"` files are still read). Open tabs refresh live. Only open
  mocks are listed unless "Show accepted / rejected".

## Serving

`serve_mock_site{}` → `http://localhost:5299` (reserved ports are refused).
Show the URL to the user. `npm run`-style foreground start:
`node node_modules/@blackbelt-technology/frontend-mockup-loop/src/mock-site/serve-cli.mjs --port 5299`.
LAN mode relies on Vite's `server.fs.deny`; the package's optional `vite` peer
range (`>=5.4.21 <6 || >=6.4.1` minus 6.4.4, `7.0.8+`, `7.1.11+`) excludes the versions with
known deny bypasses, and LAN mode refuses to start on one (fail closed).
`serve_mock_site{lan:true}` adds a LAN URL for phones (view-only); project
sources are readable on the LAN while it runs.
`serve_mock_site{stop:true, port}` stops it.

## Adoption into a change

A mock made before its change exists gets a `mockups/AGENTS.md` row ending
`Pending change: <intent>`. When the proposal is written, `mock-decide adoptable`
lists the offer: accepted mocks first `(accepted)`, open ones `(open)`, rejected
ones never. The whole directory (including an untracked `decision.json`) moves to
`openspec/changes/<name>/mockups/<id>/` and keeps working there.
