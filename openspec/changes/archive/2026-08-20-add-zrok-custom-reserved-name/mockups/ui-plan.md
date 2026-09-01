# UI plan — zrok custom reserved name

Surfaces → tokens → states. Every value references a `packages/client/src/index.css`
token; no raw hex or px literal. Grounded in the shipped `GatewaySetupGuide.tsx`
numbered-step pattern, not an invented one.

## Ground (what ships today)

Captured live from `http://localhost:8000` → Gateway dialog, and from source.

| Element | Shipped classes / tokens |
|---|---|
| Section label | `text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]` |
| Step row | `flex gap-2.5 border-b border-[var(--border)] py-2.5 last:border-none` |
| Step number badge | `h-5 w-5 rounded-full border border-[var(--border)] bg-[var(--bg-secondary)] text-[10.5px] font-bold text-[var(--text-muted)]` |
| Step title | `text-[12.5px] text-[var(--text-primary)]` |
| Inline chip | `rounded border border-[var(--border)] px-1.5 py-px text-[9.5px] text-[var(--text-muted)]` |
| Step input | `flex-1 rounded border border-[var(--border)] bg-[var(--bg-secondary)] px-2 py-1 font-mono text-[11.5px] text-[var(--text-primary)]` |
| Step action button | `rounded border border-[var(--accent)] bg-[var(--accent-soft)] px-3 py-1 text-[11.5px] font-semibold text-[var(--text-primary)] disabled:opacity-50` |
| Step error | `mt-1 text-[11px] text-[var(--danger)]` |
| Footer button | `rounded border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--text-muted)] hover:text-[var(--danger)]` |
| Primary footer button | `rounded bg-[var(--accent)] px-4 py-1.5 text-sm font-semibold text-white` |

The zrok Setup tab already renders `1 Install the zrok client` and
`2 Enable this environment` (input + `Authenticate`). **A reserved name is
step 3 in that same pattern** — adapting shipped design, not adding a parallel one.

## Tokens used

Existing only. No new token is introduced.

| Role | Token |
|---|---|
| Step surface / input fill | `--bg-secondary`, `--bg-tertiary` |
| Body / label / hint text | `--text-primary`, `--text-secondary`, `--text-muted` |
| Dividers, input border | `--border-primary` |
| Primary action | `--accent-primary`, `--accent-soft` |
| Reserved OK | `--severity-success-{bg,fg,border}` |
| Name taken / invalid / write-failed | `--severity-error-{bg,fg,border}` |
| Degraded persistence banner | `--severity-warning-{bg,fg,border}` |
| Neutral/ephemeral-by-choice | `--severity-neutral-{bg,fg,border}` |

The `--severity-*` ramp is `color-mix()`-derived against each theme's own
`--text-primary` / `--bg-tertiary`, so it holds contrast in both modes. Using it
(instead of `text-red-400`-style literals) is what
`unify-message-severity-colors` established.

## Defects in the current surface

Each cites the rubric line from `references/ux-best-practices.md`.

| # | Defect | Rule | Sev |
|---|---|---|---|
| D1 | `Forget reserved URL` is irreversible, one click, no confirm | #8 destructive must be confirm-gated or undoable (H3/H5) | 4 |
| D2 | Persistence can fail and silently serve an ephemeral URL; only a `console.warn` records it | #7 / H1 visibility of system status | 4 |
| D3 | No way to see or set the reserved name — the capability is invisible in the UI | H6 recognition rather than recall | 3 |
| D4 | `Forget reserved URL` renders for ngrok / tailscale / zerotier, where no zrok name exists | #11 nothing on screen may fail to serve the current goal (H8) | 3 |
| D5 | `Disconnect` and `Forget reserved URL` are styled identically though one is far more destructive | #6 one dominant action; Von Restorff | 3 |
| D6 | Step inputs are placeholder-only (`zrok enable token`), no persistent label | #13 every input has a persistent label | 2 |
| D7 | Footer actions are `py-1.5` ≈ 30px tall — under the 44px primary-action target | #2 targets ≥24px AA, primary ≥44px | 2 |
| D8 | `--text-muted` fails WCAG AA in BOTH themes, and carries hints, step numbers, chips, tab labels and section labels across the Gateway surface | #1 text contrast ≥4.5:1 | 3 |

