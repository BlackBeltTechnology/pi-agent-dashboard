# Tasks — gate-notify-rows-by-level (D1 · D2 · D3)

## 1. Ground truth — confirm the gap and the discriminator

- [ ] 1.1 Confirm notify rows are ungated: read `ChatView.isRowVisible` case `"interactiveUi"` (~line 490) — it returns `true` for everything except `isWidgetBarPrompt`. No `DisplayPrefs` field reaches it.
- [ ] 1.2 Confirm the discriminator: `event-reducer.ts` `addNotify` stamps `content: "notify"` AND `args.method === "notify"`, id `ui-<notifyId>`, and appends NO `interactiveRequests` entry (that absence is what proves nothing blocks on it).
- [ ] 1.3 Confirm the level vocabulary is exactly `info | success | warning | error` (`shared/src/notify.ts` `NOTIFY_LEVELS`, `normalizeNotifyLevel` → `"info"` fallback) and that `NotifyRenderer.levelColors` covers all four.
- [ ] 1.4 Confirm `params.level` may be ABSENT (`addNotify` spreads it conditionally) and that `NotifyRenderer` also accepts a legacy `params.title` fallback for rows reduced from a pre-split `prompt_request`. Both shapes must survive the gate.
- [ ] 1.5 Confirm `NotifyMessage` (`shared/src/protocol.ts:446`) carries NO emitter identity — this is what puts per-extension muting out of scope (D6). Record the finding; do not add the field in this change.
- [ ] 1.6 Read `rawEvent` as the reference implementation of a two-site gate: `ChatView.tsx` ~497 (`isRowVisible`) and ~1183 (render branch). Both, or the virtualizer desyncs (D3).
- [ ] 1.7 Confirm the renderer gap: `NotifyRenderer.tsx` `levelColors` hardcodes `text-blue-400` / `green-400` / `yellow-400` / `red-400`, and `message-severity-tokens`' "No raw severity color literals" requirement enumerates `Toast.tsx`, `SpawnErrorToastHost.tsx`, `SpawnErrorBanner.tsx`, `extension-ui/ToastSlot.tsx` — NOT this file. It was missed, not exempted.
- [ ] 1.8 Confirm `--severity-success-*` exists in `index.css` and `rg` shows **zero** current consumers — notify is the first (D8).
- [ ] 1.9 Read `message-severity-tokens`' contrast requirement before writing any contrast test: the gate is a **relative 3:1 floor + majority-AA across 18 theme·mode combos**, NOT absolute AA. Do not assert 4.5:1-everywhere; the spec explains why that is unsatisfiable.

## 2. Tests first (red) — folded from `test-plan.md`

Every task below is one manifest row. Author each before implementation and
verify it fails. The manifest (`test-plan.md`) — not any tag here — is the
source of truth for automated vs manual.

### 2a. Shared predicate — L1, `packages/shared/src/__tests__/display-prefs.test.ts`

Harness exemplar for all of 2a: the existing preset/merge cases in that same
file (`display-prefs.test.ts`) — copy their import + assertion style.

