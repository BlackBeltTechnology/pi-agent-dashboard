# Test Plan — add-plugin-app-host

Stage: design   Generated: 2026-10-09

Hard gate passed: C1 (return-pill context = last `setTitle()` → folder name → omitted) and C2 (`standaloneUrl` = optional `<EmbeddedApp>` prop; absent ⇒ no button) answered and folded into design D4/D5 + `plugin-embedded-app` spec.

L3 fixture: `packages/demo-plugin` (fixture plugin, loaded by the docker harness under `PI_DASHBOARD_FIXTURE_PLUGINS=1`) gains a `"content"` claim `/folder/:encodedCwd/demo-app/*?` (`depth: 2`, `parentPath: /folder/:encodedCwd`) rendering a tiny fixture app via `<EmbeddedApp>` with views `/` and `/sub`, a button calling `host.openSession(<id>)`, and `setTitle("Demo ctx")`. Below `<enc>` = `encodeFolder(FIXTURE_GIT)`.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | shell-overlay-route: presentation enum; "Content presentation survives normalisation" | EP | L1 | automated | claim `{slot:"shell-overlay-route", path:"/folder/:encodedCwd/x", depth:2, parentPath:"/folder/:encodedCwd", presentation:"content"}` | `validateManifest` | no throw; normalised claim `presentation === "content"` |
| E2 | "Content presentation requires depth" | EP (invalid) | L1 | automated | same claim without `depth` | `validateManifest` | throws `ManifestValidationError` whose message contains `depth` |
| E3 | "Unrecognised presentation is fatal" | EP (invalid) | L1 | automated | `presentation: "modal"` | `validateManifest` | throws; message contains claim index and `"page"`, `"dialog"`, `"content"`; no defaulting |
| E4 | path field: only trailing `/*?` | EP + BVA on wildcard position | L1 | automated | paths `/folder/:encodedCwd/wall/*?`, `/folder/:encodedCwd/wall/*`, `/folder/*/wall`, `/*?` | `validateManifest` each | first and last validate; `/wall/*` and `/folder/*/wall` throw referencing the path |
| E5 | "Build-time generator emits presentation" | EP | L1 | automated | plugin manifest with a `"content"` claim | Vite generator emits registry | emitted `ClaimEntry` has top-level `presentation: "content"` |
| E6 | trailing wildcard match + agreement | BVA on segment count | L1 | automated | claim `/folder/:e/wall/*?`; URLs `/folder/x/wall`, `/folder/x/wall/`, `/folder/x/wall/graph/node-1`, `/folder/x/walls`, `/folder/x` | `useShellOverlayRouteMatched`, `useShellOverlayRoutePresentation`, sync params path, and wouter `useRoute` probe for each URL | first three match with `params["*"]` = `""`, `""`, `"graph/node-1"`; last two match nothing; all four mechanisms agree per URL |
| E7 | descriptor for `*?`; never outranks core | BVA | L1 | automated | descriptor table = core descriptors + claim `/folder/:e/wall/*?` (depth 2, parent `/folder/:e`) | `resolveDescriptor` / `routeDepth` for `/folder/x/wall` and `/folder/x/wall/graph/node-1`; and for `/folder/x/openspec` | both wall URLs → depth 2, parent `/folder/x`; `/folder/x/openspec` still resolves to its core descriptor |
| E8 | url-routing mobile depth; content depth override | decision table | L1 | automated | `getMobileDepth` inputs `{hasOverlayRoute:true, overlayDepth:1}`, `{…, overlayDepth:2}`, `{hasOverlayRoute:true}` (dialog), `{hasFolderRoute:true}` | call | returns 1, 2, 2, 1 |
| E9 | presentation hook returns content | EP | L1 | automated | registry with `"content"` claim at `/x/*?`; location `/x/a` | `useShellOverlayRoutePresentation` | returns `"content"`; returns `null` at `/y` |
| E10 | "Host navigation is validated" | EP + BVA | L1 | automated | `navigateDashboard` inputs: `/session/x`, `/folder/abc` (valid); `//evil.example/x`, `/\evil.example/x`, `javascript:alert(1)`, `https://a.b`, `/apps/wall`, `/a/../apps/x`, `/a%2F..%2F..`→decoded `..`, `/a b`, `/a\u0000`, `""` (invalid) | call on embedded host | valid → router `navigate` called once with the path; each invalid → `navigate` not called and one `console.warn` naming the app id |
| E11 | openSession/openFolder encoding | EP | L1 | automated | `openSession("a/../../apps/x")`; `openFolder("/home/u/acme erp")` | call on embedded host | `navigate("/session/a%2F..%2F..%2Fapps%2Fx")`; `navigate("/folder/" + encodeFolder("/home/u/acme erp"))` |
| E12 | "Dashboard credentials never leave the origin"; auth parity | EP + decision table (bearer × paired) | L1 | automated | shell transport with stubbed `fetch`, `getApiBearer`, `isDevicePaired`, `mintWsTicket` | `api.fetch("https://evil.example/x")`, `api.wsUrl("//evil.example/ws")`, `api.fetch("/api/x")` with bearer `T`, `api.wsUrl("/ws")` for (bearer,paired) ∈ {(T,–),(–,paired),(–,–)} | off-origin: fetch rejects, stub never called, wsUrl → `null`; `/api/x` sent with `Authorization: Bearer T`; ticket appended for first two combos, not for the third |
| E13 | EmbeddedApp host fields | EP | L1 | automated | `<EmbeddedApp app basePath="/folder/<enc>/wall" folderParam=<enc of /home/u/acme-erp> standaloneUrl="/apps/wall/">`; second render without `folderParam`/`standaloneUrl` | render, read `useAppHost()` in the app | 1st: `mode "embedded"`, `capabilities.dashboard true`, `basePath` as given, `folder {cwd:"/home/u/acme-erp", name:"acme-erp"}`, `standaloneUrl "/apps/wall/"`, *Open standalone* button present; 2nd: no `folder`, no button |
| E14 | top bar zones | BVA on action count | L1 | automated | app with `HeaderContext` chip; `setActions` with 2 then 3 actions; folder + global variants | render | breadcrumb `acme-erp › <title>` (global: `<title>` only); chip DOM-ordered between breadcrumb and actions; 2 actions → 2 inline, no overflow; 3 → 2 inline + overflow holding the 3rd |
| E15 | openStandalone | EP | L1 | automated | embedded at `/folder/<enc>/wall/graph`, `standaloneUrl "/apps/wall/"`; `window.open` stub | `openStandalone()` twice; `openStandalone("#/s/tok")`; `openStandalone("javascript:x")` | `window.open("/apps/wall/graph", "pi-app-wall")` twice (same name); `("/apps/wall/#/s/tok", "pi-app-wall")`; invalid → no call + warn |
| E16 | standalone host no-ops | EP | L1 | automated | `createStandaloneHost({appId:"wall", basePath:"/apps/wall"})` with navigation spies | call `openSession`, `openFolder`, `navigateDashboard("/x")` | `capabilities.dashboard === false`, `mode "standalone"`; no history change, no throw |
| E17 | return pill context + lifecycle | decision table + state-transition | L1 | automated | return-target store; app with `setTitle("Q3 sync")`, then app without title in folder `acme-erp`, then global app without title | host `openSession("abc")` then location = `/session/abc`; activate pill; separately location → `/settings`; separately a second app navigation | labels `← Wall · Q3 sync`, `← Wall · acme-erp`, `← Team`; activation pushes the recorded app path and clears; `/settings` clears; second navigation replaces the target |
| E18 | content not lifted into dialog; background capture | decision table | L1 | automated | pure predicates extracted from `App.tsx` (`isPluginDialog(matched, presentation)`, `shouldCaptureBackground(matched, presentation)`) | evaluate for presentation ∈ {dialog, page, content, null} | dialog: dialog=true, capture=false; page: false/true; content: false/false; null (no match): false/true |
| E19 | app code lazy (D8) | structural | L1 | automated | demo-plugin client entry with lazy route component | Vite generator emits registry; inspect demo client entry | registry imports the client entry statically; the route component is a `React.lazy` wrapper whose module is reached only via dynamic `import()` |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | D8 bundle gate | before/after measurement | — | manual-only | `npm run build` on `develop` base vs change branch (with demo fixture app) | gzip size of the client initial entry chunk(s): delta ≤ +5 KB; fixture app code absent from initial chunks | one build each; recorded in PR — no bundle-budget harness exists |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | "Plugin apps embed like the OpenSpec board"; content presentation | state-transition | L3 | automated | desktop 1440×900; harness with demo fixture plugin; FIXTURE_GIT folder | goto `/folder/<enc>`, open `/folder/<enc>/demo-app` | URL `/folder/<enc>/demo-app`; fixture app root visible; sidebar session list visible and a sidebar control clickable; no `[role=dialog]`, no scrim element; top bar shows breadcrumb with folder name and `Demo` |
| F2 | "Deep link reload" | state-transition | L3 | automated | desktop | `page.goto("/folder/<enc>/demo-app/sub")` cold | fixture `/sub` view visible in content area; sidebar visible |
| F3 | Back / no Esc dismissal | state-transition (illegal edge: Esc) | L3 | automated | on `/folder/<enc>/demo-app` | press `Escape`; then click top-bar Back | after Esc URL unchanged; after Back URL `/folder/<enc>` |
| F4 | return pill round trip | state-transition | L3 | automated | on `/folder/<enc>/demo-app/sub`, live session `<id>` | click fixture "open session" button; click pill; then repeat and navigate to `/settings` | `/session/<id>` shows pill `← Demo · Demo ctx`; click → URL `/folder/<enc>/demo-app/sub`; on `/settings` no pill |
| F5 | mobile content claim | state-transition | L3 | automated | viewport 390×844 | goto `/folder/<enc>/demo-app`; tap Back | app rendered inside `MobileShell` detail panel at depth 2 (detail panel visible, list panel off-screen); Back → `/folder/<enc>`; top bar Back control ≥ 44×44 px |
| F6 | narrow top bar layout + look | visual | — | manual-only | real wall/demo app at 390 px and 1440 px | human inspects top bar | [judgment: top bar matches OpenSpec board styling/tokens; overflow menu reads well] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | "App crash isolated" | fault-injection (abort) | L1 | automated | app component throws on render | render `<EmbeddedApp>` | boundary text + `Reload app` + `Back` buttons; Back calls `onBack`; Reload remounts app (render count +1) |
| X2 | D9 folder not found | fault-injection (bad input) | L1 | automated | `folderParam = "%%%not-base64"` | render | "Folder not found" + Back; app not rendered |
| X3 | D4 missing shell provider | fault-injection (missing dep) | L1 | automated | no `EmbeddedAppShell` provider above | render | error state rendered; no throw past the boundary |
| X4 | D9 plugin disabled | fault-injection (claim absent) | L1 | automated | registry without the demo claim | location `/folder/x/demo-app` | `useShellOverlayRouteMatched` false, presentation `null` (falls through to existing unmatched handling) |

---

## Coverage summary

- Requirements covered: 9/9 (plugin-embedded-app ×4, shell-overlay-route ×2 modified, url-routing ×1 modified, design D8/D9)
- Scenarios by class: edge 19 · perf 1 · frontend 6 · error 4
- Scenarios by level: L1 23 · L2 0 · L3 5 · — 2
- Scenarios by disposition: automated 28 · manual-only 2

## New infra needed

- none (L3 extends `packages/demo-plugin` fixture; P1 is manual for lack of a bundle-budget harness)