### D8 — measured, not eyeballed

Computed with WCAG 2.x relative luminance over the shipped token values:

| Pair | dark | light |
|---|---|---|
| `--text-muted` on `--bg-primary` | **2.78:1** | **2.32:1** |
| `--text-muted` on `--bg-secondary` | **2.59:1** | **2.23:1** |
| `--text-muted` on `--bg-tertiary` | **2.34:1** | **2.04:1** |
| `--text-tertiary` on `--bg-primary` | 5.01:1 | **4.48:1** |
| `--text-tertiary` on `--bg-secondary` | 4.66:1 | **4.29:1** |
| `--text-secondary` on `--bg-tertiary` | 7.69:1 | 8.55:1 |

**6 of 6 `--text-muted` pairs fail.** `--text-tertiary` also misses 4.5:1 in light
mode. Only `--text-secondary` and above clear AA on every surface.

The mockup therefore uses `--text-secondary` as the floor for all body, hint,
label and citation text. This deliberately **diverges from the shipped classes**
captured in Ground: the accessibility floor is a hard gate and outranks
token-matching when the two conflict.

D8 is pre-existing and repo-wide. The **Gateway surface** is repaired by this
change (it is the surface step 3 ships into); the repo-wide `--text-muted` audit
stays out of scope and is guarded instead by the no-fallback-literal check.

### D9 — `--accent` and `--accent-soft` are never defined (Setup tab)

Found by probing computed styles in the live dialog, not by reading source.
Mockup: [`setup-tab-colors.html`](setup-tab-colors.html).

`rg -- "--accent-soft\s*:" packages/` returns **nothing**. Neither
`--accent` nor `--accent-soft` is defined in `:root` or `[data-theme="light"]`.
All **14** call sites therefore fall back to the literal baked into the class
string — `bg-[var(--accent-soft,#1d3a63)]` — painting a dark-navy fill in BOTH
themes while the text on top stays theme-aware. **9 of the 14 are in `Gateway/`.**

Measured on the running dialog in light mode — **13 of 15 controls fail**:

| Control | fg on bg | ratio |
|---|---|---|
| selected provider chip `zerotier` | `#1a1a1a` on `#1d3a63` | **1.52:1** |
| selected mode chip `Private` | `#1a1a1a` on `#1d3a63` | **1.52:1** |
| step action `Connect` / `Authenticate` | `#1a1a1a` on `#1d3a63` | **1.52:1** |
| unselected chips, inactive tabs, footer | `#aaaaaa` on `#fafafa` | **2.23:1** |
| `Open admin console` link | `#3b82f6` on `#ffffff` | **3.68:1** |
| primary `Done` (**both** themes) | `#ffffff` on `#3b82f6` | **3.68:1** |

The selected item is the *least* readable element on the tab — an inverted
affordance. `disabled:opacity-50` masks it until the button becomes enabled.

Proposed: define four tokens once per theme. Causes A and C need **no component
change** — the existing `var(--accent-soft, …)` call sites simply stop hitting
their fallback.

| Token | Dark | Light | Used for | Floor |
|---|---|---|---|---|
| `--accent` | `#3b82f6` | `#2563eb` | border, ring, focus | 3:1 non-text ✓ |
| `--accent-soft` | `#1d3a63` | `#dbeafe` | soft fill behind `--text-primary` | 9.07 / 14.27 ✓ |
| `--accent-solid` | `#2563eb` | `#2563eb` | solid fill behind white | 5.17 ✓ |
| `--accent-text` | `#60a5fa` | `#1d4ed8` | link text on page bg | 7.79 / 6.70 ✓ |

Dark mode is not exempt: white on `--accent-primary #3b82f6` is 3.68:1 in both
themes, which is why `--accent-solid` is `#2563eb` in dark too.

**Folded into this change.** Deferring it would mean shipping step 3 into a tab
whose selected state measures 1.52:1 — building the fix and the defect in the
same place, in the same week. Spec delta: `theme-system` (accent ramp declared
per theme + no-fallback-literal rule).

