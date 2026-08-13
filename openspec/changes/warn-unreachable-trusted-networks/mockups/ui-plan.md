# UI Plan — bind reachability advisory

Surface → tokens → states for `warn-unreachable-trusted-networks`.
Token authority: the `theme-system` skill + `packages/client/src/index.css`.

## Surface

One advisory banner inside `TrustedNetworksSection` (Settings → Security), rendered
between the section description and the trusted-entry list — the same slot as
`BlockEventTrustBanner` (`SettingsPanel.tsx:2130`).

## GROUND findings (shipped code, measured)

Two banner idioms already exist for the same semantic (amber advisory), and they disagree:

| Surface | Classes | Token status |
|---|---|---|
| `BlockEventTrustBanner` (`:2027`) | `border-[#4a3c14] bg-[var(--amber-soft,#3a2e10)]`, text `var(--amber,#e2b24a)` | `--amber` / `--amber-soft` are **undefined** — always the hex fallback |
| `ListenInterfaceField` exposure warning (`:2334`) | `text-yellow-500 bg-yellow-500/10` | raw Tailwind, no token |
| `GatewayEndpoints` / `GatewayPairQR` | `var(--amber,#d29922)` | same undefined token, **different fallback hex** |

`rg` over `packages/client/src/index.css` finds no `--amber`, `--amber-soft`, or
`--green-soft` definition. Light-mode contrast overrides exist **only** for
`[data-testid="state-pill"]` (`index.css:525-543`).

**Measured consequences in light theme** (`--text-secondary: #444444`, page `#ffffff`):

| Defect | Computed contrast | WCAG 1.4.3 AA (4.5:1) |
|---|---|---|
| Block-event banner body text `#444444` on `#3a2e10` | **1.37:1** | ✗ catastrophic |
| Exposure warning `#eab308` on `yellow-500/10` over white | **≈1.9:1** | ✗ fail |
| Banner action buttons `py-0.5 text-[11px]` ≈ 20px tall | — | ✗ WCAG 2.2 SC 2.5.8 (24×24 min) |

These are **pre-existing**, not introduced here. But the advisory was specified to
reuse this idiom, so copying it would inherit all three. Per the loop's contract
rule — *a surface needing a token that doesn't exist gets it added to the theme
layer first* — this change defines real warn tokens with light-mode values.

## Tokens (add to the theme layer, then reference)

| Token | Dark | Light | Role |
|---|---|---|---|
| `--warn-bg` | `#3a2e10` | `#fdf3e3` | banner fill (common region) |
| `--warn-border` | `#4a3c14` | `#a9741f` | banner edge |
| `--warn-fg` | `#e2b24a` | `#92400e` | emphasis: host / entry, mono |
| `--warn-body` | `#ddd0ae` | `#5c3a0a` | sentence text |

Verified ratios (sRGB relative luminance, WCAG 2.x formula):

| Pair | Dark | Light |
|---|---|---|
| `--warn-body` on `--warn-bg` | 8.74:1 ✓ | 9.20:1 ✓ |
| `--warn-fg` on `--warn-bg` | 6.78:1 ✓ | 6.45:1 ✓ |
| `--warn-border` on `--warn-bg` | 1.9:1 (decorative) | 3.70:1 ✓ (1.4.11) |

Dark values are exactly the current hex fallbacks, so **dark theme is pixel-identical
to what ships today** — this is purely additive, and retro-fitting the existing two
banners onto the same tokens becomes a one-line follow-up.

Reused existing tokens: `--bg-secondary`, `--bg-tertiary`, `--text-primary`,
`--text-secondary`, `--text-tertiary`, `--border-secondary`, `--focus-ring`, `--link`.

## States

| # | Condition | Renders |
|---|---|---|
| A | bind `0.0.0.0`, trusted `192.168.1.0/24` | no advisory (baseline) |
| B | bind `127.0.0.1`, trusted `192.168.1.0/24` | advisory — the reported case |
| C | bind `10.0.0.5`, trusted `192.168.1.0/24` | advisory — specific-NIC case |
| D | bind `127.0.0.1`, trusted `127.0.0.1` only | no advisory (must not warn) |
| E | after inline remediation | advisory gone, **Server** dirty chip lit |
| F | non-loopback bind + a real denial | block-event banner, advisory absent |

B and F are mutually exclusive by construction — a block event can only be recorded
for a connection the bind host accepted.

## Cited UX rules governing this surface

| Decision | Rule | Source |
|---|---|---|
| Surface the inert config at all | H1 Visibility of system status | nngroup.com/articles/ten-usability-heuristics/ |
| State cause **and** fix, no codes | NN/g error-message guidelines; H9 | nngroup.com/articles/error-message-guidelines/ |
| Inline banner, not a modal | Modal only when the user must decide before continuing | nngroup.com/articles/modal-nonmodal-dialog/ |
| Enclosed banner adjacent to its list | Gestalt common region + proximity | ux-best-practices §2c |
| One dominant action + subordinate link | Von Restorff; H8; Hick's Law | lawsofux.com/von-restorff-effect/ · /hicks-law/ |
| Button label `Listen on all interfaces` | CTA = outcome verb, never OK/Submit | nngroup.com/articles/ui-copy/ |
| Icon + text + border, not colour alone | WCAG 1.4.1 Use of Colour | w3.org/TR/WCAG22/ |
| Targets ≥ 24×24 px | WCAG 2.2 SC 2.5.8 Target Size (Minimum) | w3.org/TR/WCAG22/#target-size-minimum |
| Disclose the restart requirement up front | H5 error prevention; state requirements before the action | nngroup.com/articles/web-form-design/ |
| User never told to reconcile bind vs trust themselves | Tesler's Law — the system absorbs irreducible complexity | lawsofux.com/tesslers-law/ |
