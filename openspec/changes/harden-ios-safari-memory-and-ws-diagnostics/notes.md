# Notes — harden-ios-safari-memory-and-ws-diagnostics

## 1.1 Baseline landing graph (before, develop @ 3a7dd6dae merged)

Landing graph = `index.html` entry script + `modulepreload` hrefs + transitive static `import"./x.js"`.

| chunk | raw B | gz B | full MDI set |
|---|---:|---:|---|
| index-D943XMYl.js | 2,628,359 | 751,292 | |
| react-vendor-D--lPjIx.js | 194,272 | 60,738 | |
| util-D4wUgFXH.js | 58,299 | 22,190 | |
| markdown-DXxFGGEx.js | 1,022,958 | 339,446 | |
| mdi-BC754Z1l.js | 2,780,948 | 804,079 | yes |
| jsdiff-Jo_n9_N4.js | 6,166 | 2,557 | |
| dnd-CPDCoWpc.js | 49,501 | 16,376 | |
| **total (7 chunks)** | **6,740,503** | **1,996,678** | |

## 8.2 After (this branch)

| chunk | raw B | gz B | full MDI set |
|---|---:|---:|---|
| index-UcKVVP1k.js | 2,689,660 | 773,870 | |
| react-vendor-D--lPjIx.js | 194,272 | 60,738 | |
| util-D4wUgFXH.js | 58,299 | 22,190 | |
| markdown-DXxFGGEx.js | 1,022,958 | 339,446 | |
| jsdiff-Jo_n9_N4.js | 6,166 | 2,557 | |
| dnd-CPDCoWpc.js | 49,501 | 16,376 | |
| **total (6 chunks)** | **4,020,856** | **1,215,177** | |

- Landing graph: −2,719,647 B raw (−40.3 %), −781,501 B gz (−39.1 %).
- Full set now lazy: `mdi-BoEGjmzW.js` 2,889,665 B raw / 818,656 B gz (CJS form, slightly larger than the old ESM chunk), fetched only on first key resolution.
- `index` grew +61,301 B raw / +22,578 B gz (named icons tree-shaken into it; design estimated ~4.6 KB gz). Still under the 900 KB gz cap (773,870 B).
- Build log: zero `dynamic import will not move module` lines naming `@mdi/js`.

## 3.5 Interop

- Dev (`vite` dev server, optimizer pre-bundles `@mdi/js/commonjs/mdi.js`): real Chromium `loadMdiIconSet()` → set loaded, `mdiRefresh` resolves, unknown key → `null`. No D1 fallback needed.
- `examples/chat-embed-tester` has no build script (Vite dev consumer only) — covered by the dev check.

## Implementation notes / deviations

- 2.2: the build-log guard already existed in `.github/workflows/ci.yml` ("Build (fail on regressed warnings)", greps `dynamic import will not move module` + `@mdi/js`); re-attributed its error message to this change. Verified locally: 0 matching lines before and after.
- 2.3: test file is `mdi-by-key.test.tsx` (JSX for the hook probes), not `.test.ts`.
- 6.2: the keepalive interval runs only while `wss.clients` is non-empty (started on the first upgraded connection, stopped when the last closes) and is ALSO cleared on `wss` close. Avoids an idle timer and keeps the existing fake-timer-count assertions in `browser-gateway-{critical-frames,handler-errors,host-pressure-reconcile}.test.ts` exact.
- 4.2: no built-in surface emits a key-resolved icon, so F2 drives a new `e2e_footer_segment` tool in `qa/fixtures/e2e-custom.ext.ts` via the `footer-icon` faux scenario.
- Close line prints `code=none` when `ws` emits `close` without a code (test fakes only; real `ws` always passes one).

## 8.5 Review

- `review-code` via isolated `@review` subagent (`anthropic/claude-opus-5-5` — same family as the author role; user-configured). Verdict APPROVE, 0 blocking. Security scope covered: no ticket/cookie/forwarding-header values in `[ws-upgrade]` lines, `extractTicket` read-only (E18 proves unconsumed), rate-limit state bounded (prune expired → evict oldest), `remoteAddress`/`scope` not header-derived (no log injection today).
- Applied: skip icon-set fetch for keys without `mdi` prefix; generation-guard `__resetMdiIconSetForTests` (in-flight import could repopulate after reset); E6 asserts nothing-before-load + reset shares instance.
- Accepted/noted: an icon already mounted when the import failed stays blank until remount (design X1 "retry on next mount"); `[ws-upgrade]` peer not passed through `sanitizeHeaderForLog` (kernel-sourced address).
- 8.6 manual iPhone QA (test-plan #F3, manual-only) deferred to post-merge.
