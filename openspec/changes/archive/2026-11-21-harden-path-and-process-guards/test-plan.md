# Test Plan — harden-path-and-process-guards

Stage: design   Generated: 2026-11-20

Levels: L1 vitest · L2 qa/tests smoke · L3 tests/e2e Playwright · ci · manual-only (—).
No rendered-UI surface is touched by this change (WS `plugin_action`, extension gate, CLI wrapper, baseline JSON) → no L3 rows, Frontend-quirk class N/A.
Spec refs: PCA = plugin-cwd-admission, CQL = codeql-local-ratchet, APC = agent-path-confinement, MS = managed-services.

Harness exemplars (all verified to exist):
- H-PA  `packages/automation-plugin/src/server/__tests__/plugin-action-handler.test.ts` (stub `ctx.consume("host.knownFolderCwds")`, tmp dir; `vi.mock` of `admitRouteCwdParam` for indeterminate)
- H-PG  `packages/extension/src/path-gate/__tests__/handler.test.ts` (`harness()` with fake `now`, stub `yoloDecide`, `call(tool,path)`, in-file p95 timing pattern at P1/P2)
- H-EX  `packages/server/src/__tests__/cli-service.test.ts` (E45/X6/X5 `execVerb` with `spawnChild` stub)
- H-RP  `packages/server/src/__tests__/cli-signal-forwarding.test.ts` (real-process spawn + signal)
- H-BL  `packages/shared/src/__tests__/codeql-baseline-gates.test.ts` (`validateF1Reason`, `#E32`)
- H-QA  `qa/tests/42-managed-services-podman.sh` (`svc()` launcher via `PI_DASHBOARD_CMD`, process-group leftovers check)
- H-CI  `packages/shared/src/__tests__/codeql-workflow-contract.test.ts` / `.github/workflows/codeql.yml`

---

## Scenarios

### Edge-case

