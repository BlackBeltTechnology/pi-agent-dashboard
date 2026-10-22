# Tasks

## 1. Phase 0 — OIDC discovery endpoint scheme check

- [ ] 1.1 Test (test-plan #E1), L1, extending `packages/client-utils/src/identity/__tests__/login-flow.test.ts` (exemplar: that same file).
  - Input: a discovery document with `authorization_endpoint: "javascript:alert(document.domain)//"`.
  - Trigger: `startLogin()`.
  - Observable: rejects with `LoginFlowError("discovery-failed")`, and the injected `assign` spy is called 0 times.
  - Verify it fails on the current code.
- [ ] 1.2 Test (test-plan #E2), L1, same file and exemplar.
  - Input: a discovery document with `end_session_endpoint: "javascript:alert(1)//"`.
  - Trigger: sign-out.
  - Observable: rejects with `discovery-failed`, and the `location.assign` spy is called 0 times.
  - Verify it fails first.
- [ ] 1.3 Test (test-plan #E3), L1, same file and exemplar. Decision table over endpoints `http://idp.example.com/*`, `https://idp.example.com/*`, `https://<dashboard-origin>/*` and `http://127.0.0.1:8080/*`, triggered by `startLogin()`.
  - Observable: public `http` gives `discovery-failed` with 0 token `fetch` calls; each of the other three calls the authorize `assign` once.
  - Verify the public-http case fails first.
- [ ] 1.4 Implement `isAllowedOidcEndpoint` in `login-flow.ts` and apply it to all three endpoints before `buildAuthorizeRequest`, any token `fetch`, and the logout `location.assign` (design D11; `login-flow.ts:102,125,151-155`). Verify 1.1–1.3 pass and the existing identity tests stay green.
- [ ] 1.5 Update the `login-flow.ts` row in `packages/client-utils/src/AGENTS.md` (discovery-endpoint scheme guard, `See change: harden-client-sinks`). Verify the row exists.

## 2. Phase A — shared URL policy

- [ ] 2.1 Test (test-plan #E4), L1, new `packages/shared/src/__tests__/url-policy.test.ts` (exemplar: `packages/shared/src/__tests__/binary-lookup.test.ts`).
  - Input: `javascript:x`, ` JaVaScRiPt:x`, `vbscript:x`, `data:text/html,x`, `blob:https://a/b`, `file:///etc/passwd`, `ms-msdt:x`, `mailto:a@b`, `https://github.com/x`.
  - Trigger: `classifyUrl(v, "https://dash.example")`.
  - Observable: the first seven are `blocked`, `mailto:` is `mailto`, https is `external`.
  - Verify it fails first.
- [ ] 2.2 Test (test-plan #E5), L1, same file and exemplar.
  - Input: raw `"https://exa\tmple.com/"`, `"java\x01script:alert(1)"`, `"/\\evil.example"`, `"\\\\evil.example"`, `"  https://ok.example/  "`.
  - Trigger: `classifyUrl`.
  - Observable: the first four are `blocked`; the trimmed fifth is `external`.
  - Verify it fails first.
- [ ] 2.3 Test (test-plan #E6), L1, same file and exemplar. Origin `http://localhost:8000`.
  - Input: `http://localhost:8000/settings`, `http://0x7f.0.0.1/`, `http://2130706433/`, `http://localhost./`, `http://app.localhost:5173/`, `http://[::1]:8080/`, `http://192.168.16.204:8000/`, `//localhost:8000/settings`, `//evil.example/x`.
  - Trigger: `classifyUrl`.
  - Observable: `internal`; `loopback` ×5; `external`; not `internal`; `external`.
  - Verify it fails first.
- [ ] 2.4 Implement `packages/shared/src/url-policy.ts` (`classifyUrl(raw, origin | null)`, raw pre-scan, normalized-hostname loopback, precedence, pure, never throws; design D2) and export it from the package. Verify 2.1–2.3 pass and `tsc --noEmit` is clean for shared.
- [ ] 2.5 Test (test-plan #E7), L1, `packages/electron/src/__tests__/link-handling.test.ts` (exemplar: that same file).
  - Input: the absolute rows of 2.1–2.3, plus `/settings` and `//evil.example/x`.
  - Trigger: client `classifyUrl(v, null)` vs Electron `isAllowedExternalUrl(v)`.
  - Observable: relative and scheme-relative input give `blocked` and `false`; for every absolute row, Electron returns `true` ⇔ class ∈ {external, loopback, mailto}.
  - Verify it fails before 2.6.
- [ ] 2.6 Delegate `tool-renderers/UrlLink.tsx` and Electron `lib/link-handling.ts` `isAllowedExternalUrl` to `classifyUrl`. `safeUrlTransform` and `is-external-href.ts` stay unchanged (design D2 Scope). Verify 2.5 and the existing `UrlLink`, link-handling and markdown-sanitize suites pass unchanged.
- [ ] 2.7 Update the `AGENTS.md` rows for `packages/shared/src/url-policy.ts` (new), `UrlLink.tsx` and `link-handling.ts`. Verify the rows exist.

## 3. Phase A — sink guard (inventory first)

- [ ] 3.1 Test (test-plan #E11), L1, new `scripts/__tests__/client-sinks.test.mjs` (exemplar: `scripts/__tests__/fixed-tick-waits.test.mjs`).
  - Input: a fixture tree containing:
    - `window.open(x)`, `a.href = x`, `<a href={x}>`, `location = x`, `setAttribute("src",x)`;
    - `el.innerHTML = x`, `document.write(x)`, `eval(x)`, `new Worker(x)`;
    - the same tokens inside comments and strings;
    - annotated lines with and without a reason;
    - a file under `dashboard-plugin-runtime/src/server/`;
    - a test file;
    - a `trustedMermaidParse` import from a non-Mermaid file.
  - Trigger: `analyzeClientSinks(root, {ruleSets})`, first with `nav` only, then with all rule sets.
  - Observable:
    - the `nav` run flags exactly the 5 nav tokens;
    - the full run adds the 4 html tokens and the import;
    - comments, strings, the annotated-with-reason line, the server file and the test file are never flagged;
    - the annotation without a reason is flagged.
  - Verify it fails first.
- [ ] 3.2 Implement `scripts/check-client-sinks.mjs` (design D4: TypeScript-scanner tokenization, client-side roots, `nav`/`html` rule sets, policy-helper import allowlist, file allowlist, annotation marker). Verify 3.1 passes. Run `--rules nav --report` and record the inventory output in this task's notes as the Phase A migration list.

## 4. Phase A — navigation chokepoints and migration

- [ ] 4.1 Test (test-plan #E10), L1, new `packages/client/src/lib/nav/__tests__/safe-navigation.test.tsx` (exemplar: `packages/client/src/components/__tests__/PreviewCard.test.tsx`).
  - Input: `openUrl("data:text/html,<script>1</script>")` via `useSafeNavigation()`.
  - Trigger: call it.
  - Observable: returns `false`, the `window.open` spy has 0 calls, and one `role="status"` notice is rendered.
  - Verify it fails first.
- [ ] 4.2 Implement `packages/client/src/lib/nav/safe-navigation.ts` (`SafeLink`, `useSafeNavigation`, non-hook `openExternalUrl`; design D3). Verify 4.1 passes.
- [ ] 4.3 Re-export `SafeLink`, `useSafeNavigation` and `openExternalUrl` from `packages/dashboard-plugin-runtime`, and update its public-API surface test or snapshot. Verify the runtime contract test passes.
- [ ] 4.4 Test (test-plan #E8), L1, `packages/client/src/components/tool-renderers/__tests__/CtxToolRenderer.test.tsx` (exemplar: that same file).
  - Input: `ctx_fetch_and_index` args `{url:"javascript:alert(1)"}`.
  - Trigger: render `CtxToolRenderer`.
  - Observable: the URL text is present, with no `<a>` carrying an `href` attribute.
  - Verify it fails first.
- [ ] 4.5 Test (test-plan #E9), L1, new `packages/client/src/components/session/__tests__/SessionCard.relayed-links.test.tsx` (exemplar: `SessionCard.ended-reason.test.tsx`).
  - Input: a session with `gitPrUrl: "javascript:alert(1)"` and `gitBranchUrl: "data:text/html,x"`.
  - Trigger: render `SessionCard`, `MobileActionMenu` and `WorktreeActionsMenu`.
  - Observable: no element has an `href` starting with `javascript:` or `data:`, and the text is still shown.
  - Verify it fails first.
- [ ] 4.6 Migrate every `nav` site in the 3.2 inventory to the chokepoints, including:
  - `CtxToolRenderer`, `ToolsSection`, `WhatsNewDialog`, `TabActions`;
  - `SessionCard`, `MobileActionMenu`, `WorktreeActionsMenu`;
  - `FrontmatterProperties`, `InlineMarkdown`, `FallbackPreview`, `OAuthFlowView`, `FolderOpenSpecSection`;
  - `ConnectionStatusBanner`, `NetworkDiscoverySection`, `ConnectMachine`, `useOpenExternal`;
  - `LoginGate`, `UserBar`, `LoginPage`, `PairLanding`, `PairRequestLanding`;
  - `client-utils` `login-flow.ts` (via `classifyUrl`, keeping the 1.1–1.3 tests green);
  - `team-open.ts`, `CraftFrame.tsx`, `embedded-app.tsx`, team-app `seam-identity.tsx`.
  Constant-identifier hrefs get an annotation. In `embedded-app.tsx`, migrate only the raw `window.open` at `:193`; `navigateDashboard`, `openSession` and `openFolder` keep their stricter validator (design D3, "Stricter validators win"). Verify 4.4, 4.5, the existing `plugin-embedded-app` host-navigation tests and the affected package suites pass, and `node scripts/check-client-sinks.mjs --rules nav` exits 0.
- [ ] 4.7 Test (test-plan #E12), level ci, extending `scripts/__tests__/client-sinks.test.mjs` (exemplar: `scripts/__tests__/fixed-tick-waits.test.mjs`).
  - Input: `.github/workflows/ci.yml`.
  - Trigger: parse the workflow.
  - Observable: a step runs `node scripts/check-client-sinks.mjs` in the same job as `check-fixed-tick-waits.mjs`.
  - Verify it fails before 4.8.
- [ ] 4.8 Wire the guard (`nav` rule set) as a `ci.yml` step next to `check-fixed-tick-waits.mjs` and into the ship gate. Verify 4.7 passes.
- [ ] 4.9 Add `scripts/check-client-sinks.mjs.AGENTS.md`, its `scripts/AGENTS.md` row, and the `AGENTS.md` rows for `safe-navigation.ts` (new) and every migrated file. Verify with `git diff --stat` that each touched source file's row is updated.

## 5. Phase B — Trusted Types policy module

- [ ] 5.1 Test (test-plan #E13), L1, new `packages/client/src/lib/security/__tests__/trusted-types.test.ts` (exemplar: `packages/client/src/components/preview/__tests__/markdown-sanitize.test.ts`).
  - Input: `/sw.js`, `/assets/a.mjs`, `/assets/a.js`, `/assets/sub/a.js`, `/api/file/raw?path=a.js`, `https://cdn.example/x.js`, `/@fs/<repo-root>/x.ts?worker_file`, `/@fs/etc/x.js`.
  - Trigger: `pi-worker-url` and `default.createScriptURL`, in prod and in `DEV` builds.
  - Observable: in prod the first three are accepted and the rest rejected; `DEV` additionally accepts the `/@fs/<repo-root>` URL and still rejects `/@fs/etc` and `/api/`.
  - Verify it fails first.
- [ ] 5.2 Test (test-plan #E14), L1, same file and exemplar. Meta `enforce`.
  - Input: `#a{color:red}`, `<?xml version="1.0"?><svg><foreignObject><div>L1<br/>L2</div></foreignObject></svg>`, `<img src=x onerror=f()>`, `"alert(1)"`.
  - Trigger: `default.createHTML` / `createScript`.
  - Observable: the CSS is unchanged; the SVG keeps `foreignObject` and `<br>`; `onerror` is absent; `createScript` returns `null`.
  - Verify it fails first.
- [ ] 5.3 Test (test-plan #E15), L1, same file and exemplar.
  - Input: meta `report`, meta absent, meta `garbage`; value `<img src=x onerror=f()>`.
  - Trigger: `default.createHTML`.
  - Observable: the output is byte-identical to the input in all three cases, and the hit counter increases by 1 each time.
  - Verify it fails first.
- [ ] 5.4 Test (test-plan #E16), L1, new `packages/team-app/src/__tests__/icons-static-svg.test.tsx` (exemplar: `packages/team-app/src/__tests__/gate-and-seam.test.tsx`).
  - Input: `ICON["user"]`, `ICON["nope"]`, `GALLERY["fox"]`, `GALLERY["nope"]`.
  - Trigger: render `Icon` / `Avatar`.
  - Observable: known keys render the constant SVG; unknown keys render an empty `<svg>` without throwing.
  - Verify it fails first.
- [ ] 5.5 Test (test-plan #E26), L1, new `packages/client/src/__tests__/trusted-types-boot-order.test.ts` (exemplar: `packages/client/src/__tests__/main-primitive-registrations.test.ts`).
  - Input: a fake `window.trustedTypes` that records the `createPolicy` order; meta `report`.
  - Trigger: the client boot function.
  - Observable: all named policies and exactly one `default` are created before `createRoot().render` is called.
  - Verify it fails first.
- [ ] 5.6 Test (test-plan #F7), L1, new `packages/client/src/components/preview/__tests__/AsciiDocPreview.no-trusted-types.test.tsx` (exemplar: `AsciiDocPreview.markup-repair.test.tsx`).
  - Input: jsdom without `trustedTypes`; AsciiDoc HTML containing `<img onerror>`.
  - Trigger: render `AsciiDocPreview`.
  - Observable: the DOM equals the sanitized server HTML, `onerror` is absent, and nothing throws.
  - Verify it fails before 6.2.
- [ ] 5.7 Move the AsciiDoc, EML, DOCX and diagram-SVG DOMPurify configurations used by the server, plus `sanitizeMermaidSvg`'s config (`MermaidBlock.tsx:100-110`), into `packages/shared/src/sanitize-profiles.ts`, importing them unchanged on the server and in `MermaidBlock`. Verify the existing server sanitize and mermaid sanitization tests pass unchanged.
- [ ] 5.8 Implement `packages/client/src/lib/security/trusted-types.ts` (design D5/D6: named policies, mode-aware `default`, mode read from `<meta name="pi-trusted-types">`, hit counting) and register it in `packages/client/src/main.tsx` before the first render. Verify 5.1–5.5 pass and the app boots with no console errors in `npm run dev`.
- [ ] 5.9 Update the `AGENTS.md` rows for `trusted-types.ts` (new), `sanitize-profiles.ts` (new), `main.tsx` and `MermaidBlock.tsx`. Verify the rows exist.

## 6. Phase B — move app-owned sinks to named policies

- [ ] 6.1 Route `MermaidBlock.tsx` colorize through `pi-mermaid-parse` and the final injection through `pi-sanitized-html` (`mermaid` profile). Verify the existing `MermaidBlock.test.tsx` and the mermaid sanitization tests pass.
- [ ] 6.2 Route `AsciiDocPreview.tsx` and `lib/preview/adoc-math.ts` (template parse and KaTeX output) through `pi-sanitized-html` (`asciidoc` and `katex` profiles). Verify 5.6 and the AsciiDoc and math tests pass. If output parity fails, stop and write `SHIP_IT_BLOCKED.md` (no wrap-only fallback, design D5).
- [ ] 6.3 Test (test-plan #E22), L1, extending `packages/client/src/components/preview/__tests__/DiagramPreview.test.tsx` and `DocxPreview.test.tsx` (exemplars: those files).
  - Input: server-rendered diagram SVG and DOCX HTML, each containing `<img src=x onerror=f()>`.
  - Trigger: render `DiagramPreview` and `DocxPreview`.
  - Observable: the rendered DOM has no `onerror` attribute, and the legitimate content is present.
  - Verify it fails first.
- [ ] 6.4 Route `DiagramPreview.tsx:147` (`diagram-svg` profile) and `DocxPreview.tsx:109` (`docx` profile) through `pi-sanitized-html`. Verify 6.3 passes.
- [ ] 6.5 Test (test-plan #X5), L1, extending `packages/client/src/components/__tests__/MermaidBlock.test.tsx` (exemplar: that same file).
  - Fault: the `pi-sanitized-html` sanitizer throws, or DOMPurify reports itself unsupported.
  - Trigger: render a Mermaid block and an AsciiDoc block.
  - Observable: the error view is shown and raw HTML is never injected.
  - Verify it passes after 6.1/6.2.
- [ ] 6.6 Route `EmlPreview.tsx` `srcDoc` through `pi-sanitized-html` (`eml` profile) and `team-app/src/ui/icons.tsx` (both `ICON` and `GALLERY`) through `pi-static-svg`. Verify the EML tests pass with the frame still `sandbox=""`, and 5.4 passes.
- [ ] 6.7 Route `main.tsx` `serviceWorker.register` through `pi-worker-url`. Verify 5.1 still passes and the service worker registers in `npm run build` + preview.
- [ ] 6.8 Enable the guard's `html` rule set and the policy-helper import allowlist in CI. Annotate each migrated sink with `// client-sinks: allow — trusted via <policy>`. Verify `node scripts/check-client-sinks.mjs` (all rules) exits 0.
- [ ] 6.9 Update the `AGENTS.md` rows for every file touched in 6.1–6.8. Verify each touched file's row carries `See change: harden-client-sinks`.

## 7. Phase B — server Trusted Types mode and violation endpoint

- [ ] 7.1 Test (test-plan #E17), L1, extending `packages/server/src/__tests__/csp.test.ts` (exemplar: that same file).
  - Input: `PI_DASHBOARD_TRUSTED_TYPES` ∈ {unset, off, report, enforce, junk} × `PI_DASHBOARD_CSP` ∈ {unset, off, report, enforce}.
  - Trigger: resolve the Trusted Types mode.
  - Observable:
    - unset or junk resolves to `off` iff CSP is `off`, otherwise `report`;
    - explicit values win;
    - CSP `enforce` with TT unset gives `report`.
  - Verify it fails first.
- [ ] 7.2 Test (test-plan #E18), L1, same file and exemplar.
  - Input: the 4 report/enforce combinations, off+off, a `/live/x` request, a `serveApp` response with its own enforcing CSP, and `GET /`.
  - Trigger: fastify `inject`.
  - Observable:
    - the directive appears in the correct header kind only;
    - off+off registers no hook;
    - `/live/` carries no directive;
    - the mount CSP is byte-identical;
    - the baseline directive list is unchanged;
    - `index.html` carries the mode meta.
  - Verify it fails first.
- [ ] 7.3 Implement `PI_DASHBOARD_TRUSTED_TYPES` in `auth/csp.ts` (design D7), the mode meta injection next to `injectImportMap` in `lib/index-html.ts`, and the dev-server `transformIndexHtml` meta plugin in the client Vite config (design D6). Verify 7.1 and 7.2 pass and the existing CSP and index-html tests stay green.
- [ ] 7.4 Test (test-plan #E24), L1, new `packages/server/src/__tests__/csp-violations-route.test.ts` (exemplar: `packages/server/src/__tests__/cors.test.ts`).
  - Input, for one principal:
    - 3 then 4 posts in a burst;
    - 12 then 13 posts in 60 s;
    - bodies of 8192 B and 8193 B;
    - a body carrying `sample`;
    - an unauthenticated post.
  - Trigger: `POST /api/csp-violations`.
  - Observable:
    - the 4th burst post and the 13th post in a minute get 429, with counters unchanged;
    - the 8193 B body is rejected and not logged;
    - `sample` is dropped or rejected;
    - the unauthenticated post is rejected.
  - Verify it fails first.
- [ ] 7.5 Implement `POST /api/csp-violations` and `GET /api/csp-violations` (design D8: admission, 8 KiB cap, schema, 12/min burst 3 token bucket, LRU 500 counters, no sample persistence), registered under the network guard and auth. Verify 7.4 passes. Run the `observability-instrumentation` checklist on it.
- [ ] 7.6 Test (test-plan #E23), L1, extending `packages/client/src/lib/security/__tests__/trusted-types.test.ts` (exemplar: `packages/client/src/lib/identity/__tests__/dashboard-login.test.ts` for fetch mocking).
  - Input: 50 distinct keys; 51 distinct keys; a violation whose `sample` has no `|`; a source `…/view?path=a&ni=XYZ#h`.
  - Trigger: flush.
  - Observable:
    - 50 keys go out with no overflow;
    - 51 keys go out as 50 keys plus `overflow: 1`;
    - the sink is `unknown`;
    - the source has no `?` or `#`;
    - the payload has no `sample` field.
  - Verify it fails first.
- [ ] 7.7 Test (test-plan #X3), L1, same file and exemplar.
  - Fault: `POST /api/csp-violations` rejects.
  - Trigger: flush.
  - Observable: no thrown error, no UI change, and the batch is dropped (the next flush starts empty).
  - Verify it fails first.
- [ ] 7.8 Implement the client reporter in `trusted-types.ts` (design D8: listener plus default hits, dedupe, 50-key cap with `overflow`, `sink` prefix or `unknown`, stripped `source`, 30 s / `pagehide` keepalive flush with the bearer, silent failure). Verify 7.6 and 7.7 pass.
- [ ] 7.9 Add `PI_DASHBOARD_TRUSTED_TYPES` to the server env documentation (delegate the `docs/` prose to DocScribe) and the new route rows to the server's directory `AGENTS.md`. Verify the docs and rows exist.

## 8. Phase B — e2e budget, visual parity, enforce run

- [ ] 8.1 Test (test-plan #F3), L3, new `tests/e2e/trusted-types-budget.spec.ts` (exemplar: `tests/e2e/csp.spec.ts`).
  - Input: the spike coverage routes, plus 21 plugin settings pages (10 s settle) and `/apps/team/`, with TT `report` and service workers blocked.
  - Trigger: load each route, plus a separate control step that injects one raw `innerHTML`.
  - Observable:
    - every route has 0 violations and default hits ≤ `tests/e2e/fixtures/trusted-types-budget.json`;
    - the control step records exactly 1 violation;
    - no page shows the offline banner.
  - Verify the spec passes against the docker harness.
- [ ] 8.2 Test (test-plan #F1), L3, new `tests/e2e/trusted-types-visual.spec.ts` (exemplar: `tests/e2e/mermaid-colorize.spec.ts`).
  - Input: `tests/e2e/fixtures/mermaid-gallery.md` with 13 diagram types.
  - Trigger: load with TT `off` twice and with `enforce`.
  - Observable: each diagram's `enforce`-vs-`off` pixel diff is ≤ its `off`-vs-`off` diff, and flowchart default nodes keep the accent tint.
  - Verify the spec passes.
- [ ] 8.3 Test (test-plan #F2), L3, same spec file (exemplar: `tests/e2e/asciidoc-preview.spec.ts`).
  - Input: AsciiDoc (headings, table, `stem:[a^2]`, a mermaid block), EML, KaTeX and diagram-SVG fixtures.
  - Trigger: load with `off` and with `enforce`.
  - Observable: identical within baseline variance, 0 TT violations, and the EML frame is `sandbox=""`.
  - Verify the spec passes.
- [ ] 8.4 Test (test-plan #P1), L3, new `tests/e2e/trusted-types-perf.spec.ts` (exemplar: `tests/e2e/csp.spec.ts`).
  - Workload: the mermaid-gallery and session-chat fixtures under `PI_DASHBOARD_TRUSTED_TYPES=enforce`.
  - Metric: the sum of time inside `default`-policy callbacks per page load, ≤ 20 ms (median of 5 runs).
  - Verify the spec passes. If it is over budget, stop and write `SHIP_IT_BLOCKED.md` (no silent `htmlLabels:false`).
- [ ] 8.5 Test (test-plan #X6), L3, new `tests/e2e/trusted-types-enforce.spec.ts` (exemplar: `tests/e2e/csp.spec.ts`).
  - Fault: library eval or worker paths under `PI_DASHBOARD_TRUSTED_TYPES=enforce`.
  - Trigger: load the Monaco editor (open a `.ts` file), PDF, chat and plugin settings routes.
  - Observable: 0 `pageerror`s, the editor shows the file text, and the PDF renders page 1.
  - Write the results to a new `docs/research/trusted-types-enforce-results.md` via DocScribe, with its `docs/AGENTS.md` row, leaving the spike report unedited. Verify the spec passes and the note exists.

## 9. Phase B — Electron bundled renderer pages

- [ ] 9.1 Test (test-plan #F6), L3, new standalone `tests/e2e/electron-pages-trusted-types.spec.ts`. It loads `file://` pages in Chromium with an `addInitScript`-stubbed `window.api` and needs no docker harness (exemplar for harness glue: `tests/e2e/csp.spec.ts`).
  - Input: `doctor.html`, `loading.html`, `remote-connect.html` and `connecting.html`, with data that includes the server URL `"><img src=x onerror=f()>` and a loopback health stub returning 200.
  - Trigger: load each page.
  - Observable: every page renders with 0 TT violations; the markup URL shows as text with no `<img>`; the loading page reports the loopback server reachable.
  - Verify it fails first.
- [ ] 9.2 Add meta CSPs with an enforced `require-trusted-types-for 'script'`:
  - `src/renderer/doctor.html` and `resources/loading.html` get `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'`;
  - `loading.html` also gets `connect-src http: https:`;
  - `remote-connect.html` and `connecting.html` keep their existing policies and add the directive.
  
  In each page, register a page-local policy at the top of its first inline script for constant markup (`loading.html:106`, `remote-connect.html:206`, `doctor.html:111,146,152`), escape data, or switch to DOM APIs or `textContent`. Verify 9.1 and the existing `loading-page-handoff` tests pass.
- [ ] 9.3 Manual check (test-plan: manual-only, #M1). In the installed packaged Electron build, open the loading, remote-connect and doctor windows and confirm they look and behave as before. Deferred to post-merge.
- [ ] 9.4 Update the `AGENTS.md` rows for the four pages. Verify the rows exist.

## 10. Phase C — signed navigation intents

- [ ] 10.1 Test (test-plan #E19), L1, new `packages/server/src/__tests__/nav-intent.test.ts` (exemplar: `packages/server/src/auth/passkey/__tests__/passkey-service.test.ts`).
  - Input: an intent minted for principal A, `file-view`, folder `/home/op/secret-project`, path `notes.md`.
  - Trigger: verify with a flipped byte, with target `secrets.env`, as principal B, after a new process key; and base64-decode the value.
  - Observable: all four verifications fail, and the decoded bytes contain neither `secret-project`, `notes.md`, nor A's id.
  - Verify it fails first.
- [ ] 10.2 Test (test-plan #E20), L1, same file and exemplar.
  - Input: an intent minted at t0.
  - Trigger: verify at t0+599 s and at t0+601 s on a fake clock.
  - Observable: 599 s verifies; 601 s fails.
  - Verify it fails first.
- [ ] 10.3 Test (test-plan #X4), L1, new `packages/server/src/__tests__/nav-intent-route.test.ts` (exemplar: `packages/server/src/__tests__/cors.test.ts`).
  - Fault: `POST /api/nav-intent` with `Origin: https://evil.example`.
  - Trigger: the request.
  - Observable: the mutation-origin gate refuses it, the response has no `Access-Control-Allow-Origin`, and no intent is minted.
  - Verify it passes once the route exists.
- [ ] 10.4 Implement the nav-intent module (design D10: `e` + MAC only, MAC over principal/kind/canonical target/expiry, exactly 600 s, per-process key, `timingSafeEqual`) and the `POST /api/nav-intent` and `POST /api/nav-intent/verify` routes behind the same admission. Verify 10.1–10.3 pass. Run a `security-hardening` review of the binding and key lifecycle.
- [ ] 10.5 Test (test-plan #E21), L1, extending `packages/client/src/components/__tests__/PreviewCard.test.tsx` (exemplar: that same file).
  - Input: Expand on an operator card, Expand on an agent card, an agent-declared server confirm chip, canvas auto-open, and a middle-click on an in-app overlay link.
  - Trigger: each action.
  - Observable: a mint request is issued only for Expand on the operator card; the others navigate without `ni` and with 0 mint calls.
  - Verify it fails first.
- [ ] 10.6 Test (test-plan #F8), L1, same file and exemplar.
  - Input: an in-app overlay `<a>` from an operator card.
  - Trigger: middle-click and cmd-click.
  - Observable: the default navigation proceeds through the plain `href` without `ni`, with 0 mint calls.
  - Verify it passes.
- [ ] 10.7 Test (test-plan #X2), L1, same file and exemplar.
  - Fault: `POST /api/nav-intent` returns 500.
  - Trigger: operator Expand.
  - Observable: navigation goes to the route URL without `ni`.
  - Verify it fails first.
- [ ] 10.8 Enumerate every caller that builds a `/pi-view` or `/folder/:cwd/view` URL and assign each a row of the design D10 carrier table. Mint only at the operator route-URL carrier sites, appending `ni=` with fallback on failure. Verify 10.5–10.7 pass.
- [ ] 10.9 Test (test-plan #X1), L1, new `packages/client/src/components/preview/__tests__/PreviewOverlayView.intent.test.tsx` (exemplar: `packages/client/src/components/__tests__/FilePreviewOverlay.test.tsx`).
  - Fault: the verify endpoint aborts, or stalls past 2 s.
  - Trigger: mount `PreviewOverlayView` with `ni`.
  - Observable: both mount without `PreviewProvenance` (agent provenance); the stalled case mounts at 2 s, not earlier.
  - Verify it fails first.
- [ ] 10.10 Make the overlay provenance in `PreviewOverlayView` conditional: pending ≤ 2 s, then `PreviewProvenance autoOpened={false}` only on a verified intent. Verify 10.9 passes.
- [ ] 10.11 Test (test-plan #E25), L1, extending `packages/client/src/lib/identity/__tests__/gate.test.ts` (exemplar: that same file).
  - Input: a login completing with `returnTo=/folder/abc/view?path=README.md` and no `ni`, and one with `returnTo=//evil.example`.
  - Trigger: `LoginPage` return handling.
  - Observable: the first navigates to the same-origin path with 0 intent verify calls; the second is rejected by `safeReturnTo` exactly as before.
  - Verify it passes, as a regression guard.
- [ ] 10.12 Test (test-plan #F4), L3, new `tests/e2e/nav-intent-egress.spec.ts` (exemplar: `tests/e2e/canvas-egress-banner.spec.ts`).
  - Input: `page.html` loading `https://unpkg.com/x.js`, opened via `/folder/<cwd>/view?path=page.html` without `ni`.
  - Trigger: open it in a fresh tab.
  - Observable: the unpkg request is blocked and listed in the banner.
  - Verify the spec passes.
- [ ] 10.13 Test (test-plan #F5), L3, same spec and exemplar.
  - Input: operator Expand on an operator-provenance card for `page.html`.
  - Trigger: reload within 600 s, then strip `ni` and reload in the same tab.
  - Observable: on the first reload unpkg loads (open policy); after stripping, unpkg is blocked.
  - Verify the spec passes.
- [ ] 10.14 Update the `AGENTS.md` rows for the nav-intent module, its routes, the minting call sites and `PreviewOverlayView`. Delegate a short `docs/architecture.md` security note (navigation intents, Trusted Types modes, violation channel) to DocScribe. Verify the rows and the doc section exist.

## 11. Integration

- [ ] 11.1 Run the full gates: `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log`, `node scripts/check-client-sinks.mjs`, `npm run quality:changed`, and the e2e specs from groups 8–10. Verify all pass.
- [ ] 11.2 Run CodeQL locally (`scripts/codeql-local.mjs`). Verify the `js/xss` and `js/client-side-unvalidated-url-redirection` untriaged entries for files this change touches no longer fire, and record any residue for `triage-codeql-alert-debt`.

## Workflow follow-up

- The user withdraws the superseded draft `openspec/changes/add-trusted-types-report-only/` (not edited by this change).
- `triage-codeql-alert-debt` should declare `blocked_by: harden-client-sinks` for its XSS and redirect residue.
- Follow-up change: flip the `PI_DASHBOARD_TRUSTED_TYPES` default to `enforce` after one release with zero app-owned violations in `/api/csp-violations` telemetry.
