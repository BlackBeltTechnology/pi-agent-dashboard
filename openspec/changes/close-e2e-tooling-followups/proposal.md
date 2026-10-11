## Why

Four small follow-up issues (#705, #701, #510, #416) are still open after their
parent changes shipped. Each leaves a gate or guard that is either red, missing,
or documenting the wrong thing:

- the nightly knip ratchet fails today (files 15 > 10, exports 245 > 234,
  duplicates 14 > 12), so the dead-code oracle reports noise instead of regressions;
- `docker/test-up.sh` admits a lone harness whose `MEM_LIMIT` already exceeds
  the daemon, contradicting the `docker-test-harness` admission requirement's arithmetic;
- a file-level conditional `test.skip` can silently drop a whole spec file from
  every shard, a hole the `fixme` guard was built to close;
- two `AGENTS.md` sidecars are orphaned, and one load-bearing truncation
  exemption is tracked as "dead code" for deletion.

Bundling them clears four tracker items with one review, one harness run and one
ship. #510 closes only if every knip class fits its existing ceiling (design D6);
otherwise that part hands back without touching the baseline.

## What Changes

- **#705 — orphaned sidecars.** Add the `__tests__/lifecycle.test.ts` and
  `__tests__/playwright-config.test.ts` rows to `tests/e2e/helpers/AGENTS.md`
  (the split file already exists; `tests/e2e/AGENTS.md` sits at 29 997 / 30 000
  bytes and gains nothing).
- **#701.1 — lone-harness memory check.** `test-up.sh` runs the
  `(others + 1) × MEM_LIMIT` arithmetic even when no peer harness is up. A lone
  harness that does not fit is refused (override still honoured). A lone harness that fits
  stays silent, and so does one whose memory cannot be read. The refusal headline no longer says
  "co-resident" when the caller is alone; `docs/faq.md` is updated to match.
- **#701.2 — file-level skip guard.** The e2e quarantine repo-lint additionally
  rejects a top-level (file-scope) conditional `test.skip` whose reason names
  neither an issue URL nor a spec-running CI job. Indented runtime guards
  (`test.skip(!port, …)`) stay allowed. The five existing `hasPi` file-level skips
  under `tests/e2e/team/` and `tests/e2e/identity-matrix/` run in no CI leg today.
  A tracking issue is filed for that gap, and their reasons link it (conditions unchanged).
- **#701.3 — `REPORTERS` typing.** Reproduced: a strict `tsc` over
  `playwright.config.ts` fails with TS2769 (the file is outside every tsconfig
  `include`, so CI never saw it). Annotate `REPORTERS` as `ReporterDescription[]`
  and pin the conditional `blob` entry as a const tuple.
- **#701 comments — test hardening.** The browser-E2E workflow contract test
  asserts `timeout-minutes` per job instead of a global count comparison. The
  oversubscription guard test proves `compose up` is never reached on refusal.
- **#510 — knip back under its ceiling.** Root real entry points that knip
  misses (config gaps), delete files that are confirmed dead, and un-export the
  ~11 exports and 2 duplicate aliases added since the baseline. Every class then
  sits at or below `knip-baseline.json`. No class is raised: the
  `dead-code-detection` ratchet forbids that and the enforcer has no override.
  A class that lands below its ceiling is lowered. knip stays nightly-only (no
  `ci.yml` gate; that placement is a standing decision in `nightly.yml`).
- **#416 — not dead code.** The `truncateStrings` `data`+`mimeType` exemption is
  reachable and spec-required (`in-memory-event-buffer`, "Image data preservation
  during truncation"). Display-fitted derivatives (≤ ~212 KB base64) are stored
  inline, and the default 4 000-byte string cap would otherwise corrupt them.
  `capContentBlocks` and `isImageBlock` are already gone (#838). Correct the stale
  `walkObjectSize` comment, pin the exemption with a test, and close #416 as resolved.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `docker-test-harness`: the memory-admission requirement ("A second harness on
  the same daemon is admitted only within the daemon's memory") applies to a lone harness too —
  the "lone harness prints nothing extra" scenario is narrowed to a harness that fits.
- `playwright-e2e-qa`: the quarantine requirement ("A red spec with a filed
  product bug is quarantined, not left red") extends its repo-lint guard to file-level conditional `test.skip`.

## Impact

- `docker/test-up.sh`, `scripts/__tests__/test-up-oversubscribe-guard.test.mjs`, `docs/faq.md`
- `packages/shared/src/__tests__/e2e-fixme-guard.test.ts`,
  `packages/shared/src/__tests__/e2e-browser-workflow-contract.test.ts`
- `playwright.config.ts` (type annotation only)
- `knip.json` (config-gap entries: playwright global setup/teardown,
  `packages/deck3d/fixtures` build scripts), `knip-baseline.json` (lowered only),
  the files knip confirms dead, and unused exports (candidates across
  `packages/client`, `packages/server`, `packages/electron`, `packages/flows-plugin`, `tests/e2e`)
- `tests/e2e/team/*.spec.ts`, `tests/e2e/identity-matrix/multi-user.spec.ts` (skip reason text only)
- `packages/server/src/persistence/memory-event-store.ts` (comment only) + its tests
- `tests/e2e/helpers/AGENTS.md`
- No product runtime change. One new tooling refusal: a lone `test-up.sh` whose
  `MEM_LIMIT` does not fit the daemon. `PI_HARNESS_ALLOW_OVERSUBSCRIBE=1` overrides it,
  and the FAQ documents it. No migration. Rollback: revert the commit.

## Discipline Skills

None of the `eng-disciplines` checkpoints apply. The change touches no auth,
secrets, PII, untrusted input, latency budget, new endpoint/job/external call or
irreversible step. File deletions under #510 are reversible by revert.
`review-code` runs at the standard pre-commit checkpoint.
