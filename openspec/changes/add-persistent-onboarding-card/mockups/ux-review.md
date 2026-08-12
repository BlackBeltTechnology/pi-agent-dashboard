# UX Review — persistent onboarding card

Mockup: `index.html` · states `?s=A..F` · `?theme=light` · `?bg=settings|session|landing` · `?collapsed=0|1`.
Contrast computed with the WCAG 2.x relative-luminance formula over the shipped
`color-mix` severity ramp — derived in code, not eyeballed.

## Step 1 — Accessibility floor (HARD GATE)

### Text contrast (SC 1.4.3, 4.5:1)

| Pair | Dark | Light | AA |
|---|---|---|---|
| Done label — `--severity-success-fg` on `--severity-success-bg` | 8.25:1 | 5.45:1 | ✓ |
| Active label — `--text-primary` on `--severity-info-bg` | 11.76:1 | 13.74:1 | ✓ |
| Step description — `--text-secondary` on `--severity-info-bg` | 6.83:1 | 7.69:1 | ✓ |
| Locked label + hint — `--text-secondary` on `--bg-secondary` | 8.49:1 | 9.33:1 | ✓ |
| Card title — `--text-primary` on `--bg-tertiary` | 13.23:1 | 15.27:1 | ✓ |
| Progress counter — `--text-secondary` on `--severity-neutral-bg` | 7.69:1 | 8.55:1 | ✓ |
| CTA label — `--bg-primary` on `--severity-info-fg` | 9.72:1 | 8.82:1 | ✓ |
| Active numeral — `--bg-primary` on `--severity-info-fg` | 9.72:1 | 8.82:1 | ✓ |

**Three AA failures were found and fixed during the loop**, all in the first draft:

| Defect | Measured | Fix |
|---|---|---|
| Step description on the active row used `--text-tertiary` | 3.75 / 3.54 | → `--text-secondary` |
| Locked hint used `--text-muted` | 2.59 / 2.23 | → `--text-secondary`; de-emphasis moved to the chip + lock glyph + weight |
| CTA was `#fff` on `--accent-primary` | **3.68** dark | → `--bg-primary` on `--severity-info-fg` |

The third is the significant one: it is the reflexive "primary button" and it
fails the project's own dark default. Any implementation that reaches for
`bg-blue-600 text-white` reintroduces it.

### Non-text contrast (SC 1.4.11, 3:1)

| Pair | Dark | Light | Verdict |
|---|---|---|---|
| Focus ring on card surface | 5.01:1 | 4.95:1 | ✓ **required and met** |
| Card border vs. page background | 1.57:1 | 1.61:1 | not required — see below |
| Success / info row borders | 2.27 / 1.78 | 1.39 / 1.60 | not required — see below |

SC 1.4.11 applies to non-text content **required to understand the content**.
Neither border is: the card is delimited by its fill and elevation shadow, and
step status is carried by four redundant channels — the ✔/numeral glyph, the
label wording, the `.sr-only` status text, and the row tint. The borders are
decorative reinforcement. This is stated rather than scored as PASS, because
claiming a 1.39:1 border "passes" would be dishonest.

### Other SC

- **1.4.1 Use of Colour** ✓ — done/active/locked each carry a distinct glyph
  (✔ / numeral / 🔒) plus text; the collapsed pill conveys progress with a
  count *and* filled dots.
- **2.5.8 Target Size** ✓ — 28px ≥640px (clears 24px AA); 44px below 640px.
- **2.4.7 Focus Visible** ✓ — shared `.focus-ring` utility, 2px, offset 2.
- **1.3.1 / 4.1.2** ✓ — `role="complementary"` + `aria-labelledby`; the collapse
  control carries `aria-expanded`. Status is real text, not an `aria-label` on a
  plain `div` (an early draft did exactly that; UAs expose it inconsistently).
- **No focus trap** ✓ — the card is not a dialog and must never become one.

**Gate: PASS.**

## Step 2 — Heuristic rubric

| # | Check | Verdict |
|---|---|---|
| 1 | Contrast ≥4.5:1 both themes | PASS (after 3 fixes) |
| 2 | Targets ≥24px / 44px touch | PASS |
| 3 | Visible focus | PASS |
| 4 | State conveyed by more than colour | PASS |
| 5 | Visibility of system status (H1) | PASS — `n of 3` persists even collapsed |
| 6 | Exactly one visually-dominant action | PASS in isolation / **FAIL on the landing route** — Finding 1 |
| 7 | State change visible <1s | PASS — `useProvidersReady` refetches on `provider-auth-event` |
| 8 | User control and freedom (H3) | PASS — collapse is reversible in one click; no destructive dismissal |
| 9 | Repeated components use one pattern | PASS — surface matches `WorktreeInitStack`; colours from the shared ramp |
| 10 | Within-group tighter than between-group | PASS — 7px inside a row, 9px between rows, 9px body padding |
| 11 | No element fails to serve the goal | **FAIL on the landing route** — Finding 1 |
| 15 | CTA is an outcome verb | PASS — "Open settings", "Add folder…", "Start session" |
| 18 | Blocked state states the fix | PASS — locked rows name the unmet prerequisite |
| 19 | Zero-data screen has one primary CTA | PASS |

