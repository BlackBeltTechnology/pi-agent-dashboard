## Why

Two defects in the CodeQL ratchet's evidence trail, both left open by `triage-codeql-alert-debt` (archive `2026-10-24-triage-codeql-alert-debt`).

**#1062: the stated basis of 33 `operator-authz` baseline entries is false for `observe`-tier routes.** Every `operator-authz` reason in `codeql-baseline.json` (and the matching GitHub dismissal comment, 38 alerts) reads "Operator API behind the universal network guard (createNetworkGuardHook); an admitted caller can already spawn shell-capable sessions." Spawn is `control` tier (`packages/shared/src/route-tiers.ts:489`). A device or session credential capped at `observe` can call the `observe` GET routes (browse, file, folder-project, changelog) but cannot spawn, so for those sinks the real bound is the per-sink gate (`isWithinBrowseRoots`, `admitCwd`, `containmentAllows`, `isValidNpmPackageName`). The dismissals hold; the recorded reason is wrong, and the `ship-it` skill hands the same sentence out as the `operator-authz` preset (`.pi/skills/ship-it/SKILL.md:279`), so it keeps spreading.

**#1059: production plugin-server code is invisible to both analyses.** The shared `paths-ignore` `**/__tests__/**` removes the only resolvable `Fastify()` → registrar call path (test harnesses), so plugin route handlers stop being HTTP sources. At HEAD the hidden set is 20 production results (18 `path-injection`/`tainted-format-string`, 2 `missing-rate-limiting`), not the 29 recorded in 2026-10-17 (`evidence/spike-hidden-results.md`). The issue's framing is partly wrong: the results are NOT in `__tests__` files, and un-ignoring tests would add 38 test-fixture results of pure noise. `docs/code-quality.md` "Known limitation" cause 2 stays open.

## What Changes

- **#1062 — reword per file.** For each of the 33 entries, cite the gate that bounds the sink as `gate: <symbol> <repo-path>:<line>`, first in the reason so GitHub's 280-char cut never drops it (table: `evidence/gate-table.md`). Entries in the three control-only files with no per-sink gate (`git-operations.ts`, `process-manager.ts`, `spawn-preflight.ts`) say `control-tier: <basis>`. Two entries that are not request sinks become `false-positive:` (`keeper-manager.ts`, #244, not request-reachable; `path-containment.ts`, #100, the containment primitive). The canned universal-guard sentence is banned. Every GitHub `dismissed_reason` is unchanged.
- Update the dismissal comment of the 33 alerts that map to a baseline entry (`PATCH …/code-scanning/alerts/<n>`, reason unchanged) from one reviewed table, canary and dry-run first. The 5 alerts that map to no entry (#128 #129 #136 #137 #138, no result at HEAD) are left as historical records: their analysed code no longer exists, so new gate text would be invented.
- Fix the source of the wrong text: the `ship-it` step 4.4b `operator-authz` preset becomes a template that asks for the gate; a contract test checks every committed `operator-authz` reason.
- **#1059 — anchor (decided 2026-11-03 by owner, design D2).** Keep ignoring tests (documented as intentional). Add a non-test analysis anchor `scripts/codeql-anchor/plugin-routes.mjs` that gives a real `Fastify()` to the five plugin registrars measured hidden at HEAD (automation, team, goal, blackhole, roles), with an explicit allowlist and a contract test of the anchor's imports. Both analyses read the same file. It must first prove it recovers results in CI (no `node_modules`); if CI recovers 0, the anchor part is dropped and #1059 stays open (design D2 fallback).
- Triage the recovered results (spike: 18) before the anchor lands: fix, or `false-positive:` / `accepted-risk:` with a gate cite (team-plugin `TeamPaths.confine`; automation `run-store.ts` `isSafeRunId`; goal-plugin `console.warn` template string is a real format-string defect). The `automation-writer.ts` results are NOT dismissed: the browser `plugin_action` `create` handler passes an unadmitted `payload.cwd` to `writeAutomation` (finding F1, design Risks). F1 is filed as #1104 (task 3.7 references it); this change does not fix it.
- Post-merge dismissal, `--mirror-dismissal` and the local-vs-GitHub parity record are tracked on #1059, which this change only references.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `codeql-local-ratchet`: ADDED "operator-authz reasons cite their bounding gate" (committed-baseline invariant, enforced by a contract test, not by script grammar) and ADDED "Plugin server route modules are analysed through an anchor" (bounded allowlist). The existing "CI and local CodeQL share one configuration" requirement stays true (the ignore list is unchanged).

## Impact

- `codeql-baseline.json` (33 reasons reworded or reclassified, + entries for the recovered plugin results), `.pi/skills/ship-it/SKILL.md` (§4.4b preset text), `packages/shared/src/__tests__/ship-it-codeql-wiring.test.ts` (preset), new `packages/shared/src/__tests__/codeql-baseline-gates.test.ts` and `codeql-anchor-contract.test.ts`, new `scripts/codeql-anchor/plugin-routes.mjs` (+ `scripts/AGENTS.md` row; knip ignore only if it flags the `fastify` import).
- Fix sites for real findings: `packages/goal-plugin/src/server/routes.ts:345` (format string); others only if triage finds a true positive.
- `docs/code-quality.md` ("Known limitation — local ≠ GitHub" cause 2, parity numbers, intentional test exclusion) written through DocScribe; AGENTS rows for touched files.
- GitHub: 33 dismissal comments edited; ~18 new alerts to dismiss after merge (tracked on #1059). No runtime or API change; no migration.
- Rollback: revert the commit (baseline reasons, anchor, tests, skill text). Comment edits are cosmetic; old text is logged in `evidence/comment-sync.md`. New alerts opened by the anchor can be dismissed or the anchor removed; nothing else depends on it.

## Discipline Skills

- `security-hardening`: per-sink gate verification for the 33 entries, triage of the recovered plugin results (path-injection, format string), the `goal-plugin` fix.
- `doubt-driven-review`: before the GitHub comment edit (public, hard to undo cleanly) and before the post-merge bulk dismissal of the anchor's new alerts (on #1059).
- `review-code`: before commit.

Fixes #1062
Refs #1059
