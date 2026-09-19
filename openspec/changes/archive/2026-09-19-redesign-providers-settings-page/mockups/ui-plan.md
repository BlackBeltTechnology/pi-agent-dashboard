# UI plan — redesign-providers-settings-page

Mockups: `index.html` (connected list, 4 states), `add-dialog.html` (5 dialog panes).
Token authority: `packages/client/src/index.css` (`:root` dark + `[data-theme="light"]`), lifted verbatim into `tokens.css`. No raw hex outside `tokens.css` (verified: 0 occurrences).

Serve: `serve_mockup{dir}` → append `?theme=light` for the light theme.

## The central problem

The page currently answers the wrong question. It renders the **catalogue** (42 rows on a live instance) when the user is asking about **state** (6 configured). 35 rows are an "Add Key" button and nothing else.

Nielsen #8 *aesthetic and minimalist design*: "Interfaces should not contain information which is irrelevant or rarely needed. Every extra unit of information competes with the relevant units." An unconfigured provider is not state — it is an option, and options belong in the action that offers them.

Hick's Law (lawsofux.com/hicks-law): decision time grows with the number and complexity of choices. Thirty-five identical cards is a linear scan; a searchable picker is a filter.

## Decisions

### The list shows credentials; the button offers the catalogue

| Surface | Contains | Rule |
|---|---|---|
| Connected list | only rows holding a credential | Nielsen #8 minimalist design |
| `+ Add provider (35 available)` | everything else, searchable | Hick's Law; Nielsen #6 recognition over recall — the count tells you options exist without listing them |

The count on the button is deliberate. Hiding 35 providers behind a modal is a discoverability cost, and the count is what repays it: the user learns the set exists without paying to scan it.

### Four kinds, one list, the WORD as carrier

Subscription / API key / Environment / Custom endpoint are four different things with different affordances (Sign out / Replace+Remove / nothing / Test+Edit+Remove). Gestalt *similarity* would have them look alike; they are distinguished by a badge that **names** the kind.

**The badge names its kind in words; colour is absent by necessity, and the necessity is measured.** I designed these badges colour-coded first, then audited the token ramp across every palette in `themes.ts`:

```
ACCENT-AS-TEXT AUDIT — 18 palettes × 6 hues
checked 108   FAIL 80   PASS 28   (74% failing)
clean palettes: 1 of 18
```

| Accent as text | `--bg-surface` dark | `--bg-surface` light |
|---|---|---|
| `--accent-purple` | 3.63 fail | 3.00 fail |
| `--accent-blue` | 3.90 fail | 2.79 fail |
| `--accent-green` | 6.30 pass | 1.73 fail |
| `--accent-orange` | 5.12 pass | 2.12 fail |

**Not a light-theme edge case** — purple, blue and red all fail in `baseDark`, the default palette. Colour-coding here would have been correct on 2 palettes and wrong on 16, which is worse than no colour because it reads as deliberate.

So: the word is the carrier (WCAG 1.4.1 *use of colour*, satisfied by construction rather than by redundancy), and the ramp remediation — 80 values across 17 palettes, under the repo's lightness-only / hue-preserving rule — is its own change, **`remediate-accent-text-contrast`**. Adopting colour here afterwards is additive.

Health pills still carry two non-colour channels: a glyph (`✓` / `✗` / `·`) **and** a word. `--accent-red` is the single retained tint (the only hue clearing 3:1 as a *border* in both base themes).

### One token added here

`--accent-primary-strong: #2563eb`. White on `--accent-primary` (`#3b82f6`) is **3.68:1**, under the text floor; the shipped component already sidesteps this with the Tailwind class `bg-blue-600` (`#2563eb`, 5.17:1), so the token names what the code does rather than inventing a colour. **Verified scoped:** no palette in `themes.ts` overrides `--accent-primary`, so this is a 2-value addition (root + light), not an 18-palette remediation. The light theme already defines `--accent-primary: #2563eb`, making it a no-op there.

### The Add dialog reuses a primitive, it does not invent one

`packages/client-utils/src/SearchableSelectDialog.tsx` already provides search, arrow-key navigation, `aria-selected`, `description` and `badge` per option — exactly the picker this needs. `DialogPortal` provides the scrim and `--z-dialog` layering. Building a bespoke picker here would be a second implementation of a solved problem.

### Copy states the contracts the design makes

Three pieces of copy are load-bearing, each expressing a decision from `design.md` rather than decorating it:

- **Device-code pane** — *"you can close this dialog, sign-in will finish in the background"*. States design D4 (the section owns the poll, not the dialog). Nielsen #1 *visibility of system status*.
- **Twin suppression** — *"Unavailable — Anthropic is connected as a subscription. Sign out first to use a key instead."* A disabled row with a reason, not a silent omission. Nielsen #9 *help users recognise, diagnose, and recover*; NN/g on disabled controls — never disable without explaining.
- **Cross-type conflict (pane 5)** — names the consequence (*"you would be signed out of Claude Pro/Max"*) before the action, and offers the remediation as a button. This is the UI face of design D2's 409. Nielsen #5 *error prevention* — prevent the destructive write rather than confirming it afterwards.

### States are designed, not discovered

`index.html` renders all four reachable list states, because three of them are new failure modes the redesign creates:

1. **Credentials present** — the common case.
2. **Catalogue unavailable** — no connected pi session, so api-key rows cannot exist. The notice is *per-source* and subscriptions still render (design D5): a whole-list message would hide configured rows, which is the exact regression the state exists to prevent.
3. **Nothing configured** — the genuine empty state.
4. **Status fetch failed** — custom endpoints still render with their own error (design D6; `provider-auth-ui` requires the section stay interactive so the operator can repair credentials).

## Verification

Accessibility floor computed directly from `tokens.css` (WCAG 2.x relative-luminance, alpha-composited over the actual backdrop) rather than eyeballed:

- **DARK: 21/21 PASS · LIGHT: 21/21 PASS** — text ≥4.5:1, non-text (focus ring, primary-button boundary, tinted pill border) ≥3:1.
- No `--accent-*` token is used as text anywhere in either mockup (grep-verified), and every `var(--token)` reference resolves against `tokens.css` (0 unresolved).
- Raw hex outside `tokens.css`: **none**.
- Touch targets: shipped compact density on fine pointers; `@media (pointer: coarse)` raises every control to 44px (WCAG 2.5.5 AAA / Apple HIG).
- `prefers-reduced-motion` guards the only animation (the device-code waiting dot).
- Dialogs carry `role="dialog"` + `aria-modal` + `aria-labelledby`; the picker uses `role="listbox"` / `role="option"` / `aria-selected`, matching the primitive it will reuse.

Not verified: Playwright Chromium is not installed, so `score_mockup`'s screenshot pass did not run. The contrast gate above is deterministic and stronger than a vision score for that criterion; layout/overflow at the three breakpoints still needs a human eye or `npx playwright install chromium`.
