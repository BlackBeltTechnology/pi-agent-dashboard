## Context

See proposal.md — Why. Facts that shape the approach:

- Asciidoctor 3.0.4 `safe:"secure"` embedded convert drops bare `[mermaid]`/`[plantuml]` style names; only `[source,<lang>]` blocks emit `<code class="language-<lang>" data-lang="<lang>">` (verified with a live convert against the installed package).
- `MermaidBlock` (client) is theme-aware, cached, zoomable — and its SVG sanitizer is being reworked (regex → DOMPurify SVG profile) by the active `sanitize-untrusted-rendered-content` change; that change also adds server-side DOMPurify to `/api/file/render`.
- The extension→kind table is `packages/shared/src/renderer-by-ext.ts`, shared by client preview dispatch and the server-side canvas detector.
- Kroki renders via pure URL encoding (`deflate(source)` → base64url → GET `<kroki>/<type>/svg/<payload>`) — no Java, no local execution; PoC verified against kroki.io and a local `yuzutech/kroki` container with identical output.
- Docker env→config seeding is first-run-only (UI edits win); config persists in the `pi-state` volume.

## Goals / Non-Goals

**Goals:**
- Local-first PlantUML rendering with zero browser↔Kroki contact, remote as explicit opt-in, source view as universal floor.
- Reuse: `MermaidBlock` for mermaid, zoom-pan viewport for SVG, existing DOMPurify infra for sanitization.

**Non-Goals:**
- Bundling Kroki/PlantUML into the base docker image (multi-GB).
- Rendering bare `[mermaid]`-style adoc blocks (type info destroyed by the secure convert — documented limitation).
- Non-SVG output formats (PNG/PDF), diagram editing, or the document-converter python PlantUML leg (separate pipeline, untouched).
- CSP changes: the proxy keeps all diagram traffic same-origin.

## Decisions

**D1 — Server proxy, not browser-direct Kroki URLs.**
Alternative: `asciidoctor-kroki` extension emitting `<img src="https://kroki…">` — rejected: adds a dependency, leaks diagram source in browser-visible URLs to a third party by default, requires CSP `img-src` widening, breaks offline reload. The proxy keeps origin clean, caches, and centralizes the egress policy.

**D2 — Client-side hydration for adoc blocks, not server-side convert extension.**
The server convert stays untouched (`safe:"secure"`, no extensions). Hydration does NOT mutate the `dangerouslySetInnerHTML` subtree (React would clobber replacements on the next `setHtml`): instead the client splits the sanitized HTML into segments at diagram blocks (`data-lang="mermaid"|"plantuml"` code elements, falling back to `class="language-*"`, plus `@startuml`-prefixed listing blocks) and renders an interleaved sequence of raw-HTML segments and diagram components — the same architecture `MarkdownContent` uses for mermaid fences. Alternative: register an asciidoctor block processor server-side — rejected: mutates the hardened convert path, duplicates what the client already does for markdown mermaid, and couples the render route to diagram availability. Constraint on the sanitize change: its DOMPurify pass must keep `class`/`data-lang` (DOMPurify defaults keep both; its docx config only forbids `script`/`style` tags).

