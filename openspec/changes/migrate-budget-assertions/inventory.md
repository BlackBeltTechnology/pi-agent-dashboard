# Inventory: upper-bound time and memory assertions — PRELIMINARY, KNOWN UNRELIABLE

> **Status: preliminary, known unreliable — to be rebuilt from the guard's `--list` output with every row read by hand.**
> Moved here from `stabilize-blocking-test-lanes` when that change was split (owner decision A8). It was produced by a
> `git grep` scan at `8208cd78d`, before the guard existed. Design and rule references below (`design.md D4a`, `D5`,
> `R1`–`R8`, task numbers, `T-A*`) point to the pre-split `stabilize-blocking-test-lanes` design. That design text now
> survives only in this change's proposal.md ("Inputs carried over"). Do not apply any row as written.
>
> **Known errors found by the cycle-3 reviews** (two adversarial reviews run during planning, not kept in the repository; each re-checked at
> `8208cd78d`). Same-model sample: 5 of 38 rows wrong (13 %). Cross-model sample: 2 of 25 rows wrong (8 %).
>
> Missing rows (real budgets that run in blocking lanes today; no row, and the scan could not see them):
> - `packages/server/src/__tests__/auth-redirect-base.test.ts:562-565` "P1: 100k builds … inside the budget":
>   `expect(\n elapsed, …\n).toBeLessThan(1000)`, an assertion split across lines.
> - `packages/server/src/__tests__/sudo-credential-load.test.ts:50-51`: `expect(p95(latencies)).toBeLessThanOrEqual(250)`
>   and a `< 10_000` max; readings stored through `Map.set(…, performance.now())` at `:41`, `:45`.
> - `packages/kb/src/__tests__/proximity-perf.test.ts:37,47,51,52,58`: five `< 100` ms bounds measured in a spawned
>   child (`:11-31`); the file is absent.
> - `packages/server/src/attachments/__tests__/display-fit-perf.test.ts:81,127` "P1/P2 … event-loop lag within budget",
>   measured by `startLagMonitor` from `test-support/event-loop-lag`; dismissed as NOT-A-BUDGET.
> - `packages/server/src/__tests__/provider-auth-fallback.bench.test.ts:18,51-52`: in-file `performance.now()` under a
>   `PI_BENCH` gate; absent.
>
> Wrongly marked NOT-A-BUDGET (process-memory budgets; they should move):
> - `packages/server/src/attachments/__tests__/display-fit-perf.test.ts:265` (P4, `peakDelta` from
>   `process.memoryUsage().rss`, `:254-256`, `< 50_000_000`; split across lines).
> - `packages/server/src/__tests__/live-static-proxy.test.ts:321` (`peakRss` from `process.memoryUsage().rss`, `:300-309`,
>   `< 20 MB`).
>
> Wrongly marked for removal from the blocking lanes (deterministic; they stay blocking):
> - `packages/server/src/__tests__/memory-event-store.test.ts:609` (`expect(size).toBeLessThanOrEqual(CAP + 500)`) and
>   `:642` (`expect(size).toBeLessThan(deepBig.length)`): `size = JSON.stringify(stored).length`, a byte-size ceiling
>   (A1). Marked `unclassified`/R8 and `MOVE`/R7.
> - Fake-clock cases: `packages/client/src/lib/chat/__tests__/follow-glide.test.ts:54,55,57` (MOVE; module-level
>   `beforeEach(() => vi.useFakeTimers())` at `:47`), `packages/electron/src/__tests__/loading-page-handoff.test.ts:30`
>   (MOVE; `vi.useFakeTimers()` at `:15`), `packages/server/src/tls/sources/acme/__tests__/acme-source-timing.test.ts:148`
>   (REWRITE; `Date` faked at `:35-36`). Left `unclassified` though `Date` is faked:
>   `acme-source-manager.test.ts:380` (`:53-54`) and `packages/extension/…/watchdog.test.ts:212` (`:55-57`). Cause: the
>   old rule honoured a fake only in the case or its `describe`'s `beforeEach`, and treated only `Date` as fakeable; vitest
>   4.1 no-argument `vi.useFakeTimers()` also fakes `performance`.
> - Other non-budgets left `unclassified` with no NOT-A-BUDGET exit: `packages/server/src/attachments/__tests__/attachment-ingest.test.ts:125`
>   (a byte size) and `packages/system-one-plugin/src/server/__tests__/routes.test.ts:276` (`rep.thresholds.q <= 0.8`, a
>   model threshold).
>
> Rule-conformant rows that drop functional coverage (MOVE takes the whole case; 128 of 195 MOVE cases hold another
> `expect(`): `packages/mockup-loop/src/__tests__/mock-site-serve.test.ts:138-158` (E19, P2, X3),
> `scripts/__tests__/coverage-report.test.mjs:54-72` (E2, moved for a `// P3` comment), `packages/server/src/__tests__/host-project-trust.test.ts:240-261`
> (#X2/#P2), `packages/server/src/__tests__/tunnel-readiness.test.ts:186` (X9/P2),
> `packages/server/src/lib/__tests__/folder-project.test.ts:373-378` (P3, a hung opendir).
>
> Real-process liveness deadlines outside `packages/server/vitest.real-process-files.ts` that the rows move or rewrite:
> `packages/mockup-loop/src/__tests__/mock-site-serve.test.ts:145`, `:181` (MOVE) and
> `packages/blender/src/__tests__/real-lifecycle.test.ts:294` (REWRITE, and no task covered it).
>
> Rows that collide with the lane's strict no-skip rule (they run in no lane today):
> `packages/server/src/__tests__/route-admission.bench.test.ts:74,75,160,161,188,247,265` (`PI_BENCH`, `:58`, `:143`)
> and `scripts/__tests__/client-isolate-gate.test.mjs:67` (`skipIf(!adopted || !CI_SCENARIOS)`, `:47`).
>
> Rows classified without their title (`it(` title on the next line): `scripts/__tests__/coverage-report.test.mjs:69`
> (empty case cell); how many rows share this shape was not measured.
>
> Rows already moved by `stabilize-blocking-test-lanes` (A9) are excluded from the follow-up's rebuild: the
> `kb-search-perf` P1 block and S61 bound, `browser-gateway-broadcast-serialize-once` P2, `ladder-perf` #P4 RSS bound,
> `graph-layout` #P1, `knip-scan` #P1, blender `real-binary` P1–P3, `provisioning` #P1, `dependency-declarations` P1/P2.

Pre-split text follows. Owner decision A8 (pre-split wording): every existing upper-bound wall-clock or process-memory assertion in a blocking lane is handled, with no baseline. This file lists every hit of the scan below with a proposed disposition. It is **preliminary**: task 3.2 re-derives the list with `node scripts/check-budget-assertions.mjs --list`, and the implementer reconciles the two before any migration task starts (design.md D6).

Produced at `8208cd78d`. Disposition vocabulary (design.md D4a, R1–R8):

- **MOVE**: the case exists to measure speed or memory. It goes to a `*.budget.test.*` file (nightly budget lane).
- **REWRITE**: a liveness deadline inside a functional case. The duration assertion is removed by the REWRITE recipe (design.md D4a), and the case stays blocking.
- **ALLOW-LIST**: a real-process liveness deadline (A6). It goes into `LIVENESS_ALLOW` with the reason shown.
- **OPT-IN (KB_MEASURE)**: inside `describe.skipIf(!process.env.KB_MEASURE)`. It runs in no lane today and stays so (D5 exception 3, pending owner confirmation, trade-off T-A1).
- **NOT-A-BUDGET**: not a budget assertion by D4 (count, size, ordering, lower bound, fake clock, or a value not derived from a reading). Rows the guard will still flag carry "add `// budget-exempt:`".
- **unclassified — decide at implementation**: the rule inputs could not settle it. The implementer reads the case and applies R1–R8.

## Method

File set (C0), 3719 files:

```bash
git ls-files | grep -E '\.test\.(ts|tsx|mjs|js)$' | grep -vE '^(tests/e2e|qa)/|/fixtures/'
```

No `*.test.mts` file is tracked. Each command below runs as `git grep -nP '<pattern>' -- <C0 files>` (PCRE; BSD `grep -E` lacks `\w` in brackets and gives wrong counts on macOS).

| Id | What it finds | Pattern |
|---|---|---|
| C1 | a clock difference under `toBeLessThan` | `expect\(\s*(Date\.now\(\)\|performance\.now\(\)\|Number\(process\.hrtime\.bigint\(\)\)\|process\.hrtime\.bigint\(\))\s*-\s*[\w$.]+\s*(,[^)]*)?\)\s*\.toBeLessThan` |
| C2 | a named duration or memory identifier under an upper bound (kept only in files that read a clock or memory) | `(?i)expect\(\s*[^;]*?(elapsed\|duration\|took\|latency\|\brss\|heap\|wall\|[a-z]ms\b\|\bms\b\|millis\|secs?\b\|seconds)[^;]*?\)\s*\.toBeLessThan` |
| C3 | a relative budget `toBeLessThan(k * other)` (same file filter) | `\.toBeLessThan(OrEqual)?\([^;]*(\*\s*[\d.]+\|[\d.]+\s*\*)` |
| C4 | every upper bound in a file that reads process memory | files: `process\.memoryUsage\|getHeapStatistics\|resourceUsage`; lines: `\.toBeLessThan(OrEqual)?\(` |
| C5 | a same-file helper that returns a duration, then the upper bounds over its result | `(return\|=>)\s*\(?\s*(performance\.now\(\)\|Date\.now\(\)\|Number\(process\.hrtime\.bigint\(\)\)\|process\.hrtime\.bigint\(\))\s*-` |
| C6 | a reversed bound `expect(N).toBeGreaterThan(measured)` (same file filter) | `expect\(\s*[\d_]+\s*\)\s*\.toBeGreaterThan(OrEqual)?\(` |
| C7 | every other upper bound whose measured side is tainted (the guard's rule, design.md D5 step 2) | `\.toBeLessThan(OrEqual)?\(` in files matching the reading pattern below |

Reading pattern (D4 a/b plus the named helper): `\brssBytes\(|performance\.now\(|Date\.now\(|process\.hrtime|process\.uptime\(|memoryUsage|getHeapStatistics|resourceUsage`. It matches 595 files.

Taint, as the guard will compute it (design.md D5 step 2):
- An identifier is tainted when it is assigned from an expression that holds a reading or a tainted identifier. This covers declarations, destructuring, plain assignment and `x.push(…)` (argument up to three lines on).
- A same-file function whose body holds a reading or a tainted identifier is tainted, and so are its call results. This catches `readWhileWorkerWrites` in `kb-search-perf.test.ts:99` and `timed()`-style helpers.
- Scope is the case: its own lines, every declaration at an enclosing indentation, and every assignment to such a declared name (for example in `beforeAll`). A scope-blind first pass flagged 93 count and size assertions; case scoping leaves 33.

Each hit's rule inputs were read by the scan script: case title, `describe` title, the comment lines above, the number of `expect(` in the case, and the measured and bound sides. Rows marked "hand" were also read in full by a person. Commands C1 to C7 give 502 hit lines in 220 files, and two hand rows are added. Scoped classification leaves 345 candidate rows in 196 files (MOVE, REWRITE, ALLOW-LIST, OPT-IN, unclassified) and 159 NOT-A-BUDGET rows. The owner's measurement (105 C1 lines in 75 files) is a subset: C1 here gives 107, because it also accepts a message argument and `hrtime`.

**Known misses of this method** (the same list as the guard limits, design.md D5):
- readings in another module (imported helper or harness): the value arrives untainted. These rows are `unclassified` when the name looks like a duration (C2 without a reading), and are missed otherwise;
- predicates: `expect(withinBudget(elapsed, n)).toBe(true)`. One hand row (`dependency-declarations.test.mjs:434`);
- an assertion split across lines (the `expect(` and the matcher on different lines);
- time budgets with no clock read: `Promise.race` against `setTimeout`, `AbortSignal.timeout`, or `it(…, N)` used as a budget;
- hand-thrown failures (`if (ms > X) throw`), custom matchers and snapshot timings;
- child-process time or memory read through `ps`, `/proc` or `time` without a listed helper;
- fake timers installed in a setup file or helper. The per-case fake-`Date` check sees only `vi.useFakeTimers()`, `vi.useFakeTimers({toFake: [... "Date" ...]})` or `vi.setSystemTime(` in the case or in a `beforeEach` of its `describe`;
- tests outside vitest: Playwright `tests/e2e/`, `music-pytest`, shell scripts.

## Summary

| package | MOVE | REWRITE | ALLOW-LIST | OPT-IN | unclassified | NOT-A-BUDGET | of which marker |
|---|---|---|---|---|---|---|---|
| [server](#server) | 100 | 28 | 4 | 0 | 15 | 93 | 22 |
| [extension](#extension) | 21 | 2 | 0 | 0 | 4 | 3 | 2 |
| [shared](#shared) | 11 | 11 | 0 | 0 | 2 | 0 | 0 |
| [kb](#kb) | 13 | 3 | 0 | 0 | 4 | 9 | 1 |
| [scripts](#scripts) | 12 | 5 | 0 | 0 | 1 | 0 | 0 |
| [client](#client) | 14 | 0 | 0 | 0 | 2 | 2 | 0 |
| [kb-extension](#kb-extension) | 3 | 11 | 0 | 0 | 2 | 0 | 0 |
| [deck3d](#deck3d) | 4 | 5 | 0 | 0 | 1 | 11 | 0 |
| [kb-plugin](#kb-plugin) | 4 | 2 | 0 | 1 | 1 | 12 | 2 |
| [mcp-server-plugin](#mcp-server-plugin) | 8 | 0 | 0 | 0 | 0 | 1 | 0 |
| [untrusted-content-guard](#untrusted-content-guard) | 6 | 0 | 0 | 0 | 0 | 0 | 0 |
| [blender](#blender) | 3 | 1 | 0 | 0 | 0 | 0 | 0 |
| [flows-plugin](#flows-plugin) | 0 | 4 | 0 | 0 | 0 | 3 | 0 |
| [skill-atlas-plugin](#skill-atlas-plugin) | 4 | 0 | 0 | 0 | 0 | 1 | 0 |
| [mockup-loop](#mockup-loop) | 3 | 0 | 0 | 0 | 0 | 0 | 0 |
| [obs-studio-plugin](#obs-studio-plugin) | 0 | 3 | 0 | 0 | 0 | 0 | 0 |
| [.pi](#pi) | 0 | 1 | 0 | 0 | 1 | 0 | 0 |
| [apple-tools](#apple-tools) | 2 | 0 | 0 | 0 | 0 | 0 | 0 |
| [bus-client](#bus-client) | 0 | 2 | 0 | 0 | 0 | 0 | 0 |
| [dashboard-plugin-runtime](#dashboard-plugin-runtime) | 1 | 1 | 0 | 0 | 0 | 0 | 0 |
| [electron](#electron) | 2 | 0 | 0 | 0 | 0 | 3 | 0 |
| [mcp-client-plugin](#mcp-client-plugin) | 1 | 1 | 0 | 0 | 0 | 1 | 0 |
| [memory-eval](#memory-eval) | 2 | 0 | 0 | 0 | 0 | 0 | 0 |
| [roles-plugin](#roles-plugin) | 2 | 0 | 0 | 0 | 0 | 0 | 0 |
| [system-one](#system-one) | 1 | 1 | 0 | 0 | 0 | 0 | 0 |
| [system-one-plugin](#system-one-plugin) | 0 | 0 | 0 | 0 | 2 | 0 | 0 |
| [automation-plugin](#automation-plugin) | 1 | 0 | 0 | 0 | 0 | 0 | 0 |
| [blackhole-plugin](#blackhole-plugin) | 1 | 0 | 0 | 0 | 0 | 0 | 0 |
| [chat-gateway](#chat-gateway) | 1 | 0 | 0 | 0 | 0 | 0 | 0 |
| [craft-web-plugin](#craft-web-plugin) | 1 | 0 | 0 | 0 | 0 | 4 | 0 |
| [gmail-plugin](#gmail-plugin) | 0 | 1 | 0 | 0 | 0 | 0 | 0 |
| [nano-banana](#nano-banana) | 0 | 1 | 0 | 0 | 0 | 0 | 0 |
| [path-containment-guard](#path-containment-guard) | 1 | 0 | 0 | 0 | 0 | 0 | 0 |
| [eng-disciplines](#eng-disciplines) | 0 | 0 | 0 | 0 | 0 | 1 | 0 |
| [image-fit-extension](#image-fit-extension) | 0 | 0 | 0 | 0 | 0 | 15 | 6 |
| **total** | **222** | **83** | **4** | **1** | **35** | **159** | **33** |

Files with at least one MOVE, REWRITE or unclassified row: 192. Files with any row: 222.

Observed-failing cases from the brief, and where they land: `kb-search-perf.test.ts:49` and `:153` MOVE, `:179` OPT-IN; `browser-gateway-broadcast-serialize-once.test.ts:373-376` MOVE; `ladder-perf.test.ts` MOVE; `graph-layout.test.ts:296` MOVE; `knip-scan.test.mjs:97` MOVE; `real-binary.test.ts:415`, `:428`, `:440` MOVE; `provisioning.test.ts:591` MOVE; `dependency-declarations.test.mjs:434` MOVE (hand). `spawn-correlation-performance.test.ts:85`, `:89`, `:133` MOVE (`:133` is the 10 MB `retained()` memory bound). `SessionList.actions-menu.test.tsx` P1 is a count under fake timers and is not a hit (design.md D4).

## server

Paths are relative to `packages/server/`.

| file:line | case | assertion | disposition | rule / reason |
|---|---|---|---|---|
| `src/__tests__/addons-folder.test.ts:222` | p95 < 300 ms with 50 features and 500 loose files | `expect(times[Math.ceil(times.length * 0.95) - 1]).toBeLessThan(300);` | MOVE | R4: named as performance (p95) |
| `src/__tests__/addons-routes.perf.test.ts:36` | p95 < 300 ms over 50 sequential requests | `expect(p95(times)).toBeLessThan(300);` | MOVE | R4: named as performance (p95) |
| `src/__tests__/addons-toggle-routes.perf.test.ts:40` | p95 < 500 ms over 30 sequential dry runs | `expect(p95(times)).toBeLessThan(500);` | MOVE | R4: named as performance (p95) |
| `src/__tests__/browse-confinement-route.test.ts:246` | 200 roots + 200-entry dir: p95 < 50 ms over 100 sequential … | `` expect(Math.min(...p95s), `p95 per window (ms): ${p95s.map((n) => n.toFixed(1)).join(", ")}`).… `` | MOVE | R4: named as performance (p95) |
| `src/__tests__/browser-gateway-broadcast-serialize-once.test.ts:373` | sheds non-status frames no slower than status frames that d… | `expect(nonStatusMs).toBeLessThan(statusMs * (process.env.CI ? 1.25 : 1.05));` | MOVE | R3: relative bound |
| `src/__tests__/browser-gateway-broadcast-serialize-once.test.ts:375` | sheds non-status frames no slower than status frames that d… | `expect(nonStatusMs / ITERATIONS).toBeLessThan(ABSOLUTE_PER_FRAME_BUDGET_MS);` | MOVE | R4: named as performance (P2) |
| `src/__tests__/browser-gateway-broadcast-serialize-once.test.ts:376` | sheds non-status frames no slower than status frames that d… | `expect(statusMs / ITERATIONS).toBeLessThan(ABSOLUTE_PER_FRAME_BUDGET_MS);` | MOVE | R4: named as performance (P2) |
| `src/__tests__/browser-gateway-load.test.ts:603` | never-draining socket: retained bytes ≤ ceiling, terminated… | `expect(retainedDelta).toBeLessThan(5 * 1024 * 1024);` | MOVE | R4: named as performance (P4) |
| `src/__tests__/browser-gateway-load.test.ts:662` | flushes ${DEBT_SIZE} owed reconciles in under ${BUDGET_RECO… | `expect(median).toBeLessThan(BUDGET_RECONCILE_FLUSH_MS);` | MOVE | R4: named as performance (BUDGET) |
| `src/__tests__/cli-foreground-real.test.ts:80` | X10: second foreground → already running + desktop-app ment… | `expect(Date.now() - t0).toBeLessThan(10_000 + 20_000); // classify budget + boot slack` | ALLOW-LIST (hand) | hand: A6; second foreground wrapper refuses and exits (status 1, :82); 10 s classify budget + 20 s boot slack per :80 |
| `src/__tests__/cli-login.test.ts:110` | bounds the request: a server that accepts but never answers… | `expect(Date.now() - t0).toBeLessThan(2000);` | REWRITE | R5: outcome of a timeout/abort/hang path (hang) |
| `src/__tests__/cli-stop-real.test.ts:193` | X6: stop of an owned server goes through /api/shutdown (int… | `expect(Date.now() - t0).toBeLessThan(150_000);` | ALLOW-LIST (hand) | hand: A6; boot-to-full-reap of the owned server (meta pid gone, :188-191); bound equals the case timeout 150_000 (:194) |
| `src/__tests__/contention-performance.test.ts:94` | P1: 200 sequential uncontended registers stay on the fast p… | `expect(elapsed).toBeLessThan(5_000);` | MOVE | R4: named as performance (P1) |
| `src/__tests__/contention-performance.test.ts:96` | P1: 200 sequential uncontended registers stay on the fast p… | `expect(elapsed / N).toBeLessThan(5);` | MOVE | R4: named as performance (P1) |
| `src/__tests__/contention-performance.test.ts:121` | P2: a contended register against a silent-but-writable incu… | `expect(elapsed).toBeLessThan(probeWindow * 3);` | MOVE | R4: named as performance (P2) |
| `src/__tests__/contention-performance.test.ts:133` | P2: a contended register against a silent-but-writable incu… | `expect(Date.now() - t0).toBeLessThan(probeWindow);` | MOVE | R4: named as performance (P2) |
| `src/__tests__/cors.test.ts:238` | keeps the steady-state read cheap | `expect(perCallUs).toBeLessThan(50);` | MOVE | R7: bound is the case's only assertion |
| `src/__tests__/credential-key-deadline.test.ts:56` | P1: a hung keychain resolves keychain_timeout at 10 s while… | `expect(elapsed).toBeLessThanOrEqual(10_300);` | MOVE | R4: named as performance (P1) |
| `src/__tests__/credential-key-deadline.test.ts:70` | P2: an answer just inside the deadline is accepted | `expect(Date.now() - t0).toBeLessThanOrEqual(9800);` | MOVE | R4: named as performance (P2) |
| `src/__tests__/credential-key-deadline.test.ts:83` | P2: an answer just inside the deadline is accepted | `expect(elapsed).toBeLessThanOrEqual(10_300); // one total deadline, not 20 s` | MOVE | R4: named as performance (P2) |
| `src/__tests__/credential-key-deadline.test.ts:84` | P2: an answer just inside the deadline is accepted | `expect(elapsed).toBeLessThan(30_000);` | MOVE | R4: named as performance (P2) |
| `src/__tests__/credential-key-worker.test.ts:97` | X3: a worker that exits silently (code 0) resolves keychain… | `expect(Date.now() - t0).toBeLessThan(1000);` | REWRITE | R5: outcome of a timeout/abort/hang path (exits) |
| `src/__tests__/csp.test.ts:709` | WP6: nonce + header cost on GET / is < 1 ms p99 (%s) | `expect(on - off).toBeLessThan(1);` | MOVE | R4: named as performance (p99) |
| `src/__tests__/custom-event-group-resolver.test.ts:38` | a catastrophically-backtracking pattern completes (timeout)… | `expect(Date.now() - start).toBeLessThan(5_000);` | REWRITE | R5: outcome of a timeout/abort/hang path (timeout) |
| `src/__tests__/custom-event-group-resolver.test.ts:175` | a file of pathological patterns cannot cause a respawn stor… | `expect(Date.now() - start).toBeLessThan(10_000);` | MOVE | R6: complexity or speed guard (pathological) |
| `src/__tests__/directory-service-eventloop-turns.test.ts:195` | 1.4 times pre/post as SEPARATE turns split by the worker aw… | `expect(Math.max(...snap.map((s) => s.ms))).toBeLessThan(150);` | unclassified — decide at implementation | named duration with no in-file reading (imported helper or constant?) |
| `src/__tests__/directory-service-readiness.test.ts:505` | P4: 50-cwd stat pass is memoized per cwd — resolver called … | `expect(elapsed).toBeLessThan(50); // P4 threshold: added wall time < 50ms` | MOVE | R4: named as performance (P4) |
| `src/__tests__/dispatch-reload-rollout.test.ts:97` | reloads all 20 sessions exactly once each, well inside the … | `expect(elapsed).toBeLessThan(5000);` | MOVE | R4: named as performance (budget) |
| `src/__tests__/doctor-route.test.ts:200` | probeServer reads process state, never spawns a subprocess | `expect(elapsed).toBeLessThan(15_000);` | REWRITE | R5: outcome of a timeout/abort/hang path (timeout) |
| `src/__tests__/event-wiring-push.test.ts:231` | hanging transports do not delay the session_updated broadca… | `expect(p95(withPush) - p95(base)).toBeLessThan(10);` | MOVE | R4: named as performance (#P1) |
| `src/__tests__/file-digest-endpoint.test.ts:191` | 404 for a FIFO, without blocking | `expect(Date.now() - t0).toBeLessThan(1000);` | REWRITE | R5: outcome of a timeout/abort/hang path (without blocking) |
| `src/__tests__/file-digest-endpoint.test.ts:214` | answers a prompt-eligible miss at once with a remedy, recor… | `expect(Date.now() - t0).toBeLessThan(1000);` | MOVE | R6: complexity or speed guard (at once) |
| `src/__tests__/file-digest-endpoint.test.ts:245` | refuses a granted FIFO and a granted symlink to a FIFO exac… | `expect(Date.now() - t0).toBeLessThan(1000);` | REWRITE | R5: outcome of a timeout/abort/hang path (refuse) |
| `src/__tests__/file-digest-endpoint.test.ts:327` | P3: a client abort releases the slot within 100 ms | `expect(Date.now() - t0).toBeLessThan(100);` | MOVE | R4: named as performance (P3) |
| `src/__tests__/file-raw-render-endpoints.test.ts:997` | parses a 15 MB .eml within the p95 budget (test-plan #18) | `expect(p95).toBeLessThan(5000);` | MOVE | R4: named as performance (p95) |
| `src/__tests__/file-write-binary.test.ts:497` | #X4 a hanging validator → 422 after ≈5 s; /api/health stays… | `expect(Date.now() - h0).toBeLessThan(200);` | REWRITE | R5: outcome of a timeout/abort/hang path (hang) |
| `src/__tests__/gateway-tls-bridge.test.ts:268` | X2 turning Accept bridges off pushes `denied`, closes the s… | `expect(Date.now() - t0).toBeLessThan(5_000);` | unclassified — decide at implementation | R8: REWRITE if recipe (c) or (d) applies, else MOVE |
| `src/__tests__/git-worktree-lifecycle-routes.test.ts:726` | X4: the whole-batch admission budget bounds the time; undec… | `expect(elapsed).toBeLessThan(3000 + 1500); // budget + (sequential removals, git) slack` | MOVE | R4: named as performance (budget) |
| `src/__tests__/git-worktree.test.ts:487` | adds negligible wall-clock over the git invocation itself | `expect(median(withStat)).toBeLessThan(composite * 2);` | MOVE | R3: relative bound |
| `src/__tests__/grep.test.ts:143` | #P1: a catastrophic regex times out without stalling the ma… | `expect(elapsed).toBeLessThan(1500);` | MOVE | R4: named as performance (#P1) |
| `src/__tests__/grep.test.ts:144` | #P1: a catastrophic regex times out without stalling the ma… | `expect(gap).toBeLessThan(200);` | MOVE | R4: named as performance (#P1) |
| `src/__tests__/grep.test.ts:161` | #P1: a catastrophic regex times out without stalling the ma… | `expect(elapsed).toBeLessThan(1300);` | MOVE | R4: named as performance (#P1) |
| `src/__tests__/grep.test.ts:162` | #P1: a catastrophic regex times out without stalling the ma… | `expect(gap).toBeLessThan(200);` | MOVE | R4: named as performance (#P1) |
| `src/__tests__/grep.test.ts:179` | #X3: a worker entry that throws on start rejects (no hang, … | `expect(Date.now() - t0).toBeLessThan(5000);` | REWRITE | R5: outcome of a timeout/abort/hang path (reject) |
| `src/__tests__/headless-pid-registry-restored-identity.test.ts:647` | P3: ≤ 2 probes per checked kill + ≤ 1 timer re-probe | `expect(w.probe.mock.calls.length).toBeLessThanOrEqual(2);` | NOT-A-BUDGET | count, size or status (D4); measured side reads no clock; the guard flags it: add `// budget-exempt: <reason>` |
| `src/__tests__/headless-pid-registry-restored-identity.test.ts:649` | P3: ≤ 2 probes per checked kill + ≤ 1 timer re-probe | `expect(w.probe.mock.calls.length).toBeLessThanOrEqual(3);` | NOT-A-BUDGET | count, size or status (D4); measured side reads no clock; the guard flags it: add `// budget-exempt: <reason>` |
| `src/__tests__/health-client-build.test.ts:248` | P1 200 health reads re-read no declaration and add no measu… | `expect(withClientRun.medianMs - withoutClientRun.medianMs).toBeLessThan(1);` | unclassified — decide at implementation | named duration with no in-file reading (imported helper or constant?) |
| `src/__tests__/home-lock.test.ts:808` | X8: a dead holder is reclaimed immediately even though the … | `expect(Date.now() - t0).toBeLessThan(2000); // no wait for the 10 s stale window` | REWRITE | R5: outcome of a timeout/abort/hang path (dead holder) |
| `src/__tests__/host-project-trust.test.ts:261` | #X2/#P2 trust lock held: a no-resources folder is undecided… | `expect(max).toBeLessThanOrEqual(250);` | MOVE | R4: named as performance (#P2) |
| `src/__tests__/known-servers-routes.test.ts:508` | P1 a slow lookup plus a hanging HTTP answer stays within dn… | `expect(Date.now() - t0).toBeLessThan(100 + 80 + 250);` | MOVE | R4: named as performance (P1) |
| `src/__tests__/known-servers-routes.test.ts:634` | X6 a hanging add challenge never blocks another entry's DEL… | `expect(Date.now() - t0).toBeLessThan(100 + 400); // challengeMs=100 + slack` | REWRITE | R5: outcome of a timeout/abort/hang path (hang) |
| `src/__tests__/known-servers-routes.test.ts:635` | X6 a hanging add challenge never blocks another entry's DEL… | `expect(delDone).toBeLessThan(80);` | REWRITE | R5: outcome of a timeout/abort/hang path (hang) |
| `src/__tests__/known-servers-routes.test.ts:954` | an answer inside the timeout pins the identity; one past it… | `expect(Date.now() - t0).toBeLessThan(450 + 300);` | REWRITE | R5: outcome of a timeout/abort/hang path (timeout) |
| `src/__tests__/large-resume-replay.test.ts:155` | E21: the replay-exit flush is windowed (one reset, one hist… | `expect(Math.max(...replays.map((m) => m.events.length))).toBeLessThanOrEqual(2000);` | NOT-A-BUDGET | count, size or status (D4); measured side reads no clock; the guard flags it: add `// budget-exempt: <reason>` |
| `src/__tests__/large-resume-replay.test.ts:693` | E23: an in-process subscriber gets the full stream while a … | `expect(Math.max(...replayCount(h.msgs).map((m) => m.events.length))).toBeLessThanOrEqual(2000);` | NOT-A-BUDGET | count, size or status (D4); measured side reads no clock; the guard flags it: add `// budget-exempt: <reason>` |
| `src/__tests__/live-static-proxy.test.ts:450` | P1 — serving a 2 MiB HTML (10 linked CSS) adds ≤150 ms p95 … | `expect(added[Math.floor(added.length * 0.95)]).toBeLessThanOrEqual(150);` | MOVE | R4: named as performance (P1) |
| `src/__tests__/live-static-proxy.test.ts:483` | P2 — the REAL per-request gate costs ≤10 ms p95 over 200 re… | `expect(times[Math.floor(times.length * 0.95)]).toBeLessThanOrEqual(10);` | MOVE | R4: named as performance (P2) |
| `src/__tests__/memory-event-store.test.ts:281` | still truncates data field without mimeType sibling | `expect(val.length).toBeLessThan(500);` | NOT-A-BUDGET | count, size or status (D4); measured side reads no clock; the guard flags it: add `// budget-exempt: <reason>` |
| `src/__tests__/memory-event-store.test.ts:311` | skill invocation envelope survives string truncation with c… | `expect(content.length).toBeLessThan(10_000);` | NOT-A-BUDGET | count, size or status (D4); measured side reads no clock; the guard flags it: add `// budget-exempt: <reason>` |
| `src/__tests__/memory-event-store.test.ts:354` | large pasted image over the ceiling keeps the message, stri… | `expect(Buffer.byteLength(JSON.stringify(stored.data))).toBeLessThanOrEqual(` | NOT-A-BUDGET | count, size or status (D4); measured side reads no clock; the guard flags it: add `// budget-exempt: <reason>` |
| `src/__tests__/memory-event-store.test.ts:392` | large pasted image in the nested Anthropic source shape als… | `expect(Buffer.byteLength(JSON.stringify(stored.data))).toBeLessThanOrEqual(` | NOT-A-BUDGET | count, size or status (D4); measured side reads no clock; the guard flags it: add `// budget-exempt: <reason>` |
| `src/__tests__/memory-event-store.test.ts:422` | still uses the whole-event placeholder when non-image conte… | `expect(Buffer.byteLength(JSON.stringify(stored.data))).toBeLessThanOrEqual(` | NOT-A-BUDGET | count, size or status (D4); measured side reads no clock; the guard flags it: add `// budget-exempt: <reason>` |
| `src/__tests__/memory-event-store.test.ts:450` | truncates other fields alongside preserved image data | `expect(thinking.length).toBeLessThan(longThinking.length); // shorter than original` | NOT-A-BUDGET | count, size or status (D4); measured side reads no clock; the guard flags it: add `// budget-exempt: <reason>` |
| `src/__tests__/memory-event-store.test.ts:555` | survives a subagent flood: chat head kept, buffer stays bou… | `expect(events.length).toBeLessThanOrEqual(cap + 25);` | NOT-A-BUDGET | count, size or status (D4); measured side reads no clock; the guard flags it: add `// budget-exempt: <reason>` |
| `src/__tests__/memory-event-store.test.ts:609` | bounds an oversized deeply-nested subagent event before sto… | `expect(size).toBeLessThanOrEqual(CAP + 500);` | unclassified — decide at implementation | R8: REWRITE if recipe (c) or (d) applies, else MOVE |
| `src/__tests__/memory-event-store.test.ts:642` | truncates deep sub-trees rather than returning them raw | `expect(size).toBeLessThan(deepBig.length);` | MOVE | R7: bound is the case's only assertion |
| `src/__tests__/memory-event-store.test.ts:669` | the broadcast source (getEvent) is bounded for an over-ceil… | `expect(JSON.stringify(broadcastPayload).length).toBeLessThanOrEqual(2_500);` | NOT-A-BUDGET | count, size or status (D4); measured side reads no clock; the guard flags it: add `// budget-exempt: <reason>` |
| `src/__tests__/memory-event-store.test.ts:855` | E1: capString keeps head + tail + a hidden marker | `expect(out.length).toBeLessThanOrEqual(maxSize + 40); // ~marker length` | NOT-A-BUDGET | count, size or status (D4); measured side reads no clock; the guard flags it: add `// budget-exempt: <reason>` |
| `src/__tests__/memory-event-store.test.ts:871` | E3: capString preserves a skill-invocation envelope | `expect(out.length).toBeLessThan(env.length);` | NOT-A-BUDGET | count, size or status (D4); measured side reads no clock; the guard flags it: add `// budget-exempt: <reason>` |
| `src/__tests__/memory-event-store.test.ts:887` | E7: byte-accurate bound holds under escape/CJK-heavy entries | `expect(Buffer.byteLength(JSON.stringify(stored.data))).toBeLessThanOrEqual(CEIL);` | NOT-A-BUDGET | count, size or status (D4); measured side reads no clock; the guard flags it: add `// budget-exempt: <reason>` |
| `src/__tests__/memory-event-store.test.ts:915` | E11: image-bearing NON-subagent event keeps the message, st… | `expect(bytesOf(stored.data)).toBeLessThanOrEqual(CEIL);` | unclassified — decide at implementation | R8: REWRITE if recipe (c) or (d) applies, else MOVE |
| `src/__tests__/memory-event-store.test.ts:945` | E13: non-subagent over-ceiling event → {__truncated} | `expect(JSON.stringify(stored.data).length).toBeLessThanOrEqual(20_000);` | NOT-A-BUDGET | count, size or status (D4); measured side reads no clock; the guard flags it: add `// budget-exempt: <reason>` |
| `src/__tests__/memory-event-store.test.ts:960` | P1: size measurement is bounded and never full-stringifies … | `expect(bytesOf(stored.data)).toBeLessThanOrEqual(CEIL);` | MOVE | R4: named as performance (P1) |
| `src/__tests__/memory-event-store.test.ts:967` | P1: size measurement is bounded and never full-stringifies … | `expect(elapsed).toBeLessThan(50);` | MOVE | R4: named as performance (P1) |
| `src/__tests__/memory-event-store.test.ts:1109` | E14: over-ceiling terminal frame with every step resident e… | `expect(Buffer.byteLength(JSON.stringify(d))).toBeLessThanOrEqual(CEIL);` | NOT-A-BUDGET | count, size or status (D4); measured side reads no clock; the guard flags it: add `// budget-exempt: <reason>` |
| `src/__tests__/memory-event-store.test.ts:1181` | E20: finished block and terminal agent drop their deltas wi… | `expect(store.getBufferBytes("s1")).toBeLessThan(bytesBefore + 100_000);` | MOVE | R3: relative bound |
| `src/__tests__/memory-event-store.test.ts:1203` | P3: the resident completeness scan over 50k events stays un… | `expect(performance.now() - t0).toBeLessThan(50);` | MOVE | R4: named as performance (P3) |
| `src/__tests__/memory-event-store.test.ts:1484` | P1: predecessor lookup cost is bounded, not O(buffer length) | `expect(small).toBeLessThanOrEqual(200);` | MOVE | R4: named as performance (P1) |
| `src/__tests__/memory-event-store.test.ts:1485` | P1: predecessor lookup cost is bounded, not O(buffer length) | `expect(large).toBeLessThanOrEqual(200);` | MOVE | R4: named as performance (P1) |
| `src/__tests__/memory-event-store.test.ts:1486` | P1: predecessor lookup cost is bounded, not O(buffer length) | `expect(large).toBeLessThanOrEqual(small * 2);` | MOVE | R3: relative bound |
| `src/__tests__/memory-event-store.test.ts:1670` | E33: a narrow range over 20000 entries probes ~log2(n), not… | `expect(probes).toBeLessThanOrEqual(64);` | MOVE | R6: complexity or speed guard (linear) |
| `src/__tests__/memory-event-store.test.ts:1814` | P1: a limit-500 read over a 20000-entry buffer examines < 1… | `expect(examined).toBeLessThan(1000);` | MOVE | R4: named as performance (P1) |
| `src/__tests__/memory-event-store.test.ts:2729` | X2: not a ceiling exemption — an over-ceiling nestedCalls e… | `expect(JSON.stringify(stored.data).length).toBeLessThanOrEqual(CEIL);` | NOT-A-BUDGET | count, size or status (D4); measured side reads no clock; the guard flags it: add `// budget-exempt: <reason>` |
| `src/__tests__/memory-event-store.test.ts:2874` | (E17) still caps a `data` string with no mime sibling | `expect(out.data.length).toBeLessThanOrEqual(DEFAULT_MAX_STRING_SIZE + 200);` | NOT-A-BUDGET | count, size or status (D4); measured side reads no clock; the guard flags it: add `// budget-exempt: <reason>` |
| `src/__tests__/openspec-dependencies-routes.test.ts:201` | a symlinked dependencies.yaml is invalid and never read thr… | `expect(Date.now() - t0).toBeLessThan(2000);` | unclassified — decide at implementation | R8: REWRITE if recipe (c) or (d) applies, else MOVE |
| `src/__tests__/openspec-poll-worker-dependencies.test.ts:161` | without probe mtimes (per-file stats only) a recompute stay… | `expect((times[9] + times[10]) / 2).toBeLessThan(60);` | MOVE | R4: named as performance (#P1) |
| `src/__tests__/openspec-poll-worker-dependencies.test.ts:188` | with the probe's per-change mtimes: median under 20 ms, and… | `expect((times[9] + times[10]) / 2).toBeLessThan(20);` | MOVE | R4: named as performance (#P1) |
| `src/__tests__/operate-required.test.ts:99` | 1000 sequential refusals with all three login sources compo… | `expect(performance.now() - start).toBeLessThanOrEqual(1000);` | MOVE | R4: named as performance (P1) |
| `src/__tests__/operate-required.test.ts:180` | 1000 on-link refusals with the real thunk and all three log… | `expect(performance.now() - start).toBeLessThanOrEqual(1000);` | MOVE | R4: named as performance (P1) |
| `src/__tests__/pi-gateway-duplicate-register.test.ts:491` | E19: two newcomers racing one incumbent still leave exactly… | `expect(reached.length).toBeLessThanOrEqual(1);` | NOT-A-BUDGET | count, size or status (D4); measured side reads no clock; the guard flags it: add `// budget-exempt: <reason>` |
| `src/__tests__/pi-gateway-socket-transport.test.ts:318` | UDS round-trip is not materially slower than TCP | `expect(Math.max(median(uds), floorMs)).toBeLessThanOrEqual(Math.max(median(tcp), floorMs) * 2);` | MOVE (hand) | hand: relative performance bound (UDS vs TCP median); fails the A6 liveness rule |
| `src/__tests__/plugin-assets-integration.test.ts:103` | 10 admitted plugins × 50 files: GET /api/plugins and /api/p… | `expect(await p95("/api/plugins")).toBeLessThanOrEqual(50);` | MOVE | R4: named as performance (p95) |
| `src/__tests__/plugin-assets-integration.test.ts:104` | 10 admitted plugins × 50 files: GET /api/plugins and /api/p… | `expect(await p95("/api/plugins/runtime-clients")).toBeLessThanOrEqual(50);` | MOVE | R4: named as performance (p95) |
| `src/__tests__/plugin-assets-integration.test.ts:105` | 10 admitted plugins × 50 files: GET /api/plugins and /api/p… | `` expect(await p95(`/plugin-assets/perf4/${sha}/chunk-9.js`)).toBeLessThanOrEqual(10); `` | MOVE | R4: named as performance (p95) |
| `src/__tests__/plugin-credential-store.test.ts:217` | P1: 20 concurrent updates all land within the lock budget | `expect(Date.now() - started).toBeLessThan(2_000);` | MOVE | R4: named as performance (P1) |
| `src/__tests__/plugin-credential-store.test.ts:267` | X1: identical corrupt bytes in auth.json and the store each… | `expect(Date.now() - started).toBeLessThan(100);` | unclassified — decide at implementation | R8: REWRITE if recipe (c) or (d) applies, else MOVE |
| `src/__tests__/plugin-credential-store.test.ts:287` | X4: contention waits for a short hold and rejects ELOCKED a… | `expect(elapsed).toBeLessThan(3_000);` | REWRITE | R5: outcome of a timeout/abort/hang path (reject) |
| `src/__tests__/plugin-credential-store.test.ts:466` | a write with no key available is refused before the store l… | `expect(Date.now() - started).toBeLessThan(500); // never waited on the held lock` | REWRITE | R5: outcome of a timeout/abort/hang path (refuse) |
| `src/__tests__/plugin-credential-store.test.ts:531` | P4: p95 of decode+parse per get on a 2 MiB envelope is unde… | `expect(times[Math.floor(times.length * 0.95)]).toBeLessThan(50);` | MOVE | R4: named as performance (P4) |
| `src/__tests__/plugin-ws-route.test.ts:331` | closes open sockets with 1001 within 1 s and 404s later upg… | `expect(Date.now() - startedAt).toBeLessThan(1000);` | unclassified — decide at implementation | R8: REWRITE if recipe (c) or (d) applies, else MOVE |
| `src/__tests__/provider-auth-lock-contention.test.ts:112` | does not delay an uncontended write | `expect(elapsed).toBeLessThan(50);` | unclassified — decide at implementation | R8: REWRITE if recipe (c) or (d) applies, else MOVE |
| `src/__tests__/provider-auth-lock-contention.test.ts:147` | rejects without touching auth.json once the bound is exhaus… | `expect(elapsed).toBeLessThan(3_000);` | REWRITE | R5: outcome of a timeout/abort/hang path (reject) |
| `src/__tests__/provider-auth-lock-contention.test.ts:165` | propagates a non-contention lock failure immediately, unret… | `expect(Date.now() - started).toBeLessThan(100);` | MOVE | R6: complexity or speed guard (immediate) |
| `src/__tests__/provider-auth-lock-contention.test.ts:208` | locks the non-resolved spelling, not the symlink target | `expect(Date.now() - started).toBeLessThan(1_000);` | unclassified — decide at implementation | R8: REWRITE if recipe (c) or (d) applies, else MOVE |
| `src/__tests__/provider-auth-lock-coordination.test.ts:141` | E5: interactive removal still gives up after ~2 s | `expect(elapsed).toBeLessThanOrEqual(2_500);` | REWRITE | R5: outcome of a timeout/abort/hang path (gives up) |
| `src/__tests__/provider-auth-registry.test.ts:219` | p95 stays under the 1500 ms ceiling over five builds | `expect(p95).toBeLessThan(1500);` | MOVE | R4: named as performance (p95) |
| `src/__tests__/provider-auth-routes-lock-contention.test.ts:138` | keeps answering /api/health while a DELETE waits for the lo… | `expect(p95(latencies)).toBeLessThan(200);` | MOVE | R4: named as performance (p95) |
| `src/__tests__/provider-auth-routes-lock-contention.test.ts:170` | does not serialize concurrent writes into a stall | `expect(wall).toBeLessThan(2_000);` | REWRITE | R5: outcome of a timeout/abort/hang path (stall) |
| `src/__tests__/provider-auth-routes-lock-contention.test.ts:171` | does not serialize concurrent writes into a stall | `expect(p95(latencies)).toBeLessThan(200);` | MOVE | R4: named as performance (p95) |
| `src/__tests__/provider-probe.test.ts:382` | stalled upstream: probe waits out timeoutMs, then returns o… | `expect(elapsed).toBeLessThan(5_000);` | MOVE | R4: named as performance (P1) |
| `src/__tests__/provider-probe.test.ts:742` | %s: every 3xx x Location variant is ok:false/redirect, no s… | `expect(Date.now() - t0).toBeLessThan(3_000);` | REWRITE | R5: outcome of a timeout/abort/hang path (stall) |
| `src/__tests__/provider-routes-single-provider.test.ts:176` | E13: blank name in the path (%20) is rejected and the file … | `expect(res.statusCode).toBeLessThan(500);` | NOT-A-BUDGET | count, size or status (D4); measured side reads no clock; the guard flags it: add `// budget-exempt: <reason>` |
| `src/__tests__/provider-routes-single-provider.test.ts:467` | P1: with the upstream stalled, 20 PATCH responses stay p95 … | `expect(p95).toBeLessThan(300);` | MOVE | R4: named as performance (P1) |
| `src/__tests__/push-webhook-transport.test.ts:210` | aborts a hanging receiver at 5 000 ms (test-plan #X9) | `expect(elapsed).toBeLessThanOrEqual(5_250 + 500);` | REWRITE | R5: outcome of a timeout/abort/hang path (abort) |
| `src/__tests__/replay-compaction.test.ts:149` | P3: p95 under 50 ms on a 20k-event window, single output ar… | `expect(samples[Math.floor(samples.length * 0.95) - 1]).toBeLessThan(50);` | MOVE | R4: named as performance (P3) |
| `src/__tests__/resource-activation-toggle.test.ts:894` | keeps p95 toggle latency under 1s [P1] | `expect(timings[Math.floor(timings.length * 0.95)]).toBeLessThan(1000);` | MOVE | R4: named as performance (p95) |
| `src/__tests__/route-admission.bench.test.ts:74` | P1: direct-match admission adds <= 2 ms p50 / <= 15 ms p99 … | `expect(pct(b.ms, 0.5) - pct(a.ms, 0.5)).toBeLessThanOrEqual(2);` | MOVE | R4: named as performance (P1) |
| `src/__tests__/route-admission.bench.test.ts:75` | P1: direct-match admission adds <= 2 ms p50 / <= 15 ms p99 … | `expect(pct(b.ms, 0.99) - pct(a.ms, 0.99)).toBeLessThanOrEqual(15);` | MOVE | R4: named as performance (P1) |
| `src/__tests__/route-admission.bench.test.ts:160` | P1: GET /api/file direct match adds <= 2 ms p50 / <= 15 ms … | `expect(pct(b.ms, 0.5) - pct(a.ms, 0.5)).toBeLessThanOrEqual(2);` | MOVE | R4: named as performance (P1) |
| `src/__tests__/route-admission.bench.test.ts:161` | P1: GET /api/file direct match adds <= 2 ms p50 / <= 15 ms … | `expect(pct(b.ms, 0.99) - pct(a.ms, 0.99)).toBeLessThanOrEqual(15);` | MOVE | R4: named as performance (P1) |
| `src/__tests__/route-admission.bench.test.ts:188` | P3: the per-asset live-preview re-check on a direct-match t… | `expect(pct(ms, 0.95)).toBeLessThanOrEqual(10);` | MOVE | R4: named as performance (P3) |
| `src/__tests__/route-admission.bench.test.ts:247` | P4: a 50-asset derived-worktree preview does not starve 20 … | `expect(pct(gitMs, 0.99)).toBeLessThanOrEqual(3000);` | MOVE | R4: named as performance (P4) |
| `src/__tests__/route-admission.bench.test.ts:265` | P5: recorded — per-asset re-check on a derived worktree and… | `expect(firstMs).toBeLessThanOrEqual(3000);` | MOVE | R4: named as performance (P5) |
| `src/__tests__/session-diff-source.test.ts:529` | 7.1 cache hit skips the worker; second request < 20ms (P3) | `expect(secondMs).toBeLessThan(250);` | MOVE | R4: named as performance (P3) |
| `src/__tests__/session-diff-source.test.ts:680` | 7.7 a large transcript does not block the event loop (P1) | `expect(maxGap).toBeLessThan(100);` | MOVE | R4: named as performance (P1) |
| `src/__tests__/session-diff.perf.test.ts:85` | p95 of 20 sequential runs stays under 300 ms | `expect(p95).toBeLessThan(BUDGET_MS);` | MOVE | R4: named as performance (p95) |
| `src/__tests__/shutdown-terminates-any-strategy.test.ts:214` | T4 — escalates to SIGKILL against a process that ignores SI… | `expect(elapsed, "shutdown took longer than the ladder's own bound").toBeLessThan(8000);` | ALLOW-LIST (hand) | hand: A6; shutdown escalation ladder bound (1.5 s grace + 2 s SIGTERM window, :210-213) |
| `src/__tests__/spawn-correlation-performance.test.ts:85` | adds under 2ms at p95 to an arm+clear pair | `expect(added).toBeLessThan(2);` | MOVE | R4: named as performance (p95) |
| `src/__tests__/spawn-correlation-performance.test.ts:89` | adds under 2ms at p95 to an arm+clear pair | `expect(perPair).toBeLessThan(20);` | MOVE | R4: named as performance (p95) |
| `src/__tests__/spawn-correlation-performance.test.ts:133` | returns the correlation map to zero after the derived TTL, … | `expect((await retained()) - baseline).toBeLessThan(10 * 1024 * 1024);` | MOVE | R4: named as performance (perf) |
| `src/__tests__/sudo-credential-wiring.test.ts:41` | (a) no subscribed browser owns the session: refused in the … | `expect(Date.now() - t0).toBeLessThan(1_000); // far below the 2 000 ms ack deadline: no timer …` | REWRITE | R5: outcome of a timeout/abort/hang path (refuse) |
| `src/__tests__/terminal-ownership.test.ts:432` | CodeRabbit: a live terminal_added decides all owner sockets… | `expect(Date.now() - t0).toBeLessThan(80 * 3); // sequential would be ≥ 480 ms` | REWRITE | R5: outcome of a timeout/abort/hang path (timeout) |
| `src/__tests__/tunnel-readiness.test.ts:195` | X9/P2: a HUNG predicate is bounded and marked stale, not aw… | `expect(Date.now() - start).toBeLessThan(1000);` | MOVE | R4: named as performance (P2) |
| `src/__tests__/tunnel-readiness.test.ts:269` | X9: one hung provider does not delay or blank the other thr… | `expect(Date.now() - start).toBeLessThan(1000);` | REWRITE | R5: outcome of a timeout/abort/hang path (hung) |
| `src/__tests__/vault-delivery-projects.test.ts:174` | 200 sessions across 200 projects: no repeat writes, every p… | `expect(performance.now() - t).toBeLessThan(5_000);` | MOVE | R4: named as performance (P1) |
| `src/access/__tests__/ladder-perf.test.ts:45` | a denial 12 levels deep: p95 < 5 ms over 1000 iterations | `expect(p95(t)).toBeLessThan(5);` | MOVE | R4: named as performance (p95) |
| `src/access/__tests__/ladder-perf.test.ts:92` | 10k prompt -> settle cycles: registry returns to baseline, … | `expect(process.memoryUsage().rss - rss0).toBeLessThan((process.env.CI ? 32 : 10) * 1024 * 1024…` | MOVE | R2: memory amount |
| `src/access/__tests__/ladder-perf.test.ts:143` | 500 denials across 50 subjects: p95 added latency < 5 ms, <… | `expect(p95(t)).toBeLessThan(5);` | MOVE | R4: named as performance (p95) |
| `src/access/__tests__/ladder-perf.test.ts:186` | evaluateContainment(action:'write') on a 12-deep path with … | `expect(p95(t)).toBeLessThan(5);` | MOVE | R4: named as performance (p95) |
| `src/access/__tests__/provisioning.test.ts:591` | 32 grantable lines against a 168-grant store: sync section … | `expect(sync).toBeLessThan(50);` | MOVE | R4: named as performance (#P1) |
| `src/acp-bridge/__tests__/fake-acp-agent.test.ts:71` | v2 turn: accepts with messageId first, ends with state_upda… | `expect(msgs.findIndex((m) => m.id === 3)).toBeLessThan(msgs.findIndex((m) => m.method === "ses…` | MOVE | R3: relative bound |
| `src/acp-bridge/__tests__/perf.test.ts:42` | P1: p95 per update (normaliser → adapter → send) < 5 ms | `expect(Math.min(...runs.map((r) => r.p95))).toBeLessThan(5);` | MOVE | R4: named as performance (P1) |
| `src/acp-bridge/__tests__/perf.test.ts:66` | P2: replaying a log at the 64 MiB cap takes < 10 s | `expect(Date.now() - t0).toBeLessThan(10_000);` | MOVE | R4: named as performance (P2) |
| `src/acp-bridge/__tests__/session-state.test.ts:190` | E37: an unanswered set_config_option times out with a notif… | `expect(dt).toBeLessThan(1500);` | REWRITE | R5: outcome of a timeout/abort/hang path (times out) |
| `src/attachments/__tests__/attachment-ingest.test.ts:44` | E7: a 10.5 MB attachment leaves the row event tiny and keep… | `expect(bytesOf(event.data)).toBeLessThan(DEFAULT_MAX_EVENT_DATA_SIZE);` | unclassified — decide at implementation | R8: REWRITE if recipe (c) or (d) applies, else MOVE |
| `src/attachments/__tests__/attachment-ingest.test.ts:125` | E8: 20 attachments all become pending and the row stays bou… | `expect(bytesOf(event.data)).toBeLessThan(DEFAULT_MAX_EVENT_DATA_SIZE);` | unclassified — decide at implementation | R8: REWRITE if recipe (c) or (d) applies, else MOVE |
| `src/identity/__tests__/domain-fanout.test.ts:90` | N slow policy calls cost ~one timeout, not N× (no head-of-l… | `expect(Date.now() - t0).toBeLessThan(80 * 3); // sequential would be ≥ 480 ms` | REWRITE | R5: outcome of a timeout/abort/hang path (timeout) |
| `src/lib/__tests__/folder-project.test.ts:378` | P3: a hung opendir ends at the deadline with truncated and … | `expect(Date.now() - t0).toBeLessThan(150 + 250);` | MOVE | R4: named as performance (P3) |
| `src/lib/__tests__/folder-project.test.ts:397` | P5: 2000-entry tree × 256 patterns resolves in < 500 ms | `expect(performance.now() - t0).toBeLessThan(500);` | MOVE | R4: named as performance (P5) |
| `src/lib/__tests__/grant-layer.test.ts:283` | 9d.1 1000 hot-path reads with 50 grants stay fast and do no… | `expect(elapsed).toBeLessThan(1000);` | MOVE | R6: complexity or speed guard (fast) |
| `src/lib/__tests__/grant-layer.test.ts:296` | 9d.2 200 cold misses with 50 grants stay bounded | `expect(perMiss).toBeLessThan(50);` | MOVE | R7: bound is the case's only assertion |
| `src/lib/__tests__/path-containment.test.ts:250` | X1: a probe timeout fails closed, never to a derived path | `expect(Date.now() - started).toBeLessThan(1_500);` | REWRITE | R5: outcome of a timeout/abort/hang path (timeout) |
| `src/lib/__tests__/path-containment.test.ts:267` | X2: the event loop stays responsive while a containment pro… | `expect(Date.now() - started).toBeLessThan(200);` | REWRITE | R5: outcome of a timeout/abort/hang path (fails closed) |
| `src/model-proxy/__tests__/internal-auth-storage-coordination.test.ts:448` | P1: waiting for the lock on the refresh path does not block… | `expect(sorted[Math.ceil(sorted.length * 0.95) - 1]).toBeLessThan(200);` | MOVE | R4: named as performance (P1) |
| `src/model-proxy/__tests__/internal-auth-storage-coordination.test.ts:463` | X1: during a 5 s runtime-triggered refresh the auth.json lo… | `expect(Date.now() - started).toBeLessThan(100);` | unclassified — decide at implementation | R8: REWRITE if recipe (c) or (d) applies, else MOVE |
| `src/model-proxy/__tests__/internal-auth-storage-coordination.test.ts:467` | X1: during a 5 s runtime-triggered refresh the auth.json lo… | `expect(Date.now() - started).toBeLessThan(200);` | unclassified — decide at implementation | R8: REWRITE if recipe (c) or (d) applies, else MOVE |
| `src/model-proxy/__tests__/streamer.test.ts:138` | AbortSignal abort terminates iteration promptly (task 6.3) | `expect(elapsed).toBeLessThan(200);` | MOVE | R7: bound is the case's only assertion |
| `src/model-proxy/__tests__/streamer.test.ts:140` | AbortSignal abort terminates iteration promptly (task 6.3) | `expect(collected.length).toBeLessThanOrEqual(2);` | NOT-A-BUDGET | count, size or status (D4); measured side reads no clock; the guard flags it: add `// budget-exempt: <reason>` |
| `src/questions/__tests__/brief-policy.test.ts:160` | caps question, options and sub-questions before redacting (… | `expect(performance.now() - t0).toBeLessThan(1000);` | MOVE | R7: bound is the case's only assertion |
| `src/questions/__tests__/question-snapshot.test.ts:224` | caps assistant text / tool summary input before redacting (… | `expect(performance.now() - t0).toBeLessThan(500);` | MOVE | R6: complexity or speed guard (linear) |
| `src/routes/__tests__/grep-routes.test.ts:115` | #X1: a catastrophic regex answers 504 `search timed out` wh… | `expect(Date.now() - t0).toBeLessThan(200);` | REWRITE | R5: outcome of a timeout/abort/hang path (timed out) |
| `src/routes/__tests__/pi-settings-routes.test.ts:309` | a waiting PUT does not block concurrent requests | `expect(Math.max(...latencies)).toBeLessThan(50);` | MOVE | R4: named as performance (P1) |
| `src/rpc-keeper/__tests__/keeper.test.ts:1085` | P1: rotation never stalls the RPC path — 200 writes land ac… | `expect(maxLatencyMs).toBeLessThan(1050);` | ALLOW-LIST (hand) | hand: A6 names keeper; bound = production WRITE_RPC_ATTEMPT_TIMEOUT_MS 350 x 3 (:1061-1062) |
| `src/session/__tests__/open-tool-calls.test.ts:133` | scans a full store-cap stream in under 10 ms (#P1) | `expect(times[2]).toBeLessThan(process.env.CI ? 30 : 10);` | MOVE | R4: named as performance (#P1) |
| `src/session/__tests__/open-tool-calls.test.ts:276` | scans a 50,000-event suffix in under 25 ms (test-plan #P1) | `expect(times[2]).toBeLessThan(25);` | MOVE | R4: named as performance (#P1) |
| `src/session/__tests__/session-diff-eventloop.test.ts:77` | services timers while a many-file + large-file diff computes | `expect(maxGap).toBeLessThan(500);` | MOVE | R4: named as performance (budget) |
| `src/session/__tests__/session-diff-eventloop.test.ts:156` | P1: a ~24 MiB (under-limit) diff + 50 small files keeps the… | `expect(maxGap).toBeLessThan(500);` | MOVE | R4: named as performance (P1) |
| `src/tls/sources/acme/__tests__/acme-source-manager.test.ts:380` | E29: CNAME created at t=1 min is picked up by the 15 min re… | `expect(orderAt[0]).toBeLessThan(20 * MIN);` | unclassified — decide at implementation | R8: REWRITE if recipe (c) or (d) applies, else MOVE |
| `src/tls/sources/acme/__tests__/acme-source-timing.test.ts:148` | E32: a queued obtain rejects 'registration busy' by 10.5 mi… | `expect(settledAt).toBeLessThanOrEqual(10.5 * MIN);` | REWRITE | R5: outcome of a timeout/abort/hang path (reject) |

Checked, NOT-A-BUDGET, and not flagged by the guard:

- `src/__tests__/bearer-auth.test.ts:202`: measured side holds no in-file clock or memory reading
- `src/__tests__/bearer-auth.test.ts:203`: measured side holds no in-file clock or memory reading
- `src/__tests__/browser-gateway-load.test.ts:129`: measured side holds no in-file clock or memory reading
- `src/__tests__/browser-gateway-load.test.ts:291`: measured side holds no in-file clock or memory reading
- `src/__tests__/browser-gateway-load.test.ts:330`: measured side holds no in-file clock or memory reading
- `src/__tests__/browser-gateway-load.test.ts:370`: measured side holds no in-file clock or memory reading
- `src/__tests__/browser-gateway-load.test.ts:402`: measured side holds no in-file clock or memory reading
- `src/__tests__/browser-gateway-load.test.ts:473`: measured side holds no in-file clock or memory reading
- `src/__tests__/browser-gateway-load.test.ts:490`: measured side holds no in-file clock or memory reading
- `src/__tests__/browser-gateway-load.test.ts:589`: measured side holds no in-file clock or memory reading
- `src/__tests__/csp-report-sink.test.ts:513`: count, size or status (D4); measured side reads no clock
- `src/__tests__/csp-report-sink.test.ts:544`: count, size or status (D4); measured side reads no clock
- `src/__tests__/csp.test.ts:292`: ordering check: bound side is itself a reading, no slack arithmetic
- `src/__tests__/directory-service.test.ts:701`: measured side is not derived from a reading in the case's scope (counter, bytes or constant)
- `src/__tests__/directory-service.test.ts:703`: measured side is not derived from a reading in the case's scope (counter, bytes or constant)
- `src/__tests__/large-resume-replay.test.ts:673`: ordering check: bound side is itself a reading, no slack arithmetic
- `src/__tests__/live-static-proxy.test.ts:321`: measured side holds no in-file clock or memory reading
- `src/__tests__/memory-event-store.test.ts:583`: ordering check: bound side is itself a reading, no slack arithmetic
- `src/__tests__/memory-event-store.test.ts:977`: measured side is not derived from a reading in the case's scope (counter, bytes or constant)
- `src/__tests__/memory-event-store.test.ts:1467`: count, size or status (D4); measured side reads no clock
- `src/__tests__/memory-event-store.test.ts:1496`: count, size or status (D4); measured side reads no clock
- `src/__tests__/memory-event-store.test.ts:1499`: count, size or status (D4); measured side reads no clock
- `src/__tests__/memory-event-store.test.ts:1549`: count, size or status (D4); measured side reads no clock
- `src/__tests__/memory-event-store.test.ts:1550`: measured side is not derived from a reading in the case's scope (counter, bytes or constant)
- `src/__tests__/memory-event-store.test.ts:1605`: count, size or status (D4); measured side reads no clock
- `src/__tests__/memory-event-store.test.ts:1607`: measured side is not derived from a reading in the case's scope (counter, bytes or constant)
- `src/__tests__/memory-event-store.test.ts:1753`: measured side is not derived from a reading in the case's scope (counter, bytes or constant)
- `src/__tests__/memory-event-store.test.ts:2161`: measured side is not derived from a reading in the case's scope (counter, bytes or constant)
- `src/__tests__/memory-event-store.test.ts:2172`: measured side is not derived from a reading in the case's scope (counter, bytes or constant)
- `src/__tests__/memory-event-store.test.ts:2271`: measured side is not derived from a reading in the case's scope (counter, bytes or constant)
- `src/__tests__/memory-event-store.test.ts:2272`: count, size or status (D4); measured side reads no clock
- `src/__tests__/memory-event-store.test.ts:2312`: measured side is not derived from a reading in the case's scope (counter, bytes or constant)
- `src/__tests__/memory-event-store.test.ts:2318`: count, size or status (D4); measured side reads no clock
- `src/__tests__/memory-event-store.test.ts:2319`: measured side is not derived from a reading in the case's scope (counter, bytes or constant)
- `src/__tests__/memory-event-store.test.ts:2351`: measured side is not derived from a reading in the case's scope (counter, bytes or constant)
- `src/__tests__/memory-event-store.test.ts:2379`: measured side is not derived from a reading in the case's scope (counter, bytes or constant)
- `src/__tests__/memory-event-store.test.ts:2400`: measured side is not derived from a reading in the case's scope (counter, bytes or constant)
- `src/__tests__/memory-event-store.test.ts:2432`: measured side is not derived from a reading in the case's scope (counter, bytes or constant)
- `src/__tests__/memory-event-store.test.ts:2465`: measured side is not derived from a reading in the case's scope (counter, bytes or constant)
- `src/__tests__/memory-event-store.test.ts:2485`: measured side is not derived from a reading in the case's scope (counter, bytes or constant)
- `src/__tests__/memory-event-store.test.ts:2502`: measured side is not derived from a reading in the case's scope (counter, bytes or constant)
- `src/__tests__/memory-event-store.test.ts:2583`: measured side is not derived from a reading in the case's scope (counter, bytes or constant)
- `src/__tests__/memory-event-store.test.ts:2584`: count, size or status (D4); measured side reads no clock
- `src/__tests__/memory-session-manager.test.ts:226`: count, size or status (D4); measured side reads no clock
- `src/__tests__/memory-session-manager.test.ts:228`: count, size or status (D4); measured side reads no clock
- `src/__tests__/replay-compaction.test.ts:137`: count, size or status (D4); measured side reads no clock
- `src/__tests__/subscription-handler-compaction.test.ts:163`: count, size or status (D4); measured side reads no clock
- `src/__tests__/subscription-handler-compaction.test.ts:199`: measured side is not derived from a reading in the case's scope (counter, bytes or constant)
- `src/__tests__/subscription-handler.test.ts:143`: ordering check: bound side is itself a reading, no slack arithmetic
- `src/__tests__/subscription-handler.test.ts:145`: ordering check: bound side is itself a reading, no slack arithmetic
- `src/__tests__/subscription-handler.test.ts:539`: ordering check: bound side is itself a reading, no slack arithmetic
- `src/__tests__/vault-delivery-wiring.test.ts:209`: Date is faked in this case (fake-clock arithmetic, D4)
- `src/__tests__/vault-delivery-wiring.test.ts:220`: Date is faked in this case (fake-clock arithmetic, D4)
- `src/access/__tests__/ladder-perf.test.ts:144`: measured side holds no in-file clock or memory reading
- `src/access/__tests__/ladder-perf.test.ts:145`: count, size or status (D4); measured side reads no clock
- `src/acp-bridge/__tests__/fake-acp-agent.test.ts:119`: ordering check: bound side is itself a reading, no slack arithmetic
- `src/attachments/__tests__/display-fit-perf.test.ts:81`: measured side holds no in-file clock or memory reading
- `src/attachments/__tests__/display-fit-perf.test.ts:127`: measured side holds no in-file clock or memory reading
- `src/attachments/__tests__/display-fit-perf.test.ts:141`: measured side holds no in-file clock or memory reading
- `src/attachments/__tests__/display-fit-perf.test.ts:219`: measured side holds no in-file clock or memory reading
- `src/attachments/__tests__/display-fit-perf.test.ts:220`: measured side holds no in-file clock or memory reading
- `src/attachments/__tests__/display-fit-perf.test.ts:223`: measured side holds no in-file clock or memory reading
- `src/attachments/__tests__/display-fit-perf.test.ts:265`: measured side holds no in-file clock or memory reading
- `src/embed-lifecycle/__tests__/plugin-governed-reaper.test.ts:304`: Date is faked in this case (fake-clock arithmetic, D4)
- `src/model-proxy/__tests__/internal-auth-storage-coordination.test.ts:449`: ordering check: bound side is itself a reading, no slack arithmetic
- `src/questions/__tests__/question-snapshot.test.ts:133`: count, size or status (D4); measured side reads no clock
- `src/questions/__tests__/question-snapshot.test.ts:225`: count, size or status (D4); measured side reads no clock
- `src/rpc-keeper/__tests__/keeper.test.ts:885`: measured side holds no in-file clock or memory reading
- `src/rpc-keeper/__tests__/keeper.test.ts:1139`: measured side holds no in-file clock or memory reading
- `src/tls/sources/acme/__tests__/acme-source-manager.test.ts:519`: measured side holds no in-file clock or memory reading
- `src/tls/sources/acme/__tests__/dns.test.ts:190`: Date is faked in this case (fake-clock arithmetic, D4)

## extension

Paths are relative to `packages/extension/`.

| file:line | case | assertion | disposition | rule / reason |
|---|---|---|---|---|
| `src/__tests__/connection-dropped-frames.test.ts:419` | evicts 10 000 frames without re-parsing and well inside the… | `expect(elapsed).toBeLessThan(1_000);` | unclassified — decide at implementation | R8: REWRITE if recipe (c) or (d) applies, else MOVE |
| `src/__tests__/connection-dropped-frames.test.ts:437` | evicts in O(1) amortised: the same overflow work against a … | `expect(ratio).toBeLessThan(8);` | MOVE | R7: bound is the case's only assertion |
| `src/__tests__/connection-inbound-pump.test.ts:660` | drains a 1000-message burst well within the budget | `expect(elapsed).toBeLessThan(500);` | MOVE | R4: named as performance (budget) |
| `src/__tests__/git-probe-scheduler.test.ts:54` | E26: tool end every 500 ms for 60 s → ≤ 6 slow probes | `expect(fn.mock.calls.length).toBeLessThanOrEqual(6);` | NOT-A-BUDGET | count, size or status (D4); measured side reads no clock; the guard flags it: add `// budget-exempt: <reason>` |
| `src/__tests__/inbound-limits.test.ts:505` | BP2: the limiter adds < 1 ms p99 per command | `expect(p99(enabled) - p99(disabled)).toBeLessThan(1);` | MOVE | R4: named as performance (BP2) |
| `src/__tests__/inbound-limits.test.ts:514` | BP2: the limiter adds < 1 ms p99 per command | `expect(p99(bash)).toBeLessThan(1);` | MOVE | R4: named as performance (BP2) |
| `src/__tests__/pr-status.test.ts:429` | E32: 5 branches in 60 s → at most 2 branch-change probes, t… | `expect(probe.mock.calls.length).toBeLessThanOrEqual(3);` | NOT-A-BUDGET | count, size or status (D4); measured side reads no clock; the guard flags it: add `// budget-exempt: <reason>` |
| `src/__tests__/project-trust.test.ts:323` | p95 < 20 ms with 1,000 entries and a cwd 20 levels deep | `expect(times[Math.floor(times.length * 0.95)]).toBeLessThan(20);` | MOVE | R4: named as performance (p95) |
| `src/__tests__/project-trust.test.ts:665` | #X1 a closed port → live-unreachable well inside the budget | `expect(performance.now() - t0).toBeLessThan(400);` | MOVE | R4: named as performance (budget) |
| `src/__tests__/project-trust.test.ts:677` | #X2 a server that delays 2 s → live-timeout ≤ 400 ms, and t… | `expect(performance.now() - t0).toBeLessThan(400);` | REWRITE | R5: outcome of a timeout/abort/hang path (timeout) |
| `src/__tests__/project-trust.test.ts:692` | #P2 a server that accepts and never answers: resolves withi… | `` expect(took, `run ${i}`).toBeLessThanOrEqual(400); `` | MOVE | R4: named as performance (#P2) |
| `src/__tests__/project-trust.test.ts:726` | answer at 250 ms + a walker reading 50 ms at a time: live-t… | `` expect(took, `run ${run}`).toBeLessThanOrEqual(400); `` | MOVE | R4: named as performance (#P4) |
| `src/__tests__/server-auto-start-guarded.test.ts:192` | X4: the loser POLLS — it must not burn the whole budget whe… | `expect(elapsed).toBeLessThan(BUDGET / 10);` | MOVE | R4: named as performance (budget) |
| `src/__tests__/server-auto-start-guarded.test.ts:376` | 100 sequential calls with a reachable dashboard never touch… | `expect(p95(samples)).toBeLessThan(Math.max(5, p95(baseline) * 20));` | MOVE | R3: relative bound |
| `src/__tests__/subagent-frame-buffer.test.ts:238` | derived scan is cheap on a full buffer (worst-case full-sca… | `expect(dt).toBeLessThan(25);` | unclassified — decide at implementation | R8: REWRITE if recipe (c) or (d) applies, else MOVE |
| `src/__tests__/sudo-askpass-cache.test.ts:223` | 1 000 hits over the unix socket: p95 <= 100 ms, never a mod… | `expect(times[Math.floor(times.length * 0.95)]).toBeLessThanOrEqual(100);` | MOVE | R4: named as performance (p95) |
| `src/__tests__/sudo-askpass-helper.test.ts:138` | the helper's argv and env never contain the password | `expect(r.ms).toBeLessThan(5000); // no hang` | unclassified — decide at implementation | named duration with no in-file reading (imported helper or constant?) |
| `src/__tests__/sudo-askpass-install.test.ts:281` | rm -rf of the install dir: the helper fails fast, shutdown … | `expect(Date.now() - t0).toBeLessThan(2000);` | REWRITE | R5: outcome of a timeout/abort/hang path (stall) |
| `src/__tests__/sudo-askpass-redaction-perf.test.ts:77` | median of 5 passes over 10 MiB with a 64-char password regi… | `expect(maskedOut).toBeLessThan(TOTAL);` | MOVE | R4: named as performance (perf) |
| `src/__tests__/sudo-askpass-redaction-perf.test.ts:78` | median of 5 passes over 10 MiB with a 64-char password regi… | `expect(median(masked)).toBeLessThanOrEqual(2 * median(base) + SLACK_MS);` | MOVE | R3: relative bound |
| `src/__tests__/transcript-backfill.test.ts:146` | a large transcript yields its first chunk in bounded time | `expect(elapsedMs).toBeLessThan(250);` | MOVE | R4: named as performance (latency) |
| `src/__tests__/usage-drain.test.ts:336` | 10,000 entries, cursor at end, no new entries: p95 ≤ 5 ms o… | `expect(p95).toBeLessThanOrEqual(5);` | MOVE | R4: named as performance (p95) |
| `src/__tests__/vault-redaction.test.ts:222` | p95 <= 5 ms per 64 KiB event with 20 held values | `expect(p95).toBeLessThanOrEqual(5);` | MOVE | R4: named as performance (p95) |
| `src/__tests__/watchdog.test.ts:212` | reports ~zero tick drift when the loop was never blocked | `expect(info.maxTickDriftMs).toBeLessThan(1_000);` | unclassified — decide at implementation | named duration with no in-file reading (imported helper or constant?) |
| `src/path-gate/__tests__/handler.test.ts:351` | P2 disabled gate: p95 < 0.05 ms and no fs access | `expect(samples[Math.floor(samples.length * 0.95)]).toBeLessThan(0.05);` | MOVE | R4: named as performance (P2) |
| `src/path-gate/__tests__/handler.test.ts:366` | P1 in-root p95 < 1 ms and P3 never touches the server | `expect(samples[Math.floor(samples.length * 0.95)]).toBeLessThan(1);` | MOVE | R4: named as performance (P1) |
| `src/path-gate/__tests__/handler.test.ts:542` | #P1 in-root reads add no send and stay fast | `expect(times[Math.floor(times.length * 0.95)]).toBeLessThan(1);` | MOVE | R4: named as performance (#P1) |
| `src/path-gate/__tests__/handler.test.ts:783` | #P1/#P3 suppressed retries: p95 < 1 ms (YOLO supported and … | `expect(await measure(yoloH)).toBeLessThan(1);` | MOVE | R4: named as performance (#P1) |
| `src/path-gate/__tests__/handler.test.ts:787` | #P1/#P3 suppressed retries: p95 < 1 ms (YOLO supported and … | `expect(await measure(plain)).toBeLessThan(1);` | MOVE | R4: named as performance (#P1) |

Checked, NOT-A-BUDGET, and not flagged by the guard:

- `src/__tests__/pr-status.test.ts:103`: Date is faked in this case (fake-clock arithmetic, D4)

## shared

Paths are relative to `packages/shared/`.

| file:line | case | assertion | disposition | rule / reason |
|---|---|---|---|---|
| `src/__tests__/cwd-guard.test.ts:342` | a hung request realpath resolves indeterminate at the deadl… | `expect(Date.now() - t0).toBeLessThan(1000);` | REWRITE | R5: outcome of a timeout/abort/hang path (hung) |
| `src/__tests__/cwd-guard.test.ts:464` | a hung runner resolves indeterminate at the deadline and fr… | `expect(Date.now() - t0).toBeLessThan(900);` | REWRITE | R5: outcome of a timeout/abort/hang path (hung) |
| `src/__tests__/cwd-guard.test.ts:504` | a hung runner resolves indeterminate at the deadline and fr… | `expect(elapsed).toBeLessThan(3400);` | REWRITE | R5: outcome of a timeout/abort/hang path (hung) |
| `src/__tests__/detached-spawn.test.ts:172` | respects a small windowMs and does not hang on live children | `expect(elapsed).toBeLessThan(500);` | REWRITE | R5: outcome of a timeout/abort/hang path (hang) |
| `src/__tests__/detached-spawn.test.ts:217` | short-circuits on child error event | `expect(elapsed).toBeLessThan(5000);` | REWRITE | R5: outcome of a timeout/abort/hang path (short-circuit) |
| `src/__tests__/detached-spawn.test.ts:234` | waits indefinitely when deadlineMs is undefined (succeeds e… | `expect(elapsed).toBeLessThan(2000);` | REWRITE | R5: outcome of a timeout/abort/hang path (deadline) |
| `src/__tests__/detached-spawn.test.ts:254` | waits indefinitely until child crashes (no deadline, child-… | `expect(elapsed).toBeLessThan(2000); // short-circuited, not stuck` | REWRITE | R5: outcome of a timeout/abort/hang path (deadline) |
| `src/__tests__/git-worktree-helpers.test.ts:53` | P4: a 100 000-dash run stays under 100 ms | `expect(performance.now() - t0).toBeLessThan(100);` | MOVE | R4: named as performance (P4) |
| `src/__tests__/host-port.test.ts:39` | normalizes a long run of trailing dots without backtracking | `expect(Date.now() - t0).toBeLessThan(200);` | MOVE | R6: complexity or speed guard (long run of) |
| `src/__tests__/model-catalogue.test.ts:113` | builds a large union without quadratic blowup (test-plan #P… | `expect(samples[Math.floor(samples.length * 0.95)]).toBeLessThan(50);` | MOVE | R4: named as performance (#P2) |
| `src/__tests__/native-module-abi.test.ts:423` | P1: stat path p95 < 50ms over a 100-entry manifest, 100 ite… | `expect(p95(durations)).toBeLessThan(50);` | MOVE | R4: named as performance (P1) |
| `src/__tests__/native-module-abi.test.ts:449` | P2: shim-probe path p95 < 250ms over a 100-entry manifest, … | `expect(p95(durations)).toBeLessThan(250);` | MOVE | R4: named as performance (P2) |
| `src/__tests__/openspec-dependencies.test.ts:157` | E3: size boundary, alias, symlink and FIFO | `expect(Date.now() - t0).toBeLessThan(1000);` | unclassified — decide at implementation | R8: REWRITE if recipe (c) or (d) applies, else MOVE |
| `src/__tests__/pi-trust-resource-digest.test.ts:257` | 200 files / 2 MiB: manifest + HMAC p95 < 200 ms over 50 runs | `expect(times[Math.floor(times.length * 0.95)]).toBeLessThan(200);` | MOVE | R4: named as performance (p95) |
| `src/__tests__/platform-process.test.ts:292` | reports this process within 5s of now - uptime | `expect(Math.abs((ms as number) - (Date.now() - process.uptime() * 1000))).toBeLessThan(5000);` | unclassified — decide at implementation | R8: REWRITE if recipe (c) or (d) applies, else MOVE |
| `src/__tests__/redaction.test.ts:103` | 1 MB of unclosed BEGIN headers redacts < 200 ms | `expect(timed(input)).toBeLessThan(200);` | MOVE | R6: complexity or speed guard (linear) |
| `src/__tests__/redaction.test.ts:106` | 1 MB of BEGIN-without-KEY headers redacts < 200 ms | `expect(timed("-----BEGIN A B C ".repeat(Math.ceil(MB / 17)))).toBeLessThan(200);` | MOVE | R6: complexity or speed guard (linear) |
| `src/__tests__/redaction.test.ts:116` | 1 MB of BEGIN-without-KEY headers redacts < 200 ms | `expect(timed(input)).toBeLessThan(200);` | MOVE | R6: complexity or speed guard (linear) |
| `src/__tests__/server-pinning.test.ts:269` | refuses a hanging endpoint within the timeout | `expect(Date.now() - t0).toBeLessThan(600);` | REWRITE | R5: outcome of a timeout/abort/hang path (refuse) |
| `src/__tests__/source-matching.test.ts:227` | P5: a 100 000-slash run stays under 100 ms | `expect(performance.now() - t0).toBeLessThan(100);` | MOVE | R4: named as performance (P5) |
| `src/__tests__/url-policy.test.ts:93` | a 100k run of interior control characters classifies quickl… | `expect(performance.now() - t0).toBeLessThan(500);` | MOVE | R6: complexity or speed guard (100k run) |
| `src/platform/__tests__/runner-abort.test.ts:63` | X4: abort settles non-ok within 500 ms and the child is gon… | `expect(Date.now() - started).toBeLessThan(5_000);` | REWRITE | R5: outcome of a timeout/abort/hang path (abort) |
| `src/platform/__tests__/runner-abort.test.ts:77` | settles within 500 ms of the abort | `expect(Date.now() - t0).toBeLessThan(500);` | REWRITE | R5: outcome of a timeout/abort/hang path (settles) |
| `src/platform/__tests__/runner-max-buffer.test.ts:98` | X1: runaway output settles well before the timeout and the … | `expect(Date.now() - started).toBeLessThan(5_000);` | REWRITE | R5: outcome of a timeout/abort/hang path (settles) |

## kb

Paths are relative to `packages/kb/`.

| file:line | case | assertion | disposition | rule / reason |
|---|---|---|---|---|
| `src/__tests__/chunker-links.test.ts:54` | P3: unclosed openers stay under 100 ms | `expect(performance.now() - t0).toBeLessThan(100);` | MOVE | R4: named as performance (P3) |
| `src/__tests__/dox-row.test.ts:157` | P1: strict parsers stay under 100 ms | `expect(time(() => expect(parseRows(line)).toEqual([]))).toBeLessThan(BUDGET_MS);` | MOVE | R4: named as performance (P1) |
| `src/__tests__/dox-row.test.ts:158` | P1: strict parsers stay under 100 ms | `expect(time(() => expect(replaceRowPurpose(line, "a", "NEW")).toBe(line))).toBeLessThan(BUDGET…` | MOVE | R4: named as performance (P1) |
| `src/__tests__/dox-row.test.ts:159` | P1: strict parsers stay under 100 ms | `expect(time(() => expect(parseFileIndex(line).size).toBe(0))).toBeLessThan(BUDGET_MS);` | MOVE | R4: named as performance (P1) |
| `src/__tests__/dox-row.test.ts:166` | P2: authored batch (loose) stays under 100 ms | `expect(time(() => { result = parseAuthoredBatch(line); })).toBeLessThan(BUDGET_MS);` | MOVE | R4: named as performance (P2) |
| `src/__tests__/frontmatter-indexing.test.ts:408` | P1: full reindex with frontmatter emit adds ≤ 25% wall-time… | `expect(minRatio).toBeLessThanOrEqual(1.25);` | MOVE | R4: named as performance (P1) |
| `src/__tests__/frontmatter-indexing.test.ts:431` | P2: one eq filter adds ≤ 25ms p95 vs unfiltered | `expect(p95(filtered) - p95(unfiltered)).toBeLessThanOrEqual(25);` | MOVE | R4: named as performance (P2) |
| `src/__tests__/git-scope-commits.test.ts:146` | P2/P3: 5 000-commit first index returns within budget; tran… | `expect(Date.now() - t0).toBeLessThan(1000);` | MOVE | R4: named as performance (P2) |
| `src/__tests__/git-scope-commits.test.ts:153` | P2/P3: 5 000-commit first index returns within budget; tran… | `expect(Math.max(...st.txMs)).toBeLessThan(1000);` | unclassified — decide at implementation | named duration with no in-file reading (imported helper or constant?) |
| `src/__tests__/git-scope-forge.test.ts:178` | a hung server is cut off by the request timeout and reporte… | `expect(Date.now() - t0).toBeLessThan(1500);` | REWRITE | R5: outcome of a timeout/abort/hang path (hung) |
| `src/__tests__/git-scope-sync.test.ts:38` | P1: a slow forge never blocks a search past the wait budget | `expect(Date.now() - t0).toBeLessThan(2500);` | MOVE | R4: named as performance (P1) |
| `src/__tests__/index-integrity-graph.test.ts:470` | P1 median forced pass ≤ 1.5 × median first index (600 files… | `expect(med(forced)).toBeLessThanOrEqual(1.5 * med(first));` | MOVE | R3: relative bound |
| `src/__tests__/index-integrity-install.test.ts:187` | E26 busy schedule 100,200,400,800,1600,2000… and gives up b… | `expect(sleeps.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(30_000);` | NOT-A-BUDGET (hand) | hand: sum of injected sleep values, not a measured duration; the guard flags it: add `// budget-exempt: <reason>` |
| `src/__tests__/net-guard.test.ts:143` | X1 times out when headers never arrive | `expect(dt).toBeLessThan(1000);` | REWRITE | R5: outcome of a timeout/abort/hang path (times out) |
| `src/__tests__/retrieval-quality.test.ts:178` | does not become pathologically slow on the fixture corpus | `expect((performance.now() - t) / 10).toBeLessThan(50);` | MOVE | R6: complexity or speed guard (pathological) |
| `src/__tests__/seed-perf.test.ts:47` | P1 median seeded ≤ 0.35 × median unseeded (600 files × 8 he… | `expect(median(seeded)).toBeLessThanOrEqual(0.35 * median(unseeded));` | MOVE | R3: relative bound |
| `src/__tests__/unicode-tokenizer.test.ts:207` | pathological combining-mark input folds linearly (X2) | `expect(performance.now() - t0).toBeLessThan(200);` | MOVE | R6: complexity or speed guard (pathological) |
| `src/__tests__/verdict.test.ts:602` | P5: ~500 staged renames — default async runner finishes und… | `expect(elapsedMs).toBeLessThan(RENAME_SCAN_TIMEOUT_MS);` | unclassified — decide at implementation | named duration with no in-file reading (imported helper or constant?) |
| `src/__tests__/verdict.test.ts:603` | P5: ~500 staged renames — default async runner finishes und… | `expect(maxDelayMs).toBeLessThanOrEqual(250);` | unclassified — decide at implementation | named duration with no in-file reading (imported helper or constant?) |
| `src/__tests__/verdict.test.ts:610` | X5: a scan exceeding RENAME_SCAN_TIMEOUT_MS degrades to GON… | `expect(elapsedMs).toBeLessThan(RENAME_SCAN_TIMEOUT_MS + 400);` | unclassified — decide at implementation | named duration with no in-file reading (imported helper or constant?) |
| `src/__tests__/verdict.test.ts:641` | X8: an abort kills the scan child and yields an empty renam… | `expect(Date.now() - t0).toBeLessThan(RENAME_SCAN_TIMEOUT_MS);` | REWRITE | R5: outcome of a timeout/abort/hang path (abort) |

Checked, NOT-A-BUDGET, and not flagged by the guard:

- `src/__tests__/frontmatter-indexing.test.ts:50`: ordering check: bound side is itself a reading, no slack arithmetic
- `src/__tests__/index-batch-budget.test.ts:150`: hand: span comes from the harness's injected cost clock (:143-147), not a real clock; the guard does not flag it
- `src/__tests__/kb.test.ts:261`: ordering check: bound side is itself a reading, no slack arithmetic
- `src/__tests__/kb.test.ts:299`: count, size or status (D4); measured side reads no clock
- `src/__tests__/net-guard.test.ts:108`: count, size or status (D4); measured side reads no clock
- `src/__tests__/retrieval-quality.test.ts:154`: count, size or status (D4); measured side reads no clock
- `src/__tests__/retrieval-quality.test.ts:266`: count, size or status (D4); measured side reads no clock
- `src/__tests__/sources-archive.test.ts:114`: count, size or status (D4); measured side reads no clock

## scripts


| file:line | case | assertion | disposition | rule / reason |
|---|---|---|---|---|
| `scripts/__tests__/claude-plugin-watch-events.test.mjs:73` | prints ready, then the first event, and exits 0 with --once… | `expect(Date.now() - started).toBeLessThan(5000);` | REWRITE | R5: outcome of a timeout/abort/hang path (exits) |
| `scripts/__tests__/client-isolate-gate.test.mjs:67` | P2: three consecutive runs are green and the median wall ti… | `` expect(median, `median wall ${median} ms vs isolated baseline ${ISOLATED_BASELINE_MS} ms`).toB… `` | MOVE | R4: named as performance (P2) |
| `scripts/__tests__/codeql-local-cli.test.mjs:310` | #P1 a 400-entry diff is static and fast | `expect(performance.now() - t).toBeLessThan(2000);` | MOVE | R4: named as performance (#P1) |
| `scripts/__tests__/codeql-local-mirror.test.mjs:208` | #M14 a stalled gh is killed by the timeout | `expect(Date.now() - started).toBeLessThan(4000);` | REWRITE | R5: outcome of a timeout/abort/hang path (stall) |
| `scripts/__tests__/codeql-local-real.test.mjs:312` | #X6 (b) uncached packs skip loudly within 150 s | `expect(Date.now() - started).toBeLessThan(150_000);` | unclassified — decide at implementation | R8: REWRITE if recipe (c) or (d) applies, else MOVE |
| `scripts/__tests__/codeql-local.test.mjs:171` | #P1 400 entries, 50 changed: pure comparison is fast | `expect(performance.now() - t).toBeLessThan(2000);` | MOVE | R4: named as performance (#P1) |
| `scripts/__tests__/coverage-report.test.mjs:69` |  | `` expect(elapsedMs, `scoped coverage run took ${elapsedMs} ms`).toBeLessThan(SCOPED_RUN_TIMEOUT_… `` | MOVE | R4: named as performance (P3) |
| `scripts/__tests__/dependency-declarations.test.mjs:434` | completes across all non-private workspaces within 30 + 3 *… | `expect(withinBudget(elapsed, n), budgetMessage(elapsed, n)).toBe(true);` | MOVE (hand) | hand: rule 4 (describe 'runtime budget (P1, P2)', :424); predicate form, not seen by the scan or the guard (D5 limits) |
| `scripts/__tests__/fixed-tick-waits.test.mjs:185` | analyze wall-clock stays negligible (P3, < 2 s) | `expect(performance.now() - start).toBeLessThan(2_000);` | MOVE | R4: named as performance (P3) |
| `scripts/__tests__/harness-audit-armed.test.mjs:61` | unarmed survives empty polls; a create event arms; armed + … | `expect(exitedAt - t0).toBeLessThan(2500); // <= one 1 s interval (+ slack)` | REWRITE | R5: outcome of a timeout/abort/hang path (exits) |
| `scripts/__tests__/harness-audit-armed.test.mjs:82` | never armed: exits at the maximum lifetime (±1 s) | `expect(exitedAt - t0).toBeLessThan(5600);` | REWRITE | R5: outcome of a timeout/abort/hang path (exits) |
| `scripts/__tests__/knip-scan.test.mjs:97` | #P1 completes within the 30s budget | `expect(elapsedMs).toBeLessThan(30_000);` | MOVE | R4: named as performance (#P1) |
| `scripts/__tests__/select-affected-tests-graph.test.mjs:55` | P1: builds both configs and the literal index in under 90 s | `expect(wallMs).toBeLessThan(90_000);` | MOVE | R4: named as performance (P1) |
| `scripts/__tests__/spec-collateral.test.mjs:423` | P2 700 specs × 8 requirements with 60 identifiers completes… | `expect(Date.now() - t0).toBeLessThan(10_000);` | MOVE | R4: named as performance (P2) |
| `scripts/__tests__/test-down-recorder.test.mjs:82` | a destroy line already present: recorder stopped promptly | `expect(r.ms).toBeLessThan(2000);` | MOVE | R4: named as performance (P2) |
| `scripts/__tests__/test-down-recorder.test.mjs:92` | a late destroy line is waited for (not cut off by an early … | `expect(r.ms).toBeLessThan(4200);` | MOVE | R4: named as performance (P2) |
| `scripts/__tests__/test-down-recorder.test.mjs:109` | (P2) no destroy line ever: the wait is bounded at 10 s (+1 … | `expect(r.ms).toBeLessThan(11500);` | MOVE | R4: named as performance (P2) |
| `scripts/__tests__/test-down-recorder.test.mjs:127` | ${mode} recorder → one warning, marker still written, no wa… | `expect(r.ms).toBeLessThan(1500);` | REWRITE | R5: outcome of a timeout/abort/hang path (exit) |

## client

Paths are relative to `packages/client/`.

| file:line | case | assertion | disposition | rule / reason |
|---|---|---|---|---|
| `src/__tests__/ProviderAddDialog.test.tsx:447` | device_code keeps the code pane and renders the auth link t… | `expect(seconds).toBeLessThanOrEqual(900);` | unclassified — decide at implementation | named duration with no in-file reading (imported helper or constant?) |
| `src/__tests__/ProviderAddDialog.test.tsx:766` | AUTH-006: the device-code expiry is a COUNTDOWN, not a froz… | `expect(secs()).toBeLessThanOrEqual(s1 - 2);` | unclassified — decide at implementation | named duration with no in-file reading (imported helper or constant?) |
| `src/components/__tests__/RetrySettingsSection.test.tsx:300` | stays O(1) for a huge legal attempt count (test-plan #P1) | `expect(performance.now() - start).toBeLessThan(50);` | MOVE | R4: named as performance (#P1) |
| `src/lib/__tests__/chat-virtual-rows.test.ts:554` | P3: live read + union stays under 0.2 ms per call over a 20… | `expect((performance.now() - t0) / 1000).toBeLessThan(0.2);` | MOVE | R4: named as performance (P3) |
| `src/lib/__tests__/extract-urls.test.ts:76` | stays linear on a long run of trailing-strip characters (Co… | `expect(performance.now() - t0).toBeLessThan(500);` | MOVE | R6: complexity or speed guard (linear) |
| `src/lib/__tests__/linkify-tool-output.perf.test.ts:30` | tokenises a ~2 MB grep-style input in under 1000 ms | `expect(elapsed).toBeLessThan(1000);` | MOVE | R4: named as performance (perf) |
| `src/lib/__tests__/session-status-visuals.test.ts:198` | counts 1000 sessions within the 5 ms budget (test-plan #P1) | `expect(timings[2]).toBeLessThan(5);` | MOVE | R4: named as performance (budget) |
| `src/lib/__tests__/sidebar-dnd.test.ts:247` | stays under 2 ms p95 over ~420 droppables | `expect(samples[Math.floor(samples.length * 0.95)]).toBeLessThan(2);` | MOVE | R4: named as performance (p95) |
| `src/lib/chat/__tests__/follow-glide.test.ts:54` | settles ≤ 500 ms for Δ = clientHeight, alike at 60 Hz and 1… | `expect(at60).toBeLessThanOrEqual(500);` | MOVE | R7: bound is the case's only assertion |
| `src/lib/chat/__tests__/follow-glide.test.ts:55` | settles ≤ 500 ms for Δ = clientHeight, alike at 60 Hz and 1… | `expect(at120).toBeLessThanOrEqual(500);` | MOVE | R7: bound is the case's only assertion |
| `src/lib/chat/__tests__/follow-glide.test.ts:57` | settles ≤ 500 ms for Δ = clientHeight, alike at 60 Hz and 1… | `expect(Math.abs(at60 - at120)).toBeLessThanOrEqual(17);` | MOVE | R7: bound is the case's only assertion |
| `src/lib/chat/__tests__/history-gap-trigger.test.ts:211` | P1: adds well under 1ms per event, and stays close to a no-… | `` expect(perEvent, `${perEvent.toFixed(4)}ms per event`).toBeLessThan(1); `` | MOVE | R4: named as performance (P1) |
| `src/lib/chat/__tests__/history-gap-trigger.test.ts:231` | P1: adds well under 1ms per event, and stays close to a no-… | `expect(measured).toBeLessThan(baseline * 50 + 1);` | MOVE | R3: relative bound |
| `src/lib/chat/__tests__/history-gap-trigger.test.ts:244` | P1: the predicate is cheap enough to be called per event ev… | `` expect(elapsed / EVENTS, `${(elapsed / EVENTS).toFixed(6)}ms per call`).toBeLessThan(0.1); `` | MOVE | R4: named as performance (P1) |
| `src/lib/preview/__tests__/mermaid-repair.test.ts:200` | near-limit 50 000-char flowchart repairs in < 100 ms (P1) | `expect(medianMs(() => repairMermaid(src))).toBeLessThan(100);` | MOVE | R4: named as performance (P1) |
| `src/lib/preview/__tests__/mermaid-repair.test.ts:206` | pathological 50 000-char line repairs in < 100 ms (P2) | `expect(medianMs(() => repairMermaid(src))).toBeLessThan(100);` | MOVE | R4: named as performance (P2) |

Checked, NOT-A-BUDGET, and not flagged by the guard:

- `src/lib/__tests__/group-tool-bursts.test.ts:427`: count, size or status (D4); measured side reads no clock
- `src/lib/__tests__/group-tool-bursts.test.ts:444`: ordering check: bound side is itself a reading, no slack arithmetic

## kb-extension

Paths are relative to `packages/kb-extension/`.

| file:line | case | assertion | disposition | rule / reason |
|---|---|---|---|---|
| `src/__tests__/doctrine-hook.test.ts:174` | p95 wall time over 100 warm turns is < 20 ms | `expect(p95).toBeLessThan(20);` | MOVE | R4: named as performance (p95) |
| `src/__tests__/freshness-perf.test.ts:45` | P2: ~5k dirs (~1k gitignored), cold index, budget 1500 → kb… | `expect(elapsed).toBeLessThanOrEqual(1500 + 250);` | MOVE | R4: named as performance (P2) |
| `src/__tests__/freshness-perf.test.ts:78` | X10: slow fs (~5 ms per directory over ~200 dirs), budget 5… | `expect(elapsed).toBeLessThanOrEqual(50 + 250);` | MOVE | R4: named as performance (budget) |
| `src/__tests__/kb-search-tool.test.ts:379` | F9: abort mid-wait → each tool resolves with the cancelled … | `expect(Date.now() - t0).toBeLessThan(1000);` | REWRITE | R5: outcome of a timeout/abort/hang path (abort) |
| `src/__tests__/query-worker-host.test.ts:75` | W1: abort during a non-interruptible op resolves cancelled … | `expect(maxDelayMs).toBeLessThan(100);` | unclassified — decide at implementation | named duration with no in-file reading (imported helper or constant?) |
| `src/__tests__/query-worker-host.test.ts:79` | W1: abort during a non-interruptible op resolves cancelled … | `expect(Date.now() - t1).toBeLessThan(1000);` | REWRITE | R5: outcome of a timeout/abort/hang path (abort) |
| `src/__tests__/query-worker-host.test.ts:92` | W2: abort during a JS-bound op → cancelled ≤ 500 ms and the… | `expect(Date.now() - t0).toBeLessThanOrEqual(500);` | REWRITE | R5: outcome of a timeout/abort/hang path (abort) |
| `src/__tests__/query-worker-host.test.ts:94` | W2: abort during a JS-bound op → cancelled ≤ 500 ms and the… | `expect(Date.now() - t0).toBeLessThanOrEqual(500);` | REWRITE | R5: outcome of a timeout/abort/hang path (abort) |
| `src/__tests__/query-worker-host.test.ts:121` | W4: aborting a queued request leaves the in-flight one on i… | `expect(Date.now() - t0).toBeLessThan(50);` | REWRITE | R5: outcome of a timeout/abort/hang path (abort) |
| `src/__tests__/query-worker-host.test.ts:146` | W5: at most two abandoned workers; a 4th call waits for one… | `expect(Date.now() - t0).toBeLessThan(50);` | REWRITE | R5: outcome of a timeout/abort/hang path (abort) |
| `src/__tests__/query-worker-host.test.ts:152` | W5: at most two abandoned workers; a 4th call waits for one… | `expect(Date.now() - t1).toBeLessThan(2000);` | REWRITE | R5: outcome of a timeout/abort/hang path (abort) |
| `src/__tests__/query-worker-host.test.ts:174` | W5b: a cap-blocked request keeps its enqueue deadline after… | `expect(Date.now() - t0).toBeLessThan(1900); // not restarted at the (later) dispatch` | REWRITE | R5: outcome of a timeout/abort/hang path (deadline) |
| `src/__tests__/query-worker-host.test.ts:262` | W13: abort during start → cancelled at once, not a start fa… | `expect(Date.now() - t0).toBeLessThanOrEqual(200);` | REWRITE | R5: outcome of a timeout/abort/hang path (abort) |
| `src/__tests__/query-worker-loader.test.ts:60` | W20/W22/W25: one off-thread search; the process exits on it… | `expect(r.ms).toBeLessThanOrEqual(2000);` | REWRITE | R5: outcome of a timeout/abort/hang path (exits) |
| `src/__tests__/query-worker-tools.test.ts:137` | W26: abort mid-retrieval → the exact cancelled result on kb… | `expect(Date.now() - t0).toBeLessThanOrEqual(500);` | REWRITE | R5: outcome of a timeout/abort/hang path (abort) |
| `src/__tests__/query-worker-tools.test.ts:148` | W27: kb_get never blocks the session thread while the worke… | `expect(maxDelayMs).toBeLessThan(100);` | unclassified — decide at implementation | named duration with no in-file reading (imported helper or constant?) |

## deck3d

Paths are relative to `packages/deck3d/`.

| file:line | case | assertion | disposition | rule / reason |
|---|---|---|---|---|
| `src/art/__tests__/art.test.ts:185` | refuses a VALID compressed large PNG without allocating it,… | `expect(process.memoryUsage().arrayBuffers - before, "nothing like the 256 MB raster was alloca…` | MOVE | R2: memory amount |
| `src/art/__tests__/art.test.ts:196` | rejects a curve whose flattening would exceed the point cap… | `expect(Date.now() - t0, "must fail fast, not allocate millions of points first").toBeLessThan(…` | REWRITE | R5: outcome of a timeout/abort/hang path (reject) |
| `src/art/__tests__/art.test.ts:210` | rejects a circle or ellipse of enormous radius before build… | `` expect(Date.now() - t0, `${shape}: must refuse before allocating`).toBeLessThan(300); `` | REWRITE | R5: outcome of a timeout/abort/hang path (reject) |
| `src/parse/harvest/__tests__/x4-hang-timeout.test.ts:94` | times out promptly, names the slide and closes chromium | `` expect(elapsedMs, `parse took ${elapsedMs} ms with a ${TIMEOUT_MS} ms harvest timeout`).toBeLe… `` | REWRITE | R5: outcome of a timeout/abort/hang path (times out) |
| `src/pptx/__tests__/import.test.ts:409` | rejects a valid, highly compressed huge --ref PNG through t… | `expect(process.memoryUsage().arrayBuffers - before, "the 256 MB raster was never allocated").t…` | MOVE | R2: memory amount |
| `src/props/__tests__/x6-offline-timeout.test.ts:55` | searchProps aborts inside the timeout and keeps the vendore… | `expect(Date.now() - start).toBeLessThan(1000);` | REWRITE | R5: outcome of a timeout/abort/hang path (abort) |
| `src/props/__tests__/x6-offline-timeout.test.ts:65` | props search exits 0 within 1 s, prints vendored rows and o… | `expect(elapsed).toBeLessThan(3000);` | REWRITE | R5: outcome of a timeout/abort/hang path (exits) |
| `src/render/__tests__/p1-build-budget.test.ts:52` | completes within 20 s after chromium launch | `` expect(postLaunchMs, `wall ${wallMs}ms − 2×launch ${launchMs.toFixed(0)}ms = ${(postLaunchMs /… `` | MOVE | R4: named as performance (p1) |
| `src/render/__tests__/p1-build-budget.test.ts:89` | builds clean within 60 s after chromium launch | `` expect(wallMs - 2 * launchMs, `${(wallMs / slides).toFixed(0)}ms/slide`).toBeLessThanOrEqual(s… `` | MOVE | R4: named as performance (p1) |
| `src/render/__tests__/p3-render-determinism.test.ts:28` | three renders are byte-identical and each under 5 s | `` for (const [i, ms] of durations.entries()) expect(ms, `render ${i}`).toBeLessThan(5000); `` | unclassified — decide at implementation | named duration with no in-file reading (imported helper or constant?) |

Checked, NOT-A-BUDGET, and not flagged by the guard:

- `src/art/__tests__/art.test.ts:41`: measured side holds no in-file clock or memory reading
- `src/art/__tests__/art.test.ts:72`: measured side holds no in-file clock or memory reading
- `src/art/__tests__/art.test.ts:182`: count, size or status (D4); measured side reads no clock
- `src/art/__tests__/art.test.ts:232`: measured side holds no in-file clock or memory reading
- `src/pptx/__tests__/import.test.ts:452`: measured side holds no in-file clock or memory reading
- `src/pptx/__tests__/import.test.ts:453`: measured side holds no in-file clock or memory reading
- `src/pptx/__tests__/import.test.ts:454`: measured side holds no in-file clock or memory reading
- `src/pptx/__tests__/import.test.ts:455`: measured side holds no in-file clock or memory reading
- `src/pptx/__tests__/import.test.ts:527`: count, size or status (D4); measured side reads no clock
- `src/pptx/__tests__/import.test.ts:528`: count, size or status (D4); measured side reads no clock
- `src/pptx/__tests__/import.test.ts:768`: measured side holds no in-file clock or memory reading

## kb-plugin

Paths are relative to `packages/kb-plugin/`.

| file:line | case | assertion | disposition | rule / reason |
|---|---|---|---|---|
| `src/server/__tests__/kb-routes.test.ts:415` | P1: a pathological git is bounded and rejected, never admit… | `expect(elapsed).toBeLessThan(2_500);` | MOVE | R4: named as performance (P1) |
| `src/server/__tests__/kb-routes.test.ts:915` | X7 a search while a write transaction is OPEN answers 200 f… | `expect(Date.now() - t0).toBeLessThan(2000);` | unclassified — decide at implementation | R8: REWRITE if recipe (c) or (d) applies, else MOVE |
| `src/server/__tests__/kb-routes.test.ts:1185` | P3 a slow git clone does not stall the host event loop | `expect(took).toBeLessThan(200);` | MOVE | R4: named as performance (P3) |
| `src/server/__tests__/kb-search-perf.test.ts:49` | p95 over 50 varied 2-4 term queries < 100 ms | `expect(p95).toBeLessThan(100);` | MOVE | R4: named as performance (p95) |
| `src/server/__tests__/kb-search-perf.test.ts:153` | search + stats never throw/SQLITE_BUSY, stay < 50 ms and se… | `expect(Math.max(...r.times)).toBeLessThan(Math.max(process.env.CI ? 1000 : 50, 4 * p95Of(r.idl…` | MOVE | R3: relative bound |
| `src/server/__tests__/kb-search-perf.test.ts:179` | 0 failed calls and search p95 < 50 ms | `expect(p95Of(r.searchTimes)).toBeLessThan(Math.max(50, 2 * p95Of(r.idleSearchTimes)));` | OPT-IN (KB_MEASURE) | inside describe.skipIf(!process.env.KB_MEASURE): runs in no lane (D5 rule 3) |
| `src/server/__tests__/reindex-runner.test.ts:237` | Fastify onClose triggers the same immediate terminate | `expect(Date.now() - t0).toBeLessThan(2000);` | REWRITE | R5: outcome of a timeout/abort/hang path (terminate) |
| `src/server/__tests__/reindex-runner.test.ts:286` | 200 batch commits within 100 ms post at most ⌈elapsed/250⌉+… | `expect(posted.length).toBeLessThanOrEqual(Math.ceil(100 / 250) + 1);` | NOT-A-BUDGET | count, size or status (D4); measured side reads no clock; the guard flags it: add `// budget-exempt: <reason>` |
| `src/server/__tests__/reindex-runner.test.ts:297` | 200 batch commits within 100 ms post at most ⌈elapsed/250⌉+… | `expect(posted.length).toBeLessThanOrEqual(Math.ceil(elapsed / 250) + 1);` | NOT-A-BUDGET | count, size or status (D4); measured side reads no clock; the guard flags it: add `// budget-exempt: <reason>` |
| `src/server/__tests__/seed-first-index.test.ts:115` | the wait ends at once — well inside one pollMs — and the jo… | `expect(Date.now() - t0).toBeLessThan(POLL / 5);` | REWRITE | R5: outcome of a timeout/abort/hang path (settles) |

Checked, NOT-A-BUDGET, and not flagged by the guard:

- `src/server/__tests__/kb-routes.test.ts:783`: measured side is not derived from a reading in the case's scope (counter, bytes or constant)
- `src/server/__tests__/kb-routes.test.ts:784`: measured side is not derived from a reading in the case's scope (counter, bytes or constant)
- `src/server/__tests__/kb-routes.test.ts:786`: measured side is not derived from a reading in the case's scope (counter, bytes or constant)
- `src/server/__tests__/kb-routes.test.ts:791`: measured side is not derived from a reading in the case's scope (counter, bytes or constant)
- `src/server/__tests__/kb-routes.test.ts:1126`: count, size or status (D4); measured side reads no clock
- `src/server/__tests__/kb-routes.test.ts:1770`: ordering check: bound side is itself a reading, no slack arithmetic
- `src/server/__tests__/kb-routes.test.ts:1813`: ordering check: bound side is itself a reading, no slack arithmetic
- `src/server/__tests__/kb-routes.test.ts:1850`: ordering check: bound side is itself a reading, no slack arithmetic
- `src/server/__tests__/reindex-worker.test.ts:141`: count, size or status (D4); measured side reads no clock
- `src/server/__tests__/reindex-worker.test.ts:239`: count, size or status (D4); measured side reads no clock

## mcp-server-plugin

Paths are relative to `packages/mcp-server-plugin/`.

| file:line | case | assertion | disposition | rule / reason |
|---|---|---|---|---|
| `src/server/__tests__/inject-overhead.test.ts:70` | p95(rest) − p95(context) < 20 ms across 100 calls (10 warm-… | `expect(p95(rest) - p95(ctx)).toBeLessThan(20);` | MOVE | R4: named as performance (p95) |
| `src/server/__tests__/performance.test.ts:55` | verifies a valid token well inside the budget | `expect(p95(samples)).toBeLessThanOrEqual(10);` | MOVE | R4: named as performance (budget) |
| `src/server/__tests__/performance.test.ts:69` | a MISS is also within budget (the constant-time scan is not… | `expect(p95(samples)).toBeLessThanOrEqual(10);` | MOVE | R4: named as performance (budget) |
| `src/server/__tests__/performance.test.ts:87` | builds the advertised list well inside the budget | `expect(p95(samples)).toBeLessThanOrEqual(50);` | MOVE | R4: named as performance (budget) |
| `src/server/__tests__/performance.test.ts:127` | delivers to every stream with no drops | `expect(p95(samples)).toBeLessThanOrEqual(250);` | MOVE | R4: named as performance (perf) |
| `src/server/__tests__/performance.test.ts:188` | RSS growth over the soak stays within 25 MB | `expect(growthMb).toBeLessThanOrEqual(25);` | MOVE | R4: named as performance (perf) |
| `src/server/__tests__/performance.test.ts:229` | resolve() at 1000 rows stays negligible next to the endpoin… | `expect(meanPerCallMs).toBeLessThan(5);` | MOVE | R4: named as performance (perf) |
| `src/server/__tests__/performance.test.ts:283` | returns a default page from 5,400 rows in under 50 ms | `expect(elapsed).toBeLessThan(50);` | MOVE | R4: named as performance (perf) |

Checked, NOT-A-BUDGET, and not flagged by the guard:

- `src/server/__tests__/performance.test.ts:270`: measured side holds no in-file clock or memory reading

## untrusted-content-guard

Paths are relative to `packages/untrusted-content-guard/`.

| file:line | case | assertion | disposition | rule / reason |
|---|---|---|---|---|
| `src/__tests__/scan-perf.test.ts:48` | stays within 25 ms/100 KB and grows linearly | `expect(tHalf / 5).toBeLessThanOrEqual(25);` | MOVE | R4: named as performance (perf) |
| `src/__tests__/scan-perf.test.ts:49` | stays within 25 ms/100 KB and grows linearly | `expect(tFull / 10).toBeLessThanOrEqual(25);` | MOVE | R4: named as performance (perf) |
| `src/__tests__/scan-perf.test.ts:50` | stays within 25 ms/100 KB and grows linearly | `expect(tFull / tHalf).toBeLessThanOrEqual(2.5);` | MOVE | R4: named as performance (perf) |
| `src/__tests__/scanner.test.ts:209` | stays within the latency bound on a rule-count × element-co… | `` expect(msPer100KB(`<html><style>${rules}</style>${elements}</html>`)).toBeLessThanOrEqual(25); `` | MOVE | R4: named as performance (latency) |
| `src/__tests__/scanner.test.ts:213` | stays within the latency bound on unclosed <style / brace-f… | `` expect(msPer100KB(`<html>${"<style ".repeat(40_000)}`)).toBeLessThanOrEqual(25); `` | MOVE | R4: named as performance (latency) |
| `src/__tests__/scanner.test.ts:214` | stays within the latency bound on unclosed <style / brace-f… | `` expect(msPer100KB(`<html><style>${"a".repeat(300_000)}</style></html>`)).toBeLessThanOrEqual(2… `` | MOVE | R4: named as performance (latency) |

## blender

Paths are relative to `packages/blender/`.

| file:line | case | assertion | disposition | rule / reason |
|---|---|---|---|---|
| `src/__tests__/real-binary.test.ts:415` | P1: the first blender_scene (boot included) from a fresh se… | `` expect(ms, `first call took ${ms} ms`).toBeLessThanOrEqual(15_000); `` | MOVE | R4: named as performance (P1) |
| `src/__tests__/real-binary.test.ts:428` | P2: the median of 5 blender_scene calls on a live factory s… | `` expect(median, `call times ms: ${times.join(", ")}`).toBeLessThanOrEqual(2_000); `` | MOVE | R4: named as performance (P2) |
| `src/__tests__/real-binary.test.ts:440` | P3: after boot and a .glb export the Blender host process h… | `` expect(rss, `host RSS ${(rss / 2 ** 20).toFixed(0)} MiB`).toBeLessThanOrEqual(2.5 * 1024 ** 3); `` | MOVE | R2: memory amount |
| `src/__tests__/real-lifecycle.test.ts:294` | X11: an endless loop with timeoutSec 5 returns timeout with… | `expect(elapsed).toBeLessThanOrEqual(10_000);` | REWRITE | R5: outcome of a timeout/abort/hang path (timeout) |

## flows-plugin

Paths are relative to `packages/flows-plugin/`.

| file:line | case | assertion | disposition | rule / reason |
|---|---|---|---|---|
| `src/bridge/__tests__/flow-tool-registry.test.ts:174` | E9: already-aborted signal resolves 130 without spawning | `expect(Date.now() - t0).toBeLessThan(200);` | REWRITE | R5: outcome of a timeout/abort/hang path (abort) |
| `src/bridge/__tests__/flow-tool-registry.test.ts:206` | E13: output over the cap is cut off and the child killed wi… | `expect(Date.now() - t0).toBeLessThan(2_500);` | REWRITE | R5: outcome of a timeout/abort/hang path (kill) |
| `src/bridge/__tests__/flow-tool-registry.test.ts:316` | X1: timeout kills the child and its grandchild within 2 s | `expect(Date.now() - t0).toBeLessThan(2_500);` | REWRITE | R5: outcome of a timeout/abort/hang path (timeout) |
| `src/bridge/__tests__/flow-tool-registry.test.ts:330` | X2: abort kills the child and its grandchild within 2 s | `expect(Date.now() - t0).toBeLessThan(2_000);` | REWRITE | R5: outcome of a timeout/abort/hang path (abort) |

Checked, NOT-A-BUDGET, and not flagged by the guard:

- `src/bridge/__tests__/flow-tool-registry.test.ts:204`: count, size or status (D4); measured side reads no clock
- `src/bridge/__tests__/flow-tool-registry.test.ts:214`: count, size or status (D4); measured side reads no clock
- `src/bridge/__tests__/flow-tool-registry.test.ts:223`: count, size or status (D4); measured side reads no clock

## skill-atlas-plugin

Paths are relative to `packages/skill-atlas-plugin/`.

| file:line | case | assertion | disposition | rule / reason |
|---|---|---|---|---|
| `src/client/__tests__/atlas-ui.test.tsx:241` | a pathological run of slashes is handled in linear time and… | `expect(performance.now() - t0).toBeLessThan(50);` | MOVE | R6: complexity or speed guard (pathological) |
| `src/client/__tests__/graph-layout.test.ts:296` | presettle at 300 skills / 300 links stays in budget (#P1) | `expect(times[1]).toBeLessThan(process.env.CI ? 700 : 350);` | MOVE | R4: named as performance (budget) |
| `src/server/__tests__/atlas-perf.test.ts:56` | P1: unchanged request at 100 skills, p95 < 100 ms | `expect(pct(times, 95)).toBeLessThan(100);` | MOVE | R4: named as performance (P1) |
| `src/server/__tests__/atlas-perf.test.ts:69` | P2: rebuild at 300 skills × 256 KiB, median < 500 ms | `expect(pct(times, 50)).toBeLessThan(500);` | MOVE | R4: named as performance (P2) |

Checked, NOT-A-BUDGET, and not flagged by the guard:

- `src/client/__tests__/graph-layout.test.ts:342`: ordering check: bound side is itself a reading, no slack arithmetic

## mockup-loop

Paths are relative to `packages/mockup-loop/`.

| file:line | case | assertion | disposition | rule / reason |
|---|---|---|---|---|
| `src/__tests__/mock-site-serve.test.ts:135` | starts on THIS repo within the budget: p95 of 5 cold starts… | `expect(times[Math.ceil(0.95 * times.length) - 1]).toBeLessThan(10_000);` | MOVE | R4: named as performance (budget) |
| `src/__tests__/mock-site-serve.test.ts:145` | starts within 30s, LAN text only with lan, stops and frees … | `expect(Date.now() - t0).toBeLessThan(30_000);` | MOVE | R4: named as performance (P2) |
| `src/__tests__/mock-site-serve.test.ts:181` | child crash during start fails fast (X2) | `expect(Date.now() - t0).toBeLessThan(30_000);` | MOVE | R6: complexity or speed guard (fast) |

## obs-studio-plugin

Paths are relative to `packages/obs-studio-plugin/`.

| file:line | case | assertion | disposition | rule / reason |
|---|---|---|---|---|
| `src/server/__tests__/real-serve.test.ts:132` | a request flows end-to-end; stdin EOF → serve (and exec) ex… | `expect(Date.now() - t0).toBeLessThan(1000);` | REWRITE | R5: outcome of a timeout/abort/hang path (exit) |
| `src/server/__tests__/real-serve.test.ts:160` | dispose with a child ignoring EOF: stdin closed first, exec… | `expect(endedAt - t0).toBeLessThan(100);` | REWRITE | R5: outcome of a timeout/abort/hang path (kill) |
| `src/server/__tests__/real-serve.test.ts:198` | X2: a pid still alive at the deadline fails instead of hang… | `expect(Date.now() - t0).toBeLessThan(2000);` | REWRITE | R5: outcome of a timeout/abort/hang path (deadline) |

## .pi


| file:line | case | assertion | disposition | rule / reason |
|---|---|---|---|---|
| `.pi/skills/ship-it/scripts/__tests__/openspec-deps-gate.test.ts:105` | a hanging server → offline after the per-request timeout | `expect(Date.now() - t0).toBeLessThan(5_000);` | REWRITE | R5: outcome of a timeout/abort/hang path (hang) |
| `.pi/skills/ship-it/scripts/__tests__/openspec-deps-gate.test.ts:153` | a symlinked dependencies.yaml is invalid and never read thr… | `expect(Date.now() - t0).toBeLessThan(2_000);` | unclassified — decide at implementation | R8: REWRITE if recipe (c) or (d) applies, else MOVE |

## apple-tools

Paths are relative to `packages/apple-tools/`.

| file:line | case | assertion | disposition | rule / reason |
|---|---|---|---|---|
| `src/__tests__/install.test.ts:449` | #P1: 100 macOS checks p95 < 200ms | `expect(times[94]).toBeLessThan(200);` | MOVE | R4: named as performance (#P1) |
| `src/__tests__/install.test.ts:476` | #P2: 100 non-macOS checks p95 < 5ms AND 0 subprocesses | `expect(times[94]).toBeLessThan(5);` | MOVE | R4: named as performance (#P2) |

## bus-client

Paths are relative to `packages/bus-client/`.

| file:line | case | assertion | disposition | rule / reason |
|---|---|---|---|---|
| `src/__tests__/offbox-ticket-denied.test.ts:29` | surfaces an explicit OffBoxError instead of hanging | `expect(Date.now() - t0).toBeLessThan(3_000);` | REWRITE | R5: outcome of a timeout/abort/hang path (hang) |
| `src/__tests__/until-timeout.test.ts:33` | rejects with a timeout error naming the awaited (sid, statu… | `expect(elapsed).toBeLessThan(1_000);` | REWRITE | R5: outcome of a timeout/abort/hang path (reject) |

## dashboard-plugin-runtime

Paths are relative to `packages/dashboard-plugin-runtime/`.

| file:line | case | assertion | disposition | rule / reason |
|---|---|---|---|---|
| `src/__tests__/app-mount.test.ts:603` | P4: p95 ≤ 10 ms over 200 warm requests across 10 plugins × … | `expect(times[Math.floor(times.length * 0.95)]).toBeLessThanOrEqual(10);` | MOVE | R4: named as performance (P4) |
| `src/__tests__/file-validator.test.ts:127` | #X4 a hanging validator times out (hard terminate) without … | `expect(maxGap).toBeLessThan(200);` | REWRITE | R5: outcome of a timeout/abort/hang path (hang) |

## electron

Paths are relative to `packages/electron/`.

| file:line | case | assertion | disposition | rule / reason |
|---|---|---|---|---|
| `src/__tests__/loading-page-handoff.test.ts:30` | health OK at t=%i ms → navigateToServer invoked ≤ 1500 ms l… | `expect(navigatedAt! - start - t).toBeLessThanOrEqual(MAX_POLL_INTERVAL_MS);` | MOVE | R4: named as performance (P2) |
| `src/lib/browser-host/__tests__/tee.test.ts:79` | 200 × 20 KB frames: p95 receipt → onFrame ≤ 50 ms (one run) | `expect(delays[Math.floor(0.95 * delays.length) - 1]!).toBeLessThanOrEqual(50);` | MOVE | R4: named as performance (p95) |

Checked, NOT-A-BUDGET, and not flagged by the guard:

- `src/lib/__tests__/server-lifecycle-shutdown.test.ts:113`: Date is faked in this case (fake-clock arithmetic, D4)
- `src/lib/__tests__/server-lifecycle-shutdown.test.ts:122`: Date is faked in this case (fake-clock arithmetic, D4)
- `src/lib/__tests__/server-lifecycle-shutdown.test.ts:125`: Date is faked in this case (fake-clock arithmetic, D4)

## mcp-client-plugin

Paths are relative to `packages/mcp-client-plugin/`.

| file:line | case | assertion | disposition | rule / reason |
|---|---|---|---|---|
| `src/server/__tests__/admission-burst.test.ts:161` | P2: p99 event-loop delay is lower with async admission than… | `expect(p99(r.healthMs)).toBeLessThan(250);` | MOVE | R4: named as performance (P2) |
| `src/server/__tests__/pi-runner.test.ts:47` | an abort kills a hanging child promptly | `expect(Date.now() - started).toBeLessThan(5000);` | REWRITE | R5: outcome of a timeout/abort/hang path (abort) |

Checked, NOT-A-BUDGET, and not flagged by the guard:

- `src/server/__tests__/admission-burst.test.ts:147`: ordering check: bound side is itself a reading, no slack arithmetic

## memory-eval

Paths are relative to `packages/memory-eval/`.

| file:line | case | assertion | disposition | rule / reason |
|---|---|---|---|---|
| `src/__tests__/retrievers-perf.test.ts:34` | P1: BM25 variant stays under 500 ms on 45k messages, includ… | `expect(q1.ms).toBeLessThan(500);` | MOVE | R4: named as performance (P1) |
| `src/__tests__/retrievers-perf.test.ts:41` | P1: BM25 variant stays under 500 ms on 45k messages, includ… | `expect(q2.ms).toBeLessThan(500);` | MOVE | R4: named as performance (P1) |

## roles-plugin

Paths are relative to `packages/roles-plugin/`.

| file:line | case | assertion | disposition | rule / reason |
|---|---|---|---|---|
| `src/server/__tests__/role-bindings.test.ts:288` | P2 1000 bindings across 3 projectors converge | `expect(Date.now() - t0).toBeLessThan(5000);` | MOVE | R4: named as performance (P2) |
| `src/server/__tests__/role-bindings.test.ts:372` | P1 latency: tmp+rename write reaches onChange well under 5s | `expect(t1 - t0).toBeLessThan(5000);` | MOVE | R4: named as performance (P1) |

## system-one

Paths are relative to `packages/system-one/`.

| file:line | case | assertion | disposition | rule / reason |
|---|---|---|---|---|
| `src/__tests__/overhead.test.ts:37` | p95 overhead ≤ 5 ms over 1,000 calls with 5 questions and 2… | `expect(p95).toBeLessThanOrEqual(5);` | MOVE | R4: named as performance (p95) |
| `src/__tests__/predict.test.ts:279` | falls through after the 2,000 ms default | `expect(dt).toBeLessThan(2300);` | REWRITE | R5: outcome of a timeout/abort/hang path (timeout) |

## system-one-plugin

Paths are relative to `packages/system-one-plugin/`.

| file:line | case | assertion | disposition | rule / reason |
|---|---|---|---|---|
| `src/server/__tests__/routes.test.ts:276` | ${n} cases → ${sent} requests | `expect(rep.thresholds.q).toBeLessThanOrEqual(0.8);` | unclassified — decide at implementation | R8: REWRITE if recipe (c) or (d) applies, else MOVE |
| `src/server/__tests__/supervisor.test.ts:299` | becomes failed; the next predict fails fast and the chain c… | `expect(r.attempts[0].latencyMs).toBeLessThan(50);` | unclassified — decide at implementation | named duration with no in-file reading (imported helper or constant?) |

## automation-plugin

Paths are relative to `packages/automation-plugin/`.

| file:line | case | assertion | disposition | rule / reason |
|---|---|---|---|---|
| `src/server/__tests__/plugin-action-handler.test.ts:336` | P4: admission + dispatch stays well under 50 ms p95 per req… | `expect(samples[Math.floor(samples.length * 0.95)]).toBeLessThan(50);` | MOVE | R4: named as performance (P4) |

## blackhole-plugin

Paths are relative to `packages/blackhole-plugin/`.

| file:line | case | assertion | disposition | rule / reason |
|---|---|---|---|---|
| `src/shared/__tests__/chain-model.test.ts:255` | 1.8 micro-benchmark: 2000-row synthetic registry completes … | `expect(elapsed).toBeLessThan(50);` | MOVE | R4: named as performance (bench) |

## chat-gateway

Paths are relative to `packages/chat-gateway/`.

| file:line | case | assertion | disposition | rule / reason |
|---|---|---|---|---|
| `src/server/team/__tests__/authorize.test.ts:290` | P4: 10k sequential authorizations over 50 principals × 20 r… | `expect(p95).toBeLessThan(1);` | MOVE | R4: named as performance (P4) |

## craft-web-plugin

Paths are relative to `packages/craft-web-plugin/`.

| file:line | case | assertion | disposition | rule / reason |
|---|---|---|---|---|
| `src/server/__tests__/format-validators.test.ts:187` | a 16 MiB worst-case SVG validates in ≤ 2 s (max of 5 runs) | `expect(max).toBeLessThanOrEqual(2000);` | MOVE | R4: named as performance (P2) |

Checked, NOT-A-BUDGET, and not flagged by the guard:

- `src/server/__tests__/post-install.test.ts:84`: ordering check: bound side is itself a reading, no slack arithmetic
- `src/server/__tests__/post-install.test.ts:85`: ordering check: bound side is itself a reading, no slack arithmetic
- `src/server/__tests__/post-install.test.ts:182`: ordering check: bound side is itself a reading, no slack arithmetic
- `src/server/__tests__/post-install.test.ts:183`: ordering check: bound side is itself a reading, no slack arithmetic

## gmail-plugin

Paths are relative to `packages/gmail-plugin/`.

| file:line | case | assertion | disposition | rule / reason |
|---|---|---|---|---|
| `src/shared/__tests__/setup.test.ts:76` | rejects an oversized hostile address in linear time (no reg… | `expect(performance.now() - started).toBeLessThan(50);` | REWRITE | R5: outcome of a timeout/abort/hang path (reject) |

## nano-banana

Paths are relative to `packages/nano-banana/`.

| file:line | case | assertion | disposition | rule / reason |
|---|---|---|---|---|
| `src/__tests__/pi-backend.test.ts:483` | X6 timeout is reported and bounded | `expect(Date.now() - t0).toBeLessThan(1000);` | REWRITE | R5: outcome of a timeout/abort/hang path (timeout) |

## path-containment-guard

Paths are relative to `packages/path-containment-guard/`.

| file:line | case | assertion | disposition | rule / reason |
|---|---|---|---|---|
| `src/__tests__/decide.test.ts:217` | P1 in-root decisions: p95 < 1 ms after warm-up | `expect(samples[Math.floor(samples.length * 0.95)]).toBeLessThan(1);` | MOVE | R4: named as performance (P1) |

## eng-disciplines

Paths are relative to `packages/eng-disciplines/`.

Checked, NOT-A-BUDGET, and not flagged by the guard:

- `src/__tests__/guard.test.ts:261`: count, size or status (D4); measured side reads no clock

## image-fit-extension

Paths are relative to `packages/image-fit-extension/`.

| file:line | case | assertion | disposition | rule / reason |
|---|---|---|---|---|
| `src/__tests__/extension.test.ts:334` | PI_IMAGE_FIT_MAX_EDGE=400 resizes a 1200×800 image | `expect(Math.max(decoded.width, decoded.height)).toBeLessThanOrEqual(400);` | NOT-A-BUDGET | count, size or status (D4); measured side reads no clock; the guard flags it: add `// budget-exempt: <reason>` |
| `src/__tests__/extension.test.ts:514` | E18: loading from a transcript file → returned block fitted… | `expect(await decodedMaxEdge(messages[0].content[0].data)).toBeLessThanOrEqual(1568);` | NOT-A-BUDGET | count, size or status (D4); measured side reads no clock; the guard flags it: add `// budget-exempt: <reason>` |
| `src/__tests__/resize.test.ts:128` | resizes landscape preserving aspect ratio (long edge ≤ maxE… | `expect(Math.max(result.dstDims.width, result.dstDims.height)).toBeLessThanOrEqual(1568);` | NOT-A-BUDGET | count, size or status (D4); measured side reads no clock; the guard flags it: add `// budget-exempt: <reason>` |
| `src/__tests__/resize.test.ts:130` | resizes landscape preserving aspect ratio (long edge ≤ maxE… | `expect(Math.abs(result.dstDims.height - expectedShort)).toBeLessThanOrEqual(1);` | NOT-A-BUDGET | count, size or status (D4); measured side reads no clock; the guard flags it: add `// budget-exempt: <reason>` |
| `src/__tests__/resize.test.ts:140` | resizes portrait preserving aspect ratio | `expect(Math.max(result.dstDims.width, result.dstDims.height)).toBeLessThanOrEqual(1568);` | NOT-A-BUDGET | count, size or status (D4); measured side reads no clock; the guard flags it: add `// budget-exempt: <reason>` |
| `src/__tests__/resize.test.ts:142` | resizes portrait preserving aspect ratio | `expect(Math.abs(result.dstDims.width - expectedShort)).toBeLessThanOrEqual(1);` | NOT-A-BUDGET | count, size or status (D4); measured side reads no clock; the guard flags it: add `// budget-exempt: <reason>` |

Checked, NOT-A-BUDGET, and not flagged by the guard:

- `src/__tests__/extension.test.ts:400`: count, size or status (D4); measured side reads no clock
- `src/__tests__/extension.test.ts:413`: measured side holds no in-file clock or memory reading
- `src/__tests__/extension.test.ts:417`: count, size or status (D4); measured side reads no clock
- `src/__tests__/extension.test.ts:429`: measured side is not derived from a reading in the case's scope (counter, bytes or constant)
- `src/__tests__/extension.test.ts:439`: count, size or status (D4); measured side reads no clock
- `src/__tests__/extension.test.ts:569`: count, size or status (D4); measured side reads no clock
- `src/__tests__/resize.test.ts:265`: count, size or status (D4); measured side reads no clock
- `src/__tests__/resize.test.ts:292`: count, size or status (D4); measured side reads no clock
- `src/__tests__/resize.test.ts:311`: count, size or status (D4); measured side reads no clock

