# Test Plan — add-seek-to-session-card

Stage: design   Generated: 2026-07-14

Clarification gate resolved: completion is driven by the `workspaces_updated`
echo event with a FIXED 5s give-up backstop (heartbeat/RTT derivation was
disproved in cross-model review — wrong signal + no browser RTT); the backstop
toast carries a non-auto-dismissing Retry action (Toast gains an optional action
+ no-auto-dismiss flag).

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | Seek control desktop-only | decision-table | L1 | automated | open session; `useMobile()` returns true | render SessionHeader | no element with data-testid `session-header-seek-card` in the DOM |
| E2 | Ancestor resolution (ended) | decision-table | L1 | automated | active session with `status !== "ended"` | dispatch reveal | ended-expanded set is NOT mutated for that cwd; workspace+folder still expand |
| E3 | Ancestor resolution (no ws) | EP | L1 | automated | session whose cwd is in NO workspace (`folderWorkspaceMap.get` → undefined) | `resolveFoldAncestors(session)` | `workspaceId` is undefined; no `onSetWorkspaceCollapsed` call |
| E4 | Repeat-seek idempotence | state-transition (illegal edge) | L1 | automated | all fold-ancestors already expanded | dispatch reveal | no ancestor becomes collapsed; card still scrolls |
| E5 | Backstop bounds failure only | BVA | L1 | automated | echo never lands | advance fake timer to just-below vs just-above the 5s backstop | no toast before 5s; Retry toast at/after 5s; when the echo lands before 5s the reveal completes with NO toast and the timer is cancelled |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| — | (none) | — | — | — | no latency/throughput budget asserted in spec | — | — |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | Reveal buried card | state-transition | L1 | automated | session under collapsed workspace + folder + ended group | dispatch reveal | converges to: all three containers expanded, card has selected class, `scrollIntoView` called once |
| F2 | Re-trigger same session | state-transition | L1 | automated | already-selected session, then re-collapsed | dispatch two reveal requests (same id, bumped nonce) | reveal effect runs twice (nonce, not id, drives re-fire) |
| F3 | Scroll waits for laid-out | state-convergence | L1 | automated | card absent/0-height on first check | `workspaces` prop updates (echo) making card laid-out | `scrollIntoView` fires ONLY after `getBoundingClientRect().height > 0`, never before |
| F4 | Retry re-fires reveal | state-transition | L1 | automated | reveal-timeout toast shown | activate its Retry action | a new reveal is dispatched for the same session (nonce bumped) |
| F5 | Reveal feels smooth / flash noticeable | subjective | — | manual-only | a buried session opened in ChatView | human clicks Seek | [judgment: scroll is smooth, flash is perceptible — no automatable observable] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | Correct DOM-presence predicate | fault-injection (predicate) | L1 | automated | card present but in a `grid-template-rows:0fr` collapsed row (`offsetParent` non-null, height 0) | reveal presence check runs | reveal does NOT scroll (height-0 fails the predicate); no false-positive scroll to a collapsed row |
| X2 | Backstop → Retry toast, no leak | fault-injection (abort) | L1 | automated | workspace echo never lands | advance past the 5s backstop, then unmount | Retry toast shown (non-auto-dismissing); NO frame/timer callback fires after unmount |
| X3 | Hidden degrades, no flip | fault-injection (state) | L1 | automated | session `hidden`, `showHidden` off | dispatch reveal | no ancestor expand; `showHidden` stays off; informational toast (no action button) |
| X4 | Tag-filtered degrades | fault-injection (state) | L1 | automated | active tag filter excludes the session | dispatch reveal | no expand; filter unchanged; informational toast |
| X5 | Folder-path-filtered degrades | fault-injection (state) | L1 | automated | active folder-path `workspaceFilter` hides the session's folder | dispatch reveal | no expand; filter unchanged; informational toast |

---

## Coverage summary

- Requirements covered: 4/4 (Seek control reveals; Ancestor resolution; Scroll waits; Hidden/filtered degrade)
- Scenarios by class: edge 5 · perf 0 · frontend 5 · error 5
- Scenarios by level: L1 14 · L2 0 · L3 0 · manual-only 1
- Scenarios by disposition: automated 14 · manual-only 1

## New infra needed

- none — all automated rows are L1 vitest, extending existing
  `packages/client/src/components/__tests__/` (SessionList / SessionHeader / Toast
  siblings). No new harness or level.
