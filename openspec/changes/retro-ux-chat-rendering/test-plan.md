# Test Plan — retro-ux-chat-rendering

Stage: design   Generated: 2026-10-12

Levels: L1 = vitest (`packages/**/__tests__/*.test.ts[x]`). L3 = Playwright `tests/e2e/*.spec.ts` in the docker harness on the shared `captureStates` helper (`retro-ux-identity-connectivity`, spec `ui-state-capture`) with this change's fixtures (task 2.1). Probe matrix = `{base,dark}`, `{base,light}`, `{nord,dark}` × 375 / 768 / 1440; probes = `contrastFailures`, `sizeFailures`, `buttonsWithoutFocusIndicator` from `tests/e2e/helpers/computed-contrast.ts`.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | mermaid-rule-repair: visibly marked — badge | EP | L1 | automated | repairable source hitting R4 and R5 (mocked mermaid: fail, then ok) | render | an "Auto-fixed" pill; two `mermaid-repair-rule` elements with `data-rule` `R4`, `R5`; each element's text is its description from `preview.mermaid.rule.R*`, not the code |
| E2 | mermaid-rule-repair: visibly marked — controls | EP | L1 | automated | repaired diagram | render; toggle Show original | Show original has `aria-pressed` false→true; Copy fixed button has a non-empty accessible name; no class in the badge row matches the palette regex `(bg\|text\|border)-(red\|blue\|cyan\|…)-\d` |
| E3 | mermaid-diagram: rendering — loading | EP | L1 | automated | mermaid import pending | render | a `role="status"` element with "Rendering diagram…" and a spinner; no `text-[var(--text-muted)]` on it; `DiagramPreview` still shows `status.loadingDiagram` "Loading diagram…" |
| E4 | mermaid-diagram: rendering + rule-repair: unrepairable | decision table (no rule applies / rules apply but retry fails / cached error remount) | L1 | automated | unknown diagram type; rule-applying source whose retry fails; same failing code remounted | render; remount | each case shows the callout with "This diagram could not be rendered." and the original error (`E1` mock message), then the raw source; callout classes reference `--severity-error-*`; no `text-red-400`/`bg-red-900`; remount shows it with no "Rendering diagram…" flash and no second render call |
| E5 | mermaid-diagram: rendering — Copy source | EP | L1 | automated | unrepairable diagram, `navigator.clipboard.writeText` mocked | click "Copy source" | `writeText` called once with the original source |
| E6 | mermaid-diagram: accent fallbacks — guard | EP | L1 | automated | `THEMES` (every palette × dark/light) and `index.css` `:root` / `[data-theme="light"]` | run guard `nonHexAccents()` | returns `[]`: the seven variables are `#rgb`/`#rrggbb` in `:root` and every `THEMES` mode; the light block's `--text-primary` is hex |
| E7 | mermaid-diagram: accent fallbacks — negative | EP | L1 | automated | synthetic palette `{ id: "x", dark: { "--accent-red": "oklch(0.6 0.2 25)" } }` | run guard | returns one entry naming `x`, `dark`, `--accent-red` |
| E8 | zoom-pan: on-surface controls — names | EP | L1 | automated | `<ZoomControls>` with no `labels` | render | buttons named and titled "Zoom in", "Zoom out", "Reset zoom"; every `svg` inside them `aria-hidden="true"` |
| E9 | zoom-pan: on-surface controls — translated | EP | L1 | automated | `MermaidBlock` zoomed with UI language `hu` | render | zoom buttons' accessible names and titles equal the `hu` catalog strings |
| E10 | zoom-pan: on-surface controls — classes | EP | L1 | automated | `<ZoomControls scale={1.2}>` | render | buttons carry `min-w-[44px] min-h-[44px] sm:min-w-[32px] sm:min-h-[32px]` (or equivalent) and the `focus-ring` class; readout `aria-live="polite"`, `text-[11px]` or larger, `text-[var(--text-secondary)]`; existing "120%" assertion still passes |
| E11 | web-search: collapsed summary — failed count | decision table (shape × errors × intact) | L1 | automated | search: 3 queries, 1 with `error`; search: 0 errors; fetch `urlMetadata` with 1 `error`; fetch older `urls` strings; search with a placeholder results list and 1 error | `summarizeBody` | `failed` = 1 / undefined / 1 / undefined / 1 with `results` undefined |
| E12 | web-search: collapsed summary — header | EP | L1 | automated | search body 3 queries · 2 results · 1 error; fetch spy | render collapsed | `web-search-summary` text "3 queries · 2 results · 1 failed"; zero fetch calls |
| E13 | web-search: conformance — expanded | EP | L1 | automated | payload with a query error, a fetch error and an https result | expand (mocked payload) | errors are pills with `--severity-error-*` classes; link has `--link` class, underline, `target="_blank" rel="noopener noreferrer"`, an `aria-hidden` icon and sr-only "(opens in a new tab)"; visible link text equals the original URL; no `text-cyan-400`, `text-red-400`, `text-[var(--text-muted)]` |
| E14 | web-search: conformance — loading | EP | L1 | automated | payload request pending | expand | `web-search-loading` has `role="status"` and "Loading details…" |
| E15 | web-search: expanded — skipped plural | BVA (1, 2) | L1 | automated | payload with 1 malformed result; with 2 | expand | "1 item could not be displayed"; "2 items could not be displayed" |
| E16 | custom-entry: fallback — label | EP | L1 | automated | `customType="my-ext:state"`, object body | render | type in a mono element with `text-[var(--text-primary)]`; "extension entry" beside it; icon `aria-hidden`; no `text-cyan-400` |
| E17 | custom-entry: alignment + probes — meta | EP | L1 | automated | object body with 53 keys | render | "3 more keys" carries `text-[var(--text-secondary)]`; header time class ≥ 12 px; card root carries `mx-4` on desktop and `mx-2` on mobile (`useMobile` mocked), the inset `ToolCallStep` uses |
| E18 | mermaid-rule-repair: visibly marked — kept behaviour | regression | L1 | automated | existing `MermaidBlock.test.tsx` repair, show-original, zoom-restore, cache cases (after task 3.8 edits) | run suite | all pass; `ruleCodes()` reads `data-rule` |
| E19 | cross-cutting: i18n | EP | L1 | automated | every new key (headline, Copy source, Rendering diagram…, viewport name, hint, zoom labels, Auto-fixed, N failed, payload notice, opens-in-new-tab, extension entry, skipped plural) | key sweep + `node scripts/i18n-parity.mjs` | each key in en, hu, zh-CN (client and `web-access-plugin`); parity exit 0 |

