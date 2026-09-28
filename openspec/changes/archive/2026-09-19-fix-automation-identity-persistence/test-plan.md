# Test Plan — fix-automation-identity-persistence

Stage: design   Generated: 2026-09-17

Requirement under test (one, from `specs/meta-json-session-cache/spec.md`):
**R1 — Session classification and run identity are durable** (survive an
unrelated save; restored on cold start; absent ⇒ no bytes).

Clarifications resolved during design (no open gaps):
- A restored ENDED automation run SHALL mount its plugin slot contributions —
  a restart is meant to be invisible (drives F2).
- A legacy sidecar with recoverable classification but permanently lost run
  identity SHALL render the fallback automation badge, not nothing (drives E6).

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | R1 | state-transition (the wipe path) | L1 | automated | sidecar holding a merged automation ref (`kind: "automation"`, `automationRun {name, runId, visibility:"hidden"}`) | an unrelated field (e.g. `unread`) changes and the routine full-overwrite save runs | re-read sidecar still has `kind === "automation"` and `automationRun` deep-equal to the merged value |
| E2 | R1 | round-trip | L1 | automated | session object carrying `kind` + `automationRun` | project to meta, then rebuild the session from that meta | rebuilt session has `kind === "automation"` and `automationRun` deep-equal (fails today: rebuild drops `automationRun`) |
| E3 | R1 | decision-table (classification × identity) | L1 | automated | four sessions: (kind+run), (kind only), (run only), (neither) | project each to meta and rebuild | each rebuilt session reproduces exactly the fields its input had — no field invented, none dropped |
| E4 | R1 | byte-identity (E5 invariant) | L1 | automated | plain user session, no classification, no identity | project to meta and `JSON.stringify` | serialized output contains neither a classification key nor a run-identity key |
| E5 | R1 | EP (visibility partition) | L1 | automated | run identity with `visibility: "shown"` | project to meta, rebuild, apply the board filter with `showHidden=false` | session is RETAINED on the board — the fix must not over-hide runs the user opted to show |
| E6 | R1 | EP (legacy partition) | L1 | automated | legacy sidecar: `kind: "automation"`, `automationRun` absent | rebuild the session and render its badge | badge renders the fallback automation label (not `null`, not a run name) |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | R1 | state-transition (restart edge) | L3 | automated | folder seeded with an ended automation-run session whose sidecar carries `kind` + `automationRun {visibility:"hidden"}`, plus one ordinary ended user session | dashboard restarted / reloaded so the session set is rebuilt from disk | the folder group converges to showing the user session only; the run contributes no card while "show hidden" is off, and appears when it is toggled on |
| F2 | R1 | state-transition (predicate re-arm) | L3 | automated | same seeded ended automation run, "show hidden" ON | restart, then open the run's card | the automation slot contribution mounts and the badge shows the run name — the restart is invisible to the surface |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | R1 | fault-injection (malformed persisted value) | L1 | automated | sidecar whose run identity is structurally wrong (`automationRun` present but `runId` missing) | cold-start scan reads the directory | the scan completes and yields the session; no throw, no skipped directory — the existing "all meta fields optional / tolerant read" contract holds |

---

## Coverage summary

- Requirements covered: 1/1
- Scenarios by class: edge 6 · perf 0 · frontend 2 · error 1
- Scenarios by level: L1 7 · L2 0 · L3 2
- Scenarios by disposition: automated 9 · manual-only 0

No performance scenarios: the change adds two optional fields to an existing
write and one field to an existing read. No workload, metric or threshold is
claimed anywhere in the proposal, so inventing one would be a fabricated Triple.

## New infra needed

none — L1 extends existing vitest suites (`meta-key-byte-identity.test.ts`,
`session/__tests__/origin-durability.test.ts` is the same durability-bug class
and is the closest harness exemplar); L3 extends the existing docker-harness
Playwright tier (`tests/e2e/archive-fold.spec.ts` and
`tests/e2e/ended-session-endedat.spec.ts` both seed sidecars out-of-band).
