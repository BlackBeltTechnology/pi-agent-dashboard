# Test Plan — guard-server-heap-and-store-coupling

Stage: design   Generated: 2025-06-07

Clarifications C1 (restart ceiling source) and C2 (Electron config source) were
raised at the HARD gate and answered before this catalog was written; both
answers are now folded into `design.md` D3/D5 and the `server-launch` delta, so
no rows carry a `[NEEDS CLARIFICATION]` marker.

**Derived boundary values** (all rows below reuse these; recomputing them per
row is how the two-formula ambiguity D1 closes would creep back in):

- Predicate: `budgetMiB × 1.33 + 112 > ceilingMB × 0.82`.
- At ceiling `1536` the RHS is `1259.52`, so the budget boundary is
  `(1259.52 − 112) / 1.33 = 862.8` MiB → **862 warns not, 863 warns**.
- At the default budget `768` the LHS is `1133.44`, so the ceiling boundary is
  `1133.44 / 0.82 = 1382.2` MB → **1382 warns, 1383 silent**.
- `768` MiB in the stored byte denomination is `805306368`.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | heap-limits R1 (predicate) | BVA (just below) | L1 | automated | budget `862` MiB, ceiling `1536` | guard evaluated | returns no-warning (`1258.46 ≤ 1259.52`) |
| E2 | heap-limits R1 (predicate) | BVA (just above) | L1 | automated | budget `863` MiB, ceiling `1536` | guard evaluated | returns a warning (`1259.79 > 1259.52`) |
| E3 | heap-limits R1 (unlimited) | EP (special value) | L1 | automated | `maxTotalEventBytes` `0`, ceiling `1536` | guard evaluated | warning of kind `unbounded`; result carries NO numeric heap figure |
| E4 | heap-limits R1 (default pairing) | EP (nominal) | L1 | automated | budget `768` MiB, ceiling `1536` | guard evaluated | no warning |
| E5 | heap-limits R1 (over-budget) | EP (invalid) | L1 | automated | budget `2048` MiB, ceiling `1536` | guard evaluated | warning reporting heap-equivalent `≈2724` MB, not the raw `2048` |
| E6 | heap-limits R1 (byte denomination) | EP (unit boundary) | L1 | automated | `maxTotalEventBytes` = `805306368` (bytes), ceiling `1536` | guard evaluated at its public boundary | no warning — proves the ×2²⁰ conversion happens inside the guard |
| E7 | heap-limits R1 (ceiling term) | BVA (just below) | L1 | automated | budget `768` MiB, ceiling `1382` | guard evaluated | warning (`1133.24 < 1133.44` of headroom) |
| E8 | heap-limits R1 (ceiling term) | BVA (just above) | L1 | automated | budget `768` MiB, ceiling `1383` | guard evaluated | no warning |
| E9 | heap-limits R1 (constants) | contract | L1 | automated | the exported constant names | test imports them | `HEAP_MB_PER_BUDGET_MIB`, `BASELINE_MB`, `CRASH_RATIO` are importable from shared; guard test re-derives none of the three literals |
| E10 | heap-limits R2 (invariant) | decision-table | L1 | automated | shared server default `1536`, memory-limits default with NO `maxTotalEventBytes` | assertion runs | assertion fails |
| E11 | heap-limits R2 (invariant) | decision-table | L1 | automated | shared server default `1536`, `maxTotalEventBytes: 0` | assertion runs | assertion fails |
| E12 | heap-limits R2 (invariant) | decision-table | L1 | automated | shared server default `1536`, `maxTotalEventBytes: 805306368` | assertion runs | assertion passes |
| E13 | heap-limits R2 (invariant) | decision-table (inert arm) | L1 | automated | shared server default `8192`, no `maxTotalEventBytes` | assertion runs | assertion passes — the invariant binds only below `8192` |
| E14 | heap-limits R2 (fail-closed) | mutation probe | L1 | automated | the invariant test itself | budget default temporarily set to `0` | the test goes RED — proves the assertion is not vacuous |
| E15 | heap-limits R2 (browser-safe split) | contract | L1 | automated | the module exporting the ceiling default | imported from a jsdom/browser-condition context | import succeeds and pulls in no `node:` built-in |
| E16 | heap-limits R3 (strip) | state (marker match) | L1 | automated | `NODE_OPTIONS="--enable-source-maps --max-old-space-size=1536"` + marker naming `--max-old-space-size=1536` | terminal env built | env is exactly `--enable-source-maps`; the rest is verbatim |
| E17 | heap-limits R3 (operator pin) | state (no marker) | L1 | automated | `NODE_OPTIONS="--max-old-space-size=4096"`, no marker | terminal env built | flag preserved unchanged |
| E18 | heap-limits R3 (collision) | state (value-identical, no marker) | L1 | automated | `NODE_OPTIONS="--max-old-space-size=1536"` set by the operator, no marker | terminal env built | flag preserved — the strip keys on the marker, never on the value |
| E19 | heap-limits R3 (marker leak) | contract | L1 | automated | server running under a stamped ceiling | terminal env built | the provenance marker variable is absent from the terminal env |
| E20 | server-launch R4 (Electron stamp) | EP | L1 | automated | `config.json` with `serverHeap.maxOldSpaceMb: 2048` | Electron builds the server spawn env | spawn carries a `2048` ceiling |
| E21 | server-launch R4 (operator pin) | decision-table | L1 | automated | Electron launch env already pins `--max-old-space-size=4096` | Electron builds the server spawn env | the pin is neither replaced NOR outranked by a higher-precedence argv flag |
| E22 | server-launch R5 (restart re-stamp) | state-transition | L2 | automated | server booted under ceiling `1536` | `POST /api/restart` | respawned process runs under `1536`, not the runtime default |
| E23 | server-launch R5 (config re-read) | state-transition | L2 | automated | booted at `1536`, `config.json` edited to `2048` afterwards | `POST /api/restart` | respawned process runs under `2048` — the NEW value, not the booted one |

