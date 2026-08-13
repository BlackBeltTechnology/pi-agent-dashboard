# UX Review — bind reachability advisory

Protocol: `references/ux-best-practices.md` §4 (5 steps). Score derived in code, not asserted.
Mockup: `index.html` · states `?s=A..F` · themes `?theme=light`.

## Step 1 — Accessibility floor (HARD GATE)

Contrast computed with the WCAG 2.x relative-luminance formula, not eyeballed.

| Pair | Dark | Light | AA |
|---|---|---|---|
| `--warn-body` on `--warn-bg` (sentence) | 8.74:1 | 9.20:1 | ✓ |
| `--warn-fg` on `--warn-bg` (host, entry) | 6.78:1 | 6.45:1 | ✓ |
| Primary button label on fill | 6.78:1 | 6.45:1 | ✓ |
| Green "Trust host" chip | 8.07:1 | 8.14:1 | ✓ |
| `--warn-border` on `--warn-bg` (1.4.11) | decorative | 3.70:1 | ✓ |

- **1.4.1 Use of Colour** ✓ — the advisory carries a triangle icon + a border + a text sentence; amber is never the sole channel.
- **2.5.8 Target Size (Minimum)** ✓ — 28 px desktop (> 24 AA), 44 px at ≤767 px.
- **2.4.7 Focus Visible** ✓ — `:focus-visible` 2 px `--focus-ring`, offset 2.
- **4.1.3 Status Messages** ✓ — advisory is `role="status"`, so it is announced when it appears after adding a network with no page change (see Finding 7).

**Gate: PASS.**

## Step 2 — Heuristic rubric (applicable items from the 22-item seed)

| # | Check | Verdict |
|---|---|---|
| 1 | Contrast ≥4.5:1 | PASS |
| 2 | Targets ≥24 px (44 primary/mobile) | PASS |
| 3 | Visible focus | PASS |
| 4 | State conveyed by more than colour | PASS |
| 6 | Exactly one visually-dominant action | PASS — filled button dominant, link subordinate (Von Restorff) |
| 7 | State-changing action shows status <1s | PASS — advisory clears immediately; dirty chip lights |
| 9 | Repeated components use one pattern | PASS *in the mockup* — both banners share the ramp (see Finding 4 for shipped code) |
| 10 | Within-group tighter than between-group | PASS — 9 px inside advisory, 10 px between blocks |
| 11 | No element fails to serve the goal | PASS |
| 15 | CTA is an outcome verb | PASS — "Listen on all interfaces", not "OK" |
| 18 | Message states a fix, not just "invalid" | PASS — names host, entry, consequence, remedy, restart cost |
| 19 | Zero-data screen has one primary CTA | PASS |

12/12 applicable = **1.00**. Items 13–14, 16–17, 20–22 N/A (no form fields, nav, tables, or multi-step flow on this surface).

## Step 3 — PURE friction

### Task 1 — *"I added my LAN as trusted and my phone still can't connect."*

| Step | Before | After |
|---|---|---|
| Notice something is wrong | **red** — nothing on screen indicates a problem | **green** — advisory named at the point of configuration |
| Diagnose the cause | **red** — requires knowing `bindHost` exists and lives on another page | **green** — sentence states cause |
| Apply the fix | **yellow** — navigate, find picker, pick radio | **green** — one button |
| Know it took effect | **red** — silent until restart | **yellow** — restart disclosed in-line, but not confirmed until restart |

Task colour = worst step: **red → yellow.**

### Task 2 — *"Let my Tailscale phone reach the dashboard."*

| Step | Before | After |
|---|---|---|
| Find the tailnet in the dropdown | **yellow** — listed as `utun4`, unrecognisable | **green** — labelled Tailscale |
| Pick the right range | **red** — offers `100.97.246.31/32`, silently useless | **green** — offers `100.64.0.0/10`, marked wide with its risk copy |
| Understand what was granted | **red** — no risk signal at all | **green** — amber wide chip + explanatory copy |
| Make it reachable | **red** — loopback bind, nothing said | **green** — advisory, or none if already bound to the tailnet NIC |

Task colour: **red → green.**

Note the two features interlock: binding to the Tailscale NIC (`100.97.246.31`) is *inside* `100.64.0.0/10`, so the reachability predicate scores it reachable and stays silent — and that configuration also bounds source-IP spoofing to packets actually arriving on the tailnet interface. The safest real setup is the one the UI now leads to.

## Step 4 — Findings by severity