| id | req | technique | level | disp | input | trigger | expected observable | harness |
|----|-----|-----------|-------|------|-------|---------|---------------------|---------|
| S1 | PCA plugin_action create admitted | EP (valid) | L1 | automated | folder-scope `create`, `payload.cwd` = real tmp dir listed in `host.knownFolderCwds`, valid name+config | dispatch `plugin_action {pluginId:"automation",action:"create"}` | `<cwd>/.pi/automation/<name>/automation.yaml` exists; admission token released exactly once (release spy called once, also when write throws) | H-PA |
| S2 | PCA create unadmitted | EP (invalid) | L1 | automated | folder-scope `create`, `payload.cwd` = existing tmp dir NOT in knownCwds | dispatch create | warn log `automation create: cwd not admitted`; `<cwd>/.pi/automation` NOT created; `process.cwd()/.pi/automation` untouched | H-PA |
| S3 | PCA create presence check (no process.cwd fallback) | decision-table over `payload.cwd` ∈ {absent, `undefined`, `null`, `""`, `0`, `{}`, `[]`, `"/x"`(unadmitted)} × scope=folder | L1 | automated | folder-scope create with each cwd value; spy on `process.cwd()` and fs writes | dispatch create per row | each row refused (`cwd_required` for absent/null/""; `invalid_cwd` for 0/{}/[]; not-admitted for "/x"); zero files written anywhere, `process.cwd()` never used as base | H-PA |
| S4 | PCA create global scope | EP + decision-table (scope=global × cwd absent/present) | L1 | automated | `scope:"global"`, no cwd; `os.homedir()` mocked to tmp dir | dispatch create | file written under `<tmp-home>/.pi/automation/<name>/`; no `cwd_required` refusal; with a supplied unadmitted cwd + global → admission still runs on supplied cwd and refuses (pin: nothing written) | H-PA |
| S5 | PCA run unadmitted cwd | EP (invalid) | L1 | automated | `run`, name `a`, `payload.cwd` = tmp dir NOT in knownCwds, containing a planted `.pi/automation/a/automation.yaml` | dispatch run | warn log `automation run: cwd not admitted`; `<cwd>/.pi/automation` NOT scanned (fs `readdir`/`runNowViaEngine` spy not called); no run started | H-PA |
| S6 | PCA run non-string cwd | EP (invalid type) × BVA | L1 | automated | `run` with `payload.cwd` ∈ {123, `{}`, `[]`, `true`} | dispatch run | refused as `invalid_cwd`; `runNowViaEngine` not called; no scan | H-PA |
| S7 | PCA run no cwd unchanged | decision-table (cwd absent / `null` / `""` → treated absent per `admitRouteCwdParam`) | L1 | automated | `run` name `a`, cwd absent, `null`, `""` | dispatch run | reaches `runNowViaEngine(scope, undefined, "a")` as before (existing "run reaches engine core" semantics); no refusal log | H-PA |
| S8 | PCA run admitted cwd | EP (valid) | L1 | automated | `run` with admitted tmp cwd (existing test "run reaches engine core" re-pointed to an admitted cwd in the same task) | dispatch run | `runNowViaEngine` called with `adm.cwd`; release called once in `finally` | H-PA |
| S9 | PCA parity with REST / stop | decision-table (WS create/run/stop × REST create/run/stop) over one shared `admit` closure | L1 | automated | same unadmitted cwd for all six entry points | invoke each | all six refuse; REST suite `routes-cwd-admission.test.ts` unchanged and green; `stop` still refuses (regression of the hoist) | H-PA (+ existing `routes-cwd-admission.test.ts`) |
| S10 | CQL fixed F1 leaves no accepted-risk entry | EP (reason prefix) / BVA on entry count (0, 1..5 remaining) | L1 | automated | `codeql-baseline.json` entries with `file === automation-writer.ts` after the ratchet task; synthetic fixtures: (a) 0 entries, (b) 5 `false-positive:` entries naming `admitRouteCwdParam` + file:line, (c) one `accepted-risk: … #1104`, (d) one `false-positive:` without the gate name, (e) one with unknown prefix | run updated `#E32` / `validateF1Reason` | (a),(b) pass; (c) fails naming the entry key; (d) fails; (e) fails; stale `#E32 … accepted-risk citing #1104` expectation removed | H-BL |
| S11 | CQL reason-only edit (diff scope) | EP (field-change set) | L1 | automated | baseline diff fixtures: reason-only change; reason+`lineHash` change; `count` change; `ruleId`/`file` change | evaluate with the `--check-baseline-diff` logic (or its pure helper) | reason-only passes; any change to `ruleId`/`file`/`lineHash`/`count` is reported and fails | H-BL (+ `scripts/codeql-local.mjs` helper if exported; else see New infra) |
| S12 | APC gate: YOLO before suppression, timeout | State-transition (prompt timed-out → suppressed → YOLO live) | L1 | automated | grantable, non-sensitive `/w/other/a.txt`; prompt timed out (fake `now` t0); YOLO link announced, `yoloDecide`→`auto-allow`; retry `/w/other/b.txt` at t0+30 s | call write | call proceeds; `yolo-allowed` logged; no prompt shown; `yoloDecide` called once | H-PG |
| S13 | APC explicit Deny remembered | State-transition (Deny → remembered refusal → `refused`) | L1 | automated | operator `Deny` on `/w/other/a.txt` (report accepted), `yoloDecide`→`refused`; retry `/w/other/b.txt` at t0+30 s | call write | blocked, outcome `yolo-refused` (not `recently-denied`, not allowed), reason mentions clearing it in Settings ▸ Access | H-PG |
| S14 | APC sensitive target keeps suppression | decision-table (denial kind {Deny, timeout} × target {sensitive `~/.ssh/x`}) | L1 | automated | live unscoped YOLO; prior Deny or timeout under `~/.ssh` | retry under same dir within 120 s | `recently-denied`; `yoloDecide` NOT called (call-count 0) for both kinds | H-PG |
| S15 | APC ungrantable subject keeps suppression | decision-table (denial kind {Deny, timeout} × subject = file directly in `$HOME`) | L1 | automated | live unscoped YOLO; prior Deny/timeout on `~/notes.txt` | retry `~/other.txt` within 120 s | `recently-denied`; `yoloDecide` NOT called | H-PG |
| S16 | APC YOLO decline leaves suppression | decision-table (server answer {decline, error→decline, unsupported}) | L1 | automated | prior Deny; YOLO link up; `yoloDecide` → `decline` (scope excludes `/w/other`) | retry within 120 s | `recently-denied`, no prompt; `yoloDecide` called once | H-PG |
| S17 | APC no UI | decision-table (hasUI=false × YOLO live × suppression active) | L1 | automated | `hasUI=false`, live YOLO, suppression active | call | `no-ui`; `yoloDecide` not called | H-PG |
| S18 | APC no YOLO link unchanged | decision-table (link ∈ {not connected, `path-yolo` not announced, not same-host}) | L1 | automated | prior timeout; each link state | retry within 120 s | `recently-denied` (unchanged), `yoloDecide` not called, no extra latency | H-PG |
| S19 | APC suppression window boundary | BVA on 120 s (119.999 s / 120.000 s / 120.001 s) × YOLO {live, none} | L1 | automated | prior timeout; fake `now` advanced to boundary; YOLO none / live auto-allow | retry | none-YOLO: 119.999 → `recently-denied`, 120.001 → ordinary prompt; live-YOLO: auto-allow at all three (ordering unchanged window semantics); suppression map content untouched (same size/keys) | H-PG |
| S20 | APC declined always-allow confirm (residual) | State-transition | L1 | automated | operator chooses always-allow then declines confirmation; no refusal reported (`reportRefusal` spy: 0 calls); then `yoloDecide`→`auto-allow` | retry within 120 s | first call blocked as denied; retry proceeds `yolo-allowed` | H-PG |
| S21 | APC Deny while disconnected | State-transition (disconnected-Deny → link down retry → reconnect) | L1 | automated | Deny while bridge disconnected (no report); (a) retry with link still down; (b) link restored, `yoloDecide`→`auto-allow`, still within 120 s | retry (a) then (b) | (a) `recently-denied`, server not asked; (b) `yolo-allowed` | H-PG |
| S22 | APC unknown answer not reported | EP (answer kinds: unknown string vs explicit Deny) | L1 | automated | prompt answered with an unrecognised value (not Allow once/Always/Deny); `reportRefusal` spy; then live YOLO `yoloDecide`→`auto-allow` | gate call, then retry within 120 s | first call blocked as denied; `reportRefusal` called 0 times; retry proceeds `yolo-allowed`; contrast case: explicit Deny → `reportRefusal` called exactly once with the absolute canonical target | H-PG |
| S23 | APC refusal-cleared restores YOLO (server side, regression) | State-transition | L1 | automated | remembered refusal then cleared on Access surface, window elapsed, live YOLO | out-of-root call | `yolo-allowed`; existing server tests unchanged | existing `packages/server` agent-yolo tests (run-only regression; no new file) |
| S24 | APC ordinary non-YOLO unchanged | decision-table (suppression active × no YOLO) incl. in-mutex re-check | L1 | automated | non-YOLO session, prior Deny; two concurrent calls queued on the mutex while first prompt open and answered Deny | calls | second call `recently-denied` via in-mutex `ask()` re-check; no prompt for it; existing P1/P2 timings still within bound | H-PG |
| S25 | MS exec SIGTERM forward | State-transition (running → signalled → child exit → release) | L1 | automated | stub child (`spawnChild`) that exits on SIGTERM; `deps.signalSource` EventEmitter | emit SIGTERM | `child.kill("SIGTERM")` called once; lease release call occurs after child exit event (ordering asserted); `exec` resolves with 143 | H-EX |
| S26 | MS exec SIGINT / SIGHUP forward | EP over signal set {SIGTERM, SIGINT, SIGHUP} | L1 | automated | stub child; emit each | emit signal | child receives the same signal each; exit status 128+n (130 / 129) | H-EX |
| S27 | MS child handles signal and exits N | EP/BVA on exit code {0, 1, 2, 255} after signal | L1 | automated | child handles SIGTERM then exits with code N | emit SIGTERM | `exec` exits N (not 143); lease released | H-EX |
| S28 | MS kill-grace boundary | BVA on 5 s grace (4.999 / 5.000 / 5.001 s; fake timers) + custom `killGraceMs` | L1 | automated | child ignores SIGTERM; `killGraceMs` default 5000 and an override 200 | emit SIGTERM, advance timers | no SIGKILL at 4.999 s; SIGKILL exactly once at ≥5.000 s; override honoured; after kill → lease released → exit 137 | H-EX |
| S29 | MS child exits within grace | State-transition (grace timer cancel) | L1 | automated | child exits at 1 s after SIGTERM | advance fake timers to 10 s | NO SIGKILL ever sent; grace timer cleared (`vi.getTimerCount()` back to baseline) | H-EX |
| S30 | MS repeated signal does not escalate | State-transition (double delivery) + decision-table {same sig twice, different sigs, 3× burst} | L1 | automated | child ignores SIGTERM; emit SIGINT then SIGINT again at +0 ms; also SIGTERM+SIGHUP | emit | repeats forwarded (child.kill called per signal) but NO SIGKILL before 5 s; SIGKILL fires at 5 s from FIRST signal (not re-armed/shortened/extended; single timer) | H-EX |
| S31 | MS no signal → unchanged | regression (E45 / X6 / X5) | L1 | automated | normal child exit, no signal | run existing E45/X6/X5 | all still green; exit code = child's; stdout bytes-only | H-EX |
| S32 | MS handlers removed after release | State-transition (cleanup) | L1 | automated | child exits normally; also exits after signal; also `spawn` `error` path | await `exec` completion | `process`/`signalSource` `listenerCount` for SIGTERM/SIGINT/SIGHUP back to baseline in all 3 paths | H-EX |
| S33 | MS real process: SIGTERM-ignoring child reaped | State-transition (real signals) | L1 | automated | real `execVerb` spawning `node -e "process.on('SIGTERM',()=>{});setInterval(()=>{},1e3)"`; skipped on win32 | send real SIGTERM to the exec host (child_process wrapper) | child pid gone within 5 s + margin (`process.kill(pid,0)` → ESRCH); lease release recorded; exec exits 137 | H-RP |
| S34 | MS real process on Linux/macOS via CLI | State-transition (multi-OS runtime) | L2 | automated | built `pi-dashboard service exec <id> -- node -e <ignore SIGTERM>` against QA server; Linux + macOS (win32 SKIP) | `kill -TERM <exec pid>` | no surviving child pid after ≈6 s; `service status <id>` shows lease released (no holder); exit status 137 | H-QA |

