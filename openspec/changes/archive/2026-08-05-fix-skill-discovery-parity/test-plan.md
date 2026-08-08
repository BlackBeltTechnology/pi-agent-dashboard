# Test Plan — fix-skill-discovery-parity

Stage: apply   Generated: 2026-08-04

## ⚠ Clarifications (3) — C1, C2 RESOLVED

- [x] **C1** — RESOLVED. `GET /api/pi-resources` p95 ≤ 5s on a warm cache; `resolve()` bounded by a 5s timeout (timeout expiry → degraded fallback, per X1).
- [x] **C2** — RESOLVED. Settling rule: **never replace a non-empty retained skill set with an empty one**. No time window; an empty `commands_list` is ignored whenever the retained set is non-empty.
- [ ] **X3 observable is partial.** The join warns when retained skill commands carry no joinable path. Where does that warning surface — server log only, or the degraded/scan-only marker in the payload? Recorded inline on the row rather than blocking, since the row is testable at the log level today.

> C1 and C2 resolved; P1 and X4 are unblocked.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | Skills sourced from resolver | EP | L1 | automated | stubbed `ResolvedPaths` with 3 skills, 1 prompt, 1 theme | `scanPiResources()` runs | result carries exactly 3 skills, 1 prompt, 1 theme; no filesystem walk invoked |
| E2 | Scope/origin become attributes | decision-table | L1 | automated | entries with scope ∈ {`project`,`user`,`temporary`} × origin ∈ {`top-level`,`package`} | scan assembles | 6 combinations map to: local/local/global/global/local/local badges, package provenance set iff origin=`package` |
| E3 | Temporary scope | EP (boundary of enum) | L1 | automated | one entry with `metadata.scope: "temporary"` | scan assembles | card attribute is `local`, not `global`, and the entry is present |
| E4 | Unmatched package source | EP (invalid partition) | L1 | automated | `package`-origin entry, `metadata.source: "npm:foo@1.2.3"`, no matching package row | scan assembles | entry present, labelled with the raw string `npm:foo@1.2.3`, not dropped |
| E5 | Manifest-excluded resources absent | EP | L1 | automated | package manifest with a `-` override pattern excluding one of its own skills | scan assembles | that skill is absent entirely; no disabled placeholder is synthesised |
| E6 | Load gate — missing description | BVA (empty boundary) | L1 | automated | resolved path whose frontmatter has `description: ""` | scan assembles | path is not reported as a skill |
| E7 | Load gate — whitespace description | BVA (just-inside-invalid) | L1 | automated | resolved path with `description: "   "` | scan assembles | path is not reported as a skill |
| E8 | Load gate — 1-char description | BVA (just-inside-valid) | L1 | automated | resolved path with `description: "x"` | scan assembles | path IS reported as a skill |
| E9 | Load gate — real `.pi/skills/AGENTS.md` | EP | L1 | automated | the repo's own `.pi/skills/AGENTS.md`, no frontmatter | scan assembles | absent from skills; absent from any not-loaded list |
| E10 | Name falls back to directory | EP | L1 | automated | `SKILL.md` with `description` and no `name`, in dir `foo-bar/` | scan assembles | reported name is `foo-bar` |
| E11 | Guard severity — description length | BVA | L1 | automated | descriptions of 400, 401, 1024, 1025 chars | guard script runs | 400 clean · 401 repo-budget warning · 1024 repo warning only · 1025 repo warning + pi-limit warning; exit 0 for all |
| E12 | Guard severity — name length | BVA | L1 | automated | names of 64 and 65 chars | guard runs | 64 clean · 65 pi-limit warning; exit 0 |
| E13 | Guard error vs warning exit | decision-table | L1 | automated | repo with (a) warnings only, (b) one missing description, (c) both | guard runs | (a) exit 0, (b) exit non-zero, (c) exit non-zero |
| E14 | Wording-locked exemption | EP | L1 | automated | `ship-change` (559), `frontend-mockup-loop` (773), `anti-slop-frontend` (612) | guard runs | no budget warning for these three; their description bytes unchanged from HEAD |
| E15 | Join statuses | decision-table | L1 | automated | resolved ∈ {yes,no} × live ∈ {yes,no} | server joins | yes/yes→`active` · yes/no→`not-loaded` · no/yes→`loaded-elsewhere` · no/no→absent |
| E16 | Disabled precedence | decision-table | L1 | automated | resolved `enabled:false` × live ∈ {present, absent} | server joins | both combinations report `disabled`, never `not-loaded` |
| E17 | Distinct same-named skills | EP | L1 | automated | two resolved skills both named `release-revoke` at different real paths | server joins | two distinct payload entries; neither merged nor deduped by name |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | Resolver on the resources path | tail-latency | L2 | automated | resources refresh across 10 known directories | p95 `GET /api/pi-resources` ≤ 5s warm; `resolve()` bounded by a 5s timeout | one poll cycle |
| P2 | Resolver call count | invariant counting | L1 | automated | one `scanPiResources()` invocation | `resolveActivation()` called exactly once | single call |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | Provenance badges | state-transition | L3 | automated | payload with one skill of each status | Resources skills page renders | `active` card has no provenance badge; `not-loaded` and `loaded-elsewhere` each carry their badge |
| F2 | No new grouping | invariant assertion | L3 | automated | payload mixing all three statuses | Resources skills page renders | exactly one grid container; zero section headers, group headers, or chevrons introduced by provenance |
| F3 | Provenance filter | state-transition | L3 | automated | grid with 3 `active`, 2 `not-loaded`, 1 `loaded-elsewhere` | user selects the `loaded-elsewhere` filter value | grid converges to exactly 1 card |
| F4 | `loaded-elsewhere` shows path | invariant assertion | L3 | automated | hermes skill reported at `~/.pi/agent/pi-hermes-memory/skills/x/SKILL.md` | Resources page renders | card displays that path |
| F5 | Scan-only state | state-transition | L3 | automated | folder with no reporting session | Resources page renders | scan-only notice present; zero `not-loaded` badges anywhere in the grid |
| F6 | Degraded state | state-transition | L3 | automated | server with `resolveActivation()` forced to return `null` | Resources page renders | degraded notice present; zero `not-loaded` badges |
| F7 | Live report converges the grid | state-convergence | L3 | automated | folder rendering scan-only, then a session registers and reports | `commands_list` arrives | grid converges to per-card provenance without a manual refresh |
| F8 | Session cwd context | invariant assertion | L3 | automated | session whose cwd is a worktree of the scanned folder, with a `not-loaded` skill | Resources page renders | the differing working directory is shown on/near that card |
| F9 | Agents page unaffected | invariant assertion | L3 | automated | workspace with `.pi/agents/*.md` | Directory Settings Agents page renders | agents still listed after the scanner rewire |
| F10 | Themes page renders resolver themes | invariant assertion | L3 | automated | workspace with a package declaring `pi.themes` | Resources Themes page renders | the theme appears; no new theme UI is introduced |
| F11 | Provenance badge legibility across the 4 themes | visual/subjective | — | manual-only | Resources grid with all provenance states | human inspects in studio/earth/athlete/gradient | [judgment: badges readable and not visually confused with the existing scope/package badges] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | Degraded on resolver throw | fault-injection (abort) | L1 | automated | `resolveActivation()` throws | `scanPiResources()` runs | fallback walk results returned; payload marked degraded; no exception escapes |
| X2 | Degraded on contradicted empty | fault-injection (empty return) | L1 | automated | `resolveActivation()` returns all-empty arrays while the fallback walk finds ≥1 skill | scan assembles | payload marked degraded, not presented as an authoritative empty list |
| X3 | Path-less retained list | fault-injection (field removal) | L1 | automated | retained `commands_list` whose skill entries all lack `path` | server joins | condition reported (see C1 note above); NOT every resolved skill flipped to `not-loaded` |
| X4 | Transient empty list on reload | state-transition (illegal edge) | L1 | automated | session with a populated retained set | a `commands_list` containing zero skill entries arrives mid-reload | retained set unchanged — a non-empty skill set is never replaced by an empty one |
| X5 | Multi-session folder | decision-table | L1 | automated | two sessions attached to one folder, both reporting | resources payload built | payload is scan-only; no `not-loaded` labels; no last-writer-wins selection |
| X6 | Path mapping survives every sender | state-transition | L1 | automated | commands emitted via register, spawn, flow-rediscover, `session_start`, `request_commands` | each sender fires | all five carry `path` on skill entries |
| X7 | Reload does not degrade a good list | state-transition | L3 | automated | session with correct provenance rendered | user triggers `/reload`, then a flow rediscovery | provenance remains correct; no mass flip to `not-loaded` |
| X8 | Missing `sourceInfo` | fault-injection (field removal) | L1 | automated | a command object with no `sourceInfo` | `filterHiddenCommands()` runs | entry emitted with `path` absent; no throw |
| X9 | Prompt description fallback survives | fault-injection (frontmatter removal) | L1 | automated | resolver-sourced prompt `.md` with no frontmatter | scan assembles | description is the file's first non-empty line |
| X10 | Companion files still readable | fault-injection (regression probe) | L2 | automated | a skill that reads `references/*.md` at runtime | skill is invoked in a live session | the companion file is read successfully |
| X11 | Bundled slash command still resolves | fault-injection (regression probe) | L2 | automated | a command under `pi-dashboard/commands/` | command is invoked | it resolves and executes |

---

## Coverage summary

- Requirements covered: 19/19 (`pi-resource-scanning` 8, `session-skill-registry` 6, `pi-resources-view` 3, `skill-frontmatter-validity` 2 — counting ADDED + MODIFIED blocks across the four delta specs)
- Scenarios by class: edge 17 · perf 2 · frontend 11 · error 11
- Scenarios by level: L1 26 · L2 4 · L3 10 · manual-only 1
- Scenarios by disposition: automated 40 · manual-only 1

## New infra needed

- None. L1 extends `packages/server/src/__tests__/pi-resource-scanner.test.ts` and the extension's existing bridge tests; L2 extends `qa/tests/`; L3 extends `tests/e2e/` against the docker harness port read from `.pi-test-harness.json` (`dashboardPort`) — never hardcoded.
- P1 needs no new harness but does need the C1 threshold before it can assert anything.
