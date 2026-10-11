# UI plan: streamline-first-run

Mockup: `index.html` (served live). Tokens: `tokens.css` is GENERATED from `packages/client/src/index.css` (`:root` base dark + `[data-theme="light"]`) plus `themes.ts` `nordDark`. Every paint goes through a token; there are no raw colour literals in `index.html`.

## Surfaces → tokens → states

| Surface | Recipe (ui-contract) | States |
|---|---|---|
| Onboarding stepper (replaces 3-card row) | card root + raised elevation; ordered list | S1 fresh · S2 connected/peer installing · S3 creating · S4 name error · S5 project pinned · S6 peer install failed · S7 all done |
| Step marker | `rounded-full`; active = `--accent-primary` border + number; done = `--severity-success-*` + check icon; locked = `--bg-tertiary` + lock icon | pending / done / locked: always icon + word, never colour alone (WCAG 1.4.1) |
| Step ② form | field label · input · primary button · link-style secondary | idle · busy (`aria-busy`, "Creating…") · error (`aria-invalid`, severity-error text + icon, input preserved) |
| Path preview | `font-mono text-[12px] --text-secondary` + folder glyph | live: `~/Projects/<name>` |
| Peer status (Landing step ① done row, **proposed addition**) | severity callout: info (installing) / success (installed) / warning (failed + Retry) | `role="status"` / `aria-live="polite"` (WCAG 4.1.3) |
| Anthropic provider row | existing `AuthRow` + `InlineMessage` | installing (info + spinner) · installed (success) · failed (error + "Retry install") |

## Decisions (each cites a public rule)

1. **Vertical stepper instead of 3 horizontal cards.** The active step needs room for a form. Material vertical stepper and GOV.UK task-list pattern; NN/g progressive disclosure: only the current step is expanded, finished and locked steps collapse to one line.
2. **Prefilled name `my-first-project` plus a live path preview.** Tesler's Law: the system absorbs the complexity. Nielsen H5 (error prevention through a sensible default) and H6 (recognition over recall: the user sees exactly where the folder lands).
3. **One primary action per view.** Von Restorff and rubric #6. Only the active step carries an `--accent-solid` button. "Use an existing folder…" is a link-style escape hatch (NN/g empty-state: one CTA plus at most one escape hatch).
4. **Validate on submit, with the error inline at the field.** Baymard inline validation and GOV.UK error message: say what is wrong and how to fix it, keep the user's input, and show an icon plus text, not colour alone.
5. **Locked steps say why.** H1 visibility of system status and H10 help: "Needs a model provider", with a lock icon.
6. **Progress header "1 of 3 done".** Goal-Gradient and Zeigarnik, rubric #22.
7. **Peer install feedback where the user returns.** On desktop, settings is an overlay; after OAuth the user dismisses it and is back on Landing. Status on the step ① done row satisfies H1. **Not in the current spec.** It is shown here as a proposed addition; if accepted, add a `landing-page-onboarding` requirement.
8. **Copy uses the house terminology.** "Start session" / "new session", never "spawn" (ui-contract Terminology).

## Breakpoints

- < 640px: sidebar hidden, stepper full width, action buttons stack full-width at 44px (`tap-target`).
- ≥ 640px: buttons inline at 36px; stepper `max-w` about 36rem, centred in the main pane.

## Score (loop pass 2)

Captured with agent-browser at 1280 and 375 px; Playwright Chromium is absent, so `score_mockup` could not run. Contrast was checked with `audit.js` (`?audit=1`), which sweeps 7 scenarios × {base dark, base light, nord dark} plus the provider rows. Result: **AUDIT OK**, 0 AA failures. A low-contrast probe (`--text-muted`, 2.07:1) confirms the sweep detects failures.

| # | Check (ux-best-practices §5) | Result |
|---|---|---|
| 1 | Text contrast ≥ 4.5:1, both themes + nord | PASS (audit.js) |
| 2 | Targets ≥ 44 px mobile / ≥ 32–36 px desktop | PASS (`.btn` 44→36, `.link` 44→32, callout button 44 on mobile) |
| 3 | Visible focus (`--focus-ring`) | PASS (`:focus-visible` outline) |
| 4 | State not by colour alone | PASS (check / lock / number markers + "Needs …" text; error icon + "Error:" sr text) |
| 5 | Reduced motion | PASS (spinner + bar transition disabled) |
| 6 | One primary action per view | PASS (only the active step has `--accent-solid`) |
| 7 | Async status < 1 s | PASS (Creating… busy state; installing callout `role=status`) |
| 13 | Persistent label | PASS ("Project name" above the input) |
| 14 | Single column on mobile | PASS |
| 15 | Verb CTA | PASS ("Connect a provider", "Create project", "Start session", "Retry install") |
| 16 | Validate on submit | PASS (invalid name reported on Create; preview never shows a nested path) |
| 18 | Error states the fix | PASS ("Use a single folder name without / or \, for example my-project") |
| 19 | One CTA + one escape hatch | PASS ("Use an existing folder…") |
| 22 | Progress indicator | PASS ("n of 3 done" + bar) |

Score: 14/14 checked items pass.

### Fixed during the loop
- The provider view leaked under Landing because `.onb{display:flex}` beat `[hidden]`. Severity 3 in the mockup only; it does not affect the product.
- The path preview showed `~/Projects/my/project` while the error was visible. This contradicts the message (H1 / H5). The preview now shows only the root while the name is invalid.
- The error message sat below the input. It moved between label and input (GOV.UK error-message pattern).
- On mobile the Retry button squeezed the callout title. The callout now wraps, and the button goes full-height below the text.
- Install failure was a warning on Landing but an error on the provider row (H4). Both are now **warning**: sign-in succeeded and the failure is recoverable.

### Decided (2026-10-11)
- **Peer status on the Landing Step ① done row:** kept. Added as a `landing-page-onboarding` requirement, design D3 (`peerAutoInstallStore`), and task 3.5.
- **Vertical stepper replaces the 3-card row:** accepted. Design D6, tasks 2.1–2.2.
- **Install-failure copy:** a plain sentence first, then Retry, with the raw installer text inside a collapsed `<details>` (design D7). Applies to both surfaces; the mockup is updated, and the audit still passes with the details open.
- **Follow-up:** the `add-persistent-onboarding-card` floating card should render the same compact ordered list (task 4.4).