### Performance

Intentionally empty. The guard is pure arithmetic evaluated on settings edits,
the design states no latency budget applies, and the soak that backstops the
`1536` ceiling belongs to `bound-session-heap-and-gc-telemetry`. Adding a row
here would require inventing a threshold no spec states.

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | settings-panel R6 (both fields) | state-convergence | L1 | automated | unsafe pairing (budget `0`, ceiling `1536`) | panel renders | a warning node is present under the server-heap field AND under the memory-limits budget field |
| F2 | settings-panel R6 (copy shape) | EP | L1 | automated | `maxTotalEventBytes` `0` | panel renders | warning text describes the store as unbounded and contains no heap-figure number |
| F3 | settings-panel R6 (copy shape) | EP | L1 | automated | budget `2048` MiB, ceiling `1536` | panel renders | warning text contains the heap-equivalent (`≈2724` MB), not the raw `2048` |
| F4 | settings-panel R6 (silence) | EP | L1 | automated | default pairing `768`/`1536` | panel renders | no warning node under either field |
| F5 | settings-panel R6 (cross-field) | state-transition | L1 | automated | panel at the default pairing | operator edits ONLY the ceiling to `1382` | the warning appears under BOTH fields — recompute is driven by either field, not just the edited one |
| F6 | settings-panel R6 (non-blocking) | state-convergence | L3 | automated | dashboard settings against the docker harness (port from `.pi-test-harness.json`) | operator sets budget `0` and saves | Save is enabled, the save succeeds, and the value survives a reload with the warning still shown |
| F7 | settings-panel R6 (i18n) | contract | L1 | automated | every locale file | locale-parity test runs | both warning keys exist in every locale |
| F8 | settings-panel R6 (advisory tone) | visual/subjective | — | manual-only | the Server settings page with an unsafe pairing | a human looks at it | [judgment: the warning reads as advisory, not as a blocking error — no automatable observable] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | server-launch R4 (config fault) | fault-injection (unparseable) | L1 | automated | `~/.pi/dashboard/config.json` absent or malformed | Electron builds the server spawn env | falls back to the shared default ceiling; the launch is NOT failed |
| X2 | server-launch R5 (config fault) | fault-injection (removed) | L2 | automated | `config.json` deleted between boot and restart | `POST /api/restart` | respawn succeeds under the shared default ceiling rather than hanging or exiting non-zero |
| X3 | heap-limits R3 (stale marker) | fault-injection (mismatch) | L1 | automated | marker names `--max-old-space-size=1536` but `NODE_OPTIONS` carries `--max-old-space-size=4096` | terminal env built | nothing is stripped — mismatch means the operator owns the flag |
| X4 | heap-limits R1 (hostile input) | fault-injection (invalid input) | L1 | automated | `maxTotalEventBytes` negative, `NaN`, or absent | guard evaluated | the guard returns a result and does NOT throw — it can never break the save path it is advisory to |

---

## Coverage summary

- Requirements covered: 6/6 requirement groups (heap-limits R1/R2/R3,
  server-launch R4/R5, settings-panel R6)
- Scenarios by class: edge 23 · perf 0 (intentional) · frontend 8 · error 4
- Scenarios by level: L1 29 · L2 3 · L3 1 · manual-only 1
- Scenarios by disposition: automated 34 · manual-only 1

## New infra needed

None. Every row lands in an existing tier: vitest suites beside the touched
modules (L1), `qa/tests/` process smoke for the restart rows (L2), and one
Playwright spec against the existing docker harness (L3).
