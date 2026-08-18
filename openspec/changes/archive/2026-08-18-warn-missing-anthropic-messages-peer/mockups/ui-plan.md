# ui-plan — anthropic-peer-hint

Target surface: Settings → Providers → **Provider Authentication** → Subscriptions (OAuth),
the `anthropic` `OAuthProviderRow`. Mockup: `mockups/index.html` (states A–E, dark + light via
the Toggle theme control).

## Surface → tokens → states

| Surface | Tokens (theme-system CSS vars, no raw hex) |
|---|---|
| OAuth row shell | `--bg-tertiary`, `--border-primary`, radius 4 (matches `OAuthProviderRow`) |
| Connected marker / expiry | `--accent-green`, `--text-muted` (untouched by this change) |
| Hint box | `--severity-warning-bg` / `-fg` / `-border` via the `InlineMessage` primitive |
| Left accent bar | `--severity-warning-fg` (3px, `InlineMessage` built-in) |
| Package name in copy | monospace, inherits `--severity-warning-fg` |
| Install action pill | 1px `currentColor` border on transparent — inherits the severity fg |
| Focus ring | `--focus-ring` via the shared `.focus-ring` utility |

States: **A** connected + peer missing (hint + Install peer) · **B** install in flight (disabled
spinner pill) · **C** peer installed (nothing renders) · **D** signed out (nothing renders) ·
**E** API Keys row incl. `anthropic-api` (nothing renders).

## Placement

Inside the row, below the name / Connected / Sign Out header line — the same slot the row already
uses for the enterprise-domain prompt and the device-code panel. The hint therefore sits directly
under the success signal that triggers it (Gestalt proximity), and never displaces the Connected
marker or expiry countdown the operator scans for.

## Rubric

| Criterion | Verdict | Note |
|---|---|---|
| Contrast (WCAG AA) | PASS | Severity triples are the repo's tuned tokens (≥3:1 floor, AA on the majority across 9 themes × light/dark); verified visually both themes. |
| Responsive | PASS | 375/1440 no overflow; the long package name wraps via `break-words`. Install pill is 32px min-height + 8px row gap for the ≥44px tap slice. |
| Hierarchy | PASS | Row header stays the primary line; the hint is the only warning-toned surface in the section, bold title + regular body. |
| Spacing | PASS | Inherits `InlineMessage` padding (`pl-3.5 pr-3 py-2`) and the section's `space-y-2` row rhythm. |
| Token fidelity | PASS | Every colour traces to `--severity-warning-*` / existing row tokens; mockup copies `:root` + `[data-theme=light]` verbatim. |
| Anti-slop | PASS | No hero, no gradient, no purple glow; reuses the shipped primitive rather than a bespoke banner. |
| Console | PASS | Static page, no errors. |

## UX findings applied to the design

1. **Reuse `InlineMessage` (`severity="warning"`)** instead of a hand-rolled div — the design's
   "inline advisory" is exactly this primitive (accent bar, icon, title, body, action row).
   Hand-rolling would fork the severity styling.
2. **Copy leads with the next step, not with a failure**: "One more step: install the Anthropic
   peer package". Warning tone sitting under a green **Connected** marker risks reading as
   "sign-in failed"; framing it as a remaining step keeps the OAuth result unambiguous while still
   naming the consequence (`waiting_peers`) and the remedy (Nielsen #9).
3. **The exact package name is shown verbatim** so a CLI install is copy-pasteable.
4. **Gate on `authenticated`** (state D) — a signed-out row has no problem to report, and hinting
   there would be a nag on a subscription the operator never opted into.
5. **No dismiss control.** A dismissible advisory needs persisted dismissal state or it reappears
   on every rerender — worse than either extreme. The hint already self-clears on the real fix.
6. **One action only** — a secondary "Learn more" next to the single action that resolves the state
   dilutes it (Nielsen #8, minimalist design).
7. **No success banner in state C.** Once installed the surface is simply absent; the package
   queue's own toast already confirms the install.

## Superseded

An earlier pass targeted the LLM Providers custom-endpoint card (`api: "anthropic-messages"`).
Retargeted to the OAuth row: the Claude-subscription sign-in is the path operators actually take,
and its Connected state is the moment they believe setup is finished. The card target is now
explicitly out of scope in `proposal.md`.