### Performance

None. No new fetch, no new render work; `custom-entry-rendering` "Claimed renderers SHALL NOT fetch payloads until expanded" is re-checked by E12.

### Frontend quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| F1 | zoomable-mermaid: focus model + control buttons | state-transition (idle → focused → activated → idle) | L1 | automated | rendered diagram | Tab onto viewport; Enter; Tab; Escape | after Tab: viewport focused, `tabindex="0"`, `role="group"`, translated name, no zoom buttons; after Enter: zoom buttons rendered and the next Tab focuses "Zoom in"; after Escape: buttons gone and `document.activeElement` is the viewport |
| F2 | zoomable-mermaid: focus model — passthrough | state-transition | L1 | automated | viewport focused by Tab but not activated | wheel event; Tab away | transform scale unchanged; diagram never enters the activated state |
| F3 | zoomable-mermaid: focus model — hint + ring | EP | L1 | automated | unactivated, then activated diagram | hover / focus; click | hint text "Enter or click to zoom" with no `bg-black` class; activated viewport has the `--focus-ring` indicator, no `border-blue-500` class |

### Error handling

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | web-search: conformance — evicted | fault-injection (404) | L1 | automated | `GET /api/sessions/:sid/entry/:id` → 404 | expand | `web-search-error` is a warning notice (`--severity-warning-*` classes, no `--severity-error-*`, no `text-red-400`) saying full details are no longer stored; `web-search-fallback-body` with the stored body follows |
| X2 | web-search: conformance — request failure | fault-injection (500) | L1 | automated | payload request → 500 `{ error: "boom" }` | expand | warning notice includes the reason "boom"; stored body follows; no markdown or links in it |

### L3 — rendered UI (docker harness)

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| G1 | mermaid-diagram + rule-repair + zoomable-mermaid: probes | EP over fixture states | L3 | automated | fixtures `loading`, `repaired`, `original`, `error`, `zoomed` | `captureStates` over the probe matrix | 0 contrast, size and focus failures in every state, theme and width |
| G2 | web-search: conformance — probes | EP over fixture states | L3 | automated | fixtures `collapsed`, `expanded`, `fetch`, `loading`, `evicted`, `skipped` | `captureStates` | 0 failures in every state, theme and width |
| G3 | custom-entry: alignment + probes — probes | EP over fixture states | L3 | automated | fixtures `kv`, `more`, `plain` | `captureStates` | 0 failures in every state, theme and width |
| G4 | web-search + custom-entry: alignment | EP (standalone / absorbed × 375 / 1440) | L3 | automated | chat with a tool row, a web-search row, a custom row and a tool row; same rows absorbed into one burst | bounding boxes | standalone: each row's left edge equals the tool rows' left edge (±1 px) at both widths; absorbed: equals the sibling rows inside the burst |
| G5 | zoom-pan: on-surface controls — targets | BVA (375 / 1440) | L3 | automated | zoomed mermaid diagram; zoomed `DiagramPreview` (second host) | measure button boxes | each button ≥ 44×44 at 375 and ≥ 32×32 at 1440 in both hosts; readout ≥ 11 px |
| G6 | zoomable-mermaid: keyboard zoom end-to-end | state-transition | L3 | automated | chat message with a diagram | Tab to viewport, Enter, Tab to "Zoom in", Enter, Escape | inner transform scale increases; after Escape focus is on the viewport and the zoom buttons are hidden |

### Manual

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| M1 | visual fidelity to the approved board | visual/subjective | — | manual-only | `mockups/after/**` vs the proposed column of `mockups/chat-rendering.html` | human side-by-side review | [judgment: real render matches the approved design] |

---

## Coverage summary

- Requirements covered: 11/11 (mermaid-rule-repair 2: E1 E2 E4 E18; mermaid-diagram 2: E3 E4 E5 E6 E7 G1; zoomable-mermaid 2: F1 F2 F3 G6; zoom-pan 1: E8 E9 E10 G5; web-search-entry-rendering 2: E11 E12 E13 E14 E15 X1 X2 G2 G4; custom-entry-rendering 2: E16 E17 G3 G4)
- Scenarios by class: edge 19 · perf 0 · frontend 3 · error 2 · rendered-UI 6 · manual 1
- Scenarios by level: L1 24 · L2 0 · L3 6 · — 1
- Scenarios by disposition: automated 30 · manual-only 1

## New infra needed

- `nonHexAccents(themes, css)` pure helper (exported next to the guard test, or from `lib/theme/`) so E6/E7 test the same function.
- Fixtures `tests/e2e/fixtures/retro-ux/{mermaid,web-search,custom-entry}.ts` (task 2.1) and `retro-ux-identity-connectivity` task 2.1 (`ui-capture.ts`).
