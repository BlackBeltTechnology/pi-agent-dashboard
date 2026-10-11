# Test Plan — close-e2e-tooling-followups

Stage: design   Generated: 2026-10-11

No clarification gaps: every Triple below is concrete.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | docker-test-harness: lone harness refused | BVA (cap = MemTotal) | L1 | automated | no peer (`FAKE_PROJECTS` empty), `FAKE_MEMTOTAL`=8 GiB, `MEM_LIMIT=8g` | `docker/test-up.sh` | exit ≠ 0; stderr has `1 × 8.0 GiB` arithmetic and `PI_HARNESS_ALLOW_OVERSUBSCRIBE=1`; stderr lacks "co-resident"; `$FAKE_DOCKER_LOG` has no `compose … up` |
| E2 | docker-test-harness: lone harness prints nothing extra | BVA (cap < MemTotal) | L1 | automated | no peer, MemTotal 8 GiB, `MEM_LIMIT=4g` | `test-up.sh` | exit 0; no `stabilize-browser-e2e:` line on stderr; `compose up` reached |
| E3 | docker-test-harness: lone oversize + override | decision table (peers=0 × fits=no × override=1) | L1 | automated | no peer, MemTotal 8 GiB, `MEM_LIMIT=8g`, `PI_HARNESS_ALLOW_OVERSUBSCRIBE=1` | `test-up.sh` | exit 0; exactly one `oversubscribed` warning line; `compose up` reached |
| E4 | docker-test-harness: lone, memory unreadable | decision table (peers=0 × readable=no) | L1 | automated | no peer, `FAKE_INFO_FAIL=1` | `test-up.sh` | exit 0; zero extra stderr lines (unlike the peer case, which warns) |
| E5 | docker-test-harness: co-resident paths unchanged | decision table regression (peers=1 × {fits, oversize, override, unreadable}) | L1 | automated | `FAKE_PROJECTS`=one peer; MemTotal 16 GiB / 8 GiB; override on/off; info fail | `test-up.sh` | outcomes identical to today's suite; refusal still names the peer project and says "co-resident"; every refusal asserts no `compose up` in `$FAKE_DOCKER_LOG` |
| E6 | playwright-e2e-qa: unattributed file-level skip refused | EP (reason class: none) | L1 | automated | spec text with column-0 `test.skip(!x, "flaky env")` | `unlinkedFileSkips(text)` / guard walk | returns the call; guard test fails naming the file |
| E7 | playwright-e2e-qa: CI job id whole-token | BVA on token boundary | L1 | automated | reasons: `` "runs on `e2e-browser-relay`" ``, `"e2e flake"`, `` "`e2e-browser-relax`" ``, `` "`merge-report`" ``, `"playwright.team.config.ts"` | guard helper | accepted, rejected, rejected, rejected, rejected respectively |
| E8 | playwright-e2e-qa: issue URL accepted | EP | L1 | automated | column-0 `test.skip(!hasPi, "… https://github.com/o/r/issues/123")` | guard helper | not reported |
| E9 | playwright-e2e-qa: indented guard exempt | EP (indent class: spaces, tab) | L1 | automated | `  test.skip(!port, "…")` and `\ttest.skip(!port, "…")` | guard helper | neither reported |
| E10 | playwright-e2e-qa: multi-line top-level call parsed | state (paren depth spans lines) | L1 | automated | the `browser-relay.spec.ts:110` shape (call opens on line 1, cond and reason on later lines) | guard helper | reason extracted; accepted via `e2e-browser-relay` |
| E11 | playwright-e2e-qa: unconditional form ignored | EP | L1 | automated | column-0 `test.skip("title", async () => {})` | guard helper | not reported |
| E12 | playwright-e2e-qa: repo is clean | regression | L1 | automated | current `tests/e2e/**` after the 5 `hasPi` reasons link the tracking issue | full guard walk | zero offenders; the existing fixme assertions still pass |
| E13 | #701.3 REPORTERS typing | type check | ci | automated | `playwright.config.ts` with `ReporterDescription[]` + `["blob"] as const` | `npx tsc --noEmit --skipLibCheck --strict --module nodenext --moduleResolution nodenext --target es2022 playwright.config.ts` | exit 0, no TS2769/TS2322 |
| E14 | #701 comment: per-job timeout | EP per job | L1 | automated | `ci-e2e-browser.yml` | `jobBlock(id)` for `e2e`, `e2e-browser-relay`, `merge-report` | each block matches `^\s{4}timeout-minutes:`; a fixture YAML missing one job's timeout while another job has two fails |
| E15 | in-memory-event-buffer: image exemption (flat) | BVA (size > `DEFAULT_MAX_STRING_SIZE`) | L1 | automated | `{type:"image", data: "A".repeat(DEFAULT_MAX_STRING_SIZE * 50), mimeType:"image/jpeg"}` | `truncateStrings(obj, DEFAULT_MAX_STRING_SIZE)` | returned `data` is `===` the input string (byte-identical) |
| E16 | in-memory-event-buffer: image exemption (nested) | EP (shape) | L1 | automated | `{type:"image", source:{type:"base64", media_type:"image/png", data: <same size>}}` | `truncateStrings` | nested `data` byte-identical |
| E17 | in-memory-event-buffer: non-image string still capped | EP (control) | L1 | automated | `{data: <same size>}` without a mime sibling | `truncateStrings` | `data` capped to ≤ `DEFAULT_MAX_STRING_SIZE` + marker |
| E18 | dead-code-detection: ratchet green, never raised | regression | ci | automated | tree after cleanup | `node scripts/knip-ratchet.mjs` then `--check-baseline-diff origin/develop` | both exit 0; second prints "no baseline class was raised" |
| E19 | dox: #705 sidecars indexed | regression | ci | automated | `tests/e2e/helpers/AGENTS.md` with the two rows | `node scripts/dox-byte-gate.mjs` and `kb dox lint` | gate passes; neither `lifecycle.test.ts.AGENTS.md` nor `playwright-config.test.ts.AGENTS.md` listed under `orphan` |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | docker-test-harness: unparsable cap, lone | fault (bad input) | L1 | automated | `MEM_LIMIT=banana`, no peer | `test-up.sh` | exit 0, silent: missing data never refuses a lone harness |

---

## Coverage summary

- Requirements covered: 4/4 delta requirements + 4/4 issue items (#705, #701 ×3 + comments, #510, #416)
- Scenarios by class: edge 19 · perf 0 · frontend 0 · error 1
- Scenarios by level: L1 17 · L2 0 · L3 0 · ci 3
- Scenarios by disposition: automated 20 · manual-only 0

## New infra needed

- none (E7–E12 extend `e2e-fixme-guard.test.ts`; E1–E5/X1 extend `test-up-oversubscribe-guard.test.mjs`; E14 extends `e2e-browser-workflow-contract.test.ts`)
