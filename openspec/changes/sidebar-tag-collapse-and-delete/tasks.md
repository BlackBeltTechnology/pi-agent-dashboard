## 1. Protocol (shared)

- [ ] 1.1 Add `remove_tag_globally` to `BrowserToServerMessage` in `packages/shared/src/browser-protocol.ts` with `{ type: "remove_tag_globally"; tag: string }`
- [ ] 1.2 Rebuild shared types so client + server pick up the new message (server restart, no client build yet)

## 2. Server handler (TDD)

- [ ] 2.1 Author the L1 server-handler tests TEST-FIRST (see §10: E3, E4, E5, E6, X3) in `session-meta-handler.test.ts` and confirm they FAIL (red) before implementing 2.2
- [ ] 2.2 Implement `handleRemoveTagGlobally` in `packages/server/src/browser-handlers/session-meta-handler.ts`: normalize the inbound tag first (`normalizeTags([tag])[0]`; if `undefined`/empty, early-return no-op), iterate `sessionManager.listAll()` for sessions whose `tags` include it, strip it, reuse the existing `normalizeTags` → `sessionManager.update` → `broadcast(session_updated)` path (no `mergeSessionMeta`)
- [ ] 2.3 Wire the handler into the browser-gateway message switch (`packages/server/src/pairing/browser-gateway.ts`) — REQUIRED: an unwired type falls through `default:` → `handlePiGatewayForward` and is misrouted to a bridge
- [ ] 2.4 Run the server test file green (`npm test -- session-meta-handler`)

## 3. Client sender

- [ ] 3.1 Add `removeTagGlobally(tag: string)` to `packages/client/src/hooks/useSessionActions.ts` sending `{ type: "remove_tag_globally", tag }`

## 4. Chip primitive — destructive remove on filter chips

- [ ] 4.1 Extend `TagChip` `filter` variant in `packages/client/src/components/tags/TagChip.tsx`: wrap the existing bare toggle `<button>` + a new `✕` sibling `<button>` in a `<span>`, re-home the `selected` outline ring onto the wrapper, keep the wrapper a single flex-wrap unit (✕ never wraps alone); user-tone only; `aria-label` `Remove tag <label> from all sessions`; ≥24px hit area + focus ring (true sibling → no `stopPropagation` needed)
- [ ] 4.2 Confirm `exec` (phase) filter chips never render the remove control

## 5. Filter group — master collapse + overflow

- [ ] 5.1 Refactor `packages/client/src/components/tags/TagFilterGroup.tsx` (or a small wrapper) so both groups render under one master `Tags` collapse header with a chevron, `aria-expanded`, and a `N tags · M phases` count; inner groups become plain sub-labels
- [ ] 5.2 Add overflow cap (10) + `+N more` / `show less` inline expander to the user-tag group (reuse the `TagStrip` `+N` pattern)

## 6. SessionList wiring

- [ ] 6.1 Persist master-collapse state to localStorage in `packages/client/src/components/session/SessionList.tsx`; absent state ⇒ collapsed (default)
- [ ] 6.2 Add the confirm dialog (names the tag, states carrying-session count incl. cross-folder blast radius, states non-undoable + reappear-if-re-added); on confirm call `removeTagGlobally(tag)`
- [ ] 6.3 Compute the carrying-session count for a tag from the current session list to feed the dialog copy
- [ ] 6.4 Active-filter indicator (D8): when `selectedTags`/`selectedPhases` non-empty and the area is collapsed, show an active-selection badge on the master header distinct from the `N tags · M phases` count, plus a clear-filters affordance reachable without unfolding

## 7. Accessibility

- [ ] 7.1 Verify keyboard: Tab reaches the ✕ independently of the filter toggle (accept the 2-stops-per-chip cost); both have accessible names; master header toggles via keyboard and exposes `aria-expanded`
- [ ] 7.2 Verify reduced-motion: chevron rotation respects `prefers-reduced-motion`

## 8. Verify

- [ ] 8.1 `npm test 2>&1 | tee /tmp/pi-test.log && grep -nE 'FAIL|Error|✗' /tmp/pi-test.log` — no failures
- [ ] 8.2 `npm run build` then restart; isolated-verification browser QA (per frontend-mockup-loop-dashboard / isolated-verification): default-collapsed, expand, overflow `+N more`, delete → confirm → chip vanishes, in dark + light
- [ ] 8.3 Update the `packages/client/src/components/tags/AGENTS.md` rows for `TagChip`/`TagFilterGroup` and add a `remove_tag_globally` note to the server + shared protocol AGENTS rows

