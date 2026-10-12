# Test Plan — streamline-first-run

Stage: design   Generated: 2026-10-11

Hard gate passed. C1 (a resolving probe clears `failed` on the row) and C2 (the Step ② "existed" line lives for the component's lifetime) were answered and folded into the specs before this file was written.

Levels: **L1** = vitest (`packages/*/src/**/__tests__/`). **L3** = Playwright against the docker harness (`tests/e2e/`, port from `.pi-test-harness.json`). No L2 rows: no process, install or multi-OS runtime behaviour changes here.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | project-quick-create › create or reuse | EP (fresh) | L1 | automated | temp HOME with no `Projects` | `createProjectDirectory("my-first-project", home)` | `<home>/Projects/my-first-project` exists; returns `{ path: realpath(it), existed: false }` |
| E2 | project-quick-create › create or reuse | EP (root present) | L1 | automated | `<home>/Projects/` exists, no `demo` | create `"demo"` | dir created; `existed: false` |
| E3 | project-quick-create › create or reuse | EP (reuse) | L1 | automated | `<home>/Projects/demo/` with sentinel file `a.txt` | create `"demo"` | `existed: true`; `a.txt` content + mtime unchanged |
| E4 | project-quick-create › file at target | EP | L1 | automated | `<home>/Projects/demo` is a regular file | create `"demo"` | error `reason: "not_a_directory"` (→409); file bytes unchanged |
| E5 | project-quick-create › file at root | EP | L1 | automated | `<home>/Projects` is a regular file | create `"demo"` | `reason: "root_not_a_directory"` (→409); no dir created anywhere under home |
| E6 | project-quick-create › portable segment | decision table (21 names) | L1 | automated | names `../outside`, `a/b`, `a\b`, `""`, `" x"`, `"x "`, `.`, `..`, `name.`, `a:b`, `a*b`, `a?b`, `a"b`, `a<b`, `a\|b`, `con`, `CON.txt`, `aux`, `com1`, `lpt9`, `conin$`, `COM¹`, `"a\nb"`, `"a\u007fb"`, `"a\u0085b"` | create each | each → `reason ∈ {invalid_name, reserved_name}` (→400); `readdir(home)` identical before/after |
| E7 | project-quick-create › 255-byte limit | BVA | L1 | automated | names of 254, 255, 256 ASCII bytes; `"é"×127` (254 B), `"é"×128` (256 B) | create each | 254/255 B and 254 B multibyte created; 256 B ASCII and `"é"×128` → `reason: "too_long"` (→400), nothing created |
| E8 | project-quick-create › non-string name | EP | L1 | automated | bodies `{}`, `{name:42}`, `{name:null}` via route inject | POST `/api/browse/create-project` | 400 `{success:false, reason:"invalid_name"}`; fs spy shows zero fs calls; log line contains `name=<non-string>`, no throw |
| E9 | project-quick-create › containment | EP (symlink escape) | L1 | automated | `<home>/Projects/demo → <tmp>/outside/` (dir) | create `"demo"` | `reason: "outside_root"` (→400); link and `<tmp>/outside` unchanged |
| E10 | project-quick-create › strictly inside | BVA (equal to root) | L1 | automated | `<home>/Projects/demo → <home>/Projects` | create `"demo"` | `reason: "outside_root"` (→400) |
| E11 | project-quick-create › symlinked child inside | EP | L1 | automated | `<home>/Projects/demo → <home>/Projects/real-demo/` | create `"demo"` | `{ path: realpath(real-demo), existed: true }` |
| E12 | project-quick-create › symlinked root | EP | L1 | automated | `<home>/Projects → <tmp>/data/` (dir) | create `"demo"` | `<tmp>/data/demo` exists; `path` = its realpath |
| E13 | project-quick-create › dangling child link | EP | L1 | automated | `<home>/Projects/demo → <tmp>/missing` | create `"demo"` | `reason: "not_a_directory"` (→409); `<tmp>/missing` still absent |
| E14 | project-quick-create › dangling root link | EP | L1 | automated | `<home>/Projects → <tmp>/missing` | create `"demo"` | `reason: "root_not_a_directory"` (→409); nothing created |
| E15 | project-quick-create › home missing | EP | L1 | automated | `homeDir` = non-existent path | create `"demo"` | `reason: "home_missing"` (→500); `homeDir` still absent |
| E16 | project-quick-create › guarded and tiered | completeness | L1 | automated | `ROUTE_TIERS`, MCP manifest + denylist | run route-tier completeness + `mcp-manifest-completeness.test.ts` | `POST /api/browse/create-project` resolves to tier `control`; denylisted; no generated tool name contains `create_project` |
| E17 | project-quick-create › insufficient tier | EP | L1 | automated | credential below `control` | POST create-project | rejected by the tier gate; temp HOME `readdir` unchanged |
| E18 | project-quick-create › network guard | EP | L1 | automated | request the network guard rejects (untrusted origin) | POST create-project | rejected; no dir created |
| E19 | anthropic-peer-hint › decision rules 1–2 | decision table | L1 | automated | health body peer `{ok:false, reason:"import failed: x"}`; then `{ok:true}`; recommended `activeInPi:false` | `ensureInstall("sign-in")` | zero `packageQueue.enqueue` calls; store `outcome: null` |
| E20 | anthropic-peer-hint › decision rule 3 | decision table (fail-open) | L1 | automated | recommended → 500; → network error; → 200 without `pi-anthropic-messages` entry | `ensureInstall` | zero enqueues; store `null`; no throw escapes |
| E21 | anthropic-peer-hint › rule 4 | decision table | L1 | automated | no probe; recommended `activeInPi:true` (also with probe `ok:false` = stale) | `ensureInstall` | zero enqueues; store `null` |
| E22 | anthropic-peer-hint › rule 5 (pending install) | decision table | L1 | automated | queue has `install` of the peer source running (enqueued by another caller) | `ensureInstall` | enqueue count stays 1; store `running`; that op's success → store `installed` |
| E23 | anthropic-peer-hint › rule 5 (pending remove not followed) | decision table | L1 | automated | queue has `remove` of the peer source pending; `activeInPi:false` | `ensureInstall` | one new op `{ source:"npm:@blackbelt-technology/pi-anthropic-messages", action:"install", scope:"global" }` queued; store does not latch on the remove's success |
| E24 | anthropic-peer-hint › rule 6 constants | decision table | L1 | automated | first run: no `lastProbe`; `activeInPi:false`; response bodies carry extra fields (`source:"npm:evil"`, `installed.scope:"local"`) | `ensureInstall` | exactly one enqueue with the constant source, `action:"install"`, `scope:"global"` |
| E25 | anthropic-peer-hint › trigger scope | EP | L1 | automated | `ProviderAuthSection` mounted | complete flows `anthropic`, `openai-codex`, `github-copilot`; save `anthropic-api` key; save custom endpoint; mount with `anthropic` already authenticated | `ensureInstall` called exactly once, only for `anthropic` flow completion |
| E26 | anthropic-peer-hint › never blocks sign-in | state | L1 | automated | `/api/packages/recommended` never resolves | `finishFlow("anthropic")` | synchronously: store `deciding`; same tick: dialog closed and `provider-auth-event` dispatched; `finishFlow` returns before any fetch settles |
| E27 | anthropic-peer-hint › decided afresh / seq | state-transition | L1 | automated | completion #1 decision pending; sign-out (true→false), sign-in completion #2 | #1's fetch then rejects | #2 decides (second fetch pair issued); #1's rejection does not reset #2's `deciding`/`running` |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | landing › Step ① peer row request gating | request-count invariant | L1 | automated | render `LandingPage` across states: step1 pending; step1 done + `anthropicAuthenticated` false; `"unknown"`; `true` | fetch calls to `/api/packages/recommended` and `/api/health` from Landing = 0, 0, 0, ≥1 respectively | one render + 1 s fake timers |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | peer row › outcome survives unmount | state-convergence | L1 | automated | store `running` on own install; no React subscriber mounted | queue op succeeds; advance fake timers 3 500 ms (past `SUCCESS_AUTOCLEAR_MS`) | store `installed`; mounting the row then shows `anthropic-peer-autoinstall` with installed copy |
| F2 | peer row › failed latch | state-transition | L1 | automated | store `running` | op completes with error `"npm ERR! ENOTFOUND"` | store `failed`, `message` = that string |
| F3 | peer row › recovery vs remove | state-transition | L1 | automated | store `failed` | (a) another surface's `install` succeeds; (b) instead a `remove` succeeds | (a) `installed`; (b) stays `failed` |
| F4 | peer row › reset tri-state | state-transition | L1 | automated | store `running`; `anthropicAuthenticated` sequence `true→unknown(fetch 500)→true`, then `true→false` | App effect runs per value; then the op succeeds | after `unknown`: store unchanged; after `false`: store `null`, and the late success leaves it `null` |
| F5 | peer row › clears on resolving probe | state-transition | L1 | automated | store `installed` (then separately `failed`) | probe poll returns peer `ok:true` | no `anthropic-peer-autoinstall`, no retry button rendered |
| F6 | missing-peer hint › precedence | decision table | L1 | automated | row authenticated; combos: probe {none, missing, import-failure} × store {null, running, installed, failed} | render | exactly one surface: import-failure → hint import form; else store≠null → auto surface; else probe missing → existing hint; never two install controls (`getAllByRole('button',{name:/install/i}).length ≤ 1`) |
| F7 | peer row › failed rendering | EP | L1 | automated | store `failed`, message `"npm ERR! code E404"` | render row | first text sentence = generic "didn't finish… try again" copy; raw text not visible until the `LogBlock` toggle is clicked; Retry has the secondary recipe; Sign Out enabled; status wrapper `role="status"` `aria-live="polite"` |
| F8 | landing › stepper structure | decision table (creds × pinned × sessions, 8 rows) | L1 | automated | each combination incl. creds=0, pinned=1, sessions=0 | render `LandingPage` | one `<ol>`; `onboarding-progress` text "n of 3"; ≤1 element with primary class; only first pending step expanded; locked/later-pending rows contain no `button`/`input`; pinned-before-credentials → Step ③ line names Step ① |
| F9 | landing › Step ② create success | EP | L1 | automated | step2 pending; `onCreateProject` resolves `{path:"/h/Projects/my-first-project", existed:false}` | click `onboarding-step-2-create` with default value | called once with `"my-first-project"`; `onboarding-step-2-cta` click instead calls `onOpenPinDialog` |
| F10 | landing › in-flight | state | L1 | automated | `onCreateProject` pending promise | click Create twice | called once; field, Create and link disabled; Create has `aria-busy="true"` and "Creating…" |
| F11 | landing › error mapping | EP (reasons) | L1 | automated | rejections with `{reason}` ∈ {invalid_name, reserved_name, too_long, outside_root, not_a_directory, root_not_a_directory, home_missing, fs_error}, unknown `"xyz"`, and Fastify 404 body `{statusCode:404,error:"Not Found"}` | submit `"my/project"` | `onboarding-step-2-error` sits between label and input in DOM order; localized copy per reason, generic copy for unknown/404; input `aria-invalid="true"`, value still `"my/project"`; nothing pinned |
| F12 | landing › existed note lifetime (C2) | state-transition | L1 | automated | create resolves `existed:true`; parent bumps `pinnedCount` | render → unmount → remount `LandingPage` | `onboarding-step-2-existed` present after create; absent after remount |
| F13 | landing › Step ① peer status table | decision table (7 rows) | L1 | automated | `Step1PeerStatus` with probe {importFailed, resolving, none} × store {deciding, running, failed, installed, null} × entry {activeInPi true/false} | render | first-match content per spec rules 1–7; testids `onboarding-step-1-peer-status`/`-install`/`-retry`; Install/Retry secondary recipe |
| F14 | landing › manual Install path | state-transition | L1 | automated | row shows manual Install; next fresh probe read reports import failure | click `onboarding-step-1-peer-install` | zero enqueues; row shows "failed to load" warning; with a clean probe instead → one global enqueue and in-progress status |
| F15 | App › onCreateProject wiring | EP | L1 | automated | mocked `fetch` for create-project: success `{path:"/real/x"}`; failure 409 | `onCreateProject("x")` from App's `renderLanding` | success: `pin_directory` sent once with `"/real/x"`, pinned list optimistic; failure: no `pin_directory` sent |
| F16 | landing › create → pin → start (real server) | end-to-end | L3 | automated | fresh harness container (credentials seeded, no pins) | fill name `e2e-first`, click `onboarding-step-2-create`, then `onboarding-step-3-cta` | sidebar shows folder `e2e-first`; Step ② done; a session is created whose cwd ends `/Projects/e2e-first` |
| F17 | landing › server rejection rendered (real server) | end-to-end | L3 | automated | fresh harness | submit name `a/b` | `onboarding-step-2-error` visible with invalid-name guidance; sidebar folder count unchanged; `onboarding-step-2-cta` still opens `add-folders-dialog` |
| F18 | landing › visual parity S1–S8 | visual/subjective | — | manual-only | promoted Landing + provider row in an isolated env | human compares against `mockups/index.html` scenarios in base dark, base light, nord | [judgment: layout, hierarchy and copy match the approved mockup] |
| F19 | peer status › screen-reader announcement | assistive-tech | — | manual-only | VoiceOver on macOS | auto-install runs then fails | [judgment: "Installing…" and the failure warning are announced once each, politely] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | anthropic-peer-hint › bounded decision | fault-injection (delay) | L1 | automated | `/api/packages/recommended` never responds | `ensureInstall`; advance fake timers 20 001 ms | store `null`; zero enqueues; no unhandled rejection |
| X2 | peer row › retry (store) | fault-injection (abort) | L1 | automated | install op fails; then a retry op succeeds | `retry()`, then `retry()` again while that install is pending | `running` → `installed`; the second retry enqueues nothing |
| X7 | peer row › retry (row) | fault-injection (abort) | L1 | automated | store `failed` | click the Anthropic row's Retry | row shows in-progress, then installed on op success |
| X8 | landing › Step ① retry | fault-injection (abort) | L1 | automated | store `failed` | click `onboarding-step-1-peer-retry` | in-progress status, then no peer status once the install succeeds |
| X3 | project-quick-create › unexpected fs error | fault-injection (abort) | L1 | automated | POSIX: `<home>/Projects` mode `0500` | create `"demo"` | `reason: "fs_error"` (→500); no `demo` entry; response is the `{success:false,error,reason}` envelope |
| X4 | project-quick-create › escape detected after creation | fault-injection (race) | L1 | automated | `fs.promises.realpath` stubbed to return `/elsewhere/demo` for the target after a real `mkdir` | create `"demo"` | `reason: "outside_root"` (→400); the just-created `<root>/demo` removed (`lstat` → ENOENT); a pre-existing link at that name is never removed |
| X5 | anthropic first-run, real subscription | real OAuth | — | manual-only | clean machine (fresh `~/.pi`), real Claude Pro/Max account, desktop + Electron | sign in via Settings › Providers, return to Landing, create project, start session, ask for a tool call | [judgment: no manual install step needed; the first Claude tool call succeeds] |
| X6 | project-quick-create on Windows | real OS | — | manual-only | Windows 11 user profile | Landing create with `my-first-project`, then `con`, then a 250-char name | [judgment: first creates `%USERPROFILE%\Projects\my-first-project`; the others show guidance, no stray folders] |

---

## Coverage summary

- Requirements covered: 14/14 delta requirements, plus the C1/C2 answers:
  - project-quick-create: 4;
  - anthropic-peer-hint: 4 (2 ADDED, 2 MODIFIED);
  - landing-page-onboarding: 5 (1 ADDED; Empty-state, Step ①, Step ② and Step ③ MODIFIED);
  - pinned-directories-ui: 1 (F17, plus the existing `pinDirectory` E2E helper).
- Scenarios by class: edge 27 · perf 1 · frontend 19 · error 8
- Scenarios by level: L1 49 · L3 2 · manual 4
- Scenarios by disposition: automated 51 · manual-only 4

## New infra needed

- none. The L3 rows reuse the docker harness. The OAuth trigger is covered at L1 only, because the harness cannot drive a real Anthropic OAuth completion (X5 covers it manually).
