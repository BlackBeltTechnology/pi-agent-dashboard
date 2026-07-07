## 1. Formation: threshold 1 + trailing absorption (`group-tool-bursts.ts`)

- [ ] 1.1 Update tests in `group-tool-bursts.test.ts`: single call forms a group; trailing `thinking` absorbed; group split by non-empty assistant reply still holds → verify: `npm test group-tool-bursts` red on new cases
- [ ] 1.2 Change gate `members >= 3` → `members >= 1`; advance `end` across trailing transparents up to first HARD row → verify: new + existing tests green
- [ ] 1.3 Confirm nested `×N` semantic groups still count as one member and adjacent groups don't cross-absorb → verify: existing nesting scenarios green

## 2. Unified frame + header matrix (`ToolBurstGroup.tsx`)

- [ ] 2.1 Extract a `GroupFrame` (slots: leftGlyph, title, meta, motionClass, chevron, body); route running/done/single/multi through it → verify: `tsc --noEmit` clean
- [ ] 2.2 Single-member done header renders tool icon + `getSummary` one-liner + duration (NOT `"1 tool calls"`) → verify: unit/snapshot for a single `Read` group
- [ ] 2.3 Multi-member done header renders `N tool calls` + per-kind icon+count breakdown + aggregate duration → verify: snapshot for a 3×grep/5×Read/1×git group
- [ ] 2.4 Add `N failed` error badge when any member `toolStatus === "error"` → verify: snapshot with 1 errored member
- [ ] 2.5 Add `toolName → mdi icon` map in `tool-summary.ts` (generic fallback) → verify: unit for known + unknown kinds

## 3. Reasoning in group (`ToolBurstGroup.tsx`)

- [ ] 3.1 Render absorbed non-empty `thinking` via `<ThinkingBlock>` (reuse ChatView props + `prefs.thinking` gating); keep narration `<div>` only for non-empty `assistant` → verify: interior + trailing reasoning show the "Reasoning" header
- [ ] 3.2 Remove the dead `thinking` path from the narration branch → verify: no `tool-burst-narration` renders for `thinking`

## 4. Animation (CSS + `ToolBurstGroup.tsx`)

- [ ] 4.1 Running header: indeterminate shimmer sweep + spinner pulse (transform/opacity/background-position only) → verify: visual against mock; DevTools shows no layout in the animation
- [ ] 4.2 Completion flash on running→done flip (one-shot, ≤200ms) → verify: plays once, settles collapsed
- [ ] 4.3 Remove the body's `max-h-[190px] overflow-y-auto`; group grows in flow. Opacity/height expand transition only; confirm scroll anchor unaffected → verify: a 30-member group has no inner scrollbar and renders full height; scroll-up-then-collapse does not jump
- [ ] 4.4 `@media (prefers-reduced-motion: reduce)` disables shimmer/pulse/flash; text/icons remain → verify: emulate reduced-motion, animations off

## 5. `toolGroupDefaultCollapsed` preference

- [ ] 5.1 Add `toolGroupDefaultCollapsed: boolean` (default `false`) to `DisplayPrefs`, all three `DISPLAY_PRESETS`, and `mergeDisplayPrefs`; backfill legacy files → verify: `display-prefs` unit tests green, missing field → false
- [ ] 5.2 `ToolBurstGroup`: `expanded = override ?? (prefs.toolGroupDefaultCollapsed ? false : isRunning)` — header/animation unchanged → verify: on → running group collapsed; off → running group expanded; manual toggle still wins
- [ ] 5.3 Add the GLOBAL toggle to `SettingsPanel` chat-display section (next to reasoning toggles, Unified-Save draft) → verify: saving persists to `preferences.json#displayPrefs`, new sessions inherit it
- [ ] 5.4 Add the per-session toggle row to `ChatViewMenu` View popover (`modified` pill on override) → verify: toggling sends `setSessionDisplayPrefs`; override beats the global default; clearing override falls back to global

## 6. Verification

- [ ] 6.1 Full unit run → verify: `npm test 2>&1 | tee /tmp/pi-test.log; grep -nE 'FAIL|✗' /tmp/pi-test.log` empty
- [ ] 6.2 Visual parity with the mock (`mock/index.html`): running animates, done informative, single grouped, reasoning inside, default-collapse toggle
- [ ] 6.3 `openspec validate enhance-tool-call-grouping --strict` passes
