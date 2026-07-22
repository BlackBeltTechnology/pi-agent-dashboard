# UX Review — Hermes Memory settings surface

Mockup: `hermes-settings.html` (served live; verified dark + light).
Reviewed against the frontend-mockup-loop 5-step protocol. Every finding cites a
public rule.

## 1. Accessibility floor (HARD GATE)

| Check | Result | Note / cited rule |
|---|---|---|
| Text contrast ≥ 4.5:1 (body) | PASS | `--text-primary` on `--bg-primary`: #e5e5e5/#0a0a0a (dark), #1a1a1a/#fff (light) — both > 12:1. WCAG 1.4.3. |
| Help text (11.5px) contrast | PASS (after fix) | Light `--text-tertiary` darkened #777→#6a6a6a to clear 4.5:1 on `--bg-secondary`. WCAG 1.4.3. |
| Focus visible | PASS (after fix) | Added global `:focus-visible` ring (`--accent-primary`, 2px, offset). WCAG 2.4.7. |
| Target size | PASS (after fix) | Toggle padded to ~44px hit area while keeping 34×19 visual. WCAG 2.5.8 (min 24px; we exceed). |
| Color not sole channel | PASS | Dirty state = blue dot **+** visible "Reset" **+** status text, never color alone. Default state = text "DEFAULT" badge. WCAG 1.4.1. |
| Reduced motion | ADVISORY | Only 0.15s transitions; add `prefers-reduced-motion` guard at promote. |

No open WCAG-AA or severity-4 defect → **gate passes**.

## 2. Heuristic rubric (Nielsen + Laws of UX)

| Heuristic | Result | Evidence |
|---|---|---|
| #1 Visibility of system status | PASS | Save bar shows "N fields changed · not yet saved"; Save disabled when clean. |
| #2 Match real world | PASS | Human label + monospace config key per field (recognition over recall — NN/g). |
| #3 User control / freedom | PASS | Per-field **Reset** + global **Revert**; no destructive default. |
| #4 Consistency & standards | PASS | Section-header, input, button, divider classes mirror `SettingsPanel`/`ToolsSection` tokens. |
| #5 Error prevention | ADVISORY | Number/regex fields need inline validation (see §5). GOV.UK error-summary pattern. |
| #6 Recognition not recall | PASS | **Unset fields display the resolved default value + "DEFAULT" badge** — the user's core requirement; removes recall of hermes defaults. |
| #7 Flexibility | PASS | Raw-JSON escape hatch for power users; form for everyone else. |
| #8 Aesthetic / minimalist | PASS | 9 groups collapsed by default, 2 open — progressive disclosure lowers Hick's-Law load. |
| #10 Help & docs | ADVISORY | Each field has help text; consider a "docs" link to the hermes README per group. |

## 3. PURE friction (worst step wins)

- Find a setting → **green** (grouped + labeled + collapsed).
- Understand current vs default → **green** (badge + inline value).
- Edit + save → **green** (sticky bar, clear affordance).
- Undo a mistake → **green** (Reset/Revert).
Overall: **green**.

## 4. Severity log (Nielsen 0–4)

| # | Sev | Finding | Disposition |
|---|---|---|---|
| 1 | 3 | Light code block used undefined `--bg-code` → dark-on-light | FIXED (added light token) |
| 2 | 2 | No visible keyboard focus ring | FIXED (`:focus-visible`) |
| 3 | 2 | Toggle < 24px tap target | FIXED (padded hit area) |
| 4 | 2 | Regex/number inputs accept invalid values silently | DEFER to build (inline validation + PUT-route schema reject) |
| 5 | 1 | "DEFAULT" badge repeats on every field (visual noise) | ACCEPT — required to satisfy show-default requirement; kept tertiary/subtle |
| 6 | 1 | `custom policy text` shown even when style ≠ custom | DEFER — conditionally reveal at build |

## 5. Prioritized fix list

Done in-loop (sev ≥ 2): #1 light `--bg-code`, #2 focus ring, #3 toggle target.
Carried into `design.md`/`tasks.md` (behavioral, not visual):
- **Inline validation** — numbers `min`/`integer`; regex compiled client-side with an error line; the **PUT route rejects** invalid config (security-hardening: never write unvalidated browser input).
- **Conditional fields** — reveal `memoryPolicyCustomText` only when `memoryPolicyStyle=custom`.
- **prefers-reduced-motion** guard on transitions.

## Anti-slop pass (advisory)

No AI-tells: no purple gradient, no Inter hero, no centered marketing hero, real
product data (`anthropic/claude-haiku-4-5`, real config keys), monospace keys.
PASS.

## Verdict

Accessibility gate **passes** in both themes; heuristic rubric passes with 3
advisory items carried into the build. The show-current-else-default requirement
is realized via the effective-value + "DEFAULT" badge + per-field Reset pattern.
Ready to promote the direction into the React component during implementation.
