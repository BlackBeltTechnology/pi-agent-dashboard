# Test Plan — add-trusted-types-shadow-enforce

Stage: design   Generated: 2026-10-24

Hard gate passed: every Triple slot is concrete. Values used:
- budgets: 200 classifications / 2 Mi UTF-16 units / 50 ms per 30 s window;
- memo: 512 entries / 4 Mi units;
- body bound: 7,168 B; clamp: 1,000,000; shadow-detail LRU: 500;
- perf: ≤ 20 ms median of 5; persistence: ≤ 5 s.

No clarifications are open.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | client: Default policy follows mode / Shadow outcome for altered HTML | EP | L1 | automated | mode `report`, fake TT factory, input `<img src=x onerror=f()>` | `default.createHTML(input)` | returns the identical string; tally has `trusted-types-shadow\0would-alter-html\0<source>` = 1 and `shadowTotals.would-alter-html` = 1 |
| E2 | client: Shadow outcome for dropped leading head content | EP (head-element partition) | L1 | automated | report mode; inputs `<style>p{color:red}</style><p>x</p>`, `<SCRIPT>x</SCRIPT><p>y</p>`, `<p>z</p><style>q{}</style>` | `default.createHTML` each | first two → `would-alter-html` = 1 each (pass-2 path); third → outcome only if DOMPurify lists a removal; all return input unchanged |
| E3 | client: Shadow ignores intact HTML / tag-free fast path | EP | L1 | automated | report mode; inputs `color: red` and `<p class="a">x</p>` | `default.createHTML` each | no `trusted-types-shadow` key; sanitizer spy called 0× for the tag-free input; both returned unchanged |
| E4 | client: script-text / script-URL shadow outcomes | decision table | L1 | automated | report mode; `createScript("1+1")`; `createScriptURL` of `/plugin-assets/x/abc/worker.js`, `https://cdn.example/x.js`, `/api/file/raw?path=a.js`, `/assets/editor.worker.js`, `/sw.js` | each call | script → `would-block-script` 1; first three URLs → `would-block-script-url` 1 each; last two → no outcome; every call returns its input |
| E5 | client: No shadow work outside report mode | decision table (mode × method) | L1 | automated | modes `off`, `enforce`, `report` × methods createHTML / createScript / createScriptURL with a would-fire input | each call | `off` and `enforce` → 0 shadow keys and 0 shadow totals (enforce output follows existing rules); `report` → one outcome per call |
| E6 | client: Repeated input classified once while memoized; eviction | BVA (512 entries) | L1 | automated | report mode; one unsafe string ×100; then 513 distinct strings, then the 1st again | sequential `createHTML` calls | sanitizer spy for the repeated string = 1, `would-alter-html` count = 100; after 513 distinct, re-sighting of the 1st increments the spy by 1 |
| E7 | client: Budget exhaustion visible / renews / late unsafe classified | BVA (count 199/200/201) + state-transition (window) | L1 | automated | report mode, fake timers; 150 distinct safe + 1 unsafe; separately 200 distinct then a 201st distinct ×5 | calls in one window, then advance 30 s and repeat the 201st | unsafe after 150 → `would-alter-html` 1; 200th classified; 201st → `not-evaluated` = 1 (not 5) in window 1; in window 2 the 201st is classified |
| E8 | client: Budget by size and time | BVA (2,097,152 units; 50 ms) | L1 | automated | report mode; inputs summing exactly 2,097,152 units, then 1 more unit; fake `performance.now()` advancing 30 ms per classification | sequential distinct `createHTML` | the input reaching exactly the size limit is classified, the next → `not-evaluated`; with time: 1st and 2nd classified (start at 0 and 30 ms), 3rd (start at 60 ms) → `not-evaluated` |
| E9 | client: No re-entry; default-hit counts unchanged | invariant | L1 | automated | report mode; sanitizer stub that calls `default.createHTML("<b>n</b>")` during pass 1 | outer `createHTML("<i>o</i>")` | nested call returns `<b>n</b>` unchanged, adds 0 `trusted-types-default` hits and 0 shadow outcomes; over a fixed call sequence `trusted-types-default` counts equal the number of outer calls with shadow on and off |
| E10 | client: would-throw-html vs shadow-error | decision table (fault origin) | L1 | automated | report mode; case A `DOMPurify.isSupported = false`; case B pass-2 helper throws | `createHTML("<style>a{}</style><p>x</p>")` | A → `would-throw-html` 1, `shadow-error` 0; B → `shadow-error` 1, `would-throw-html` 0; both return input, no throw |
| E11 | client: private parse-only policy | invariant | L1 | automated | fake TT factory recording `createPolicy` names; then no factory | `installTrustedTypes("report")`, one classification | names include `pi-shadow-parse` exactly once and `default` exactly once; classifier instance receives it as `TRUSTED_TYPES_POLICY`; module exports contain no `pi-shadow-parse` accessor; without factory no policy created and classification still runs |
| E12 | client: Oversized count split; shadow-only totals sent | BVA (1,000,000/1,000,001) | L1 | automated | `shadowTotals.would-block-script` = 1,000,001, empty tally | two `flushViolations` with 2xx fetch stub | 1st body: `entries: []`, `shadow.would-block-script` = 1,000,000; 2nd body: `shadow.would-block-script` = 1 |
| E13 | client: retention by response | decision table (status) | L1 | automated | totals `{would-alter-html: 3}`; fetch stub answers 200 / 400 / 401 / 403 / 408 / 413 / 429 / 500 / rejects | flush, then a second flush after 1 new `would-block-script` | 200 → 2nd shadow = `{would-block-script:1}`; 400 → 2nd = `{would-block-script:1, shadow-error:1}`; every other case → 2nd = `{would-alter-html:3, would-block-script:1}`; no case throws |
| E14 | client: body bound, priority order, source truncation | BVA (512/513 units; 7,168 B) | L1 | automated | 20 violation keys + 20 default-hit keys + 20 shadow-detail keys, each source 600 units; separately 60 non-shadow keys + 1 shadow outcome | `flushViolations` | body ≤ 7,168 B; every sent source has length 512; order = violations, default hits, shadow detail; dropped keys counted in `overflow`; `shadow` field present; with 60+1, no non-shadow key is in `overflow` while a shadow-detail entry is sent |
| E15 | client endpoint: aggregate persisted, unknown ignored, never `record()` | EP | L1 | automated | `POST /api/csp-violations` `{entries:[{directive:"trusted-types-shadow",sink:"would-block-script-url",source:"s",count:2}], shadow:{"would-block-script-url":2,"would-foo":3}}`; separately detail-only without `shadow` | inject request | 200; `recordShadow` called once with `("would-block-script-url",2)`; store `record` spy 0 calls; detail-only → `recordShadow` 0 calls |
| E16 | client endpoint: invalid / refused shadow | BVA + EP | L1 | automated | `shadow` values 1 and 1,000,000 (valid); 0, 1,000,001, 1.5, "2", -1; `shadow` = `[]`, `"x"`, `5`, `null`; a 4th report in a burst | inject each | valid → 200 + `recordShadow`; every invalid value or non-object → 400 and `recordShadow` 0 calls; burst-excess → 429 and `recordShadow` 0 calls |
| E17 | client endpoint: shadow detail never evicts violations | BVA (500 LRU) | L1 | automated | one violation entry, then 501 distinct `trusted-types-shadow` detail entries over several accepted reports | `GET /api/csp-violations` | the violation counter is still in the response |
| E18 | baseline: shadow aggregate persisted, isolated from policy counters | state (persist/reload) | L1 | automated | `CspReportStore` on a temp file, fake timers | `recordShadow("would-alter-html",4)`, advance 5 s, new store on same file | file has `ttShadow.counts.would-alter-html.count` = 4 within 5 s; reload shows 4 with the same `since` and shadow `since`; every `counts` policy map unchanged and `strictScriptSrcMeasure` unchanged |
| E19 | baseline: block missing / malformed / unknown key | state-transition (load) | L1 | automated | files: core-only (pre-change or older-server rewrite); `ttShadow: []`; known key with `count: -1`; valid block plus `"would-foo"` key | start store at a fixed clock | core-only → core and `since` kept, shadow zero, shadow `since` = start time; malformed ×2 → no `.corrupt` file, core kept, shadow zero, new shadow `since`, 1 warning; unknown-key file → known counts and shadow `since` unchanged, `would-foo` absent after the next write |
| E20 | baseline: reset zeroes shadow and aligns both `since` | state-transition | L1 | automated | non-zero core and shadow counts | `POST /api/csp-reports/reset` (operate tier) | 200 `{"success":true,"since":T}`; all counters 0; core `since` = shadow `since` = T; observe/control tier → 403 and counts unchanged |
| E21 | baseline: health `ttShadow` always present, counts only | EP (disclosure × counts) | L1 | automated | disclosure-permitted caller after reset; after `recordShadow("shadow-error",1)`; non-permitted caller | `GET /api/health` | permitted: `cspReports.ttShadow` = `{since, 6 keys}` all 0, then `shadow-error` 1; no `firstSeen`/`lastSeen` in body; non-permitted: no `cspReports` |
| E22 | wiring: store before routes | integration | L1 | automated | `createServer` test instance | POST a report with `shadow:{"would-block-script":1}`, then `GET /api/health` | `cspReports.ttShadow.would-block-script` = 1 |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | client: shadow cost bounded (design D4) | threshold | L3 | automated | mermaid gallery page and a session chat rendering mermaid, TT mode `report` (shadow active) | sum of `default`-callback time per page load, median of 5 runs ≤ 20 ms | one page load × 5 runs |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | client: Shadow evaluation raises no TT violation; counts unchanged | invariant | L3 | automated | docker harness, TT `report`, TT probe installed | run `trusted-types-budget.spec.ts` routes without `PI_TT_BUDGET_RECORD` | every route: `probe.violations` = [] and `defaultHits` ≤ the existing recorded budget, so shadow adds no hits and no violations |
| F2 | client+baseline: end-to-end shadow evidence | state-convergence | L3 | automated | TT `report`; counters reset; page evaluates `el.insertAdjacentHTML("beforeend","<img src=x onerror=f()>")` and `new Worker("/plugin-assets/x/abc/worker.js")` | dispatch `pagehide` (navigate away) to force a flush | DOM `img` keeps its `onerror` attribute (report-neutral); `GET /api/health` converges to `ttShadow.would-alter-html` ≥ 1 and `would-block-script-url` ≥ 1; `GET /api/csp-violations` lists `trusted-types-shadow` rows for both |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | baseline: Violation counter degrades safely (write failure) | fault-injection (abort) | L1 | automated | counter-file write throws (`EACCES`) | `recordShadow("would-block-script",1)` then flush | route still answers success; in-memory snapshot shows `ttShadow` count 1; exactly 1 warning logged |
| X2 | client: pagehide final send | fault-injection (abort, no retry) | L1 | automated | totals `{would-alter-html:2}`; `pagehide` event; fetch stub records init | dispatch `pagehide` | one fetch with `keepalive: true` whose body carries `shadow.would-alter-html` = 2; no exception reaches the UI |

---

## Coverage summary

- Requirements covered:
  - client-trusted-types: 3/3 modified (Default policy follows mode, Violations reported, Violation endpoint).
  - baseline-content-security-policy: 4/4 modified (observable and persistent, degrades safely, reset, health).
- Scenarios by class: edge 22 · perf 1 · frontend 2 · error 2.
- Scenarios by level: L1 24 · L2 0 · L3 3.
- Scenarios by disposition: automated 27 · manual-only 0.

## New infra needed

- none. L3 rows reuse `tests/e2e/helpers/trusted-types.ts` (`installTtProbe`, `forceTtMode`) and the docker harness.
