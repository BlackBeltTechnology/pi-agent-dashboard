# Test Plan — security-boundary-audit

Stage: design   Generated: 2026-10-17

Audit-only change: the deliverable is the findings register (`audit-findings.md`)
plus its routing in `tasks.md`. There is no product behaviour to automate. Every
scenario falsifies a register-integrity claim against the repository. All rows
are `manual-only` (level `—`): each is a one-shot document-vs-code check at
archive time, and a permanent test asserting on a change dir that is about to
move under `archive/` would be brittle. Behaviour tests for the fixes belong to
the owner changes (`close-residual-audit-findings`,
`harden-server-capability-bounds`, `close-loopback-legacy-window`).

Requirement refs: proposal `## Remediation Ownership` (RO), `## What Changes`
(WC), `tasks.md` tick rule (TR).

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | RO "Closed by" | decision-table (archived × in-code) | — | manual-only | every `tasks.md` line whose status is "Closed by `<change>`" (incl. the Closed half of Split lines) | for each: `ls openspec/changes/archive/*-<change>` + grep the cited symbol/file in current code | 0 lines whose owner dir is missing; 0 lines whose fix is absent from code (e.g. B1 argv in `git-operations.ts` `checkoutBranch`, B25 `writeConfigFileSecure` 0600) |
| E2 | RO "Owner assigned" | set-difference | — | manual-only | IDs routed to each active owner: `close-residual-audit-findings` (20: S1r S3b B1r B4r B14r B15r B16r B17–B24 B26r R1 R2 R4 R5), `harden-server-capability-bounds` (B7 B8 B9), `close-loopback-legacy-window` (S2r) | grep each owner `proposal.md` `Closes` / scope for each ID | routed-set minus named-set = ∅ for all three owners |
| E3 | RO table ↔ TR lines | consistency check | — | manual-only | proposal owner table + `tasks.md` statuses | compare ID→owner per row | every ID has the same owner in both files; no ID has two owners |
| E4 | WC "no finding dropped" | coverage mapping | — | manual-only | every finding bullet in `audit-findings.md` clusters A–G + cross-cutting + V1–V5 | map each bullet to a `tasks.md` ID | unmapped bullets = 0 |
| E5 | RO "No gap (verified)" | evidence re-check | — | manual-only | R3, the `pi-dashboard.dev` half of B19 | re-read the cited evidence (`routes/pi-core-routes.ts:67-87`, `pi/pi-core-updater.ts:91`; `cors-origin.ts:162` + `server-cors` neutral-shell allowance) | each cited line still shows the non-exploitable behaviour; otherwise the line flips to an owned residual |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | RO close-out (state-transition: owner lifecycle) | state-transition (illegal edge) | — | manual-only | an "Owner assigned" target change is renamed, superseded (`SUPERSEDED-` prefix) or deleted after routing | at archive time: `ls openspec/changes/<owner>` for every owner | every owner dir exists (active or under `archive/`, not `SUPERSEDED-`); a missing owner → that line is unticked and re-routed before archiving |
| X2 | RO "archives only when no unticked finding lines" | boundary (0 vs 1 unticked) | — | manual-only | `tasks.md` with exactly one unticked finding line | `openspec status --change security-boundary-audit --json` before archive | 1 unticked → archive refused by the operator. 0 unticked → archive proceeds. The JSON task counts equal the `- [x]` / `- [ ]` counts from `grep -c` |
| X3 | WC "no spec deltas" / tooling parse | fault: missing deltas | — | manual-only | change has no `specs/` dir | `openspec validate security-boundary-audit` | exits valid because of `skip_specs: true`; removing that key → "Change must have at least one delta" (proves the key is load-bearing) |
| X4 | RO "Split" | decision-table (fixed half × residual owner) | — | manual-only | every Split line (S1, S2, S3, B1, B4, B14, B15, B16, B26) | check the residual ID (`<id>r` / `S3b` / `R4`) appears in its owner's `Closes` line | 0 Split lines whose residual ID is unowned |

---

## Coverage summary

- Requirements covered: 6/6 (RO Closed, RO Owner assigned, RO Split, RO No-gap, RO close-out, WC no-drop / no-deltas)
- Scenarios by class: edge 5 · perf 0 · frontend 0 · error 4
- Scenarios by level: L1 0 · L2 0 · L3 0 · — 9
- Scenarios by disposition: automated 0 · manual-only 9

## New infra needed

- none
