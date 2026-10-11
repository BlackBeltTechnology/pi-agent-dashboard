## 1. #705 — orphaned sidecars

- [x] 1.1 Add the `__tests__/lifecycle.test.ts` and `__tests__/playwright-config.test.ts` rows (path-alphabetical, `→ see` pointers to their sidecars) to `tests/e2e/helpers/AGENTS.md`; verify `node scripts/dox-byte-gate.mjs` passes and `kb dox lint` no longer lists either path under `orphan`

## 2. #701 — harness + guard follow-ups

- [x] 2.1 `docker/test-up.sh`: compute `INSTANCES = PEER_COUNT + 1` with no peer gate, per design D2 (lone + fits → silent, lone + unreadable → silent, lone + oversize → refuse with a non-"co-resident" headline, override → one warning; peer paths unchanged); verify the extended `test-up-oversubscribe-guard.test.mjs` passes, and that every refusal case there asserts `compose up` is absent from `$FAKE_DOCKER_LOG`
- [x] 2.2 Update the `docs/faq.md` "refuse to start" entry for the lone-harness refusal and the reworded headline (delegate to DocScribe, caveman style); verify the FAQ quotes the exact new headline
- [x] 2.3 File a GitHub issue "team / identity-matrix E2E specs run in no CI leg" (citing `ci-e2e-browser.yml:112` and the sharding requirement) and add its URL to the five `hasPi` file-level skip reasons (`tests/e2e/team/team-{llm,skills,app,standalone}.spec.ts`, `tests/e2e/identity-matrix/multi-user.spec.ts`), keeping the conditions unchanged; verify `git diff` touches only the reason strings
- [x] 2.4 Extend `packages/shared/src/__tests__/e2e-fixme-guard.test.ts` with the line-start, multi-line-aware conditional `test.skip` rule (issue URL, or the whole-token id of a `ci-e2e-browser.yml` job that runs `playwright test`; never `merge-report` or a config name), per design D3; verify the guard passes on current `tests/e2e/`
- [x] 2.5 Type `REPORTERS` in `playwright.config.ts` as `ReporterDescription[]` and write the conditional entry as `[["blob"] as const]` (design D4); verify `npx tsc --noEmit --skipLibCheck --strict --module nodenext --moduleResolution nodenext --target es2022 playwright.config.ts` exits 0
- [x] 2.6 Replace the global `runs-on`/`timeout-minutes` count comparison in `e2e-browser-workflow-contract.test.ts` with a per-job assertion via an extracted `jobBlock(id)` helper (design D5); verify the test passes

## 3. #510 — knip back under its ceiling (never raise)

- [x] 3.1 Run a fresh `npx knip --reporter json`; triage each reported file into config-gap / confirmed-dead / uncertain (design D6) and record a per-class measured-vs-baseline table plus the file verdicts in the PR body
- [x] 3.2 Root the config-gap files in `knip.json`; verify `node scripts/knip-config.mjs` passes and record the before/after `files`-class delta in the PR body, proving the hand-added entries root real files
- [x] 3.3 Delete the confirmed-dead files, their tests and their `AGENTS.md` rows; verify `npm test` and `npm run build` pass
- [x] 3.4 Un-export unused exports, ordered by blast radius, and drop two of the three non-plugin duplicate aliases, updating their importers (e.g. `viewer-registry.tsx`), until `exports` ≤ 234 and `duplicates` ≤ 12 (design D6; keep plugin `registerPlugin=default`); verify `npm test` and `npm run build` pass
- [x] 3.5 Lower any class that now sits below its ceiling in `knip-baseline.json` (`measuredAt`, `_comment` naming this change), never raising one; verify `node scripts/knip-ratchet.mjs` exits 0 and `node scripts/knip-ratchet.mjs --check-baseline-diff origin/develop` prints "no baseline class was raised"
- [x] 3.6 If any class cannot reach its ceiling without deleting an uncertain file or symbol, stop: write `SHIP_IT_BLOCKED.md` naming the class and remaining overage, leave `knip-baseline.json` untouched, and leave #510 open; verify the baseline file is unchanged in `git diff` — NOT triggered: every class reached its ceiling (files 4/10, exports 231/234, types 189/193, duplicates 12/12)

## 4. #416 — keep the image exemption

- [x] 4.1 Remove the stale first comment paragraph in `walkObjectSize` (`memory-event-store.ts` ~:915), keeping both `See change:` trailers on the surviving paragraph, and update the `memory-event-store.ts` row/sidecar in `packages/server/src/persistence/AGENTS.md`; verify the remaining comment matches the real-size accounting

## 5. Tests (folded from test-plan.md)

