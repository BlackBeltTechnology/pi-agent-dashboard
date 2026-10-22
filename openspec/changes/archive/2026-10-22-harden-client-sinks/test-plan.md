# Test Plan — harden-client-sinks

Stage: design   Generated: 2026-10-22

Clarifications G1–G4 (reporter bound, rate limit, perf metric, intent lifetime) were resolved via `ask_user` before writing and folded into the specs and design. No open markers.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | browser-principal-client / OIDC discovery endpoints scheme-validated | EP (scheme class) | L1 | automated | discovery JSON `authorization_endpoint: "javascript:alert(document.domain)//"` | `startLogin()` | rejects `LoginFlowError("discovery-failed")`; injected `assign` spy called 0 times |
| E2 | same | EP | L1 | automated | discovery JSON `end_session_endpoint: "javascript:alert(1)//"` | sign-out | rejects `discovery-failed`; `location.assign` spy called 0 times |
| E3 | same | decision table (protocol × host class) | L1 | automated | token/authorize endpoints: `http://idp.example.com/*`, `https://idp.example.com/*`, `https://<dashboard-origin>/*`, `http://127.0.0.1:8080/*` | `startLogin()` | public `http` → `discovery-failed` with 0 token `fetch` calls; the other three → authorize `assign` called once |
| E4 | client-navigation-url-policy / URL classification | EP (scheme partitions) | L1 | automated | `javascript:x`, ` JaVaScRiPt:x`, `vbscript:x`, `data:text/html,x`, `blob:https://a/b`, `file:///etc/passwd`, `ms-msdt:x`, `mailto:a@b`, `https://github.com/x` | `classifyUrl(v, "https://dash.example")` | first seven → `blocked`; `mailto:` → `mailto`; https → `external` |
| E5 | same / Control characters, Backslash input | BVA (raw-string edge) | L1 | automated | `"https://exa\tmple.com/"`, `"java\x01script:alert(1)"`, `"/\\evil.example"`, `"\\\\evil.example"`, `"  https://ok.example/  "` | `classifyUrl` | first four → `blocked`; trimmed fifth → `external` |
| E6 | same / loopback, LAN, precedence, scheme-relative | decision table | L1 | automated | origin `http://localhost:8000`; candidates `http://localhost:8000/settings`, `http://0x7f.0.0.1/`, `http://2130706433/`, `http://localhost./`, `http://app.localhost:5173/`, `http://[::1]:8080/`, `http://192.168.16.204:8000/`, `//localhost:8000/settings`, `//evil.example/x` | `classifyUrl` | `internal`, `loopback`×5, `external`, not-`internal`, `external` respectively |
| E7 | same / No page origin; Shared classification across surfaces | EP + parity | L1 | automated | E4–E6 absolute rows plus `/settings`, `//evil.example/x` | client `classifyUrl(v, null)` vs Electron `isAllowedExternalUrl(v)` | relative/scheme-relative → `blocked` and `false`; for every absolute row, Electron `true` ⇔ class ∈ {external, loopback, mailto} |
| E8 | client-navigation-url-policy / Navigation goes through the classification | EP | L1 | automated | `ctx_fetch_and_index` tool args `{url:"javascript:alert(1)"}` | render `CtxToolRenderer` | output contains the text and no `<a>` with an `href` attribute |
| E9 | same / Relayed repository URL | EP | L1 | automated | session with `gitPrUrl: "javascript:alert(1)"`, `gitBranchUrl: "data:text/html,x"` | render `SessionCard`, `MobileActionMenu`, `WorktreeActionsMenu` | no element with `href` starting `javascript:` or `data:`; text still shown |
| E10 | same / Open-in-new-tab with a blocked target | EP | L1 | automated | `openUrl("data:text/html,<script>1</script>")` | call | returns `false`; `window.open` spy 0 calls; one `role="status"` notice rendered |
| E11 | same / CI guard against raw sinks | decision table (token × rule set × context) | L1 | automated | fixture tree: `window.open(x)`, `a.href = x`, `<a href={x}>`, `location = x`, `setAttribute("src",x)`, `el.innerHTML = x`, `document.write(x)`, `eval(x)`, `new Worker(x)`, the same tokens in comments and strings, annotated with and without a reason, a file in `dashboard-plugin-runtime/src/server/`, a test file, an import of `trustedMermaidParse` from a non-Mermaid file (now `trustedStaticSvg` from a non-owner file — `pi-mermaid-parse` dropped at ship-it 4.4b) | `analyzeClientSinks(root, {ruleSets})` with `nav` only, then all | `nav` run flags exactly the 5 nav tokens; full run adds the 4 html tokens plus the import; comments/strings, the annotated-with-reason line, the server file and the test file are never flagged; the annotation without a reason is flagged |
| E12 | same / CI guard (wiring) | config assertion | ci | automated | `.github/workflows/ci.yml` | parse workflow | a step runs `node scripts/check-client-sinks.mjs` in the same job as `check-fixed-tick-waits.mjs` |
| E13 | client-trusted-types / Script URL allowlist; Development build workers | BVA (path shape) | L1 | automated | `/sw.js`, `/assets/a.mjs`, `/assets/a.js`, `/assets/sub/a.js`, `/api/file/raw?path=a.js`, `https://cdn.example/x.js`, `/@fs/<repo-root>/x.ts?worker_file`, `/@fs/etc/x.js` | `pi-worker-url` and `default.createScriptURL`, prod and `DEV` builds | prod: first three accepted, rest rejected; DEV additionally accepts the `/@fs/<repo-root>` URL, still rejects `/@fs/etc` and `/api/` |
| E14 | client-trusted-types / Default policy safety net under enforcement | EP (input shape) | L1 | automated | meta `enforce`; `#a{color:red}`, `<?xml version="1.0"?><svg><foreignObject><div>L1<br/>L2</div></foreignObject></svg>`, `<img src=x onerror=f()>`, `"alert(1)"` | `default.createHTML` / `createScript` | CSS unchanged; SVG keeps `foreignObject` and `<br>`; `onerror` absent; `createScript` → `null` |
| E15 | client-trusted-types / Default policy follows the Trusted Types mode | decision table (meta) | L1 | automated | meta `report`, meta absent, meta `garbage`; input `<img src=x onerror=f()>` | `default.createHTML` | output byte-identical to input in all three; hit counter +1 each |
| E16 | client-trusted-types / App-owned sinks (constant icon markup) | EP | L1 | automated | `ICON["user"]`, `ICON["nope"]`, `GALLERY["fox"]`, `GALLERY["nope"]` | render `Icon`/`Avatar` | known keys render the constant SVG; unknown keys render empty `<svg>` with no throw |
| E17 | baseline-content-security-policy / Independent Trusted Types mode | decision table (env × env) | L1 | automated | `PI_DASHBOARD_TRUSTED_TYPES` ∈ {unset, off, report, enforce, junk} × `PI_DASHBOARD_CSP` ∈ {unset, off, report, enforce} | `resolveTrustedTypesMode` | unset/junk → `off` iff CSP `off`, else `report`; explicit values win; CSP `enforce` + TT unset → `report` |
| E18 | baseline-content-security-policy / Trusted Types directive emission; Mode-dependent header emission | decision table | L1 | automated | 4 report/enforce combos, off+off, a `/live/x` request, a `serveApp` response with its own enforcing CSP, `GET /` | inject request | directive in the correct header kind only; off+off registers no hook; `/live/` has no directive; mount CSP byte-identical; baseline directive list unchanged; `index.html` carries `<meta name="pi-trusted-types" content=<mode>>` |
| E19 | signed-navigation-intent / Intent verification; Intent value reveals nothing in clear | EP (tamper class) | L1 | automated | intent minted for principal A, `file-view`, `/home/op/secret-project` + `notes.md` | verify with: flipped byte; target `secrets.env`; principal B; new process key; base64-decode value | all four verifications fail; decoded bytes contain neither `secret-project`, `notes.md`, nor A's id |
| E20 | signed-navigation-intent / Intent minting (lifetime) | BVA (time) | L1 | automated | intent minted at t0 | verify at t0+599 s and t0+601 s (fake clock) | 599 s → ok; 601 s → fail |
| E21 | signed-navigation-intent / Intents requested only for operator actions | decision table (action × provenance) | L1 | automated | Expand on operator card, Expand on agent card, agent-declared server confirm chip, canvas auto-open, middle-click on in-app overlay link | trigger each | mint request issued only for Expand-on-operator-card; the others navigate with no `ni` and 0 mint calls |
| E22 | client-trusted-types / App-owned sinks (sanitized preview HTML) | EP | L1 | automated | server-rendered diagram SVG and DOCX HTML each containing `<img src=x onerror=f()>` | render `DiagramPreview`, `DocxPreview` | rendered DOM has no `onerror` attribute; legitimate content present |
| E23 | client-trusted-types / Violations are reported to the server | BVA (key count) + EP | L1 | automated | 50 distinct keys; 51 distinct keys; a violation whose `sample` has no `\|`; a source URL `…/view?path=a&ni=XYZ#h` | flush | 50 → 50 keys, no overflow; 51 → 50 keys + `overflow: 1`; sink `unknown`; source has no `?`/`#`; payload has no `sample` field |
| E24 | client-trusted-types / Violation endpoint stores counters only | BVA (rate, size) | L1 | automated | one principal: 3 then 4 posts in a burst; 12 then 13 posts in 60 s; body 8192 B and 8193 B; body with `sample`; unauthenticated post | `POST /api/csp-violations` | 4th burst and 13th/min → 429 with counters unchanged; 8193 B rejected and not logged; `sample` dropped or rejected; unauthenticated rejected |
| E25 | signed-navigation-intent / Return-to values are not intent-gated | EP (regression) | L1 | automated | login completes with `returnTo=/folder/abc/view?path=README.md` and no `ni`; and `returnTo=//evil.example` | `LoginPage` return handling | first navigates to the same-origin path with 0 intent verify calls; second is rejected by `safeReturnTo` exactly as before |
| E26 | client-trusted-types / Policies registered before first render | state transition (boot order) | L1 | automated | fake `window.trustedTypes` recording `createPolicy` order; meta `report` | client boot (`main.tsx` bootstrap function) | all named policies plus exactly one `default` are created before `createRoot().render` is called |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | client-trusted-types / Default policy safety net (cost) | threshold, median of 5 | L3 | automated | mermaid-gallery and session-chat fixtures, `PI_DASHBOARD_TRUSTED_TYPES=enforce` | sum of time inside `default`-policy callbacks per page load ≤ 20 ms (median of 5 runs) | one page load each, 5 runs |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | client-trusted-types / Diagram output unchanged; client-untrusted-content-sanitization / colorize survives enforcement | visual diff vs double baseline | L3 | automated | 13-type mermaid gallery fixture | load with TT `off` (×2) and `enforce` | per-diagram pixel diff `enforce` vs `off` ≤ the `off`-vs-`off` diff; flowchart default nodes carry accent tint |
| F2 | client-untrusted-content-sanitization / Document preview HTML injected as a trusted value | visual diff | L3 | automated | AsciiDoc (headings, table, `stem:[a^2]`, mermaid block), EML, KaTeX, diagram-SVG fixtures | load `off` vs `enforce` | identical within baseline variance; 0 TT violations; EML frame `sandbox=""` |
| F3 | client-trusted-types / Measured violation budget | state convergence | L3 | automated | coverage routes plus 21 plugin settings pages (10 s settle) and `/apps/team/`, TT `report` | load each; separate control step injects one raw `innerHTML` | every route 0 violations and default hits ≤ budget; control step exactly 1 violation; no page shows the offline banner |
| F4 | preview-egress-grants / Crafted overlay link stays restricted | state transition (no intent) | L3 | automated | `page.html` loading `https://unpkg.com/x.js`; URL `/folder/<cwd>/view?path=page.html` without `ni` | open in a fresh tab | the unpkg request is blocked (CSP report/banner lists it) |
| F5 | signed-navigation-intent / In-app deep link survives reload; Intent removed from the address bar | state transition | L3 | automated | operator Expand on an operator-provenance card for `page.html` | reload within 600 s; then strip `ni` and reload in the same tab | first reload: unpkg loads (open policy); stripped reload: unpkg blocked |
| F6 | electron-renderer-hardening / Bundled pages enforce Trusted Types | state convergence | L3 | automated | `doctor.html`, `loading.html`, `remote-connect.html`, `connecting.html` loaded as `file://` in Chromium with a stubbed `window.api`; data incl. server URL `"><img src=x onerror=f()>`; loopback health stub returning 200 | load | each renders; 0 TT violations; markup URL shown as text (no `<img>`); loading page reports the loopback server reachable |
| F7 | client-trusted-types / Unsupported browser | EP | L1 | automated | jsdom (no `trustedTypes`); AsciiDoc HTML with `<img onerror>` | render `AsciiDocPreview` | DOM identical to the sanitized server HTML; `onerror` absent; no error thrown |
| F8 | signed-navigation-intent / Modifier-click opens a new tab | EP | L1 | automated | in-app overlay `<a>` from an operator card | middle-click / cmd-click | default navigation proceeds via plain `href` without `ni`; 0 mint calls |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | signed-navigation-intent / Intent verification unavailable | fault injection (delay + abort) | L1 | automated | verify endpoint aborts; verify endpoint stalls > 2 s | mount `PreviewOverlayView` with `ni` | both mount with `PreviewProvenance` absent (agent); stall case mounts at 2 s, not earlier |
| X2 | signed-navigation-intent / minting failure | fault injection (abort) | L1 | automated | `POST /api/nav-intent` → 500 | operator Expand | navigation happens to the route URL without `ni` |
| X3 | client-trusted-types / Server unreachable | fault injection (abort) | L1 | automated | `POST /api/csp-violations` rejects | flush | no thrown error, no UI change, batch dropped (next flush starts empty) |
| X4 | signed-navigation-intent / Cross-site mint refused | fault injection (hostile origin) | L1 | automated | `POST /api/nav-intent` with `Origin: https://evil.example` | request | refused by the mutation-origin gate; no `Access-Control-Allow-Origin` in response; no intent minted |
| X5 | client-untrusted-content-sanitization / sanitizer failure fails closed | fault injection (abort) | L1 | automated | `pi-sanitized-html` sanitizer throws / DOMPurify reports unsupported | render Mermaid and AsciiDoc blocks | error view shown; raw HTML never injected |
| X6 | client-trusted-types / Script text refused (enforce run) | fault injection (library eval) | L3 | automated | Monaco editor, PDF, chat and plugin settings routes, `PI_DASHBOARD_TRUSTED_TYPES=enforce` | load each, open a `.ts` file in the editor | 0 `pageerror`s; editor shows file text; PDF renders page 1; results written to `docs/research/trusted-types-enforce-results.md` |

### Manual-only

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| M1 | electron-renderer-hardening / Pages render under enforcement (packaged app) | exploratory | — | manual-only | installed packaged Electron build | open the loading, remote-connect and doctor windows | [judgment: pages look and behave as before in the real packaged shell — post-merge] |

---

## Coverage summary

- Requirements covered: 26/26. Every ADDED/MODIFIED requirement across the 8 deltas has ≥ 1 row.
- Scenarios by class: edge 26 · perf 1 · frontend 8 · error 6 · manual 1
- Scenarios by level: L1 32 · L3 8 · ci 1 · manual 1
- Scenarios by disposition: automated 41 · manual-only 1

## New infra needed

- F6 loads Electron renderer pages as `file://` in Playwright Chromium with an `addInitScript`-stubbed `window.api`. No such spec exists yet. It needs no docker harness, and it is a new standalone Playwright spec under `tests/e2e/` (exemplar for harness glue: any existing `tests/e2e/*.spec.ts`).
