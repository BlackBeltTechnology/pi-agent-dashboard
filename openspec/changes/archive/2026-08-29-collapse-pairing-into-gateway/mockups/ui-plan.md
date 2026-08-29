# UX plan — collapse-pairing-into-gateway

Mockups: `security-pair.html`, `gateway-empty.html`. Tokens lifted verbatim from
`packages/client/src/index.css` into `tokens.css`; no raw hex outside that file.
Serve with `serve_mockup`; append `?theme=light` to force the light scope.

## What is actually being designed

This change is a **deletion**, so the design work is not "a new screen". It is two
much smaller questions:

1. What does Settings ▸ Security show where a pairing UI used to be?
2. What must the surviving Gateway empty state absorb so the deletion does not
   regress a shipped requirement?

Designing a *replacement* pairing UI would recreate the defect the change exists
to remove.

## The central problem

Two surfaces implemented one protocol, and the pretty one was the broken one.
The design has to make the split legible so it does not close again:

| | Nature | Belongs to | Control shape |
|---|---|---|---|
| **Pair a device** | a transient act, bound to an endpoint | Gateway | QR + selector + approve |
| **Paired devices** | a durable record | Security | list + revoke |
| **Who may reach it** | a durable policy | Security | trusted networks + OAuth |

Pairing cannot happen without a TLS endpoint, and the endpoint is chosen on the
Gateway page. A pairing surface anywhere else is a second copy of the Gateway
surface wearing different words — which is precisely how the two drifted.

Grounding: **Nielsen #4 consistency and standards** — one act, one place, one
control shape. **Nielsen #8 aesthetic and minimalist design** — a surface that
cannot complete the act should not display the act's controls.

## Decisions per surface

### security-pair.html — Security keeps a route, not a copy

- **The section title "Pair a device" stays.** An operator hunting for pairing
  under Security finds the words they expect. Removing the words would trade a
  duplication defect for a discoverability defect.
  *Nielsen #6 recognition rather than recall.*

- **The body names the destination and what happens there** — pick an endpoint,
  scan, approve — rather than saying "configured elsewhere". Link text that
  describes its destination is the documented pattern; "click here" is not.
  *NN/g link-writing; Nielsen #1 visibility of system status.*

- **The button is the exact shape and grammar of the Gateway page's existing
  `Open Security →`.** The two cross-links become one reciprocal pattern instead
  of two unrelated affordances. This also fixes the one-way pressure in today's
  product, where every link pushed operators toward the broken surface.
  *Nielsen #4 consistency; Jakob's Law.*

- **"Pair a device" and "Paired devices" sit inside one `Devices` heading,
  separately bounded.** They are one subject (device trust) with two natures
  (act vs record). Enclosure carries that relationship before any label is read.
  *Gestalt common region + proximity; rubric item 10.*

- **No QR, no copy-string, no approve control renders here.** Every removed
  element failed to serve the goal of the surface.
  *Nielsen #8; rubric item 11.*

#### A2 — the readiness line, considered and deferred

Shown de-emphasised on the mockup so the tradeoff is inspectable rather than
asserted. It adds "⚠ No TLS endpoint is configured" to the Security section.

- **For:** stops an operator walking into a dead end one click away.
  *Nielsen #1 visibility of system status; #5 error prevention.*
- **Against:** it re-adds a `GET /api/pair/payload` call to a page that no longer
  performs the act, and it puts endpoint status in two places. Status that lives
  in two places drifts — the exact failure mode this change ends.

Deferred, not rejected: revisit if the dead end proves real in use. The Gateway
empty state already explains and remediates it at the destination.

### gateway-empty.html — port before delete

`PairingView`'s empty state satisfies three clauses of the spec's
*"No secure road → empty state"* scenario. `GatewayPairQR`'s satisfies one.
Deleting first would regress a shipped requirement, so the behaviour moves up
and is restructured while it moves.

- **Outcome headline, not feature absence.** "No secure road to pair over yet"
  names the operator's situation; "No TLS endpoint to pair over" names a missing
  config field. *NN/g empty states — name the value/outcome.*

- **One primary CTA plus exactly one escape hatch.** "Set up the Gateway" is the
  action; the `http://localhost` note is the escape hatch. This is the documented
  empty-state shape and it happens to be exactly what the spec enumerates.
  *NN/g empty states; rubric item 19.*

