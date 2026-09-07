# Test Plan — diagram-rendering

Stage: design   Generated: 2026-09-07

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | diagram-render-proxy / resolution ladder | decision-table (url × allowRemote × env) | L1 | automated | all 8 combinations of {KROKI_URL env set/unset} × {config kroki.url set/unset} × {allowRemote true/false} | resolve endpoint | env wins when set; config next; kroki.io only when allowRemote and nothing configured; decline otherwise |
| E2 | diagram-render-proxy / request cannot choose endpoint | negative EP | L1 | automated | render request carrying `url`/`endpoint`-like params | render | resolved endpoint unchanged; request params have no effect |
| E3 | diagram-render-proxy / endpoint | EP (happy path, mocked upstream) | L1 | automated | valid PlantUML source, type `plantuml`, mock Kroki returning SVG with `<script>` + `onclick` | render | 200 SVG; script and event handlers stripped; GET path is `/plantuml/svg/<base64url(deflate(source))>` |
| E4 | diagram-render-proxy / type whitelist | EP (invalid class) | L1 | automated | type `graphviz` (Kroki-valid, not whitelisted) and type `garbage` | render | 400 rejection; zero upstream requests |
| E5 | diagram-render-proxy / bounds | BVA (size cap) | L1 | automated | source at cap and cap+1 bytes | render | at-cap accepted; over-cap rejected before encoding/upstream |
| E6 | diagram-render-proxy / cache | EP (hit/miss) | L1 | automated | same source rendered twice; then one byte changed | render ×3 | second call: no upstream request; changed source: fresh upstream fetch |
| E7 | diagram-render-proxy / cache key includes endpoint | EP | L1 | automated | same source, endpoint switched between renders | render ×2 | second render misses cache (no cross-endpoint bleed) |
| E8 | file-and-url-preview / dispatch | EP + case | L1 | automated | `x.puml`, `X.PUML`, `y.plantuml` | `dispatchPreview` | all return `"diagram"`; `.dat` still `"fallback"`; canvas kinds include `"diagram"` |
| E9 | shared-config / kroki fields | EP (present/absent) | L1 | automated | config with `{kroki:{url}}`; config without `kroki` | `loadConfig()` | url returned; absent → url undefined, allowRemote false |
| E10 | shared-config / save round-trip | regression (whitelist hazard) | L1 | automated | load config containing `kroki` block, save it back | write | `kroki` block survives the round-trip (not wiped by field-whitelist rebuild) |
| E11 | file-and-url-preview / hydration segmentation | EP (pure segment split) | L1 | automated | sanitized adoc HTML containing `[source,mermaid]` code, `[source,plantuml]` code, `@startuml` listing, bare listing, plain prose | segment splitter runs | exactly 3 diagram segments with correct types + interleaved raw-HTML segments; bare listing and prose stay in raw segments |
| E12 | file-and-url-preview / bare style block stays listing | negative EP | L1 | automated | rendered HTML of a bare `[mermaid]` block (no data-lang, no class) | segment splitter | zero diagram segments |
| E13 | file-and-url-preview / class fallback | EP | L1 | automated | code element with `class="language-plantuml"` but no `data-lang` | segment splitter | detected as plantuml segment |
| E14 | mermaid-diagram / adoc-sourced parity | EP | L1 | automated | identical mermaid source via markdown fence path and adoc segment path | render both | same MermaidBlock component mounted with same props/cache key |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | plantuml-file-preview / renders via proxy | state-transition (loading→rendered) | L3 | automated | seeded `.puml` file; harness env `KROKI_URL` pointed at a stub server returning fixed SVG | open preview | loading state appears, then SVG mounted in zoom-pan viewport |
| F2 | plantuml-file-preview / source fallback on decline | state-transition | L3 | automated | seeded `.puml`; no KROKI_URL, no allowRemote | open preview | source text visible with "rendering not configured" notice; no broken image, no empty pane |
| F3 | file-and-url-preview / adoc mermaid hydrates | computed render | L3 | automated | seeded `.adoc` with a `[source,mermaid]` block | open preview | SVG rendered in place of the code listing; no request to the diagram proxy |
| F4 | file-and-url-preview / declined plantuml leaves listing | state-transition | L3 | automated | seeded `.adoc` with `[source,plantuml]`; proxy declines | open preview | original code listing remains visible |
| F5 | mermaid-diagram / invalid adoc mermaid degrades | error render | L1 | automated | adoc segment with invalid mermaid syntax | render component | raw code text + error message (markdown-parity behavior) |
| F6 | plantuml-file-preview / rendered diagram fidelity | visual/subjective | — | manual-only | real `.puml` architecture diagram | human views rendered preview | [judgment: diagram legible, themed viewport looks right — no automatable observable] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | diagram-render-proxy / upstream failure | fault-injection (abort) | L1 | automated | mock Kroki returns 500 / connection refused | render | distinct upstream-failure error; failure logged with latency; no cache pollution |
| X2 | diagram-render-proxy / hung upstream | fault-injection (delay) | L1 | automated | mock Kroki accepts socket, never responds | render | upstream-failure response within the abort timeout; no indefinite hang |
| X3 | plantuml-file-preview / upstream failure fallback | fault-injection | L3 | automated | harness KROKI_URL points at a dead port | open `.puml` preview | source text displayed with transient error notice |

### Performance

None — no latency/throughput thresholds in the delta specs; the abort timeout (X2) is the only time-bound behavior and is tested as error handling.

### Docker (overlay)

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| D1 | docker-packaging / default has no kroki | config assertion | L2 | automated | `docker compose -f compose.yml config` (no overlay) | parse output | no kroki service; no `KROKI_URL` on pi-dashboard |
| D2 | docker-packaging / overlay wires both sides | config assertion | L2 | automated | `docker compose -f compose.yml -f compose.kroki.yml config` | parse output | kroki service present with `KROKI_SAFE_MODE=secure`, no published ports; pi-dashboard has `KROKI_URL=http://kroki:8000` |
| D3 | docker-packaging / live kroki round-trip + include restriction | live smoke | — | manual-only | overlay-started stack (multi-GB image pull — not CI-viable) | render a real diagram; submit an `!includeurl` diagram | [judgment: SVG returned; include fetch refused — deferred to manual post-merge verification] |

---

## Coverage summary

- Requirements covered: 10/10 delta requirements across the six capability deltas
- Scenarios by class: edge 14 · perf 0 · frontend 6 · error 3 · docker 3
- Scenarios by level: L1 18 · L2 2 · L3 4 · manual 2
- Scenarios by disposition: automated 24 · manual-only 2

## New infra needed

None — L1 proxy tests use an in-process mock HTTP upstream (same pattern as existing server route tests); L2 rows are `docker compose config` parsing (no image pull, fits `qa/tests/*.sh`); L3 rows extend the Playwright harness with a stub Kroki via env, following existing harness env-injection patterns.
