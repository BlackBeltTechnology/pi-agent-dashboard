# Test Plan — add-codegraph-code-plane

Stage: design   Generated: 2026-09-11

Clarifications C1–C5 were resolved before this plan was written (configurable
debounce w/ 800ms default; configurable 10s query timeout + liveness-watched
`init`; no fixed reconcile budget — record observed p95; retry-once-after-5min
failed-init policy; writer-lock scope to be confirmed by the 6.1 spike). No
`[NEEDS CLARIFICATION]` markers remain.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | Lifecycle (debounced sync) | BVA | L1 | automated | two non-`.md` writes in one cwd, 799ms apart | second write lands inside the 800ms default window | exactly ONE `sync` spawn |
| E2 | Lifecycle (debounced sync) | BVA | L1 | automated | two non-`.md` writes in one cwd, 801ms apart | second write lands outside the window | exactly TWO `sync` spawns |
| E3 | Lifecycle (debounced sync) | EP | L1 | automated | debounce configured to 50ms | two writes 60ms apart | TWO spawns — the configured value, not the 800ms default, governs |
| E4 | Lifecycle (hook exclusions) | decision-table | L1 | automated | writes at `src/a.ts`, `.codegraph/codegraph.db`, `.git/HEAD`, `node_modules/x/i.js`, `dist/out.js` | each write observed by the hook | ONLY `src/a.ts` schedules a sync; the other four schedule none |
| E5 | Lifecycle (plane separation) | EP | L1 | automated | a `.md` write in the cwd | hook observes it | no codegraph sync scheduled; kb-extension's markdown hook still fires |
| E6 | Resolution ladder | decision-table | L1 | automated | each of 5 rung-presence combinations (override / bundled / PATH / npm-prefix / none) | `resolveBinary(cwd)` called | resolves the highest-priority present rung; `none` yields `{unavailable, installHint}` |
| E7 | Resolution ladder (rung 4) | EP | L1 | automated | binary installed into the npm global prefix, `PATH` empty | `resolveBinary` called | rung 4 resolves it — proving rung 4 reads the prefix, not PATH |
| E8 | Ladder validation | EP | L1 | automated | an executable merely NAMED `codegraph` on PATH that fails the version probe | `resolveBinary` called | the impostor is skipped and the next rung is used; it is never used for queries |
| E9 | `presence()` scope | EP | L1 | automated | only a bundled binary exists; `PATH` empty | `presence(cwd)` called | `binaryResolved: true` — a PATH-only implementation fails this |
| E10 | Index readiness | EP | L1 | automated | `.codegraph/` exists but `status` reports incomplete | `presence(cwd)` called | `indexed: false` — readiness is judged by `status`, not directory existence |
| E11 | Query injection (option) | EP | L1 | automated | query text `--help` | `explore(cwd, "--help")` | treated as query text (passed after `--`), NOT parsed as a CLI flag |
| E12 | Query input bounds | BVA | L1 | automated | query at limit, just over limit, and one containing NUL | `explore` called | at-limit accepted; over-limit and NUL-bearing rejected before spawn |
| E13 | Writer serialization | state-transition | L1 | automated | `init` running for cwd A | a `sync` for cwd A is requested | the sync waits or coalesces — no second concurrent writer, no writer-lock error |
| E14 | Writer serialization | state-transition | L1 | automated | `init` running for cwd A | a `sync` for a DIFFERENT cwd B is requested | B proceeds concurrently (assertion pending 6.1 lock-scope confirmation) |
| E15 | Stale-lock recovery | decision-table | L1 | automated | (a) lock whose recorded pid is dead; (b) lock whose pid is alive | an operation runs | (a) cleared and the operation proceeds; (b) NOT cleared — no corruption of a live build |
| E16 | Failed-init retry | state-transition | L1 | automated | a background `init` that failed 4 minutes ago | a new explore arrives | NO retry (still inside the 5-minute cooldown); guidance returned |
| E17 | Failed-init retry | state-transition | L1 | automated | a background `init` that failed 6 minutes ago | a new explore arrives | exactly ONE retry; on a second failure it is recorded and surfaced, not retried again |
| E18 | kb untouched | EP | L1 | automated | the three new packages' source | dependency lint runs | no import of `@blackbelt-technology/pi-dashboard-kb{,-extension}` in ANY of the three; driver additionally has no `@earendil-works/*` import |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | Per-query reconcile | tail-latency | L1 | automated | repeated `explore` on a warm index | record observed p95 added latency per query as the regression baseline (no pre-set threshold per C3) | 100 queries |
| P2 | Cold-start `init` | soak / liveness | L2 | automated | `init` on a large repo | the build is NOT killed while making progress; a hung (no-progress) build IS terminated | until completion |
| P3 | Debounce coalescing | threshold | L1 | automated | 50 source writes in a 2s burst | sync spawn count stays bounded (coalesced), not 50 | 2s burst |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | Settings UI split by scope | state-convergence | L3 | automated | a resolved binary | `/settings/plugins/codegraph` opened | converges to showing ladder + resolved path + version + install action, and NO per-worktree index state |
| F2 | Settings UI split by scope | state-convergence | L3 | automated | a worktree with a ready index | the folder CodeGraph dialog opened | shows freshness + force-reindex + a ONE-LINE binary outcome + `Manage in Settings →`; the ladder is absent |
| F3 | Folder blocker | state-transition | L3 | automated | no binary resolves on any rung | the folder dialog opened | the index section is replaced by a blocker; folder actions disabled; no install action on this surface |
| F4 | Install action | state-convergence | L3 | automated | no binary installed | install triggered from the global surface | both surfaces converge to the installed state without a manual reload |
| F5 | Blocker legibility | visual/subjective | — | manual-only | the folder blocker + disabled actions | a human reads it cold | [judgment: is it obvious WHY the folder is blocked and where to fix it?] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | Graceful degradation | fault-injection | L1 | automated | no binary resolves | `codegraph_explore` called | clean built-in-tools guidance; no throw into agent context |
| X2 | Cold-start | fault-injection | L1 | automated | cwd has no ready index | `codegraph_explore` called | guidance returned IMMEDIATELY (call does not await init) AND exactly one background `init` scheduled |
| X3 | Failure ≠ absence | fault-injection (abort) | L1 | automated | resolved binary exits non-zero (malformed query / lock held / corrupt index) | `explore` called | typed `error` distinct from `unavailable`; the agent is NOT told CodeGraph is uninstalled |
| X4 | Query timeout | fault-injection (delay) | L1 | automated | binary stalls past the configured 10s query timeout | `explore` called | degrades to guidance within the bound; no hung turn; no throw |
| X5 | Install failure | fault-injection | L1 | automated | `npm install -g` fails with EACCES; and npm absent | install action invoked | each returns its specific typed reason; state stays "not installed" — never a false success |
| X6 | Packaged install safety | fault-injection | electron | automated | install action inside a packaged app | install runs | writes to a writable user-scoped prefix; nothing written inside the signed bundle |
| X7 | Interrupted build | state-transition | L1 | automated | `init` killed mid-run, `.codegraph/` left partial | next explore | reported not-ready and a rebuild remains possible — the partial index is never served as complete |
| X8 | No daemon | invariant | L1 | automated | any driver spawn | spawn helper invoked | `CODEGRAPH_NO_DAEMON=1` and telemetry-disable present in env on EVERY spawn; no background process created |

