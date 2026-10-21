# plugin-apps.md — plugin apps index

Pull-only condensed map. Source: docs/plugin-apps.md. Plugin React app → embedded in dashboard content area (beside sidebar) and standalone at `/apps/<id>/`. Same app source. Change: add-plugin-app-host.

## Packages
- `@blackbelt-technology/pi-dashboard-app-kit/react` — `AppHost`, `defineDashboardApp`, `AppHostProvider`, `createStandaloneHost`, `StandaloneBar`
- `@blackbelt-technology/dashboard-plugin-runtime` — `EmbeddedAppShellProvider`, `EmbeddedAppReturnPill`, `isSafeDashboardPath`, `createReturnTargetStore`
- `@blackbelt-technology/dashboard-plugin-runtime/embedded-app` — `EmbeddedApp` (subpath only)
- Reference fixture: `packages/demo-plugin` (`demo-app/`)

## Slots recipe
- Claims: `sidebar-folder-section` (state pill), `shell-overlay-route` `presentation:"content"`
- `depth: 2` + `parentPath: "/folder/:encodedCwd"` → Back = folder
- Path `/*?` → base + sub-routes deep-link; global app `depth: 1`, no `parentPath`, Back → `/`
- `manifest-validator.ts`: `"content"` requires `depth` 1|2; only trailing `/*?`; unknown `presentation` fatal
- Matcher `matchWouterPatternWithParams` (`slot-consumers.tsx`); rest → `params["*"]`

## Presentation
- `dialog`: route-backed, scrim; depth 2
- `page`: full viewport
- `content`: beside sidebar, no scrim; mobile `MobileShell` detail panel; declared depth
- `dialog`, `content` skip `captureBackground`

## `<EmbeddedApp>` props
- `app` (req) — `defineDashboardApp` result; `basePath` (req) — route base; `onBack` (req)
- `folderParam` — encoded folder → `folder = { cwd, name }`
- `standaloneUrl` — enables *Open standalone*
- `projectScope` — `{ type?, id? }`, ≥1 field, needs `folderParam`; scoped → no standalone

## Embedded AppHost
- `mode:"embedded"`; `capabilities.dashboard=true`; `identity.current: null`
- `setTitle(t)` → shell title + `document.title`; `setActions(a)`
- `openSession(id)` → `/session/<encodeURIComponent(id)>`; `openFolder(cwd)` → `/folder/<encodeFolderPath(cwd)>`
- `navigateDashboard(path)` validated; else no-op + `console.warn`
- `openStandalone(appPath?)` → `window.open(..., "pi-app-<appId>")`; `requestFullscreen(el?)`

## Top bar
- `← Back · <folder> › <title> · HeaderContext · ≤2 actions + ⋯ · Open standalone ⧉`
- `INLINE_ACTIONS = 2`; <640 px collapses; touch 44 px; standalone hidden below `sm`

## Shell services and auth
- `createEmbeddedAppShell` (`packages/client/src/lib/plugins/embedded-app-shell.ts`)
- `fetch(path)`: root-relative only; `Authorization: Bearer` via `getApiBearer()`
- `wsUrl(path)`: `mintWsTicket("browser")` only with `getApiBearer() || isDevicePaired()`
- Missing provider → `embedded-app-no-shell`; absolute URLs refused; bearer never leaves origin

## Host navigation and validation
`isSafeDashboardPath`:
- Single leading `/`; not `//`; no `\`, whitespace, control char (raw or decoded); no `.`/`..`
- `navigateDashboard`: first segment ≠ `apps`; query/hash same char rules

Rules:
- wouter `navigate` (push); never `window.location`
- Unknown session → `/` (`App.tsx:1327-1331`)
- `openStandalone(appPath)`: must start `/` or `#`

## Return pill
- Records `returnTarget = { appId, title, context, href, dest }` before host nav
- `context` = last `setTitle()`, else folder name
- Shows only at `dest`; click → clear + push `href`; never `history.back()`; lost on reload

## States
- loading → `content-claim-loading` skeleton; crashed → *Reload app* + *Back*
- folder not found (bad `folderParam`); no shell; plugin disabled (claim absent)
- not available (folder): `projectScope` mismatch or folder `error`; (here): scope without `folderParam`

## Project-scoped apps
Gates folder routes only; data bound to admitted cwd.

### Identity file
- `<cwd>/.pi/dashboard/project.json`; `{ "schemaVersion": 1, "id"?, "type"? }`
- `id`/`type` regex `^[a-z][a-z0-9-]{0,63}$`; bad field → absent
- Ignored whole: non-regular; `.pi`, `.pi/dashboard`, or symlink; >64 KiB; non-object; `schemaVersion` ≠ 1