### Performance

| id | req | technique | level | disp | workload | metric + threshold | window | harness |
|----|-----|-----------|-------|------|----------|--------------------|--------|---------|
| P1 | APC YOLO ask now precedes suppression | tail-latency | L1 | automated | 10 000 suppressed retries by YOLO-supported session, `yoloDecide` stub answering immediately (`auto-allow`) | p95 per call < 1 ms of gate overhead (excl. stub) — same bound as existing P1 | single run | H-PG |
| P2 | APC silent-server cost bound | fault-injection (delay) + threshold | L1 | automated | suppressed retry; `yoloDecide` never settles; fake timers | decline reached at exactly `YOLO_ASK_TIMEOUT_MS`=1500 ms (not <1499/>1501 fake-ms) then `recently-denied`; never prompts | one call | H-PG |
| P3 | APC disabled gate / non-YOLO unchanged | tail-latency | L1 | automated | existing P2 (disabled gate) + non-YOLO suppressed retry ×10 000 | p95 < 0.05 ms disabled; non-YOLO suppressed retry makes 0 server round-trips and p95 < 1 ms | single run | H-PG |
| P4 | PCA admission overhead (per-request check) | tail-latency | L1 | automated | 1 000 `create`/`run` with admitted tmp cwd (warm) | p95 admission+dispatch < 50 ms (spec states "existing per-request check", no new budget; threshold is a regression guard); proposal asserts no new budget | single run | H-PA |
| P5 | MS exec no extra wake-ups / leak | soak (listeners/timers) | L1 | automated | 200 sequential `execVerb` runs with signal source, mix of signalled/unsignalled | `signalSource` listenerCount delta = 0 and `vi.getTimerCount()` delta = 0 after each; heartbeat interval cleared | 200 iterations | H-EX |

