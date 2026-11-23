# UI Contract — goal plugin mockups

Single source of truth for cross-screen visual consistency across `mockups/goal/index.html`
(Screen A create dialog · B board · C detail · D session chip). Every value here references a
design token (CSS custom property) — never a raw hex or pixel literal. If a screen needs a value
not listed, add the token to the theme layer first, then cite it here.

Tokens are owned by the dashboard theme layer (the real client's `:root` / `[data-theme]`); the
mockup mirrors them in its `<style>` `:root` block. This file references them by name; it does not
redefine them. Grounded against shipped `GoalForm.tsx` + `CreateAutomationDialog.tsx`.

## Tokens (authority)

| Role             | Token                | Notes                                         |
|------------------|----------------------|-----------------------------------------------|
| page background  | `--bg-primary`       | dialog card surface, page surface             |
| raised surface   | `--bg-secondary`     | input / field background                      |
| card surface     | `--bg-tertiary`      | board cards, control buttons, session rows    |
| inset surface    | `--bg-surface`       | progress-bar track                            |
| hover surface    | `--bg-hover`         | icon-button hover                             |
| primary text     | `--text-primary`     | titles, focal labels                          |
| body text        | `--text-secondary`   | input text, control labels                    |
| label text       | `--text-tertiary`    | uppercase field labels, meta                  |
| muted text       | `--text-muted`       | hints, legends, captions                      |
| hairline         | `--border-subtle`    | field / card / divider borders                |
| stronger border  | `--border-primary`   | dialog backdrop frame                         |
| timeline rail    | `--border-secondary` | verdict-timeline left rail                    |
| brand / primary  | `--indigo`           | primary action text, links                    |
| brand border     | `--indigo-strong`    | primary button + trigger-pill border          |
| brand fill       | `--indigo-bg`        | primary button + trigger-pill background      |

### State color tokens (lifecycle / status)

| Role               | Token      | Maps to                                              |
|--------------------|------------|------------------------------------------------------|
| pursuing / working | `--amber`  | `PURSUING` pill, working stripes, turns ring, verdict `continue` |
| judging            | `--blue`   | `JUDGING` pill, `set` timeline node                  |
| paused             | `--zinc`   | `PAUSED` pill, paused status dot                     |
| achieved / done    | `--green`  | `ACHIEVED` pill, done check, verdict `satisfied`     |
| spend gauge        | `--yellow` | spend progress fill                                  |
| danger             | `--red`    | delete / clear control, criterion remove hover       |

`--amber5` / `--green5` are the saturated-fill variants used for progress-bar fills and timeline dots.

## Spacing scale

Token scale only: 4 / 6 / 8 / 10 / 12 / 14 / 16 / 18 px rhythm. No arbitrary gaps.
Dialog card padding 16 (`p-4`). Field stack gap 12. Criteria row gap 8.

## Type scale

| Step          | Size | Weight | Use                                          |
|---------------|------|--------|----------------------------------------------|
| title         | 16   | 600    | `h2` dialog title (`text-base font-semibold`)|
| body          | 13   | 400    | input values                                 |
| control       | 11–12| 400    | buttons, criteria, pills                      |
| label         | 10   | 600    | uppercase field labels (`--text-tertiary`)    |
| micro / badge | 9–10 | 500    | judge badge, meta, hints                      |

Monospace (`ui-monospace`) only for verdicts, turn rings, session ids.

## Elevation

| Surface              | Tier                                                          |
|----------------------|---------------------------------------------------------------|
| dialog overlay       | `fixed inset-0 z-50 bg-black/40` dim over content             |
| dialog card          | `--bg-primary` on dim; radius 12; max-w-lg, max-h-[90vh] auto  |
| live (pursuing) card | neon conic glow (`.card-glow-fx` / `.card-ring-fx`) + stripes  |
| board / static cards | flat `--bg-tertiary`, `--border-subtle` hairline, no shadow    |

## Component invariants

One row per recurring surface. Token recipe only — every instance must match.

| Component       | Recipe (tokens only)                                                                 |
|-----------------|--------------------------------------------------------------------------------------|
| dialog overlay  | `fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4`; backdrop-click closes |
| dialog card     | bg `--bg-primary`, radius 12, `max-w-lg max-h-[90vh] overflow-auto`, padding 16        |
| dialog header   | bare title `New <noun> · <folder>` (`text-base font-semibold`) + ✕ `aria-label`; no breadcrumb (parity with `CreateAutomationDialog`) |
| field label     | `text-[10px] uppercase font-semibold` `--text-tertiary`                               |
| text input      | bg `--bg-secondary`, border `--border-subtle`, text `--text-secondary`, focus `indigo-400` |
| primary button  | text `--indigo`, border `--indigo-strong`, bg `--indigo-bg`; disabled `opacity-50`     |
| secondary button| text `--text-tertiary`, border `--border-subtle`; hover `--text-primary`               |
| icon button     | `--text-tertiary`; hover bg `--bg-hover`; icon-only → `aria-label` required            |
| state pill      | uppercase 9px, color-by-state token (see state table); mirrors `StatePill.tsx`         |
| cross-model badge | rounded-full 9px; cross-model → `--indigo` ramp, self-judge → `--amber` ramp          |
| progress bar    | track `--bg-surface`; turns fill `--amber5`; spend fill `--yellow`                      |

## Motion

| Motion              | Token / value                                            |
|---------------------|----------------------------------------------------------|
| neon glow rotation  | 13s conic blue→violet→pink→cyan on live card             |
| working stripes     | amber 45° barber-pole on pursuing card                   |
| status dot pulse    | `animate-pulse` on streaming/working; `motion-reduce:animate-none` |
| armed chip          | pulsing dot, suppressed under reduced-motion             |

All animation suppressed under `prefers-reduced-motion`.

## Anti-slop guardrails

- No default-average look (generic Inter + purple gradient + centered hero). Reuse the dashboard's
  OpenSpec-board / session-card grammar so goals read native, not bolt-on.
- Real hierarchy: one focal point per screen — the dialog card (A), the live pursuing card (B),
  the loop stepper (C).
- Intentional spacing: rhythm from the scale above, not eyeballed gaps.
- Verified contrast (WCAG AA) in BOTH light and dark themes.
- Icon-only controls always carry an `aria-label`.
- Teaching hints that exceed shipped behavior are marked mockup-only, not implied as shipped.