### Detection
- Manifest `projectTypes: [{ type, markers }]`; ≤8 types, 1–16 markers
- Marker: root-anchored, 1–3 segments; `*` in-segment only; forbidden `**`, `?[]{}!`, `.`/`..`/`.git`/`node_modules`
- Violation → fatal manifest error; case-sensitive; symlinks never matched/followed

### Resolution
- Declared `type` → `source:"declared"`, no walk; else matches → `source:"detected"`; none → `"none"`
- `id` only from declaration; rules from loaded + enabled + `fixtureEntryAllowed` plugins

### Bounds
- One walk per request; ≤2000 entries; ≤256 patterns; ≤4 concurrent; 2 s deadline
- `truncated: true` on budget/deadline/skip

### Endpoint
`GET /api/folder/project?cwd=<abs>`
- 200 `{ id, types, source, truncated? }`; 400 bad cwd; 403 not admitted; 404 missing
- 503 + `Retry-After` + `cwd-admission-unavailable`
- Admission = `admitCwd`; read-only, tier `observe`; never prompts
- Impl: `packages/server/src/routes/folder-project-routes.ts`, `packages/server/src/lib/folder-project.ts`

### Runtime client
- `useFolderProject`, `getFolderProject`, `invalidateFolderProject`, `clearFolderProjects`, `folderHasProjectType`, `folderHasProjectId`
- `loading | ready | error`; `error` fails closed, expires 60 s
- Landings coalesce → `bumpSlotClaimsVersion()`; cleared on enabled-set change

### Embedding + security
- `projectScope={{ type: "judo" }}`; mounts only on matching `ready`
- Mismatch/`error` → *Not available for this folder*; scoped → no standalone
- Declared `id` UNAUTHENTICATED; scoped apps MUST NOT grant privileged data by `id` alone
- Folder `id` ≠ team-plugin `projects` slug (admin config)

### Scaffold
- `dashboard-plugin-scaffold` scope `none|global|project-type|project-specific`
- `pi-dashboard-plugin-scaffold --write-project-id <abs-folder> <id>`; atomic temp+rename
- Refuses symlink, oversized, non-object, `schemaVersion` ≠ 1, different existing `id`

### Limits
- No cache, no watcher; after identity edit → `invalidateFolderProject(cwd)`
- Same-path claims from two plugins shadow by `(priority, id)`

## Build + lazy route
- Two builds per app: library entry + standalone `index.html` (`/apps/<id>/`, `createStandaloneHost`)
- Route exported `React.lazy`; `content` claim wrapped in `React.Suspense`
- Gate: initial bundle + one fixture app ≤ +5 KB gzip
- `app-kit` aliases: `packages/client/vite.config.ts`, `packages/dashboard-plugin-runtime/vitest.config.ts`, root `tsconfig.json` `paths`
- `app-kit` in `BUNDLED_WORKSPACE_PKGS` (`packages/electron/scripts/bundle-server.mjs`)

## Embedding rules
- Route relative to `basePath`; no `window.location` writes; no global CSS on `html`/`body`/`:root`
- Title via `host.setTitle`; no `<html>`/`<body>` mutation; storage keys `<appId>:`; data via `host.api` only

## Rollback
1. Revert consumer manifests using `"content"` or `/*?` first (old dashboards fatal)
2. Remove `"content"`, `/*?` matcher, shell transport provider, `<EmbeddedApp>`
3. Apps stay standalone at `/apps/<id>/`

## Verification
- Unit: `packages/dashboard-plugin-runtime/src/__tests__/embedded-app.test.tsx`, `manifest-validator.test.ts`, `shell-overlay-route-match.test.tsx`
- Client: `packages/client/src/lib/__tests__/embedded-app-shell.test.ts`, `overlay-background.test.ts`, `mobile-depth.test.ts`
- Lazy route: `packages/demo-plugin/src/__tests__/lazy-route.test.ts`
- E2E (opt-in): `tests/e2e/plugin-embedded-app.spec.ts`

## Runtime-loaded apps (decouple-plugins-from-core)
- External plugin embeds app via runtime ESM: `shell-overlay-route` claim → lazy chunk → `<EmbeddedApp>`. Import-map shims `embedded-app`, `app-kit-react`, `wouter`.
- One source two builds: `dashboardClientViteConfig` (embedded) + `dashboardStandaloneViteConfig` (standalone SPA).
- Canary `tests/fixtures/runtime-canary-plugin` + 4 failure variants.
