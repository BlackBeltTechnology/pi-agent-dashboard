# Test Plan — add-project-scoped-apps

Stage: design   Generated: 2026-10-12

No clarifications needed: every Triple below fills from the specs and design.md.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | Declared project identity file | decision-table | L1 | automated | `.pi/dashboard/project.json` = `{schemaVersion:1,id:"acme-erp",type:"judo"}` | resolve project of the folder | `{id:"acme-erp",types:["judo"],source:"declared"}` |
| E2 | Declared project identity file (per-field) | decision-table | L1 | automated | file `{schemaVersion:1,id:"acme-erp",type:"JUDO!"}` + matching marker `model/core.judo` | resolve | `id:"acme-erp"`, `types:["judo"]`, `source:"detected"` |
| E3 | Declared project identity file (whole-file ignore) | EP | L1 | automated | 5 files: `schemaVersion:2`; JSON array `[]`; invalid JSON `{`; 65537-byte file; FIFO named `project.json` | resolve each | each → `id:null`, `source:"none"` (no rules); FIFO resolves without hanging |
| E4 | Declared project identity file (size BVA) | BVA | L1 | automated | valid JSON padded to 65535, 65536, 65537 bytes | resolve | 65535 and 65536 → declared fields used; 65537 → ignored; ≤ 65537 bytes read |
| E5 | Declared project identity file (symlinks) | decision-table | L1 | automated | symlink at `project.json`, at `.pi/dashboard`, at `.pi` (each to a valid outside file/dir) | resolve | each → treated as absent; target never opened (fs spy) |
| E6 | Declared id regex | BVA | L1 | automated | `id` of length 1 (`a`), 64, 65; `id:"9abc"`; `id:"Abc"` | resolve | length 1 and 64 accepted; 65, leading digit and uppercase → `id:null` |
| E7 | Marker matching | EP | L1 | automated | rule `model/*.judo`; tree has `model/.judo`, `model/core.JUDO`, `model/sub/x.judo`, `model/core.judo/` (dir) | resolve | `.judo` matches (`*` = zero chars), case variant no, deeper level no, directory named `core.judo` matches |
| E8 | Precedence | decision-table | L1 | automated | declared `type:"plain"` + `model/core.judo` exists | resolve, with an fs spy on the walker | `types:["plain"]`, `source:"declared"`, walker never invoked |
| E9 | No rules short-circuit | EP | L1 | automated | no enabled plugin declares `projectTypes`; folder has no identity file | resolve with an fs spy | `source:"none"`, zero `opendir` calls |
| E10 | Detection uses only loaded + enabled plugins | decision-table | L1 | automated | plugin A enabled with `judo` rule; plugin B disabled with `erp` rule; fixture plugin C (`fixtureEntryAllowed` false) with `demo-scoped` rule; all markers present | resolve | `types:["judo"]` |
| E11 | Symlink-free walk | EP | L1 | automated | `model` → symlink to a dir containing `core.judo`; also `model2/core.judo` where `core.judo` is a symlink to a file | resolve with rules `model/*.judo`, `model2/*.judo` | no type detected for either |
| E12 | `.git` / `node_modules` never visited | EP | L1 | automated | rules `*_modules/x.judo` and `.gi*/x.judo` (valid: wildcard segments that would match the excluded names); `node_modules/x.judo` and `.git/x.judo` exist | resolve with an fs spy | no `opendir` on `.git` or `node_modules`; no type detected |
| E13 | Entry budget BVA | BVA | L1 | automated | flat folders with 1999, 2000, 2001 entries before the marker dir (sorted after) | resolve | 1999 → detected, no `truncated`; 2000 → `truncated:true`; 2001 → `truncated:true`, ≤ 2000 entries read (counted via spy) |
| E14 | Pattern budget + ordering | decision-table | L1 | automated | 3 plugins × 128 patterns, priorities 10/20/30 | resolve | first two plugins evaluated in (priority,id) order, third skipped, `truncated:true` |
| E15 | Output ordering | EP | L1 | automated | markers for `zeta`, `alpha`, and `alpha` again from two plugins | resolve | `types:["alpha","zeta"]` |
| E16 | Manifest `projectTypes` grammar | EP+BVA | L1 | automated | markers `model/*.judo`, `judo.yaml`, `a/b/c.x` (valid); `../x`, `/abs`, `a/`, `a//b`, `**/pom.xml`, `src/*`, `a\\b`, `x?.y`, `node_modules/a`, `.git/HEAD`, `./a`, `a/b/c/d` (invalid) | `validateManifest` | valid load; each invalid → `ManifestValidationError` naming plugin + pattern |
| E17 | Manifest `projectTypes` counts | BVA | L1 | automated | `projectTypes` with 8 and 9 entries; `markers` with 0, 1, 16, 17 items; `type:"Judo"` | `validateManifest` | 8 entries, 1 and 16 markers OK; 9 entries, 0 and 17 markers, uppercase type fatal |
| E18 | `projectTypes` survives discovery | EP | L1 | automated | temp plugin dir with valid `projectTypes` | `discoverPlugins(root)` | discovered `manifest.projectTypes` deep-equals input |
| E19 | Manifest without `projectTypes` unchanged | EP | L1 | automated | existing fixture manifests (demo, goal) | `validateManifest` | output identical to the pre-change snapshot |
| E20 | Endpoint status table | decision-table | L1 | automated | `cwd` missing; `cwd=relative/x`; known cwd; unknown cwd refused by `admitCwd`; `admitCwd` stubbed `indeterminate`; known-but-deleted cwd | `GET /api/folder/project` | 400; 400; 200; 403; 503 + `Retry-After` + `{error:"cwd-admission-unavailable",message,retryAfterMs}`; 404 |
| E21 | Unknown-and-missing is 403, not 404 | state-transition | L1 | automated | path that does not exist and is not known | `GET /api/folder/project` | 403 |
| E22 | Route tier | EP | L1 | automated | `ROUTE_TIERS` | MCP manifest completeness + road classification suites | `/api/folder/project` is `observe`; both suites pass |
| E23 | Predicate factories | decision-table | L1 | automated | cache entries for `/a` ready `{types:["judo"],id:null}`, `/b` ready `{types:[],id:"acme-erp"}`, `/c` loading, `/d` error | call `folderHasProjectType("judo")` and `folderHasProjectId("acme-erp")` on each | only `/a`→type true, only `/b`→id true; loading/error false |
| E24 | Cache miss queues without render-time state update | state-transition | L1 | automated | empty cache; fetch mock | predicate called 3× synchronously for `/a` in one tick | returns `false` each time; exactly 1 fetch after the microtask; no React "setState during render" warning |
| E25 | `EmbeddedApp` scope matching | decision-table | L1 | automated | `projectScope` `{type:"judo"}`, `{id:"acme-erp"}`, `{type:"judo",id:"acme-erp"}` × folder `{types:["judo"],id:null}` and `{types:["judo"],id:"acme-erp"}` | render | app mounts only where every set field matches; otherwise *Not available for this folder* with folder name, top bar and Back |
| E26 | `EmbeddedApp` without `folderParam` | EP | L1 | automated | `projectScope={{type:"judo"}}`, no `folderParam` | render | *Not available here*, app title only, no fetch |
| E27 | Unscoped `EmbeddedApp` unchanged | EP | L1 | automated | existing `embedded-app.test.tsx` fixtures, no `projectScope` | render | no `/api/folder/project` request; existing tests pass unchanged |
| E28 | Scaffold scopes | decision-table | L1 | automated | `render-new` with scope `none` / `global` / `project-type` (type `judo`, marker `model/*.judo`) / `project-specific` (id `acme-erp`) | render package | none: no app; global: depth-1 claim, no folder entry; project-type: `projectTypes` + `folderHasProjectType("judo")` predicate + `projectScope` + no `standaloneUrl`; project-specific: `folderHasProjectId("acme-erp")`; `requiredApi` = `^0.x` in all |
| E29 | Scaffold invalid input stops | EP | L1 | automated | scope `project-type` with marker `**/x`; id `ACME` | render | reports every violation, writes no file |
| E30 | Identity-file write decision table | decision-table | L1 | automated | target folder: no file; `{schemaVersion:1,type:"judo",owner:"x"}`; `{type:"judo"}` (no schemaVersion); `{schemaVersion:2}`; `{id:"legacy"}`+v1; symlinked `.pi`; 65537-byte file; invalid JSON | write id `acme-erp` after summary confirm | creates `{schemaVersion:1,id}`; merges keeping `owner`; adds `schemaVersion:1`; refuses; refuses (reports `legacy`); refuses; refuses; refuses. Every written file re-reads via the identity reader as `id:"acme-erp"` |
| E31 | Atomic write | fault-injection (abort) | L1 | automated | rename stubbed to throw after the temp write | write id | original file byte-identical; no temp file left |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | Global walk cap | concurrency invariant | L1 | automated | 20 simultaneous resolutions for distinct folders, walker stubbed to await a gate | max concurrent walks observed | ≤ 4 at every instant; all 20 complete once the gate opens |
| P2 | Per-cwd de-dup | invariant | L1 | automated | 10 simultaneous `GET /api/folder/project` for the same cwd | count of resolver invocations | exactly 1 |
| P3 | Deadline | fault-injection (delay) | L1 | automated | `opendir` stubbed to hang | response time + slot release | 200 with `truncated:true` within 2 s + 250 ms; a following resolution acquires the slot |
| P4 | Bump coalescing | invariant | L1 | automated | 50 folders cache-missed in one render, all fetches resolving in the same tick | `bumpSlotClaimsVersion` call count | 1 |
| P5 | Walk cost bound | timed micro | L1 | automated | 2000-entry tree, 256 patterns | resolver wall time on CI runner | < 500 ms |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | Folder consumers re-evaluate on bump | state-transition | L1 | automated | `SidebarFolderSectionSlot` and `WorktreeCardSectionSlot` with a claim whose predicate flips false→true | `bumpSlotClaimsVersion()` only, no prop change | entry renders in both consumers |
| F2 | Folder consumer hook order | state-transition | L1 | automated | consumer rendered without a registry, then with one | rerender | no React hook-order error |
| F3 | Folder entry appears after detection | async convergence | L3 | automated | docker harness folder containing `.pi/dashboard/demo-scoped` marker, plus a plain folder | load dashboard | demo-scoped folder entry converges to visible without reload; plain folder never shows it |
| F4 | Deep link to non-matching folder | state-transition | L3 | automated | harness plain folder | navigate to `/folder/<plain>/demo-scoped` | *Not available for this folder* with folder name; Back → `/folder/<plain>`; sidebar still interactive |
| F5 | Matching deep link + reload | state-transition | L3 | automated | harness demo-scoped folder | open `/folder/<scoped>/demo-scoped/sub` and reload | scoped demo app renders its `/sub` view in the content area |
| F6 | Existing demo app unaffected | regression | L3 | automated | existing `plugin-embedded-app.spec.ts` | run suite | all existing scenarios pass unchanged |
| F7 | Stale landing after plugin-set change | state-transition | L1 | automated | in-flight fetch for `/a` | `clearFolderProjects()` before it lands | landed result discarded; `/a` fetched again |
| F8 | Per-folder invalidation | state-transition | L1 | automated | in-flight fetches for `/a` and `/b` | `invalidateFolderProject("/b")` | `/a` result stored; only `/b` refetched |
| F9 | Enabled-set refresh without change | state-transition | L1 | automated | `usePluginEnabledSet` refresh returning the same set; then a different set | trigger `plugin_config_update` twice | first refresh: no clear; second: cache cleared |
| F10 | *Not available* copy and layout | visual | — | manual-only | not-available state on desktop and < 640 px | human review | [judgment: message legible, top bar layout consistent with *folder not found*] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | Refused cwd reads nothing | fault-injection (abort) | L1 | automated | `admitCwd` → refuse | `GET /api/folder/project` with an fs spy on paths under cwd | 403; zero fs calls under the cwd |
| X2 | Never prompts | invariant | L1 | automated | unknown cwd | request | `holdDenial` / access-prompt spy never called |
| X3 | Indeterminate logging | fault-injection (delay) | L1 | automated | `admitCwd` → indeterminate | request twice within 60 s | 503 both times; one warn `[cwd-admission] indeterminate` line via `cwdAdmissionLogger` |
| X4 | Error fails closed | fault-injection (abort) | L1 | automated | fetch rejects (network) and fetch returns 403 | predicate evaluated | both → `error`; predicates false; a bump fires on landing |
| X5 | Error expiry retry | state-transition (fake timers) | L1 | automated | `error` entry for `/a` | advance 59 s, then 60 s, with no re-render | at 59 s no refetch; at 60 s entry dropped + bump fired + next predicate call refetches |
| X6 | Parent swap after open | fault-injection | L1 | automated | `.pi/dashboard` dev/ino changes between first lstat and post-open re-check (stub) | resolve | file treated as absent |
| X7 | Directory swap during walk | fault-injection | L1 | automated | `model` dir's dev/ino changes across `opendir` (stub) | resolve | `model` skipped; no match through it |

---

## Coverage summary

- Requirements covered: 9/9. Folder identity: declared file, detection, endpoint, cache/predicates. Plus `projectScope`, manifest validation, scaffold, folder slot re-render. Route tier is a design constraint, covered by E22.
- Scenarios by class: edge 31 · perf 5 · frontend 10 · error 7
- Scenarios by level: L1 48 · L2 0 · L3 4 (F3–F6; F6 re-runs the existing suite)
- Scenarios by disposition: automated 52 · manual-only 1 (F10)

## New infra needed

- L3: the docker harness needs one extra folder whose tree contains `.pi/dashboard/demo-scoped` (seeded the way `plugin-embedded-app.spec.ts` seeds its folder). There is no new harness, only fixture data.
