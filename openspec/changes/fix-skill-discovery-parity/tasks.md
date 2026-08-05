## 1. Discovery from pi's resolver

- [ ] 1.1 Add failing tests: given a stubbed `ResolvedPaths`, the scan result contains one skill per resolved entry, carrying the resolved path as `filePath`
- [ ] 1.2 Add failing tests that `metadata.scope` yields a `local`/`global` card attribute and `metadata.origin` yields package provenance — attributes, not sections
- [ ] 1.2a Add failing tests for the mapping edge cases: `temporary` scope maps to `local`; an unmatched `metadata.source` is still reported and labelled with the raw source; a manifest-excluded resource is simply absent
- [ ] 1.3 Add a failing test that `enabled: false` is reported as disabled without a second activation derivation
- [ ] 1.4 Add a failing test that themes from `ResolvedPaths.themes` are reported
- [ ] 1.5 Rewire `scanPiResources()` in `packages/server/src/pi/pi-resource-scanner.ts` to build skills, prompts, and themes from the `ResolvedPaths` it already fetches, instead of the hand-rolled walk
- [ ] 1.6 Extend `PiResourceScope` and the shared resource types with `themes`, keeping `agents` and `extensions` scanner-discovered and their arrays intact
- [ ] 1.6a Add a failing test that `agents` and `extensions` are still discovered by the scanner after the rewire
- [ ] 1.7 Run `npm test 2>&1 | tee /tmp/pi-test.log` and confirm 1.1–1.4 pass

## 2. Load gate and degraded fallback

- [ ] 2.1 Add failing tests that a resolved path with missing, blank, or unparseable frontmatter `description` is not reported as a skill, and that the scan still completes
- [ ] 2.2 Add a failing test that a resolved bare `.md` with a real `description` IS reported as a skill
- [ ] 2.3 Add a failing test that `name` falls back to the containing directory basename
- [ ] 2.4 Add failing tests for degraded mode: `resolveActivation()` returning `null`, and returning successfully-empty while the fallback walk finds resources — both mark the result degraded
- [ ] 2.4a Add a failing test that the prompt "first non-empty line" description fallback survives the rewire for resolver-sourced prompts
- [ ] 2.5 Implement the description gate on resolved paths and the degraded marker; retain `discoverSkills()` as the fallback path only
- [ ] 2.6 Run the suite and confirm 2.1–2.4 pass
- [ ] 2.7 Restart the server and confirm the Resources view shows no `UPSTREAM.md`, `dox-doctrine.md`, `AGENTS.md`, or `SKILL.md.AGENTS.md` entries

## 3. Bridge: fill in CommandInfo.path

- [ ] 3.1 Add a failing bridge test that a `source: "skill"` command carries `path` populated from pi's `sourceInfo.path`
- [ ] 3.2 Add a failing test that a command with no `sourceInfo` is sent with `path` absent and does not throw
- [ ] 3.3 Map `sourceInfo.path` onto `CommandInfo.path` inside `filterHiddenCommands()` in `packages/extension/src/bridge-context.ts`, tolerating absence
- [ ] 3.4 Add a failing test asserting all five senders carry the path: `session-sync.ts` register and spawn, `flow-event-wiring.ts`, `bridge.ts` `session_start`, and `command-handler.ts` `request_commands`
- [ ] 3.5 Run `npm run reload`, then trigger a flow rediscovery and a `request_commands`, confirming skill paths survive each

## 4. Server: retain commands_list and join

