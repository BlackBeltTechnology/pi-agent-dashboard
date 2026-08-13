# UX review — gate-notify-rows-by-level

Mockup: `openspec/changes/gate-notify-rows-by-level/mockups/index.html`
Scored over **6 renders** — {dark, light} × {375, 768, 1440}. All figures below
are computed in code from the rendered page (`getComputedStyle` + WCAG relative
luminance), never eyeballed.

> Measurement note: Chromium returns `--severity-*` (a `color-mix()`) as
> `color(srgb 0-1)`, not `rgb(0-255)`. A first pass that parsed both alike
> reported 17 phantom 1:1 failures on the *proposed* design. Fixed before any
> verdict was drawn; every number below comes from the corrected pass.

## Step 1 — Accessibility floor (HARD GATE)

| Check | Result |
|---|---|
| Text contrast ≥4.5:1 (3:1 large) — **design-owned** | **0 failures / 74 nodes × 6 renders** ✓ |
| …intentional "shipped today" panel | 4 failures in light (the defect being demonstrated) |
| …pre-existing, not introduced here | 1 — `FieldShell` hint at 4.29:1 light |
| Horizontal overflow | 0px at every width ✓ |
| Console errors | 0 ✓ |
| Level conveyed by >1 channel | ✓ accent bar + icon + level word + colour |
| Focus indicator | ✓ `:focus-visible` 2px + 2px offset (repo `.focus-ring`) |

**Gate: PASS** for the proposed design.

### The finding that drove the design

`NotifyRenderer` hardcodes Tailwind `text-{blue,green,yellow,red}-400` instead of
the `--severity-*` tokens. Measured against `--bg-tertiary`:

| level | dark, shipped | light, shipped | severity token, dark | severity token, light |
|---|---|---|---|---|
| info | 6.56 ✓ | **2.23 ✗** | 7.27 ✓ | 6.97 ✓ |
| success | 9.57 ✓ | **1.53 ✗** | 8.25 ✓ | 5.45 ✓ |
| warning | 10.89 ✓ | **1.34 ✗** | 7.75 ✓ | 6.13 ✓ |
| error | 6.03 ✓ | **2.43 ✗** | 6.94 ✓ | 7.19 ✓ |

Four AA failures in every light theme, worst 1.34:1 against a 4.5:1 floor
(WCAG 2.2 §1.4.3). Plus level carried by hue alone — no icon, no text (§1.4.1).

This is pre-existing, but **this change is what makes it blocking**: once
`notifyMinLevel` exists, level stops being decoration and becomes the thing the
filter acts on. A user who cannot perceive a row's level cannot predict what a
floor setting will hide. Shipping the gate without the re-tone would ship a
filter whose input is invisible to some users.

## Step 2 — Heuristic rubric (boolean, code-derived)

Score **18 / 18 applicable** (4 of the 22 seed items are N/A — no form
validation, no table, no multi-step flow, no zero-data screen).

