# pi-settings-ui: UI plan and scored rubric

## Surface
New settings rail item **pi → pi settings**. Replaces the "pi settings (global)" section on the Sessions page.
Keeps the existing Form/JSON mode switch, conflict/parse/drift banners and the unified save.

## Decisions (each cites a public rule)
| Decision | Rule |
|---|---|
| Own page instead of the Sessions section (about 70 fields) | Hick's Law: group choices (lawsofux.com/hicks-law); NN/g information scent |
| Categories follow pi's `docs/settings.md` headings | Jakob's Law: match the source docs users already know |
| Filter box + jump chips + "Changed from default only" | Nielsen #7 flexibility/efficiency; Nielsen #6 recognition over recall |
| Tri-state seg `Default (x) · On · Off`, and seg for ≤3 options, select for more | NN/g radio vs dropdown; match the control to the data (≤3 options → visible choices) |
| Default value shown in the control (`Default: 16,384`) | Nielsen #6 recognition over recall |
| Key chip (`terminal.images`) on every row | Nielsen #2 match between system and real world (users copy keys from docs) |
| `Changed` pill (dot + word) + reset button | WCAG 1.4.1: never colour alone; Nielsen #3 user control (undo) |
| Inline range error, `role=alert`, Save disabled while errors remain | GOV.UK error message pattern; Nielsen #5 error prevention |
| Retry, default model, packages and skills get link rows, not duplicate editors | Single source of truth; Nielsen #4 consistency |
| Object-valued keys get "Edit in JSON" | Tesler's Law: complexity stays where it's irreducible |
| API keys: per-key action, applied on Save, Undo available | Nielsen #3; prefer undo over confirm (NN/g) |
| `enabledModels` editor: provider `provider/*` toggle, per-model picks, patterns, count, JSON preview | Miller's Law: chunk by provider; Nielsen #1 visibility of system status |
| Scope hint states it does not restrict roles or subagents | Nielsen #2: honest system model |
| Dashboard-managed keys collapsed and read-only | Progressive disclosure (NN/g) |

## Tokens
Surfaces `--bg-primary/secondary/tertiary`, text `--text-primary/secondary/tertiary` (placeholder only), borders `--border-*`,
`--tint-blue-*` (pressed seg, Changed pill), `--tint-green-*` (glob pill, "new" badge), `--severity-warning-*` (API-key callout),
`--severity-error-*` (field error), `--accent-solid` (Save), card root + raised elevation recipe.

## Rubric (scored 2026-10-17; Playwright chromium missing, so contrast computed in code and breakpoints checked with agent-browser)
| Check | Result |
|---|---|
| Contrast AA, dark | PASS: min 5.17 (white/accent-solid), placeholder 5.29 |
| Contrast AA, light | PASS: min 5.17, placeholder 5.27, green pill 5.47 |
| No horizontal overflow at 375 / 768 / 1440 | PASS (after fixes) |
| Targets ≥24px desktop, ≥44px mobile for buttons | PASS (checkbox targets come from 28–32px labels) |
| One focal action (Save) | PASS |
| Colour never the only signal | PASS: Changed = dot + word, error = text, jump-chip dot has sr-only text |
| Token fidelity (no raw colours outside the token block) | PASS (`#fff` on `--accent-solid` per contract) |
| Score | 7/7 |

## Defects found and fixed
1. 375/768 overflow: grid child `main` lacked `min-width:0`; mobile segs now flex-fill.
2. 375 overflow from absolute `sr-only` inside the jump chips: chips got `position:relative`.
3. Number inputs misaligned when a unit was missing: unit slot is now reserved (44px).
4. Scope editor didn't span the row: `#scopebox` now spans the full grid row.
5. API-key callout cramped on mobile: rows stack.

## Open questions for the proposal
- Custom pi theme names: free text, or scan the `themes` paths?
- Model list: full catalogue per provider, with virtualisation if needed.
- API-key "Move to Providers": write to `auth.json` via the existing provider-auth server path.
