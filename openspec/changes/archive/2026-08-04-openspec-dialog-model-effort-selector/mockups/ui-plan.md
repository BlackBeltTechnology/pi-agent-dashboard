# ui-plan — openspec-dialog-model-effort-selector

Surfaces -> tokens -> states. Every value references a theme-system CSS var. No raw hex outside the token block copied verbatim from `packages/client/src/index.css`.

## Surfaces

| Surface | Component | Change |
|---|---|---|
| Explore dialog | `openspec/ExploreDialog.tsx` | footer gains run-config row |
| Propose dialog | `openspec/ProposeDialog.tsx` | footer gains run-config row |
| New Change dialog | `openspec/NewChangeDialog.tsx` | footer gains run-config row |

Out of scope: folder-level "New Spec" (`spawn_session`, no session to mutate).

## Tokens used

| Purpose | Token |
|---|---|
| dialog bg | `--bg-primary` |
| control bg | `--bg-tertiary` |
| popover / elevated | `--bg-surface` |
| label text | `--text-tertiary` |
| control text | `--text-secondary` |
| emphasis text | `--text-primary` |
| control border | `--border-primary` |
| divider | `--border-secondary` |
| primary action / pending | `--accent-primary` |
| focus ring | `--focus-ring` |
| dirty marker bg/fg | `--severity-info-bg` / `--severity-info-fg` |
| warn (models unavailable) | `--severity-warning-bg` / `--severity-warning-fg` |

No new tokens required.

## States

| # | State | Visual |
|---|---|---|
| S1 | default (inherits session) | model + effort chips show session values, muted, label "Runs with" |
| S2 | dirty (user changed) | changed chip gets `--severity-info-*` tint + "will change session" hint line |
| S3 | pending confirmation | Send disabled + spinner, chips locked, aria-live status |
| S4 | models unavailable | model chip disabled, shows current value + "loading models…" |
| S5 | popover open | grouped list, current row marked, keyboard navigable |

## Cited rules

- **Nielsen H1 visibility of system status** -> S3 spinner + `aria-live` status line; S2 explicit "will change this session" hint.
- **Nielsen H4 consistency & standards** -> reuse `ModelSelector` / `ThinkingLevelSelector` verbatim, same trigger shape as the composer toolbar.
- **Nielsen H5 error prevention** -> sticky side-effect is disclosed BEFORE Send, not after.
- **Hick's Law (lawsofux.com/hicks-law)** -> footer shows 2 collapsed triggers, not an expanded model list.
- **Jakob's Law** -> control placement mirrors the composer toolbar the user already knows.
- **WCAG 2.2 AA 2.5.8 target size (min)** -> triggers >= 24x24 CSS px.
- **WCAG 2.2 AA 1.4.3 contrast** -> all text pairs >= 4.5:1 in both themes.
- **WCAG 2.2 AA 2.4.7 focus visible** -> 2px `--focus-ring` outline on every trigger.
- **WCAG 1.4.1 use of color** -> dirty state carries a text hint, not tint alone.
