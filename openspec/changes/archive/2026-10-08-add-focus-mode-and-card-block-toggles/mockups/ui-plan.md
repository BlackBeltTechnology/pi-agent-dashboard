# UI plan — add-focus-mode-and-card-block-toggles

Contract: root `ui-contract.md` (tokens, component invariants, a11y floor, terminology). Mockup: `focus-and-blocks.html` (this dir). Older accordion-only sketch: `accordion-setting.html`.

## Surfaces → tokens → states

| Surface | Where | Tokens | States |
|---|---|---|---|
| Focus toggle | sidebar app bar, right cluster, left of Settings gear (`header-app-bar`) | off: icon button `--text-tertiary`→hover `--text-secondary`; on: pill `--accent-soft` fill + `--accent` border + `--text-primary` label "Focus" | off · on · focus-visible (`--focus-ring`) · disabled (socket gap) |
| Directory card | `SessionList` folder group | card root recipe + `--rail-directory`; blocks gated per id | full · minimal (all `folder-*` off) · banner-chip (blocked + `folder-banner` off) · compact-empty / compact-attention (accordion) |
| Session card | `SessionCard` | card root recipe; subcard legend; status tint `--status-working` / `--status-unread` / `--status-needs-you` | full · minimal · effects on (animated stripes) · effects off (static tint) · selected glow on/off |
| Settings › Session card sections (global) | Settings → Sessions | section heading, switch rows, override-count chip, group headers | per-row on/off · override count · plugin rows only when claimed · Effects group |
| Directory settings › Session cards | `/folder/…/settings/cards` | tri-state segmented `Default (x)` / `Show` / `Hide`; override chip | inherit · override · inherited-from-parent label · Reset to global enabled/disabled |
| Focus settings | Settings → Sessions (Focus block) | switch + profile table (tri-state `Not set` / `Show` / `Hide`) + secondary buttons | built-in profile · custom profile · save current · reset |

## UX rules applied (cite `packages/mockup-loop/references/ux-best-practices.md`)

- **H1 Visibility of system status** — Focus on is always visible (pill in app bar, never only a hidden setting); hidden blocks never hide a blocked folder (banner chip) or a running background process (PROCESS chip).
- **H3 User control and freedom** — Focus is an overlay; off restores everything; one click both ways. Hide actions keep Undo toast (existing).
- **H4 Consistency / Jakob's Law** — Focus pill mirrors the existing YOLO pill (conditional pill in the same app-bar row); tri-state segmented control reused from the existing Session cards page.
- **Hick's Law + progressive disclosure** — settings grouped Session card / Directory card / Plugins / Effects; plugin rows only when the plugin contributes; Focus profile rows collapsed behind "Customize profile".
- **Tesler's Law** — built-in focus profile is the smart default; "Save current as my focus profile" captures instead of 30 manual clicks.
- **WCAG 1.4.1 (color not sole channel)** — static status tints keep the status icon/shape + text; Focus pill has a text label, not color only.
- **WCAG 2.3.3 / reduced motion** — effects switches are a user-level motion control in addition to `prefers-reduced-motion`.
- **Fitts's Law / WCAG 2.5.8** — switches and segmented buttons ≥ 24px tall; app-bar toggle ≥ 24×24.
- **Terminology** — user copy says "New session", "+ Session", never "spawn".
