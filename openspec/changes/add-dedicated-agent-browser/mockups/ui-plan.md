# UI plan: Browser settings with behaviour controls

Surface: Settings > Plugins > Browser Relay (`settings-section` claim, `packages/browser-plugin/src/client/BrowserSettings.tsx`).
Mode: preserve (anti-slop-redesign). Protected: every existing `data-testid` (`browser-profile-<dir>`, `browser-token-input-<dir>`, `browser-zero-dialog-<dir>`, `browser-allowed-domains-<dir>`, `browser-connect-<dir>`, `browser-disconnect-<id>`, `browser-store-link-<dir>`), write-only token behaviour, global `Enabled` toggle.
Design Read profile: `product-ui`. Image direction: off.

## Problem with today's section

- Every Chrome profile (17 on the probed host) renders fully expanded, with a token input, zero-dialog, domains and an audit list. Only 2 profiles have the extension installed.
- Behaviour lives in the skill text, not in settings: which browser the agent uses, what happens on failure, whether the agent may connect without asking.
- `defaultBrowser` and `allowMultipleInstancesPerProfile` exist in `configSchema.json` with no UI.
- Nothing warns that a profile running a password manager detaches on login pages (spike 2026-10-17).

## Sections (top to bottom)

| # | Section | Contents | Config key (proposed) |
|---|---|---|---|
| 1 | Header | title, global Enabled toggle (existing) | `enabled` |
| 2 | Agent browsing | Default browser (3 radio cards + real-profile picker), If unavailable (ask / try next / stop), Disconnect when idle, Connections per Chrome profile, Open live view on connect, Default allowed domains | `defaultBrowser`, `realProfile`, `onUnavailable`, `idleDisconnectMinutes`, `allowMultipleInstancesPerProfile`, `openLiveViewOnConnect`, `allowedDomains` |
| 3 | Dedicated agent profile | status pill, status / last used / size / one-session facts, data location, Open to sign in, Stop, Reset profile (confirm) | none (read-only display) |
| 4 | My Chrome profiles | installed profiles as collapsible rows with risk warning; others behind one disclosure | `browsers.<dir>.*` (existing) |
| 5 | Activity | audit list incl. `detach` with reason | audit (existing + `detach`) |

## Defaults (safe first)

- Default browser: Dedicated agent profile.
- If unavailable: Ask me. Never a silent fallback (registry research §13).
- Consent: unchanged. Dedicated never asks; real profiles use Chrome's Allow dialog unless `zeroDialog` + token.
- Auto-disconnect: 30 min idle. Connections per profile: one.

## Tokens

Surfaces: `--bg-primary` page, `--bg-secondary` group panel, `--bg-tertiary` rows, borders `--border-primary` / `--border-secondary` / `--border-subtle`.
Text: `--text-primary` / `--text-secondary` / `--text-tertiary`; links `--accent-text`.
Selection: `--accent-primary` ring + `--accent-soft` fill on the chosen radio card.
Status: running = `--severity-success-*`, stopped = `--severity-neutral-*`, password-manager risk = `--severity-warning-*`, not set up / disabled = `--severity-info-*`, destructive button = `--severity-error-*`.
Focus: `--focus-ring`. No raw colour literals; `tokens.css` is generated from `index.css`.

## States (switcher in mockup)

Design decisions 2026-10-17 (plan-proposal): consent group and in-session connect prompt dropped; account chips dropped (no clean source; cookie reads are deny-listed).

`normal` · `dedicated-missing` (no profile yet: setup call-to-action replaces account list) · `relay-off` (Enabled off: connects disabled with reason) · `no-chrome` (`canOpenChrome:false`: single notice, no connect buttons, dedicated option disabled).

## Rules cited

- Nielsen #1 visibility of system status: status pill per browser, detach reason in Activity.
- Nielsen #5 error prevention: Reset profile behind a confirm.
- Nielsen #6 recognition over recall: default browser as labelled cards with the consequence stated.
- Hick's law: 3 browser choices, 3 fallback choices.
- Progressive disclosure (NN/g): profiles without the extension collapsed behind one row.
- Gestalt proximity: behaviour vs per-profile settings in separate groups.
- WCAG 2.2 AA: 4.5:1 text, 44px targets below 640px, visible focus.

## Scored rubric (2026-10-17)

`score_mockup` could not launch (no Playwright chromium). Fallback per `run-mockup-loop-without-playwright`: contrast computed from `tokens.css` in code, breakpoints measured with agent-browser (session `mockb`).

| Criterion | Result | Evidence |
|---|---|---|
| Contrast, dark + light | PASS | All pairs ≥ 4.5:1. Lowest: `--text-tertiary` on selected card 4.75 (light) / 4.82 (dark); warning pill 6.13 / 7.77; link `--accent-text` 5.88 / 6.56. |
| Responsive | PASS | 375 / 768 / 1280, both themes: `scrollWidth == clientWidth`, 0 elements past the viewport. 0 controls under 44px at 375 (desktop density from 640px is intended). |
| Hierarchy | PASS | One group per concern. Default-browser cards lead; destructive Reset is isolated right and confirmed. |
| Spacing | PASS | Tailwind 4px scale; group `p-4`, row `p-2.5`/`px-3`, stack `space-y-2..4`. |
| Token fidelity | PASS | No raw colour literals in `index.html`; `tokens.css` generated from `index.css`. |
| Anti-slop | PASS | System font stack, no gradients/glow, no em-dashes in UI copy, real account data from the host. |
| Console | PASS | No errors. |

Defects found and fixed:
1. Selected "Dedicated agent profile" card rendered dimmed: a hidden disabled duplicate radio still matched `.card:has(input:disabled)`. Fixed with one radio disabled by the state switcher.
2. Primary button white on `--accent-primary` 3.68:1 (dark): FAIL. Switched to `--accent-solid` ("fill behind white text", 5.17:1), same as `vault-ui.tsx` `PRIMARY_BUTTON_CLASS`.
3. `no-chrome` state still offered "One of my Chrome profiles": now disabled together with the dedicated option.
