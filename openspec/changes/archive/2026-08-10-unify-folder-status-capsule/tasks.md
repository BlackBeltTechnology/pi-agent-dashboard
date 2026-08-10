# Tasks — unify-folder-status-capsule (D2)

## 1. Ground truth

- [x] 1.1 Enumerate every render site of the three counters: raw `(N)` session count, `FolderNeedsYouPill.tsx`, `FolderStatusRollup.tsx`. Record each caller in `SessionList.tsx` and the collapse-state condition that gates the rollup today.
- [x] 1.2 Record the existing test ids and every unit/E2E consumer of them (`rg` for the pill/rollup test ids across `packages/client/src/**/__tests__` and `tests/e2e/`).
- [x] 1.3 Confirm the severity source of truth: where needs-you / error / working / idle are already derived per session. Reuse it — this change re-presents state, it does not recompute it.
- [x] 1.4 Confirm the token family: `--status-*` (session status, consumed by the card dot and both outgoing components) vs `--severity-*` (toast/banner). The capsule uses `--status-*`; using `--severity-*` would turn `working` orange against the card's yellow and has no purple member at all.
- [x] 1.5 Confirm `group.sessions` contains hidden sessions (`SessionList.tsx:1266` re-filters `!s.hidden`) — the capsule must exclude them, which lowers some counts vs today's pill/rollup. Record this as an intended behaviour change.
- [x] 1.6 Read `isChatRoutedAskUser`'s signature: `hasWidgetBarPrompt = false` means an `undefined` classification coerces to "not widget-bar" → `needs-you`. This is why needs-you cannot be delegated to `deriveStatusShape`. Note also that `isChatRoutedAskUser` does NOT check the error flag — `deriveStatusShape` checks it first (line 148) — so a hand-written needs-you predicate must re-add that guard.
- [x] 1.7 Read the existing reveal machinery (`revealRequest` / `onSeekToCard` / `findLaidOutCard` / `classifyDegrade`, `SessionList.tsx:772-940`) — activation reuses it rather than hand-rolling expand-then-scroll, and X1/X2 assert its existing degrade notice.

## 2. Tests first (red) — folded from test-plan.md

Author these before any implementation and verify each fails. Every row below maps to exactly one manifest scenario.

### 2a. Counting logic — L1, extend `packages/client/src/lib/__tests__/session-status-visuals.test.ts` (see its existing `countStatusRollup` block for harness glue)

