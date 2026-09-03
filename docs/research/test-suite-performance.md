# Test suite performance — why `npm test` takes 12 minutes

Research dossier. Explains the 12-minute `npm test`. Four bottlenecks measured: too much work, half-idle machine, jsdom overhead, hidden serial tail. Levers ranked but NOT decided. Self-contained — re-run commands in "How to reproduce" to re-verify.

- Date measured: 2026-08-24
- Machine: macOS, 16 logical cores, 64 GB RAM
- Command measured: `npm test` (root, vitest 4, `test.projects` in `vitest.config.ts`)
- Status: RESEARCH ONLY — no change proposed yet, nothing implemented

## Baseline (full run)

```
npm test  →  Duration 728.81s  (12.1 min)
             1456 files · 16206 tests
             transform 50.30s | setup 131.06s | import 582.75s | tests 1825.13s | environment 957.65s
```

Inner numbers are aggregates across workers, not wall time. Sum ≈ 3547 worker-seconds. Divided by the 8 workers actually used (`maxWorkers: "50%"`) → ~443s floor. Wall was 728.81s. So two distinct problems: too much work, AND poor packing.

Run also reported `1 failed | 1449 passed | 6 skipped` files and `5 failed | 16161 passed | 40 skipped` tests — pre-existing, not caused by measurement.

## Work distribution by package (sum of per-file durations, 1801s total)

```
PACKAGE                          files   sum_s   avg_s   tests
packages/server                    444     926    2.09    4918
scripts/__tests__                   35     473   13.51     486
packages/client                    467     226    0.48    5035
packages/image-fit-extension         4      57   14.24     120
packages/shared                    154      36    0.23    1688
packages/kb                         11      22    1.97     201
packages/automation-plugin          30      19    0.63     266
packages/extension                 138      17    0.13    1859
packages/bus-client                 14       7    0.48      17
packages/mcp-server-plugin          13       5    0.36     284
(remaining packages < 3s each)
```

Two packages dominate: `packages/server` 926s (51%) and `scripts/__tests__` 473s (26%). `scripts/__tests__` holds only 35 files, avg 13.51s each — meta-gates, not unit tests. Client has 5035 tests but only 226s of work (0.48s avg). Consequence: jsdom client suite looks big, costs little.

## Duration histogram

```
0–0.5s   1178 files    107s
0.5–1s    104 files     73s
1–2s       51 files     70s
2–5s       46 files    150s
5–10s      37 files    270s
10–20s     19 files    245s
>20s       15 files    886s   ← 1% of files = 49% of work
```

Long-tail dominance. 15 files >20s hold 49% of all work. 1178 files (81%) finish under 0.5s. Attack the tail, not the bulk.

## Bottleneck 1 — single file = 33% of wall clock

```
238.0s  scripts/__tests__/async-semantics-mutation.test.mjs   (10 assertions)
101.9s  packages/server/src/__tests__/faux-session.integration.test.ts
 91.3s  packages/server/src/__tests__/recovery-offer.test.ts
 71.4s  scripts/__tests__/biome-undeclared-dependencies.test.mjs
 56.6s  scripts/__tests__/async-semantics-guards.test.mjs
 48.4s  packages/server/src/__tests__/recovery-exit-intent.test.ts
 46.0s  scripts/__tests__/lint-ledger.test.mjs
 39.6s  packages/server/src/__tests__/cli-signal-forwarding.test.ts
 39.0s  packages/server/src/__tests__/prompt-derived-tool-state.integration.test.ts
 31.7s  packages/server/src/__tests__/recovery-e2e.test.ts
 31.1s  packages/image-fit-extension/src/__tests__/extension.test.ts
```

`async-semantics-mutation.test.mjs` shells out to a full vitest invocation per mutation. Irreducible 238s critical path — infinite cores cannot beat it. `npm test` can never go below ~4 min today.

