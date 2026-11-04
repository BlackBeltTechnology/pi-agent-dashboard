# Live-component mock site

Reference for `frontend-mockup-loop` step 3 (MOCKUP). The site renders a
project's **real React components** in Current | Proposed frames, circles the
elements that change with numbered rings, and records a page-level
Accept / Reject in git. English only; nothing in it is app-specific.
See change: add-live-component-mock-site.

## Project setup (once per project)

Install the package **in the project** (Vite loads the plugin from the
project's `node_modules`; `pi install` alone only gives pi the tools):

```bash
npm i -D @blackbelt-technology/frontend-mockup-loop
```

```
mockups/
  mock-site.config.ts   Vite config: your plugins (React, Tailwind) + mockSite({...})
  mock-site.app.tsx     setup() (import mock-site.css, map --mk-* tokens) + Providers
  mock-site.css         @import your app CSS + @source lines (app sources, mock roots)
  tsconfig.json         optional: paths for your aliases + "mock-site/kit"
  2026-11-03-<slug>/
    mock.tsx            one mock page (default export: Mock)
    decision.json       written by Accept/Reject (absent = open)
```

`mock-site.config.ts`:

```ts
import path from "node:path";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { mockSite } from "@blackbelt-technology/frontend-mockup-loop/src/mock-site/plugin.mjs";

export default {
  plugins: [react(), tailwindcss(), mockSite({
    projectRoot: path.resolve(__dirname, ".."),
    app: "./mock-site.app.tsx",
    title: "My mocks",
    // first = default; "system" follows prefers-color-scheme
    themes: [
      { id: "system", label: "System", system: { dark: "dark", light: "light" } },
      { id: "dark", label: "Dark", attrs: { "data-theme": "dark" } },
      { id: "light", label: "Light", attrs: { "data-theme": "light" } },
    ],
    aliases: { "@app": path.resolve(__dirname, "../src") },
  })],
};
```

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
import { Fix, Issue, type Mock } from "mock-site/kit";
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

## References

| Ref | Points at |
|---|---|
| `#<id>` | the page |
| `#<id>/<frame>` | frame (1-based) |
| `#<id>/<frame>/current` / `proposed` | one side |
| `#<id>/<frame>/<side>/<n>` | one ring, phone frames included |

Clicking a ref (page/frame `#ref`, side label, ring badge) copies its URL.
Opening one scrolls to the deepest existing part and flashes it. Quote refs when
discussing a mock: "reject `#2026-11-03-x/1/proposed/2`: label too long".

## Deciding

- Human: **Accept page** / **Reject page** / **Reopen** in the sticky bar.
- Agent: `mock-decide list`, `mock-decide accept <ref> [note]`,
  `mock-decide reject <ref> "why"` (a reason is required),
  `mock-decide reopen <ref>`. `<ref>` may be an id, any `#ref`, or a full URL.
- `decision.json` = `{ status: "accepted"|"rejected", by: "user"|"agent", note?, at }`.
  Open tabs refresh live. Only open mocks are listed unless "Show accepted / rejected".

## Serving

`serve_mock_site{}` → `http://localhost:5299` (never the dashboard port).
LAN mode relies on Vite's `server.fs.deny`; the package's optional `vite` peer
range (`>=5.4.19 <6 || >=6.3.4`) excludes the versions with known deny bypasses.
`serve_mock_site{lan:true}` adds a LAN URL for phones: LAN clients can view but
not decide, and project sources are readable on the LAN while it runs.
`serve_mock_site{stop:true, port}` stops it.

## Adoption into a change

A mock made before its change exists gets a `mockups/AGENTS.md` row ending
`Pending change: <intent>`. When the proposal is written, `mock-decide adoptable`
lists the offer: accepted mocks first `(accepted)`, open ones `(open)`, rejected
ones never. The whole directory (including an untracked `decision.json`) moves to
`openspec/changes/<name>/mockups/<id>/` and keeps working there.
