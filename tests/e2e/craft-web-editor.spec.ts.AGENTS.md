# craft-web-editor.spec.ts — index

L3 Playwright for craft-web WordCraft `.docx` editing in editor pane. Covers test-plan F1–F9, X7, P1, P2 (tasks 9.26–9.36, 9.43). See change: edit-office-in-pane-with-craft-web.
Enabling: `beforeAll` reads `GET /api/plugins/craft-web/status`; 404 / `restart-required` / `disabled` → `POST /api/plugins/craft-web/toggle {enabled:true}` + `POST /api/restart` + poll `/api/health`. Then `POST /api/plugins/craft-web/prepare/wordcraft` (real download; needs harness network). `afterAll` restores original enabled state + restart. Exemplar: `skill-atlas.spec.ts` X13.
Fixtures: `report.docx` re-seeded from host `docker/fixtures/sample-git/report.docx` via `docker exec` base64 before + after each test; copies (`report.wordcraft.docx`, `draft.docx`, `report.pdf`, `linked.docx`) removed in `afterEach`.
Dep-free zip: `zipStore` (store-only writer, own CRC32) builds `makeDocx(text, link?)`; `unzipEntry` (stored/deflate via `zlib.inflateRawSync`) + `docxText` verify saved bytes.
Selectors: mode `file-mode-craft-web/wordcraft`; host `craft-frame-host[data-phase=open]` = `opened` seen; `craft-frame` iframe; `craft-save-as(-copy)`, `craft-blocked-toast`, `craft-nav-offer`/`craft-nav-open`, `craft-reloaded(-retry)`; core `file-handler-first-overwrite-dialog(-overwrite)`, `file-handler-disabled-overlay`, `file-handler-reenable`/`-discard`, `changed-on-disk-banner`.
Shim-driven steps (F3 Save As, F4 Export PDF, F6 link, F8 open) call shim-stubbed APIs inside the frame (`showSaveFilePicker`, anchor download, `<a>` click, `showOpenFilePicker`); real WordCraft UI paths marked `TODO(spike)`. F2 types into canvas + `ControlOrMeta+s` (TODO(spike)).
F5: both frame fetches reject; server-side signal = status `apps.wordcraft.cspViolations` grows. F9 `webgl` leg hides `Navigator.prototype.gpu` via `addInitScript`; both legs assert IndexedDB refused. P1/P2 measure-only (console.log + `test.info().annotations`).

Summary (moved from directory AGENTS.md row): L3 WordCraft F1–F9, X7, P1/P2.
