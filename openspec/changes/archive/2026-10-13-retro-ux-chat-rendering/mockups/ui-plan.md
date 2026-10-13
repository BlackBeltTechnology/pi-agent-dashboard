# UI plan — retro-ux-chat-rendering

Mode: **preserve** (`anti-slop-redesign`). Profile: `product-ui`. Contract: root `ui-contract.md`. Method: `retro-ux-identity-connectivity` design D1–D5.
Board: `chat-rendering.html`, with the rows shown in chat context (assistant bubble above, tool-call row below). `tokens.css` is GENERATED. `diagram-*.svg` are real mermaid renders of one sample diagram; the product themes diagrams through `mermaid-config.ts`, so diagram internals are excluded from the probe (`aria-hidden` on the board only).

## Surfaces → states

| Surface | Source | States (fixture ids) |
|---|---|---|
| Mermaid block | `client/src/components/preview/MermaidBlock.tsx` | `loading`, `repaired`, `original` (show original), `error`, `zoomed`; pending `add-mermaid-ai-repair`: `ai-offer`, `ai-pending`, `ai-fixed`, `ai-failed` |
| Web search / fetch row | `web-access-plugin/src/client/WebSearchEntryCard.tsx` | `collapsed`, `expanded` (answer, results, per-query error, no results), `fetch` (with a 404), `loading`, `evicted`, `skipped` |
| Unclaimed custom entry | `client/src/components/chat/{CustomEntryCard,FallbackKeyValueList}.tsx` | `kv`, `more` (> 50 keys), `plain` |

## Findings → rule → proposed decision

| # | Surface | As-built (cite) | Rule broken | Proposed |
|---|---|---|---|---|
| M1 | mermaid | error display `text-red-400` on `bg-red-900/20`, message run into the heading | palette ban; Nielsen #9 | severity-error callout: headline "This diagram could not be rendered.", parser message in mono, "Copy source"; source below |
| M2 | mermaid | loading text in `--text-muted`, no spinner, no `role="status"` | WCAG 1.4.3, 4.1.3 | spinner + "Rendering diagram…" in `--text-secondary`, `role="status"` |
| M3 | mermaid | badge "Auto-fixed: R5 R4" — rule ids as content, meaning only in `title` / sr-only | Nielsen #2 (match the real world); WCAG 1.4.13 | info pill "Auto-fixed" + the rule descriptions as visible text; "Show original" (`aria-pressed`) and a named copy button |
| M4 | mermaid | viewport has no `tabIndex`/`role`/name: zoom is mouse-only; zoom buttons named only by `title` (hardcoded English) | WCAG 2.1.1, 4.1.2 | viewport `tabindex=0`, `role="group"`, name "Diagram. Press Enter to zoom and pan, Escape to leave."; Escape returns focus to the viewport; zoom buttons `aria-label` (translated), 32 px, zoom readout `aria-live` |
| M5 | mermaid | focused border `border-blue-500/60`; hint overlay `bg-black/10`; readout 10 px `--text-muted` | palette ban; type floor | focus = `--focus-ring`; hint as a small pill, no scrim; readout 11 px secondary |
| M6 | mermaid (pending) | `add-mermaid-ai-repair` specifies "Fix with AI", provider disclosure, pending, AI-fixed naming the model, show-original, copy, "AI fix failed" + retry — with no mockup | no mockup for a UI change | designed here: secondary "Fix with AI" in the error callout + disclosure line naming the model; pending = disabled + spinner; AI-fixed = tint-purple pill "AI-fixed · <model>" (distinct from the rule-repair info pill); failure = message + "Retry AI fix" |
| W1 | web search | icon and links `text-cyan-400` | palette ban | neutral icon (`--text-secondary`); links `--link` underlined (as markdown links) with an external-link icon and "(opens in a new tab)" for screen readers |
| W2 | web search | per-query and fetch errors `text-[11px] text-red-400` | palette ban; type floor (state) | severity-error pill with icon |
| W3 | web search | summary, "via exa", snippets, sizes in `--text-muted` | WCAG 1.4.3; contract | `--text-secondary` |
| W4 | web search | summary hides failures ("3 queries · 2 results") | Nielsen #1 | add "· N failed" when any query or fetch failed |
| W5 | web search | evicted payload: "Details unavailable: entry evicted" in red | Nielsen #9 (it is not an error of the user's) | warning notice explaining the stored summary is shown |
| W6 | web search | "1 items could not be displayed" | grammar / i18n plural | "1 item" / "N items" (plural keys) |
| C1 | custom entry | type label and icon `text-cyan-400`; icon not `aria-hidden` | palette ban | type in `--text-primary` mono + "extension entry" meta; icon `aria-hidden` |
| X1 | web search + custom | rows at `mx-2` while tool rows sit at `mx-4` → misaligned timeline | Gestalt alignment; Nielsen #4 | rows at `mx-4` (mobile `mx-2`, like tool rows) |
| X2 | web search + custom | header 11 px time inside a button | sizeFailures interactive floor | 12 px |

## Protected (preserve)

`data-testid`s: `mermaid-repair-badge`, `mermaid-repair-rule`, `mermaid-copy-fixed`; `.mermaid-diagram`, `.mermaid-diagram > div` (viewport), `.mermaid-diagram-inner` (e2e hooks); `VIEWPORT_HEIGHT_CSS`; zoom behaviour (wheel, transform persistence); `web-search-*` (entry, toggle, header, label, summary, body, detail, query, answer, result, fetch-item, skipped, error, loading, plain-payload, fallback-body); `custom-entry-card`; link `target=_blank rel="noopener noreferrer"`; no fetch before expand; existing i18n keys.

## Verdicts

| Surface | Verdict |
|---|---|
| Mermaid block | redesign (M1–M5) + design for the pending AI states (M6) |
| Web search / fetch row | polish (W1–W6, X1, X2) |
| Unclaimed custom entry | polish (C1, X1) |
