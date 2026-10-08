# Mockup score — focus-and-blocks.html

Captured with `score_mockup` at 375 / 768 / 1440, dark + light, Focus off + on, tabs 1–5.

| Check | Result | Note |
|---|---|---|
| Contrast (WCAG AA) both themes | PASS | Body/desc text uses `--text-secondary` (contract a11y #6: `--text-tertiary` not used as text in light). Status chips use `--accent-*-text` tokens. |
| Responsive / targets | PASS (after fix 1) | Grid stacks < 960px with preview first; < 640px switches 46×28 with 44px hit area, segmented/buttons `min-height:44px`. |
| Hierarchy | PASS | One focal point per tab: the live sidebar; one primary state change (Focus pill) in the app bar. |
| Spacing | PASS | 4/6/8/12px rhythm, row `min-height:48px`, card recipe from `ui-contract.md`. |
| Token fidelity | PASS | Colors copied 1:1 from `packages/client/src/index.css` `:root` + `[data-theme="light"]`; status stripes reuse the shipped gradient recipes. |
| Anti-slop | PASS | Real product data (sessions, models, folders); no hero, no purple brand gradient (purple only as the existing needs-you status). |
| Console | PASS | Static page, no fetches; rendered all tabs without errors. |

Score: 7/7.

## Fixes applied during the loop

1. Mobile touch targets below 44px (ui-contract a11y #2, Fitts's Law) → enlarged switch + hit area, 44px segmented/buttons < 640px.
2. Effects placed under "Appearance" (no such Settings tab; theme pickers live in the sidebar header) → moved to Settings › Sessions next to Card blocks (H4 consistency, one place for card display).

## Design findings folded into the spec (user-approved)

- **D-1 Latest intent wins (folder-focus).** Spec: "selection beats header click". With a session selected, clicking another folder's "N sessions · click to view" would do nothing (violates H1 feedback). Mockup: the most recent action (select or folder click) decides the focused folder.
- **D-2 Editing the built-in focus profile (focus-mode).** First row edit copies the built-in profile into a stored custom profile, then applies the edit. Spec scenario "Edit one profile row" says "no other key SHALL change", which only holds for an existing custom profile.
- **D-3 Focus-on notice on settings pages (focus-mode, H1).** While Focus is on, Card blocks / Folder settings / Effects show "Focus is on · these are your normal settings · Turn off Focus", so a user editing a switch understands why the sidebar does not change.
