## 1. Tests first

- [x] 1.1 Add launcher-stack regression tests to `lib/nav/__tests__/overlay-background.test.ts` (open→dismiss→dismiss, underlay kept, browser Back pops, two-level nesting). Verify they fail on the single-slot launcher.
- [x] 1.2 Add `returnTo` tests to `lib/__tests__/history-back.test.ts` (pop when predecessor is the target, replace otherwise, replace on cold load)

## 2. Implementation

- [x] 2.1 `overlay-background.ts`: `launcher` slot → `launchers` stack; `recordLauncher` pops on return to the top launcher's surface
- [x] 2.2 `history-back.ts`: add `returnTo(navigate, target, tracker)`
- [x] 2.3 `App.tsx` `dismissOverlay`: `returnTo` + clear background only for base-route targets
- [x] 2.4 Update `lib/nav/AGENTS.md` + `history-back.ts.AGENTS.md` rows

## 3. Verification

- [x] 3.1 Manual: Settings → Gateway → Tunnel setup, Esc twice lands on the launching session; browser Back does not cycle
- [x] 3.2 Optional Playwright spec in `tests/e2e/` for the nested-dismiss flow