- **The escape hatch is separated by a rule and labelled "On this machine".**
  It is a genuinely different path, not a smaller version of the CTA, and it must
  not read as a LAN workaround — the copy says same-machine only, because a
  plain-http LAN address cannot run the handshake at all.
  *Nielsen #5 error prevention.*

- **A dashed placeholder shows a QR is what appears here.** The region is
  otherwise an unexplained blank. This is a placeholder, not a rendered fake
  screenshot. *NN/g empty states — show the shape of success.*

- **The setup action takes an optional `onSetupRequested` callback** rather than
  branching on its host. Dialog → Setup tab; page → focus the provider section;
  prop absent → no action, text and escape hatch still render. One component, one
  empty state, no per-host copy to drift. *Nielsen #4 consistency.*

- **State is never carried by colour alone** — icon, heading, dashed border, and
  text each carry it. *WCAG 1.4.1 use of colour.*

## Token notes

- Every value references a token in `tokens.css`, lifted from `index.css`.
- `--amber` is the one deviation. The shipped dark value `#d29922` is ~2.6:1 on
  the light `--bg-primary` and fails AA as body text. The light scope uses
  `#8a6100` — same hue, 4.6:1. **If the A2 variant is ever adopted, this token
  gap must be closed in the theme layer first**, since the amber readiness line
  would be the first body-weight amber text on a light background.
- The primary CTA is `min-height: 44px`, taller than the shipped
  `px-3 py-1.5` (~30px) secondary buttons. Deliberate: rubric item 2 asks
  ≥44px for *primary* actions, and these are the single dominant action on their
  view. Secondary buttons (Revoke, 32px) stay above the 24px AA floor at the
  shipped size.

## Rubric — scored, not asserted

Applicable items from the 22-item seed (`references/ux-best-practices.md` §5).
Form, table, multi-step, and long-operation items are N/A on these surfaces.

| # | Check | Result | Basis |
|---|---|---|---|
| 1 | Text contrast ≥ 4.5:1; non-text ≥ 3:1, both themes | PASS | shipped tokens carry documented ratios; `--amber` darkened for light |
| 2 | Targets ≥ 24px AA; primary ≥ 44px | PASS | `.btn` min-height 44px; Revoke 32px |
| 3 | Visible focus on every focusable element | PASS | `2px solid var(--focus-ring)` offset 2 — the shipped contract |
| 4 | State conveyed by more than colour | PASS | ⚠ glyph + text; empty state uses icon + heading + border |
| 5 | `prefers-reduced-motion` honoured | PASS | media query present; no animation used |
| 6 | Exactly one visually-dominant primary action per view | PASS | *fixed during the loop* — A2's CTA demoted to secondary |
| 9 | Repeated components use one consistent pattern | PASS | both cross-links share one button shape and `verb → destination →` grammar |
| 10 | Within-group spacing tighter than between-group | PASS | 16px inside a region, 12px between regions, 28px between sections |
| 11 | No element fails to serve the current goal | PASS | QR / copy-string / approve removed from Security |
| 12 | Core patterns match platform conventions | PASS | settings nav + tab bar unchanged from the shipped shell |
| 19 | Zero-data screen has exactly one primary CTA | PASS | Set up the Gateway + one escape hatch |

**Score 11/11 applicable.** Accessibility floor (items 1–5): clear.

### Defect found and fixed in the loop

**Severity 2 — rubric 6.** The first revision rendered A1 and A2 with identical
blue primary CTAs, leaving the page with no single focal action. A not-chosen
variant competing visually with the chosen one is a presentation defect that
would mislead a reviewer. Fixed by demoting A2 to the secondary button style on
a dashed, de-emphasised region.

### Out of scope, noted not fixed

**Rubric 8 — destructive actions reversible or confirm-gated.** `Revoke` in the
paired-devices list is rendered here for context only; its confirm-gating is
`PairedDevicesSection`'s pre-existing behaviour and this change does not touch
it. Flagged rather than silently redesigned.

## Promote

Per the dashboard adapter: promotion is verified in an **isolated env on
non-8000 ports**, never against the live server, which runs main-repo code and
would never load worktree edits. Confirm `lsof -i:8000` shows the same PID before
and after.