## 9. QA scenarios (manual, tested later)

- [ ] 9.1 Deleted tag reappears after a session re-adds it via `TagEditor` (derived-union behavior is intentional)

## 10. Test scenarios (folded from test-plan.md — one task per manifest row)

- [ ] 10.1 E1 (test-plan #E1) L3 — see `tests/e2e/session-tags.spec.ts`. Input: user-tag group with exactly 10 user tags, area expanded · Trigger: render · Observable: 10 filter chips, NO `+N more` control
- [ ] 10.2 E2 (test-plan #E2) L3 — see `tests/e2e/session-tags.spec.ts`. Input: 13 user tags, area expanded · Trigger: activate `+3 more` then `show less` · Observable: 10 + `+3 more` → all 13 + `show less` → back to 10 + `+3 more`
- [ ] 10.3 E3 (test-plan #E3) L1 — see `session-meta-handler.test.ts`. Input: 5 sessions, 3 carry `explore`, 2 do not · Trigger: `remove_tag_globally { tag: "explore" }` · Observable: 3 carriers stripped, exactly 3 `session_updated`, 2 non-carriers unmodified + no broadcast
- [ ] 10.4 E4 (test-plan #E4) L1 — see `session-meta-handler.test.ts`. Input: no session carries `ghost` · Trigger: `remove_tag_globally { tag: "ghost" }` · Observable: 0 modified, 0 broadcast
- [ ] 10.5 E5 (test-plan #E5) L1 — see `session-meta-handler.test.ts`. Input: sessions carry `explore` · Trigger: `remove_tag_globally { tag: "   " }` · Observable: normalized empty ⇒ 0 modified, 0 broadcast
- [ ] 10.6 E6 (test-plan #E6) L1 — see `session-meta-handler.test.ts`. Input: sessions carry normalized `explore` · Trigger: `remove_tag_globally { tag: "  Explore " }` · Observable: normalizes to `explore`, all carriers stripped, one broadcast per carrier
- [ ] 10.7 E7 (test-plan #E7) L3 — see `tests/e2e/session-tags.spec.ts`. Input: no stored fold key · Trigger: sidebar first render · Observable: collapsed, both groups hidden, header `aria-expanded="false"` + `N tags · M phases`
- [ ] 10.8 E8 (test-plan #E8) L3 — see `tests/e2e/session-tags.spec.ts`. Input: area toggled then reloaded · Trigger: expand→reload; collapse→reload · Observable: reload preserves the last fold state
- [ ] 10.9 F1 (test-plan #F1) L3 — see `tests/e2e/session-tags.spec.ts`. Input: two browser contexts, a session carries `explore` · Trigger: context A confirms delete · Observable: context B's card converges to `explore` absent via `session_updated`, no reload
- [ ] 10.10 F2 (test-plan #F2) L3 — see `tests/e2e/session-tags.spec.ts`. Input: an unselected user filter chip · Trigger: click its ✕ · Observable: confirm dialog opens AND filter selection unchanged (`aria-pressed="false"`, list not filtered)
- [ ] 10.11 F3 (test-plan #F3) L3 — see `tests/e2e/session-tags.spec.ts`. Input: a tag filter selected · Trigger: collapse the area · Observable: collapsed header shows an active-selection indicator distinct from the count + a clear control that resets the filter without unfolding
- [ ] 10.12 F4 (test-plan #F4) L3 — see `tests/e2e/session-tags.spec.ts`. Input: phase group rendered · Trigger: render · Observable: phase chips render with NO remove control
- [ ] 10.13 X1 (test-plan #X1) L3 — see `tests/e2e/session-tags.spec.ts`. Input: ✕ dialog open for `explore` (N carriers) · Trigger: Cancel · Observable: no `remove_tag_globally` sent, `explore` remains on all N sessions
- [ ] 10.14 X2 (test-plan #X2) L3 — see `tests/e2e/session-tags.spec.ts`. Input: keyboard focus in the user-tag group · Trigger: Tab across a chip · Observable: focus reaches the ✕ as a stop distinct from the toggle, accessible name naming action+tag, keyboard-activate opens confirm
- [ ] 10.15 X3 (test-plan #X3) L1 — see `session-meta-handler.test.ts`. Input: sessions carried `explore`, delete applied · Trigger: fresh snapshot/list replay (reconnect) · Observable: replayed snapshot reflects stripped tags
- [ ] 10.16 X4 (test-plan: manual-only) — concurrent `set_session_tags` re-adds `explore` to session A mid-fan-out; last-write-wins re-add persists (documented accepted trade-off; verify manually post-merge)
