# Site matrix (task 1.1)

Every caller-`cwd` site covered by this change. Gate before: exact `listAll().some(s => s.cwd === cwd)` unless stated. Gate after: `admitFileCwd` (`lib/file-cwd-admission.ts`: `admitRouteCwd` + the `admissionAllows` branch, `cwd` string shape check first) or `admitOptionalCwd` for optional-cwd routes. Anchors: `cwdAnchors` = request spelling, then the canonical cwd when it differs (D2), then the site's own anchors.

| # | Site | cwd source | Gate before | Gate after | Refusal (status / error / code) | Anchors | Lib sink |
|---|---|---|---|---|---|---|---|
| 1 | `gateFilePath` (open-in-system, reveal, EML ×2, live `start-static`, per-asset re-check) | query/body | sessions | `admitFileCwd`, token released in `finally` | 403 `unknown session path` + `cwd_unknown`; 503 shared | `[cwd, canon?]` | — (containment) |
| 2 | `gateReadPath` (`GET /api/file`, `/digest`) | query | sessions | `admitFileCwd` | same | `[cwd, canon?, ~/.pi]` | — |
| 3 | `gateOfficeFile` (docx / pptx / sheet routes) | query | sessions | `admitFileCwd` | same | `[cwd, canon?]` | `lib/office-preview.ts` |
| 4 | `GET /api/file/tree` | query | sessions | `admitFileCwd` (reply close) | same | `[cwd, canon?]` | — |
| 5 | `GET /api/file/md-candidates` | query, optional | sessions (present) | absent (`undefined`/`""`) → constant `{}`; present → `admitFileCwd` | same | — | `lib/md-candidates.ts` |
| 6 | `GET /api/file/md-read` | query, optional | `resolveScopedMdPath` sessions | async `resolveScopedMdPath` | same; `400` global needs abs path | — | `lib/writable-md-target.ts` |
| 7 | `POST /api/file/write` | body, optional | `prepareMdWrite` sessions | async `prepareMdWrite` (raw value shape-checked before coercion) | same | — | `lib/writable-md-target.ts` |
| 8 | `GET /api/file/exists` | query | sessions ∪ pins + hold prompt | `admitFileCwd` → on refuse `unknownCwdVerdict` (hold + `rerunAlways` via `admitRouteCwd`) → `issueHeldAdmission` | 403 `unknown cwd` + `cwd_unknown` (+ reason/hint); 503 shared, never prompts | `[cwd, canon?, ...pinned]` | — |
| 9 | `POST /api/file/resolve-mention` | body | sessions | `admitFileCwd` | same | `[cwd, canon?, ~/.pi]` (`resolveFileMention` gains `canonCwd`) | `lib/resolve-file-mention.ts` |
| 10 | `GET /api/file/raw` | query | sessions | `admitFileCwd` | same | `[cwd, canon?, ~/.pi]` (both lists) | — |
| 11 | `GET /api/file/render` | query | sessions | `admitFileCwd` | same | `[cwd, canon?, ~/.pi]` | — |
| 12 | `GET /api/grep` | query | sessions | `admitFileCwd` | same | match filter `[cwd, canon?]` | `lib/grep.ts` |
| 13 | `POST /api/file/write-binary` (editor-pane save) | query | sessions (sync `resolveHandler`) | async `resolveHandler` → `admitFileCwd`; guarded cwd threaded to `isWritableHandlerTarget` | 403 `unknown session path` + `cwd_unknown`; 503 shared + `Retry-After` via `Outcome.headers` | handler target root | `lib/writable-handler-target.ts` |
| 14 | live preview `start-static` | body | `gateFilePath` | same helper | status/body of the file route; 503 adds `Retry-After` (`StaticStartGate` `headers`) | — | — |
| 15 | live preview per-asset re-check | proxied cwd | `gateFilePath` quiet | same helper, quiet; indeterminate → refused asset | `false` | — | — |
| 16 | `watch_files` (browser WS) | message | sessions | `createWatchFilesHandler` (`watch-files-handler.ts`) with sequence + disconnect guard | silent no-op | lexical under cwd | `file-watch-manager.ts` |
| 17 | `/api/openspec/groups*` ×6 | query | sessions ∪ pins (`rejectInvalidCwd`) | `admitGroupsCwd` → `createOpenSpecAdmission().admitUngatedCwd` (global OpenSpec dir refused) | 403 `cwd not allowed` + `cwd_unknown`; 503 shared | — | `openspec-group-store.ts` |
| 18 | `GET /api/packages/installed` | query, optional | none | `admitOptionalCwd` | 403 `cwd not allowed` + `cwd_unknown` + reason/hint; 503 shared | — | `listInstalled` |
| 19 | `POST /api/packages/install` | body, optional | none | `admitOptionalCwd` | same | — | `run` |
| 20 | `POST /api/packages/remove` | body, optional | none | `admitOptionalCwd` | same | — | `run` |
| 21 | `POST /api/packages/update` | body, optional | none | `admitOptionalCwd` | same | — | `run` |
| 22 | `POST /api/packages/move` — `fromCwd` | body | none | up-front local-scope string check (`400 invalid_request`), then `admitOptionalCwd` | same; refusal beats 503 | — | `move` |
| 23 | `POST /api/packages/move` — `toCwd` | body | none | same as 22 | same | — | `move` |
| 24 | `POST /api/packages/reset-to-npm` | body | none | up-front local-scope check, then `admitOptionalCwd` | same | — | `listInstalled`, `reset` |
| 25 | `POST /api/packages/check-updates` | body, optional | none | `admitOptionalCwd` | same | — | `checkUpdates` |
| 26 | `GET /api/canvas-types` | query, optional | none | `admitOptionalCwd`; absent → constant `""` | same | — | `canvas/canvas-settings.ts` |
| 27 | `PATCH /api/canvas-types` | body, optional | none | `validatePatch` (400) first, then `admitOptionalCwd` | same | — | `canvas/canvas-settings.ts` |
| 28 | `POST /api/resources/toggle` | body, optional | none | `admitOptionalCwd` for both scopes before the settings path | same | — | `applyResourceToggle`, trust challenge |
| 29 | `registerAddonsRoutes` wiring | query/body | `knownDirectories` (pins ∪ non-ended sessions) | `knownCwds: knownFolderCwds` (the route already prefers it) | unchanged bodies | — | — |
| 30 | `listKnownFolderCwds` | — | sessions ∪ pins | sessions ∪ pins ∪ workspace folders (D8) | — | — | — |

