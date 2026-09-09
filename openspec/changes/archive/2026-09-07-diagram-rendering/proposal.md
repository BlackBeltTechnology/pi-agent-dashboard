## Why

The dashboard renders mermaid diagrams client-side (theme-aware, cached, zoomable `MermaidBlock`) but PlantUML — dominant in architecture-heavy AsciiDoc repos — has no rendering path: `.puml` files fall through to the unknown-extension preview, and diagram source blocks inside rendered AsciiDoc stay inert code listings. A Kroki proof-of-concept validated the whole pipeline: deflate+base64url URL encoding produced a correct SVG from a real component diagram, both against `kroki.io` and a locally run `yuzutech/kroki` container (byte-identical output, sub-second, zero egress — measured locally during the PoC; not reproducible from the repo).

## What Changes

- **Server-side diagram render proxy**: a new endpoint renders PlantUML (and other Kroki-supported text-to-diagram formats) by encoding the source and fetching SVG from a configured Kroki instance, with server-side caching and SVG sanitization. The browser never talks to Kroki — no CSP changes, works air-gapped with a local Kroki, offline reloads hit the cache.
- **Resolution ladder for the Kroki endpoint**: configured URL (self-hosted/local) → if unset and remote rendering explicitly opted in, `https://kroki.io` → otherwise the proxy declines and clients degrade to syntax-highlighted source. Diagram source is user content; it never leaves the machine unless the user opted in or pointed at their own instance.
- **`.puml`/`.plantuml` file preview**: new renderer kind dispatching to a diagram preview component that fetches SVG from the proxy and mounts it in the existing zoom-pan viewport, degrading to highlighted source when the proxy declines or fails.
- **Diagram blocks in AsciiDoc preview hydrate — `[source,<lang>]` syntax only**: asciidoctor's `safe:"secure"` embedded convert DROPS the style of bare `[mermaid]`/`[plantuml]` blocks (verified against the installed asciidoctor 3.0.4 — they emit plain `listingblock` HTML indistinguishable from any code listing), so hydration keys on the surviving `data-lang`/`language-*` attributes of `[source,mermaid]`/`[source,plantuml]` blocks: mermaid hydrates client-side with the existing `MermaidBlock` (no server round-trip), plantuml through the proxy. Additionally, listing blocks whose content starts with `@startuml` are sniffed as plantuml (concrete sentinel; mermaid has no equivalent, so bare `[mermaid]` blocks stay listings — documented guidance: use `[source,mermaid]`). Failed or declined hydration leaves the original code listing visible.
- **Optional Kroki service in the docker stack**: `yuzutech/kroki` via an opt-in compose overlay file (multi-GB image, hence opt-in). The dashboard server reads the Kroki endpoint from a live env override (not only the first-run-seeded config — seeding is first-run-only and would miss containers created before Kroki was enabled), defaulting to the in-compose service hostname while the overlay is applied.

## Capabilities

### New Capabilities

- `diagram-render-proxy`: server-side text-to-diagram rendering — Kroki URL resolution ladder, deflate+base64url encoding, SVG fetch, sanitization, response caching, decline semantics when no endpoint is permitted.
- `plantuml-file-preview`: `.puml`/`.plantuml` file preview — proxy-rendered SVG in the zoom-pan viewport, source-view fallback.

### Modified Capabilities

- `file-and-url-preview`: renderer dispatch table gains `.puml`/`.plantuml` → diagram renderer kind. New requirement: diagram source blocks in the AsciiDoc preview render as diagrams (`[source,mermaid]` client-side, `[source,plantuml]`/`@startuml`-sniffed via proxy) with visible-source fallback.
- `mermaid-diagram`: new requirement — `MermaidBlock` hydrates mermaid source blocks inside the AsciiDoc preview, extending its trigger context beyond markdown fenced code blocks.
- `shared-config`: config schema gains Kroki fields (endpoint URL, remote-rendering opt-in).
- `docker-packaging`: REWRITES the existing "compose.yml SHALL define a single service" requirement to "a single default service plus optional overlay-gated services"; adds the Kroki overlay service reachable by the dashboard server on the compose network.

## Impact

- `packages/server/src/routes/`: new diagram render route (encoding is ~3 lines of zlib + base64url; no Java, no local PlantUML execution); server-side cache; SVG sanitize via existing DOMPurify infrastructure.
- `packages/shared/src/renderer-by-ext.ts`: the extension→kind table lives HERE (shared with the server-side canvas detector), not in `preview-dispatch.ts` — adding `.puml` ripples into canvas detection and file-icon lookup; plus config type additions.
- `packages/client/src/`: new diagram preview component; AsciiDoc preview hydration hook; reuses `MermaidBlock` and the zoom-pan viewer.
- `docker/`: Kroki compose overlay file + docs.
- No new npm dependencies (zlib is Node-builtin; no `asciidoctor-kroki` — hydration happens client-side against the sanitized rendered HTML, keeping the `safe:"secure"` server convert untouched).
- Prior art, unaffected: `packages/document-converter/engine/` renders PlantUML in its python docx-export pipeline — separate concern, not reused (different runtime, different output target).
- Depends on `asciidoc-support` for the styled AsciiDoc preview it hydrates into (block hydration works against that change's `.asciidoc-body` output). `.puml` preview and the proxy are independent of it.
- Coordination with the active `sanitize-untrusted-rendered-content` change (sequencing, not overlap): (a) it reworks `MermaidBlock`'s SVG sanitizer — this change reuses whatever lands; (b) its server-side DOMPurify pass on `/api/file/render` MUST preserve the `class`/`data-lang` attributes hydration keys on; (c) proxy-returned SVG entering `dangerouslySetInnerHTML` follows that change's sanitization capability — this change's proxy sanitizes accordingly.

## Discipline Skills

- `security-hardening`: the proxy fetches remote content derived from untrusted diagram source. SSRF surfaces: the Kroki URL must come from config/env only, never from the request; AND Kroki itself is a pivot — PlantUML `!include`/`!includeurl` directives make the Kroki instance fetch attacker-chosen URLs (docker-network services, cloud metadata), so the compose service must run with Kroki's safe/include-restricted mode. Returned SVG is sanitized before `dangerouslySetInnerHTML`.
- `observability-instrumentation`: new external call (Kroki fetch) needs failure/latency visibility and cache-hit logging.
- `review-code`: standard pre-commit review.
- `performance-optimization` not triggered: no stated latency budget; caching is a correctness/offline feature, not a measured-regression fix.