### Frontend-quirk

N/A — no rendered UI, WS-view or optimistic-UI behaviour changes (WS `plugin_action` has no shipped automation UI sender per proposal Non-goals). No rows.

### Error-handling

| id | req | technique | level | disp | fault | trigger | expected observable | harness |
|----|-----|-----------|-------|------|-------|---------|---------------------|---------|
| X1 | PCA indeterminate admission (create) | fault-injection (abort) | L1 | automated | `vi.mock` `admitRouteCwdParam` → 503 `cwd-admission-unavailable` | folder `create` with otherwise valid cwd | refused; nothing written; refusal logged; no `process.cwd()` fallback; no thrown exception to the WS layer | H-PA |
| X2 | PCA indeterminate admission (run) | fault-injection (abort) | L1 | automated | same mock → 503 | `run` with supplied cwd | refused; no scan; no run | H-PA |
| X3 | PCA admission throws | fault-injection (abort) | L1 | automated | `admitRouteCwdParam` rejects with Error | create / run | handler does not throw out; nothing written/started; `release` not required (no token) — no unhandled rejection | H-PA |
| X4 | PCA write fails after admission | fault-injection (abort) | L1 | automated | admitted cwd; `writeAutomation` throws (EACCES) | create | token still released in `finally` (release spy 1×); error logged; no partial dir left | H-PA |
| X6 | CQL pruned/retyped baseline invalid | fault-injection (bad data) | L1 | automated | baseline entry with missing/`TBD`/placeholder `#<digits>`, or `accepted-risk:` w/o issue number | contract test run | test fails naming the entry key (existing "Unfixed finding keeps accepted-risk reason" requirement stays enforced for non-F1 entries) | H-BL |
| X7 | CQL ratchet re-run after reason-only edit | state-transition (CI/tooling) | ci | automated | edited baseline with five reason-only changes, CodeQL CLI available | `node scripts/codeql-local.mjs` then `--check-baseline-diff <base>` | ratchet exit 0; diff lists only `reason` changes on the 5 entries; the one-time exception recorded | H-CI (CodeQL CLI required; gated like existing codeql workflow) |
| X8 | APC YOLO answer error | fault-injection (abort) | L1 | automated | `yoloDecide` rejects / WS disconnect mid-ask; suppression active and not | retry | NOT blocked as `error`; with suppression active → `recently-denied`; without → ordinary prompt | H-PG |
| X9 | APC lost Deny report | fault-injection (abort) | L1 | automated | `reportRefusal` throws on Deny | Deny, then retry under live YOLO `auto-allow` within 120 s | the Deny still blocked its call (reason denied); retry proceeds `yolo-allowed` | H-PG |
| X10 | APC refusal not persisted (server) | fault-injection (abort) | L1 | automated | server `agent-yolo` "refusal NOT persisted" path → answers non-`refused` | retry under live YOLO | proceeds `yolo-allowed` (documented residual); existing server test for the path unchanged | existing `packages/server` agent-yolo tests (run-only) |
| X11 | APC gate internal error | fault-injection (abort) | L1 | automated | `getRoots` / canonicalisation throws inside the reordered pre-mutex block | call | blocked as `error` (fail-closed preserved), not allowed | H-PG |
| X12 | APC YOLO answer arrives after suppression window / session end | State-transition + delay | L1 | automated | `yoloDecide` resolves `auto-allow` only after YOLO session ended server-side (answer = `decline`) | retry | next out-of-root call prompted as usual; no stale allow | H-PG |
| X13 | MS signal during lease-release in flight | fault-injection (delay) | L1 | automated | child already exited; release HTTP stub pending | emit SIGTERM mid-release | `exec` does not die; release completes; then exits with child's status; signal ignored (done-latch) | H-EX |
| X14 | MS lease release fails | fault-injection (abort) | L1 | automated | release call rejects / server restarted (cf. X6) | after child exit post-signal | `exec` still exits with the child's status; handlers removed in `finally` | H-EX |
| X15 | MS `child.kill` throws | fault-injection (abort) | L1 | automated | `child.kill` throws (ESRCH — child already dead) on forward and on SIGKILL | emit SIGTERM; elapse grace | no uncaught exception; exec proceeds to release+exit | H-EX |
| X16 | MS spawn `error` event | fault-injection (abort) | L1 | automated | `spawnChild` emits `error` (ENOENT) before any signal; also error after a signal | run | handlers + timers cleaned (listenerCount/timer baseline), lease released, non-zero exit | H-EX |
| X17 | MS SIGKILL of exec itself | fault-injection (abort) | — | manual-only | `kill -9 <exec pid>` | observe | child survives (not forwardable) and lease expires at TTL (documented limitation; unforwardable, no automatable in-process observable without a 30 s+ TTL wait) | — |
| X18 | MS Windows kill-grace best-effort | platform | — | manual-only | Windows host, `service exec` with SIGTERM-ignoring child | `Ctrl+C`/taskkill | `child.kill` force-terminates; real-process test is skipped on win32; human confirms no orphan | — |
| X19 | MS reparented descendants not reaped | negative (non-goal pin) | L1 | automated | child `sh -c 'sleep 100 & exit'` | exec completes | `exec` exits with child's status and releases lease; descendant NOT killed (pins non-goal; documented) | H-RP |

---

## Coverage summary

- Requirements covered: PCA(1 req, 9 scenario blocks) · CQL(2 mod scenarios) · APC(3 reqs) · MS(1 req, 5 scenarios) → all 4 capabilities / every scenario block in the 4 deltas.
- Scenarios by class: edge 34 (S1–S34) · perf 5 · frontend 0 (N/A) · error 18 → 57 total
- Scenarios by level: L1 53 · L2 1 (S34) · L3 0 · ci 1 (X7) · manual-only 2 (X17, X18; level —)
- Scenarios by disposition: automated 55 · manual-only 2
- S23 and X10 are run-only regressions of existing server tests (no new file).

## New infra needed

- S11: `--check-baseline-diff` field-diff logic may need to be exported as a pure helper from `scripts/codeql-local.mjs` to be unit-testable at L1; otherwise covered only by X7 (ci).
- S34: QA fixture to run a long-lived `service exec` with a SIGTERM-ignoring child and read lease state — adapt `42-managed-services-podman.sh` `svc()` (no new level).
- Otherwise none.
