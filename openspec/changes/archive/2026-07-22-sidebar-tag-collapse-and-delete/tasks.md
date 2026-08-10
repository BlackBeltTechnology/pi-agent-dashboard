## 1. Protocol (shared)

- [x] 1.1 Add `remove_tag_globally` to `BrowserToServerMessage` in `packages/shared/src/browser-protocol.ts` with `{ type: "remove_tag_globally"; tag: string }`
- [x] 1.2 Rebuild shared types so client + server pick up the new message (server restart, no client build yet) — shared exports resolve `./src/*.ts` directly (no build step)

## 2. Server handler (TDD)

- [x] 2.1 Author the L1 server-handler tests TEST-FIRST (see §10: E3, E4, E5, E6, X3) in `session-meta-handler.test.ts` and confirm they FAIL (red) before implementing 2.2
- [x] 2.2 Implement `handleRemoveTagGlobally` in `packages/server/src/browser-handlers/session-meta-handler.ts`: normalize the inbound tag first (`normalizeTags([tag])[0]`; if `undefined`/empty, early-return no-op), iterate `sessionManager.listAll()` for sessions whose `tags` include it, strip it, reuse the existing `normalizeTags` → `sessionManager.update` → `broadcast(session_updated)` path (no `mergeSessionMeta`)
- [x] 2.3 Wire the handler into the browser-gateway message switch (`packages/server/src/pairing/browser-gateway.ts`) — REQUIRED: an unwired type falls through `default:` → `handlePiGatewayForward` and is misrouted to a bridge
- [x] 2.4 Run the server test file green (`npm test -- session-meta-handler`)

## 3. Client sender

- [x] 3.1 Add `removeTagGlobally(tag: string)` to `packages/client/src/hooks/useSessionActions.ts` sending `{ type: "remove_tag_globally", tag }`

## 4. Chip primitive — destructive remove on filter chips

- [x] 4.1 Extend `TagChip` `filter` variant in `packages/client/src/components/tags/TagChip.tsx`: wrap the existing bare toggle `<button>` + a new `✕` sibling `<button>` in a `<span>`, re-home the `selected` outline ring onto the wrapper, keep the wrapper a single flex-wrap unit (✕ never wraps alone); user-tone only; `aria-label` `Remove tag <label> from all sessions`; ≥24px hit area + focus ring (true sibling → no `stopPropagation` needed)
- [x] 4.2 Confirm `exec` (phase) filter chips never render the remove control (F4 component test)

## 5. Filter group — master collapse + overflow

- [x] 5.1 Refactor `packages/client/src/components/tags/TagFilterGroup.tsx` (or a small wrapper) so both groups render under one master `Tags` collapse header with a chevron, `aria-expanded`, and a `N tags · M phases` count; inner groups become plain sub-labels — master collapse built in `SessionList`
- [x] 5.2 Add overflow cap (10) + `+N more` / `show less` inline expander to the user-tag group (reuse the `TagStrip` `+N` pattern)

## 6. SessionList wiring

- [x] 6.1 Persist master-collapse state to localStorage in `packages/client/src/components/session/SessionList.tsx`; absent state ⇒ collapsed (default)
- [x] 6.2 Add the confirm dialog (names the tag, states carrying-session count incl. cross-folder blast radius, states non-undoable + reappear-if-re-added); on confirm call `removeTagGlobally(tag)` — `TagDeleteConfirmDialog`
- [x] 6.3 Compute the carrying-session count for a tag from the current session list to feed the dialog copy
- [x] 6.4 Active-filter indicator (D8): when `selectedTags`/`selectedPhases` non-empty and the area is collapsed, show an active-selection badge on the master header distinct from the `N tags · M phases` count, plus a clear-filters affordance reachable without unfolding

## 7. Accessibility

- [x] 7.1 Verify keyboard: Tab reaches the ✕ independently of the filter toggle (accept the 2-stops-per-chip cost); both have accessible names; master header toggles via keyboard and exposes `aria-expanded` (X2 component test)
- [x] 7.2 Verify reduced-motion: chevron uses an icon-swap (no rotation); `motion-reduce:transition-none` guard on the chevron

## 8. Verify

- [x] 8.1 `npm test 2>&1 | tee /tmp/pi-test.log && grep -nE 'FAIL|Error|✗' /tmp/pi-test.log` — no new failures (remaining are pre-existing: image-fit/jimp, send-types type-fixture, doctor-route, flaky useImagePaste/directory-service under full-suite concurrency)
- [x] 8.2 `npm run build` (validated by the docker harness image build) + restart (harness healthy on derived port); isolated-verification round-trip default-collapsed / expand / overflow `+N more` / delete → confirm → chip vanishes covered by L3 e2e (E7/E8/X1) + component tests (E1/E2). Dark+light visual pass deferred to manual QA (test-plan: manual-only).
- [x] 8.3 Update the `packages/client/src/components/tags/AGENTS.md` rows for `TagChip`/`TagFilterGroup` and add a `remove_tag_globally` note to the server + shared protocol AGENTS rows

