# Test Plan — harden-raw-svg-responses

Stage: design   Generated: 2026-10-21

`SANDBOX` = `sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; frame-ancestors 'self'`.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | Raw active-content responses are sandboxed | equivalence partitioning | L1 | automated | `evil.svg` (`<script>` + `onload`), `page.html` in a known cwd | `GET /api/file/raw` for each | 200. `content-security-policy` === SANDBOX. `x-content-type-options` === `nosniff`. `content-type` is `image/svg+xml` / `text/html; charset=utf-8`. Body is byte-identical to the file |
| E2 | Raw active-content responses are sandboxed (case-insensitive) | equivalence partitioning | L1 | automated | `page.HTM`, `LOGO.SVG` in a known cwd | `GET /api/file/raw` for each | `content-security-policy` === SANDBOX and `nosniff` present |
| E3 | Non-active types do not get the sandbox policy | equivalence partitioning (negative class) | L1 | automated | `foo.pdf`, `photo.png`, `notes.txt` in a known cwd | `GET /api/file/raw` for each | no `content-security-policy` header. `content-type` unchanged |
| E4 | XML document types are classified as scriptable | decision table | L1 | automated | media-type strings `application/xhtml+xml`, `application/xml`, `text/xml`, `TEXT/HTML; charset=utf-8`, ` image/svg+xml ` vs `text/plain; charset=utf-8`, `application/pdf`, `image/png`, `application/octet-stream`, `""` | `isScriptableMediaType(type)` | true for the first five, false for the rest |
| E5 | Ranged SVG response is sandboxed (BVA on Range) | BVA | L1 | automated | `big.svg` (≥ 200 bytes) in a known cwd | `Range: bytes=0-99`, then `Range: bytes=-1` (suffix, last byte) | 206 with `content-range` `bytes 0-99/<size>` / `bytes <size-1>-<size-1>/<size>`, SANDBOX and `nosniff` on both |
| E6 | SVG admitted via the artifact root is sandboxed | state (admission layer ③) | L1 | automated | `shot.svg` under a temp artifact root, outside cwd and git root | `GET /api/file/raw` | 200, SANDBOX and `nosniff` |
| E7 | Grant-admitted HTML is sandboxed | state (grant layer) | L1 | automated | `page.html` outside cwd/git root, with an access grant covering it | `GET /api/file/raw` | 200 via the verified handle, SANDBOX and `nosniff` |
| E8 | Sandbox policy holds in every CSP mode / baseline Mode-dependent header emission (MODIFIED) | decision table (mode × type) | L1 | automated | app with `registerCsp(app, mode)` for `mode` ∈ {`enforce`, `report`, `off`}, `logo.svg` and `foo.pdf` in a known cwd | `GET /api/file/raw` for each file in each mode | `.svg`: `content-security-policy` === SANDBOX in all three modes. In `report`, also `content-security-policy-report-only` === `buildCsp()`. `.pdf`: `enforce` → `content-security-policy` === `buildCsp()`. `report` → only `-report-only`. `off` → no CSP header |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | Script-bearing SVG opened directly cannot run in the dashboard origin | state-convergence | L3 | automated | `evil.svg` in the harness workspace with `<script>document.title='PWNED'</script>` | `page.goto(<harness>/api/file/raw?cwd=…&path=evil.svg)` | after load, `document.title` !== `PWNED`. `page.evaluate(() => window.origin)` === `"null"`. `page.evaluate(() => { try { return document.cookie } catch { return "blocked" } })` === `"blocked"` |
| F2 | Script-bearing HTML opened directly cannot run in the dashboard origin | state-convergence | L3 | automated | `evil.html` with `<script>document.title='PWNED'</script>` | `page.goto(<harness>/api/file/raw?…&path=evil.html)` | `document.title` !== `PWNED`. `window.origin` === `"null"` |
| F3 | Image preview of SVG keeps rendering | state-convergence | L3 | automated | `logo.svg` with an inline `<style>` (fill colour) in the harness workspace | open it from the editor-pane file tree (image viewer) | `img[src*="/api/file/raw"][src*="logo.svg"]` reaches `naturalWidth > 0 && naturalHeight > 0` |
| F4 | HTML preview unaffected (existing "HTML preview is sandboxed without script execution") | state-convergence | L3 | automated | `page.html` with `<h1>Hello</h1>` | open it from the editor-pane file tree | the HtmlPreview iframe's `srcdoc` contains `<h1>Hello</h1>` and the frame shows `Hello` |
| F5 | Direct-open is sandboxed in non-Chromium browsers (D1 fallback trigger) | cross-browser check | — | manual-only | `evil.svg` and `evil.html` from F1/F2 | open each raw URL directly in desktop Firefox and Safari | [judgment: script marker absent and the page cannot read the dashboard origin, observed in devtools. Playwright is Chromium-only, so a failure triggers the D1 `attachment` fallback] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | Binary-safe endpoint unchanged on errors | fault (bad Range) | L1 | automated | `evil.svg` in a known cwd | `Range: bytes=abc` | 416 with `content-range: bytes */<size>`, no body, and no file descriptor leaked (existing 416 assertion still passes) |

---

## Coverage summary

- Requirements covered: 2/2 delta requirement groups (ADDED "Raw active-content responses are sandboxed", 9 scenarios; MODIFIED baseline "Mode-dependent header emission" + "Baseline policy directives" via E8), plus the regression guard on the existing HTML preview (F4)
- Scenarios by class: edge 8 · perf 0 · frontend 5 · error 1
- Scenarios by level: L1 9 · L2 0 · L3 4 · manual 1
- Scenarios by disposition: automated 13 · manual-only 1

## New infra needed

- none (L1 extends `file-raw-render-endpoints.test.ts`, `file-artifact-serving.test.ts`, `file-absolute-containment.test.ts`; L3 extends `tests/e2e/editor-pane.spec.ts`)
