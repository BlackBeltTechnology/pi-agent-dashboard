## 1. Implementation

- [x] 1.1 In `CommandInput.tsx`, turn `terminalButton` into an inline function `terminalButton(showLabel: "always" | "wide")` using the delivery-control chip classes (`h-[30px] rounded-lg border border-[var(--border-secondary)] px-2 gap-1 text-[11px] text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]`), icon + label span; keep `data-testid`, `title`, `aria-label`, `disabled`
- [x] 1.2 Remove the terminal wrapper from `composer-input-row`; render `terminalButton("wide")` inside `<span className="hidden @[44rem]:inline-flex">` right after `{deliveryControl}` in `composer-settings-row`
- [x] 1.3 Render `terminalButton("always")` in the `⋯` overflow menu (replacing the current `{terminalButton}`)
- [x] 1.4 Add i18n key `command.terminal` to `i18n-hu.ts` ("Terminál") and `i18n-zh-CN.ts` ("终端"); English fallback "Terminal" via `t(..., "Terminal")`

## 2. Tests

- [x] 2.1 Update `CommandInput.test.tsx` row-membership test: terminal button is in `composer-settings-row`, NOT in `composer-input-row`
- [x] 2.2 Add unit assertion: terminal button accessible name is "Open inline terminal" and it renders the `Terminal` label text
- [x] 2.3 Add e2e assertion in `composer-session-strip.spec.ts` (wide composer): terminal chip height and border radius equal `delivery-control`'s
- [x] 2.4 Run `#F11` (`composer-session-strip.spec.ts`); tune the label breakpoint (`@[52rem]` starting point) until the settings row does not overflow at 44rem+1px
- [x] 2.5 Run `terminal.spec.ts`, `inline-terminal-transcript.spec.ts`, `split-composer-overflow.spec.ts` unchanged — all active tests pass; `terminal.spec.ts` "open inline terminal" and transcript `P1` are `test.fixme` (quarantined, #683) and were skipped, so the opening path is covered by the transcript F1–F11 tests, which click the same button

## 3. Verification

- [x] 3.1 `node scripts/theme-token-guard.mjs` reports no new violation; diff adds no raw colour literals
- [x] 3.2 Isolated env (non-8000 ports, temp HOME, `PI_DASHBOARD_NO_MDNS=1`, openspec poll disabled): screenshots of the composer in Base dark, Base light and Dracula, wide (>52rem), mid (44–52rem) and narrow (<44rem) widths; compare against `mockups/inline-terminal-button` variant B
- [x] 3.3 `lsof -i:8000` shows the original live server PID unchanged before and after
