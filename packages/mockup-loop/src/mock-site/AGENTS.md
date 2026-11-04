# DOX — packages/mockup-loop/src/mock-site

Files in this directory. One row per file.

| File | Purpose |
|------|---------|
| `cli.mjs` | `mock-decide` bin. `list`, `accept <ref> [note]`, `reject <ref> <note>` (reason required), `reopen <ref>`, `adoptable`, `move <mockDir> <changeDir>`; writes `by: "agent"`. `findProjectRoot(cwd)` = nearest ancestor with `mockups/mock-site.config.ts`, else git toplevel. `run(argv, cwd)` exported. See change: add-live-component-mock-site. |
| `decisions.mjs` | `decision.json` store: `readDecisionFile`, `readDecisions` (malformed/unknown status → open + warning), `writeDecision` (atomic dot-tmp + rename, open = delete, refuses symlinks), `validateDecideBody` (id allow-list, status enum, note ≤ 500 code points). See change: add-live-component-mock-site. |
| `discover.mjs` | `mockRoots`, `discoverMocks(projectRoot)` (`mockups/*/mock.tsx` + `openspec/changes/*/mockups/*/mock.tsx`, archive excluded, newest first, invalid/duplicate ids → `errors`), `listAdoptable` (marked `mockups/AGENTS.md` rows; accepted first `(accepted)`, open/malformed `(open)`, rejected → `skipped`), `moveMockDir` (git mv + mv fallback + `git add -A`, ok only when source gone). See change: add-live-component-mock-site. |
| `plugin.mjs` | `mockSite(options)` Vite plugin; no runtime `vite` import. Sets root = `mockups/`, cacheDir `node_modules/.vite-mock-site`, fs.allow, dedupe react, optimizeDeps.entries, alias `mock-site/kit`, host 127.0.0.1 unless `lan` / `MOCK_SITE_LAN=1` (+ LAN fs.deny). Virtual `config`, `app`, `mocks` (explicit imports from `discoverMocks`). `GET /__mock/decisions` (mockSite, canDecide, decisions, warnings, errors); `POST /__mock/decide` (loopback-only 403, 405, 415, 413 over 4 KiB, Origin 403, 400). Watches mock roots: decision.json → `mock:decisions`, mock.tsx → full reload. Serves the HTML entry. See change: add-live-component-mock-site. |
| `refs.mjs` | Pure ref grammar shared by plugin, CLI, kit: `MOCK_ID_RE`, `RING_RE`, `parseRef` (id / `#ref` / URL hash; `?pane=` ignored; throws naming bad segment), `refId`. See change: add-live-component-mock-site. |