Row count: 30 (design Context lists the same sites; `move` ×2 and groups ×6 counted once each as one gate).

## Not changed

`/api/browse*` (no cwd), `session-routes.ts` (server-owned dir), `/api/diagram/render`, `/api/resources/reload`, `directory-service.ts isTrackedCwd` (`openspec_get` tracking, not a file gate), `event-wiring.ts` new-cwd detection, goal-plugin cwd matching, `knownInitTargets()` of the gated openspec write sites.

## CodeQL classification of the booked `js/path-injection` entries

| File | Before | Class |
|---|---|---|
| `routes/file-routes.ts` | 19 | path-fed (`path.resolve(cwd, relPath)` → async containment, unmodelled) → follow-up `codeql-file-containment-barrier` |
| `lib/grep.ts` | 3 | cwd-fed → closed |
| `lib/md-candidates.ts` | 1 | cwd-fed → closed |
| `lib/writable-md-target.ts` | 1 | cwd-fed → closed |
| `lib/writable-handler-target.ts` | 2 | 1 cwd-fed (dismissed #463) closed; 1 path-fed (dismissed #464) residue |
| `canvas/canvas-settings.ts` | 4 | cwd-fed → closed |
| `lib/resolve-file-mention.ts` | 1 | path-fed → residue |
| `lib/office-preview.ts` | 1 | path-fed → residue |
| `lib/eml.ts` | 1 | path-fed → residue |
| `browse.ts` | 6 | cwd-less folder browser → out of scope |
