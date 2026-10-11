# Test Plan — live-viewer-allow-downloads

Stage: proposal   Generated: 2026-10-14

Requirement under test: `live-server-preview` — *Embedded content SHALL be origin-isolated via sandbox* (MODIFIED). Scenarios: **R-a** origin isolation, **R-b** exact sandbox token set, **R-c** user-initiated export reaches the user, **R-d** token set omits `allow-same-origin` and `allow-downloads-without-user-activation` (no-gesture download blocking is NOT claimed: measured not enforced by Chrome).

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | R-b, R-d | decision-table (token set) | L1 | automated | `LiveServerViewer` rendered, `startLiveServer` mocked to return `path:/live/abc12345/` | confirm URL `http://localhost:5173` → `live-iframe` renders | `sandbox` split on whitespace, as a set, equals exactly `{allow-scripts, allow-forms, allow-popups, allow-downloads}`. It contains neither `allow-same-origin` nor `allow-downloads-without-user-activation`, and there are no duplicate tokens |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | R-c | state-transition (gesture → download) | L3 | automated | `/live/**` fulfilled with fixture HTML containing button `#export`, which on click builds `Blob('{"k":1}')` and clicks `<a download="tuning.json">` | Playwright clicks `#export` inside the `live-iframe` frame | page emits `download`, `suggestedFilename()` is `tuning.json`, and the saved file reads exactly `{"k":1}` (red before fix: no event, timeout) |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | R-a | fault-injection (hostile embed) | L3 | automated | same F1 fixture page also runs `try { localStorage.getItem("x") } catch (e) { report(e.name) }` and records `window.origin` | iframe load | frame-evaluated result is `SecurityError` for the `localStorage` access and `"null"` for `window.origin`. `allow-downloads` granted no readable origin |
| M1 | R-c | environment (Electron shell) | — | manual-only | packaged `pi-dashboard.app`, deck3d served on loopback, opened in live-server pane | click deck3d Export | [judgment: native save dialog appears (Electron default, no `will-download` handler) and the chosen file holds the exported tuning; no in-repo Electron download harness] |
| M2 | R-c | environment (remote tunnel + Firefox) | — | manual-only | dashboard reached over the zrok tunnel in Chrome, and over localhost in Firefox | click Export in an embedded loopback app | [judgment: browser download UI shows the file in both environments; tunnel + second browser not in docker harness] |

---

## Coverage summary

- Requirement scenarios covered: 4/4 (R-a X1 · R-b E1 · R-c F1, M1, M2 · R-d E1)
- Scenarios by class: edge 1 · perf 0 · frontend 1 · error 3 (X1, M1, M2)
- Scenarios by level: L1 1 · L2 0 · L3 2 · manual 2
- Scenarios by disposition: automated 3 · manual-only 2
- Performance: none. A single static attribute has no runtime path.

## New infra needed

- None. The L3 rows reuse `page.route("**/live/**")` from `tests/e2e/canvas-declare-tool.spec.ts`, fulfilled with fixture HTML, so no real loopback server is needed in the harness. The rows also use Playwright's built-in `download` event (`acceptDownloads` default true).
- Assumption, proven by F1 going red before the fix: Playwright's bundled Chromium enforces the sandbox download block the same way desktop Chrome does.