### Packaging / CI

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| C1 | Electron bundling | EP | electron | automated | a target WITH a published prebuilt | electron build runs | binary present under `resourcesPath/codegraph`; resolved by rung 2 at runtime |
| C2 | Electron bundling | EP | electron | automated | a target with NO published prebuilt | electron build runs | no bundle shipped, build still succeeds, runtime falls through to rungs 3/4 |
| C3 | Download script contract | decision-table | ci | automated | (a) unsupported target; (b) sha256 mismatch | `download-codegraph.mjs` runs | (a) exit 0, nothing written; (b) non-zero, build fails loudly — the two are distinguishable |
| C4 | Docker carry | EP | L2 | automated | image built WITHOUT the opt-in arg | container starts | no `codegraph` present; the plane is a clean no-op |
| C5 | Docker carry | EP | L2 | automated | image built WITH the opt-in arg | container starts | pinned `codegraph` resolves on the PATH rung; no outbound telemetry observed |
| C6 | Docs-first guidance | EP | L1 | automated | root `AGENTS.md` after the change | routing-row lint runs | the codegraph row exists AND the two pre-existing rows it collides with are amended |
| C7 | Docs-first guidance | subjective | — | manual-only | the amended routing table | a human reads the rows | [judgment: can a query shape still plausibly match two rows?] |

---

## Coverage summary

- Requirements covered: 10/10
- Scenarios by class: edge 18 · perf 3 · frontend 5 · error 8 · packaging/CI 7
- Scenarios by level: L1 25 · L2 3 · L3 4 · electron 3 · ci 1 · manual-only 2
- Scenarios by disposition: automated 39 · manual-only 2

## New infra needed

- none — L1 vitest, L2 `qa/tests/`, L3 Playwright vs the docker harness, and the
  electron/CI workflow legs all already exist. E18's dependency lint extends the
  existing `scripts/__tests__/` guard pattern rather than adding a harness.
