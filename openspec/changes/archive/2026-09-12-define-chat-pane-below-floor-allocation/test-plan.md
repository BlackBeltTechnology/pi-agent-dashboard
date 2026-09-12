# Test Plan — define-chat-pane-below-floor-allocation

Stage: design   Generated: 2026-11-19

Resolved inputs (were HARD-gate clarifications):

- Declared transcript floor (flex-basis, share of the floor sum): **64px**; hard
  lower bound **16px**; weight **3**.
- Composer (`composer-root`) lower bound: **72px** (38px textarea + root `p-3` +
  card padding + border); weight **1**; cap stays `max-h-[40%]`.
- L3 drives the band with a **short viewport (375×360) + divider at
  `RATIO_MIN = 0.25`**; no style injection. Row heights are read from the DOM, and
  the floor sum is **computed from measured row heights at the tested pane state**,
  never hardcoded (it is state- and height-dependent — design Facts 2–3).

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | Shrinkable rows declare floor > bound | BVA | L1 | automated | the exported row-class table / layout constants | assert transcript floor vs bound | `floor (64) > bound (16)` and composer `base > bound (72)`; a table entry with `floor === bound` fails the test |
| E2 | Every row classified exactly once | decision-table | L1 | automated | the row-class table vs the rows `App.tsx` renders (incl. conditional: header slot, banner, status bar, queue panel, footer slot, error fallback) | render the chat pane with each conditional row forced on | every rendered row appears in the table exactly once, as `shrinkable` or `fixed`; an unclassified row fails |
| E3 | At/above floor sum nothing shrinks | BVA (at boundary) | L3 | automated | pane at exactly the computed floor sum (375×360, ratio tuned to hit it) | render | every fixed row is at its content height; transcript ≥ 64px; composer ≥ its base; clipped amount = 0 |
| E4 | Just above the floor sum | BVA (min+1) | L3 | automated | pane = floor sum + 8px | render | identical row heights to E3 except the transcript, which is 8px taller; no fixed row differs by more than 1px |
| E5 | Just below the floor sum — both shrinkable rows give | BVA (min−1) | L3 | automated | pane = floor sum − 8px | render | transcript **and** composer are each strictly shorter than their base (the direct disproof of a flexbox freeze); every fixed row still at content height; clipped = 0 |
| E6 | Deficit is not dumped on one shrinkable row | BVA | L3 | automated | pane = floor sum − 24px | render | neither shrinkable row has absorbed the whole 24px while the other is still above its bound; both losses > 0 |
| E7 | Transcript holds at its bound, composer keeps absorbing | BVA (past first bound) | L3 | automated | pane shrunk until the transcript reads 16px, then 12px shorter | render | transcript stays at 16px (±1); the extra 12px comes off the composer; fixed rows unchanged; clipped = 0 |
| E8 | Residual clipping only after both bounds | BVA (invalid region) | L3 | automated | pane < (16 + 72 + sum of fixed content heights) | render | transcript = 16px, composer = 72px, and only then is the bottom row clipped; at every larger pane height clipped = 0 |
| E9 | `min-height` beats `max-h-[40%]` below the floor sum | boundary/precedence | L3 | automated | pane where `0.4 × pane < 72px` (pane < 180px) | render | composer-root computed height = 72px, not `0.4 × pane`; composer-card scrolls its content |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | Monotonic degradation | state-transition (height sweep) | L3 | automated | pane swept floor sum → floor sum − 60px in 10px steps | each step re-measures | each shrinkable row's height is non-increasing across every step and strictly decreases while above its bound; no row's height jumps to 0 or `display:none` between steps |
| F2 | Transcript never measured at zero | state-convergence | L3 | automated | pane at its smallest tested height (E8 state) | virtualizer re-measures after the resize | transcript viewport height ≥ 16px at every step; no TanStack Virtual error/warning in console; transcript still scrollable to its last message |
| F3 | Conditional row raises the floor sum | state-transition | L3 | automated | pane resting just above the floor sum with no queue; a follow-up is then queued so `QueuePanel` mounts | QueuePanel appears | the new row renders at content height; the deficit it introduces comes off the shrinkable rows; clipped = 0 |
| F4 | Long draft does not evict the bottom rows | state-transition | L3 | automated | comfortable pane; paste a 40-line draft | composer grows to its cap | composer stops at `0.4 × pane`, composer-card scrolls, every row below composer fully inside the pane |
| F5 | Divider drag across the boundary | state-transition (illegal-edge sweep) | L3 | automated | drag the split divider from mid-range down to `RATIO_MIN` at 375×360 | continuous drag | at no intermediate ratio is a fixed row shorter than its content height, and no row is clipped while a shrinkable row is above its bound |
| F6 | Band still looks intact, not mangled | visual/subjective | — | manual-only | chat pane at floor sum − 24px on a real device | human looks at it | [judgment: rows look degraded-but-coherent, nothing overlapping or visually broken] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | ErrorBoundary fallback occupies the transcript slot | fault-injection (throw) | L3 | automated | force the chat ErrorBoundary to trip (`App.tsx:2003`) at a below-floor pane height | render | the padded fallback holds its content height (it is `fixed`, design Decision 3); its content is not painted over the banner or strip; the composer absorbs alone; no row overlaps |
| X2 | No row paints outside its own box | fault-injection (content growth) | L3 | automated | below-floor pane; force the context strip to wrap to 2 lines and the queue panel to 3 entries | rows grow while the pane stays fixed | each fixed row's `scrollHeight ≤ clientHeight + 1`; no two row bounding boxes overlap |
| X3 | Plugin footer contributions survive the band | fault-injection (slot absent/present) | L3 | automated | below-floor pane with a `content-inline-footer` contribution mounted, then unmounted | slot toggles | while a shrinkable row is above its bound the footer is fully visible; when it unmounts the reclaimed height returns to the shrinkable rows, not to a fixed row |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | Allocation costs no measurement loop | reflow counting | L3 | automated | drag the divider across the floor-sum boundary for 3s at 375×360 | no `ResizeObserver` callback added by this change; transcript virtualizer re-measure count stays within its pre-change count + 10% | one 3s drag |

---

## Coverage summary

- Requirements covered: 9/9 spec scenarios (a)–(i) + the row-classification and
  floor>bound invariants from the requirement prose.
- Scenarios by class: edge 9 · frontend 6 · error 3 · perf 1
- Scenarios by level: L1 2 · L2 0 · L3 16 (of which 1 is `manual-only`, level `—`)
- Scenarios by disposition: automated 18 · manual-only 1

## New infra needed

None. L3 rows extend the existing Playwright suite against the docker harness
(port read from `.pi-test-harness.json` → `dashboardPort`, never hardcoded);
`tests/e2e/split-composer-overflow.spec.ts` is the nearest harness exemplar. L1
rows are plain vitest beside the client components. No qa/ (L2) rows — every
observable here is rendered-UI, which the project's level boundary keeps out of
`qa/tests/*.sh`.