- [x] 2.1 Severity order is fixed, not magnitude-driven: folder with 1 needs-you, 9 error, 1 working, 1 idle · capsule counts and renders · segments emit in order needs-you, error, working, idle (test-plan #E1)
- [x] 2.2 Order holds with gaps: folder with only error + idle · capsule renders · error precedes idle with no empty slot between them (test-plan #E2)
- [x] 2.3 Ended-with-stale-notice is excluded: session `status: ended` whose notice flag is still set · counting pass runs · session appears in no bucket (test-plan #E6)
- [x] 2.4 Hidden sessions excluded: folder of 3 visible + 4 hidden sessions in mixed states · counting pass runs · only the 3 visible are counted (test-plan #E7)
- [x] 2.5 Unclassified widget-bar probe excluded everywhere: `ask_user` session whose classification is `undefined` · counting pass runs · counted in no bucket, neither needs-you nor idle (test-plan #E8)
- [x] 2.6 Widget-bar-placed prompt is not an all-clear: `ask_user` session classified `true` · counting pass runs · counted in no bucket, specifically absent from idle (test-plan #E9)
- [x] 2.7 Error outranks needs-you: `ask_user` session also present in `errorSessionIds` · counting pass runs · counted exactly once in error, needs-you is 0 (test-plan #E10)
- [x] 2.8 Retry is working: one session in `retrySessionIds` and no other live sessions · counting pass runs · working = 1, error = 0 (test-plan #E11)
- [x] 2.9 Notice is not dropped: one idle session in `noticeSessionIds` · counting pass runs · idle = 1 (test-plan #E12)
- [x] 2.10 Malformed flags do not throw: `errorSessionIds` / `noticeSessionIds` passed as `undefined` · counting pass runs · completes and buckets on remaining signals, no throw (test-plan #X3)
- [x] 2.11 Counting budget: folder of 1000 sessions spanning every status, half `ask_user` with a populated widget-bar map · counting pass runs · wall time < 5 ms, median of 5 runs (test-plan #P1)

### 2b. Capsule component — L1, new `packages/client/src/components/__tests__/FolderStatusCapsule.test.tsx` (copy harness glue from `FolderNeedsYouPill.test.tsx`, whose probe-timing setup this file must inherit)

- [x] 2.12 Only-idle folder: 12 idle sessions and nothing else · capsule renders · exactly one segment renders, the idle one (test-plan #E3)
- [x] 2.13 Zero-session folder: folder with 0 sessions · header renders · no `folder-status-capsule-<cwd>` element in the DOM (test-plan #E4)
- [x] 2.14 All-ended folder: 5 sessions all `ended` · header renders · no capsule element, and the `N ended` disclosure row still reports 5 (test-plan #E5)
- [x] 2.15 Count below cap: segment counting 999 · capsule renders · segment text is exactly `999` (test-plan #E13)
- [x] 2.16 Count above cap: segment counting 1000 · capsule renders · segment text is exactly `999+` (test-plan #E14)
- [x] 2.17 Idle segment inert but named: capsule rendering an idle count · keyboard tabs through the header · idle segment never receives focus and still exposes an accessible name stating the state (test-plan #F5)
- [x] 2.18 Distinct segment labels: capsule with all four segments · accessibility tree read · each non-idle segment has a distinct name stating both count and state (test-plan #F6)
- [x] 2.19 Token identity with the card dot: capsule working segment plus a working session card · both render · both reference the same `--status-working` custom property, asserted as token identity not pixel equality (test-plan #F8)

### 2c. Header composition — L1, extend `packages/client/src/components/__tests__/SessionList.test.tsx`

- [x] 2.20 Capsule is the only liveness surface: any folder with sessions · header renders · no raw `(N)` count, no needs-you pill element, no status rollup element present (test-plan #E15)

### 2d. Rendered behaviour — L3, extend the Playwright suite (copy harness glue from `tests/e2e/folder-membership-drag.spec.ts`, the nearest folder-sidebar spec; read the harness port from `.pi-test-harness.json` `dashboardPort`, never hardcode)

- [x] 2.21 Capsule survives expansion: folder with mixed live states, initially collapsed · user expands it · capsule remains present with identical segment counts across the transition (test-plan #F1)
- [x] 2.22 Segment navigates: collapsed folder with ≥1 errored session · user activates the error segment · folder converges to expanded and the first errored session becomes selected (test-plan #F2)
- [x] 2.23 Activation does not toggle the row: expanded folder whose header row has its own click handler · user activates any segment · folder stays expanded, the row handler does not fire (test-plan #F3)
- [x] 2.24 Scroll waits for the mount: collapsed folder whose target card mounts only when expanded · user activates a segment · target card converges to scrolled-into-view rather than silently no-oping (test-plan #F4)
- [x] 2.25 No wrap under width pressure: folder with a long name and all four segments present (one session each) · sidebar narrowed to 220 px · capsule stays on one row with every segment present and the name truncates (test-plan #F7 — workload relaxed from 3-glyph counts, which needed 400+ real sessions; see the note under the manifest table)
- [x] 2.26 Needs-you count converges upward only: folder mounting with 3 `ask_user` sessions whose probes resolve on a later tick · folder first paints · the needs-you count never exceeds its settled value at any observed frame (test-plan #F9)
- [x] 2.27 Filtered target degrades: an active session-search filter excludes the segment's target · user activates that segment · the reveal path's existing filtered-target notice is surfaced, not a silent no-op (test-plan #X1)
- [x] 2.28 Hidden target degrades: `showHidden` off while the only session of a counted state is hidden · user activates that segment · either the state is not counted per #E7, or the hidden-target notice is surfaced — never a silent no-op (test-plan #X2)

- [x] 2.29 Verify every test in section 2 fails before implementation begins.

## 3. Implement

- [x] 3.1 Add `countStatusCapsule(sessions, flags)` to `session-status-visuals.ts`: pre-filter `status === "ended"`, `hidden`, and widget-bar-blocked/unclassified `ask_user` BEFORE deriving (the `hasNotice` branch short-circuits ahead of the status check); needs-you via its OWN predicate (`ask_user && !ended && !hasError && widgetBar(id) === false`), never via `deriveStatusShape`; map the `notice` shape to the `idle` bucket; return counts plus the first session id per bucket, both from the SAME `group.sessions`-ordered list.
- [x] 3.2 Add `packages/client/src/components/folder/FolderStatusCapsule.tsx` with test id `folder-status-capsule-<cwd>` and per-segment `folder-capsule-seg-{needs-you,working,error,idle}-<cwd>`. Move the `WidgetBarProbe` mechanism over verbatim, keeping absent-means-excluded.
- [x] 3.3 Colours from the `--status-{needs-you,working,idle,error}` tokens. Assert no new custom property lands in `index.css`.
- [x] 3.4 Cap segment counts at `999+`.
- [x] 3.5 Wire into `SessionList.tsx` header composition, unconditional on collapse state; thread `errorSessionIds` / `retrySessionIds` / `noticeSessionIds` into the header; delete the raw `(N)` count render.
- [x] 3.6 Activation: `stopPropagation`, then route through the EXISTING reveal path (`onSeekToCard` / `revealRequest`) rather than a bespoke expand-then-`requestAnimationFrame` — it already owns guarded expand, layout-settled detection, the backstop timer, and the degrade notices X1/X2 assert.
- [x] 3.7 Capsule is `flex: none`, non-wrapping, sheds nothing; the folder name absorbs the squeeze.
- [x] 3.8 Delete `FolderNeedsYouPill.tsx`, `FolderStatusRollup.tsx` and `countStatusRollup` plus their exports and tests, once 1.1/1.4 confirm no other caller.

## 4. Migrate consumers

- [x] 4.1 Update every unit test found in 1.2 to the new segment ids; port `FolderNeedsYouPill`'s probe-timing assertions onto the capsule BEFORE deleting the component.
- [x] 4.2 Update E2E specs anchoring on the old ids or the raw session count.
- [x] 4.3 Before authoring the L3 rows, check `tests/e2e/` for an existing helper that seeds a folder with sessions in specific states (errored, `ask_user`, retrying). Extend it rather than building a parallel fixture.

## 5. Docs + verify

- [x] 5.1 Update `packages/client/src/components/folder/AGENTS.md`: add the `FolderStatusCapsule.tsx` row, remove the two deleted rows. Delete orphaned `*.AGENTS.md` sidecars.
- [x] 5.2 `npm run quality:changed`; `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log` and diff the failure set against the pre-change baseline — zero new failures.
- [x] 5.3 `npx openspec validate --changes unify-folder-status-capsule --strict`.
- [x] 5.4 Capsule visual density beside the menu trigger: look at a real sidebar with several folders in mixed states and confirm the capsule reads as one control and the purple needs-you signal still pre-attentively dominates (test-plan: manual-only)
- [x] 5.5 Run `review-code` on the diff before commit.
