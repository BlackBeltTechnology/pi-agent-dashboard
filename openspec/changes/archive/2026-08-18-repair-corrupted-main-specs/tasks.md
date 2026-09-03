# Tasks — repair-corrupted-main-specs

Census as of re-check: `openspec validate --specs --no-interactive` →
`466 passed, 80 failed (546 items)`. No count below is load-bearing; the
acceptance criterion is the validator exiting zero.

## 1. Baseline and review gates

- [x] 1.1 Record the pre-change baseline: run `openspec validate --specs --no-interactive`, save the failing capability list and the per-cohort counts to the change dir as evidence for the after/before comparison
- [x] 1.2 Invoke `doubt-driven-review` on the two irreversible decisions before any file is written: deleting the three retired specs (D4) and refusing rather than dropping `REMOVED` blocks (D3) — **outcome:** D4 split; `openspec-polling` + `session-history-sync` carry authored `**DEPRECATED**` pointers and are tombstoned, only `event-persistence` is deleted; artifacts updated
- [x] 1.3 Invoke `scenario-design` against `specs/openspec-spec-integrity/spec.md` to confirm the trap scenarios (multi-delta, REMOVED, masked phase-two error, idempotence) are covered before the script exists — **gap found and closed:** cohort E (delta header *after* an existing `## Requirements`) would be mis-promoted by the first-delta rule; added a scenario requiring deletion in that case

## 2. Repair tool — tests first

- [x] 2.1 Write the test fixture set under a temp dir: one single-delta spec, one two-delta spec, one suffixed-delta spec (`## ADDED Requirements — Tool Modules`), one no-delta/no-Purpose spec, one `REMOVED` spec, one cohort-E spec (valid `## Requirements` then a later delta header), one already-conforming spec
- [x] 2.2 Write failing tests asserting: first delta header promoted to `## Requirements`, every subsequent delta header **deleted**, exactly one `## Requirements` section survives
- [x] 2.3 Write a failing test asserting requirement-count equality — `openspec show <cap> --json` count equals the file's `### Requirement:` count — for the two-delta fixture (this is the assertion that catches a green-but-empty repair)
- [x] 2.4 Write a failing test asserting a `REMOVED` spec exits non-zero, is named on stderr, and is left byte-identical
- [x] 2.5 Write a failing test asserting idempotence: a second run modifies zero files and leaves `git diff` empty, with no duplicated `## Purpose` or h1
- [x] 2.6 Write a failing test asserting the cohort-E fixture has its trailing delta header deleted (not promoted) and gains no second `## Requirements`
- [x] 2.7 Write a failing test asserting two-phase validation: a spec whose repaired Purpose reveals a delta-header defect reports that revealed error in the same run and exits non-zero

## 3. Repair tool — implementation

- [x] 3.1 Implement `scripts/repair-main-specs.mjs`: discover non-conforming specs under `openspec/specs/**` at runtime (no hard-coded list)
- [x] 3.2 Implement delta-header handling — promote first, delete all subsequent, matching suffixed headers
- [x] 3.3 Implement `## Purpose` insertion with a `TODO(repair):`-marked body, and `# <name> Specification` h1 insertion when absent
- [x] 3.4 Implement the `REMOVED` refusal path (no-op write, stderr name, non-zero exit)
- [x] 3.5 Implement the post-write re-validation pass and make the exit code reflect the final validation state
- [x] 3.6 Make every test from section 2 pass; run the tool `--dry-run` over the real tree and eyeball the planned edit for three sampled specs before writing anything

## 4. Structural repair of the tree

- [x] 4.1 Run the tool over `openspec/specs/**`; confirm it refuses only `event-persistence` and repairs the rest
- [x] 4.2 Verify the four multi-delta specs individually — `app-decomposition`, `browser-gateway-decomposition`, `command-executor`, `auto-shutdown` — each has exactly one `## Requirements` and its `openspec show` count matches its `### Requirement:` count
- [x] 4.3 Run the tool a second time; assert zero files modified and empty `git diff` (idempotence on real data, not just fixtures)
- [x] 4.4 ~~Hand-fix~~ `interactive-renderers` — **no hand-fix needed**: the tool's cohort-E rule (delete a delta header that follows an existing `## Requirements`) handled it; spec now reports 5 requirements