**D3 — Proxy endpoint shape: POST with source in body, type in path/param; SVG response sanitized server-side.**
GET-with-encoded-payload (Kroki's native shape) hits URL-length limits on large diagrams and puts source in access logs. The server does the deflate+base64url encoding upstream. Sanitization uses the existing `isomorphic-dompurify` with an SVG profile (scripts/event handlers/foreignObject stripped; `xlink:href` restricted to fragment/https), applied before caching so the cache stores only sanitized bytes. **Bounds:** request source capped (512 KB pre-deflate), upstream fetch on a 10 s abort timeout, and a small in-flight concurrency cap — a hung endpoint resolves to the upstream-failure response, never a stuck loading state. **Type whitelist v1: `plantuml` only** — mermaid renders client-side and other Kroki formats are a later widening of the whitelist, not new architecture.

**D4 — Cache: in-memory LRU keyed `sha256(type + "\0" + source + "\0" + endpoint)`, bounded (e.g. 100 entries / ~20 MB), no disk persistence.**
Alternative: disk cache like the docx→PDF path — deferred; diagrams are cheap to re-render and the render route already degrades to source view. Endpoint in the key prevents serving kroki.io output after switching to a local instance (or vice versa).

**D5 — Resolution ladder implemented in shared config + env override read per-request.**
`KROKI_URL` env (live, wins over config when both set) → `config.kroki.url` → (`config.kroki.allowRemote` ? `https://kroki.io` : decline). Alternative: config-only — rejected; docker env→config seeding is first-run-only, so containers created before enabling Kroki would need config surgery. Note for implementation: `loadConfig` rebuilds config field-by-field, so the `kroki` block must be added to its whitelist or any settings save wipes it from disk.

**D6 — Compose overlay file `compose.kroki.yml`, not a bare profile.**
Compose profiles gate *services* but cannot set env vars on another service — a profile alone could either leave `KROKI_URL` unset (kroki runs, dashboard never uses it) or leave it dangling (`http://kroki:8000` configured with no service — every render pays a conn-refused). An overlay file (`docker compose -f compose.yml -f compose.kroki.yml up`, same precedent as the existing dev-mode overlay) adds the `yuzutech/kroki` service AND sets `KROKI_URL=http://kroki:8000` on `pi-dashboard` atomically — both sides wired or neither. Kroki runs with `KROKI_SAFE_MODE=secure` (blocks `!include` URL fetching — the SSRF pivot) and no published host ports (compose-network only); native-host dashboards point `KROKI_URL=http://localhost:<port>` at their own container per documentation.

**D7 — `"diagram"` renderer kind in the shared table; canvas eligibility is an explicit decision.**
`.puml`/`.plantuml` map to `"diagram"` in `renderer-by-ext.ts`; the preview component fetches from the proxy and mounts the SVG in the shared zoom-pan viewport; decline/failure renders the source text (plain, via the existing raw route) with a notice. Alternative: reuse `"image"` kind — rejected; the component needs proxy fetch + fallback, not a raw URL. Canvas is NOT free: `NON_FALLBACK_KINDS` is a hand-maintained literal feeding `DEFAULT_CANVAS_TYPES` — `"diagram"` IS added (a written `.puml` auto-canvases like other previewable kinds, gaining a `CanvasTypesSettings` row users can toggle off); the proxy fetch happens only when the canvas actually displays the file, and remote egress remains gated by the D5 ladder.

## Risks / Trade-offs

- [Kroki image size discourages the profile] → opt-in profile + documented remote/off ladder; the feature degrades to source view, never blocks.
- [`@startuml` sniffing false positives] → the sentinel only matches listing blocks whose first non-blank line starts with `@startuml`; a code sample about PlantUML inside a `[source,text]` block would render as a diagram — accepted, cosmetic, and the original text remains one failure away (invalid source → source view).
- [Sanitize-change lands after this one] → hydration reads attributes DOMPurify keeps by default; if its final config strips `data-lang`, hydration falls back to `class="language-*"`; if both are stripped, blocks stay listings (graceful).
- [kroki.io availability/privacy when opted in] → opt-in is explicit and off by default; failures degrade to source view; no retry storm (single fetch, cache).
- [In-memory cache lost on restart] → acceptable; re-render is one upstream GET; offline-after-restart shows source view until the endpoint is reachable.
- [Auto-canvas of `.puml` adds proxy traffic] → fetch only on display, cache absorbs repeats, settings toggle opts out per-type.

## Migration Plan

Purely additive: new route, new config fields (absent = feature declines), new compose profile (not started by default). No data migration. Rollback = revert; cached entries are in-memory only.

## Open Questions

None.
