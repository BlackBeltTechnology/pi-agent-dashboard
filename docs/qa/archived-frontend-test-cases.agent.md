# archived-frontend-test-cases — index

Historic Playwright test-case inventory. Generated 2026-07-04 from 431 archived frontend-touching OpenSpec changes (`openspec/changes/archive/*`) via gemma-4-31b-it workers.

## Nature
- HISTORIC/archaeology, not a spec. Companion: `distilled-current-test-cases.md` (code-verified current cases).
- Do NOT author Playwright specs from High/Medium entries without confirming surface exists in live client.

## Sections
- Historical Drift Warning: each entry rated Drift risk High/Medium/Low.
- Scope & Method: 431 of 574 archived changes frontend-touching. Filter refs `src/client/`, `packages/web/`, `.tsx`, React hooks, named components. Excluded pure server/infra.
- Summary Stats table: 431 frontend changes, 1811 Playwright-candidate cases, Drift High 34 / Medium 188 / Low 209, 41 no-browser-UI.

## Entry schema (one per archived change, date-named header)
- `### <date>-<change-slug>` header.
- Fields: **Date**, **Frontend surface**, **User-facing behavior**, **Test cases (Playwright candidates)** bullet list, **Drift risk** rating+rationale.

## Coverage
- Full doc = 431 change entries chronological 2025-06 → 2026-07. Retrieve specific entry by grepping its date-slug header in the source `.md`.
- Early foundational entries (2026-03-22/23) mostly High drift: pi-dashboard (original UI), enrich-session-cards, fix-tool-call-display, mdi-icons, openspec-accordion, resizable-sidebar, session-list-filtering, session-token-stats, sleek-design-overhaul, visual-polish, wire-tool-call-step.
- Low-drift stable: redesign-ask-user-question-cards, markdown-chat-renderer, ascii-table-monospace, fix-session-status-colors, fix-stats-display, theme-system, reasoning-display, optimistic-prompt-card, url-routing, mermaid-diagram-rendering, zrok-tunnel.
- Surfaces covered: SessionCard/List/Sidebar, ChatView/MarkdownContent, CommandInput composer, ToolCallStep, OpenSpec section, ThemeProvider, StatusBar/ModelSelector, dialogs/portals, pinned directories, drag-reorder, editors.