- [ ] 2.1 Ladder truth table: one notify row per level (`info`/`success`/`warning`/`error`) · predicate evaluated across all 4 levels × 4 floors · all 16 cells match `rank(level) >= rank(floor)`, and at `"success"` the `info` row is the only hidden one (test-plan #E1)
- [ ] 2.2 Error floor: a row with `level:"error"` · predicate run once per legal floor · `true` for all four; no legal floor yields `false` (test-plan #E2)
- [ ] 2.3 Unrecognized level: rows whose `params.level` is absent / `null` / `42` / `"critical"` / `""` · evaluated at `"success"` then `"all"` · every variant hidden at `"success"` and visible at `"all"`, i.e. each ranked as `info` (test-plan #E3)
- [ ] 2.4 Unrecognized FLOOR fails open: floors `"oops"`, `""`, `undefined`, plus the singular near-miss typos `"warning"` and `"error"` · evaluated for all four levels · every row visible for every bad floor **including `error`**, and the singular typos are treated as unrecognized rather than as their plural twins (test-plan #E4)
- [ ] 2.5 Presets: the `DISPLAY_PRESETS` map · each of `simple`/`standard`/`everything` read · all three define `notifyMinLevel` and all equal `"all"` (test-plan #E5)
- [ ] 2.6 Merge both directions: global `"all"` + override `"errors"`, then global `"warnings"` + override omitting the field · `mergeDisplayPrefs` evaluated · yields `"errors"` then `"warnings"` (test-plan #E6)
- [ ] 2.7 Fail-open on non-notify rows: `interactiveUi` rows for `select`/`confirm`/`input`/`ask_user` · evaluated at `"errors"` · every one visible (test-plan #E9)
- [ ] 2.8 Discriminator is an AND: four rows covering `content === "notify"` × `args.method === "notify"` (both / each alone / neither) · evaluated at `"errors"` with `level:"info"` · only the both-true row hides; the two half-matches and the no-match render (test-plan #E10)
- [ ] 2.9 Legacy payload parity: a notify carrying only `params.title`, `level:"info"` · evaluated at `"warnings"` · hidden by exactly the same rule as a `params.message` row (test-plan #E11)
- [ ] 2.10 Call-shape equivalence: the same logical notify expressed as the `isRowVisible` object (`msg.args.method`) and the render-branch object (`request.method`) · predicate called with each · identical verdict at every floor (test-plan #E12)

### 2b. Server persistence — L1, `packages/server/src/__tests__/preferences-store.test.ts`

Harness exemplar for all of 2b: the existing backfill cases in that same file.

- [ ] 2.11 Backfill: a `displayPrefs` object omitting `notifyMinLevel` · store loads it · value is `"all"`, and no path exposes `undefined` to a client (test-plan #E7)
- [ ] 2.12 Partial PATCH: stored `"warnings"` · `PATCH /api/preferences/display` updates an unrelated field · stored **and** broadcast value still `"warnings"`, asserted on both the `base` and `merged` write paths (test-plan #E8)
- [ ] 2.13 Corrupt persisted floor: `preferences.json` containing `notifyMinLevel:"oops"` · store loads, client evaluates visibility · nothing suppressed at any level; floor degrades to `"all"`, not to a `NaN` comparison hiding `error` (test-plan #X1)
- [ ] 2.14 Unvalidated session override: an override message carrying `notifyMinLevel:"critical"`, stored as received · merged prefs computed · merged floor treated as `"all"`, `error` still visible, global uncorrupted (test-plan #X2)
- [ ] 2.15 Missing state: a `preferences.json` with no `displayPrefs` key, and one absent entirely · store loads and a client subscribes · `notifyMinLevel` resolves `"all"` in both, no throw, no `undefined` reaching the predicate (test-plan #X3)

### 2c. Chat view gate — L1, `packages/client/src/components/__tests__/ChatView.test.tsx`

Harness exemplars: `ChatView.ask-user-suppression.test.tsx` (interactive rows),
`ChatView.image-row-measure.test.tsx` (measured height / virtualizer asserts).

- [ ] 2.16 Count invariant: transcript of one notify per level + two blocking asks · rendered at `"warnings"` · virtualizer `count` equals non-null rendered rows (4) and no blank measured gap remains. Note it does NOT prove both sites — 2.17 is what does (test-plan #F1)
- [ ] 2.17 Render-branch site pinned independently: an `info` notify that reaches the render branch with `isRowVisible` admitting it · render branch evaluated at `"errors"` · produces no element and reserves no measured height (test-plan #F2)
- [ ] 2.18 Ask safety: unanswered `ask_user`/`select`/`confirm`/`input` rows · rendered at `"errors"` · all four render **and** stay answerable — the submit/choice handler fires and resolves the request (test-plan #F3)
- [ ] 2.19 Reversibility: transcript whose `info` notifies are hidden at `"errors"` · preference changed to `"all"` · rows re-render at original indices with zero refetch/reconnect (network + WS spy count 0) (test-plan #F4)
- [ ] 2.20 Override isolation: global `"all"`, two open sessions · `"errors"` set for session A only · A hides sub-error notifies, B unchanged, global still `"all"` (test-plan #F5)

### 2d. Notify renderer + InlineMessage tone — L1

Harness exemplar: `Toast.test.tsx` (its source-literal scan at ~line 110 is the
pattern for 2.22, and its token assertions for 2.23–2.25).

- [ ] 2.21 Level without colour: a notify at each of the four levels · each rendered through `InlineMessage` · each shows a level-distinct icon AND the level word as text, mutually distinguishable with colour discarded (WCAG 2.2 §1.4.1) (test-plan #F10)
- [ ] 2.22 No raw literals: the `NotifyRenderer` source · inspected via the `Toast.test.tsx` scan pattern · contains no `text-blue-400`/`green-400`/`yellow-400`/`red-400`, and every level resolves from a `--severity-*` token (test-plan #F11)
- [ ] 2.23 Tier mapping: notifies at `warning` and `success` · each rendered · `warning` resolves `--severity-warning-fg` (not yellow) and `success` resolves the `--severity-success-{bg,border,fg}` triple without falling back to the `info` tone (test-plan #F12)
- [ ] 2.24 Existing severities unchanged: `InlineMessage` at `error`/`warning`/`info` · union widened with `success` · the three resolve byte-identical tokens to before (test-plan #F13)
- [ ] 2.25 Pre-existing consumers unaffected: `Toast.tsx` and `extension-ui/ToastSlot.tsx` · union widened + `NotifyRenderer` re-toned · both still resolve the same success triple and their existing assertions stay green (test-plan #F14)
- [ ] 2.26 Empty payload: notify rows whose message and title are both absent or non-string · rendered after the re-tone · no row produced — the validation guard survives the migration (test-plan #F17)
- [ ] 2.27 Markdown preserved: a notify whose message contains emphasis, a code span and a link · rendered through the primitive · body still renders as formatted output, not escaped source (test-plan #F18)

### 2e. Controls — L1

Harness exemplars: `ChatViewMenu.change-summary.test.tsx` (popover rows),
`SettingsPanel.test.tsx` and `settings-persistence.test.tsx` (panel + draft).

- [ ] 2.28 Redundant-write override: global `"warnings"`, no session override · user selects `"warnings"`, then the global later moves to `"all"` · an explicit override is recorded at selection time, the session stays `"warnings"`, and clear-override then returns it to `"all"` (test-plan #F6)
- [ ] 2.29 Popover row hit area: the rendered `notifyMinLevel` row · popover opened · row min height is 44px (matching `ThinkingLevelSelector`), not the ~26px `py-1` sibling pattern, and sibling rows are unchanged (test-plan #F7)
- [ ] 2.30 Single control: the settings panel · rendered across all pages · exactly one `notifyMinLevel` control exists, on General's message-level chat-display sub-section (test-plan #F8)
- [ ] 2.31 Draft commit: General page with a clean draft · notify-level control changed · page becomes dirty, value buffered, nothing persists until Save (test-plan #F9)

### 2f. End-to-end — L3, `tests/e2e/`

Harness exemplar: `tests/e2e/notify-channel.spec.ts` (the `e2e_notify` fixture
driver + card assertions); `chat-transcript-virtualization.spec.ts` for the
no-blank-gap/tail assertions. Read the derived harness port from
`.pi-test-harness.json` — never hardcode `:18000`.

- [ ] 2.32 **New infra first**: add a 4-level notify faux scenario to `qa/fixtures/faux-scenarios.ts` calling `e2e_notify` once per level with distinguishable text, exporting per-level markers the way `NOTIFY_PROBE_MESSAGE` is exported. Model on the existing single-notify scenario `n`. Required by 2.33 (test-plan: New infra needed)
- [ ] 2.33 Ladder end-to-end: a session emitting `info`/`success`/`warning`/`error` notifies through the real `ctx.ui.notify` path · View popover sets `notifyMinLevel="warnings"` · exactly the `warning` + `error` rows visible, `info`/`success` absent with no blank gap, transcript tail not clipped (test-plan #F15)
- [ ] 2.34 Ask safety end-to-end: a session at `notifyMinLevel="errors"` · the session issues a genuine `ask_user` · the dialog renders in the browser, is answerable, and the card reads "Needs you" (test-plan #F16)

## 3. Shared — the type and the one predicate

- [ ] 3.1 `packages/shared/src/display-prefs.ts`: add `export type NotifyMinLevel = "all" | "success" | "warnings" | "errors"` and `notifyMinLevel: NotifyMinLevel` to `DisplayPrefs`.
- [ ] 3.2 Doc-comment the ladder `info < success < warning < error` AND why `success` outranks `info` (D1) — otherwise a later reader "fixes" the order. Include `See change: gate-notify-rows-by-level`.
- [ ] 3.3 Add `notifyMinLevel: "all"` to all three `DISPLAY_PRESETS` (D7 — no opinionated preset defaults).
- [ ] 3.4 Add the `notifyMinLevel` line to `mergeDisplayPrefs`. `PartialDisplayPrefs` is mapped and needs no edit — verify by type-check, do not assume.
- [ ] 3.5 Export ONE predicate (e.g. `isNotifyRowVisible(row, minLevel): boolean`) that (a) positively identifies a notify via `content === "notify"` && `args.method === "notify"`, (b) returns `true` for anything else (fail-open, D2), (c) normalizes the level through the same rules as `normalizeNotifyLevel`. Both gate sites import THIS — do not inline the comparison twice.

## 4. Server — persistence

- [ ] 4.1 `preferences-store.ts` `backfillDisplayPrefs`: add the `notifyMinLevel` clause defaulting `"all"`, alongside the existing per-field clauses.
- [ ] 4.2 Same file `setDisplayPrefs`: add `notifyMinLevel` to the `base` literal AND to `merged`. Both — the base literal is the seedless path.

## 5. Client — the gate (both sites, one commit)

- [ ] 5.1 `ChatView.tsx` `isRowVisible`, case `"interactiveUi"`: after the existing widget-bar check, return the shared predicate's verdict. Add `prefs.notifyMinLevel` to the `useMemo` dep array — the existing deps list `prefs`, confirm that is sufficient rather than assuming it.
- [ ] 5.2 `ChatView.tsx` render branch `msg.role === "interactiveUi"` (~1155): same predicate, `return null` when hidden — mirroring the `rawEvent` pattern at ~1183.
- [ ] 5.3 Verify 2.16 AND 2.17 go green. 2.16 alone does not prove both sites — it passes with either gate alone (design D3); 2.17 is what pins the render branch.
- [ ] 5.4 `chat-virtual-rows.ts` `estimateVirtualRowSize` (`interactiveUi` → 160px): **resolved at the scenario-design gate (G1) as no change**. Measure-on-mount absorbs the height delta and no acceptance criterion is specified. Confirm the estimate is untouched and close; do NOT add a notify-specific estimate.

## 5-bis. Client — renderer re-tone (D8)

- [ ] 5.5 `InlineMessage.tsx`: add `"success"` to the `Severity` union and a `TONE.success` entry pointing at `--severity-success-{bg,border,fg}`. Static class strings only — the file's own comment explains Tailwind cannot JIT-scan a dynamic `--severity-${severity}-*`.
- [ ] 5.6 `NotifyRenderer.tsx`: delete `levelColors`; map `NotifyLevel → Severity` 1:1; render via `InlineMessage` with a per-level icon (`mdiInformationOutline` / `mdiCheckCircleOutline` / `mdiAlertOutline` / `mdiAlertCircleOutline`) and the level word as the title, message body as children.
- [ ] 5.7 Keep the existing validation: non-string `message` falls back to `params.title`, then to `""`; empty still returns `null`. Do NOT let the re-tone quietly drop that guard — params cross the wire.
- [ ] 5.8 Re-confirm after the re-tone that `estimateVirtualRowSize` is still untouched (relates to 5.4). The row's real height does change with the accent bar + icon + level line; per G1 that is absorbed by measure-on-mount and is deliberately not asserted.

## 6. Client — controls

- [ ] 6.1 `SettingsPanel.tsx`: add the 4-value control to the message-level chat-display sub-section, wired through `patch({ notifyMinLevel })` like its neighbors.
- [ ] 6.2 `ChatViewMenu.tsx`: add a value-selecting row variant — **shape C1**, a native `<select>` inline-right, preserving the label-left / control-right rhythm (see `mockups/ux-review.md`). It must participate in `isOverridden` (which is key-generic already — verify) and in `clearOverride`.
- [ ] 6.2a The new row lands at `min-h-[44px]`, matching `ThinkingLevelSelector`, NOT the ~26px `py-1` sibling rows. Do not "fix" the siblings here (D8, scope).
- [ ] 6.3 i18n keys for the label and the four option labels, following the `i18nT("common.…", undefined, "…")` pattern used by neighboring rows.

## 7. Docs

- [ ] 7.1 `docs/chat-display-preferences.md` — the **Non-hidable** section currently reads "Inline ask-user / interactive-UI dialogs always render regardless of toggles", which this change makes false for notify. Narrow it to *blocking* interactive rows and add the `notifyMinLevel` axis. **Delegate to DocScribe** (caveman style) per the Documentation Update Protocol.
- [ ] 7.2 Tree rows for touched source files via their nearest `AGENTS.md` (main agent edits these directly): `packages/shared/src/AGENTS.md`, `packages/client/src/components/chat/ChatView.tsx.AGENTS.md`, `ChatViewMenu.tsx.AGENTS.md`.

## 8. Verify

- [ ] 8.1 `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log` then grep the summary pattern.
- [ ] 8.2 Rebuild per the `implement` skill: shared+server → `curl -X POST http://localhost:8000/api/restart`; client → `npm run build` then restart.
- [ ] 8.3 Manual: trigger notifies at all four levels from a real extension, walk the four settings, confirm the ladder and that `error` never disappears.
- [ ] 8.3a Manual, **light theme** (test-plan: manual-only): confirm the four re-toned levels read clearly and are mutually distinguishable. This is the defect the mockup demonstrates; dark mode alone will not show it. Token contrast itself is already automated by the pre-existing `tests/e2e/severity-contrast.spec.ts` (9 themes × 2 modes), so only the aesthetic call is manual (test-plan #F19)
- [ ] 8.4 Manual (the one that matters): set `"errors"`, then have a session call `ask_user`. The dialog must appear and be answerable.
- [ ] 8.5 `openspec validate gate-notify-rows-by-level --strict`.