- [x] 5.1 Extend `scripts/__tests__/test-up-oversubscribe-guard.test.mjs` (exemplar: its own existing peer cases + `scripts/__tests__/test-up-port-derivation.test.mjs`) with the lone-harness matrix: no peer, MemTotal 8 GiB, `MEM_LIMIT=8g` → exit ≠ 0, `1 × 8.0 GiB` arithmetic + override var on stderr, no "co-resident", no `compose up` in `$FAKE_DOCKER_LOG` (test-plan #E1)
- [x] 5.2 Same file: no peer, MemTotal 8 GiB, `MEM_LIMIT=4g` → exit 0, no `stabilize-browser-e2e:` stderr line, `compose up` reached (test-plan #E2)
- [x] 5.3 Same file: no peer, `MEM_LIMIT=8g`, `PI_HARNESS_ALLOW_OVERSUBSCRIBE=1` → exit 0, exactly one `oversubscribed` warning, `compose up` reached (test-plan #E3)
- [x] 5.4 Same file: no peer, `FAKE_INFO_FAIL=1` → exit 0, zero extra stderr lines (test-plan #E4)
- [x] 5.5 Same file: the existing one-peer cases {fits 16 GiB, oversize 8 GiB, override, info-fail} keep their outcomes, the refusal still names the peer and says "co-resident", and every refusal asserts no `compose up` (test-plan #E5)
- [x] 5.6 Same file: no peer, `MEM_LIMIT=banana` → exit 0, silent (test-plan #X1)
- [x] 5.7 Extend `packages/shared/src/__tests__/e2e-fixme-guard.test.ts` (exemplar: its existing `unlinkedFixmes` cases) so a column-0 `test.skip(!x, "flaky env")` is reported (test-plan #E6)
- [x] 5.8 Same file: reasons `` `e2e-browser-relay` `` accepted; `e2e flake`, `` `e2e-browser-relax` ``, `` `merge-report` ``, `playwright.team.config.ts` rejected (test-plan #E7)
- [x] 5.9 Same file: column-0 skip whose reason holds `https://github.com/o/r/issues/123` is not reported (test-plan #E8)
- [x] 5.10 Same file: two-space-indented and tab-indented `test.skip(!port, …)` are not reported (test-plan #E9)
- [x] 5.11 Same file: the multi-line `browser-relay.spec.ts:110` shape yields its reason and is accepted via `e2e-browser-relay` (test-plan #E10)
- [x] 5.12 Same file: column-0 `test.skip("title", async () => {})` is not reported (test-plan #E11)
- [x] 5.13 Same file: a full walk of current `tests/e2e/**` (after task 2.3) yields zero file-level offenders and the fixme assertions still pass (test-plan #E12)
- [x] 5.14 Strict `tsc` over `playwright.config.ts` (`npx tsc --noEmit --skipLibCheck --strict --module nodenext --moduleResolution nodenext --target es2022 playwright.config.ts`) exits 0 with no TS2769/TS2322; record it in the PR body (exemplar: the ship-it enforcer command list) (test-plan #E13)
- [x] 5.15 Extend `packages/shared/src/__tests__/e2e-browser-workflow-contract.test.ts` (exemplar: its relay `describe` `job` slice) so `jobBlock(id)` asserts `timeout-minutes` for `e2e`, `e2e-browser-relay` and `merge-report` individually, and an inline fixture YAML where one job lacks a timeout while another has two fails (test-plan #E14)
- [x] 5.16 Add to `packages/server/src/__tests__/memory-event-store.test.ts` (exemplar: its existing truncation cases): flat `{type:"image", data: "A".repeat(DEFAULT_MAX_STRING_SIZE * 50), mimeType:"image/jpeg"}` → `truncateStrings` returns `data` `===` input (test-plan #E15)
- [x] 5.17 Same file: nested `{type:"image", source:{type:"base64", media_type:"image/png", data:<same>}}` → nested `data` byte-identical (test-plan #E16)
- [x] 5.18 Same file: `{data:<same>}` with no mime sibling → capped to ≤ `DEFAULT_MAX_STRING_SIZE` plus marker (test-plan #E17)
- [x] 5.19 `node scripts/knip-ratchet.mjs` and `node scripts/knip-ratchet.mjs --check-baseline-diff origin/develop` both exit 0, the second printing "no baseline class was raised" (exemplar: the nightly `knip` job steps in `.github/workflows/nightly.yml`) (test-plan #E18)
- [x] 5.20 `node scripts/dox-byte-gate.mjs` passes and `kb dox lint` lists neither `lifecycle.test.ts.AGENTS.md` nor `playwright-config.test.ts.AGENTS.md` under `orphan` (exemplar: the ship-it enforcer step) (test-plan #E19)

## 6. Close-out

- [x] 6.1 After merge, comment on and close #705 (noting that its literal fix is superseded by the landed `helpers/AGENTS.md` split), #701, #416 (verified reachable rather than dead) and, unless task 3.6 fired, #510; verify each shows `CLOSED` — comments posted at ship time; closed at merge via the PR's `Closes` keywords
