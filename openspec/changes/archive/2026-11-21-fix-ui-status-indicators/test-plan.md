# Test Plan — fix-ui-status-indicators

Stage: design   Generated: 2026-11-20

Decisions applied (settled, owner): D1 `↓ in / ↑ out` everywhere; D2 ended+stale error stays in ended bucket, `Failed` only for idle/active; D4 chip `127.0.0.1:<port><path>`, left-aligned, capped title + full tooltip.

Harness exemplars (all verified to exist). `SessionCard.test.tsx` does not exist — card render tests target `SessionCard-status-shape.test.tsx`.
Gap decisions applied (owner, accepted): G1 overlay error panel names raw `claim.pluginId` only; G2 board cwd change clears list + shows loading, then last-request-wins (stale responses ignored); G3 chip address/tooltip omit a root `/` path (current behaviour).
- H-pure  `packages/client/src/components/session/__tests__/session-card-header-pure.test.tsx`
- H-card  `packages/client/src/components/session/__tests__/SessionCard-status-shape.test.tsx` (also `SessionCard.ended-reason.test.tsx` for ended)
- H-lane  `packages/client/src/lib/__tests__/session-lanes.test.ts`
- H-i18n  `packages/client/src/components/folder/__tests__/FolderActionBanner.i18n.test.tsx`
- H-flow  `packages/flows-plugin/src/__tests__/flow-agent-cost.test.tsx`
- H-chat  `packages/client-utils/src/minimal-chat/__tests__/MinimalChatView.test.tsx`
- H-osb   `packages/client/src/components/__tests__/OpenSpecBoardView.test.tsx`
- H-board `packages/automation-plugin/src/__tests__/AutomationBoard.test.tsx`
- H-overlay `packages/dashboard-plugin-runtime/src/__tests__/shell-overlay-route-presentation.test.tsx`
- H-slot  `packages/dashboard-plugin-runtime/src/__tests__/slot-consumers.test.tsx`
- H-chip  `packages/client/src/components/__tests__/CanvasDriver.test.tsx`
- H-e2e   `tests/e2e/canvas-chip-tray-overlay.spec.ts`

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable | harness |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|---------|
| S1 | session-card-status: idle run names failure | decision-table (idle,hasError) | L1 | automated | `activityContent(session{status:"idle",currentTool:undefined}, …, hasError=true)` | render result | text "Failed" + error glyph (`statusShapeIcon.error`, `--status-error`); no "Idle" | H-pure |
| S2 | same, `active` partition | equivalence-partition (idle vs active) | L1 | automated | `status:"active"`, no currentTool, hasError=true | `activityContent` render | text "Failed", no "Idle" | H-pure |
| S3 | session-card-status: mobile line 2 | decision-table | L1 | automated | mobile `SessionCard` (mobile breakpoint mock as in exemplar), `status:"idle"`, `hasError` prop true | render | mobile line-2 activity text "Failed" + glyph, no "Idle"; also exported `ActivityIndicator hasError` renders "Failed" | H-card |
| S4 | session-card-header: desktop status row | decision-table | L1 | automated | desktop `SessionCard`, `status:"idle"`, no currentTool, hasError true | render | `session-card-meta` (status row) contains `Failed`, not `Idle` | H-card |
| S5 | ask-user-card-indicator: Idle scoped to no-error (default arg) | BVA (hasError false/omitted) | L1 | automated | `activityContent` called with the legacy 3 args; and with hasError=false | render | text "Idle" muted, not "Failed", not "Waiting for input" | H-pure |
| S6 | Retry outranks Failed | decision-table | L1 | automated | `retryState` attempt 2, hasError true, status idle | render | text `Retry 2`; no "Failed" | H-pure |
| S7 | Streaming outranks Failed | decision-table | L1 | automated | `status:"streaming"`, hasError true (stale lastError) | render | thinking label; no "Failed" | H-pure |
| S8 | Current tool outranks Failed (design D2) | decision-table | L1 | automated | `status:"idle"`/`active`, `currentTool:"bash"`, hasError true | render | text `bash`; no "Failed" | H-pure |
| S9 | Needs-you / Resuming outrank Failed (design D2) | decision-table | L1 | automated | (a) `hasWidgetBarPrompt` pending + hasError; (b) resuming + hasError | render | "Needs you" / "Resuming" label respectively; no "Failed" | H-pure |
| S10 | Ended keeps reason pill (D2) | decision-table | L1 | automated | `status:"ended"`, `closedReason:"process_gone"`, hasError true | render | ended-reason pill; no "Failed" | H-card (`SessionCard.ended-reason.test.tsx`) |
| S11 | Lane regression: live errored session | decision-table | L1 | automated | `status:"idle"`, hasError true | `classifyStatusLane` | `error` lane | H-lane |
| S12 | Lane: ended + stale error stays ended (D2 non-goal) | decision-table | L1 | automated | `status:"ended"`, hasError true | `classifyStatusLane` | NOT `error`; ended bucket unchanged | H-lane |
| S13 | `Failed` is localized (`common.failed` reused, no new catalog edit) | equivalence-partition (en vs hu/zh-CN) | L1 | automated | locale `hu` (then `zh-CN`), idle+hasError card | render | label equals catalog `common.failed` for that locale, not the English fallback | H-i18n |
| S14 | Token arrows: SessionCard `TokenStats` | BVA (nonzero in/out) | L1 | automated | `tokensIn:12000,tokensOut:3000` | render `TokenStats` | `12k↓ 3k↑` (input arrow ↓ on input, ↑ on output); never `↑` after input | H-card |
| S15 | Token arrows: only-one-side nonzero | BVA (0 / >0 boundary) | L1 | automated | (a) `tokensIn:0,tokensOut:500`; (b) both 0 | render `TokenStats` | (a) `0↓ 500↑` (current zero-formatting kept, arrow order flipped); (b) renders null | H-card |
| S16 | Token arrows: cache-read stays on input counter | equivalence-partition | L1 | automated | `tokensIn:1000, cacheRead:5000` | render `TokenStats` | `R5k` chip still rendered; arrows unchanged (↓ in / ↑ out); no cache arrow added | H-card |
| S17 | Token arrows: OpenSpecBoardView session row | BVA | L1 | automated | session row `tokensIn:48000,tokensOut:12000`, `cost 0.41`, phase 9/14 | render board row | `48k↓ 12k↑ … $0.41` (matches openspec-card-section spec) | H-osb |
| S18 | Token arrows: MinimalChatView / shared-timeline header | BVA | L1 | automated | `meta.tokens{input:1200,output:567}`, `durationMs:4500` | render | `↓1.2k ↑567 · 4.5s` (replaces existing `↑…↓…` assertion at :141-151) | H-chat |
| S19 | Token arrows: FlowAgentCard stats line, with cost | decision-table (cost present/absent/0) | L1 | automated | complete agent `tokens{input:12000,output:3000}`; cost 0.0142 / 0 / undefined | render | `↓12k ↑3k · $0.0142 · 4.2s`; cost 0/undefined → `↓12k ↑3k · 4.2s`, no leftover separator | H-flow |
| S20 | Token arrows: flow-agent-detail header + flow-card-grid card | equivalence-partition (detail vs grid surface) | L1 | automated | complete agent 12000/3000 shown in detail header and in grid card | render both | `↓in ↑out` in both surfaces (`✓ … ↓12k ↑3k …`) | H-flow (`flow-dashboard-agent-cards.test.tsx` for grid) |
| S21 | Board: pending fetch shows loading | state-transition (mount → loading) | L1 | automated | `fetchAutomations` never settles | mount `AutomationBoard` | `automation-loading` visible; no `automation-empty`; board chrome rendered | H-board |
| S22 | Board: failed fetch (503 / reject) → error + Retry | decision-table (503 result, rejected promise) | L1 | automated | `fetchAutomations` → `{ok:false}` then rejected | mount | `automation-error` + Retry button; no "No automations in this folder"; no `automation-empty`; `listRuns` not called | H-board |
| S23 | Board: Retry recovers | state-transition (error → loading → ready) | L1 | automated | first fetch fails, next returns 2 defs | click Retry | `automation-loading` shown until settle, then 2 cards render, `automation-error` gone | H-board |
| S24 | Board: empty success vs error | equivalence-partition (0 defs vs failed) | L1 | automated | `{ok:true,automations:[]}` | mount | `automation-empty` with Create action; no `automation-error` | H-board |
| S25 | Board: mutation refresh revalidates in place | state-transition (ready → ready) | L1 | automated | loaded board with 1 running def; `onStop` returns a notice | click Stop; `finally{refresh()}` fires | list stays rendered, no `automation-loading` at any point, stop notice still shown after refresh | H-board |
| S26 | Board: failed reload clears list (Retry or mutation) | state-transition (ready → error) | L1 | automated | loaded board; next `fetchAutomations` → `{ok:false}` (triggered by mutation refresh) | mutation refresh | `automation-error` shown; previous cards removed; `listRuns` calls skipped | H-board |
| S27 | `listAutomations` unchanged for FolderAutomationSection | regression (compat) | L1 | automated | `listAutomations` 503 | render `FolderAutomationSection` | still swallows to `[]` (existing behaviour) — existing test must pass unmodified | `packages/automation-plugin/src/__tests__/FolderAutomationSection.test.tsx` (verify path at apply) |
| S28 | Overlay: claim without Component | equivalence-partition | L1 | automated | `shell-overlay-route` claim, `Component` undefined | open route | `overlay-claim-error` + Back; Back click → `onBack` called once | H-overlay |
| S29 | Overlay: lazy claim chunk rejects | equivalence-partition | L1 | automated | `React.lazy` whose import rejects | open route | `overlay-claim-error` text contains the claim's raw `pluginId` (no manifest lookup, no `error.message` text) + Back; overlay not empty (G1 → a) | H-overlay |
| S30 | Overlay: component throws on render | equivalence-partition | L1 | automated | claim component throws | open route; click Back | `overlay-claim-error`; `onBack` called | H-overlay |
| S31 | Overlay: still-pending lazy claim | state-transition | L1 | automated | lazy import never settles | open route | `content-claim-loading` with `aria-busy="true"`; no `overlay-claim-error` | H-overlay |
| S32 | Other slots stay silent | regression (default fallback null) | L1 | automated | `session-card-badge` claim throws, sibling claim healthy | render slot | slot renders nothing for the failed claim; sibling still renders; no `overlay-claim-error` in DOM | H-slot |
| S33 | Chip: label capped, full title/address in tooltip + accessible name | BVA (title length ≤32 / >32 chars) | L1 | automated | chip titled "Saját jóváhagyó csoportok — A + C — a very long page title", port 57783, path `/x` (and a ≤32-char title) | render chip | label span has `max-w-[32ch]` + `truncate`; `title`/`aria-label` = `<title> — 127.0.0.1:57783/x` + "Tap to probe 127.0.0.1 and open a restricted preview"; short title identical string form; address/tooltip end at `<port><path>` for non-root paths | H-chip |
| S34 | Chip: address never shrinks, path truncates | equivalence-partition (host:port vs path) | L1 | automated | long path | render | `127.0.0.1:<port>` span has `shrink-0`; path is a separate truncating span | H-chip |
| S35 | Chip: `127.0.0.1` host is fixed, not chip data | error-guessing (security S29 invariant) | L1 | automated | chip data containing a hostile `host`-like field / title "evil.com:80" | render | address text still starts `127.0.0.1:<port>`; title only appears in label/tooltip, never in address | H-chip |
| S36 | Chip: slot tray left-aligned; fallback unchanged | decision-table (slot vs fallback) | L1 | automated | (a) anchor present; (b) no anchor | render `CanvasDriver` | (a) tray lacks `items-end`, has `items-start`; (b) fallback tray still `items-end`, fixed bottom-right | H-chip |
| S37 | Chip: rendered left edge = dock inset; width cap at real layout | BVA (cap 32ch at real font) | L3 | automated | session open with in-column anchor, server chip with long title, desktop 1200×800 | load page, measure | chip left ≈ `composer-stack-anchor` left (±1px); label box width ≤ 32ch; address fully visible (`scrollWidth==clientWidth`) | H-e2e |
| S51 | auto-canvas: address for root/absent path (G3 → a) | BVA (path `/` / absent / `/x`) | L1 | automated | chip port 57783 with path `/` (and, separately, path absent) | render chip | visible address `127.0.0.1:57783` (no trailing `/`); `title`/`aria-label` = `<title> — 127.0.0.1:57783` + probe hint, identical address text to the visible one; path `/x` still renders `127.0.0.1:57783/x` | H-chip |