Its own header says it is a per-change teeth-check for `cleanup-async-semantics-server-extension` (test-plan #X15) — a change already archived. Cost now billed to every dev on every run.

## Bottleneck 2 — half the machine idle by configuration

Every `packages/*/vitest.config.ts` pins `maxWorkers: "50%"` → 8 of 16 cores.

Controlled experiment on `packages/client` (project name `@blackbelt-technology/pi-dashboard-web`, 467 files):

| config | wall | green? |
|---|---|---|
| forks, 50% (today) | 178.0s | yes |
| forks, 100% | 143.5s | yes |
| threads, 100% | 124.2s | yes |
| forks, 50%, `--no-isolate` | 103.0s | NO — 55 files / 185 tests fail |

`pool: "threads"` + `maxWorkers: "100%"` = 1.44x on client, fully green, config-only.

`--no-isolate` is fastest but 55 files leak state into each other. Latent test-hygiene debt, not a free win. Ceiling on how fast client can ever get.

## Bottleneck 3 — jsdom environment dwarfs actual testing

`packages/client`, 467 files, baseline run:

```
tests        169.25s
environment  743.98s   ← 4.4x the real work
import       275.78s
setup        107.17s
```

~1.6s jsdom construction per file. Client tests themselves fast (0.48s avg).

`--no-isolate` did NOT reduce `environment` (771.24s) — vitest rebuilds DOM per file regardless. Levers: fewer jsdom files (`// @vitest-environment node` on pure-logic tests), cheaper DOM (`happy-dom`), or more cores absorbing it.

## Bottleneck 4 — hidden serial tail

From vitest 4 scheduler `groupSpecs` in `node_modules/vitest/dist/chunks/cli-api.*.js`:

```js
if (isolate === true && order === 0 && spec.project.config.maxWorkers === 1)
    return sequential.specs.push([spec]);   // appended LAST, maxWorkers: 1
```

Projects pinned `maxWorkers: 1` are pulled out of the main pool and run strictly one-at-a-time AFTER everything else: `packages/image-fit-extension` (57s), `packages/video-transcription`, `packages/video-production`, `packages/nano-banana`, `packages/mockup-loop`, `packages/kb-extension`.

Run ends with ~60s of one core working, fifteen idle.

## Prior art

`openspec/changes/archive/2026-06-07-parallelize-test-suite` moved every project from `maxWorkers: 1` to `"50%"`, added per-file HOME isolation (`packages/shared/src/test-support/setup-home-perfile.ts`) and migrated 18 fixed-port server-boot files to `createTestServer()` / `port: 0`. That work is the reason 50% is safe today. This research is the NEXT step past it.

## Candidate levers (not decided)

| Lever | Est. win | Risk | Effort |
|---|---|---|---|
| A. `scripts/` meta-gates → separate `test:gates` project, off `npm test`, on in CI + `ship-it` | −473s work, −238s critical path | gates stop running locally, may rot | S |
| B. `pool: "threads"` + `maxWorkers: "100%"` on jsdom/pure projects | measured 1.44x on client | threads break tests mutating `process.env`/`chdir`/spawn — keep `forks` for server/extension | S |
| C. Retire per-change mutation harnesses once their change archives | −238s | loses regression teeth | S (policy question) |
| D. Move `maxWorkers: 1` projects into main pool or give them `sequence.groupOrder` | −~60s serial tail | pins guarded something — needs audit | M |
| E. `vitest --changed` / `related` for dev loop, full suite pre-push only | 12 min → seconds locally | module-graph misses (fixtures, dynamic imports) | S |
| F. `--shard=i/N` across CI matrix jobs | linear, CI only | none | S |
| G. jsdom triage: `@vitest-environment node` on non-DOM client tests | up to −500s aggregate | tedious, file-by-file | L |

Naive projection A+B+D: work drops ~1330s, critical path drops to ~102s, 16 workers → plausibly ~3–4 min instead of 12. E changes felt cost more than any other lever.

## Open questions for the decision

1. Do `scripts/` hygiene gates (mutation teeth, biome dep guards, lint ledger) belong in CI/`ship-it` rather than `npm test`? 26% of work + the entire critical path, and not unit testing.
2. `npm run quality:changed` currently ends in a full `npm test`. Highest-leverage change may be making the DEFAULT loop related-tests-only, reserving the 1456-file run for pre-push.
3. The 55 `--no-isolate` failures indicate real cross-file coupling in the client suite. Worth a separate cleanup?

## How to reproduce

```bash
# full run with per-file timings
HOME=$(mktemp -d) npx vitest run --reporter=json --outputFile=/tmp/pi-test-timing.json --reporter=default

# single project experiment
HOME=$(mktemp -d) npx vitest run --project '@blackbelt-technology/pi-dashboard-web' --pool=threads --maxWorkers=16
```