12/14 applicable = **0.86**. Items 12–14, 16–17, 20–22 N/A (no form fields, nav,
tables, or multi-step wizard on this surface).

## Step 3 — PURE friction

### Task — *"I just installed this. Get me to a running session."*

| Step | Before | After |
|---|---|---|
| Learn there are three steps | **green** — landing page states it | **green** — unchanged |
| Do step ① | green | green |
| **Learn step ② exists, after doing ①** | **red** — checklist was unmounted by the navigation; nothing on the providers page mentions folders | **green** — card still on screen, ② has just unlocked |
| Know ① actually succeeded | **red** — must navigate back to find out | **green** — ① flips to done in place |
| Do step ② | green | green |
| **Learn step ③ exists** | yellow — modal closes back onto the landing page, so it survives here | green |
| Do step ③ | green | green |
| Know onboarding is finished | **red** — the spawn navigates to chat; no completion signal | **green** — the card disappearing *is* the signal |

Task colour = worst step: **red → green.** Three red steps eliminated; this is
the change's entire justification and it holds up under the walk-through.

### Regression check — *"I'm a returning user with no active sessions."*

Before: `sessionsCount === 0` → step ③ pending → full onboarding, in the content
pane only. After: latch → `allDone` → **no card at all**. Strictly better, and it
is the reason the latch is not optional.

## Findings

**Finding 1 — Two competing primary actions on the landing route (Severity 2).**
State `?s=F` renders the `LandingPage` "Open settings" button and the overlay's
"Open settings" button simultaneously, both filled, ~600px apart. Von Restorff
requires one dominant action; this screen has two identical ones, and a user who
clicks the "wrong" one gets the same result — so the cost is hesitation, not
error. This is the accepted cost of design decision **D3** (the "show both"
option), and it is confined to the single route where `LandingPage` renders.

Cheapest mitigations, in order of cost, all one-line changes at the mount site:
1. render the overlay pre-collapsed on the landing route (keeps constant presence, removes the duplicate CTA);
2. render the overlay's CTAs as outline rather than filled when `LandingPage` is mounted;
3. suppress the overlay on the landing route (the option explicitly rejected in D3).

Recommendation: **(1)**. It preserves what D3 was protecting — the card exists on
every route, so the user never has to model its appearance — while removing the
duplicate dominant action. It is a change to D3's rendering, not to its principle.

**Disposition: recommendation declined; D3 upheld as written.** Constant,
unconditional presence is the property being bought, and any route-conditional
rendering — collapsed included — reintroduces the "when does this appear?"
question the change exists to remove. The duplication is an accepted trade with
a recorded rationale (`design.md` D3). This finding is **closed, not open**: an
implementation SHALL NOT silently remedy it.

**Finding 2 — Composer collision (Severity 3, fixed in-loop).** The first score
pass put the card directly on top of the composer's right end, where the send
controls live. Fixed by the `raised` modifier (`bottom:80px`) driven by one
boolean at the mount site. Worth an explicit test, because the failure is
invisible on the landing and settings routes where most testing happens.

**Finding 3 — Label and description ran together (Severity 4, fixed in-loop).**
`.lbl` / `.sub` were inline spans, rendering "Setup credentialsConnect an LLM
provider." The implementation must not treat block-level as cosmetic.

**Finding 4 — Locked de-emphasis fights the contrast floor (Severity 3, resolved).**
The instinct for a locked row is greyer text. Both grey tokens fail AA on this
surface. Locked rows now use full-strength `--text-secondary` and rely on the
neutral chip, the lock glyph, and font weight for de-emphasis. A reviewer seeing
`--text-muted` reintroduced should treat it as a regression.

**Finding 5 — The filled CTA reads unusually dark in light theme (Severity 4, accepted).**
`--severity-info-fg` in light is a deep navy, so the light-theme CTA is darker
than the shipped `--accent-primary` blue. It is consistent within the card,
traces to the shared ramp, and measures 8.82:1. The alternative that "looks
right" (`#fff` on `--accent-primary`) fails AA in dark. Correctness wins.

**Finding 6 — Rare corner sharing with `WorktreeInitStack` (Severity 4, accepted).**
Per D5 the transient overlay is drawn above the standing reminder. Reachable only
with ≥2 concurrent worktree inits *and* incomplete onboarding.

## Step 4 — Verdict

| Gate | Result |
|---|---|
| Accessibility floor | **PASS** (3 AA failures found and fixed in-loop) |
| Heuristic rubric | 0.86 — single deduction is Finding 1, a known accepted trade |
| Task friction | red → green on the primary task |
| Token fidelity | PASS — zero new custom properties |

**Ship-ready.** No open decisions: Finding 1 was escalated, reviewed, and closed
in favour of the existing D3 (recommendation declined). Every other finding is
either fixed in the mockup or explicitly accepted with a recorded rationale.

The 0.86 rubric score stands as the honest number — it is not rounded up because
the deduction was accepted. An accepted trade is still a trade.