### Performance

None applicable — proposal states no latency/throughput budget; changes are presentational/state-label only. (Existing `SessionCard.history-ring-perf.test.tsx` and `SessionCard.host-pressure.test.tsx` are run unchanged as regression guards; no new row.)

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) | harness |
|----|-------------|-----------|-------|-------------|-------|---------|--------------------------------|---------|
| S38 | automation-content-view: no loading flash on mutation refresh | state-transition | L1 | automated | loaded board; any mutation (delete, toggle enabled, run now, create) | refresh | `automation-loading` never present in any intermediate DOM snapshot; card-local state (expanded, menu open) survives | H-board |
| S39 | Retry double-click / re-entrancy | error-guessing | L1 | automated | board in error; Retry clicked twice fast | click ×2 | converges to the single settled result (ready w/ defs), no duplicate card rows, no stuck `automation-loading` | H-board |
| S40 | Board: cwd change while loading | state-transition (race) | L1 | automated | fetch for cwd A pending (separately: A later rejects); props switch to cwd B; B resolves, then A settles | resolve out of order | on cwd change the list is cleared and `automation-loading` shown (no cwd-A card visible); A's late response — success or failure — is ignored (last-request-wins); final DOM = cwd B's list, no `automation-error` from A (G2 → c) | H-board |
| S41 | Overlay Back is keyboard-operable | error-guessing (a11y) | L1 | automated | `overlay-claim-error` shown | tab to Back, press Enter | Back is a `button` role with accessible name; Enter calls `onBack` | H-overlay |
| S42 | Error panel/`Failed` label survives narrow width | boundary (375px) | L3 | automated | errored idle session card in sidebar at 375px (mobile) and desktop | render | `Failed` visible, ellipsized not wrapped; card does not overflow horizontally (status row `min-w-0`) | `tests/e2e/compact-session-card-header.spec.ts` |
| S43 | `Failed` glyph/colour reads as error (hue, contrast) | visual/subjective | — | manual-only | errored idle card in light + dark theme | human looks | [judgment: error glyph tint `--status-error` legible and consistent with the shape on the left — no automatable observable beyond S1 class check] | — |
| S44 | Token arrow direction reads naturally across surfaces | visual/subjective | — | manual-only | header `TokenStatsBar`, session card, board row, minimal chat header, flow card | human looks | [judgment: same convention everywhere, no surface looks inverted] | — |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable | harness |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|---------|
| S45 | board: HTTP non-2xx (403/503) is not "empty" | fault-injection (abort/error response) | L1 | automated | `/api/plugins/automation/list` → 503, then 403 | mount board | `fetchAutomations` returns `{ok:false,error}`; `automation-error` + Retry; never "No automations in this folder" | H-board (+ `api.ts` unit test beside it) |
| S46 | board: network reject / malformed JSON body | fault-injection (abort) | L1 | automated | `fetch` rejects; separately 200 with non-JSON | mount board | `{ok:false}`; `automation-error`; no unhandled rejection | H-board |
| S47 | board: Retry fails again | fault-injection (repeat) | L1 | automated | error state; next fetch also fails | click Retry | `automation-loading` shown, then back to `automation-error`; Retry still enabled | H-board |
| S48 | overlay: lazy claim chunk load failure end-to-end (#1155 repro) | fault-injection (abort chunk request) | L3 | automated | open `/folder/:encodedCwd/automations`, abort the claim's chunk request via Playwright route | navigate | visible `overlay-claim-error` + Back (not blank); Back returns to folder view | `tests/e2e/route-backed-overlay.spec.ts` |
| S49 | board: server restart/outage while board open (#1155) | fault-injection (delay then abort) | L3 | automated | open board on running harness; kill/503 `/api/plugins/automation/list` via route | open route | `automation-loading` then `automation-error` + Retry; restoring route + Retry shows the definitions | `tests/e2e/route-backed-overlay.spec.ts` (nearest route-overlay spec) |
| S50 | overlay: throwing claim doesn't take down the shell | fault-injection (throw) | L1 | automated | overlay claim throws | open route | error panel contained within overlay; shell chrome (rest of tree) still mounted; Back works | H-overlay |

---

## Coverage summary
- Requirements covered: 11/11 delta specs (session-card-status, session-card-header, ask-user-card-indicator, flow-agent-card, flow-agent-detail, flow-card-grid, shared-timeline-view, openspec-card-section, shell-overlay-route, automation-content-view, auto-canvas). `token-stats-bar` intentionally untouched (no row; existing `TokenStatsBar.test.tsx` runs unchanged).
- Scenarios by class: edge 38 (S1–S37, S51) · perf 0 · frontend 7 (S38–S44) · error 6 (S45–S50)
- Scenarios by level: L1 45 · L2 0 · L3 4 (S37, S42, S48, S49) · manual-only 2 (S43, S44)
- Scenarios by disposition: automated 49 · manual-only 2

## New infra needed
- none (all exemplars exist). S48/S49 need Playwright route-abort of the lazy claim chunk / `/api/plugins/automation/list`; seeding an errored idle session for S42 reuses the session-injection helpers in `compact-session-card-header.spec.ts`.
- New test files (no new harness): `SessionCard.failed-i18n.test.tsx` (S13, modelled on `FolderActionBanner.i18n.test.tsx`) and `automation-fetch.test.ts` (S45, stubs global `fetch`).
- S10 relies on `hasError` being passed by the caller.
