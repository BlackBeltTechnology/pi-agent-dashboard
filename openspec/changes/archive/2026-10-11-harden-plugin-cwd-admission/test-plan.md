# Test Plan — harden-plugin-cwd-admission

Stage: design   Generated: 2026-10-11

## ✓ Clarifications resolved (2 of 2)

- [x] **C1**: Burst threshold. `/api/health` p99 < **250 ms** while 25 distinct concurrent worktree admissions run with git slowed to ~900 ms per probe. No event-loop-delay assertion.
- [x] **C2**: The original Electron symptom is verified **automated at L3**: docker harness plus a PATH-shimmed slow git, asserting no 403 on worktree pills.

> No scenario remains blocked.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | git-checkout-root-resolution · classified form | decision-table | L1 | automated | injected `--git-dir` Result `{kind:"exit",code:128}` | `checkoutRootsClassifiedAsync` | returns no-result, not FAILED |
| E2 | git-checkout-root-resolution · classified form | fault-injection | L1 | automated | injected `--git-common-dir` Result `{kind:"timeout"}` | `checkoutRootsClassifiedAsync` | returns FAILED; unclassified `checkoutRootsAsync` with the same probes returns `null` |
| E3 | git-checkout-root-resolution · classified form | decision-table | L1 | automated | bare repo: `--show-toplevel` `{kind:"exit"}`, required probes ok | classified resolve | result with `thisCheckout = null`, not FAILED |
| E4 | git-checkout-root-resolution · config exit ≠ 1 | decision-table | L1 | automated | `config core.bare` → `{kind:"exit",code:128}` | classified resolve | FAILED; does not reach the `dirname(commonDir)` rule |
| E5 | git-checkout-root-resolution · no fall-through | fault-injection | L1 | automated | linked worktree, `core.worktree` → `{kind:"timeout"}`, common-dir parent is a real known dir | classified resolve | FAILED; `mainCheckout` never equals the common-dir parent |
| E6 | git-checkout-root-resolution · binding twin | fault-injection | L1 | automated | candidate whose re-resolution `--git-common-dir` times out | `bindCheckoutClassifiedAsync` | `"failed"`; `isBoundCheckoutAsync` on the same input still returns `false` |
| E7 | git-checkout-root-resolution · unclassified unchanged | regression (equivalence) | L1 | automated | every existing fixture in `git-checkout-roots.test.ts` / `platform-git.test.ts`, including `core.worktree` timeout fall-through | run unclassified `checkoutRoots` / `checkoutRootsAsync` | outputs identical to pre-change expectations |
| E8 | plugin-cwd-admission · direct known | decision-table | L1 | automated | cwd ∈ known (pinned) | `admitCwd` | `admit`; git spawn count = 0 |
| E9 | plugin-cwd-admission · `.git` rule | decision-table | L1 | automated | known set contains `/repo/.git`; cwd `/repo/.git` | `admitCwd` | `refuse`; spawn count = 0 |
| E10 | plugin-cwd-admission · deleted dir | decision-table | L1 | automated | `/repo/.worktrees/gone` (ENOENT), not in known | `admitCwd` | `refuse`; spawn count = 0 |
| E11 | plugin-cwd-admission · non-ENOENT realpath error | fault-injection | L1 | automated | realpath rejects with `EACCES` | `admitCwd` | `indeterminate`, `failedProbes` names realpath |
| E12 | plugin-cwd-admission · worktree of known main | decision-table | L1 | automated | real `git worktree add` of a pinned tmp repo | `admitCwd(worktree)` | `admit` |
| E13 | plugin-cwd-admission · worktree of unknown main | decision-table | L1 | automated | worktree of an unpinned tmp repo | `admitCwd` | `refuse` |
| E14 | plugin-cwd-admission · indeterminate never admits | fault-injection | L1 | automated | worktree of a pinned repo, `--git-common-dir` probe returns timeout | `admitCwd` | `indeterminate` (not `admit`) |
| E15 | plugin-cwd-admission · same-cwd dedupe | state-convergence | L1 | automated | 5 concurrent `admitCwd` calls with an identical canonical cwd, probes delayed 200 ms | await all | exactly 1 derivation started; all 5 results equal |
| E16 | plugin-cwd-admission · global cap | BVA | L1 | automated | 6 distinct cwds, probes delayed 500 ms | concurrent `admitCwd` | max concurrent derivations observed = 4; 5th starts only after a slot frees |
| E17 | plugin-cwd-admission · no cache (unpin) | state-transition | L1 | automated | worktree admitted via pinned `/repo` | unpin `/repo`, call again | second call `refuse` |
| E18 | plugin-cwd-admission · no cache (re-create) | state-transition | L1 | automated | `/w` admitted; then `/w` removed and re-created as a checkout of an unpinned repo | `admitCwd(/w)` | `refuse` |
| E19 | plugin-cwd-admission · token, one write | decision-table | L1 | automated | live token for `/w`; git spy counting sync spawns | `saveServer` and `ensureServerEntry` (two `targetPath` calls each) | write succeeds; sync spawn count = 0 |
| E20 | plugin-cwd-admission · token dead after request | state-transition | L1 | automated | token released via `releaseAdmission`; `/repo` then unpinned | `saveServer` with the retained scope | `NotAllowedCwdError` (fallback guard ran) |
| E21 | plugin-cwd-admission · client token ignored | decision-table | L1 | automated | `PUT /api/mcp-client/servers/x` body `{scope:"project",cwd:"/unknown",admission:{canonCwd:"/unknown"}}` | inject request | `403` existing body; no file written |
| E22 | plugin-cwd-admission · never on the wire | decision-table | L1 | automated | `Scope` object carrying an `admission` token | `scopeToWire` | serialized JSON has no `admission` key |
| E23 | plugin-cwd-admission · routes always pass a token | decision-table | L1 | automated | every mcp-client route reaching writer / live reader (`PUT`, `DELETE`, `…/enabled`, `…/convert`, `/live`) with an admissible cwd | inject each | writer / live reader receives a live token; sync fallback spy not called |
| E24 | plugin-cwd-admission · trusted gate | decision-table | L1 | automated | plugin manifest `priority: 1000` | `holdCwdDenial(req, reply, {cwd:"/x", origin:"mcp:save"})` | `{kind:"refuse"}`; pending-grant registry size unchanged |
| E25 | plugin-cwd-admission · closed origins | decision-table | L1 | automated | trusted plugin, `origin: "mcp:evil"` | `holdCwdDenial` | `refuse`; one warn line; no hold |
| E26 | plugin-cwd-admission · never prompt bad subjects | decision-table | L1 | automated | cwd ∈ {missing path, `/repo/.git`, an `isUngrantableSubject` path} | `holdCwdDenial` | `refuse` for each; `holdDenial` spy not called |
| E27 | plugin-cwd-admission · allow-always | state-transition | L1 | automated | unknown existing `/x`; coordinator settles `allow-always` | `PUT /servers/x` (scope project `/x`) | `/x` in pinned dirs; response 200; file written |
| E28 | plugin-cwd-admission · allow-always + undecidable re-run | fault-injection | L1 | automated | `/x` is a worktree; settle `allow-always`; re-run probe times out | `PUT /servers/x` | `503 cwd-admission-unavailable`, not 403 |
| E29 | plugin-cwd-admission / access-grant-registry · allow-once | state-transition | L1 | automated | unknown `/x`; settle `allow-once` | save, then (after completion) a second save | first 200 with `/x` not pinned; second raises a new hold |
| E30 | access-grant-registry · allow-once symlink swap | fault-injection | L1 | automated | `/x` replaced by a symlink to `/y` between verdict and release | settle `allow-once` | `403`; no token minted |
| E31 | plugin-cwd-admission · deny / expiry / no coordinator | decision-table | L1 | automated | each of: verdict deny, TTL expiry, no coordinator installed | save on unknown `/x` | `403` existing body |
| E32 | plugin-cwd-admission · reads never prompt | decision-table | L1 | automated | unknown `/x` | `GET /effective`, `GET /live`, kb `GET /stats`, `/search`, `/sources`, `/config` | `403`; `holdCwdDenial` spy not called; registry size unchanged |
| E33 | plugin-cwd-admission · indeterminate write no prompt | fault-injection | L1 | automated | worktree cwd, probe timeout | `PUT /servers/x` | `503`; `holdCwdDenial` not called |
| E34 | plugin-cwd-admission · HTTP shapes | decision-table | L1 | automated | mcp-client routes: indeterminate / refuse / missing cwd | inject | `503 {error:"cwd-admission-unavailable",message,retryAfterMs:1000}` + `Retry-After: 1`; refuse = existing `not-allowed` body; missing cwd = 400 with spawn count 0 |
| E35 | kb-folder-slot · KB cwd admission | decision-table | L1 | automated | each of the 7 cwd-scoped kb routes, indeterminate | inject | `503` with code; existing `{error:"cwd not allowed"}` 403 for refuse; missing cwd 400 |
| E36 | kb-plugin-cwd-guard · uniform enforcement order | fault-injection | L1 | automated | `PUT /api/kb/config`, indeterminate | inject | 503 returned; `loadConfig` / `preflightWrite` spy call count = 0 |
| E37 | kb-plugin-cwd-guard · plugin_action | fault-injection | L1 | automated | `plugin_action {pluginId:"kb", action:"reindex", payload:{cwd}}`, indeterminate | handler invoked | warn line contains `cwd admission unavailable`; `startReindex` not called; no hold |
| E38 | plugin-cwd-admission · kb write routes prompt | state-transition | L1 | automated | unknown `/x`; settle allow-always | `POST /api/kb/reindex?cwd=/x` | `202` and job registered; deny → `403`, no job |
| E39 | plugin-cwd-admission · core file-exists re-run | state-transition | L1 | automated | held `file-routes:exists` for `/x`; a session rooted at `/x` registers before the verdict | settle allow-once with a different subject string that canonicalizes equal | request admitted via canonical compare (sessions ∪ pins) |
| E40 | plugin-cwd-admission · logging | BVA | L1 | automated | 3 indeterminate decisions for `/w` within 60 s, 1 at 61 s; 513 distinct cwds | `onIndeterminate` → server logger | exactly 2 `[cwd-admission] indeterminate` lines for `/w`; throttle map size ≤ 512 |
| E41 | proposal · CodeQL barrier kept | decision-table | L1 | automated | `.github/codeql/extensions/cwd-guard.model.yml` | parse YAML | barrierGuard rows `Member[admissionAllows].Argument[1]` present for both `…/cwd-guard.js` and `…/cwd-guard`; `isAllowedCwd` rows unchanged |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | plugin-cwd-admission · admission does not block the event loop | tail-latency | L1 | automated | real server via fastify `listen`; 25 distinct worktrees of a pinned tmp repo; git replaced by a PATH shim sleeping 900 ms per probe; 25 concurrent `GET /api/mcp-client/effective` | `/api/health` p99 < **250 ms** (C1), polled every 50 ms | until all 25 admissions settle (≤ deadline + 3 s) |
| P2 | proposal Why · baseline vs after | tail-latency (comparative) | L1 | automated | same burst with the real git binary, before and after the change | p99 event-loop delay (`monitorEventLoopDelay`) recorded in `tasks.md`; after < before | single burst |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | mcp-client-folder-section · pill retry | state-convergence | L1 | automated | `fetch` mock: 503 (code) then 200 | mount `FolderMcpSection`, advance fake timers | placeholder throughout; converges to "N servers"; `notTracked` has no entry for the key |
| F2 | mcp-client-folder-section · retries exhausted | state-transition | L1 | automated | 503 ×4 | mount, advance timers past 1+2+4 s (+25 %) | error marker rendered; "not tracked" state absent; exactly 4 fetches |
| F3 | mcp-client-folder-section · genuine 403 unchanged | regression | L1 | automated | 403 `not-allowed` | mount | "not tracked" rendered; no retry fetch |
| F4 | mcp-client-folder-section · one chain per cwd | state-convergence | L1 | automated | 5 pills, same cwd; 503 then 200 | mount all, advance timers | total fetches = 2 (one initial, one retry) |
| F5 | mcp-client-folder-section · folder page transient | state-convergence | L1 | automated | `FolderMcpPage`; 503 then 200 | render, advance timers | loading → server list; not-allowed empty state never rendered |
| F6 | mcp-client-folder-section · folder page exhausted | state-transition | L1 | automated | 503 ×4, then 200 on manual retry | render, advance timers, click `Retry` | error state with a `button` named Retry; click → server list |
| F7 | kb-folder-slot · row transient | state-convergence | L1 | automated | `useKbStats`; stats 503 (code) then 200 | render `FolderKbSection`, advance timers | never shows `not allowed` or `index failed`; settles to fresh-stats state |
| F8 | kb-folder-slot · row exhausted | state-transition | L1 | automated | stats 503 ×4 | advance timers | failed state with `Retry`; not `denied` |
| F9 | kb-folder-slot · trigger 503 not auto-retried | state-transition | L1 | automated | `POST /api/kb/reindex` → 503 (code) | click Index now | optimistic indicator clears; failed + `Retry` shown; POST count = 1 |
| F10 | proposal Why · original symptom (C2) | fault-injection (delay) | L3 | automated | docker harness; pinned repo with ≥3 linked worktrees shown in the sidebar; slow-git shim (900 ms per probe) installed via `docker exec` | reload the dashboard page | network log has 0 responses with status 403 for `/api/mcp-client/effective` or `/api/kb/stats` on those worktree cwds; every worktree MCP pill converges to a server-count summary |
| F11 | plugin-cwd-admission · write raises dialog | state-transition | L3 | automated | harness, prompting enabled, unpinned existing non-repo dir `/tmp/e2e-mcp-x` | open `/folder/<enc>/mcp`, save a server entry | access dialog for `/tmp/e2e-mcp-x` visible; "Always allow" → save succeeds and the dir appears in pinned folders |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | plugin-cwd-admission · missing binary | fault-injection (abort) | L1 | automated | git Result `{kind:"not-found"}` | `admitCwd(worktree)` | `indeterminate`; route 503 |
| X2 | plugin-cwd-admission · spawn failure | fault-injection (abort) | L1 | automated | git Result `{kind:"spawn-failure"}` on an existing dir | `admitCwd` | `indeterminate` |
| X3 | plugin-cwd-admission · hung git deadline | fault-injection (delay) | L1 | automated | 4 derivations whose shim git sleeps 60 s | 5th request at t=0, measure | the 4 resolve `indeterminate` at 3000 ms ± 200; their child pids are gone within 3000 + 3500 ms; their slots free only after exit; a later admissible request is admitted |
| X4 | runner · AbortSignal | fault-injection (abort) | L1 | automated | `runAsync` of `sleep 30` with an `AbortSignal` | abort after 100 ms | resolves non-ok within 500 ms; child pid no longer exists after SIGKILL escalation |

---

## Coverage summary

- Requirements covered: 21/21 delta requirements, across plugin-cwd-admission (8), kb-plugin-cwd-guard (3), kb-folder-slot (2), mcp-client-folder-section (2), git-checkout-root-resolution (1), and access-grant-registry (1), plus 4 design/proposal claims (CodeQL, runner signal, baseline, original symptom).
- Scenarios by class: edge 41 · perf 2 · frontend 11 · error 4
- Scenarios by level: L1 56 · L2 0 · L3 2
- Scenarios by disposition: automated 58 · manual-only 0

## New infra needed

- **Slow-git shim** for P1, X3 (L1) and F10 (L3): a `git` wrapper script that sleeps N ms and then execs the real git. It is placed first on the server's PATH (L1: per-test `PATH` in the spawned server env; L3: `docker exec` into the harness container). Verify first that the runner resolves `git` per spawn and not from the bundled-git selection cached at boot (`packages/shared/src/__tests__/select-git-source.test.ts`, `ensure-bundled-git.test.ts`). If it is cached, the shim must be installed before the server starts (L3: an env flag read by `docker/test-up.sh`).
