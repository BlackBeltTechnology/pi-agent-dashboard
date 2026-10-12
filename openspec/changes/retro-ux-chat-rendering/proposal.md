## Why

Two PRs shipped chat-rendering UI without a mockup: #847 (`add-mermaid-auto-repair`: `MermaidBlock` with an "auto-fixed" badge) and #868 (`render-unclaimed-custom-entries`: a new `WebSearchEntryCard` plus a generic key/value fallback for unclaimed custom entries). Both break the contract on error text. `MermaidBlock.tsx:299` uses `text-red-400 bg-red-900/20`, and `WebSearchEntryCard.tsx:96,144,194` use `text-red-400`, where `ui-contract.md:60,88` requires `--severity-error-*`. These rows sit in the chat stream, so they have to read well next to the existing chat cards. This is the third of four retro UX reviews.

## What Changes

- Mockup loop on develop, before the worktree (method: `retro-ux-identity-connectivity` design D1–D5). One board shows the chat rows in context (between an assistant message and a tool card), as-built replica and proposed version, in every state.
- Mermaid states: rendered; auto-repaired (badge); unrepairable (error display); and, once `add-mermaid-ai-repair` lands, the "Fix with AI" action in the error display and its busy, failed and applied outcomes. The badge and the error display are designed together on one board.
- Web-search and custom-entry states: collapsed; expanded; per-query error; per-fetch error; payload unavailable; very long results; and the fallback for an object, a string and an oversized body.
- Contract conformance: error text uses the `--severity-error-*` callout (`ui-contract.md:170`); no palette classes. `MermaidBlock`'s `FALLBACK_ACCENTS` hex list (`:104`) and the `#e5e7eb`/`#111827` text fallback (`:203`) are reviewed: mermaid needs concrete colours, so the audit decides whether they stay as documented fallbacks or are resolved from tokens.
- Protected: existing `data-testid`s (`WebSearchEntryCard` 16, `MermaidBlock` 2, `CustomEntryCard` 1) and the claim/fallback routing of custom entries.

- Mockup: `mockups/chat-rendering.html` (in this change). Approved 2026-10-12, all 8 decisions plus design D2 option A; record in `mockups/audit.md`.
- Approved deltas: mermaid error as an error-severity callout with "Copy source" and a `role="status"` loading spinner; repair badge as an "Auto-fixed" info pill plus visible rule descriptions (rule codes move to `data-rule`); keyboard zoom (focusable viewport, Enter/Escape, `--focus-ring`) and named 32 px zoom buttons in the shared `ZoomControls`; the AI states for `add-mermaid-ai-repair`, which adopts this board; web search with a neutral icon, underlined `--link` links with an external-link icon, error pills, "· N failed" in the summary, the evicted payload as a warning notice, and the plural fix; the custom-entry fallback with a neutral type label and "extension entry" meta; web-search and custom rows aligned with the tool timeline; baseline palette classes and `--text-muted` information text moved to tokens, with 12 px text inside buttons and links.

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `mermaid-rule-repair`: MODIFIED "Repaired diagrams are visibly marked" (rule descriptions become the visible content; codes move to `data-rule`) and "Unrepairable diagrams keep the error display" (inside the callout).
- `mermaid-diagram`: MODIFIED "Mermaid diagram rendering" (status loading placeholder, error-severity callout with "Copy source"); ADDED "Accent fallback literals are test-only" (design D2 option A).
- `zoomable-mermaid`: MODIFIED "Click-to-activate focus model" (keyboard activation, `--focus-ring`, new hint text) and "Zoom control buttons" (shown on keyboard activation too).
- `zoom-pan`: MODIFIED "On-surface control buttons" (names, 44/32 px targets, readout). This affects every `ZoomControls` host.
- `web-search-entry-rendering`: MODIFIED collapsed summary ("· N failed"); ADDED UI-contract conformance in every state. The "1 item" plural is already required by the base scenario "malformed items are counted, not invented"; the code and `WebSearchEntryCard.test.tsx:186` are fixed to match it, with no delta.
- `custom-entry-rendering`: MODIFIED "Custom rows SHALL render as a bounded generic fallback" (neutral label plus "extension entry" meta); ADDED tool-timeline alignment and probes.

## Impact

- Client: `packages/client/src/components/preview/MermaidBlock.tsx`, `packages/client-utils/src/ZoomControls.tsx` (shared with `DiagramPreview`, `FlowGraph`, team-app), `packages/client/src/lib/theme/themes.ts` (guard test only), `packages/client/src/components/chat/{CustomEntryCard,FallbackKeyValueList}.tsx`, `packages/web-access-plugin/src/client/WebSearchEntryCard.tsx`.
- Tests: fixtures `tests/e2e/fixtures/retro-ux/{mermaid,web-search,custom-entry}.ts` and `tests/e2e/retro-ux-chat-rendering.spec.ts` on the shared harness.
- Dependencies: `retro-ux-identity-connectivity` task 2.1 (harness). Implementation is blocked until `tests/e2e/helpers/ui-capture.ts` is on the base branch (task 0.1 stops with `SHIP_IT_BLOCKED.md` otherwise). `add-mermaid-ai-repair` (active, group `fix-mermaid`) adds the "Fix with AI" action to the same error display. The AI states are designed on this board, and `add-mermaid-ai-repair` adopts it as its mockup (its task 0.2).
- Rollback: a revert.

## Non-goals

- Changing repair rules, the AI repair endpoint, or web-search payload fetching.
- Other chat cards (tool calls, ask_user).

## Discipline Skills

- `review-code`: before commit.
- `doubt-driven-review`: run during planning. The mermaid hex-fallback decision (D2) was settled by measurement, not opinion.
- No `performance-optimization`. The rows render the same data; the mockup must not add a fetch before the row is expanded (`custom-entry-rendering`: "Claimed renderers SHALL NOT fetch payloads until expanded").
