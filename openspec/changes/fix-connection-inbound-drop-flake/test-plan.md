# Test Plan — fix-connection-inbound-drop-flake

Stage: design   Generated: 2026-08-31

The change's deliverable IS a test. The scenario below exercises the
methodology under the failure condition (CPU contention) that reproduces the
CI flake; it is executed in-flight and evidenced in the PR description, plus
the reworked test itself remains an automated repo test (the 10 % budget) for
every future run.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | D1 — robust estimator under preemption | fault injection | — | manual-only | the test file run under synthetic CPU contention (`stress`-style spinner processes) | old methodology vs new methodology, same contention | old: fails (documents the red); new: passes (documents the green); contention command + results recorded in the PR |
| E2 | D2 — budget preserved | contract assertion | — | manual-only | diff of the test body | review | the `max(baseline*1.1, baseline+5)` bound is retained on medians; no `.only`/`skip`; assertion count not reduced |
| E3 | stability | soak | — | manual-only | reworked test | 10 consecutive clean local runs | 10/10 green |

### Performance

None — the change makes a perf assertion robust; it introduces no production
latency path.

### Frontend-quirk

None.

### Error-handling

None — no production error paths touched.

---

## Coverage summary

- Requirements covered: measurement robustness (E1), budget preservation (E2),
  stability (E3)
- Scenarios by level: L1 0 · L2 0 · L3 0 · — 3
- Scenarios by disposition: automated 0 · manual-only 3 (the automated
  artifact is the reworked test itself, which runs in every future `npm test`)