The precedent worth knowing: `shutdown-session-recovery` already bans `--accent`
in one component, reasoning that an undeclared property "resolves to the empty
string and yields an unset background". That reasoning does **not** cover the
fallback form used here — `var(--accent-soft,#1d3a63)` resolves to a very visible
dark navy. Banning one token in one component cannot address the class;
declaring the tokens plus guarding the fallback form does.

D2 is the defect the change exists to remove; the live dashboard is serving
`nsdfook2l23d.shares.zrok.io` — a random ephemeral token, not a `pi-dash-<hex>`
reserved name — which is exactly the silent-fallback outcome.

## States to render

Step 3 `Choose your public URL`:

| State | Token set | Notes |
|---|---|---|
| `idle` (no name) | neutral | Shows generated-name fallback explicitly, so ephemeral is a visible choice not an accident |
| `typing-valid` | neutral + enabled `Reserve` | Live URL preview `https://<name>.shares.zrok.io` |
| `invalid` | error | Fires on **blur**, not per keystroke (#16). States the fix (#18) |
| `taken` | error | Preserves the typed input (#4). Names the cause |
| `write-failed` | error | Distinct from taken; different fix |
| `reserved` | success | Shows live URL + `Replace` / `Release` |
| `replace-confirm` | warning | Names the exact URL about to be destroyed (#8) |
| `degraded` | warning | Access tab banner: configured name vs effective URL (D2) |

## Decisions, each cited

- **Reserved name lives in Setup step 3, not the footer.** Progressive
  disclosure (NN/g) + consistency with the existing numbered steps (H4, Jakob's Law).
- **Persistent label above the input**, format stated up front — "lowercase
  letters, numbers and hyphens" (#13, NN/g web-form-design: state requirements up front).
- **Validate on blur, not per keystroke** (#16, Baymard inline validation).
- **Errors carry icon + text + outline**, never color alone (#4), and state a
  fix rather than "invalid" (#18).
- **`Reserve` / `Replace` / `Release` are action verbs**, not `Submit`/`OK` (#15).
- **Replace and Release are confirm-gated and name the URL being destroyed** (#8).
  Release is the renamed `Forget reserved URL` — same operation, honest label,
  scoped to zrok only (D4).
- **Degraded banner is warning, not error** — the tunnel works, it is just not
  the URL you asked for. Severity must match reality (H9 plain-language, cause + fix).
- **Primary actions ≥44px**; footer actions raised off `py-1.5` (#2).

---

## Readiness & concurrency (Gaps 4–5) — `provider-status.html`

Five sections: the readiness board, state-driven steps, primary selection, the
edge cases, and the state→predicate mapping.

### State → severity mapping

| State | Decided by | Severity token | Glyph |
|---|---|---|---|
| Not installed | `detectBinary()` false | `neutral` | ○ |
| Not set up | `isEnrolled()` false | `info` | ! |
| Disconnected | `status().active` false | `warning` | ◍ |
| Connected | `status().active` true | `success` | ✓ |

`disconnected` is **warning, not error** — enrolled and ready, simply not
serving. It is an actionable state, not a fault. `not-installed` is `neutral`
rather than `error` for the same reason: never having installed a provider is
not a failure.

Every badge pairs a glyph **and** a text label with its colour (WCAG 1.4.1) —
colour is never the sole carrier of state.

### Decisions

- **The board lists every provider, not just the configured one.** Otherwise
  "is zrok even installed?" stays unanswerable until you select zrok.
- **Steps collapse as they are satisfied.** A fixed step wall cannot tell you
  where you are; a satisfied step renders as `✓` and the outstanding one carries
  the accent ring.
- **Primary is a radio among connected providers**, not a separate dropdown, so
  the mutually-exclusive nature is visible in the control shape.
- **The primary's consequence is stated inline** — "OAuth redirect URIs and the
  session cookie derive from this URL" — because the cost of changing it is
  invisible otherwise.
- **Refresh is a button next to a "checked Ns ago" stamp.** A live poll with no
  visible recency stamp reads as a frozen UI when nothing changes.
- **`cloudflared` appears only to exercise the not-installed row.** It is not a
  shipped provider; noted in-page so it is not mistaken for scope.

### Verified

- Contrast probe over **157 text elements**, both themes: all pass AA. The probe
  handles `color(srgb …)` output from `color-mix` — a naive `rgb()`-only parser
  divides those 0–1 floats by 255 and reports a false 1.00:1 for every severity
  surface.
- 375 / 768 / 1440: no overflow; `.row`/`.pact` stack and buttons go full-width
  below 520px. Interactive targets ≥44px.
- Console clean.
- `.note>div>b:first-child` scoping — an unscoped `.note b {display:block}`
  fragments an inline `<b>` mid-sentence (same defect fixed in
  `setup-tab-colors.html`).

### Revision — primary as a button; registering the live URL

**Make primary is a button, not a radio.** Placed first in the action group, ahead of
connect/disconnect. Shown only on a `connected`, non-primary provider; the current
primary shows the `Primary` tag and a disabled control. A radio implied a cheap,
instant pick — but switching primary re-mints the OAuth redirect URI, so it is
confirm-gated and names the sign-in-breakage risk.

**A gateway URL is not a tunnel.** A tunnel is a live process; a gateway record is a
persisted address carrying `authModes`. `gateway-action.ts` rejects a record with no
auth mode, so a live URL cannot be registered automatically on connect:

| URL scheme | trusted-network | pairing | oauth |
|---|---|---|---|
| `https:` publicly-trusted | ✓ | ✓ | ✓ |
| `http:` mesh IP | required + CIDR | ✗ needs TLS | ✗ providers refuse non-TLS |

Decisions:

- **The offer is automatic, the decision is not.** `Add gateway URL…` appears the moment a
  connected provider's URL is unregistered; once registered the row shows
  `✓ in gateway URLs` instead.
- **Unavailable modes are shown disabled with their reason, never hidden** — hiding leaves
  the operator unable to distinguish "not allowed" from "forgot to tick".
- **The caution names the real effect**: the dashboard answers on that address and it becomes
  a CORS-allowed origin. It also states what does *not* change — registering never moves the
  sign-in origin, because `publicBaseUrls` is never an OAuth redirect source.
- **Warning severity, not error.** Registering is a legitimate operation with a consequence,
  not a mistake.

Spec deltas added for both: `tunnel-provider` (Make primary is explicit + confirmed) and
`shared-config` (offer-not-auto registration, scheme-gated auth modes).

Re-verified: 200 text elements pass AA in both themes; `label.mode` hit areas ≥44px (the
16px checkboxes sit inside them); console clean; 375/1440 no overflow.

### Revision — mobile layout (≤560px)

The 375px render had four concrete defects, all found by cropping and enlarging the
full-page capture rather than eyeballing the thumbnail:

| Defect | Symptom | Fix |
|---|---|---|
| URL truncated | `robson-home-mac.shares.zrok.io …` — the identifying value was the part clipped | `.endp` wraps: `white-space:normal; overflow-wrap:anywhere` |
| Orphaned status dot | `space-between` spread the dot, the freshness text and Refresh across the row; Refresh then wrapped alone | dot + text left-aligned together, Refresh full-width on its own line |
| No provider grouping | hairline separators only — the rows read as one undifferentiated stream | each `.prow` becomes a card: `--bg-tertiary`, border, radius, padding |
| One button per line | a 3-action provider was 3 stacked full-width buttons | `flex:1 1 calc(50% - 3px)` → 2-up; 12px/8px keeps the longest label on one line |

Reflow order per card — **one concern per line**: name → state chips → URL → actions.
Achieved with flex ordering (`.pname{flex:1 1 100%}`) rather than a grid with named
areas, so rows carrying an extra `Primary` tag need no separate markup.

`.modes` goes full-width column so a disabled mode keeps its reason (`needs TLS`,
`providers refuse non-TLS`) on the same line as its label. The mapping table gets a
horizontal-scroll wrapper (`.tbl`) rather than being allowed to squeeze its `code` cells.

**Contrast re-verified for the mobile paints specifically.** The breakpoint changes a real
colour — cards move from `--bg-secondary` to `--bg-tertiary` — so the check cannot be
inherited from the desktop pass. Verified by injecting the mobile paint rules
unconditionally and re-probing: 200/200 pass in both themes.

### Revision — the board is in a dialog, so height is the budget

First mobile pass optimised for clarity and got the ordering right, but each provider
became a 4-line card. That is wrong for this surface: the board renders **inside the
Gateway dialog**, which already spends ~200px on title, tab strip and footer. Five
providers at ~186px each pushed the list to ~930px — the dialog either outgrew the
viewport or the rows scrolled with the whole page behind them.

Two changes, both aimed at height rather than at layout:

**1. Name and state chips share line 1.** `.pname{flex:0 1 auto}` + `.badge{margin-left:auto}`
puts `● zrok` left and `✓ Connected` `Primary` right on the same line, instead of the chips
taking a line of their own. The provider names are short enough (`tailscale` is the longest)
that the pair never collides at 375px. Padding 12→10, gaps 9→6, name 14→13.5px, url 12.5→12px.

| Row | Before | After |
|---|---|---|
| zrok (1 action) | ~186px | **122px** |
| tailscale (3 actions, 2 button lines) | ~230px | **172px** |
| zerotier / ngrok / cloudflared | ~186px | **122px** |
| whole page at 375 | 7439px | **6731px** |

**2. The list is capped, not the dialog.** `.board .pad{max-height:56vh;overflow-y:auto}` —
the provider list scrolls inside itself at 737px of content, so the dialog's own header,
tab strip and footer stay on screen no matter how many providers exist. This matters
beyond cosmetics: a provider list is unbounded, and a dialog whose primary action leaves
the viewport when the list grows is a defect that only shows up on the machine that has
the most providers installed.

**Button height was deliberately not cut.** 44px is the largest single contributor to row
height and shrinking it would have saved ~90px more, but touch targets are the one
dimension that must not pay for the space. The saving comes from lines removed, not from
targets shrunk.

Re-verified after the change: 200/200 text elements pass in both themes, console clean.

### Revision — the board becomes a navigation list on mobile

Trimming padding was the wrong lever; it bought ~35% and the board was still too tall
for a dialog. The real question was not "how tight can a card be" but **what a row needs
to be** on a 375×667 screen.

**A row is one line: state in, detail out.** `● zrok  ✓ Connected  Primary  ›` at 52px.
The URL and the action buttons are not deleted — they live in that provider's Setup
panel, which the row opens. Section 2 of this mockup already renders exactly that panel,
with `Connect`, `Disconnect` and the URL in it, so nothing is lost; it simply stops being
duplicated into the one surface that has no vertical room for it.

| Board at 375×667 | Height |
|---|---|
| 4-line cards (first pass) | 930px — dialog outgrows the viewport |
| 3-line compact cards | 737px — still scrolling |
| **1-line rows** | **288px list / 383px with header** — all five providers visible at once |

The `max-height:56vh` cap stays as a guard for an unbounded provider list, but at five
providers it no longer engages. The freshness stamp drops its ` · re-checking every 5s`
suffix below 560px so `Refresh now` shares its line instead of claiming a full-width row.

**Touch targets were never reduced** — 52px rows and 44px buttons throughout. Every pixel
saved came from removing lines, not from shrinking targets.

### Defect D10 — horizontal overflow from a grid track floor

Measuring at a true 375 viewport (`agent-browser set viewport 375 667`) rather than
trusting the full-page capture exposed `document.scrollWidth = 440` — the page was
**65px wider than the screen** and scrolled sideways.

Cause: `.cols.two{grid-template-columns:repeat(auto-fit,minmax(420px,1fr))}`. `auto-fit`
collapses the track *count*, never the track *floor*, so a 420px minimum stays 420px at
any viewport and pushes the page out.

Fix: `minmax(min(420px,100%),1fr)` — the floor yields to the container. Verified
`scrollWidth` back to 375 with zero leaking elements; the only elements still extending
past the fold are inside the deliberately scrollable `.tbl`.

**This is a live-code risk, not just a mockup one.** Any `minmax(<fixed>,1fr)` in the
client with a floor above ~360px has the same defect. Worth grepping during implementation.
