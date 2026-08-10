# Test Plan — gate-notify-rows-by-level

Stage: design   Generated: 2026-08-14

HARD gate cleared — both unfillable slots were resolved by the requester:

- **G1 (row-size estimate)** → *no acceptance criterion*. Measure-on-mount
  absorbs the height change from the re-tone. No scenario is written for it and
  tasks 5.4 / 5.8 close as "verified, no change". This is why there is no
  Performance section below.
- **G2 (L3 ladder depth)** → *add a 4-level faux scenario* and assert the full
  ladder end-to-end at one floor setting. Recorded under "New infra needed".

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | chat-display-preferences · "Level ranking places success above info" | decision-table | L1 | automated | one notify row at each of `info`, `success`, `warning`, `error` | the shared predicate is evaluated for every one of the 4 levels × 4 floors (`all`/`success`/`warnings`/`errors`) | all 16 cells match the ladder exactly: visible iff `rank(level) >= rank(floor)`; at `"success"` the `info` row is the only hidden one |
| E2 | chat-display-preferences · "Errors survive the strictest setting" | BVA | L1 | automated | a notify row with `level: "error"` | the predicate is evaluated once per legal floor value | `true` for all four floors; no legal value of `notifyMinLevel` yields `false` |
| E3 | chat-display-preferences · "Unrecognized level normalizes to info" | EP (invalid partition) | L1 | automated | notify rows whose `params.level` is respectively absent, `null`, `42`, `"critical"`, `""` | the predicate is evaluated at floor `"success"`, then at `"all"` | every variant is hidden at `"success"` and visible at `"all"` — i.e. each was ranked as `info`, matching `normalizeNotifyLevel` |
| E4 | chat-display-preferences · "Unrecognized minimum-level value fails open" | EP (invalid partition) + BVA on the singular/plural hazard | L1 | automated | floor values `"oops"`, `""`, `undefined`, and the near-miss typos `"warning"` and `"error"` (singular — NOT the legal plural stops) | the predicate is evaluated for all four notify levels against each bad floor | every row is visible for every bad floor, **including `error`**; no comparison yields `false` via an undefined/`NaN` rank; the singular typos are treated as unrecognized → `"all"`, never silently as their plural twins |
| E5 | chat-display-preferences · "Field present in every preset" | EP | L1 | automated | the `DISPLAY_PRESETS` map | each of `simple`, `standard`, `everything` is read | all three define `notifyMinLevel` and all three equal `"all"` |
| E6 | chat-display-preferences · "Per-session override wins" + "Absent override falls back" | decision-table | L1 | automated | global `{notifyMinLevel:"all"}` with override `{notifyMinLevel:"errors"}`; then global `{"warnings"}` with an override omitting the field | `mergeDisplayPrefs(global, override)` is evaluated | `"errors"` in the first case, `"warnings"` in the second; the field survives a sparse override in both directions |
| E7 | chat-display-preferences · "Legacy preferences file is backfilled" | EP | L1 | automated | a persisted `preferences.json` whose `displayPrefs` object omits `notifyMinLevel` | the preferences store loads it | the loaded value is `"all"`; no code path exposes `notifyMinLevel === undefined` to a client |
| E8 | chat-display-preferences · "Partial PATCH preserves the field" | state-transition | L1 | automated | stored `notifyMinLevel: "warnings"` | `PATCH /api/preferences/display` updates an unrelated display field and omits `notifyMinLevel` | the stored **and** broadcast value is still `"warnings"`, not `undefined` — asserted on both the `base` and `merged` write paths |
| E9 | chat-display-preferences · "Unclassifiable interactive row renders" | EP (fail-open partition) | L1 | automated | `interactiveUi` rows for `select`, `confirm`, `input`, `ask_user` | the predicate is evaluated at floor `"errors"` | every row is visible; the predicate never returns hidden for a row it did not positively classify as a notify |
| E10 | chat-display-preferences · "gate SHALL identify a notify by its own discriminator" | decision-table (2-factor) | L1 | automated | four rows covering the truth table of `content === "notify"` × `args.method === "notify"` — both true, each true alone, neither | the predicate is evaluated at floor `"errors"` with `level: "info"` | only the both-true row is hidden; the two half-matches and the no-match render. Pins the AND — a single-marker check would hide a `select` whose `content` happens to be `"notify"` |
| E11 | inline-message-log-primitives · "Legacy title-only payload" + gate parity | EP | L1 | automated | a notify row carrying only `params.title` (pre-split shape) with `level: "info"` | the predicate is evaluated at floor `"warnings"` | hidden — gated by exactly the same rule as a `params.message` row; payload shape does not affect the level gate |
| E12 | chat-display-preferences · "each gate site SHALL adapt its local object to that shape" | equivalence of call shapes | L1 | automated | the same logical notify expressed as the `isRowVisible` object (`msg.args.method`) and as the render-branch object (built `request.method`) | the predicate is called once with each shape at each floor | both calls return an identical verdict at every floor; a divergence here is the drift D2 warns about |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | chat-view · "Row count matches rendered rows" | state-convergence + invariant | L1 | automated | a transcript of one notify per level plus two blocking asks | the chat view renders at `notifyMinLevel = "warnings"` | the virtualizer's `count` equals the number of non-null rendered rows (4); no blank measured gap remains where `info`/`success` were. **Note:** this invariant is satisfied by either gate site alone — it does NOT prove both (design D3), so F2 is mandatory alongside it |
| F2 | chat-view · "Render branch independently drops a sub-floor notify" | invariant assertion on the second site | L1 | automated | an `info`-level notify row that reaches the render branch (`isRowVisible` admitting it) | the render branch is evaluated at `notifyMinLevel = "errors"` | it produces no element and reserves no measured height — independently of the filter. This is the only row that pins the render-branch half |
| F3 | chat-display-preferences · "A blocking ask renders at the strictest setting" | state-transition (illegal edge) | L1 | automated | unanswered `ask_user`, `select`, `confirm` and `input` rows | the chat view renders at `notifyMinLevel = "errors"` | all four render **and** remain answerable — the submit/choice handler still fires and resolves the request. Regression teeth: if this ever passes vacuously, the gate has drifted onto `role` |
| F4 | chat-view · "Raising and lowering the floor is reversible without reload" | state-transition | L1 | automated | a transcript whose `info` notifies are hidden at `"errors"` | the preference is changed to `"all"` | the hidden rows render again at their original indices, and no history refetch or reconnect is issued (network/WS spy count stays 0) |
| F5 | chat-view · "Per-session override applies without touching global" | state-transition | L1 | automated | global `notifyMinLevel = "all"`, two open sessions | `"errors"` is set from the View popover for session A only | session A hides sub-error notifies; session B's transcript is unchanged; the global value is still `"all"` |
| F6 | settings-panel · "Selecting the global's own value still overrides" | state-transition (redundant-write edge) | L1 | automated | global `"warnings"`, session with no override | the user selects `"warnings"` in the popover, then the global is later changed to `"all"` | an explicit override is recorded at selection time; after the global moves the session remains at `"warnings"`; clear-override then returns it to `"all"` |
| F7 | settings-panel · popover row shape (tasks 6.2a) | boundary on hit area | L1 | automated | the rendered `notifyMinLevel` popover row | the popover is opened | the row's min height is 44px (matching `ThinkingLevelSelector`), not the ~26px `py-1` sibling pattern; sibling rows are unchanged |
| F8 | settings-panel · "Single control across the panel" | EP | L1 | automated | the settings panel | it is rendered across all pages | exactly one `notifyMinLevel` control exists, and it is on the General page's message-level chat-display sub-section |
| F9 | settings-panel · "Commits through the draft source" | state-transition | L1 | automated | the General page with a clean draft | the notify-level control is changed | the General page becomes dirty, the value is buffered, and nothing persists until Save is pressed |
| F10 | inline-message-log-primitives · "Level is recoverable without colour" | EP over the 4 levels | L1 | automated | a notify at each of the four levels | each is rendered through `InlineMessage` | each renders a level-distinct icon **and** the level word as text; the four are mutually distinguishable with colour information discarded (WCAG 2.2 §1.4.1) |
| F11 | message-severity-tokens · "No hardcoded severity colour in the notify renderer" | source-scan | L1 | automated | the `NotifyRenderer` source | it is inspected (same technique as `Toast.test.tsx`'s existing literal scan) | it contains no `text-blue-400` / `text-green-400` / `text-yellow-400` / `text-red-400`, and every level resolves from a `--severity-*` token |
| F12 | message-severity-tokens · "Warning resolves to the orange-derived tier" + "Success tier resolves from its tokens" | EP | L1 | automated | notifies at `warning` and at `success` | each is rendered | `warning` resolves `--severity-warning-fg` (not a yellow literal); `success` resolves the `--severity-success-{bg,border,fg}` triple and does not fall back to the `info` tone — proving the union really gained a member |
| F13 | inline-message-log-primitives · "Existing severities are unchanged" | regression snapshot | L1 | automated | `InlineMessage` rendered at `error`, `warning`, `info` | the `Severity` union is widened with `success` | the three existing members resolve byte-identical tokens to before the widening |
| F14 | inline-message-log-primitives · "existing consumers SHALL be unaffected" | regression | L1 | automated | `Toast.tsx` and `extension-ui/ToastSlot.tsx`, the pre-existing `--severity-success-*` consumers | the union is widened and `NotifyRenderer` is re-toned | both still resolve the same success triple; their existing assertions stay green. (Pins the fact the corrected artifact now states: this change is a *new*, not the first, consumer) |
| F15 | chat-view + chat-display-preferences · the ladder, end to end | state-transition over the real path | L3 | automated | a session emitting four notifies — `info`, `success`, `warning`, `error` — through the real `ctx.ui.notify` path via the `e2e_notify` fixture | the View popover sets `notifyMinLevel = "warnings"` for that session | exactly the `warning` and `error` rows remain visible; the `info` and `success` rows are absent with no blank gap; the transcript tail is not clipped. **Requires the new 4-level faux scenario** |
| F16 | chat-display-preferences · ask safety, end to end | state-transition (illegal edge) | L3 | automated | a session at `notifyMinLevel = "errors"` | the session issues a genuine `ask_user` | the dialog renders in the browser and is answerable, and the card still reads "Needs you" — the real-path counterpart of F3 |
| F17 | inline-message-log-primitives · "Empty message renders nothing" | EP (invalid partition) | L1 | automated | notify rows whose message and title are both absent, or non-string | each is rendered after the re-tone | no row is produced — the pre-existing validation guard survives the migration onto `InlineMessage` |
| F18 | inline-message-log-primitives · "Migrating SHALL preserve existing behaviour" | regression | L1 | automated | a notify whose message contains markdown (emphasis, code span, link) | it is rendered through the primitive | the markdown body still renders as formatted output, not as escaped source |
| F19 | design D8 · light-mode legibility of the re-toned rows | visual/subjective | — | manual-only | the four re-toned notify levels in the **light** theme | a human looks at the transcript | [judgment: the four levels read clearly and are mutually distinguishable — the defect the mockup demonstrates; dark mode alone does not show it. Token contrast itself is already automated by the pre-existing `tests/e2e/severity-contrast.spec.ts` across 9 themes × 2 modes, so only the aesthetic call is manual] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | chat-display-preferences · "Neither write path validates the value" | fault injection (corrupt persisted state) | L1 | automated | a hand-edited `preferences.json` containing `displayPrefs.notifyMinLevel: "oops"` | the preferences store loads it and the client evaluates visibility | no notify is suppressed at any level — the floor degrades to `"all"` rather than to a `NaN` comparison that hides everything including `error` |
| X2 | chat-display-preferences · unvalidated session override | fault injection (stale/buggy client) | L1 | automated | a per-session override message carrying `notifyMinLevel: "critical"`, stored as received | the merged prefs are computed and rows are evaluated | the merged floor is treated as `"all"`; an `error` notify remains visible; the bad override does not corrupt the global value |
| X3 | chat-display-preferences · "Legacy preferences file is backfilled" (absent parent) | fault injection (missing state) | L1 | automated | a `preferences.json` with no `displayPrefs` key at all, and one that is absent entirely | the store loads and a client subscribes | `notifyMinLevel` resolves to `"all"` in both cases; no throw, no `undefined` reaching the predicate |

---

## Coverage summary

- Requirements covered: 7/7 (all `SHALL` blocks across the 5 spec deltas)
- Scenarios by class: edge 12 · perf 0 · frontend 19 · error 3
- Scenarios by level: L1 30 · L2 0 · L3 2 · manual-only 1
- Scenarios by disposition: automated 33 · manual-only 1

No L2 rows: this change adds no install, spawn, process or multi-OS runtime
behaviour — it is a display predicate plus two controls. Routing a UI assertion
into `qa/` smoke would violate the level boundary.

No Performance rows: the change specifies no latency, throughput or memory
threshold, and the one perf-adjacent question (the virtual row-size estimate
after the re-tone) was resolved at the gate as "measure-on-mount absorbs it, no
criterion" (G1). Inventing a threshold here would manufacture a requirement the
spec does not make.

## New infra needed

- **A 4-level notify faux scenario** (`qa/fixtures/faux-scenarios.ts`), required
  by F15. The `e2e_notify` fixture tool already accepts `{message, level?}`, so
  no fixture-extension change is needed — only a new scenario script that calls
  it four times, once per level, with distinguishable message text. Model it on
  the existing single-notify scenario `n` and export per-level markers the way
  `NOTIFY_PROBE_MESSAGE` is exported today.
- Everything else reuses existing harnesses: `display-prefs.test.ts`,
  `preferences-store.test.ts`, `ChatView.test.tsx` (+ the
  `ask-user-suppression` and `image-row-measure` variants),
  `ChatViewMenu.*.test.tsx`, `SettingsPanel.test.tsx`,
  `settings-persistence.test.tsx`, `Toast.test.tsx`, and the e2e
  `notify-channel.spec.ts` / `chat-transcript-virtualization.spec.ts`.
