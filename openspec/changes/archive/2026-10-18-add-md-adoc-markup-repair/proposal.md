## Why

Markdown and AsciiDoc never fail to parse — they mis-render. One unterminated fence or delimiter swallows the rest of the document into a code block; a bare `[mermaid]` block in AsciiDoc is dropped to a plain listing by the secure convert; a closer of the wrong character or length silently never closes. The preview then shows a wall of raw text and the diagrams inside it never render. These are as mechanical as the mermaid syntax slips handled by `add-mermaid-auto-repair`, and should be repaired on demand the same way: detect, fix for display, mark it, offer to persist.

A concrete bug sits in the same place: in a markdown FILE preview, a ```` ```mermaid ```` fence left unclosed at end-of-file — or a correctly closed `~~~mermaid` fence — is treated as still streaming (`isFencedBlockComplete` only looks for a trailing ```` ``` ````) and shows "Loading diagram…" forever.

## What Changes

- **Markdown markup repair (file surfaces only, never chat/streaming):**
  - M1 — in a file preview every mermaid fence is complete (EOF-unclosed or tilde-fenced): it renders (fixes the endless "Loading diagram…"). Valid CommonMark already, so nothing is reported or written.
  - M2 — in an unterminated fence, the first line made solely of ≥3 fence characters of the other character (``` vs `~~~`) or of the same character but shorter than the opener is replaced by a valid closer.
  - M3 — else, a closer is inserted before the first blank-line-preceded ATX heading.
- **AsciiDoc markup repair (server render path):**
  - A1 — bare `[mermaid]` / `[mermaid,…]` styles on `----`/`....` delimited blocks are rendered as `[source,mermaid]` so they hydrate as diagrams (today they stay listings).
  - A2 — an unterminated top-level `----`/`....` block (found by a source scan) has its first same-character different-length delimiter line replaced by the exact delimiter, else is closed before the next blank-line-preceded section title.
  - Asciidoctor's own warnings are captured and surfaced instead of discarded.
- **Honest display.** A repaired document shows a document-level banner listing each repair with its line, a "view original rendering" toggle, and "Apply markup fix to file" (diff-confirmed, conflict-safe write via the `add-preview-apply-fix-to-file` write path).
- **One repair function per format, shared by display and write:** AsciiDoc repair is a pure scanner in `packages/shared` run by the server (display) and the client (apply); markdown repair runs client-side on the same mdast parse the renderer uses, for display and apply.
- While a markup repair is displayed but not applied, per-diagram "Apply fix to file" is disabled ("apply the markup fix first") — block ordinals on disk would not match the repaired rendering.

## Capabilities

### New Capabilities
- `markup-repair`: markdown (M1–M3) and AsciiDoc (A1–A2) markup repair rules, file-surface-only scope, document repair banner, view-original, diff-confirmed apply, and the interaction rule with per-diagram apply.

### Modified Capabilities
- `file-and-url-preview`: "AsciiDoc rendering endpoint" — response carries applied repairs and captured warnings, rendering from repaired source; "Diagram source blocks in AsciiDoc preview hydrate" — bare `[mermaid]` blocks now hydrate.

## Impact

- `packages/shared/src/markup-repair/asciidoc.ts`: pure scanner `repairAsciiDoc(src)` → `{ source, repairs: {rule, line}[] }` + tests.
- `packages/client/src/lib/preview/markup-repair-md.ts`: `repairMarkdown(src)` on the `MARKDOWN_REMARK_PLUGINS` mdast parse + tests.
- `packages/server/src/routes/file-routes.ts`: `/api/file/render` runs `repairAsciiDoc`, converts the (repaired) source once with asciidoctor warnings captured via an in-memory logger, returns `{ html, repairs, warnings, mtime }` (additive fields).
- `packages/client/src/components/preview/`: `MarkdownContent` `staticSource` prop (M1 completeness override + M2/M3 pre-render repair) passed by every on-disk preview surface (incl. `MarkdownPreviewView`), `AsciiDocPreview` banner, shared `MarkupRepairBanner` (apply only with `MermaidSourceContext`); i18n EN/HU.
- Depends on `add-preview-apply-fix-to-file` (`MermaidSourceContext`, write path, diff dialog, apply availability gate) — implemented after it lands. Independent of the mermaid repair changes for display.
- Sequenced after active `sanitize-untrusted-rendered-content`, which adds server-side sanitization to `/api/file/render` AsciiDoc output — a repair can un-swallow content (e.g. a `++++` passthrough), so the sanitizer must already be in the path; repairs run on source before convert; `safe: "secure"` stays.
- Rollback: revert; response fields are additive, no persisted state.

## Discipline Skills

- `doubt-driven-review`: repairs rewrite how a user's document renders and, on apply, its bytes — review the heuristics against false positives (e.g. fences legitimately documenting fences) before they stand.
- `security-hardening`: the AsciiDoc repair rewrites source before a `safe: "secure"` convert — confirm A1/A2 cannot introduce passthrough, includes or attributes that the secure convert would otherwise not see.
- `review-code`: before commit.
