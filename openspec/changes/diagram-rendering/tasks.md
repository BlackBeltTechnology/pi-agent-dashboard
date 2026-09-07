# Tasks

## 1. Diagram render proxy (packages/server, packages/shared)

- [ ] 1.1 Add `kroki` config fields (`url`, `allowRemote`) to shared config schema + `loadConfig` field whitelist; implement the resolution ladder with live `KROKI_URL` env read (design D5).
- [ ] 1.2 Implement the render route: plantuml-only whitelist, 512 KB source cap, deflate+base64url encoding, upstream GET with 10 s abort + concurrency cap, DOMPurify SVG-profile sanitize, bounded in-memory LRU cache keyed type+source-hash+endpoint (design D3/D4); log upstream failures with latency (observability).
- [ ] 1.3 Test: resolution ladder decision table (test-plan #E1) — see packages/server/src/__tests__/file-raw-render-endpoints.test.ts. 8 combos of env × config url × allowRemote · resolve · env > config > opt-in kroki.io > decline.
- [ ] 1.4 Test: request cannot choose endpoint (test-plan #E2) — see packages/server/src/__tests__/file-raw-render-endpoints.test.ts. Request with url-like params · render · endpoint unaffected.
- [ ] 1.5 Test: happy path renders sanitized SVG via mock upstream (test-plan #E3) — see packages/server/src/__tests__/file-raw-render-endpoints.test.ts. Valid plantuml, mock Kroki SVG with script+onclick · render · 200, script/handlers stripped, correct encoded GET path.
- [ ] 1.6 Test: type whitelist rejection (test-plan #E4) — see packages/server/src/__tests__/file-raw-render-endpoints.test.ts. Types `graphviz`, `garbage` · render · 400, zero upstream calls.
- [ ] 1.7 Test: source size cap boundary (test-plan #E5) — see packages/server/src/__tests__/file-raw-render-endpoints.test.ts. Source at cap and cap+1 · render · at-cap ok, over-cap rejected pre-upstream.
- [ ] 1.8 Test: cache hit and one-byte miss (test-plan #E6) — see packages/server/src/__tests__/file-raw-render-endpoints.test.ts. Same source twice, then mutated · render ×3 · hit skips upstream, change refetches.
- [ ] 1.9 Test: cache key includes endpoint (test-plan #E7) — see packages/server/src/__tests__/file-raw-render-endpoints.test.ts. Same source, switched endpoint · render ×2 · no cross-endpoint cache bleed.
- [ ] 1.10 Test: upstream 500/refused degrades distinctly (test-plan #X1) — see packages/server/src/__tests__/file-raw-render-endpoints.test.ts. Mock upstream fails · render · distinct upstream-failure error, latency logged, cache clean.
- [ ] 1.11 Test: hung upstream aborts within timeout (test-plan #X2) — see packages/server/src/__tests__/file-raw-render-endpoints.test.ts. Socket accepted, never answered · render · upstream-failure within abort timeout, no hang.
- [ ] 1.12 Test: kroki config fields load (test-plan #E9) — see packages/shared/src/__tests__/binary-lookup.test.ts (nearest shared vitest exemplar; config tests live beside it). Config with/without `kroki` · loadConfig · url present / undefined+false defaults.
- [ ] 1.13 Test: kroki block survives save round-trip (test-plan #E10) — see packages/shared/src/__tests__/binary-lookup.test.ts. Load config with `kroki`, save · write · block not wiped by whitelist rebuild.

## 2. Client preview (packages/client, packages/shared)

- [ ] 2.1 Add `"diagram"` kind: `.puml`/`.plantuml` rows in `packages/shared/src/renderer-by-ext.ts`, `NON_FALLBACK_KINDS` entry (canvas eligibility + settings row, design D7); new diagram preview component fetching the proxy, mounted in the zoom-pan viewport, plain-source fallback on decline/failure.
- [ ] 2.2 Implement adoc hydration: pure segment splitter over sanitized render HTML (`data-lang` → `class="language-*"` fallback → `@startuml` sniff) + interleaved rendering, mermaid segments to `MermaidBlock`, plantuml segments to the proxy component (design D2).
- [ ] 2.3 Test: dispatch maps puml extensions to diagram (test-plan #E8) — see packages/client/src/lib/__tests__/preview-dispatch.test.ts. `x.puml`/`X.PUML`/`y.plantuml` · dispatchPreview · `"diagram"`; `.dat` stays `"fallback"`; canvas kinds include `"diagram"`.
- [ ] 2.4 Test: segment splitter classification (test-plan #E11) — see packages/client/src/lib/__tests__/preview-dispatch.test.ts (pure-lib exemplar). Mixed HTML with mermaid/plantuml/`@startuml`/bare/prose · split · exactly 3 typed diagram segments, rest raw.
- [ ] 2.5 Test: bare style block yields no segment (test-plan #E12) — see packages/client/src/lib/__tests__/preview-dispatch.test.ts. Bare `[mermaid]` render HTML · split · zero diagram segments.
- [ ] 2.6 Test: class-attribute fallback detection (test-plan #E13) — see packages/client/src/lib/__tests__/preview-dispatch.test.ts. `class="language-plantuml"`, no data-lang · split · plantuml segment detected.
- [ ] 2.7 Test: adoc-sourced mermaid parity (test-plan #E14) — see packages/client/src/components/preview/__tests__/DocxPreview.test.tsx (component exemplar). Same source via fence path and adoc segment · render both · same MermaidBlock props/cache key.
- [ ] 2.8 Test: invalid adoc mermaid degrades to raw+error (test-plan #F5) — see packages/client/src/components/preview/__tests__/DocxPreview.test.tsx. Invalid mermaid segment · render · raw code + error message.

## 3. E2E (tests/e2e)

- [ ] 3.1 E2E: `.puml` renders via stubbed proxy upstream (test-plan #F1) — see tests/e2e/eml-preview.spec.ts. Seeded `.puml`, harness `KROKI_URL` → stub SVG server · open preview · loading then SVG in zoom-pan viewport.
- [ ] 3.2 E2E: `.puml` decline shows source + notice (test-plan #F2) — see tests/e2e/eml-preview.spec.ts. No KROKI_URL, no allowRemote · open preview · source text + "not configured" notice.
- [ ] 3.3 E2E: adoc `[source,mermaid]` hydrates client-side (test-plan #F3) — see tests/e2e/eml-preview.spec.ts. Seeded `.adoc` with mermaid block · open preview · SVG replaces listing, zero proxy requests.
- [ ] 3.4 E2E: declined plantuml block keeps listing (test-plan #F4) — see tests/e2e/eml-preview.spec.ts. Seeded `.adoc` with `[source,plantuml]`, proxy declines · open preview · original listing visible.
- [ ] 3.5 E2E: dead upstream falls back to source (test-plan #X3) — see tests/e2e/eml-preview.spec.ts. KROKI_URL → dead port · open `.puml` · source + transient error notice.

## 4. Docker overlay (docker/)

- [ ] 4.1 Add `compose.kroki.yml` overlay: `yuzutech/kroki` service (`KROKI_SAFE_MODE=secure`, no published ports) + `KROKI_URL=http://kroki:8000` on pi-dashboard (design D6); document in docker/README.
- [ ] 4.2 Test: default compose has no kroki wiring (test-plan #D1) — see qa/tests/02-server-start.sh. `docker compose -f compose.yml config` · parse · no kroki service, no KROKI_URL.
- [ ] 4.3 Test: overlay wires both sides atomically (test-plan #D2) — see qa/tests/02-server-start.sh. Overlay config output · parse · kroki service with safe mode + no ports; pi-dashboard has KROKI_URL.

## 5. Manual verification

- [ ] 5.1 Live Kroki round-trip with the overlay stack: render a real `.puml`, verify `!includeurl` is refused by safe mode (test-plan: manual-only, #D3).
- [ ] 5.2 Review rendered diagram fidelity and themed viewport on a real architecture diagram (test-plan: manual-only, #F6).