- [ ] 4.1 Add failing tests that the server retains the latest `commands_list` per session and replaces it on re-report
- [ ] 4.2 Add failing tests for the join producing `active`, `not-loaded`, and `loaded-elsewhere`
- [ ] 4.3 Add a failing test that a resolved path and a live path sharing a realpath but differing textually join as `active`
- [ ] 4.4 Add a failing test that two resolved skills sharing a name at different paths remain distinct entries in the payload
- [ ] 4.5 Add a failing test that no retained list yields scan-only with no `not-loaded` labels, and that a transient skill-less list does not displace a populated one
- [ ] 4.6 Add a failing test that a resolved skill with `enabled: false` is reported disabled via precedence, whether or not it appears in the retained commands
- [ ] 4.6a Add a failing test that two or more reporting sessions for one folder yield scan-only rather than last-writer-wins
- [ ] 4.6b Add a failing test that a retained skill list carrying no `path` values is reported as such instead of flipping every skill to `not-loaded`
- [ ] 4.7 Implement retention, the canonicalized join, and the extended resources payload including the contributing session and its working directory when exactly one session has reported
- [ ] 4.8 Run the suite and confirm 4.1–4.6 pass

## 5. Client: provenance and states

- [ ] 5.1 Render provenance as a per-card badge for `loaded-elsewhere` and `not-loaded`, and no badge for `active`
- [ ] 5.2 Show the session-reported path on a `loaded-elsewhere` card, keeping every card in the one flat grid with no new section, group, or chevron
- [ ] 5.3 Add provenance as a filter value on the existing grid filter
- [ ] 5.4 Show the contributing session's working directory when it differs from the scanned folder
- [ ] 5.5 Render scan-only and degraded states explicitly, with no `not-loaded` badges in either
- [ ] 5.6 Confirm the existing Themes type page renders resolver-sourced themes; no new theme UI is required
- [ ] 5.7 Add component tests for each provenance badge, the filter, scan-only, and degraded
- [ ] 5.8 Run `npm run build && curl -X POST http://localhost:8000/api/restart` and verify each state in a browser

## 6. Guard and CI

- [ ] 6.1 Convert `scripts/__tests__/skill-frontmatter.test.mjs` from a pass/fail vitest test into a script emitting structured findings with severity and source label
- [ ] 6.2 Make missing or empty `description` an error, and pi's 1024/64/charset/hyphen checks warnings
- [ ] 6.3 Add the 400-character repository budget as a warning reported distinctly from pi's limits, labelling each finding pi-sourced or repository-sourced
- [ ] 6.4 Exempt `ship-change`, `frontend-mockup-loop`, and `anti-slop-frontend` from the budget, per the shipped requirement locking their description wording
- [ ] 6.5 Add guard tests covering each severity, each source label, and the wording-locked exemption
- [ ] 6.6 Add a CI job invoking the guard script so errors block the pull request and warnings do not
- [ ] 6.7 Trim the over-budget descriptions excluding the three exempt skills, preserving trigger phrasing and moving rationale into skill bodies
- [ ] 6.8 Re-run the guard and confirm zero errors and no budget warnings outside the exempt three

## 7. Validate

- [ ] 7.1 Run the full suite via `npm test 2>&1 | tee /tmp/pi-test.log` and confirm no failures
- [ ] 7.2 Confirm the resolver-derived skill count matches pi's for this workspace and contains no phantom entries
- [ ] 7.3 Confirm the 22 runtime-registered hermes skills appear as `loaded-elsewhere`
- [ ] 7.4 Confirm `agents` and `extensions` still render, and that the Agents page in Directory Settings is unaffected
- [ ] 7.5 Confirm a package whose manifest excludes one of its own resources renders without a phantom disabled entry
- [ ] 7.6 Confirm skill and prompt discovery code in `pi-resource-scanner.ts` is smaller than before, with the fallback path the only retained walker
- [ ] 7.7 Run `openspec validate fix-skill-discovery-parity --type change` and confirm it passes

## 8. Tests — folded from test-plan.md

Harness exemplars: L1 server → `packages/server/src/__tests__/pi-resource-scanner.test.ts`; L1 bridge → `packages/extension/src/__tests__/session-sync.test.ts`; L1 client → `packages/client/src/components/__tests__/ResourceCardGrid.test.tsx`; L2 → `qa/tests/02-server-start.sh`; L3 → `tests/e2e/change-summary-table.spec.ts` (harness port from `.pi-test-harness.json` `dashboardPort`, never hardcoded).