## 5. Retired capability disposition

- [x] 5.1 Verify successors exist and carry the behaviour: `server-openspec-polling` (19 reqs), `server-session-reader` (3), `in-memory-event-buffer` (11), `json-file-persistence` (1), `on-demand-session-replay` (8) — all live
- [x] 5.2 Confirm each is fully retired — `event-persistence` has 9 `### Requirement:` and 9 `**Reason**:`; the other two carry zero requirements
- [x] 5.3 Delete `openspec/specs/event-persistence/` and confirm `openspec validate --specs` no longer reports it
- [x] 5.4 Tombstone `openspec-polling` and `session-history-sync`: keep the authored `**DEPRECATED**` Purpose, add `## Requirements` with exactly one requirement recording the retirement and naming the successor, plus a scenario; confirm both validate
- [x] 5.5 Grep the repo for references to `event-persistence` and fix or note any dangling pointer (the two tombstoned names keep working)

## 6. Purpose authoring (~71 specs)

- [x] 6.1 Author real Purposes for the cohort-A specs with the largest requirement sets first (`openspec-folder-section`, `interactive-ui-dialogs`, `mobile-resilience`, `token-stats-bar`, `terminal-emulator`, `marketing-site`, `command-executor`, `openspec-archive-browser`), each derived from that spec's own requirement text
- [x] 6.2 Author Purposes for the remaining cohort-A specs
- [x] 6.3 Author Purposes for cohort B — `extension-ui-forwarding`, `known-servers`, `oauth-callback-server`, `dialog-portal`, `server-side-event-processing`, `hide-debug-events`, `mdns-discovery`
- [x] 6.4 Author Purposes for cohort D — `spawn-error-persistence`, `pending-prompt-safety`, `pwa-install-prompt`, `repo-hygiene`
- [x] 6.5 Assert no scaffold survives: `grep -r 'TODO(repair):' openspec/specs/` returns no matches
- [x] 6.6 Spot-check 10 authored Purposes for generic filler ("this capability handles X"); rewrite any that do not say what the capability is actually for

## 7. CI gate

- [x] 7.1 Confirm the tree is already clean — `openspec validate --specs --no-interactive` exits zero — before adding the gate, so `develop` never goes red mid-change
- [x] 7.2 Add `npm run spec:validate` to `package.json` invoking `openspec validate --specs --no-interactive`
- [x] 7.3 Add the spec-integrity step to the existing `ci` job in `.github/workflows/ci.yml`, reusing its checkout and `pnpm install --frozen-lockfile`; do not add a new job or a new required status check
- [x] 7.4 Measure the step's wall time on 546 specs — **3.6s**, immaterial; no `--concurrency` tuning applied
- [x] 7.5 Prove the gate has teeth: temporarily corrupt one spec locally, confirm `npm run spec:validate` fails and names the capability, then revert

## 8. Verification and documentation

- [x] 8.1 Invoke `review-code` on `scripts/repair-main-specs.mjs` — **finding:** the `\n{3,}` blank-run collapse ran over fenced code blocks (latent requirement-text mutation, breaching the change's own non-goal). Verified 0 fences altered in this run, then made the collapse fence-aware + 2 tests
- [x] 8.2 Compare against the 1.1 baseline — `evidence/after.md`: 80 failing → 0; 384 requirement blocks recovered; 3706 now visible across 544 specs
- [x] 8.3 Added the `scripts/repair-main-specs.mjs` row to `scripts/AGENTS.md`; DocScribe wrote the `docs/architecture.md` "OpenSpec main-spec integrity" section + the `extension-ui-forwarding` correction, and its sidecar row was applied to `docs/architecture.md.AGENTS.md`
- [x] 8.4 Recorded in the proposal's Impact section: `openspec-archive-change` / `ship-change` should run `npm run spec:validate` before pushing (~3.6s over 544 specs)
- [x] 8.5 `openspec validate repair-corrupted-main-specs --strict` valid; `npm run spec:validate` 544/544. Full suite: 14591 passed, 9 failed — 1 was mine (`check-conventions.mjs` ENOENT on a git-tracked-but-deleted file, **fixed**), the other 8 reproduce on a clean tree (kb corpus, 4 extension, knip-config, skill-frontmatter budget)
