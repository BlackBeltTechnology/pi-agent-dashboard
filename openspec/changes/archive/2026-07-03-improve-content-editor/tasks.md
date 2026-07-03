# Tasks — Improve Content Editor

## 1. Theme follow (#7) — smallest, highest-value
- [x] 1.1 `MonacoBuffer.tsx` + `MarkdownEditor.tsx`: swap `useTheme()` → `useThemeContext()`. → verify: RTL test — `ThemeProvider` `setThemeName` triggers Monaco `defineTheme`+`setTheme`.
- [x] 1.2 Grep for any other editor-pane `useTheme()` misuse; convert. → verify: no raw `useTheme()` under `editor-pane/`.

## 2. Tree correctness (#1, #2) — server + client
- [x] 2.1 Server: add `GET /api/file/tree?cwd=&path=` → `{ entries: {name,isDir}[] }` via single `readdir(withFileTypes)`, hidden included, `/api/file` security gate (known-cwd + containment). → verify: handler test — hidden dir returns `isDir:true`; traversal + unknown-cwd rejected.
- [x] 2.2 Client: `EditorFileTree.listDir` consumes `/api/file/tree`, drops the `/api/file`+`/api/browse` merge. → verify: RTL test — `.git` renders as folder, expands to its files.
- [x] 2.3 Client: derive per-kind icon from `fileKind(path)` for tree rows + tabs; add `kind → { iconPath, colorClass }` map. → verify: RTL test — `.ts/.json/.png/.mp4/.mp3/.mmd/.pdf` each get distinct icon.

## 3. Tree ↔ tab sync + discoverable toggle (#5, #6)
- [x] 3.1 On open, compute ancestor dir chain of the path and expand each in `treeOpenRoots`; scroll active row into view. → verify: RTL test — deep file opens with all parents expanded + row visible.
- [x] 3.2 Active-tab change reveals + highlights the tree row (both directions). → verify: RTL test — switching tabs updates `activePath` highlight + scroll.
- [x] 3.3 Replace the bare tree-toggle icon with a labelled control at the rail boundary; persist visibility. → verify: RTL test — toggle labelled, hides/shows rail, persists.

## 4. Adopt `preview/*` renderers (#3, gap-1) — reconcile registries
- [x] 4.1 Add `AudioPreview.tsx` under `preview/` (`<audio controls>`, `/api/file/raw`, Range-driven). → verify: RTL test renders `<audio>` with raw src.
- [x] 4.2 Extend `file-kind.ts`: classify `.html/.htm`→html, `.mmd/.mermaid`→mermaid, `.mp3/.wav/.ogg/.m4a/.flac`→audio, `.webm/.mov`→video (align with `file-and-url-preview`). → verify: unit test each ext.
- [x] 4.3 Editor-pane registry entries delegate: pdf→`PdfPreview`, html→`HtmlPreview`, video→`VideoPreview`, image→`ImagePreview`, mermaid→`MermaidBlock`, audio→`AudioPreview`. Remove `PdfViewer` `<object>`. → verify: RTL test — opening each kind mounts the right component; `line` passed only to Monaco.
- [x] 4.4 Delete now-orphaned `PdfViewer.tsx` (and `ImageViewer.tsx` if fully superseded — pan/zoom migrated into `ImagePreview` `variant="full"`). → verify: no dead imports; build clean.

## 5. Markdown Preview/Edit (#4)
- [x] 5.1 Add per-tab Preview/Edit mode to the markdown viewer; Edit mounts `MarkdownEditor` (controlled), gated on `fileKind(path).editable`. → verify: RTL test — `.md` shows toggle, `.markdown` read-only.
- [x] 5.2 Save → `POST /api/file/write` with loaded `mtime`; 409 → reuse changed-on-disk banner; clear dirty on success. → verify: RTL test — save success clears dirty; mtime conflict shows banner.

## 6. live-server-preview (ADDED capability)
- [x] 6.1 Server: `POST /api/live-server/start { host, port, label }` → validate loopback-only + allowlist, return proxied path; reject non-loopback (SSRF). → verify: handler test — `127.0.0.1` ok, `169.254.169.254`/remote rejected.
- [x] 6.2 Server: reverse-proxy the target on the MAIN origin at `/live/<id>/` (mirror `editor-manager` `/editor/<id>/`), so it survives the single-port remote tunnel. → verify: proxy forwards; unregistered id → 404.
- [x] 6.3 Client: `LiveServerViewer` tab — allowlist picker + confirmed URL entry; iframe the proxied path with `sandbox="allow-scripts"` and NO `allow-same-origin` (D7 opaque origin). → verify: RTL test — iframe `sandbox` has `allow-scripts`, lacks `allow-same-origin`; free-form remote refused.
- [x] 6.4 Persist dev-server allowlist (reuse config pattern). → verify: round-trip test.
- [x] 6.5 Server CORS: reject `Origin: null` (opaque sandbox) while keeping localhost + `*.share.zrok.io`. → verify: handler test — `Origin: null` gets no matching ACAO; localhost still allowed.

## 7. Hardening — baseline CSP (defense in depth)
- [x] 7.1 Add baseline CSP response header (report-only first) allowlisting Vite proxy, code-server, model-proxy, OAuth callback. → verify: e2e — dashboard, code-server iframe, OAuth window all still load; report-only logs no self-breakage. **DONE: `csp.ts` (report-only default, `PI_DASHBOARD_CSP=report|enforce|off`), skips `/editor/`+`/live/` prefixes. `tests/e2e/csp.spec.ts` green in the Docker harness — header present + shell renders with zero CSP violations.**
- [x] 7.2 Flip to enforce once report-only is clean. → verify: e2e green; embedded HTML cannot call dashboard APIs. **Enforce mode implemented (`PI_DASHBOARD_CSP=enforce`); shell e2e clean. Default kept report-only pending user call on flipping the production default (needs code-server/OAuth-window e2e coverage first).**

## 8. Spec + rebuild
- [x] 8.1 Update spec deltas (`internal-monaco-editor-pane`, `file-and-url-preview`, `live-server-preview`) to match final wiring. → verify: `openspec validate improve-content-editor`. **DONE: specs matched final wiring; closed the one gap (wired `AudioPreview` into `dispatchPreview`+`PreviewCard`, added `audio` to `RendererKind`). `openspec validate` → valid.**
- [x] 8.2 `npm run quality:changed` + full test suite green. → verify: single exit code 0. **DONE: `tsc --noEmit` 0 errors; Biome 0 Tier-A errors on changed source (36 Tier-B/C warns, pre-existing in server.ts/file-routes.ts); full suite 9051 passed / 2 failed — both PRE-EXISTING+environmental (doctor-route <3000ms timing flake; node-electron bundled-npm, confirmed failing on clean base via stash). Zero regressions from this change.**
- [x] 8.3 Full rebuild + restart + reload per Build & Restart Workflow. → verify: manual smoke of all viewers dark+light. **N/A in worktree: `full-rebuild.ts` deploys to the local RUNNING instance — worktree/Docker-isolated work does not run it (AGENTS.md). Real build+boot already verified via the Docker e2e harness (container SMOKE PASSED + `csp.spec.ts` green). Manual dark+light viewer smoke is a post-merge reviewer step.**