- [ ] 8.1 L1: stubbed `ResolvedPaths` of 3 skills/1 prompt/1 theme · `scanPiResources()` runs · exactly 3/1/1 returned and no filesystem walk invoked — see `pi-resource-scanner.test.ts` (test-plan #E1)
- [ ] 8.2 L1: entries across scope {project,user,temporary} × origin {top-level,package} · scan assembles · badges map local/global/local and package provenance set iff origin=package — see `pi-resource-scanner.test.ts` (test-plan #E2, #E3)
- [ ] 8.3 L1: package-origin entry with `metadata.source: "npm:foo@1.2.3"` and no matching package row · scan assembles · entry present, labelled with the raw string, not dropped — see `pi-resource-scanner.test.ts` (test-plan #E4)
- [ ] 8.4 L1: package manifest excluding one of its own skills · scan assembles · skill absent entirely, no disabled placeholder synthesised — see `pi-resource-scanner.test.ts` (test-plan #E5)
- [ ] 8.5 L1: descriptions `""`, `"   "`, `"x"` · scan assembles · first two not reported as skills, third reported — see `pi-resource-scanner.test.ts` (test-plan #E6, #E7, #E8)
- [ ] 8.6 L1: the repo's own `.pi/skills/AGENTS.md` with no frontmatter · scan assembles · absent from skills and from any not-loaded list — see `pi-resource-scanner.test.ts` (test-plan #E9)
- [ ] 8.7 L1: `SKILL.md` with description and no `name` in dir `foo-bar/` · scan assembles · reported name is `foo-bar` — see `pi-resource-scanner.test.ts` (test-plan #E10)
- [ ] 8.8 L1: descriptions of 400/401/1024/1025 chars · guard script runs · 400 clean, 401 repo-budget warning, 1025 repo + pi-limit warning, exit 0 throughout — see `pi-resource-scanner.test.ts` for vitest shape (test-plan #E11)
- [ ] 8.9 L1: names of 64 and 65 chars · guard runs · 64 clean, 65 pi-limit warning, exit 0 — (test-plan #E12)
- [ ] 8.10 L1: repos with warnings-only / one missing description / both · guard runs · exit 0, non-zero, non-zero — (test-plan #E13)
- [ ] 8.11 L1: `ship-change`, `frontend-mockup-loop`, `anti-slop-frontend` · guard runs · no budget warning and description bytes unchanged from HEAD — (test-plan #E14)
- [ ] 8.12 L1: resolved × live matrix · server joins · yes/yes active, yes/no not-loaded, no/yes loaded-elsewhere, no/no absent — see `resource-activation-routes.test.ts` (test-plan #E15)
- [ ] 8.13 L1: resolved `enabled:false` with live present and absent · server joins · both report disabled, never not-loaded — (test-plan #E16)
- [ ] 8.14 L1: two resolved skills named `release-revoke` at different real paths · server joins · two distinct entries, not merged by name — (test-plan #E17)
- [ ] 8.15 L2: resources refresh across 10 known directories · one poll cycle · p95 within the C1 threshold and `resolve()` bounded by the C1 timeout — see `qa/tests/02-server-start.sh`; BLOCKED on test-plan C1 (test-plan #P1)
- [ ] 8.16 L1: one `scanPiResources()` invocation · scan runs · `resolveActivation()` called exactly once — (test-plan #P2)
- [ ] 8.17 L3: payload with one skill of each status · skills page renders · active has no provenance badge, not-loaded and loaded-elsewhere each carry theirs — see `tests/e2e/change-summary-table.spec.ts` (test-plan #F1)
- [ ] 8.18 L3: payload mixing all three statuses · page renders · exactly one grid container, zero provenance-introduced section headers, group headers or chevrons — (test-plan #F2)
- [ ] 8.19 L3: grid of 3 active / 2 not-loaded / 1 loaded-elsewhere · user selects the loaded-elsewhere filter · grid converges to exactly 1 card — (test-plan #F3)
- [ ] 8.20 L3: hermes skill reported at `~/.pi/agent/pi-hermes-memory/skills/x/SKILL.md` · page renders · card displays that path — (test-plan #F4)
- [ ] 8.21 L3: folder with no reporting session · page renders · scan-only notice present and zero not-loaded badges — (test-plan #F5)
- [ ] 8.22 L3: server with `resolveActivation()` forced to `null` · page renders · degraded notice present and zero not-loaded badges — (test-plan #F6)
- [ ] 8.23 L3: folder rendering scan-only, then a session registers · `commands_list` arrives · grid converges to per-card provenance with no manual refresh — (test-plan #F7)
- [ ] 8.24 L3: session whose cwd is a worktree of the folder, with a not-loaded skill · page renders · differing working directory shown on/near that card — (test-plan #F8)
- [ ] 8.25 L3: workspace with `.pi/agents/*.md` · Directory Settings Agents page renders · agents still listed after the rewire — (test-plan #F9)
- [ ] 8.26 L3: workspace with a package declaring `pi.themes` · Themes page renders · theme appears and no new theme UI is introduced — (test-plan #F10)
- [ ] 8.27 L1: `resolveActivation()` throws · `scanPiResources()` runs · fallback results returned, payload marked degraded, no exception escapes — (test-plan #X1)
- [ ] 8.28 L1: `resolveActivation()` returns all-empty while the fallback finds ≥1 skill · scan assembles · payload marked degraded, not an authoritative empty list — (test-plan #X2)
- [ ] 8.29 L1: retained `commands_list` whose skill entries all lack `path` · server joins · condition reported, not every resolved skill flipped to not-loaded — (test-plan #X3)
- [ ] 8.30 L1: session with a populated retained set · a skill-less `commands_list` arrives mid-reload · retained set not emptied per the C2 settling rule — BLOCKED on test-plan C2 (test-plan #X4)
- [ ] 8.31 L1: two sessions attached to one folder, both reporting · payload built · scan-only, no not-loaded labels, no last-writer-wins — (test-plan #X5)
- [ ] 8.32 L1: commands emitted via register, spawn, flow-rediscover, `session_start`, `request_commands` · each sender fires · all five carry `path` on skill entries — see `session-sync.test.ts` (test-plan #X6)
- [ ] 8.33 L3: session with correct provenance rendered · user triggers `/reload` then a flow rediscovery · provenance remains correct, no mass flip to not-loaded — (test-plan #X7)
- [ ] 8.34 L1: command object with no `sourceInfo` · `filterHiddenCommands()` runs · entry emitted with `path` absent and no throw — see `session-sync.test.ts` (test-plan #X8)
- [ ] 8.35 L1: resolver-sourced prompt `.md` with no frontmatter · scan assembles · description is the first non-empty line — (test-plan #X9)
- [ ] 8.36 L2: a skill that reads `references/*.md` · invoked in a live session · companion file read successfully — see `qa/tests/02-server-start.sh` (test-plan #X10)
- [ ] 8.37 L2: a command under `pi-dashboard/commands/` · invoked · resolves and executes — (test-plan #X11)
- [ ] 8.38 Manual: inspect provenance badge legibility across studio/earth/athlete/gradient themes, confirming badges read clearly and are not confused with the existing scope and package badges (test-plan: manual-only)

## 9. Discipline checkpoints

- [ ] 9.1 Run `doubt-driven-review` on the join semantics before the server change stands
- [ ] 9.2 Run `code-simplification` on the fallback path, the part most likely to accrete complexity
- [ ] 9.3 Run `review-code` on the full diff before commit
