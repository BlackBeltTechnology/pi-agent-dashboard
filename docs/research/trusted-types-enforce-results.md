# Trusted Types enforce run — results

Date: 2026-10-22. Change: `harden-client-sinks`. Evidence base: [trusted-types-spike.md](trusted-types-spike.md) (unchanged).

## Run

- Specs: `tests/e2e/trusted-types-enforce.spec.ts` (X6), `trusted-types-visual.spec.ts` (F1/F2), `trusted-types-perf.spec.ts` (P1), `trusted-types-budget.spec.ts` (F3), `electron-pages-trusted-types.spec.ts` (F6), `nav-intent-egress.spec.ts` (F4/F5).
- Harness: `docker/test-up.sh`. Browser: Chromium.
- Enforce forced per load: `tests/e2e/helpers/trusted-types.ts` `forceTtMode` rewrites document responses.
- Requires `TT_LAUNCH_ARGS` to disable Local Network Access checks.

## X6 — enforce per step

Format: TT violations / default-policy hits.

| Step | Violations | Default hits |
|---|---|---|
| Monaco editor (`.ts` file) | 0 | 15 |
| PDF (pdf.js, editor pane) | 0 | 14 |
| Chat with mermaid | 0 | 5 |
| Plugin settings (kb, flows, roles, quota, web-access) | 0 | 0 |

- Page error: `Cannot read properties of undefined (reading 'toUrl')` (Monaco AMD `require.toUrl`).
- Same error with TT `off` → pre-existing, not TT-caused.
- Monaco workers load from `/assets/editor.worker-<hash>.js`. Pass `pi-worker-url` / default script-URL allowlist.

## F1 — mermaid under enforce

- 13 types: flowchart, sequence, class, state, ER, gantt, pie, mindmap, journey, gitGraph, timeline, quadrant, xychart.
- Within off-vs-off variance. 0 violations.
- Flowchart default nodes keep accent wash.
- gitGraph needs explicit ids (`commit id: "c1"`). Default ids random → width varies per run (spike ±8 px noise).

## F2 — AsciiDoc + EML

- AsciiDoc: headings, table, `stem:[…]` → KaTeX, mermaid block. Requires `:stem: latexmath` doc attribute.
- EML frame: `sandbox=""`.
- AsciiDoc and EML identical off vs enforce. 0 violations.

## P1 — default-policy callback cost

- Median per load: mermaid gallery ≈ 1.7 ms (runs 2.3, 1.7, 1.9, 1.6, 1.7). Chat ≈ 0.7 ms.
- Budget: 20 ms.

## F3 — report-mode default hits per route

- Mermaid gallery: 38 (d3 labels + `<style>`).
- `doc.pdf`: 1 (pdf.js worker URL).
- All other routes incl. all plugin settings pages and `/apps/team/`: 0.
- 0 violations everywhere.
- Recorded in `tests/e2e/fixtures/trusted-types-budget.json`.

## F6 — Electron pages

- `doctor.html`, `resources/loading.html`, `remote-connect.html`, `connecting.html` enforce `require-trusted-types-for 'script'` via meta CSP.
- Hostile data renders as text. 0 violations.

## Findings

### EML `srcDoc` via React prop

- React stringifies `srcDoc` prop → hits `default` policy.
- Enforce would sanitize whole document, dropping `<base target="_blank">`.
- Fix: assign `iframe.srcdoc` as property in layout effect (`EmlPreview.tsx`).

### `eval` / `new Function` not TT-routed

- Baseline `script-src` keeps `'unsafe-eval'`.
- Chromium skips TT check for string compilation when `'unsafe-eval'` allowed.
- `createScript` → `null` still blocks `javascript:` navigations and script-text sinks.
- Removing `'unsafe-eval'`: stated non-goal. Revisit with default flip.

## Decision

- Default stays `report` (`PI_DASHBOARD_TRUSTED_TYPES`).
- Follow-up: flip default to `enforce` after one release with zero app-owned violations in `/api/csp-violations` telemetry.
