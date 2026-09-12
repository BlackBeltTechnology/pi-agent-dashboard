# Test Plan — widen-containment-to-resolved-checkout

Stage: design   Generated: 2026-05-15

All scenarios are L1 (vitest) — every requirement is server/shared logic reachable
in-process via `buildGitFixtures()` and Fastify `inject`. No new harness. Fixture
states: normal, normalSubdir, worktree, submodule, submoduleWorktree, bare,
bareWorktree, separateGitDir, dotGitNamedCheckout, nonRepo. Adversarial rows set
`git config --local core.worktree <path>` on the fixture's common dir at test time.

Exemplars: `packages/shared/src/platform/__tests__/git-checkout-roots.test.ts`
(resolver), `packages/server/src/lib/__tests__/path-containment.test.ts`
(containment helper), `packages/server/src/__tests__/file-absolute-containment.test.ts`
(route-level), `packages/kb-plugin/src/server/__tests__/kb-routes.test.ts` (guard; its existing `.git`-segment implausible-main test is the adversarial pattern to copy).

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | resolver: three facts + `commonDir` | EP over 9 states | L1 | automated | each fixture state | `checkoutRoots({cwd})` | `commonDir` = normal→`<normal>/.git`, submodule→`<super>/.git/modules/models/sub`, bareWorktree→hub dir, separateGitDir→`elsewhere.git`; `thisCheckout`/`mainCheckout` unchanged from the current suite |
| E2 | resolver: sync/async parity | EP over 9 states + nonRepo | L1 | automated | each fixture state and nonRepo dir | `await checkoutRootsAsync({cwd})` vs `checkoutRoots({cwd})` | `toEqual` for every state; nonRepo → both `null` |
| E3 | binding: honest main is bound | positive control | L1 | automated | `worktree` fixture, no `core.worktree` | `isBoundCheckout(roots.mainCheckout, roots.commonDir)` | `true`; async twin `true` |
| E4 | binding: worktree-of-submodule binds to submodule checkout | positive control | L1 | automated | `submoduleWorktree` fixture | bind `roots.mainCheckout` (= submodule checkout) | `true` |
| E5 | binding: sibling linked worktree is bound | positive control | L1 | automated | repo with two linked worktrees; `core.worktree` on common dir = the other worktree | bind resolved `mainCheckout` from worktree A | `true` (repo owns it) |
| E6 | binding: unrelated KNOWN checkout is unbound | decision-table row | L1 | automated | worktree of repo A; `core.worktree` = `<repoB>` (ordinary checkout) | bind `mainCheckout` | `false` — different `commonDir` |
| E7 | binding: outside any repository / nonexistent | decision-table rows | L1 | automated | `core.worktree` = `os.tmpdir()`-fresh dir; = `<tmp>/does-not-exist` | bind | `false` for both |
| E8 | binding: `$HOME`-style dotfiles repo | decision-table row | L1 | automated | `core.worktree` = a separate ordinary repo that CONTAINS the worktree's parent dir | bind | `false` — different `commonDir` even though it contains cwd |
| E9 | binding: inside own git dir | decision-table row | L1 | automated | `core.worktree` = `<repo>/.git/x` (dir created) | bind | `false` by `.git`-segment test; AND with segment test bypassed (call the inner re-resolve directly) still `false` |
| E10 | binding: subdirectory of true main (MEASURED) | decision-table row | L1 | automated | `core.worktree` = `<main>/sub/dir` | bind | either `false`, OR `true` with the re-resolved `thisCheckout` samePath `<main>/sub/dir`; assert NEVER `<main>` |
| E11 | binding: candidate symlink | realpath | L1 | automated | symlink `<tmp>/link` → honest main checkout; candidate = symlink path | bind | `true`, compare done on realpaths (skip on Windows if symlink creation unavailable) |
| E12 | containment: cwd fast path | positive | L1 | automated | any state, `resolved` under cwd | `isAllowed(resolved,{anchors:[cwd]})` | `true` and git NOT spawned (spy on `checkoutRootsAsync` = 0 calls) |
| E13 | containment: own-checkout root from subdir cwd | EP over widening states | L1 | automated | cwd = subdir of normal / submodule / bareWorktree / separateGitDir / dotGitNamedCheckout; resolved = `<checkout>/README.md` | `isAllowed` | `true` for all five (submodule, bareWorktree, separateGitDir are RED on current code) |
| E14 | containment: worktree → main checkout file | positive | L1 | automated | cwd = `worktree` subdir; resolved = `<normal>/node_modules/x/package.json` | `isAllowed` | `true` |
| E15 | containment: submodule never reaches superproject | "never" cell | L1 | automated | cwd = submodule subdir; resolved = `<super>/.env` | `isAllowed` | `false` |
| E16 | containment: worktree-of-submodule reaches submodule, not modules dir | "never" cell | L1 | automated | cwd = submoduleWorktree; resolved = `<super>/models/sub/README.md` and `<super>/.git/modules/models/x` | `isAllowed` | `true` / `false` |
| E17 | containment: separate-git-dir never reaches git-dir parent | "never" cell | L1 | automated | cwd = separateGitDir subdir; resolved = `<elsewhere>/x` | `isAllowed` | `false` |
| E18 | containment: bare-hub worktree never reaches hub parent | "never" cell | L1 | automated | cwd = bareWorktree subdir; resolved = `<hubs>/x` | `isAllowed` | `false` |
| E19 | containment: bare cwd is cwd-only | EP | L1 | automated | cwd = bare; resolved = `<bare-parent>/x` | `isAllowed` | `false` |
| E20 | containment: unbound `core.worktree` does not widen | decision-table | L1 | automated | worktree cwd; `core.worktree` = `/` and = unrelated checkout; resolved = a file under that dir outside the repo | `isAllowed` | `false` for both |
| E21 | containment: outside everything | EP | L1 | automated | any state; resolved = `/etc/passwd` (or `C:\Windows\win.ini`) | `isAllowed` | `false` |
| E22 | containment: dedupe before binding | count | L1 | automated | normal cwd (thisCheckout == mainCheckout) | `checkoutAnchors(cwd)` with spy on binding | binding called once; result length 1 |
| E23 | containment: per-anchor widening preserved for pinned dir | positive | L1 | automated | `GET /api/file/exists` with pinned dir = `<normal>/packages/x`, no session cwd there; path = `<normal>/README.md` | inject | `200` (not `"path outside cwd"`) |
| E24 | route: submodule session, own checkout vs super | EP | L1 | automated | session cwd = submodule subdir; `GET /api/file?path=<sub>/README.md` and `?path=<super>/.env` | inject | `200` / `403 {success:false,error:"path outside working directory"}` |
| E25 | route: per-site strings unchanged | regression | L1 | automated | `GET /api/file/exists` with path outside all anchors; `GET /api/file/tree` outside cwd | inject | `"path outside cwd"` / `"path outside working directory"` — existing assertions still green |
| E26 | route: `~/.pi` anchor unchanged on read/raw/render | regression | L1 | automated | fake HOME; path under `~/.pi` outside cwd | inject read, raw, render | `200` all three; `exists` for the same path → `403` |
| E27 | guard: unrelated known folder via `core.worktree` | decision-table (spec scenario) | L1 | automated | known = `<repoB>`; worktree of unknown repo A with `core.worktree` = `<repoB>` | `GET /api/kb/stats?cwd=<worktreeA>` | `403`; store-open spy = 0 (RED on current code) |
| E28 | guard: honest positive controls | regression | L1 | automated | known = `<normal>`; cwd = its worktree; known = `<sub>`; cwd = submoduleWorktree; known = `/repo`; cwd = `/repo/src` | inject | all admitted (`200`); E19 still `403` |
| E29 | guard: reach is measured, not assumed | measurement (spec scenario) | L1 | automated | admitted known cwd whose `knowledge_base.json` names source `<outside-abs-dir>` and `dbPath` `<outside-abs>/kb.db` | `POST /api/kb/reindex` | outside dir's file appears in index; `<outside-abs>/kb.db` exists on disk |
| E30 | separators/drive case (Windows) | platform injection | L1 | automated | anchor reported `C:/repo` forward-slash; resolved `C:\repo\x` with injected win32 platform helpers | compare | contained = `true` (existing separator test carried over) |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | guard: 2 s synchronous ceiling | threshold | L1 | automated | slow `git` shim (sleeps 5 s per call) on PATH via `FIXTURE_GIT_ENV`; worktree cwd with `core.worktree` set so binding runs | wall time of `isAllowedCwd` ≤ 2.5 s (10 × 200 ms + slack) and result = reject | single call |
| P2 | containment: no-spawn fast path | count | L1 | automated | 100 in-cwd reads | `checkoutRootsAsync` spy calls = 0 | single test |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | live smoke: submodule session in the dashboard | end-to-end human check | — | manual-only | real dashboard session whose cwd is a submodule subdir | open a file at the submodule root, then a superproject file, in the file viewer | [judgment: viewer shows the first, shows the 403 error state for the second — no submodule fixture in the docker harness; deferred post-merge] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | containment: probe timeout fails closed | fault-injection (delay) | L1 | automated | slow `git` shim (sleeps 5 s); `checkoutRootsAsync` timeout 200 ms | `isAllowed(out-of-cwd path)` | `false` within < 1.5 s; NOT a derived path |
| X2 | containment: event loop stays responsive | fault-injection (delay) | L1 | automated | same shim; timeout 2 s | start `isAllowed(out-of-cwd)`, then immediately `GET /api/health` via inject | health resolves in < 200 ms while containment is pending |
| X3 | resolver async: degraded probe parity | fault-injection (abort) | L1 | automated | injected probes: `--show-toplevel` throws; separately `core.bare` throws | sync core vs async wiring over identical injected probes | identical results; bareness `"unknown"` never `"not-bare"` |
| X4 | resolver async: timeout | fault-injection (delay) | L1 | automated | slow shim; `checkoutRootsAsync({timeout: 1})` | call | `null` (no partial result) |
| X5 | binding: probe failure/timeout → unbound | fault-injection (abort) | L1 | automated | binding with `timeout: 1` on slow shim; and `git` missing from PATH | `isBoundCheckout` / async | `false` both |
| X6 | containment: git missing | fault-injection (abort) | L1 | automated | PATH without git; worktree cwd | `isAllowed(<main>/file)` | `false` (cwd-only) |
| X7 | containment: symlink escape | realpath | L1 | automated | symlink `<checkout>/esc` → `<tmp>/outside`; cwd = `<checkout>/sub` | `isAllowed(<checkout>/esc/file)` | `false` (layer 2 realpath). Note: in-cwd symlink `<cwd>/esc` is layer-1-allowed — pre-existing, not asserted |
| X8 | guard: bare-hub worktree without known folder | EP | L1 | automated | cwd = bareWorktree, not known | inject | `403` (existing behaviour retained) |

---

## Coverage summary

- Requirements covered: 8/8 (containment ×4 incl. re-worded req 3/4, resolver three-facts, repository binding, kb guard admission, unbounded-reach)
- Scenarios by class: edge 30 · perf 2 · frontend 1 · error 8
- Scenarios by level: L1 40 · L2 0 · L3 0
- Scenarios by disposition: automated 40 · manual-only 1

## New infra needed

- none new at the harness level. `buildGitFixtures()` covers all nine states; adversarial rows add `git config --local core.worktree` at test time. A two-worktree fixture (E5) is built inline from the `normal` fixture with `git worktree add`.
- Small in-test helper (not a harness): a **slow/missing git shim** for P1, X1, X2, X4, X5, X6 — a temp dir holding an executable `git` that sleeps, prepended to `PATH` in `process.env` for the test (`vi.stubEnv`), since `checkoutRoots`/`checkoutRootsAsync` forward only `timeout` to the runner (`runner.ts` accepts `env`, `git.ts:461` does not expose it). No existing shim in `git-checkout-roots.test.ts` to copy; `FIXTURE_GIT_ENV` only pins identity/config env for fixture building. Skip these rows on Windows if a shell shim is impractical (`process.platform === "win32"`).
