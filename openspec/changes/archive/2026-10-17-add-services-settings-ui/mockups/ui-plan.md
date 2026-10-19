# UI plan — add-services-settings-ui

Live mockup: `mockups/services-settings/` — run `node mock-server.mjs` (port 4610), open `http://localhost:4610/`.
Canvas-safe: all URLs are relative (works under the dashboard's `/live/<id>/` proxy) and the server sends `Access-Control-Allow-Origin: *` + answers preflights (sandboxed iframe = `Origin: null`). Open on canvas with `canvas({target:{kind:"url",url:"http://127.0.0.1:4610/"}})`.
Mockup-only controls in the dashed top bar: theme (base dark / base light / nord dark), caller tier (operate / observe), ping counter.

## Files

| File | Purpose |
|---|---|
| `services-settings/index.html` | Settings shell (header, rail, content) hosting the Services pages. |
| `services-settings/app.js` | Vanilla renderer: list, detail, add, runtimes, dialogs; gating per design D9; refetch on `services_changed` (SSE in mock, WS in product). |
| `services-settings/app.css` | Token-only styles (ui-contract recipes). Only literal: `#fff` on `--accent-solid` (contract primary-button recipe). |
| `services-settings/tokens.css` | GENERATED copy of `packages/client/src/index.css` `:root` + `[data-theme=light]` and `themes.ts` `nordDark`. Do not hand-edit. |
| `services-settings/mock-server.mjs` | Zero-dep fixture server: `/api/services*` incl. proposed logs / reset-data / prune / `leaseHolders`; simulated transitions; 403 `operate_required` in observe mode; coalesced ping. |
| `services-settings/capture.cjs` | Playwright: 15 state shots (3 themes × desktop/mobile) + horizontal-overflow check. |
| `services-settings/contrast.cjs` | Computed-contrast probe over 6 pages × 3 themes. |

## Surfaces → tokens → states

| Surface | Tokens | States covered by fixtures |
|---|---|---|
| State pill | `--severity-{success,info,warning,error,neutral}-{bg,fg,border}` + shape glyph | healthy ●, idle ○, starting/stopping ◐ (spins only without reduced-motion), stopped □, blocked ◆ "Not responding", failed/stop-failed/unavailable ▲ |
| Row / panels | card root, inset panel recipes; `--elevation-rim`, `--shadow-card` | all 12 fixture services |
| Why-callout | severity callout recipe (error; warning for blocked) | runtime-unreachable + `tried`, package-absent, adoption-uncertain, failed + retry countdown, blocked, stop-failed |
| Identity chips | `--tint-blue-*` (Update), `--tint-orange-*` (Restart to apply, Network-exposed) | updateAvailable, restartRequired, exposure all-interfaces |
| Danger zone | `--tint-red-*` (border + `btn-danger`) | reset allowed / blocked-by-state, remove with volumes |
| Redaction mark | `--tint-purple-{bg,fg}` | `«secret:apikey»` in docling output |
| Read-only | severity-warning callout + 3 remedies | caller tier observe |

## Decisions and the public rule each one rests on

| Decision | Rule |
|---|---|
| List grouped Needs attention → Running → Stopped, counts per group, nav dot | Nielsen #1 visibility of system status; Gestalt common region (lawsofux.com/common-region) |
| One plain-language reason sentence per row; server `hint` only on detail | Nielsen #8 aesthetic and minimalist design; #9 help users recognise, diagnose, recover |
| Detail callout = what happened + why (`tried`) + the fix action inside it | Nielsen #9; GOV.UK error-message pattern (say what happened and how to fix it) |
| Exactly one primary action per state (Start / Try again / Retry now / Prefetch) | Von Restorff (lawsofux.com/von-restorff-effect); ui-contract "one focal point" |
| Actions shown only when legal for the state, server stays authority | Nielsen #5 error prevention |
| "Try again" for `unavailable` (re-evaluates; never fetches) | Nielsen #3 user control and freedom |
| Destructive actions isolated in Danger zone; reset needs typed id; remove keeps volumes by default; prune previews first | Nielsen #5; NN/g confirmation dialogs (be specific about the consequence) |
| Force stop explains the safety check it overrides | NN/g confirmation dialogs; Nielsen #9 |
| Secrets: write-only input, visible label, cleared after save, source ref shown | WCAG 3.3.2 labels or instructions; spec "No reveal surface" |
| Output loaded on request, text-only, redactions marked | Nielsen #1; OWASP output encoding (logs are untrusted) |
| Add flow = 3 steps (Choose → Review → Done); prefetch separate, unchecked | Nielsen #5; GOV.UK "check answers" pattern |
| State conveyed by shape + text, never colour alone | WCAG 1.4.1; ui-contract a11y invariant #4 |
| Runtime matrix scrolls inside its card on mobile | WCAG 1.4.10 exempts 2-D data tables from reflow |

## Gate results (2026-10-15)

| Gate | Result |
|---|---|
| Text contrast AA, base dark + base light + nord dark, 6 pages | 1023 text elements, 0 below AA (`contrast.cjs`); probe validated by injecting `--text-muted` → 18 fails at 2.78:1 |
| Horizontal overflow at 390 px | none (fixed: absolutely positioned `sr-only` span escaped the rail scroller → `position: relative` on rail items) |
| Console | clean (only the intentional 400 from the invalid-definition shot) |
| Raw colour literals | 1, the contract's `#fff` on `--accent-solid` |
| Targets | buttons `min-height` 44 px below `sm`, 36 px from `sm` (contract recipe) |
| Focus | `.focus-ring` on every control; dialogs trap Tab, Escape closes, focus returns |

## Fixes made during the loop

1. Mobile rail groups stacked vertically → `display: contents` below `md` (matches as-built `contents md:block`).
2. Row repeated reason + hint → reason only in the list.
3. Lone chevron row on mobile → hidden; whole card is the link.
4. `unavailable` had no way forward → "Try again" (design D9 updated).
5. Secret input had only an sr-only label → visible label.
6. Endpoint name and URL ran together → name as chip.
7. Reset-confirm label wrapped into three lines → single inline span.
8. 1 s countdown re-render clobbered typing → only `[data-retry]` spans update; ping re-render keeps input values and focus.

## Decided in review

- Page label "All services" under group "Services" (id/URL stay `services`).
- Runtimes on mobile keeps the table scrolling inside its card (WCAG 1.4.10 data-table exemption).

## Superseded by the spec (doubt review cycles 1-4)

The mockup shows direction, not the final contract. Where they differ, `specs/` wins:
- Stop is hidden and only Force stop shown for instances not started by the dashboard; Stop is offered for `duplicate-instances`.
- Reset data appears only for services that declare volumes.
- Logs can answer `secrets-changed`, `secret-unavailable` / `secret-too-short` (naming the secret), `runtime-error`, `no-output`.
- Read-only state comes from `canOperate` in the list response, not from a 403.
- The list refetch runs on ping; the probing detail GET only on open and Refresh.

## Open for review

- As-built rail paints inactive items with `--text-muted` (contract debt). The mockup uses `--text-secondary`; this change does not restyle the rail.