## 9. QA scenarios (manual, tested later)

- [ ] 9.1 (test-plan: manual-only) Deleted tag reappears after a session re-adds it via `TagEditor` (derived-union behavior is intentional)

## 10. Test scenarios (folded from test-plan.md — one task per manifest row)

- [x] 10.1 E1 (test-plan #E1) — overflow cap is a pure `TagFilterGroup` render; realized as a component test in `tags-components.test.tsx` (deterministic vs seeding 10 sessions in Playwright). Input: 10 user tags · Trigger: render · Observable: 10 chips, NO `+N more`
- [x] 10.2 E2 (test-plan #E2) — component test in `tags-components.test.tsx`. Input: 13 user tags · Trigger: `+3 more` then `show less` · Observable: 10 + `+3 more` → all 13 + `show less` → back
- [x] 10.3 E3 (test-plan #E3) L1 — see `session-meta-handler.test.ts`. Input: 5 sessions, 3 carry `explore`, 2 do not · Trigger: `remove_tag_globally { tag: "explore" }` · Observable: 3 carriers stripped, exactly 3 `session_updated`, 2 non-carriers unmodified + no broadcast
- [x] 10.4 E4 (test-plan #E4) L1 — see `session-meta-handler.test.ts`. Input: no session carries `ghost` · Trigger: `remove_tag_globally { tag: "ghost" }` · Observable: 0 modified, 0 broadcast
- [x] 10.5 E5 (test-plan #E5) L1 — see `session-meta-handler.test.ts`. Input: sessions carry `explore` · Trigger: `remove_tag_globally { tag: "   " }` · Observable: normalized empty ⇒ 0 modified, 0 broadcast
- [x] 10.6 E6 (test-plan #E6) L1 — see `session-meta-handler.test.ts`. Input: sessions carry normalized `explore` · Trigger: `remove_tag_globally { tag: "  Explore " }` · Observable: normalizes to `explore`, all carriers stripped, one broadcast per carrier
- [x] 10.7 E7 (test-plan #E7) L3 — see `tests/e2e/session-tags.spec.ts`. Input: no stored fold key · Trigger: sidebar first render · Observable: collapsed, both groups hidden, header `aria-expanded="false"` + `N tags · M phases`
- [x] 10.8 E8 (test-plan #E8) L3 — see `tests/e2e/session-tags.spec.ts`. Input: area toggled then reloaded · Trigger: expand→reload; collapse→reload · Observable: reload preserves the last fold state
- [x] 10.9 F1 (test-plan #F1) L3 — see `tests/e2e/session-tags.spec.ts`. Input: two browser contexts, a session carries `explore` · Trigger: context A confirms delete · Observable: context B's card converges to `explore` absent via `session_updated`, no reload
- [x] 10.10 F2 (test-plan #F2) — remove≠toggle is a pure `TagChip` render; component test in `tags-components.test.tsx` (click ✕ → onRemove fires, onToggle does not). Input: unselected user filter chip · Trigger: click ✕ · Observable: remove handler fires, toggle untouched
- [x] 10.11 F3 (test-plan #F3) L3 — see `tests/e2e/session-tags.spec.ts`. Input: a tag filter selected · Trigger: collapse the area · Observable: collapsed header shows an active-selection indicator distinct from the count + a clear control that resets the filter without unfolding
- [x] 10.12 F4 (test-plan #F4) — phase-read-only is a pure render; component test in `tags-components.test.tsx`. Input: exec-tone chip/group · Trigger: render · Observable: NO remove control
- [x] 10.13 X1 (test-plan #X1) L3 — see `tests/e2e/session-tags.spec.ts`. Input: ✕ dialog open for `explore` (N carriers) · Trigger: Cancel · Observable: no `remove_tag_globally` sent, `explore` remains on all N sessions
- [x] 10.14 X2 (test-plan #X2) — keyboard operability of the ✕ is a pure `TagChip` render; component test in `tags-components.test.tsx` (focusable, distinct accessible name, keyboard-activates onRemove). Input: focus the ✕ · Trigger: activate · Observable: remove handler fires
- [x] 10.15 X3 (test-plan #X3) L1 — see `session-meta-handler.test.ts`. Input: sessions carried `explore`, delete applied · Trigger: fresh snapshot/list replay (reconnect) · Observable: replayed snapshot reflects stripped tags
- [ ] 10.16 X4 (test-plan: manual-only) — concurrent `set_session_tags` re-adds `explore` to session A mid-fan-out; last-write-wins re-add persists (documented accepted trade-off; verify manually post-merge)