| # | Finding | Sev | Status |
|---|---|---|---|
| 1 | **Block-event banner body text is 1.37:1 in light theme.** `bg-[var(--amber-soft,#3a2e10)]` — the token is undefined, so light mode paints a dark-brown fill under `--text-secondary: #444444`. | **4** | Pre-existing. Fixed for the new surface by the token ramp; retro-fit is a one-line follow-up. |
| 2 | **Exposure warning ≈1.9:1 in light theme.** `text-yellow-500` on `bg-yellow-500/10` over white. Light-mode contrast overrides exist only for `[data-testid="state-pill"]`. | **3** | Pre-existing. |
| 3 | **Banner action buttons ≈20 px tall** (`py-0.5 text-[11px]`) — below WCAG 2.2 SC 2.5.8's 24 px. | **3** | Pre-existing. |
| 4 | **`--amber` has two different fallbacks in the same codebase** — `#e2b24a` in `SettingsPanel.tsx`, `#d29922` in `Gateway*.tsx`. Same token name, different colour (H4 Consistency). | **2** | Pre-existing. |
| 5 | **Both mutually-exclusive banners rendered simultaneously.** A class-level `display:flex` beat the UA `[hidden]` rule. | **4** | Found in score pass 1, **fixed** (`[hidden]{display:none!important}`). Directly relevant to the shipped implementation. |
| 6 | Manual-entry field truncated its own format hint at 375 px. | **2** | Found in score pass 1, **fixed** (single-column tools at mobile, per NN/g web-form-design). |
| 7 | The advisory appears **without a page change or Save**, so a screen-reader user gets no announcement unless it is a live region. | **3** | **Fixed** in mockup (`role="status"`). **Not yet in the spec** — see below. |
| 8 | **`+ Add Local Network` offers a `/32` for point-to-point interfaces.** Measured live: `utun4` (Tailscale) at `100.97.246.31/255.255.255.255` → offered `100.97.246.31/32`, a range matching one address — the host itself, already loopback-exempt. Clicking the UI's own suggestion trusts nobody. | **4** | **In scope** — state G. |
| 9 | **Contradictory advice between two paths (H4).** `suggestTrustEntries` knows `100.64.0.0/10` is the tailnet range; the dropdown, computing from netmask alone, does not. Same decision, two answers. | **3** | In scope — one shared suggestion engine. |
| 10 | **Duplicate offers.** `en0` and `en7` on one subnet both yield `192.168.10.0/24` — the same entry twice at a security decision point (H8). | **2** | In scope — dedupe by CIDR. |
| 11 | **Raw device names.** `utun4` does not tell the operator it is Tailscale (H2 match between system and real world). | **2** | In scope — `label` field. |

Findings 1–4 are pre-existing defects in shipped code, surfaced by GROUND. They are **not** introduced by this change and are **not** in its scope — but the change would have inherited 1, 3 and 4 by copying the idiom, which is why the token ramp exists.

## Step 5 — Prioritized fix list

**In this change:**
1. Define `--warn-bg` / `--warn-border` / `--warn-fg` / `--warn-body` in the theme layer with light values. Dark values equal today's hardcoded fallbacks, so dark mode is pixel-identical.
2. Advisory is `role="status"` — **add as a spec scenario** (gap found by this review).
3. Action controls ≥24 px desktop / ≥44 px mobile.
4. Guard the mutual exclusivity of the two banners with a test — finding 5 shows how easily it regresses.
5. One suggestion engine for both the dropdown and the block-event banner; never offer a `/32` self-range; dedupe by CIDR; label interfaces meaningfully; show an underivable `/32` as unofferable **with an explanation** rather than dropping it silently (findings 8–11).

**Follow-up change (not this one):**
5. Retro-fit `BlockEventTrustBanner` and the exposure warning onto the warn ramp — closes findings 1, 2 and 3.
6. Reconcile the two `--amber` fallbacks and define the token — closes finding 4.

## Rubric (tool format)

| Line | Verdict |
|---|---|
| Contrast (WCAG AA) light AND dark | **PASS** — all pairs ≥4.5:1, computed |
| Responsive, no clipping, ≥44 px mobile targets | **PASS** — 375/768/1440 clean after pass-1 fixes |
| Hierarchy — one focal point | **PASS** — filled primary; link subordinate; meta de-emphasized |
| Spacing rhythm from a scale | **PASS** — 5/6/9/10/18 px, consistent with panel density |
| Token fidelity | **PASS** — no raw hex in the advisory; all four warn values are tokens |
| Anti-slop | **PASS** — system UI stack, no purple gradient, no centred hero; IPs/CIDRs are the machine's real measured values, not `Acme`/`Jane Doe` |
| Console | **PASS** — no errors or warnings |