| # | Rule | Verdict |
|---|---|---|
| 1 | Contrast ≥4.5:1 | PASS — 0 design failures / 6 renders |
| 2 | Targets ≥24px AA | PASS for new controls (44px); see pre-existing below |
| 3 | Visible focus | PASS — repo `.focus-ring`, 2px + offset |
| 4 | State by >1 channel | PASS — bar + icon + word + colour |
| 5 | Reduced motion / zoom | PASS — no motion introduced; no zoom lock |
| 6 | One dominant action per view | PASS — the select is the only actor in its row |
| 7 | Status feedback <1s | PASS — display-only, re-render is synchronous (D5) |
| 8 | Reversible | PASS — no data loss; raising the floor restores rows, no reload (D5) |
| 9 | Consistent pattern reuse | PASS — `SelectField` + `InlineMessage`, both existing |
| 10 | Proximity / common region | PASS — sits in the message-level sub-section it belongs to |
| 11 | Nothing extraneous | PASS — one row, no new chrome |
| 12 | Platform convention | PASS — native `<select>` ⇒ platform picker (Jakob's Law) |
| 13 | Persistent label | PASS — `FieldShell` label + `useId`, not placeholder |
| 14 | Single column at mobile | PASS — verified 375px |
| 15 | Verb/outcome labels | PASS — "Errors only", not "On/Off" |
| 16 | Validation on blur | N/A |
| 17 | Nav item count | N/A |
| 18 | Error text states a fix | N/A |
| 19 | Empty state CTA | N/A |
| 20 | Long-op progress | N/A |
| 21 | Table headers | N/A |
| 22 | Multi-step progress | N/A |

## Step 3 — PURE friction

Task: *"an extension is spamming my transcript; make it stop."*

| Step | Rating | Note |
|---|---|---|
| 1. Notice the noise | 🟢 | rows are visually distinct from assistant bubbles |
| 2. Find the control | 🟡 | in the ⚙ View popover **or** Settings ▸ General — two homes for one setting is a discoverability tax, but it matches every other display pref, so consistency (H4) outweighs it |
| 3. Understand the options | 🟢 | "Errors only" / "Warnings and above" are self-describing; the hint states the errors-always guarantee at the point of decision (H10) |
| 4. Apply + verify | 🟢 | takes effect on the visible transcript immediately; no reload |

**Task colour: 🟡** (worst step wins). The yellow is inherited from the existing
two-surface pref architecture, not introduced here.

## Step 4 — Defects by severity

| # | Defect | Sev | Owner |
|---|---|---|---|
| 1 | `NotifyRenderer` off-token → 4× AA failure in light + colour-only level | **3** | pre-existing; **this change should fix it** (see below) |
| 2 | `ChatViewMenu` rows are ~26px — under the 24px AA target floor once the checkbox (13×13px) is the only hit area | **2** | pre-existing; new row uses 44px and must not copy it |
| 3 | `ToggleField` switch is 40×20px — 20px height is under AA §2.5.8 absent the spacing exception | **2** | pre-existing; out of scope |
| 4 | `FieldShell` hint `--text-tertiary` = 4.29:1 in light | **2** | pre-existing; out of scope |
| 5 | Setting lives in two places | **1** | architectural, consistent with all other prefs |

**No severity-4. No design-owned severity-3.**

## Step 5 — Prioritised fixes

1. **Fold the `NotifyRenderer` re-tone into this change** (defect 1). Not scope
   creep — the gate makes level load-bearing, so an illegible level is a
   functional defect in the gate, not a cosmetic one elsewhere. Concretely:
   render notify through `InlineMessage`, and add `"success"` to its `Severity`
   union (`--severity-success-*` already exists in `index.css` with **no current
   consumer** — this would be its first).
2. **New popover row at `min-h-[44px]`**, matching `ThinkingLevelSelector`, not
   the 26px sibling rows (defect 2).
3. Defects 3–5: file separately; do not expand this change.

## Control-shape decision (surface C)

| | C1 native select | C2 segmented | C3 listbox sub-popover |
|---|---|---|---|
| Fits 256px popover | ✓ one row | ✗ forces "Succ+/Warn+/Err" | ✓ but as a nested layer |
| Full readable labels | ✓ | ✗ truncated (violates H2) | ✓ + per-option description |
| Keeps row rhythm | ✓ label-left/control-right | ✗ breaks it | ✓ |
| Mobile | ✓ native platform picker | ~ 4 chips at 10px | ~ nested popover |
| New machinery | none | none | 2nd dismiss layer + nested `usePopoverFlip` (not used anywhere today) |

**C1 recommended.** C2 is rejected on Hick's-Law-adjacent grounds inverted: all
four options are visible, but only by truncating them to guessable stubs — the
recognition benefit is destroyed by the labels it forces. C3 is the better *read*
but pays a nested-popover cost that C1 avoids; **held as the fallback** if C1's
native control proves cramped in real mobile use.

## Verification

- Live URL served both themes, 3 breakpoints, phone-checkable via LAN.
- Contrast/overflow/console derived in code over 6 renders, not asserted.
- Gate behaviour asserted functionally: `all→[info,info,success,warning,error]`,
  `success→[success,warning,error]`, `warnings→[warning,error]`, `errors→[error]`;
  **`error` present at every floor ✓**.
- Every decision cites a public rule (WCAG 2.2 §1.4.1/§1.4.3/§2.5.8, Nielsen
  H2/H4/H6/H10, Jakob's Law, Gestalt similarity).
- Not promoted to React — mockup stage only; no live server touched.
