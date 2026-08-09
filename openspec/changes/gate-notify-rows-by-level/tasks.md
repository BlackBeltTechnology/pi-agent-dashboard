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

## 2. Tests first (red)

Author before implementation and verify each fails.

### 2a. Shared predicate — L1, `packages/shared/src/__tests__/display-prefs.test.ts`

- [ ] 2.1 Ladder ordering: `notifyMinLevel="success"` → `success`/`warning`/`error` visible, `info` hidden (spec: "Level ranking places success above info")
- [ ] 2.2 Error floor: for every value of `notifyMinLevel`, an `error` notify is visible (spec: "Errors survive the strictest setting")
- [ ] 2.3 Absent / garbage level normalizes to `info` and is hidden at `"success"` and stricter (spec: "Unrecognized level normalizes to info")
- [ ] 2.4 Fail-open: a row with `role:"interactiveUi"` that is NOT a notify is visible at `"errors"` (spec: "Unclassifiable interactive row renders")
- [ ] 2.5 Presets: all three define `notifyMinLevel: "all"` (spec: "Field present in every preset")
- [ ] 2.6 Merge: override wins; omitted override falls back to global (spec: both merge scenarios)

### 2b. Server persistence — L1, `packages/server/src/__tests__/preferences-store.test.ts`

- [ ] 2.7 Backfill: a `displayPrefs` object with no `notifyMinLevel` loads as `"all"` (spec: "Legacy preferences file is backfilled")
- [ ] 2.8 Partial PATCH of an unrelated field preserves a stored `notifyMinLevel` (spec: "Partial PATCH preserves the field")

### 2c. Chat view — L1, `packages/client/src/components/__tests__/ChatView.test.tsx`

- [ ] 2.9 **Count invariant**: transcript with one notify at each level, rendered at `"warnings"` → virtualizer `count` equals the number of non-null rendered rows, and no blank measured gap remains (spec: "Row count matches rendered rows"). This is the test that catches a one-site gate; write it before either gate edit.
- [ ] 2.10 **Ask safety**: at `notifyMinLevel="errors"`, an unanswered `ask_user` / `select` / `confirm` / `input` row still renders and is still answerable (spec: "A blocking ask renders at the strictest setting"). Regression teeth for D2 — if this ever goes green-by-accident, the gate has drifted onto the role.
- [ ] 2.11 Reversibility: rows hidden at `"errors"` re-render in original positions when the pref moves to `"all"`, with no refetch (spec: "Raising and lowering the floor is reversible without reload")
- [ ] 2.12 Legacy row shape: a notify carrying only `params.title` (pre-split shape) is gated by the same rule as `params.message`

### 2c-bis. Notify renderer tone — L1, `NotifyRenderer` tests

- [ ] 2.12a No raw literals: rendering each of the four levels produces no `text-blue-400` / `text-green-400` / `text-yellow-400` / `text-red-400` class (spec: "Notify rows SHALL render through the shared severity primitive")
- [ ] 2.12b Level survives without colour: each level renders an icon AND a level word, so the level is recoverable with colour removed (WCAG 2.2 §1.4.1)
- [ ] 2.12c `success` maps to the success tone, not a fallback to `info` — the union really gained a member
- [ ] 2.12d Existing behaviour preserved: markdown body still renders; `params.title` legacy fallback still resolves; empty message still returns null

### 2d. Settings + popover — L1

- [ ] 2.13 Exactly one `notifyMinLevel` control across the whole settings panel, on General (spec: "Single control across the panel")
- [ ] 2.14 Changing it marks General dirty and persists only on Save (spec: "Commits through the draft source")
- [ ] 2.15 Popover selection marks the override and clear-override restores global (spec: "Popover row marks an override")

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
- [ ] 5.3 Verify 2.9 goes green. If only one site was edited it will not.
- [ ] 5.4 Check `chat-virtual-rows.ts` `estimateVirtualRowSize`: `interactiveUi` estimates 160px, sized for a card with controls. A bare notify is much shorter. Decide whether a notify-specific estimate is warranted or whether the existing measure-on-mount correction absorbs it — do NOT change it speculatively.

## 5-bis. Client — renderer re-tone (D8)

- [ ] 5.5 `InlineMessage.tsx`: add `"success"` to the `Severity` union and a `TONE.success` entry pointing at `--severity-success-{bg,border,fg}`. Static class strings only — the file's own comment explains Tailwind cannot JIT-scan a dynamic `--severity-${severity}-*`.
- [ ] 5.6 `NotifyRenderer.tsx`: delete `levelColors`; map `NotifyLevel → Severity` 1:1; render via `InlineMessage` with a per-level icon (`mdiInformationOutline` / `mdiCheckCircleOutline` / `mdiAlertOutline` / `mdiAlertCircleOutline`) and the level word as the title, message body as children.
- [ ] 5.7 Keep the existing validation: non-string `message` falls back to `params.title`, then to `""`; empty still returns `null`. Do NOT let the re-tone quietly drop that guard — params cross the wire.
- [ ] 5.8 Re-check `estimateVirtualRowSize` after the re-tone (relates to 5.4): the row's real height changes when it gains an accent bar + icon + level line.

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
- [ ] 8.3a Manual, **light theme**: confirm all four levels are legible after the re-tone. This is the defect the mockup demonstrates; dark mode alone will not show it.
- [ ] 8.4 Manual (the one that matters): set `"errors"`, then have a session call `ask_user`. The dialog must appear and be answerable.
- [ ] 8.5 `openspec validate gate-notify-rows-by-level --strict`.
