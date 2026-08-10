# Test Plan — sidebar-tag-collapse-and-delete

Stage: apply   Generated: 2026-07-22

Exemplars for the fold:
- L1 (vitest) → `packages/server/src/browser-handlers/__tests__/session-meta-handler.test.ts`
- L3 (Playwright vs docker harness) → `tests/e2e/session-tags.spec.ts`

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | req2 overflow cap | BVA (at cap) | L3 | automated | user-tag group with exactly 10 user tags, area expanded | render | 10 filter chips shown, NO `+N more` control present |
| E2 | req2 overflow cap | BVA (above cap) | L3 | automated | user-tag group with 13 user tags, area expanded | activate `+3 more`, then `show less` | first render = 10 chips + `+3 more`; after expand = all 13 chips + `show less`; after `show less` = back to 10 + `+3 more` |
| E3 | req3 fan-out | boundary | L1 | automated | 5 sessions, 3 carry `explore`, 2 do not | `remove_tag_globally { tag: "explore" }` | the 3 carriers lose `explore`; exactly 3 `session_updated` broadcast; the 2 non-carriers unmodified + no broadcast |
| E4 | req3 no-op | boundary | L1 | automated | no session carries `ghost` | `remove_tag_globally { tag: "ghost" }` | 0 sessions modified; 0 `session_updated` broadcast |
| E5 | req3 blank | boundary | L1 | automated | sessions carry `explore` | `remove_tag_globally { tag: "   " }` | normalized tag empty ⇒ 0 sessions modified; 0 broadcast |
| E6 | req3 normalize | EP | L1 | automated | sessions carry normalized `explore` | `remove_tag_globally { tag: "  Explore " }` | inbound normalizes to `explore`; all carriers stripped; one broadcast per carrier |
| E7 | req1 default-collapsed | state-transition | L3 | automated | no stored fold key in localStorage | sidebar first render | area collapsed; both groups hidden; master header `aria-expanded="false"` and shows `N tags · M phases` |
| E8 | req1 persistence | state-transition | L3 | automated | area toggled then page reloaded | expand → reload; then collapse → reload | reload after expand renders expanded; reload after collapse renders collapsed |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | req3/req4 convergence | state-convergence | L3 | automated | two browser contexts on one server; a session carries `explore` | context A confirms delete of `explore` | context B's session card converges to `explore` absent via `session_updated`, no reload |
| F2 | req4 remove≠toggle | state-transition | L3 | automated | a user filter chip that is NOT selected | click its ✕ | confirm dialog opens AND the chip's filter selection is unchanged (`aria-pressed="false"`, list not filtered) |
| F3 | req1 D8 active indicator | state-transition | L3 | automated | a tag filter is selected | collapse the area | collapsed header shows an active-selection indicator distinct from the `N tags · M phases` count + a clear control; activating the clear resets the filter without unfolding |
| F4 | req4 phase read-only | decision-table | L3 | automated | phase (read-only) group rendered | render | phase chips render with NO remove control |

### Error-handling

| id | requirement | technique | level | disposition | fault/input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------------|---------|---------------------|
| X1 | req4 cancel | state-transition | L3 | automated | ✕ dialog open for `explore` (carried by N sessions) | Cancel | no `remove_tag_globally` sent; `explore` remains on all N sessions |
| X2 | req4 a11y keyboard | state-transition | L3 | automated | keyboard focus inside the user-tag group | Tab across a chip | focus reaches the ✕ as a stop distinct from the filter toggle, with an accessible name naming action + tag; keyboard-activating it opens the confirm |
| X3 | req3 reconnect | fault-injection (frame-drop) | L1 | automated | sessions carried `explore`; delete applied | a fresh snapshot/list replay (simulating reconnect after a dropped `session_updated`) | the replayed snapshot reflects the stripped tags (converges to `explore` absent) |
| X4 | D5/Risks race | fault-injection (concurrent write) | — | manual-only | session A carries `explore` | a concurrent `set_session_tags` re-adds `explore` to A mid-fan-out | last-write-wins re-add persists (documented accepted trade-off; not deterministically injectable) |

---

## Coverage summary

- Requirements covered: 4/4 spec requirements (collapse, overflow, remove_tag_globally, guarded ✕)
- Scenarios by class: edge 8 · perf 0 · frontend 4 · error 4
- Scenarios by level: L1 5 (E3–E6, X3) · L3 10 (E1–E2, E7–E8, F1–F4, X1–X2) · manual-only 1 (X4)
- Scenarios by disposition: automated 15 · manual-only 1

## New infra needed

- none — L1 extends `session-meta-handler.test.ts`; L3 extends `tests/e2e/session-tags.spec.ts` against the docker harness's derived `dashboardPort` (never hardcode `:18000`).
