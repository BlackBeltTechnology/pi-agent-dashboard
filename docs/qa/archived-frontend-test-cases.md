# Archived Frontend Changes — Playwright Test-Case Inventory

> **Generated:** 2026-07-04 by fanning 431 archived frontend-touching OpenSpec changes across parallel `google/gemma-4-31b-it` workers.
> Source: `openspec/changes/archive/*` (proposal WHY/WHAT + tasks verification/test sections).

## ⚠️ Historical Drift Warning

This is a **historic** inventory. The archive spans 2025-06 → 2026-07; many early UI structures were **later replaced, renamed, or removed**. Each entry carries a **Drift risk** rating:

- **High** — early visual/structural work very likely superseded by later redesigns. Treat test cases as *archaeology*, re-verify against current UI before authoring.
- **Medium** — behavior likely still present but exact selectors/placement may have shifted.
- **Low** — stable core behavior; safe Playwright candidate.

**Do not** author Playwright specs directly from a High/Medium entry without first confirming the surface still exists in the live client. Use these as a *use-case catalogue*, not a spec.

## Scope & Method

- **431** archived changes classified as frontend-touching (of 574 total archived changes).
- Filter: references to `src/client/`, `packages/web/`, `.tsx`, React hooks, or named client components.
- Excluded: pure server/infra/CI changes with no browser-observable effect.
- Each change transformed to: frontend surface · user-facing behavior · atomic Playwright-candidate assertions · drift rating.

## Summary Stats

| Metric | Count |
|---|---|
| Frontend-touching changes | 431 |
| Total Playwright-candidate test cases | 1811 |
| Drift risk: High | 34 |
| Drift risk: Medium | 188 |
| Drift risk: Low | 209 |
| Changes with no browser-observable UI | 41 |

---

### 2025-06-05-redesign-ask-user-question-cards
- **Date:** 2025-06-05
- **Frontend surface:** ask_user interactive cards (select/multiselect/input/confirm renderers) and batch wizard card
- **User-facing behavior:** Select/multiselect options render as full-width vertical rows (with optional description sub-line and hotkey hints); answered cards keep the full option list dimmed with the chosen option highlighted; input answered state shows the value read-only (empty = "(left blank)"); confirm buttons read `Yes`/`No`; batch questions render as a single stepper wizard with Back/Next.
- **Test cases (Playwright candidates):**
  - A `select` prompt renders options as full-width one-per-line vertical rows, not horizontal wrapping buttons.
  - An option containing a ` — ` separator renders its trailing text as a description sub-line.
  - After answering a `select`, the card still shows the entire option list dimmed with the chosen option highlighted (no `+N more` collapse).
  - A `multiselect` answered card shows all options with the selected ones highlighted.
  - An answered `input` card shows the entered value in a read-only field; an empty submit shows `(left blank)`.
  - A `confirm` card's buttons read `Yes` and `No` (green/red), not `Allow`/`Deny`.
  - A batch `ask_user` renders as one wizard card with a stepper header and Back/Next navigation between questions.
- **Drift risk:** Low — a deliberate redesign that supersedes earlier ask_user card styling; likely the current stable form for these cards.

### 2026-03-22-auto-shutdown
- **Date:** 2026-03-22
- **Frontend surface:** App.tsx connection-status banner
- **User-facing behavior:** The browser connection status banner shows distinct states — "Connecting..." (yellow) and offline (gray/red) — reflecting the new connected/connecting/offline model; server idle-shutdown is otherwise invisible.
- **Test cases (Playwright candidates):**
  - While the client is establishing/retrying a connection, the status banner shows a yellow "Connecting..." state.
  - After repeated connection failures, the status banner shows a gray/red offline state.
  - When connected, no error/offline banner is shown.
- **Drift risk:** Medium — early connection-status UI; the banner wording/states are plausibly restyled by later reconnection work.

### 2026-03-22-markdown-chat-renderer
- **Date:** 2026-03-22
- **Frontend surface:** ChatView / MarkdownContent component (user, assistant, streaming messages)
- **User-facing behavior:** Chat messages render markdown — headings, lists, bold, and syntax-highlighted code blocks — instead of raw markdown syntax.
- **Test cases (Playwright candidates):**
  - An assistant message containing a fenced code block renders as a highlighted code block rather than raw backtick text.
  - An assistant message with markdown (heading/list/bold) renders formatted HTML, not literal markdown characters.
  - Inline code renders with a distinct inline-code background.
  - The rendered message output contains no invalid nested `<p>` elements.
- **Drift risk:** Low — markdown rendering is a stable core chat capability, though styling details may have changed.

### 2026-03-22-pi-dashboard
- **Date:** 2026-03-22
- **Frontend surface:** Whole initial web client — workspace bar, session sidebar with live stats, ChatView with streaming messages, collapsed tool calls, command autocomplete
- **User-facing behavior:** The original dashboard: a browser UI mirrors all active pi sessions in real time, grouped into workspaces, with a session sidebar, streaming chat view, collapsible tool calls, command autocomplete, and the ability to spawn new sessions.
- **Test cases (Playwright candidates):**
  - Loading the dashboard displays a workspace bar and a session sidebar listing active sessions.
  - An active pi session appears as a session entry with live stats in the sidebar.
  - Selecting a session opens a chat view that streams messages.
  - Tool calls in the chat view render collapsed and expand on interaction.
  - Typing in the command input shows an autocomplete dropdown.
  - Sessions are grouped under workspaces by their cwd prefix.
- **Drift risk:** High — this is the earliest foundational UI; nearly every listed surface (SessionCard, sidebar, ChatView, tool renderers, workspaces) was restructured by later changes, so specific selectors are almost certainly superseded.

### 2026-03-23-ascii-table-monospace
- **Date:** 2026-03-23
- **Frontend surface:** MarkdownContent / message rendering (chat view)
- **User-facing behavior:** Messages containing ASCII/box-drawing tables render inside monospace code blocks so columns stay aligned.
- **Test cases (Playwright candidates):**
  - A message containing box-drawing table characters (`─ │ ┌`) renders inside a monospace `<pre>`/`<code>` block.
  - A plain ASCII table (`+ - |`) in a message renders as a monospace code block.
  - Normal prose content without table characters does not get wrapped in a code block.
  - Content already inside a fenced code block is not double-wrapped.
- **Drift risk:** Low — a stable content-preprocessing behavior in message rendering.

### 2026-03-23-enhanced-chat-input
- **Date:** 2026-03-23
- **Frontend surface:** Chat composer (CommandInput replacing MessageInput)
- **User-facing behavior:** The chat input becomes a multiline textarea with auto-resize and Shift+Enter newlines, a `/` command autocomplete dropdown, `@` file fuzzy-search autocomplete, and image paste with preview thumbnails.
- **Test cases (Playwright candidates):**
  - The chat composer renders a multiline textarea (CommandInput), not a single-line input.
  - Pressing Shift+Enter in the composer inserts a newline instead of sending the message.
  - Typing `/` opens a command autocomplete dropdown listing available commands.
  - Typing `@` opens a file-path autocomplete dropdown; selecting an entry inserts `@path/to/file` into the input.
  - Pasting an image into the textarea shows a preview thumbnail before sending.
  - The textarea auto-resizes in height as multiple lines are entered.
- **Drift risk:** Medium — early composer overhaul; input affordances (dropdown styling, trigger behavior) are commonly iterated, though the core multiline+autocomplete capability is likely retained.

### 2026-03-23-enrich-session-cards
- **Date:** 2026-03-23
- **Frontend surface:** SessionList / session cards in the sidebar
- **User-facing behavior:** Each sidebar session card shows richer live state — activity indicator, current tool name, token in/out counts, cost, source badge, and relative time since start — without opening the session.
- **Test cases (Playwright candidates):**
  - A session card renders a source badge and a relative-time label (e.g. "3m") in its header.
  - When a session is streaming, the card shows an activity-state label and the current tool name.
  - A session card displays formatted token counts (e.g. "12.4k") for input and output.
  - A session card displays a cost value.
  - When the server broadcasts a status transition (active → streaming → idle), the card's activity indicator updates to match without a page reload.
- **Drift risk:** High — early card-content/layout change; later changes (compact context bar, goals chip, slim OpenSpec) repeatedly restructure the same card region.

### 2026-03-23-fix-session-card-data
- **Date:** 2026-03-23
- **Frontend surface:** SessionCard — stats, git info, editor buttons, thinking level
- **User-facing behavior:** Session cards display persisted cost, token, cache, and git stats after restart; editor buttons appear when the editor process is running; the thinking level shows next to the model name.
- **Test cases (Playwright candidates):**
  - A session card renders the thinking level next to the model name.
  - A session card with recorded stats displays non-zero cost and token up/down counts (not `$0.00` / `0↑ 0↓`) after a reload.
  - A session card shows an editor button when its editor is detected as running.
- **Drift risk:** Medium — SessionCard layout evolves frequently; persistence is server-side but the displayed fields (thinking level, editor buttons) are likely to be reorganized.

### 2026-03-23-fix-session-status-colors
- **Date:** 2026-03-23
- **Frontend surface:** SessionList and SessionSidebar status indicator dots
- **User-facing behavior:** Session status dots use corrected colors: connected/idle green, working (streaming) pulsing yellow, ended gray.
- **Test cases (Playwright candidates):**
  - A session in `active` state shows a solid green status indicator in SessionList.
  - A session in `idle` state shows a solid green status indicator.
  - A session in `streaming` state shows a pulsing yellow status indicator.
  - A session in `ended` state shows a gray status indicator.
  - SessionSidebar renders the same color mapping as SessionList for each status.
- **Drift risk:** Low — status color semantics are stable core behavior unlikely to be reverted.

### 2026-03-23-fix-stats-display
- **Date:** 2026-03-23
- **Frontend surface:** Session stats display (token counts, ↓in ↑out transfer counters, per-turn bar graph)
- **User-facing behavior:** After a turn completes, the dashboard shows cumulative token stats, transfer counters, and a per-turn bar graph instead of nothing.
- **Test cases (Playwright candidates):**
  - After a turn ends, the token stats display shows non-zero cumulative values.
  - The ↓in / ↑out transfer counters render and update after a turn completes.
  - The per-turn bar graph renders at least one bar after a turn completes.
  - Stats values accumulate (increase) across successive turns rather than resetting per turn.
- **Drift risk:** Low — stats display is a core session UI behavior; fix restores intended long-lived functionality.

### 2026-03-23-fix-tool-call-display
- **Date:** 2026-03-23
- **Frontend surface:** ChatView tool calls (ToolCallStep component)
- **User-facing behavior:** Tool calls render as expandable cards showing args and result, appear immediately on start with a running spinner, and truncate long output to 30 lines.
- **Test cases (Playwright candidates):**
  - A tool call appears in the chat on `tool_execution_start` with a running spinner and its args visible.
  - Expanding a ToolCallStep reveals both the args and the result output section.
  - A streaming `tool_execution_update` updates the existing tool card's result in place (no duplicate card).
  - A tool result longer than 30 lines is truncated in the displayed output.
- **Drift risk:** High — early foundational tool-card wiring, later extended/superseded by inline-image and render-order changes.

### 2026-03-23-markdown-copy-support
- **Date:** 2026-03-23
- **Frontend surface:** MarkdownContent (GFM tables, code-block and table copy buttons) and ChatView message copy bar, CopyButton
- **User-facing behavior:** Markdown tables render as real HTML tables; code blocks, tables, and message bubbles show copy buttons that copy content (markdown/TSV/plain text) with a ✓ feedback.
- **Test cases (Playwright candidates):**
  - A GFM markdown table renders as a `<table>` element rather than raw pipe text.
  - A fenced code block renders with a 📋 copy button in its top-right; inline code has no copy button.
  - Clicking a code-block copy button copies the raw code and briefly shows a ✓ checkmark.
  - A rendered table shows two copy buttons (📋 markdown, 📊 TSV).
  - Each message bubble shows a copy bar with 📋 (markdown) and 📝 (plain text) options.
  - Clicking a message's plain-text copy button copies unformatted text to the clipboard.
- **Drift risk:** Medium — copy affordances are stable in spirit, but the exact icon-bar placement on messages/tables may have been restyled in later chat redesigns.

### 2026-03-23-mdi-icons
- **Date:** 2026-03-23
- **Frontend surface:** Multiple components (status icons, source icons, editor icons, CopyButton) across the web client
- **User-facing behavior:** Emoji/text icons (📋, ⏳, ✅, ❌) are replaced with Material Design SVG icons rendered consistently across components.
- **Test cases (Playwright candidates):**
  - Status/source/editor icons render as inline SVG elements (not emoji text nodes) in their respective components.
  - The CopyButton renders an MDI SVG icon rather than an emoji character.
- **Drift risk:** High — early, broad visual icon migration very likely refined/superseded by the later `add-button-icons` change and subsequent UI work.

### 2026-03-23-model-selector-controls
- **Date:** 2026-03-23
- **Frontend surface:** StatusBar (between ChatView and CommandInput), ModelSelector dropdown, CommandInput Play/Stop buttons
- **User-facing behavior:** An always-visible StatusBar shows the current model (clickable to open a filterable model dropdown) and a working indicator while streaming; the Send button becomes a Play icon and a red Stop button appears during streaming.
- **Test cases (Playwright candidates):**
  - The StatusBar is visible between ChatView and CommandInput even when the session is idle.
  - Clicking the current model name opens a filterable dropdown of available models.
  - Typing in the model dropdown filters the model list.
  - Selecting a model from the dropdown closes it and sets it as the current model.
  - The working status indicator on the StatusBar's right side appears only while the session is streaming.
  - The CommandInput submit control renders as a Play (▶) icon instead of "Send" text.
  - A red Stop (■) button is visible at the end of the input only while the session is streaming.
- **Drift risk:** Medium — an early StatusBar/ModelSelector layout later enriched by capabilities/favorites work, so exact structure likely evolved.

### 2026-03-23-open-in-editor
- **Date:** 2026-03-23
- **Frontend surface:** SessionCard / group header editor icon buttons + Toast
- **User-facing behavior:** On localhost, session cards show editor icon buttons (Zed/VS Code/IntelliJ) that open the session's folder in the detected editor with one click; errors show a toast.
- **Test cases (Playwright candidates):**
  - When accessed on localhost, a session card with a detected editor shows an editor icon button.
  - Editor icon buttons do not appear when the dashboard is accessed from a non-localhost origin.
  - Clicking an editor button triggers the open-editor request for that session's cwd and editor id.
  - A failed open-editor request surfaces an auto-dismissing toast.
  - Group headers for multi-session groups show editor buttons for each detected editor.
- **Drift risk:** Medium — early SessionCard extraction; SessionCard was later redesigned (redesign-session-card-and-composer), so exact button placement likely shifted.

### 2026-03-23-openspec-accordion
- **Date:** 2026-03-23
- **Frontend surface:** Accordion session cards + embedded OpenSpec section
- **User-facing behavior:** The selected session card expands to show detail sections including an OpenSpec section grouped by status, with action buttons (Continue, FF, Apply, Archive, Explore) that dispatch commands, plus an Explore modal and a refresh button.
- **Test cases (Playwright candidates):**
  - Selecting a session card expands it to reveal additional detail sections while non-selected cards stay compact.
  - The expanded card's OpenSpec section lists changes grouped into in-progress and completed with task counts.
  - Clicking an OpenSpec action button (e.g. Continue/FF/Apply) sends the corresponding command to the session.
  - Clicking Explore opens a modal with a multiline text input.
  - Clicking Archive shows a confirm dialog before dispatching.
  - Clicking the OpenSpec section refresh button triggers an immediate poll/update.
  - The OpenSpec section is hidden for sessions whose project has no OpenSpec initialized.
- **Drift risk:** High — early accordion + inline OpenSpec UI; superseded by the 2026-06-14 full-page board redesign that removed the inline accordion.

### 2026-03-23-resizable-sidebar
- **Date:** 2026-03-23
- **Frontend surface:** Session sidebar (ResizableSidebar) + session card context-usage bar
- **User-facing behavior:** Users drag to resize the sidebar (180–500px), collapse it to a thin strip, open it via hamburger on mobile, and see a context-usage gradient bar on cards instead of token stats.
- **Test cases (Playwright candidates):**
  - Dragging the sidebar's right-edge handle resizes it and clamps within 180–500px.
  - Clicking the collapse toggle (`«`) collapses the sidebar to the ~28px strip; the expand button restores it.
  - Double-clicking the drag handle toggles collapse.
  - Sidebar width and collapsed state survive a page reload (localStorage).
  - Below 768px the desktop sidebar is hidden and a hamburger button opens the overlay; clicking the backdrop closes it.
  - The context-usage bar fills green/yellow/red per usage percentage and shows gray with no data.
- **Drift risk:** High — early structural sidebar/visual change likely reworked by later layout and card redesigns.

### 2026-03-23-session-directory-grouping
- **Date:** 2026-03-23
- **Frontend surface:** Session sidebar (directory groups + git branch/PR links)
- **User-facing behavior:** Sessions are grouped by working directory with a group header showing directory name and git branch/PR links; single-session directories show git info inline beneath the card.
- **Test cases (Playwright candidates):**
  - Multiple sessions in the same cwd render under a shared group header with the directory name.
  - A group header shows the git branch as a clickable link pointing at the pre-built branch URL.
  - When a PR/MR number exists, a clickable PR link is rendered from the pre-built PR URL.
  - A single-session directory renders its card with git info shown inline beneath it.
- **Drift risk:** Medium — early grouping structure; core grouping persists but the sidebar has been reworked repeatedly (search, ended groups, header redesign).

### 2026-03-23-session-list-filtering
- **Date:** 2026-03-23
- **Frontend surface:** SessionList header toggles + per-card hide/unhide controls + "N hidden" indicator
- **User-facing behavior:** Users hide individual session cards, toggle "Active only" and "Show hidden", see a "N hidden" count, with state persisted in localStorage.
- **Test cases (Playwright candidates):**
  - Clicking a card's `[✕]` hide button removes it from the visible session list.
  - Enabling "Active only" hides ended/offline session cards.
  - A "N hidden" indicator appears when hidden sessions exist and "Show hidden" is off.
  - Enabling "Show hidden" reveals hidden cards in a muted style with an unhide `[↩]` button.
  - Clicking `[↩]` on a revealed hidden card un-hides it.
  - Hidden IDs and toggle states persist across a page reload (localStorage).
- **Drift risk:** High — early sidebar filtering UI predating SessionCard redesign; toggle/control layout likely superseded by later card/sidebar work.

### 2026-03-23-session-rename
- **Date:** 2026-03-23
- **Frontend surface:** SessionHeader and SessionSidebar inline rename (pencil icon / double-click), InlineRenameInput
- **User-facing behavior:** Users can rename a session inline via a pencil icon or double-click; the custom name displays everywhere, falling back to the directory name when unset.
- **Test cases (Playwright candidates):**
  - Clicking the pencil icon (or double-clicking the name) in SessionHeader opens an inline rename input.
  - Pressing Enter in the rename input confirms and displays the new name.
  - Pressing Escape cancels the rename and restores the previous name.
  - Submitting an empty name is handled (falls back to directory name, not blank).
  - A session with no custom name displays the directory basename (`cwd.split("/").pop()`).
- **Drift risk:** Medium — inline rename UX is stable, but its placement in SessionHeader/SessionSidebar may have shifted across later header/sidebar redesigns.

### 2026-03-23-session-token-stats
- **Date:** 2026-03-23
- **Frontend surface:** SessionHeader + new TokenStatsBar (per-turn token bar chart, context-window progress bar, cost)
- **User-facing behavior:** A stats bar between the session header and chat shows per-turn token usage as a mini bar chart (input/output/cache), a context-window progress bar, and input/output counters with cost.
- **Test cases (Playwright candidates):**
  - The TokenStatsBar renders between the SessionHeader and ChatView for the selected session.
  - The stats bar renders a per-turn mini bar chart with distinct input/output/cache segments.
  - The context-window usage renders as a progress bar reflecting tokens/contextWindow.
  - Input and output token counters and cost are displayed in the stats bar.
- **Drift risk:** High — an early token-stats visualization; later header/stats-bar redesigns likely replaced this specific TokenStatsBar layout.

### 2026-03-23-sleek-design-overhaul
- **Date:** 2026-03-23
- **Frontend surface:** SessionCard, folder headers (collapsible groups), ChatView message bubbles, ToolCallStep, TokenStatsBar
- **User-facing behavior:** A visual refresh: session cards get a dedicated action-button row below a divider and a subtle selected accent, folder headers always show and can collapse/expand (persisted), message bubbles gain borders, and the token stats bar uses a new color scheme with a 5-segment context bar.
- **Test cases (Playwright candidates):**
  - Each session card renders action buttons (editors, source badge, hide) in a separate row below a divider.
  - A folder header renders even when the directory has only one session.
  - Clicking a folder header chevron collapses/expands its session list, and the collapsed state persists across reload (localStorage).
  - The selected session card shows a subtle left-border accent.
  - Chat message bubbles render with borders and copy buttons below a divider.
  - The context-window bar renders as a 5-segment stacked bar and shows a red warning at >90% usage.
- **Drift risk:** High — an early broad visual overhaul; card layout, bubbles, and token bar have very likely been superseded by later design/theme changes (e.g. attention-routing, board, mobile-layout work).

### 2026-03-23-theme-gallery
- **Date:** 2026-03-23
- **Frontend surface:** Sidebar theme picker dropdown (5 named themes) + themed syntax highlighting
- **User-facing behavior:** A sidebar theme picker dropdown lets users choose among 5 named themes (Base, Dracula, Nord, GitHub, Catppuccin) with color-swatch previews; selecting one applies its CSS variables live, persists to localStorage, and updates code-block syntax highlighting; works alongside the System/Light/Dark toggle.
- **Test cases (Playwright candidates):**
  - Opening the sidebar theme picker shows named themes with color preview swatches.
  - Selecting a non-Base theme updates the document's CSS variables and re-colors the UI live.
  - The selected theme name persists across reload (localStorage).
  - Selecting a theme changes the syntax-highlighting style applied to code blocks.
  - Selecting Base removes the runtime CSS variable overrides (reverts to default palette).
- **Drift risk:** Medium — theme system is core, but the picker's placement and exact theme set may have shifted over time.

### 2026-03-23-theme-system
- **Date:** 2026-03-23
- **Frontend surface:** ThemeProvider, three-state theme toggle (System / Light / Dark) in the session list header, CSS custom properties across all components
- **User-facing behavior:** Users switch between System, Light, and Dark themes via a toggle in the session list header; the choice sets `data-theme` on `<html>`, persists to localStorage, and recolors the whole dashboard via CSS variables.
- **Test cases (Playwright candidates):**
  - The theme toggle renders in the session list header with System / Light / Dark options.
  - Selecting Light sets `data-theme="light"` on the `<html>` element and applies the light palette.
  - Selecting Dark sets `data-theme="dark"` (or removes the light attribute) and applies dark colors.
  - The selected theme persists across a page reload (via localStorage).
  - With preference "System", the resolved theme follows the OS `prefers-color-scheme`.
- **Drift risk:** Low — core theming infrastructure that later work extends rather than replaces (though the toggle's exact placement may have shifted).

### 2026-03-23-visual-polish
- **Date:** 2026-03-23
- **Frontend surface:** ChatView message bubbles, SessionCard, ToolCallStep, CommandInput dropdown, TokenStatsBar (context progress bar)
- **User-facing behavior:** Chat messages, session cards, tool steps, and autocomplete popups gain rounded corners, shadows, and hover lift; user message bubbles switch from solid blue to a subtle tinted style with a left accent border; the context/token bar shows a smooth green→yellow→red gradient instead of hard color thresholds.
- **Test cases (Playwright candidates):**
  - User message bubble has a translucent blue background and a left blue accent border (not solid `bg-blue-600`).
  - Assistant and streaming message bubbles render with `rounded-xl` and a drop shadow.
  - Session card element has `rounded-xl` and a shadow class, and no longer has the flat `border-b border-gray-800/50`.
  - Hovering a session card applies a raised transform/larger shadow (hover state changes computed style).
  - Expanded ToolCallStep panel and the command/file autocomplete popups render with rounded corners and a shadow/border.
  - TokenStatsBar fill uses an inline `background-color` style whose color shifts along a green→yellow→red gradient as the token percentage increases (low % ≈ green, high % ≈ red).
- **Drift risk:** High — purely cosmetic class-level tweaks to early UI surfaces; very likely restyled or superseded by later theme/visual changes.

### 2026-03-23-wire-tool-call-step
- **Date:** 2026-03-23
- **Frontend surface:** ChatView tool call rendering (ToolCallStep)
- **User-facing behavior:** Tool calls render as expandable ToolCallStep components (showing args/result/status) instead of static gear+name labels; users click to expand.
- **Test cases (Playwright candidates):**
  - A toolResult message renders as a ToolCallStep component (not a static gear+name label).
  - Clicking a tool step expands it to reveal the tool's args and result.
  - A running tool renders collapsed (no auto-expand).
- **Drift risk:** High — very early (2026-03-23) foundational wiring; ToolCallStep has been extended/restyled by many later changes.

### 2026-03-23-zrok-tunnel
- **Date:** 2026-03-23
- **Frontend surface:** Client WebSocket URL logic in App.tsx (no dedicated visible control)
- **User-facing behavior:** When served over HTTPS through a tunnel, the browser uses `wss://` and the correct host/port so the dashboard's live WebSocket works remotely.
- **Test cases (Playwright candidates):**
  - When the page is served over HTTPS, the client opens the WebSocket using the `wss://` scheme (not `ws://`).
  - The WebSocket URL derives host/port from the served origin rather than a hardcoded port 8000.
- **Drift risk:** Low — WS scheme/host derivation is core connectivity logic that must remain correct.

### 2026-03-24-drop-sqlite
- **Date:** 2026-03-24
- **Frontend surface:** ChatView / session event stream + data-unavailable indicator
- **User-facing behavior:** Session events stream to the browser from in-memory/on-demand loading; subscribing to an old session with no connected bridge shows a "data unavailable" indicator.
- **Test cases (Playwright candidates):**
  - Subscribing to a live session renders its events in the chat/event view.
  - Reconnecting the browser to an active session replays its existing events into the view.
  - Subscribing to an old session with no bridge connected displays the "data unavailable" indicator.
  - Hiding a session updates its hidden state and removes it from the default session list.
- **Drift risk:** Medium — the data-unavailable indicator and replay UI are observable but likely restyled by later session-view changes; underlying persistence swap is stable.

### 2026-03-24-headless-spawn
- **Date:** 2026-03-24
- **Frontend surface:** Sidebar folder card group header — "New Session" (`+`) button
- **User-facing behavior:** A `+` button on each folder group header spawns a browser-driven (headless `pi --mode rpc`) session without tmux or a terminal.
- **Test cases (Playwright candidates):**
  - Each folder group header renders a "New Session" (`+`) button.
  - Clicking the `+` button issues a spawn request and a new session appears in that folder group on success.
  - A failed spawn surfaces its failure message to the user (spawn_result feedback).
- **Drift risk:** Medium — the spawn button persists, but spawn correlation / placeholder-card changes later reshaped the click-to-card flow.

### 2026-03-24-openspec-slim-card
- **Date:** 2026-03-24
- **Frontend surface:** OpenSpecSection inside session cards (ChangeCard, ArtifactLetters)
- **User-facing behavior:** The OpenSpec section is a collapsed-by-default row with a chevron, letter indicators (P D S T) colored by status, inline task counts, and per-change Archive/Apply actions.
- **Test cases (Playwright candidates):**
  - On an expanded session card, the OpenSpec section renders collapsed by default showing only the `▶ OpenSpec` header.
  - Clicking the OpenSpec header toggles the section open (chevron flips to `▼`) and reveals the change list and "+ New Change".
  - Each artifact renders as a single letter (P/D/S/T) with the correct color class (done=green, ready=yellow, blocked=muted).
  - Hovering an artifact letter shows a tooltip in the form "artifact-id: status".
  - A change card shows its task count inline on the name line (e.g. "2/5 tasks") with no "In Progress"/"Completed" section headers.
  - When all artifacts are done (all green), an "Apply" button appears on the change's action row.
  - An "Archive" button appears on each change's action row.
- **Drift risk:** High — early detailed visual restructure of the card OpenSpec area; later folder-level goals/OpenSpec board work likely moved or superseded much of this.

### 2026-03-24-reasoning-display
- **Date:** 2026-03-24
- **Frontend surface:** ChatView (Reasoning/thinking blocks)
- **User-facing behavior:** Model reasoning streams live and, on completion, appears as a collapsible "Reasoning" block (brain icon, collapsed by default) in the chat timeline.
- **Test cases (Playwright candidates):**
  - A completed thinking block renders a collapsible "Reasoning" message with a brain icon, collapsed by default.
  - Clicking the Reasoning block expands it to show the full reasoning text without truncation.
  - While thinking streams, a live expanded reasoning block with a streaming indicator is shown.
  - An empty thinking block produces no Reasoning message in the timeline.
- **Drift risk:** Low — a core chat-timeline capability that later changes extend rather than remove.

### 2026-03-24-session-sync
- **Date:** 2026-03-24
- **Frontend surface:** Sidebar (session list) + active/hidden session toggle
- **User-facing behavior:** The sidebar shows only active sessions by default with a toggle to reveal hidden/ended sessions; ended sessions disappear from the default view but are never deleted.
- **Test cases (Playwright candidates):**
  - Ending a session (unregister/timeout) removes its card from the default sidebar view.
  - Toggling "show hidden/ended sessions" reveals previously hidden session cards in the sidebar.
  - A registered (active) session appears as a visible card in the default sidebar view.
- **Drift risk:** Medium — the active/hidden sidebar model is core, but the specific toggle UI and card layout may have been restyled by later icon/UI changes.

### 2026-03-25-attach-proposal-to-session
- **Date:** 2026-03-25
- **Frontend surface:** OpenSpecSection header + ChangeCard (session card OpenSpec area)
- **User-facing behavior:** A user attaches one OpenSpec proposal to a session so only that change shows; header switches between attached/unattached controls (Detach vs Bulk Archive).
- **Test cases (Playwright candidates):**
  - Clicking "Attach" on a ChangeCard collapses the OpenSpec section to show only that proposal's change card.
  - When a proposal is attached, the OpenSpec header renders the proposal name and a "Detach" button, and no "Attach" buttons are visible.
  - Clicking "Detach" restores the full change list and re-renders per-change "Attach" buttons.
  - When no proposal is attached, the OpenSpec header shows "Bulk Archive" and "Refresh" buttons.
  - Clicking "Bulk Archive" opens a confirmation dialog before proceeding.
  - Attaching a proposal to a session whose name is empty updates the session card's displayed name to the proposal name.
- **Drift risk:** Medium — structured OpenSpec-section UI likely refined by later worktree/OpenSpec changes (see 2026-05-31), though the attach/detach concept is core.

### 2026-03-25-optimistic-prompt-card
- **Date:** 2026-03-25
- **Frontend surface:** ChatView (optimistic user card), CommandInput (disabled input, Stop button)
- **User-facing behavior:** Sending a prompt immediately shows an optimistic user message card with a spinner, disables the input, and shows a Stop button; Escape/Stop cancels and re-enables input, and the server's real user message replaces the optimistic card.
- **Test cases (Playwright candidates):**
  - Sending a prompt immediately renders an optimistic user card with a spinner at the bottom of the message list.
  - While a prompt is pending, the input and send button are disabled.
  - While a prompt is pending, the Stop button is shown.
  - Pressing Escape (or clicking Stop) while pending removes the optimistic card and re-enables the input.
  - An optimistic card with attached images renders those image attachments.
  - When the server's user `message_start` arrives, the optimistic card is replaced by the real message card.
- **Drift risk:** Low — optimistic-send feedback is stable core chat UX.

### 2026-03-25-reorderable-session-cards
- **Date:** 2026-03-25
- **Frontend surface:** Session cards within a folder group (sidebar/session list)
- **User-facing behavior:** Users drag session cards to reorder them within a folder; new sessions appear at the top and forked sessions right after their parent, persisting across clients.
- **Test cases (Playwright candidates):**
  - Dragging a session card to a new position within its folder group reorders the cards and the new order persists after reload.
  - A newly registered session appears prepended at position 0 of its folder group.
  - A forked session card appears immediately after its parent session card.
  - A reorder performed in one browser is reflected in another connected client.
- **Drift risk:** Medium — early structural interaction; drag library and card layout may be superseded by later redesigns.

### 2026-03-25-url-routing
- **Date:** 2026-03-25
- **Frontend surface:** App routing — sidebar, landing page, session header back button, "Pi" branding
- **User-facing behavior:** Selecting a session navigates to `/session/:id` (bookmarkable, restored on refresh and highlighted); `/` shows a landing page with a "Select a session" hint; a back button traverses browser history; the sidebar header shows "Pi" branding instead of "Sessions"; unknown routes redirect to `/`.
- **Test cases (Playwright candidates):**
  - Clicking a session card navigates the URL to `/session/:id`.
  - Reloading at `/session/:id` restores that session view and highlights it in the sidebar.
  - Visiting `/` shows the landing page with a "Select a session" hint and no session detail.
  - The session header back button is visible only when a session is selected and navigates back via browser history.
  - The sidebar header shows a "Pi" logo/branding instead of the text "Sessions".
  - Navigating to an unknown session ID or invalid route redirects to `/`.
- **Drift risk:** Low — URL routing is foundational core behavior later changes build upon rather than replace.

### 2026-03-26-pi-command-support
- **Date:** 2026-03-26
- **Frontend surface:** Chat composer + chat view (bash output / command feedback display)
- **User-facing behavior:** Users can run `!`/`!!` shell commands, `/compact`, and slash commands from the dashboard composer; bash output and command status render in the chat view.
- **Test cases (Playwright candidates):**
  - Sending a `!command` from the composer renders a bash output block in the chat view.
  - A failing `!command` (non-zero exit) renders its error/output in the chat view.
  - Sending `/compact` shows a command-feedback message in the chat view.
  - Sending a `/slash` command shows command execution feedback rather than being posted as a plain user message.
- **Drift risk:** Medium — chat rendering of bash/command output is a broad early feature likely refined by later renderer changes.

### 2026-03-27-auto-resume-on-prompt
- **Date:** 2026-03-27
- **Frontend surface:** SessionCard (Resuming state, Resume/Fork buttons)
- **User-facing behavior:** Sending a prompt to an ended session auto-resumes it; the card shows a pulsing yellow "Resuming…" state and disables Resume/Fork buttons until the resumed bridge connects.
- **Test cases (Playwright candidates):**
  - Sending a prompt to an ended session shows a "Resuming…" state (pulsing yellow dot + text) on the card.
  - While resuming, the Resume and Fork buttons are disabled.
  - When the resumed bridge connects and the prompt is flushed, the "Resuming…" state clears.
- **Drift risk:** Medium — resume state visual (pulsing dot) is stable in concept but the specific card styling is plausibly restyled later.

### 2026-03-27-card-pulse-working
- **Date:** 2026-03-27
- **Frontend surface:** SessionCard (working/streaming state)
- **User-facing behavior:** A session that is actively working shows the whole card subtly pulsing with an amber tint, making working sessions easy to spot at a glance.
- **Test cases (Playwright candidates):**
  - A session card in the streaming state carries the pulse animation class.
  - A session card in the resuming state carries the pulse animation class.
  - An idle session card does not carry the pulse animation class.
  - An ended session card does not carry the pulse animation class.
- **Drift risk:** High — early visual-treatment change; the working-pulse styling was later differentiated (e.g. 2026-03-29 ask_user input-pulse) and may have been restyled since.

### 2026-03-27-dialog-portal-global-rendering
- **Date:** 2026-03-27
- **Frontend surface:** Dialog rendering (PinDirectoryDialog, ConfirmDialog, ExploreDialog) via DialogPortal, especially on mobile
- **User-facing behavior:** Dialogs render at document body via a portal so they are no longer clipped or stacked behind the sidebar; background scroll is locked while a dialog is open, and dialogs layer above the mobile sidebar overlay.
- **Test cases (Playwright candidates):**
  - Opening a dialog from the mobile sidebar renders it above the sidebar overlay (not clipped or behind it).
  - An open dialog renders as a direct child of `document.body` (escaping the sidebar's overflow container).
  - While a dialog is open, background page scroll is locked.
  - The dialog layers above the mobile sidebar panel (higher effective z-index).
- **Drift risk:** Medium — a structural dialog-rendering fix; the portal pattern tends to persist, but specific dialog components and z-index values may be reworked.

### 2026-03-27-fix-model-selection
- **Date:** 2026-03-27
- **Frontend surface:** Model selector dropdown / session card / status bar
- **User-facing behavior:** Selecting a model from the dashboard dropdown actually switches the session's model, and the selection reflects immediately on the session card and status bar.
- **Test cases (Playwright candidates):**
  - Selecting a model from the model dropdown updates the displayed model value in the session card without sending a plain-text `/model` message into the chat.
  - After choosing a new model, the status bar reflects the newly selected model.
  - Choosing a model does not add a user chat message containing `/model provider/id` text to the transcript.
- **Drift risk:** Medium — model-selector UI plumbing is fairly stable, but the combo/status-bar presentation may have been restyled by later settings/provider reorg changes.

### 2026-03-27-fix-pinned-dir-symlink-and-path-display
- **Date:** 2026-03-27
- **Frontend surface:** Sidebar directory group headers (SessionList) — pinned/unpinned groups
- **User-facing behavior:** Directory groups show full middle-truncated absolute paths, pinned groups (even empty) show git/editor/New controls, and a symlinked pin no longer produces a duplicate empty group.
- **Test cases (Playwright candidates):**
  - A directory group header shows the full absolute path (middle-truncated with `…`) instead of only the basename.
  - A long directory path is truncated in the middle, preserving the root prefix and trailing directory name.
  - An empty pinned directory group still shows editor buttons and a "New" spawn button.
  - A pinned group uses a distinct unpin icon (`mdiPinOff`) different from the pin icon on unpinned groups.
  - A directory pinned via a symlink appears as a single group, not two.
- **Drift risk:** Medium — path-truncation and pinned-group details are fairly stable, but sidebar group-header layout is a common target for later restyles.

### 2026-03-27-fix-session-drag-reorder
- **Date:** 2026-03-27
- **Frontend surface:** SessionList drag-and-drop reordering (including pinned directory groups)
- **User-facing behavior:** Dragging a session card to reorder it inside a pinned directory group now sticks on drop instead of snapping back.
- **Test cases (Playwright candidates):**
  - Dragging a session card within a pinned directory group reorders it and the new order persists after drop (does not snap back).
  - Dragging a session card over a pinned-group target is a no-op (cross-type drag does nothing).
- **Drift risk:** Medium — drag-reorder is stable behavior, but sidebar/DnD structure may have been refactored since.

### 2026-03-27-folder-session-visual-hierarchy
- **Date:** 2026-03-27
- **Frontend surface:** Sidebar folder group container + session cards
- **User-facing behavior:** Folder groups are wrapped in a contained block with a secondary background and rounded corners; session cards get a tertiary background, producing a 3-tier nested color hierarchy.
- **Test cases (Playwright candidates):**
  - Each folder group renders as a single container element with a secondary background and rounded corners.
  - Folder headers no longer render a `border-b` separator.
  - Session cards render with a distinct (tertiary) background nested inside the folder container.
  - Collapsed folder groups keep the container visible while hiding the session cards.
  - Pinned folder groups render with the same container styling and drag handles still function.
- **Drift risk:** High — early cosmetic layering of sidebar/cards, very likely restyled by later visual changes.

### 2026-03-27-mermaid-diagram-rendering
- **Date:** 2026-03-27
- **Frontend surface:** MarkdownContent / MermaidBlock in chat and markdown preview
- **User-facing behavior:** Mermaid code blocks render as interactive SVG diagrams themed to the dashboard; invalid syntax falls back to raw code with an error.
- **Test cases (Playwright candidates):**
  - A `mermaid` fenced code block renders as an SVG diagram (not plain highlighted code).
  - An invalid Mermaid block shows an error message alongside the raw code fallback.
  - Multiple Mermaid diagrams on one screen each render with unique IDs (no collision/blank duplicates).
  - Switching the dashboard theme (dark/light) re-renders the diagram with matching theme styling.
- **Drift risk:** Low — self-contained rendering component with stable behavior.

### 2026-03-27-openspec-artifact-reader
- **Date:** 2026-03-27
- **Frontend surface:** OpenSpec change cards (P S D T artifact letters, "Read" button) + MarkdownPreviewView content area
- **User-facing behavior:** Clicking an artifact status letter (P/S/D/T) or a "Read" button on an OpenSpec change card replaces the chat view with a scrollable markdown preview of that artifact (specs concatenated with headers); a back button restores the chat view.
- **Test cases (Playwright candidates):**
  - Clicking an artifact letter (P/S/D/T) on a change card opens the markdown preview view for that artifact.
  - Clicking the "Read" button on a change card opens the first available artifact; the button is hidden when no artifacts exist.
  - The markdown preview replaces the chat view and hides the StatusBar and CommandInput.
  - Opening the "S" artifact shows all spec files concatenated into one scrollable view with section headers.
  - Clicking the preview's back button restores the chat view.
- **Drift risk:** Medium — artifact-letter interaction is stable, but the "replace chat view" mechanism predates URL routing and may have been re-plumbed into route-based navigation.

### 2026-03-27-openspec-folder-card-ui
- **Date:** 2026-03-27
- **Frontend surface:** SessionList folder card header (OpenSpec section), SessionCard (attach badge, attach combo box, LLM action buttons)
- **User-facing behavior:** The OpenSpec change list, artifact letters, and task counts move from individual session cards to the folder card header, with folder-level Refresh / Bulk Archive / New Spec actions. Session cards keep an attach badge, an attach combo box, and LLM action buttons (Continue, FF, Apply, Archive, Explore) visible only when a change is attached.
- **Test cases (Playwright candidates):**
  - The folder card header renders the OpenSpec section (change list with artifact letters and task counts).
  - The folder header exposes Refresh and Bulk Archive actions.
  - A session without an attachment shows an attach combo box listing folder changes; selecting one attaches it.
  - After attaching, the session card shows LLM action buttons (Continue, FF, Apply, Archive) and a Detach button.
  - The OpenSpec change list no longer renders on individual session cards.
- **Drift risk:** High — early structural relocation of OpenSpec UI; multiple later changes (card-state-and-actions, auto-hide subcards) rework this exact surface.

### 2026-03-27-openspec-state-buttons
- **Date:** 2026-03-27
- **Frontend surface:** SessionOpenSpecActions, FolderOpenSpecSection, NewChangeDialog
- **User-facing behavior:** OpenSpec action buttons (Continue/Apply/Verify) show correctly per derived change state; the folder-level OpenSpec section gains a "+ New Change" button opening a dialog, and each change lists its linked sessions.
- **Test cases (Playwright candidates):**
  - A COMPLETE change shows a Verify button and does not show the Apply button.
  - The attached proposal name in the badge renders in the blue accent color.
  - The folder-level OpenSpec section header shows a "+ New Change" button next to Refresh and Bulk Archive.
  - Clicking "+ New Change" opens the NewChangeDialog with name and description fields.
  - Submitting NewChangeDialog with a name sends the new-change prompt and closes the dialog; Cancel closes without sending.
  - The "+ New" button is disabled when the folder has no active sessions.
  - Linked sessions listed under a change are clickable and navigate to that session.
- **Drift risk:** Medium — OpenSpec UI has evolved substantially (later board/drag changes exist), so button placement and section layout may be superseded.

### 2026-03-27-pinned-directories
- **Date:** 2026-03-27
- **Frontend surface:** Sidebar directory groups, group header pin/unpin toggle, PinDirectoryDialog
- **User-facing behavior:** Users can pin directory groups so they stay at the top of the sidebar (in a drag-reorderable order) even with zero sessions; each group header has a pin/unpin toggle; a "Pin directory" button opens a dialog to pin a path with no running sessions. The old workspace bar/dialog is removed.
- **Test cases (Playwright candidates):**
  - Each directory group header shows a pin/unpin toggle button.
  - Clicking pin moves the directory to the pinned area at the top of the sidebar.
  - A pinned directory remains visible in the sidebar when it has zero sessions (and when "Active only" is enabled).
  - Pinned directories can be drag-reordered and the new order holds.
  - A "Pin directory" button in the sidebar header opens PinDirectoryDialog with a path text input.
  - Confirming PinDirectoryDialog with a path adds that directory to the pinned list.
  - The old WorkspaceBar / AddWorkspaceDialog UI no longer renders anywhere.
- **Drift risk:** Medium — core pinning behavior is stable and reused by later changes, but the sidebar layout and workspace concept were later reworked by `folder-workspaces`, so exact placement may have shifted.

### 2026-03-27-placeholder-spawn-card
- **Date:** 2026-03-27
- **Frontend surface:** SessionList / PlaceholderSessionCard, per-group "New" button
- **User-facing behavior:** Clicking "New" immediately shows a pulsing skeleton card at the top of the group and disables that group's New button until the real session card arrives (or spawn fails/times out).
- **Test cases (Playwright candidates):**
  - Clicking "New" for a group renders a placeholder skeleton card with the `animate-pulse` class at the top of that group.
  - Clicking "New" disables that group's "New" button while a spawn is in progress.
  - The "New" button of other groups remains enabled while one group is spawning.
  - When the real session card for that cwd appears, the placeholder skeleton card is removed.
  - On spawn failure the placeholder is removed and an error toast is shown.
- **Drift risk:** Medium — placeholder/skeleton spawn feedback is a fairly stable UX pattern, but later session-card redesigns may have altered the group/button structure it hooks into.

### 2026-03-27-server-side-directory-services
- **Date:** 2026-03-27
- **Frontend surface:** OpenSpec view / session history (directory-keyed)
- **User-facing behavior:** Pinned directories with no active sessions still show OpenSpec state and historical sessions, sourced from the server rather than a bridge.
- **Test cases (Playwright candidates):**
  - A pinned directory with no active sessions displays its OpenSpec data.
  - A pinned directory with no active sessions displays its historical session list.
  - A directory with active sessions shows the same OpenSpec data as before the change.
- **Drift risk:** Medium — mostly a data-sourcing refactor; the OpenSpec/history UI it feeds is stable but keying by cwd could shift with later plugin extractions.

### 2026-03-28-interactive-ui-dialogs
- **Date:** 2026-03-28
- **Frontend surface:** ChatView interactive dialog cards (confirm/select/input/editor), tool-renderer registry
- **User-facing behavior:** When a pi extension calls `ctx.ui.confirm/select/input/editor`, the dashboard renders an interactive dialog card inline in the chat; the user responds and the reply is relayed to pi. Resolved dialogs collapse to a compact summary card.
- **Test cases (Playwright candidates):**
  - An `extension_ui_request` confirm renders an inline card with confirm/cancel buttons in the chat.
  - Clicking a confirm button resolves the dialog and collapses it to a summary card showing the result.
  - A select request renders an inline dropdown; choosing an option sends the response and collapses to a summary.
  - An input request renders a text field; submitting text relays the value and collapses to a summary.
  - An editor request renders a textarea card; submitting relays the edited content.
  - The retired `ExtensionUI.tsx` component no longer renders (new registry-based cards render instead).
- **Drift risk:** Medium — early inline-dialog implementation; renderer registry pattern is stable but card visuals may have been restyled by later chat/tool-renderer work.

### 2026-03-28-mobile-responsive-layout
- **Date:** 2026-03-28
- **Frontend surface:** Mobile (<768px) master-detail navigation — MobileShell, simplified session cards, kebab menu, slide/swipe transitions
- **User-facing behavior:** On mobile the session list is a full-width home screen; tapping a card slides to a full-width detail; a left-edge swipe navigates back; the detail header has a kebab (⋮) dropdown holding all session actions; simplified cards drop action buttons; TokenStatsBar is hidden; touch targets meet 44px.
- **Test cases (Playwright candidates):**
  - At <768px width, the session list renders full-width and tapping a card slides to the full-width session detail.
  - The mobile session detail header exposes a kebab (⋮) dropdown containing session actions (rename, hide, resume, fork, editor, etc.).
  - The mobile session card shows status dot, name, age, model, activity, OpenSpec badge, context bar and cost but no per-action buttons.
  - TokenStatsBar is not rendered in the mobile session detail view.
  - A left-edge swipe (or back gesture) from the session detail returns to the session list.
  - Interactive elements in the mobile view have at least a 44px touch target.
- **Drift risk:** High — early mobile-layout structure predates URL routing and later back-navigation reworks; likely substantially re-plumbed.

### 2026-03-28-openspec-coherence-check
- **Date:** 2026-03-28
- **Frontend surface:** (none — agent skill + persistent JSON file)
- **User-facing behavior:** Adds an agent skill and a proposal-queue JSON file for detecting stale/conflicting proposals; no browser UI.
- **Test cases (Playwright candidates):**
  - (no browser-observable UI behavior)
- **Drift risk:** Low — tooling/skill only, no dashboard UI surface.

### 2026-03-28-session-tree-navigation
- **Date:** 2026-03-28
- **Frontend surface:** Client tree panel component (session branch structure with rollback/fork buttons)
- **User-facing behavior:** The dashboard shows a session's branch/tree structure and lets the user trigger rollback (tree navigation) or fork on each node, rebuilding the chat view for the new branch.
- **Test cases (Playwright candidates):**
  - The tree panel renders the session's branch structure with a node per entry.
  - Each tree node shows rollback and fork buttons.
  - Clicking a node's rollback button navigates the tree and rebuilds the chat view for that branch.
  - Clicking a node's fork button triggers the fork operation.
  - The internal `__dashboard` command does not appear in the session's commands list.
- **Drift risk:** Medium — early branching UI (tasks left unchecked) that may have been reworked or never fully shipped in this form.

### 2026-03-28-terminal-emulator
- **Date:** 2026-03-28
- **Frontend surface:** Sidebar terminal cards, folder group header ([>_ Term] button), xterm.js terminal view
- **User-facing behavior:** Users spawn browser-based terminals that appear as cyan-accented cards in the sidebar mixed with agent cards, switch between them instantly, rename them, and close them by exiting the shell.
- **Test cases (Playwright candidates):**
  - Clicking the [>_ Term] button in a folder group header creates a new terminal card in that group.
  - A terminal card displays a cyan left-border accent and a `>_` icon, distinguishing it from agent cards.
  - Clicking a terminal card shows its xterm.js view with prior scrollback preserved after switching away and back.
  - Typing `exit` in a terminal removes its card from the sidebar.
  - Terminal cards can be drag-and-drop reordered alongside agent cards within a workspace group.
  - The terminal's rendered theme matches the active dashboard theme.
- **Drift risk:** Medium — core terminal card UI is a substantial stable feature, though header button layout and card styling may shift.

### 2026-03-29-ask-user-card-visual-indicator
- **Date:** 2026-03-29
- **Frontend surface:** SessionCard `ActivityIndicator` (ask_user waiting state)
- **User-facing behavior:** A session waiting on an `ask_user` prompt shows a distinct "Waiting for input" label and a different (purple) pulse color instead of the generic working pulse.
- **Test cases (Playwright candidates):**
  - A session card whose `currentTool` is `ask_user` applies the `card-input-pulse` class.
  - A streaming session card with a non-`ask_user` tool applies the `card-working-pulse` class.
  - The `ActivityIndicator` renders the text "Waiting for input" when `currentTool` is `ask_user`.
- **Drift risk:** Medium — the "waiting for input" distinction is a durable behavior, but the specific pulse color/label styling may have been retuned since.

### 2026-03-29-filesystem-browser
- **Date:** 2026-03-29
- **Frontend surface:** PathPicker widget inside PinDirectoryDialog (typeahead input + directory list)
- **User-facing behavior:** The Pin Directory dialog replaces its plain text input with a keyboard-first path picker: typing filters a directory list, Tab descends into the highlighted folder, Enter confirms, clicking an entry or `..` navigates, and git/pi projects are visually flagged.
- **Test cases (Playwright candidates):**
  - Opening the Pin Directory dialog shows a text input with a directory list beneath it.
  - Typing in the input filters the visible directory entries.
  - Pressing Tab on a highlighted entry descends into that directory and refreshes the list.
  - Clicking a directory entry descends into it; clicking `..` navigates to the parent.
  - Arrow keys move the highlight and Enter confirms the current path.
  - Directory entries that are git repos or pi projects show their visual indicators.
- **Drift risk:** Medium — the picker is reusable and stable, but dialog chrome and integration points may have shifted.

### 2026-03-29-fix-multi-edit-diff-render
- **Date:** 2026-03-29
- **Frontend surface:** EditToolRenderer (chat tool-call diff view)
- **User-facing behavior:** Edit tool calls using the `edits[]` array format render a syntax-highlighted diff per edit instead of raw JSON.
- **Test cases (Playwright candidates):**
  - An Edit tool result with an `edits[]` array renders multiple stacked DiffView blocks separated by a thin divider.
  - An Edit tool result with single `oldText`/`newText` renders one DiffView.
  - An Edit tool result with neither format falls back to a raw JSON display.
- **Drift risk:** Medium — early tool-renderer visual detail that later renderer refactors may replace.

### 2026-03-29-oauth-authentication
- **Date:** 2026-03-29
- **Frontend surface:** (mostly server middleware; login redirect for non-localhost access)
- **User-facing behavior:** Remote (non-localhost) dashboard access requires OAuth login via GitHub/Google/Keycloak/OIDC; localhost stays login-free.
- **Test cases (Playwright candidates):**
  - Accessing the dashboard over a non-localhost/tunnel origin without a session redirects to an OAuth login flow.
  - Accessing the dashboard on localhost loads without any login prompt.
  - A user not in `auth.allowedUsers` is denied access after authenticating.
- **Drift risk:** Low — foundational auth gating behavior that later changes build on rather than replace.

### 2026-03-29-pwa-qr-code-support
- **Date:** 2026-03-29
- **Frontend surface:** SessionSidebar header QR code button + QrCodeDialog, PWA manifest/service worker
- **User-facing behavior:** When a tunnel is active, a QR code button appears in the sidebar header; clicking it opens a dialog with a scannable QR of the tunnel URL and copyable URL text. The app is installable as a PWA.
- **Test cases (Playwright candidates):**
  - The QR code button in the sidebar header is visible only when a tunnel is active.
  - Clicking the QR code button opens the QrCodeDialog rendering a QR canvas.
  - The QrCodeDialog displays the tunnel URL as copyable text below the QR code.
  - Clicking the copy button copies the tunnel URL to the clipboard.
  - The page links a web app manifest and theme-color meta for PWA installability.
- **Drift risk:** Medium — the QR/tunnel affordance is niche and its sidebar-header placement may have shifted in later sidebar redesigns.

### 2026-03-29-unified-mobile-navigation
- **Date:** 2026-03-29
- **Frontend surface:** MobileShell navigation (Settings page, Zrok/Tunnel-setup page, markdown preview panel, mobile session header, mobile kebab menu)
- **User-facing behavior:** On mobile, Settings and Tunnel-setup open as in-shell detail panels, swipe-back works reliably, markdown preview opens without a selected session, and OpenSpec commands plus an attach/detach control appear in the mobile session header.
- **Test cases (Playwright candidates):**
  - Navigating to `/settings` on a mobile viewport renders it inside MobileShell as a depth-1 detail panel (not a bypassed full page).
  - Navigating to `/tunnel-setup` on a mobile viewport renders it inside MobileShell as a depth-1 detail panel.
  - Swiping from the left edge (within a 40px zone) on a mobile detail panel navigates back to the previous depth.
  - Opening a markdown preview (P/S/D/T artifact button) from the sidebar with no session selected renders the preview panel.
  - Opening the mobile kebab menu shows OpenSpec commands (Read, Explore, Continue, FF, Apply, Verify, Archive).
  - The mobile session header shows a separate paperclip attach/detach icon.
- **Drift risk:** Medium — mobile navigation shell is structural and feature-heavy; later mobile redesigns may relocate panels or menu items.

### 2026-03-29-zrok-tunnel-management
- **Date:** 2026-03-29
- **Frontend surface:** Sidebar action bar "Tunnel" button + tunnel status / installation-guide content view
- **User-facing behavior:** A Tunnel button in the left sidebar shows the active tunnel URL when connected, or OS-specific zrok install instructions when the binary is missing.
- **Test cases (Playwright candidates):**
  - A Tunnel button appears in the left sidebar action bar next to the settings gear.
  - Clicking the Tunnel button when a tunnel is active shows the public tunnel URL.
  - Clicking the Tunnel button when zrok is not installed shows a platform-specific installation guide.
  - The installation guide shows macOS/Linux/Windows instructions matching the detected OS.
- **Drift risk:** Medium — the tunnel feature is a durable capability, but its button placement moved into the reorganized settings/network pages by 2026-06-15.

### 2026-03-30-ask-user-fixes
- **Date:** 2026-03-30
- **Frontend surface:** Interactive UI cards (confirm, select, input, multiselect renderers)
- **User-facing behavior:** Titles and messages in ask_user interactive cards render markdown (bold, code, links, lists) instead of plain text.
- **Test cases (Playwright candidates):**
  - A confirm card with markdown in its message renders bold/code formatting (not literal asterisks/backticks).
  - A select card title containing markdown renders inline formatting in both pending and resolved states.
  - An input card title containing markdown renders inline formatting.
  - A multiselect card title containing markdown renders inline formatting.
  - Block-level markdown in an inline title context is stripped/unwrapped rather than shown as raw text.
- **Drift risk:** Low — interactive renderer content formatting is stable core behavior.

### 2026-03-30-ask-user-multiselect
- **Date:** 2026-03-30
- **Frontend surface:** MultiselectRenderer (ask_user multiselect card)
- **User-facing behavior:** Users can pick multiple options from a checkbox-style list in an `ask_user` multiselect card and submit all selections.
- **Test cases (Playwright candidates):**
  - A multiselect ask_user card renders a checkbox-style list of options in a pending state.
  - Toggling multiple options and submitting returns all selected items.
  - Cancelling the multiselect shows the cancelled state.
  - After submission, the card shows the resolved selected values.
- **Drift risk:** Medium — the multiselect renderer is a stable feature but ask_user renderers were subsequently modified (e.g. message-body change) and may be restyled.

### 2026-03-30-chat-scroll-lock
- **Date:** 2026-03-30
- **Frontend surface:** ChatView scroll behavior + floating "scroll to bottom" button
- **User-facing behavior:** Scrolling up pauses auto-scroll so incoming messages don't yank the view; a floating button appears to jump back to the latest and resume following.
- **Test cases (Playwright candidates):**
  - When scrolled up away from the bottom, new incoming messages do not auto-scroll the chat to the bottom.
  - When near the bottom, new incoming messages auto-scroll to the latest content.
  - A "scroll to bottom" button appears when the chat is scrolled away from the bottom.
  - The "scroll to bottom" button is hidden when the chat is near the bottom.
  - Clicking the "scroll to bottom" button scrolls the chat to the latest content.
- **Drift risk:** Low — core chat interaction; durable behavior likely still present.

### 2026-03-30-code-review-fixes
- **Date:** 2026-03-30
- **Frontend surface:** MermaidBlock rendering, auth denied page (plus backend tmux/type fixes)
- **User-facing behavior:** Mermaid SVG output is sanitized before injection; the auth-denied page HTML-escapes the email. Mostly non-visual security/type hardening.
- **Test cases (Playwright candidates):**
  - Rendering a Mermaid block with a script-injection payload produces sanitized SVG with no executable script in the DOM.
  - Loading the auth denied page with an email containing HTML shows the email escaped as text, not rendered as markup.
- **Drift risk:** Low — XSS-sanitization behavior is a stable security invariant unlikely to be reverted.

### 2026-03-30-compact-context-usage-bar
- **Date:** 2026-03-30
- **Frontend surface:** ContextUsageBar within SessionCard (desktop + mobile)
- **User-facing behavior:** The context usage bar is shrunk and inlined on the activity/cost row with no visible percentage label (percentage shown only on hover), removing the separate full-width row.
- **Test cases (Playwright candidates):**
  - The context usage bar renders inline on the same row as the activity indicator and cost, not on its own full-width line.
  - In compact mode the bar shows no percentage text label.
  - Hovering the context bar shows a tooltip with the percentage and token counts.
  - On a mobile-width viewport the context bar is inlined on the model/activity/cost row, not a separate bottom row.
- **Drift risk:** High — an early card-density tweak to a region that later card changes (enrich cards, goals) repeatedly rework.

### 2026-03-30-consolidate-openspec-buttons
- **Date:** 2026-03-30
- **Frontend surface:** SessionOpenSpecActions + FolderOpenSpecSection (+ Change / Explore / Attach combo)
- **User-facing behavior:** The "+ Change" and "Explore" buttons move into the session card next to the "Attach change…" combo, clarifying they are session-specific rather than folder-level actions.
- **Test cases (Playwright candidates):**
  - In an unattached active session, "+ Change" and "Explore" buttons render inline after the "Attach change…" combo.
  - "+ Change" is not shown when a change is attached or the session is ended.
  - The attached badge line renders a single ArtifactLettersButton (P/D/S/T) with per-letter status colors.
  - Clicking the ArtifactLettersButton opens the proposal artifact.
  - The "Read" button no longer appears in the attached action row.
  - FolderOpenSpecSection no longer renders a "+ Change" button.
- **Drift risk:** High — early OpenSpec button layout later reworked by attach-combo/stepper/URL-routing changes; this specific arrangement likely superseded.

### 2026-03-30-disable-mobile-swipe-refresh
- **Date:** 2026-03-30
- **Frontend surface:** Global page (html/body) — mobile overscroll behavior
- **User-facing behavior:** On mobile browsers, pulling down no longer triggers native pull-to-refresh or overscroll bounce; normal in-page scrolling still works.
- **Test cases (Playwright candidates):**
  - The `html`/`body` element has computed `overscroll-behavior: none`.
  - Chat view and sidebar still scroll normally within their containers.
- **Drift risk:** Low — a small stable global CSS rule.

### 2026-03-30-fix-duplicate-events-on-switch
- **Date:** 2026-03-30
- **Frontend surface:** ChatView / session event list (App.tsx event replay)
- **User-facing behavior:** Switching between session cards no longer shows duplicated messages in the chat view; a full replay resets state before applying.
- **Test cases (Playwright candidates):**
  - Switching from one session card to another and back renders each chat message exactly once (no duplicates).
  - Re-subscribing to a previously viewed session after reconnect shows no duplicated messages.
- **Drift risk:** Low — core chat-rendering correctness behavior likely to remain valid.

### 2026-03-30-zoomable-mermaid-diagrams
- **Date:** 2026-03-30
- **Frontend surface:** MermaidBlock diagram viewport (zoom/pan controls)
- **User-facing behavior:** Users click a Mermaid diagram to activate zoom mode, then wheel-zoom, drag-pan, double-click to reset, and exit via Escape or click-outside; activated diagrams show zoom control buttons.
- **Test cases (Playwright candidates):**
  - Before activation, hovering a Mermaid diagram shows a "Click to zoom & pan" hint and page scroll passes through.
  - Clicking a diagram enters zoom mode and reveals the zoom in/out/reset control overlay.
  - In zoom mode, wheel scroll changes the diagram's CSS transform scale and double-click resets it.
  - Pressing Escape or clicking outside deactivates zoom mode and hides the controls.
  - A chat bubble containing a Mermaid diagram is widened to ~95% of the content area.
- **Drift risk:** Medium — interaction-heavy feature on MermaidBlock, which later editor/preview changes reuse and may adjust.

### 2026-03-31-auth-bypass-url-list
- **Date:** 2026-03-31
- **Frontend surface:** Settings panel — auth bypass URLs list
- **User-facing behavior:** A Settings control lets users manage a list of URL path prefixes/patterns that bypass authentication.
- **Test cases (Playwright candidates):**
  - Settings exposes a `bypassUrls` list/input control for auth bypass paths.
  - Adding a URL path prefix to the bypass list and saving persists it across reload.
- **Drift risk:** Medium — most of the change is server auth logic; the Settings list is a small addition that may be folded into other auth controls.

### 2026-03-31-fix-ask-user-race-cancellation
- **Date:** 2026-03-31
- **Frontend surface:** Interactive UI cards — dismissed state
- **User-facing behavior:** When the TUI answers an ask_user prompt first, the corresponding dashboard interactive card transitions from pending to a dismissed state instead of staying stuck pending.
- **Test cases (Playwright candidates):**
  - A pending interactive card transitions to a dismissed state when an `extension_ui_dismiss` message arrives.
  - A dismissed interactive card no longer shows active/answerable controls.
- **Drift risk:** Low — a targeted state-transition fix on a stable renderer.

### 2026-03-31-mobile-openspec-unattached-actions
- **Date:** 2026-03-31
- **Frontend surface:** MobileActionMenu (mobile kebab menu)
- **User-facing behavior:** On mobile, when no proposal is attached to a live session, the kebab menu offers "Explore" and "+ New Change" rows to start OpenSpec workflows.
- **Test cases (Playwright candidates):**
  - Opening the mobile kebab menu on a live session with no attached proposal shows "Explore" and "+ New Change" rows.
  - Clicking "+ New Change" opens the NewChangeDialog; clicking "Explore" opens the ExploreDialog.
  - The unattached OpenSpec rows are hidden when the session is ended.
  - The unattached OpenSpec rows are hidden when a proposal is already attached.
- **Drift risk:** Medium — mobile action menu is a distinct surface that later mobile UI changes may restructure.

### 2026-03-31-pi-resources-browser
- **Date:** 2026-03-31
- **Frontend surface:** PiResourcesView + ⚙️ folder-header button + MarkdownPreviewView navigation
- **User-facing behavior:** A ⚙️ button in the folder header opens a resources view listing a workspace's pi extensions/skills/prompts grouped by scope, with a "View" action to read each file.
- **Test cases (Playwright candidates):**
  - Clicking the ⚙️ button in a folder header navigates to the PiResourcesView for that workspace.
  - PiResourcesView lists resources grouped by scope (local, global, packages) with name/description/source/path metadata.
  - Clicking "View" on a `.md` resource opens it in the MarkdownPreviewView with a back button.
  - Clicking "View" on a `.ts` resource opens it rendered as code.
  - The navigation stack (Chat → Resources → Preview) supports stepping back through each level.
- **Drift risk:** Medium — an early standalone view; navigation was later reworked to URL-driven routing, so entry/back mechanics likely changed.

### 2026-03-31-pwa-install-prompt
- **Date:** 2026-03-31
- **Frontend surface:** Sidebar icon row (InstallButton), mobile InstallBanner, index.html head
- **User-facing behavior:** Users see an install button in the sidebar and a dismissible mobile banner prompting them to install the dashboard as a PWA (with iOS-specific "Add to Home Screen" guidance).
- **Test cases (Playwright candidates):**
  - When `beforeinstallprompt` fires (canInstall true), the InstallButton is visible in the sidebar icon row next to the Tunnel button.
  - When the app is running in standalone/installed mode, the InstallButton is not rendered.
  - Clicking the InstallButton triggers the native install prompt.
  - On mobile with canInstall true, the InstallBanner renders with an install action.
  - On iOS, the InstallBanner shows "Add to Home Screen" guidance text instead of an install button.
  - Dismissing the InstallBanner sets `localStorage["pwa-install-dismissed"]` and the banner stays hidden across reload.
  - The document head contains `<link rel="apple-touch-icon" href="/icon-192.png">`.
- **Drift risk:** Medium — PWA install UI is a discrete add-on unlikely to be structurally rebuilt, but banner placement/dismissal styling can shift with layout changes.

### 2026-04-01-flow-dashboard-integration
- **Date:** 2026-04-01
- **Frontend surface:** FlowDashboard sticky panel atop ChatView (agent-card grid), agent detail view
- **User-facing behavior:** When a flow runs, a sticky panel of agent cards (live status, tool calls, tokens, duration, loop badges) appears at the top of the chat; clicking a card opens a full agent detail view with tool history and assistant text.
- **Test cases (Playwright candidates):**
  - When a flow is active, a FlowDashboard panel with a grid of agent cards appears at the top of ChatView.
  - Each agent card shows live status, tool-call count, tokens, and duration.
  - An agent card displays a loop badge when the agent is looping.
  - Clicking an agent card replaces the chat view with a full agent detail view (tool history + assistant text).
  - When no flow is active, the FlowDashboard panel is not rendered.
- **Drift risk:** High — this is the original flow visualization surface, and multiple later flow changes (06-26, 06-29) reworked flow rendering/interaction, so this early version is likely superseded.

### 2026-04-02-archive-spec-reader
- **Date:** 2026-04-02
- **Frontend surface:** FolderOpenSpecSection `[Archive]` button + `ArchiveBrowserView` content area
- **User-facing behavior:** An `[Archive]` button next to `[Specs]` opens a searchable, date-grouped list of archived OpenSpec changes, and clicking artifact letters (P D S T) opens the archived artifact inline.
- **Test cases (Playwright candidates):**
  - The `[Archive]` button renders next to `[Specs]` when OpenSpec is initialized.
  - Clicking `[Archive]` opens the archive browser with archived changes grouped by date newest-first.
  - Typing in the archive search input filters the listed archived changes.
  - Clicking an artifact letter (P/D/S/T) on a row opens the artifact reader inline; clicking Back returns to the archive list.
- **Drift risk:** Low — self-contained OpenSpec reader surface with clear structure, unlikely superseded.

### 2026-04-02-git-branch-selector
- **Date:** 2026-04-02
- **Frontend surface:** GroupGitInfo branch icon (folder group header) + BranchPicker dialog
- **User-facing behavior:** Users click a branch icon in the folder group header to open a typeahead picker and switch git branches without leaving the dashboard, with stash prompts for dirty trees.
- **Test cases (Playwright candidates):**
  - Clicking the branch icon in a folder group header opens the BranchPicker dialog.
  - With no git repo, the branch icon renders dimmed and clicking it triggers the git-init flow.
  - On a detached HEAD, the branch indicator shows a short commit SHA instead of a branch name.
  - Typing in the BranchPicker input filters the branch list to matching entries.
  - The current branch is marked with `●` in the BranchPicker list.
  - Remote branches appear in a separate visual section from local branches in the picker.
  - Selecting a branch when the working tree is dirty opens a stash confirmation dialog.
  - After stash + checkout, a dialog asks whether to pop the stash on the new branch.
  - Individual session GitInfo remains read-only (no clickable branch switch).
- **Drift risk:** Medium — interactive git UI in a header; branch/worktree flows evolved in later changes (worktree checkout, PR mode), but the picker itself is a distinct surface likely still present.

### 2026-04-02-mermaid-rerender-fix
- **Date:** 2026-04-02
- **Frontend surface:** ChatView MermaidBlock / MarkdownContent rendering
- **User-facing behavior:** Mermaid diagrams no longer blink or flash "Loading diagram…" on every incoming WebSocket message during active sessions.
- **Test cases (Playwright candidates):**
  - A rendered Mermaid diagram does not flash a "Loading diagram…" placeholder when new chat events stream in.
  - A Mermaid diagram remains visibly stable (no unmount/remount flicker) while messages arrive in an active session.
- **Drift risk:** Low — a render-stability fix on a core chat rendering path; unlikely regressed intentionally.

### 2026-04-02-theme-aware-code-rendering
- **Date:** 2026-04-02
- **Frontend surface:** SyntaxHighlighter usage (MarkdownContent, ReadToolRenderer, WriteToolRenderer), DiffView, BashToolRenderer, ZrokInstallGuide
- **User-facing behavior:** Code blocks, diffs, and syntax highlighting respect the active theme — backgrounds use `--bg-code`, token colors match the selected theme, and diff/bash-prompt colors use theme accent variables.
- **Test cases (Playwright candidates):**
  - A code block's background matches the theme `--bg-code` value rather than the highlighter's embedded background.
  - Switching to a non-base theme (e.g. Dracula/Nord) changes syntax token colors in Read/Write tool renderers.
  - Diff view added/removed lines use theme accent colors, not fixed Tailwind green/red, and change when the theme changes.
  - The bash prompt in BashToolRenderer uses the theme's `--accent-green` color.
  - Bare `<code>` elements in ZrokInstallGuide render with a background instead of unstyled.
- **Drift risk:** Medium — early theming polish; syntax/diff color plumbing is frequently revisited, so specific styling details may be superseded even if theme-awareness persists.

### 2026-04-02-use-flow-list-events
- **Date:** 2026-04-02
- **Frontend surface:** SessionFlowActions, SessionHeader (flow list/menu)
- **User-facing behavior:** Users see the list of available flows (with names/descriptions) sourced from real flow metadata, and can trigger /flows:new and /flows:edit actions.
- **Test cases (Playwright candidates):**
  - The flow actions menu lists flows by name matching the `flow_catalog` data via `useFlowCatalog` (not filtered command heuristics). Core `flows_list` removed.
  - Each listed flow shows its description metadata when present.
  - Triggering "new flow" from SessionFlowActions initiates the flow-new action without an error state.
  - Triggering "edit flow" for an existing flow opens the edit action.
- **Drift risk:** Medium — the data source was refactored but the visible flow-list UI is a stable surface; rendering details may evolve.

### 2026-04-03-large-file-decomposition
- **Date:** 2026-04-03
- **Frontend surface:** App shell, SessionList, ChatView, layout variants (structural refactor only)
- **User-facing behavior:** No visible change — internal extraction of hooks, layout components, and reducers; UI behaves exactly as before.
- **Test cases (Playwright candidates):**
  - Dashboard renders SessionList, desktop and mobile layouts unchanged after the refactor (regression smoke: sessions list, select a session, chat view renders).
- **Drift risk:** Low — pure structural refactor with no behavioral change; assertions map to stable core flows.

### 2026-04-03-session-file-diff-view
- **Date:** 2026-04-03
- **Frontend surface:** "Changed Files" session diff view (file tree + diff viewer) opened from the session header
- **User-facing behavior:** A "Changed Files" button in the session header opens a split view: file tree on the left with add/modify/delete indicators and +/- stats, and a GitHub-style syntax-highlighted diff on the right, with a toggle between diff and current-content and between side-by-side and unified.
- **Test cases (Playwright candidates):**
  - Clicking "Changed Files" in the session header opens the diff view with a file tree pane and a diff pane.
  - Selecting a file in the tree renders its unified diff in the viewer.
  - File tree entries show change-status indicators (added/modified/deleted) and aggregate +/- line stats.
  - Toggling between side-by-side and unified diff modes changes the diff layout.
  - Toggling between diff view and current file content view swaps the right pane content.
- **Drift risk:** Medium — third-party diff library and split layout are stable, but the entry point and view chrome may have been reorganized by later navigation changes.

### 2026-04-04-browser-provider-auth
- **Date:** 2026-04-04
- **Frontend surface:** Settings provider-auth section + `/provider-callback` route
- **User-facing behavior:** Users can OAuth-login to subscription providers via a browser popup and enter API keys for key-based providers from Settings, seeing per-provider auth status and expiry.
- **Test cases (Playwright candidates):**
  - Settings renders a provider-auth section listing providers with their authenticated/expiry status and login/logout controls.
  - Clicking an OAuth provider's login control opens the provider consent popup.
  - Entering and saving an API key for a key-based provider persists and reflects an authenticated status.
  - The `/provider-callback` route renders the callback relay page.
- **Drift risk:** Medium — core remote-auth feature, but Settings auth UI layout and provider list evolve over time.

### 2026-04-04-browser-visual-debug
- **Date:** 2026-04-04
- **Frontend surface:** (none — agent tooling skill, no dashboard UI change)
- **User-facing behavior:** Adds a browser-automation tool/skill for agents; nothing rendered differently in the dashboard web client.
- **Test cases (Playwright candidates):**
  - (no browser-observable UI behavior)
- **Drift risk:** Low — tooling/skill addition decoupled from the web client UI.

### 2026-04-04-chat-refresh-button
- **Date:** 2026-04-04
- **Frontend surface:** SessionHeader (chat view header) refresh icon
- **User-facing behavior:** A refresh icon in the chat header re-fetches the current session's events with a brief spinning state, without a full page reload.
- **Test cases (Playwright candidates):**
  - The SessionHeader renders a refresh icon button next to the other action icons.
  - Clicking the refresh button triggers an event re-subscribe/replay (icon enters a spinning/loading state).
  - After clicking refresh, selected session and other client state remain unchanged (no full page reload).
- **Drift risk:** Medium — small isolated header affordance, but header icon layout is a frequently revisited area.

### 2026-04-04-fix-duplicate-questions
- **Date:** 2026-04-04
- **Frontend surface:** ChatView — ToolCallStep vs InteractiveUiCard for ask_user
- **User-facing behavior:** An `ask_user` question renders only once (as the live interactive card) instead of appearing twice.
- **Test cases (Playwright candidates):**
  - When `ask_user` is invoked, exactly one interactive card renders (no duplicate).
  - The `ask_user` tool call renders as a standard collapsible tool step (not a second InteractiveRenderer); expanding it shows the raw result.
  - Non-ask_user tool calls still render as normal tool steps (unaffected).
- **Drift risk:** Medium — dedup logic is stable in intent, but the ask_user rendering path was touched by several nearby changes.

### 2026-04-04-inline-image-tool-results
- **Date:** 2026-04-04
- **Frontend surface:** ReadToolRenderer / ToolCallStep image rendering in tool results
- **User-facing behavior:** When a Read tool returns an image, the dashboard shows the image inline (auto-expanded) instead of a text placeholder.
- **Test cases (Playwright candidates):**
  - A Read tool result with an image content block renders an `<img>` element (max-width ~512px, bordered/rounded).
  - A Read tool result with text-only content renders a syntax-highlighted code block, not an image.
  - A tool call with an image result is auto-expanded so the image is visible without clicking.
  - After reload, a persisted image tool result still renders inline (replay path).
- **Drift risk:** Medium — depends on ToolCallStep/ReadToolRenderer, which later editor/preview changes may refactor.

### 2026-04-04-settings-tabbed-layout
- **Date:** 2026-04-04
- **Frontend surface:** Settings panel (tab bar, fixed header with Save/Restart, tab content area)
- **User-facing behavior:** The Settings page is split into General/Providers/Security/Advanced tabs with a pinned header and tab bar; only the active tab's content scrolls.
- **Test cases (Playwright candidates):**
  - The Settings header (back, title, Restart, Save) and tab bar remain visible/pinned while the tab content scrolls.
  - Clicking the Providers tab switches the visible content to the Provider Authentication and LLM Providers sections.
  - Clicking through General/Providers/Security/Advanced each renders that tab's distinct sections.
  - Modifying a field on one tab and a field on another tab, then clicking Save, sends all changed values in one save.
  - The Settings page renders exactly four tabs: General, Providers, Security, Advanced.
- **Drift risk:** Low — tabbed Settings is a structural core layout likely to persist, though tab membership may shift as settings are added.

### 2026-04-04-specs-browser-and-search
- **Date:** 2026-04-04
- **Frontend surface:** OpenSpec folder header (Specs button, Bulk Archive), SpecsBrowserView, MarkdownPreviewView search overlay
- **User-facing behavior:** Users open a specs browser from the folder header, jump to a spec via combobox, and search/highlight text inside markdown previews. Bulk Archive moves to session cards.
- **Test cases (Playwright candidates):**
  - Clicking the Specs button on the folder header opens the specs browser in the content area.
  - Selecting a spec name in the combobox scrolls that spec heading into view.
  - Typing in the markdown search input wraps matches in `<mark>` and shows an N/M match counter.
  - Clicking the next (▼) button scrolls to the next highlighted match and wraps at the last match.
  - The Bulk Archive button appears on the session card (not the folder header) only when a completed change exists.
- **Drift risk:** Medium — the specs-browser entry point and Bulk Archive placement are structural and could be relocated by later UI reshuffles.

### 2026-04-04-ui-tweaks-image-collapse-fix
- **Date:** 2026-04-04
- **Frontend surface:** Pending/echoed image previews, ResizableSidebar (collapse chevron, default width), folder card pin/folder icons, selected SessionCard highlight, Mermaid diagram fonts
- **User-facing behavior:** Several UI fixes — pasted images survive server echo, the sidebar collapse chevron moves to the sidebar edge, default sidebar width becomes 500px, folder cards show a single right-side pin toggle plus a left folder-open/closed icon, the selected session card gets a stronger highlight, and Mermaid diagrams use a non-monospace font.
- **Test cases (Playwright candidates):**
  - A pasted image still renders as an image (not a broken "🖼 Attachment 1" placeholder) after the server echoes the message back.
  - The sidebar collapse chevron renders on the sidebar edge/drag handle, not in the SessionList header toolbar.
  - The sidebar opens at 500px default width.
  - A pinned folder card shows a single yellow pin toggle on the right (no redundant left-side pin), and a folder open/closed icon on the left reflecting collapse state.
  - The selected session card renders with the stronger highlight (blue border + tint + ring) instead of only a thin left border.
  - The mobile SessionCard variant shows a selected-state highlight.
  - A Mermaid diagram renders with a non-monospace font (not forced monospace).
- **Drift risk:** High — a bundle of early cosmetic tweaks (widths, icon placement, highlight styling); highly likely to be re-tuned or superseded by later visual changes.

### 2026-04-07-add-button-icons
- **Date:** 2026-04-07
- **Frontend surface:** ~40+ buttons across dialogs, SessionCard, SessionHeader, FlowDashboard, FileDiffView, and OpenSpec/diff panels
- **User-facing behavior:** Buttons across dialogs and session/flow controls show MDI icons (often icon + text), replacing plain text/emoji/Unicode symbols like ✕, ▶, ←, ↻.
- **Test cases (Playwright candidates):**
  - The ExploreDialog and NewChangeDialog close buttons render an `mdiClose` SVG icon instead of the ✕ character.
  - SessionCard Resume and Fork buttons render `mdiPlayCircleOutline` / `mdiSourceFork` SVG icons.
  - SessionHeader Attach/Detach/Flow/Changed-Files buttons render their respective MDI SVG icons instead of emoji/Unicode.
  - FileDiffView Back and Refresh buttons render `mdiArrowLeft` / `mdiRefresh` SVG icons instead of ← / ↻.
- **Drift risk:** High — broad icon-on-buttons pass across many components likely restyled/superseded by later UI iterations.

### 2026-04-07-agent-tool-card
- **Date:** 2026-04-07
- **Frontend surface:** ChatView tool cards — AgentToolRenderer (Agent / get_subagent_result / steer_subagent), AgentCardShell
- **User-facing behavior:** Agent-family tool calls render as rich, live-updating cards (status icon, name header, stats line, always-visible prompt and markdown result) instead of raw JSON, and running cards transition to completed correctly.
- **Test cases (Playwright candidates):**
  - An `Agent` tool call renders a custom agent card (not raw JSON generic renderer).
  - A running `Agent` tool card is expanded by default.
  - The agent card shows a status icon, name header, and stats line.
  - After completion, the agent card shows a completed status (not stuck on "running").
  - A session loaded from disk (replay) renders the agent card correctly.
  - The agent card displays the prompt and a rendered markdown result.
- **Drift risk:** Medium — an early tool-renderer card; later font-size unification and intent-rendering changes touch the same renderers, so structure may have shifted.

### 2026-04-07-folder-editor-terminals
- **Date:** 2026-04-07
- **Frontend surface:** Sidebar folder action bar, TerminalsView (tabbed terminals), EditorView (embedded code-server)
- **User-facing behavior:** Terminal cards leave the sidebar; a folder gains an action bar (`+Session`, `+Terminal`, `Terminals(N)`, `Editor`, `Zed`, `Pi Resources`). Terminals open in a tabbed content view; an embedded VS Code editor opens per folder with loading/stop states.
- **Test cases (Playwright candidates):**
  - Terminal cards do not appear as individual cards in a folder group in the sidebar.
  - Folder action bar renders buttons `+Session`, `+Terminal`, `Terminals(N)`, `Editor`, `Zed`, and `Pi Resources`.
  - Clicking `+Terminal` creates a terminal and navigates to the TerminalsView.
  - The `Terminals(N)` badge count increases by one after creating an additional terminal.
  - TerminalsView shows a tab bar with one tab per open terminal, each showing name, active indicator, and close/rename actions.
  - Clicking `[+ New]` in TerminalsView adds another terminal tab.
  - Clicking `Editor` opens EditorView showing a loading state, then an iframe with the code-server UI.
  - EditorView header shows the folder path and a stop button.
  - Clicking the stop button in EditorView terminates the instance.
  - When the editor binary is absent, EditorInstallGuide renders with a "Retry Detection" button.
- **Drift risk:** Medium — large multi-surface feature; the action-bar layout and button set are plausible to be re-labelled/reordered in later changes, but the terminals/editor views are structural and likely stable.

### 2026-04-07-force-kill-escalation
- **Date:** 2026-04-07
- **Frontend surface:** CommandInput Stop button, ToolCallStep inline stop button, collapsed repeated tool-call group
- **User-facing behavior:** The Stop button escalates from soft Abort (click 1) to Force Kill (click 2) with a visual state change; running tool cards get an inline stop button; and consecutive near-identical tool calls collapse into one expandable group.
- **Test cases (Playwright candidates):**
  - Clicking the Stop button once transitions it into a "Force Stop" state with a distinct (e.g. orange/pulsing) style.
  - Clicking the Stop button a second time issues force-kill and disables the button.
  - The Stop button state machine resets when the session status changes.
  - A running tool call card shows an inline stop button in its header row.
  - Clicking a tool card's inline stop button (twice) escalates from abort to force-kill.
  - Consecutive same-name similar-argument tool calls collapse into a single expandable group.
- **Drift risk:** Medium — the button state machine is fairly stable, but tool-card layout and collapse UI may have been reworked by later chat/tool-renderer changes.

### 2026-04-07-hide-debug-events
- **Date:** 2026-04-07
- **Frontend surface:** ChatView message list + Settings → Advanced ("Chat Display")
- **User-facing behavior:** Raw/debug event cards and debug tool calls are hidden by default; a Settings toggle re-enables them, persisted in localStorage.
- **Test cases (Playwright candidates):**
  - With the default setting, ChatView does not render rawEvent cards (tool_call, tool_result, turn_start).
  - With the default setting, ChatView hides debug tool calls (flow:list-flows, flow:rediscover, resources_discover).
  - Enabling "Show debug events" in Settings → Advanced makes the raw event cards and debug tool calls appear.
  - The "Show debug events" toggle state persists across reload via localStorage.
- **Drift risk:** Low — a persisted display preference tied to stable ChatView/Settings surfaces.

### 2026-04-07-incremental-event-sync
- **Date:** 2026-04-07
- **Frontend surface:** Chat event sync / reconnect behavior (no new visible control)
- **User-facing behavior:** Reconnecting or re-selecting a session replays only new events (delta) instead of everything, reducing visible reconnect latency; a stale client triggers a state reset + full replay.
- **Test cases (Playwright candidates):**
  - Re-selecting a previously viewed session does not visibly re-render all historical events from scratch (delta sync), and chat content remains intact.
  - When the client's tracked seq exceeds the server max, the chat view resets and fully replays events without duplication.
- **Drift risk:** Low — protocol/behavioral optimization of a core stable data path; little direct DOM surface.

### 2026-04-07-package-manager-ui
- **Date:** 2026-04-07
- **Frontend surface:** PackageBrowser / package management view (search, install/remove/update, installed list), progress feedback
- **User-facing behavior:** Users browse the npm registry, view READMEs, and install/remove/update pi packages from the dashboard, seeing real-time progress and auto-reload of sessions after changes.
- **Test cases (Playwright candidates):**
  - Entering a search query in the package browser shows npm results filtered to pi-packages.
  - Selecting a package displays its README content.
  - The installed-packages list renders entries for the current scope (global/local).
  - Clicking Install streams progress feedback (e.g. cloning / npm install) in the UI during the operation.
  - Starting a package operation while another is running surfaces a busy/409 state rather than launching concurrently.
- **Drift risk:** Medium — an early full feature surface; its card/state-update UX was patched by later changes (see 2026-04-20 package card instant update), so specifics may have shifted.

### 2026-04-08-butterfly-token-chart
- **Date:** 2026-04-08
- **Frontend surface:** TokenStatsBar (butterfly chart + stats panel), ChatView scroll-to-turn
- **User-facing behavior:** The token chart shows input bars growing up (blue) and output bars growing down (purple) around a center axis, each half independently scaled, with a left stats panel; clicking a bar scrolls ChatView to that turn's user message.
- **Test cases (Playwright candidates):**
  - TokenStatsBar renders an upper input half and lower output half separated by a center axis.
  - Input bars render blue and output bars render purple.
  - Max-value labels `↓{maxInput}` and `↑{maxOutput}` appear above/below their halves.
  - The stats panel on the left shows cumulative totals, cache R/W, and cost.
  - Clicking a bar scrolls ChatView to the message with the matching `data-turn` index.
  - Bars show a `cursor-pointer` affordance.
- **Drift risk:** Medium — a distinctive chart redesign; later token/context-bar gating changes touched this component's structure.

### 2026-04-08-fork-from-message
- **Date:** 2026-04-08
- **Frontend surface:** ChatView MessageBubble toolbar ("Fork from here" button)
- **User-facing behavior:** Each user and assistant message shows a "Fork from here" button alongside the copy buttons; clicking it forks a new session pruned to that message.
- **Test cases (Playwright candidates):**
  - A user message's toolbar shows a "Fork from here" button alongside the copy buttons.
  - An assistant message's toolbar shows a "Fork from here" button.
  - Clicking "Fork from here" on a message triggers a resume/fork action carrying that message's entryId.
- **Drift risk:** Low — message toolbar fork action is a stable core interaction.

### 2026-04-08-image-lightbox
- **Date:** 2026-04-08
- **Frontend surface:** Image lightbox dialog across chat images (messages, tool results, paste previews)
- **User-facing behavior:** Clicking any chat image (message thumbnail, tool-result image, or paste preview) opens a full-size lightbox with dark overlay and zoom/pan; Esc or a backdrop click closes it.
- **Test cases (Playwright candidates):**
  - Clicking an image thumbnail in a chat message opens the lightbox dialog with a dark overlay.
  - Clicking an image in a tool-result (ReadToolRenderer/ToolCallStep) opens the lightbox.
  - Clicking a paste preview in CommandInput opens the lightbox.
  - Pressing Esc closes the open lightbox.
  - Clicking the backdrop outside the image closes the lightbox.
- **Drift risk:** Low — clickable-image-to-lightbox is a stable, self-contained interaction.

### 2026-04-10-error-handling-improvements
- **Date:** 2026-04-10
- **Frontend surface:** ChatView error banner + pending-prompt spinner + session card/workspace error state
- **User-facing behavior:** LLM/provider errors surface as an error banner in the chat; a stuck pending-prompt spinner auto-clears after 30s with an error, and spawn/resume failures show a persistent error state.
- **Test cases (Playwright candidates):**
  - An agent_end carrying an error stopReason renders an error banner at the bottom of ChatView.
  - A pending-prompt spinner clears and shows a timeout error message 30 seconds after the prompt if no clearing event arrives.
  - The pending-prompt spinner clears when agent_start/message_start/agent_end arrives before the timeout.
  - A subsequent agent_start clears a previously shown error banner.
  - A spawn/resume failure shows a persistent error indicator on the session card (not just a transient toast).
- **Drift risk:** Medium — error-state plumbing was later extended by preserve-pending-prompt and optimistic-prompt-progress; banner may persist but spinner semantics evolved.

### 2026-04-10-mdns-server-discovery
- **Date:** 2026-04-10
- **Frontend surface:** Dashboard header — server selector dropdown
- **User-facing behavior:** A server-selector dropdown in the header lists discovered dashboard servers (local + remote); the user can switch connections, with localhost preferred by default.
- **Test cases (Playwright candidates):**
  - The dashboard header renders a server-selector dropdown.
  - The server selector lists the local server as the default/selected entry on load.
  - Selecting a different discovered server from the dropdown switches the active connection.
- **Drift risk:** Medium — discovery mechanism is mostly server/bridge infra; the header dropdown is a new UI element that could be relocated or restyled.

### 2026-04-10-monorepo-split
- **Date:** 2026-04-10
- **Frontend surface:** none (build/packaging restructure into npm workspaces monorepo)
- **User-facing behavior:** Internal restructuring into separate publishable packages; no change to what a user sees in the browser.
- **Test cases (Playwright candidates):**
  - (no browser-observable UI behavior)
- **Drift risk:** Low — infrastructure/packaging change with no UI surface; nothing to drift visually.

### 2026-04-10-session-process-tracker
- **Date:** 2026-04-10
- **Frontend surface:** SessionCard — child-process list with kill button
- **User-facing behavior:** A session card shows active child processes (running >30s) with elapsed time and a red ✕ kill button that terminates the process.
- **Test cases (Playwright candidates):**
  - A session card with reported child processes renders a process list showing each command and its elapsed time.
  - Each listed child process shows a red ✕ kill button.
  - Clicking the ✕ kill button on a process removes it from the card's process list.
  - A session with no long-running child processes shows no process list.
- **Drift risk:** Medium — SessionCard is a frequently-restructured component; the process-list sub-UI could be moved or restyled.

### 2026-04-10-sidebar-header-redesign
- **Date:** 2026-04-10
- **Frontend surface:** Sidebar header (app bar + filter bar)
- **User-facing behavior:** The cluttered single-row sidebar header splits into two rows — Row 1 app-level actions (logo, theme picker, theme toggle, connectivity, settings) and Row 2 session filters ("Active only", "Show hidden") plus the pin button.
- **Test cases (Playwright candidates):**
  - The sidebar header renders two distinct rows.
  - Row 1 contains the π logo, ThemePicker, ThemeToggle, and the Settings gear.
  - Row 2 contains the "Active only" and "Show hidden" toggles on the left and the pin (📌+) button on the right.
  - All 10 controls remain present and clickable after the redesign.
  - Conditional controls (InstallButton, ServerSelector) appear/disappear without shifting the row layout of the other controls.
- **Drift risk:** High — an early header layout restructure; header composition is a frequent redesign target (later theme/connectivity changes likely moved these controls).

### 2026-04-10-trusted-networks
- **Date:** 2026-04-10
- **Frontend surface:** Settings → Network section ("Add Local Network" button); also server-side access guard
- **User-facing behavior:** A Settings network section lets users add trusted local networks (auto-detected CIDRs) so trusted-LAN and authenticated remote users can use protected routes instead of getting 403s.
- **Test cases (Playwright candidates):**
  - The Settings Network section renders an "Add Local Network" button.
  - Clicking "Add Local Network" auto-detects local interfaces/CIDRs and adds them to the trusted-networks list in the UI.
  - (Guard logic itself — loopback/trusted/authenticated → allow, else 403 — is server-side and not directly browser-DOM observable.)
- **Drift risk:** Low — settings affordance plus stable access-control policy.

### 2026-04-11-electron-desktop-bundle
- **Date:** 2026-04-11
- **Frontend surface:** Electron shell window + first-run setup wizard (standalone vs power-user mode, API key config), system tray
- **User-facing behavior:** A packaged desktop app opens a window pointing at the dashboard server, with a first-run wizard to install dependencies / set API keys and a system-tray icon.
- **Test cases (Playwright candidates):**
  - The first-run setup wizard renders standalone and power-user mode options.
  - The wizard exposes an API-key configuration input.
  - After bootstrap, the Electron window loads and renders the dashboard UI.
- **Drift risk:** High — early Electron shell + first-run wizard is a foundational visual/structural surface likely reworked by later Electron bootstrap changes.

### 2026-04-13-ask-user-message-body
- **Date:** 2026-04-13
- **Frontend surface:** InputRenderer, SelectRenderer, MultiselectRenderer (ask_user cards)
- **User-facing behavior:** For input/select/multiselect `ask_user` prompts, a markdown `message` body renders below the title (matching ConfirmRenderer), so detailed instructions and code blocks are shown.
- **Test cases (Playwright candidates):**
  - An `input` ask_user card with a `message` renders the title as a heading and the message as markdown below it.
  - A `select` ask_user card renders the markdown message body below the title.
  - A `multiselect` ask_user card renders the markdown message body below the title.
  - A message containing a code block renders as formatted markdown, not raw text.
- **Drift risk:** Medium — renderer body layout is stable in concept but ask_user renderers were iterated repeatedly and may be restyled.

### 2026-04-13-fix-light-mode-button-contrast
- **Date:** 2026-04-13
- **Frontend surface:** Sidebar action buttons (Install, Tunnel, Settings, Pin directory) icon color
- **User-facing behavior:** Sidebar action button icons use a higher-contrast color so they are visible in light mode (previously near-invisible), while remaining fine in dark mode.
- **Test cases (Playwright candidates):**
  - In light mode, sidebar action button icons (Install/Tunnel/Settings/Pin) use the `--text-tertiary` color (visible, not `--text-muted`).
  - The Install button icon is visibly rendered in light mode.
  - Sidebar action button icons remain visible in dark mode.
- **Drift risk:** Medium — a token-level contrast tweak; later theme/token overhauls may have changed the specific variables used.

### 2026-04-15-known-servers-management
- **Date:** 2026-04-15
- **Frontend surface:** ServerSelector (header dropdown), SettingsPanel Servers section, Network discovery section
- **User-facing behavior:** The header server dropdown lists persistent known servers with live availability, and a Settings "Servers" section lets users add/remove known servers and add mDNS-discovered ones with a friendly label.
- **Test cases (Playwright candidates):**
  - The header ServerSelector dropdown lists known servers with their labels.
  - The ServerSelector dropdown shows a "Manage servers…" button at the top that navigates to the Servers tab in Settings.
  - The Settings Servers section lists known servers each with a remove button.
  - Submitting the "Add server" form adds a server to the known-servers list.
  - Clicking remove on a known server removes it from the list.
  - The Network discovery section shows mDNS-discovered servers with an "Add" button that prompts for a label before saving.
- **Drift risk:** Medium — multi-part server-management UI that could be restructured as discovery/connection features evolve.

### 2026-04-18-fix-windows-server-parity
- **Date:** 2026-04-18
- **Frontend surface:** None (server launchers, `/api/restart`, jiti loader, logging)
- **User-facing behavior:** Fixes Windows server auto-start, restart, and port-holder killing; no browser-rendered UI change (server availability only).
- **Test cases (Playwright candidates):**
  - (no browser-observable UI behavior)
- **Drift risk:** Low — server/infra parity work with no UI surface.

### 2026-04-19-consolidate-tool-resolution
- **Date:** 2026-04-19
- **Frontend surface:** Tools/diagnostics settings area (backed by `/api/tools`); primarily server/shared infra
- **User-facing behavior:** Tool resolution is centralized with per-tool diagnostics and user overrides, surfaced through a tools REST API; a user can view which resolution strategy won and override a tool path.
- **Test cases (Playwright candidates):**
  - Opening the tools/diagnostics settings page lists each registered tool with its resolved path, source/strategy, and override status.
  - Setting a tool path override in the UI reflects the override status for that tool after save.
  - Triggering a rescan re-resolves tools and updates the displayed diagnostics.
- **Drift risk:** Medium — the underlying registry is core infra, but the settings UI surface exposing it may have been relocated by the 2026-06-15 settings reorganization.

### 2026-04-19-consolidate-windows-spawn-and-platform-handlers
- **Date:** 2026-04-19
- **Frontend surface:** Session spawn controls (fork/continue/new session buttons) — indirect
- **User-facing behavior:** Spawning, forking, or continuing a session (notably on Windows) reliably creates a working session that survives server restarts, rather than silently dropping flags.
- **Test cases (Playwright candidates):**
  - Clicking the new-session/spawn control creates a new session card in the sidebar.
  - Forking a session from its card produces a new session card distinct from the original.
- **Drift risk:** Medium — backend spawn consolidation behind existing controls; observable only indirectly and the spawn UI may be reworked by later changes.

### 2026-04-19-explore-dialog-image-paste-remove-terminal-button
- **Date:** 2026-04-19
- **Frontend surface:** `FolderActionBar` (+Terminal button removed), Explore dialog, shared `ImagePreviewStrip` / `useImagePaste`
- **User-facing behavior:** The +Terminal quick-create button is gone from the folder action bar; the Explore dialog is larger and accepts pasted images with thumbnail preview and removal.
- **Test cases (Playwright candidates):**
  - The `FolderActionBar` no longer renders a "+Terminal" button.
  - The Explore dialog renders at the wider `max-w-2xl` size with a taller textarea.
  - Pasting a supported image into the Explore dialog adds a thumbnail to the preview strip.
  - Pasting an unsupported mime type shows an inline image error that auto-clears.
  - Pasting an image over 10MB shows an "Image too large (max 10MB)" error.
  - Clicking a thumbnail's remove button removes that image from the Explore dialog strip.
- **Drift risk:** Low — small, focused UX additions on stable surfaces.

### 2026-04-19-pi-core-version-checker
- **Date:** 2026-04-19
- **Frontend surface:** Settings panel core-packages update section + header update badge
- **User-facing behavior:** The dashboard discovers globally/managed pi ecosystem packages, shows available updates with one-click update from Settings, and a subtle header badge notifies when updates exist.
- **Test cases (Playwright candidates):**
  - The settings core-version section lists discovered pi ecosystem packages with current and latest versions.
  - When an update is available, a subtle update badge appears in the header.
  - Clicking the one-click update control triggers an update request for the package(s) and reflects update progress.
- **Drift risk:** Medium — the checker is durable, but the settings section placement and header badge likely shifted with the 2026-06-15 settings reorg.

### 2026-04-19-polish-header-logo-and-card-stripes
- **Date:** 2026-04-19
- **Frontend surface:** Header logo (`PiLogo` inline SVG in SessionList + SessionSidebar), streaming card barber-pole stripes (`card-working-pulse`), pin-folder button label
- **User-facing behavior:** The header brand mark becomes a themed blue Π SVG on transparent background; streaming session cards show a drifting diagonal stripe pattern plus a breathing pulse; the pin-folder button gains a text label.
- **Test cases (Playwright candidates):**
  - The sidebar header logo renders as an inline SVG Π (currentColor, transparent background), not a text `π` glyph.
  - In light theme the header logo shows a blue Π with no dark square background; same in dark theme.
  - A streaming/resuming session card shows the animated diagonal stripe pattern.
  - An `ask_user` (purple) card shows the breathing pulse with no stripes.
  - With `prefers-reduced-motion: reduce`, the streaming card retains the static stripe pattern with no motion.
  - The pin-folder button displays a text label rather than being icon-only.
- **Drift risk:** High — an early (2026-04-19) visual-polish batch on the card working animation and card chrome, which the subsequent series of session-card redesigns very likely re-styled.

### 2026-04-20-add-landing-page-onboarding
- **Date:** 2026-04-20
- **Frontend surface:** `LandingPage` empty-state view; `PinDirectoryDialog` (lifted to `App.tsx`)
- **User-facing behavior:** The empty main pane shows a 3-step onboarding (setup credentials → add folder → start session), each step reflecting live pending/done/locked state.
- **Test cases (Playwright candidates):**
  - With no sessions/providers/folders, the LandingPage renders three onboarding step cards.
  - Clicking step ① "Setup credentials" navigates to `/settings?tab=providers`.
  - Clicking step ② "Add folder" opens the `PinDirectoryDialog`.
  - Step ③ "Start session" is disabled/locked until at least one folder is pinned.
  - A fully-configured user sees three collapsed ✔ rows (e.g. "✔ N providers connected") instead of full onboarding cards.
  - The sidebar "Add folder" button opens the same `PinDirectoryDialog` (shared source of truth).
- **Drift risk:** High — early first-run onboarding UI is a likely candidate for later visual/structural redesign.

### 2026-04-20-add-marketing-site
- **Date:** 2026-04-20
- **Frontend surface:** Standalone `/site` Astro marketing landing page (nav theme selector, hero animation, mission graph) — separate from the dashboard app
- **User-facing behavior:** A visual marketing landing page with a three-state System/Light/Dark theme selector that persists to localStorage and tracks OS theme, a hero browser mockup that crossfades through 4 dashboard states, and an ambient animated mission graph; respects `prefers-reduced-motion`.
- **Test cases (Playwright candidates):**
  - The nav theme selector switches between System/Light/Dark and toggles the `class="dark"` (or resolved theme) on `<html>`, persisting across reload via localStorage.
  - The hero mockup crossfades through its 4 states and pauses on hover.
  - With `prefers-reduced-motion` emulated, the hero freezes on state 0 and background animation is disabled.
  - A skip-to-content link and visible focus ring are present for keyboard navigation.
- **Drift risk:** Medium — it is a separate site not part of the dashboard app; marketing pages get redesigned frequently.

### 2026-04-20-dashboard-openspec-card-state-and-actions
- **Date:** 2026-04-20
- **Frontend surface:** SessionCard OpenSpec area — StatePill, Tasks (N/M) popover (TasksPopover), overflow "Archive anyway" menu, Bulk Archive relocation
- **User-facing behavior:** The card shows an explicit color-coded state pill (PLANNING / READY / IMPLEMENTING / COMPLETE) next to the attached change name. A `Tasks (N/M)` button opens a popover listing tasks.md items that can be toggled from the card. An overflow "Archive anyway" action appears when artifacts are done but tasks aren't 100%. Bulk Archive moves to unattached sessions only.
- **Test cases (Playwright candidates):**
  - An attached change in IMPLEMENTING state renders an amber StatePill labelled `IMPLEMENTING` next to the change name.
  - The `Tasks (N/M)` button shows the correct tally (e.g. `30/33`) and opens a popover listing tasks grouped by heading.
  - Toggling a task checkbox in the popover updates the displayed count (e.g. `30/33` → `31/33`) after refresh.
  - When `isComplete` is true but tasks aren't 100%, the overflow `⋯` menu exposes an "Archive anyway" action.
  - Invoking "Archive anyway" shows a confirm dialog reflecting the unchecked count and sends an archive command on confirm.
  - An attached session shows no Bulk Archive button; an unattached session in the same folder shows Bulk Archive.
- **Drift risk:** Medium — state pill and task popover are meaningful additions but sit on the frequently-reworked OpenSpec card surface.

### 2026-04-20-dashboard-ux-fixes-batch
- **Date:** 2026-04-20
- **Frontend surface:** TerminalsView (tab close X + route), Settings provider save → ModelSelector, PackageBrowser installed state, GitHub device-code flow, ModelSelector search/filter, `/skill` command, fork-from-message
- **User-facing behavior:** A batch of UX fixes — hover-visible terminal tab close buttons, model list refresh after saving providers, instant package-card updates, a consent button (no auto browser open) for GitHub device code, multi-token model search with provider filter, and fork preserving the last assistant message.
- **Test cases (Playwright candidates):**
  - Hovering a terminal tab reveals its close (X) button.
  - Navigating to a newly created terminal lands on the tabbed `/folder/:cwd/terminals` route (not a legacy fullscreen `/terminal/:id`).
  - After saving a provider in Settings, the Default Model selector populates without a restart.
  - Completing a successful package operation updates the PackageBrowser installed state immediately.
  - The GitHub device-code screen shows an "Open Registration" button and copyable URL instead of auto-opening a browser tab.
  - Typing space-separated tokens in the model search filters by AND-matching all tokens.
  - A provider filter dropdown appears above the model list and narrows results by provider.
  - Forking from a message preserves the last assistant message rather than showing only a separator line.
- **Drift risk:** Medium — a grab-bag of early UX patches across many surfaces; several (package cards, model selector, terminals) were touched by adjacent changes, so specifics may have moved.

### 2026-04-20-fix-failing-tests
- **Date:** 2026-04-20
- **Frontend surface:** Test suite maintenance (no dedicated UI surface; touches PiResourcesView, SessionList, SessionCard, PinDirectoryDialog tests)
- **User-facing behavior:** Restores a green test baseline; no intended change to what users see.
- **Test cases (Playwright candidates):**
  - (no browser-observable UI behavior)
- **Drift risk:** Low — test-baseline cleanup with no user-facing UI change.

### 2026-04-20-improve-path-picker
- **Date:** 2026-04-20
- **Frontend surface:** PathPicker (folder browser) in PinDirectoryDialog — substring filter, smart Enter, new-folder creation
- **User-facing behavior:** The folder picker filters directories by substring with ranking, treats Enter intelligently (select exact match, complete single candidate, no-op on typos), and lets users create a new folder inline.
- **Test cases (Playwright candidates):**
  - Typing `dash` in the PathPicker surfaces `pi-dashboard` via substring match (not only prefix).
  - Pressing Enter on a typed name that matches no visible entry is a no-op (does not select a bogus path).
  - Pressing Enter on an exact entry name selects and closes the picker.
  - Pressing Enter with a trailing `/` on an existing directory selects that directory.
  - With exactly one filtered candidate, Enter completes the input to `"<path>/"` and keeps the picker open.
  - Using the "＋ New folder" footer control creates a directory and navigates into it.
- **Drift risk:** Medium — PathPicker behavior is fairly core, but folder-browser UIs often get restyled, so selectors/labels may drift.

### 2026-04-20-isolate-test-environment
- **Date:** 2026-04-20
- **Frontend surface:** (none — test infrastructure / isolated HOME + dynamic ports)
- **User-facing behavior:** Test-only isolation so `npm test` no longer mutates the developer's live pi environment; no browser UI effect.
- **Test cases (Playwright candidates):**
  - (no browser-observable UI behavior)
- **Drift risk:** Low — test harness only, no dashboard UI surface.

### 2026-04-20-route-kill-paths-through-platform
- **Date:** 2026-04-20
- **Frontend surface:** Session card ✕ (force-kill) button
- **User-facing behavior:** A user clicks the ✕ button on a session to force-kill it and its child processes; the session transitions to ended.
- **Test cases (Playwright candidates):**
  - Clicking the ✕ force-kill button on a running session transitions its status indicator to "ended".
  - After force-kill, the session card no longer shows a running/active state.
- **Drift risk:** Low — the ✕ kill action is stable core behavior; the change is backend correctness behind an existing button.

### 2026-04-21-bootstrap-resolution-harness
- **Date:** 2026-04-21
- **Frontend surface:** None (in-memory bootstrap test harness / ToolRegistry)
- **User-facing behavior:** No end-user UI; adds a CI test harness snapshotting bootstrap resolution across a scenario matrix.
- **Test cases (Playwright candidates):**
  - (no browser-observable UI behavior)
- **Drift risk:** Low — test infrastructure only; nothing rendered in a browser.

### 2026-04-21-consolidate-trusted-networks
- **Date:** 2026-04-21
- **Frontend surface:** Settings panel — General tab and Security tab (Trusted Networks & Hosts section)
- **User-facing behavior:** Trusted-network/host management moves to a single section on the Security tab combining a row-based list, an auto-detect "+ Add Local Network" dropdown, flexible input formats, and a security warning; General tab no longer shows it.
- **Test cases (Playwright candidates):**
  - Opening Settings → Security shows a "Trusted Networks & Hosts" section with a security warning icon.
  - Opening Settings → General renders no element matching "Trusted Networks" or "+ Add Local Network".
  - Clicking "+ Add Local Network" opens a dropdown listing detected local CIDRs.
  - Entering `10.0.0.*` (wildcard) and `192.168.1.50` (exact IP) into the manual-entry field adds them as list rows.
  - Each entry row shows a remove (✕) button that deletes only that row from the list.
  - With a pre-existing legacy `trustedNetworks` config, an info hint is visible in the Security section.
- **Drift risk:** Medium — consolidation of a settings surface that could be reorganized again, but the underlying Security-tab placement is fairly stable.

### 2026-04-21-hot-reload-custom-providers
- **Date:** 2026-04-21
- **Frontend surface:** SettingsPanel LlmProviderCard (Add Provider "Test Connection" button + status pill)
- **User-facing behavior:** The Add Provider card gains a Test button that probes the provider and shows a green "✓ Connected · N models" pill or a red error pill; editing a field clears the pill; newly added providers' models appear in the selector without a reload.
- **Test cases (Playwright candidates):**
  - The Test button is disabled when baseUrl or apiKey is empty.
  - Clicking Test shows a spinner (testing) state.
  - A successful test renders a green pill with the model count.
  - A failed test renders a red pill with status and message.
  - Editing baseUrl/apiKey/api clears the status pill back to idle.
  - After saving a new provider, its models appear in the model selector without reloading the session.
- **Drift risk:** Low — Test-connection UI and provider hot-reload are stable settings features.

### 2026-04-21-single-dashboard-per-home
- **Date:** 2026-04-21
- **Frontend surface:** None (startup advisory lock + discovery cascade); at most an attach/error diagnostic
- **User-facing behavior:** Enforces one dashboard per HOME via a lock; concurrent launches attach to the existing instance rather than starting a second — primarily server/startup behavior.
- **Test cases (Playwright candidates):**
  - (no browser-observable UI behavior)
- **Drift risk:** Low — startup/locking logic with no rendered UI surface.

### 2026-04-21-unified-bootstrap-install
- **Date:** 2026-04-21
- **Frontend surface:** BootstrapBanner (degraded-mode first-run status); Electron install wizard
- **User-facing behavior:** On first run without pi installed, the server starts in degraded mode and a banner reports bootstrap status (`installing` → `ready`, or `failed` with a retry button); when install completes the dashboard refreshes and sessions become available.
- **Test cases (Playwright candidates):**
  - In degraded first-run mode, a bootstrap banner reports status `installing`.
  - When bootstrap completes, the banner shows `ready` and sessions/tools become available in the UI.
  - On bootstrap failure, the banner shows a `failed` state with a retry button and a logs link.
  - Attempting to spawn a session during `installing` shows a deferred/actionable message rather than silent failure.
- **Drift risk:** Medium — mostly install/bootstrap plumbing; the banner UI is a thin surface that could be restyled, though the status states are stable.

### 2026-04-22-chat-input-draft-and-history
- **Date:** 2026-04-22
- **Frontend surface:** CommandInput (chat input textarea) — per-session draft persistence + up/down prompt history
- **User-facing behavior:** Typed-but-unsent chat text is saved per session (survives navigation and reload, never leaks across sessions), and ArrowUp/ArrowDown recall previously sent prompts bash-style.
- **Test cases (Playwright candidates):**
  - Typing text in session A, navigating away and back, restores the same draft in the input.
  - Typing a draft in session A then switching to session B shows B's own draft (no leak).
  - Reloading the page restores the per-session draft (persisted in localStorage under `chat-draft:<sessionId>`).
  - With caret at the top row and dropdown closed, ArrowUp fills the input with the previous sent prompt; repeated ArrowUp walks further back; ArrowDown walks forward and finally restores the draft.
  - Pressing Escape during history walk exits history mode and restores the draft.
  - ArrowUp with the caret on a middle line of multiline text does not trigger history recall.
  - With the `/` dropdown open, ArrowUp navigates the dropdown, not history.
  - The draft is cleared only on successful send.
- **Drift risk:** Low — a well-scoped, keyboard-driven behavior on the core chat input; likely stable.

### 2026-04-22-enrich-custom-provider-model-metadata
- **Date:** 2026-04-22
- **Frontend surface:** Context-usage bar, token-usage/cost popover, thinking-level selector (SessionCard + bottom StatusBar), model picker
- **User-facing behavior:** For proxied frontier models, the context-usage bar shows the true window (e.g. 1,000,000), cost tracking is non-zero, and the thinking-level selector is available.
- **Test cases (Playwright candidates):**
  - After switching a session to a proxied 1M-context model, the context-usage bar denominator reads 1,000,000 (not 200,000).
  - A fresh session on the proxied model reads roughly 0 / 1,000,000 tokens in the context bar.
  - The token-usage/cost popover shows non-zero input/output cost after a completed turn on the proxied model.
  - A reasoning-enabled proxied model exposes the low/medium/high/xhigh thinking-level selector.
  - Selecting a thinking level in the bottom StatusBar updates the SessionCard selector to the same value within ~100ms.
  - The chosen thinking level persists across a browser refresh.
  - A catalog-known bare model (e.g. Haiku) still shows its native / 200,000 context window.
- **Drift risk:** Medium — depends on context bar, cost popover, and thinking-level selector layouts that are actively evolving UI surfaces.

### 2026-04-22-optimize-openspec-poll-burst
- **Date:** 2026-04-22
- **Frontend surface:** Settings panel — new "Background polling" section
- **User-facing behavior:** Users see four new advanced OpenSpec polling settings (interval, max concurrent spawns, change-detection mode, jitter) in a Settings section; the rest is server-side CPU optimization.
- **Test cases (Playwright candidates):**
  - The Settings panel shows a "Background polling" section with `openspec.pollIntervalSeconds`, `openspec.maxConcurrentSpawns`, `openspec.changeDetection`, and `openspec.jitterSeconds` controls.
  - Entering a `pollIntervalSeconds` below 5 or above 3600 is clamped to the allowed range in the UI.
  - The `changeDetection` control offers `mtime` (default) and `always` options.
  - Saving the polling settings persists them across a page reload.
- **Drift risk:** Low — the settings UI is a small additive section over a stable server behavior; unlikely superseded.

### 2026-04-23-fix-trusted-networks-no-oauth
- **Date:** 2026-04-23
- **Frontend surface:** Settings → Security (trusted networks) + connection banner
- **User-facing behavior:** Users without OAuth can add a trusted network in Settings → Security, have it persist, and (after restart) reach the dashboard from that network instead of seeing "Server offline".
- **Test cases (Playwright candidates):**
  - Adding a CIDR in Settings → Security and clicking Save keeps the entry visible in the trusted-networks list after reload.
  - Saving an empty trusted-networks list clears the entries shown in the Security UI.
- **Drift risk:** Medium — the persistence fix is durable, but the runtime-reload gap means the observable "reach dashboard" outcome needs a restart and much of the fix is server-side.

### 2026-04-24-ask-user-multiselect-polyfill
- **Date:** 2026-04-24
- **Frontend surface:** MultiselectRenderer (`ask_user{multiselect}` dialog) with synthetic "Select all" row; ToolCallStep auto-expand behavior for `ask_user`
- **User-facing behavior:** Multiselect ask_user prompts render with a "Select all" toggle that checks/clears all options (but is not itself returned); failed `ask_user` tool calls stay collapsed with a red ❌ summary instead of auto-dumping the error.
- **Test cases (Playwright candidates):**
  - A multiselect ask_user dialog shows a synthetic "Select all" row above the real options.
  - Toggling "Select all" checks every option; toggling it off clears all.
  - The "Select all" row's checked state derives from whether all real options are checked.
  - The submitted values payload excludes the synthetic "Select all" entry.
  - A failing `ask_user` tool call renders collapsed with a red ❌ summary; clicking it expands the full error.
  - Pending/running/completed `ask_user` calls auto-expand as before.
- **Drift risk:** Low — fixes a runtime crash and adds a stable UI toggle plus a collapse rule; unlikely to be superseded wholesale.

### 2026-04-24-fix-model-selector-after-provider-auth
- **Date:** 2026-04-24
- **Frontend surface:** Model selector dropdown in session view
- **User-facing behavior:** After authenticating a provider in Settings, existing open sessions get a working (enabled, populated) model selector instead of staying disabled at "no model".
- **Test cases (Playwright candidates):**
  - With no provider credentials, an existing session's model selector renders disabled / shows "no model".
  - After a `models_refreshed` broadcast (provider authenticated), the previously disabled model selector becomes enabled and repopulates with models for the selected session.
  - Removing a provider credential clears the model list for affected sessions.
- **Drift risk:** Medium — depends on model-selector UI and provider-auth flow, both of which later changes (custom-provider save/auth) also touch.

### 2026-04-24-harden-external-link-handling
- **Date:** 2026-04-24
- **Frontend surface:** MarkdownContent chat renderer anchor override (external links); Electron shell navigation guards
- **User-facing behavior:** External links inside chat markdown open in a new tab / the system browser with `rel="noopener noreferrer"`, while internal same-origin/hash anchors stay in-document.
- **Test cases (Playwright candidates):**
  - An external URL rendered in a chat markdown message has `target="_blank"` and `rel="noopener noreferrer"`.
  - An internal hash anchor (e.g. `#heading-id`) in chat markdown does not carry `target="_blank"` and navigates in-document.
  - (Electron `setWindowOpenHandler` / `will-navigate` routing to system browser — not browser-DOM observable; covered by unit tests.)
- **Drift risk:** Low — a small, stable anchor-rendering contract matching an existing repo-wide pattern.

### 2026-04-24-safe-server-switch
- **Date:** 2026-04-24
- **Frontend surface:** ServerSelector dropdown, disconnection banner, App-level connection state
- **User-facing behavior:** Switching servers is transactional — the new connection must open before state swaps; unreachable entries show dimmed with an "Unreachable" badge, failed switches snap back with a toast, and a "Disconnected, retrying…" banner appears after 3s offline.
- **Test cases (Playwright candidates):**
  - Selecting an unreachable server surfaces a "Couldn't reach <host>" toast and the previous server stays active.
  - Unreachable server entries render dimmed with an "Unreachable" badge but remain clickable.
  - After the active WebSocket is non-open for >3s, a persistent "Disconnected, retrying…" banner is displayed.
  - Selecting a reachable server from a poisoned/disconnected state clears the banner and restores the session list.
  - A successful server switch does not clear the session list until the new connection reports open.
- **Drift risk:** Medium — connection/state handling is core but this specific dimming/badge UI could be refined by later reliability work.

### 2026-04-26-add-dashboard-shell-slots-runtime
- **Date:** 2026-04-26
- **Frontend surface:** Plugin runtime slot consumers + demo plugin (settings-section form, tool-renderer for `DashboardDemo` in a green box)
- **User-facing behavior:** The plugin slot runtime renders contributions; a demo plugin proves the seam with a settings form and a green-boxed custom tool renderer.
- **Test cases (Playwright candidates):**
  - The demo plugin's settings form renders in the General settings tab with its two persisted fields.
  - A `DashboardDemo` tool call renders via the demo tool-renderer in a green box.
  - A session-card badge slot with three claims renders contributions in priority-then-plugin-id order.
  - When one badge-slot claim throws, its sibling contributions still render (per-slot error boundary).
- **Drift risk:** Medium — the runtime itself is foundational and stable, but the demo plugin is an internal fixture (SHALL NOT ship in production), so its specific UI is not a durable end-user surface.

### 2026-04-26-add-extension-ui-decorations
- **Date:** 2026-04-26
- **Frontend surface:** Extension UI decoration slots — FooterSegmentSlot (SessionHeader), AgentMetricSlot (FlowAgentCard), BreadcrumbSlot (FlowDashboard), GateSlot (FlowLaunchDialog), ToastSlot (App top-right tray)
- **User-facing behavior:** Extensions can inject live decorations: a footer string in the session header, a metric string under flow agent cards, a pipeline breadcrumb above the flow dashboard, a greyed-out gate reason in the launch dialog, and top-right toast notifications.
- **Test cases (Playwright candidates):**
  - An extension-registered footer-segment descriptor renders its live string in the session header, right of git info.
  - An extension-registered toast descriptor renders a notification in the top-right toast tray.
  - An extension-registered gate descriptor greys out the unavailable flow in the launch dialog and shows its reason on tooltip.
  - Pushing a descriptor with `removed: true` deletes the previously-registered decoration from the UI.
  - Reconnecting/subscribing to a session replays and re-renders all previously registered decorators without re-probing.
- **Drift risk:** High — an early (2026-04-26) extension-UI slot system mounted on components (FlowAgentCard, FlowDashboard, FlowLaunchDialog) that were later extracted into the flows plugin and redesigned, so the mount points likely moved.

### 2026-04-26-add-extension-ui-modal
- **Date:** 2026-04-26
- **Frontend surface:** `GenericExtensionDialog` (management-modal slot), slash-command trigger in `CommandInput`/`SessionHeader`
- **User-facing behavior:** Typing an extension's registered slash command opens a schema-driven modal with table/grid/form views; the modal state replays on browser reconnect.
- **Test cases (Playwright candidates):**
  - Typing a registered `module.command` slash command opens the `GenericExtensionDialog`.
  - The modal renders table / grid / form views from the module schema, including row data.
  - After a browser reconnect/reload, the modal's modules and last data are restored.
  - A modal action with `confirm:` shows the Tailwind `ConfirmDialog` before executing.
- **Drift risk:** Medium — Phase-1 extension-UI system explicitly flagged as evolving; later phases may reshape the modal.

### 2026-04-26-dashboard-plugin-architecture
- **Date:** 2026-04-26
- **Frontend surface:** Design-only — shell slot taxonomy and plugin loader contract (no runtime code shipped in this change)
- **User-facing behavior:** Defines the named shell slots and two-tier rendering model on paper; no browser-observable change ships in this change itself.
- **Test cases (Playwright candidates):**
  - (no browser-observable UI behavior)
- **Drift risk:** Low — a pure design/ADR artifact; it establishes a taxonomy rather than UI, so there is nothing rendered to be superseded.

### 2026-04-27-ask-user-help-icon
- **Date:** 2026-04-27
- **Frontend surface:** ToolCallStep in ChatView (resolved ask_user row)
- **User-facing behavior:** A completed `ask_user` tool call in the chat history shows a sky-blue help-circle `?` icon instead of the standard green check, distinguishing human-decision points.
- **Test cases (Playwright candidates):**
  - A resolved (complete) `ask_user` tool row shows a sky-blue help-circle icon instead of the green check.
  - A running `ask_user` tool row still shows the yellow spinner icon.
  - An errored `ask_user` tool row still shows the red alert icon.
  - A completed non-`ask_user` tool row still shows the standard green check icon.
- **Drift risk:** Low — small, targeted icon-semantics change on a stable chat tool row.

### 2026-04-27-collapse-duplicate-tool-cards
- **Date:** 2026-04-27
- **Frontend surface:** ChatView (ToolCallStep / InteractiveUiCard rendering), RetriedErrorBadge component
- **User-facing behavior:** Duplicate cards around `ask_user` are collapsed — a pending interactive prompt shows only the interactive card (not a duplicate running tool card), and a failed-then-retried tool call collapses into a one-line expandable badge.
- **Test cases (Playwright candidates):**
  - While an `ask_user` question is pending, only the interactive card renders (the duplicate running ToolCallStep is hidden).
  - A tool-call validation error immediately superseded by a successful retry renders as a single-line `⚠ <toolName> failed — retried ›` pill instead of a full red error card.
  - Clicking the retried-error pill expands to reveal the original error ToolCallStep with the validation message and received-arguments JSON.
  - Clicking the expanded pill again collapses it back to the one-line form.
  - A standalone (non-retried) error card is NOT collapsed into a pill.
- **Drift risk:** Low — presentation-layer filtering of a stable interaction pattern; targeted and behaviorally scoped.

### 2026-04-27-diagnose-empty-mdns-scan
- **Date:** 2026-04-27
- **Frontend surface:** Settings → Network Discovery empty-state diagnostic block + inline manual-add form
- **User-facing behavior:** When a network scan finds no servers, users see a diagnostic block listing common mDNS-failure reasons plus an inline field to paste a URL/host:port and add a server manually.
- **Test cases (Playwright candidates):**
  - Running a Network Discovery scan with no peers shows a diagnostic block listing common mDNS failure reasons.
  - The empty state renders an inline manual-add host input plus optional label.
  - Entering `http://192.168.16.202:8000` and pressing Enter parses it and submits a known-server add request.
  - Entering an already-known server is rejected/flagged rather than re-added.
  - A scan error is surfaced visibly to the user instead of showing only "No servers found."
- **Drift risk:** Low — a self-contained diagnostic/empty-state addition to Settings; not a churny core surface.

### 2026-04-27-fix-flow-step-agent-tracking
- **Date:** 2026-04-27
- **Frontend surface:** Flow dashboard graph nodes and web agent/flow cards
- **User-facing behavior:** Decision/loop/fork flow steps now emit progress so their agent cards appear and update live; graph nodes render as rectangles with per-step-type icons/borders; decision/loop cards look visually distinct from worker cards; interactive fork steps show as control-flow-only nodes, not agent cards.
- **Test cases (Playwright candidates):**
  - Running a flow with a decision step renders a corresponding agent card that transitions from started to complete (not frozen after the first agent step).
  - Each flow agent card exposes its `stepType` so decision/loop/fork cards render with a distinct icon or accent color versus worker cards.
  - Graph nodes render as rectangles (not diamonds) with step-type-specific border/icon.
  - An interactive fork step appears as a control-flow graph node and does NOT render an agent card.
- **Drift risk:** Medium — flow graph/card visuals evolve, but the lifecycle-event wiring is core behavior likely still present.

### 2026-04-27-lift-pending-images-to-app
- **Date:** 2026-04-27
- **Frontend surface:** CommandInput image-paste (ImagePreviewStrip) with App-level per-session pending-image state
- **User-facing behavior:** Pasted images survive navigating away (e.g. to Settings) and back, and no longer leak across sessions when switching sessions before sending.
- **Test cases (Playwright candidates):**
  - Pasting an image into session A, navigating to Settings, and returning still shows the image in the preview strip.
  - After the navigate-away-and-back round-trip, pressing Send produces a send_prompt with the image attached.
  - Pasting in session A, switching to session B, and sending from B produces a send_prompt with no images.
  - Session A's pasted image is still present when returning to A after switching to B.
  - After a successful send, the preview strip is emptied.
- **Drift risk:** Low — a state-management correctness fix on a stable composer; behavior is durable.

### 2026-04-27-package-install-queue
- **Date:** 2026-04-27
- **Frontend surface:** PackageBrowser, Recommended Extensions panel (install spinners/pills, banner, "Install all missing")
- **User-facing behavior:** Clicking Install while another install runs queues the second package (spinner persists on the first), a banner shows the running source plus queue depth, and an "Install all missing" button enqueues every missing recommended extension.
- **Test cases (Playwright candidates):**
  - Clicking Install on package A then package B keeps A's spinner running and shows B as queued.
  - When A's install completes, B automatically starts and shows its running spinner.
  - The panel banner shows the running source name and queue depth (e.g. "Installing pi-flows… (2 queued)").
  - Install spinners/pills stay consistent across the Recommended panel and Packages tab for the same source.
  - Clicking "Install all missing" enqueues every recommended entry that is not active in pi.
  - Navigating away from PackageBrowser after queuing an op does not orphan its spinner/state.
- **Drift risk:** Low — the queue-driven per-source status is durable UX; visible banner text is the main variable.

### 2026-04-27-split-browse-flags
- **Date:** 2026-04-27
- **Frontend surface:** PathPicker (git/pi badges in the directory picker; Pin Directory dialog)
- **User-facing behavior:** The path picker lists directories instantly (no eager classification) and then fades in `git`/`pi` badges once a separate bulk flags request resolves; the entry cap is higher so large parent directories aren't sliced.
- **Test cases (Playwright candidates):**
  - Opening the PathPicker renders the directory list immediately before badges appear.
  - `git` and `pi` badges fade in on the correct rows after the flags request resolves.
  - Rapidly changing the query cancels the in-flight flags request (no stale badges applied).
  - A directory with more than 200 entries shows the target project in the picker (not sliced out by a low cap).
- **Drift risk:** Low — a performance/decoupling change to a stable picker; the badge UX is retained, only fetch timing changes.

### 2026-04-28-add-attached-proposal-header-summary
- **Date:** 2026-04-28
- **Frontend surface:** SessionHeader (desktop + MobileHeader) — attached-proposal chip
- **User-facing behavior:** When a session has an OpenSpec change attached, the chat header shows status-colored `P D T S` artifact letters plus a `(completed/total)` task counter next to the change name, and clicking the pill opens the proposal.
- **Test cases (Playwright candidates):**
  - With an attached proposal present in the polled changes list, the header shows the artifact-letters pill (`data-testid="artifact-letters-btn"`).
  - The header shows the counter text `(3/12)` when totalTasks > 0.
  - When totalTasks is 0, the pill renders but no counter text appears.
  - When attachedProposal is set but absent from the changes list, only the plain chip text renders (no pill).
  - Clicking the artifact-letters pill opens the proposal artifact reader.
  - On mobile viewport, the pill renders inside the `mobile-header-attached-chip` element.
  - Detaching the change removes the pill and counter and restores the attach button.
- **Drift risk:** Medium — the mobile header layout is reworked by the later 2026-04-28 mobile-header change (two-row layout), so exact DOM nesting may shift.

### 2026-04-28-fix-chat-scroll-race-during-replay
- **Date:** 2026-04-28
- **Frontend surface:** ChatView (auto-scroll, floating scroll-to-bottom button)
- **User-facing behavior:** Switching to an uncached session lands the user at the latest message with the floating scroll-to-bottom button hidden, instead of stranding them mid-conversation.
- **Test cases (Playwright candidates):**
  - Switching to a long, uncached session lands the view at the latest message with the floating scroll-to-bottom button hidden.
  - A programmatic scroll during replay does not cause the floating scroll-to-bottom button to appear.
  - After replay settles, scrolling up manually makes the floating scroll-to-bottom button appear.
- **Drift risk:** Low — a targeted race fix on stable core chat-scroll behavior.

### 2026-04-28-fix-context-window-reload
- **Date:** 2026-04-28
- **Frontend surface:** Context-window / context-usage display in the session view
- **User-facing behavior:** A session's context window stays at its correct value (e.g. 1M) after a dashboard reload or when reopening an ended session, instead of reverting to 200k.
- **Test cases (Playwright candidates):**
  - A 1M-context session still shows a 1,000,000 context window after a browser reload.
  - Reopening an ended session for replay shows the persisted 1,000,000 context window, not 200,000.
- **Drift risk:** Low — corrects persistence of a core context-window display that is expected to remain stable.

### 2026-04-28-fix-local-path-install-spinner
- **Date:** 2026-04-28
- **Frontend surface:** Packages tab install spinner (package queue)
- **User-facing behavior:** Installing a local-path (or npm) extension no longer leaves the spinner stuck on "Installing…" forever; the spinner clears when the operation completes, and one bad install no longer blocks subsequent installs.
- **Test cases (Playwright candidates):**
  - Installing a local-path extension clears the "Installing…" spinner within ~1s of completion (not stuck forever).
  - Installing a small npm package immediately after a local-path install proceeds (queue not poisoned).
  - Clicking Install twice rapidly on the same package sends exactly one request and the spinner clears once.
  - Uninstalling a package clears its removal spinner correctly.
- **Drift risk:** Low — a race-condition bug fix on a stable package-install UI; behavior (spinner clears on completion) is durable.

### 2026-04-28-fix-mobile-attach-proposal-display
- **Date:** 2026-04-28
- **Frontend surface:** Mobile SessionHeader (MobileHeader) and mobile SessionCard — attached-proposal `📎 <changeName>` chip; auto-rename on attach/detach
- **User-facing behavior:** On mobile, attaching an OpenSpec proposal shows a 📎 change-name chip in both the session header and card; detaching removes it, and an auto-set title now reverts on detach and follows subsequent attaches (manual names are never overwritten).
- **Test cases (Playwright candidates):**
  - On a mobile viewport, attaching a proposal renders a `📎 <changeName>` chip in the session header and on the session card.
  - Detaching the proposal removes the chip from both mobile surfaces.
  - Attaching to a fresh (unnamed) session sets the title to the change name; detaching clears it back to the fallback (firstMessage / cwd basename).
  - Attaching change A then change B (without detach) updates the chip and auto-set title to B.
  - A manually renamed session keeps its custom title when attaching/detaching (only the chip changes).
  - Both the attached-proposal chip and the OpenSpecActivityBadge can render together on mobile when both fields are set.
- **Drift risk:** Medium — mobile-specific chip rendering; mobile header/card layouts are frequently re-skinned, so exact placement may shift.

### 2026-04-28-fix-mobile-header-and-orientation
- **Date:** 2026-04-28
- **Frontend surface:** Mobile SessionHeader (two-row layout), `useMobile()` predicate driving MobileShell / SessionCard / FlowDashboard / ChatView layout
- **User-facing behavior:** `useMobile()` now returns true when width < 768px OR height < 600px (so landscape phones get the mobile layout), and the mobile chat header splits into two rows when a proposal is attached so the session name gets full width.
- **Test cases (Playwright candidates):**
  - At a landscape-phone viewport (e.g. 844×390), the app renders the mobile single-panel layout, not the desktop two-panel layout.
  - At tablet portrait (768×1024) and tablet landscape (1024×768), the app renders the desktop layout.
  - With an attached proposal on mobile, the header renders as two rows and the attached chip is on its own row (not a sibling of the title span).
  - With no attached proposal on mobile, the header renders as a single-row (flex-col) container.
  - The session name occupies the full row-1 width when the chip is on row 2.
- **Drift risk:** Medium — the mobile header composes with the earlier attached-proposal summary pill; both touch the same element, so DOM structure is version-sensitive, though the predicate rule is stable.

### 2026-04-28-fix-openspec-design-detection
- **Date:** 2026-04-28
- **Frontend surface:** SessionCard OpenSpec action buttons ([Continue]/[FF], [Apply], [Verify]/[Archive])
- **User-facing behavior:** For attached OpenSpec changes with split design files or no design.md, the session card shows the correct [Apply] button instead of [Continue] [FF].
- **Test cases (Playwright candidates):**
  - A session card attached to a change with split design files (design-A.md + design-B.md, no design.md) shows the [Apply] button.
  - A session card attached to a no-design change whose tasks.md has unchecked boxes shows [Apply], not [Continue] [FF].
  - A session card attached to a change with a literal design.md still not started shows [Continue] [FF].
- **Drift risk:** Medium — button-derivation logic is core but OpenSpec action-button layout is an evolving area that later changes may re-derive.

### 2026-04-28-pin-and-search-sessions
- **Date:** 2026-04-28
- **Frontend surface:** Sidebar (two-input search + per-folder ended-sessions collapsible group)
- **User-facing behavior:** The sidebar header gains a folder filter and a session search; each folder groups ended sessions in a collapsible "N ended" section, and dragging an ended card onto an alive card resumes it.
- **Test cases (Playwright candidates):**
  - Typing in the `Folder…` input filters the folder list by case-insensitive substring and auto-expands matching folders.
  - Typing in the `Session…` input narrows visible sessions by case-insensitive substring against the card display name.
  - With a `Session…` query and empty `Folder…`, only pinned folders are searched until a `Folder…` value is entered.
  - Each folder renders a collapsed `N ended` toggle row below its alive sessions by default.
  - Clicking the `N ended` toggle expands the ended group and reveals a `Hide ended` toggle at its top.
  - Active filters auto-expand a folder's ended group.
  - Dragging an ended session card onto an alive card in the same folder resumes that session.
- **Drift risk:** Medium — search/collapse primitives are fairly durable, but the sidebar layout is actively iterated (pinning was already scrapped mid-change).

### 2026-04-28-unify-package-management-ui
- **Date:** 2026-04-28
- **Frontend surface:** Settings → Packages (PackageRow), Pi Resources → Installed tab, install dialog scope picker
- **User-facing behavior:** Per-folder (local) packages now render as rich rows with version, update badge, and Update/Uninstall/README actions; a new `Move →` action converts a package between global and local scope; the install dialog gains a scope picker in per-folder context.
- **Test cases (Playwright candidates):**
  - A local-scope package in Pi Resources → Installed renders a version label and Update/Uninstall buttons (not just a passive tree).
  - Clicking `Move →` on a package row opens the scope conversion affordance and issues a move operation.
  - Moving an already-at-destination package surfaces a 409/"already at destination" state without side effects (UI shows no duplicate row).
  - Launching the install dialog from a per-folder context shows a scope picker (global/local).
  - A move in progress shows a single progress indicator over the `package_operation` channel and reloads the session once on completion.
- **Drift risk:** Medium — the rich-row unification is a structural surface change that later package-UI work (e.g. source-override flags) builds on and may reshape.

### 2026-04-28-unify-workspace-package-management
- **Date:** 2026-04-28
- **Frontend surface:** Workspace Pi Resources view — `PackageBrowser` ("Packages" tab) and the renamed "Resources" tab
- **User-facing behavior:** The Packages tab gains an "Installed Packages" section with working uninstall for npm/git/local-path sources; the former Installed tab becomes a read-only "Resources" browse surface.
- **Test cases (Playwright candidates):**
  - The Packages tab renders a `PackageRow` (with an Uninstall button) for each installed source: `npm:…`, `/abs/path/…`, and git.
  - Clicking Uninstall on a `/abs/path/my-ext` row invokes removal with the literal path (row disappears).
  - The old "Installed" filter pill (`data-testid="package-installed-filter"`) is absent from the Packages tab.
  - A package installed in both scopes shows an "also in global" cross-scope badge on its row.
  - The former Installed tab is labeled "Resources" and shows loose `.pi/` skills/extensions/prompts groups.
  - A package contributing resources appears as a nested 📦 collapsible in the Resources tab with no Uninstall button.
  - A package contributing zero resources renders no row in the Resources tab.
- **Drift risk:** Medium — package-management UI is actively iterated; sections and testids may shift in later changes.

### 2026-04-29-add-folder-task-checker-and-spawn-attach
- **Date:** 2026-04-29
- **Frontend surface:** FolderOpenSpecSection (sidebar change rows), TasksPopover
- **User-facing behavior:** Each change row's `completedTasks/totalTasks` indicator becomes a clickable button opening the TasksPopover for that change; each row also gains a button to spawn a session pre-attached to that change.
- **Test cases (Playwright candidates):**
  - Clicking a change row's `{completed}/{total} tasks` indicator opens the TasksPopover scoped to that change's cwd and name.
  - Each change row shows a "spawn session attached to this change" button.
  - Clicking the spawn-with-attach button creates a session in the folder's cwd that appears already attached to the change (no unattached flash).
- **Drift risk:** Medium — sidebar OpenSpec section interactions; row affordances in this area are actively iterated (later changes add pill lifecycle icons), so exact controls may shift.

### 2026-04-29-fix-text-tool-render-order
- **Date:** 2026-04-29
- **Frontend surface:** ChatView / chat message list (assistant text bubbles + tool cards)
- **User-facing behavior:** When an assistant message contains explanatory text followed by a tool call, the text bubble now renders above the tool card instead of below it, matching the order the model emitted.
- **Test cases (Playwright candidates):**
  - Given an assistant message with `[text, toolCall]`, assert the assistant text bubble appears above its tool card in the DOM.
  - Given an assistant message with `[text, toolCall, toolCall, toolCall]`, assert the three tool cards render in content-array order directly after the text bubble.
  - Reloading the dashboard mid-session preserves the text-above-tool-card order (replay path).
  - A tool card belonging to a prior assistant message stays in its original position and is not pulled under a later message.
- **Drift risk:** Low — core chat rendering-order behavior tied to a documented reducer invariant, unlikely to be superseded.

### 2026-04-30-differentiate-resume-intent-by-trigger
- **Date:** 2026-04-30
- **Frontend surface:** SessionList card ordering — Resume button vs drag-to-resume placement
- **User-facing behavior:** Resuming via the button moves the card to the top of the alive tier; drag-to-resume keeps the card at the slot where it was dropped.
- **Test cases (Playwright candidates):**
  - Clicking a session's Resume button moves that card to the top of the active/alive tier.
  - Dragging an ended card to a slot and resuming leaves it at that dropped slot (not moved to top).
  - Sending a prompt to an ended session (auto-resume) surfaces it at the top of the alive tier.
- **Drift risk:** Medium — ordering logic was later reworked by 2026-06-14-simplify-session-card-ordering, so this placement behavior may be partly superseded.

### 2026-04-30-fix-autocomplete-stale-closure
- **Date:** 2026-04-30
- **Frontend surface:** CommandInput autocomplete dropdown (`/` command + `@` file selection)
- **User-facing behavior:** Selecting an autocomplete suggestion via Tab, Enter, or click correctly fills the input with the chosen command/file, even after switching sessions.
- **Test cases (Playwright candidates):**
  - Typing `/dep` and pressing Tab fills the input with `/deploy `.
  - Typing `/dep` and pressing Enter fills the input with `/deploy `.
  - Clicking the `/deploy` dropdown row fills the input with `/deploy `.
  - Selecting a `/`-command via Tab still works correctly after switching sessions.
  - Typing `@` and pressing Tab on a file suggestion fills the input with the file path after a session switch.
- **Drift risk:** Low — bug fix to core autocomplete selection behavior; stable and regression-tested.

### 2026-04-30-fix-desktop-back-navigation
- **Date:** 2026-04-30
- **Frontend surface:** Desktop back arrows — `SessionHeader` back button, Settings back arrow, content-area overlays
- **User-facing behavior:** Desktop back navigation pops overlays in a consistent priority order, falls back to the landing page on cold loads, and stops the double-click / phantom-overlay glitches.
- **Test cases (Playwright candidates):**
  - Hard-refresh on `/session/:id`, click the SessionHeader back arrow → navigates to the landing page (not a silent no-op).
  - Open Settings, click a sidebar OpenSpec artifact letter, click the Settings back arrow → lands on the landing page in one click (no phantom OpenSpec preview flash).
  - With an overlay open on desktop, back closes that overlay first before navigating routes.
  - Mobile back-navigation behavior is unchanged (regression check).
- **Drift risk:** Low — back-navigation priority is a stable core interaction once unified.

### 2026-04-30-fix-interactive-ui-reorder
- **Date:** 2026-04-30
- **Frontend surface:** ChatView (assistant text vs. ask_user dialog ordering)
- **User-facing behavior:** When an assistant message emits intro text before opening an `ask_user` dialog, the text bubble now renders above the dialog instead of below it.
- **Test cases (Playwright candidates):**
  - For a `[text, toolCall:ask_user]` assistant message, the assistant text bubble renders above the ask_user dialog in the chat timeline.
  - For a `[thinking, text, toolCall:ask_user]` message, ordering renders as text then dialog.
  - The running tool row paired with a pending interactiveUi dialog is hidden, leaving only text then dialog visible.
  - A plain `[text, toolCall:bash]` message still renders text then tool card unchanged.
- **Drift risk:** Low — a reducer ordering fix for a durable chat rendering invariant.

### 2026-04-30-fix-multiselect-auto-cancel-on-dashboard
- **Date:** 2026-04-30
- **Frontend surface:** MultiselectRenderer (ask_user multiselect interactive card)
- **User-facing behavior:** When the agent asks a multi-pick question, a multiselect dialog renders in the browser with checkboxes and a Submit button; picking options and submitting sends the chosen array; submitting nothing sends an empty array (not cancellation); Cancel sends cancellation.
- **Test cases (Playwright candidates):**
  - A multiselect `ask_user` renders a browser dialog with checkbox options and a Submit button.
  - Checking two options and clicking Submit sends the selected values array and the card resolves to an answered state.
  - Clicking Submit with no options checked resolves as an empty selection, not as a cancellation.
  - Clicking Cancel on the multiselect resolves the card as cancelled.
  - An answered multiselect card no longer shows "continuing without answer"/cancelled when options were submitted.
- **Drift risk:** Medium — bug fix on a specific renderer; the multiselect card is later redesigned (see 2025-06-05 redesign), so the exact pending/answered layout may be superseded even though the submit-array behavior is stable.

### 2026-04-30-fix-multiselect-tui-arm-self-cancel
- **Date:** 2026-04-30
- **Frontend surface:** MultiselectRenderer (ask_user multiselect dialog)
- **User-facing behavior:** The multiselect dialog stays open and accepts checkbox clicks instead of auto-greying to "Answered in terminal" a second after appearing.
- **Test cases (Playwright candidates):**
  - Triggering an ask_user multiselect renders a dialog that remains interactive and is not dismissed to "Answered in terminal" within seconds.
  - Checking boxes and clicking Submit returns the selected values array.
  - Clicking Submit with no boxes checked returns an empty selection (not a cancellation).
  - Clicking Cancel on the multiselect dialog returns a cancelled/undefined response.
- **Drift risk:** Low — core interactive prompt behavior that remains essential across versions.

### 2026-04-30-fix-per-message-fork
- **Date:** 2026-04-30
- **Frontend surface:** Per-message ⑂ Fork button on user/assistant chat bubbles, forked session card + replayed history
- **User-facing behavior:** Clicking ⑂ on a chat bubble forks a session whose history ends exactly at (includes) the clicked message.
- **Test cases (Playwright candidates):**
  - Clicking ⑂ on the last user message opens a new session card whose tail entry is that clicked user message.
  - Clicking ⑂ on the last assistant message opens a fork whose tail entry is that assistant message.
  - Clicking ⑂ on an earlier user message forks a session that ends at that message with later entries absent.
  - Clicking ⑂ on an earlier assistant message forks a session ending at that message.
  - The ⑂ button does not appear on a freshly-streaming assistant bubble until its entry is persisted.
- **Drift risk:** Low — per-message fork including the clicked entry is a core correctness behavior of the chat view.

### 2026-04-30-top-of-tier-on-status-change
- **Date:** 2026-04-30
- **Frontend surface:** SessionList sidebar (ended-tier ordering, resume re-prepend)
- **User-facing behavior:** When a session changes tier, it surfaces at the top of its new tier — a just-ended session lands at the top of the ended bucket, and a resumed session moves to the front of the alive list.
- **Test cases (Playwright candidates):**
  - A just-ended session renders at the top of its folder's ended-sessions bucket.
  - Ended sessions are ordered by end time descending, with older-started sessions ranked by when they ended.
  - A legacy ended session without an end time falls back to start-time ordering within the ended tier.
  - A resumed session moves to the top of the alive tier in its folder.
- **Drift risk:** Low — sidebar tier-ordering is stable core behavior; mostly logic-level with observable ordering in the DOM.

### 2026-05-01-eliminate-bash-on-windows-runners
- **Date:** 2026-05-01
- **Frontend surface:** (none — CI workflows + build scripts)
- **User-facing behavior:** Removes bash usage on Windows CI runners and ports a build script to Node; no browser UI effect.
- **Test cases (Playwright candidates):**
  - (no browser-observable UI behavior)
- **Drift risk:** Low — CI/build infra only, no dashboard UI surface.

### 2026-05-01-fix-electron-windows-installer-and-server-bootstrap
- **Date:** 2026-05-01
- **Frontend surface:** Electron first-run wizard / "Setting up dependencies…" indicator + server start failure dialog (Electron shell, not browser DOM)
- **User-facing behavior:** Windows Electron installer/app uses a single name `pi-dashboard`, runs the managed install on first launch (showing a setup indicator), and reaches the dashboard welcome screen; corrects the misleading 15-second failure dialog.
- **Test cases (Playwright candidates):**
  - On first launch a "Setting up dependencies…" indicator appears, then the dashboard reaches its URL and renders the welcome screen.
  - On second launch the "Setting up…" indicator does not linger (idempotent install).
- **Drift risk:** Medium — Windows/Electron-specific bootstrap flow; browser-observable parts are limited and the Electron shell drives most of it (not standard Playwright DOM).

### 2026-05-01-fix-oauth-blocked-by-external-link-guard
- **Date:** 2026-05-01
- **Frontend surface:** Electron shell navigation guard (OIDC login flow in BrowserWindow)
- **User-facing behavior:** Signing in with Google/GitHub/OIDC in the Electron app stays inside the window through multi-step login instead of getting bounced to the OS browser.
- **Test cases (Playwright candidates):**
  - (no browser-observable UI behavior) — Electron `will-navigate` main-process logic verified only by unit tests on `decideWillNavigate`.
- **Drift risk:** Low — narrow, correctness-critical Electron navigation rule; unlikely superseded and hard to observe in DOM.

### 2026-05-01-fix-streaming-text-vs-interactive-ui-order
- **Date:** 2026-05-01
- **Frontend surface:** ChatView message ordering (assistant text bubble vs tool card / ask_user dialog)
- **User-facing behavior:** During a streaming turn, the assistant's introductory text bubble appears above the tool card or ask_user prompt it introduces, not below it.
- **Test cases (Playwright candidates):**
  - During an ask_user blocking flow, the assistant text bubble's DOM position is above the interactive question card.
  - During a long-running bash tool, the introducing assistant text bubble renders above the running tool card for the entire tool runtime.
  - In a `[thinking, text, toolCall]` turn, the thinking row stays above the flushed assistant text row throughout the running window.
  - On replay of an archived ask_user turn, the assistant text still renders above the question card.
  - The streaming pulse animation on the assistant bubble remains active (no remount) after the text is flushed.
- **Drift risk:** Medium — ordering fix layered on a prior fix (247df74); later reducer changes (e.g. 2026-06-29) touch adjacent lifecycle logic that could alter render timing.

### 2026-05-01-reattach-move-to-front
- **Date:** 2026-05-01
- **Frontend surface:** Sidebar session ordering after server restart + `reattachPlacement` dropdown in SettingsPanel
- **User-facing behavior:** After a dashboard restart, re-registered alive sessions move to the top of their folder list by default, with a settings dropdown to switch back to preserving order.
- **Test cases (Playwright candidates):**
  - After a server restart, a previously-buried re-registered session appears at the top (index 0) of its folder group.
  - The settings panel exposes a `reattachPlacement` dropdown with preserve / streaming-only / always options.
  - Setting `reattachPlacement` to "preserve" and restarting keeps the prior manual session order.
- **Drift risk:** Medium — the config dropdown likely moved into a specific page during the 2026-06-15 settings reorg, though the ordering behavior itself is stable.

### 2026-05-01-resume-button-in-session-header
- **Date:** 2026-05-01
- **Frontend surface:** SessionHeader toolbar (desktop) — Resume + Fork button pair
- **User-facing behavior:** When a viewed session is `ended` and has a `sessionFile`, the desktop SessionHeader shows a green Resume pill and blue Fork pill (replacing the dimmed elapsed-time text). Buttons are disabled while resuming. Mobile is unchanged.
- **Test cases (Playwright candidates):**
  - An ended session with a sessionFile shows Resume and Fork buttons in the header, and the elapsed-time span is absent.
  - An active session shows the elapsed-time span and no Resume/Fork buttons.
  - An ended session without a sessionFile shows no Resume/Fork buttons.
  - Clicking Resume invokes the resume handler once with mode `"continue"`.
  - Clicking Fork invokes the handler once with mode `"fork"`.
  - When `resuming` is true, both buttons render disabled and clicks do not trigger the handler.
- **Drift risk:** Low — targeted additive behavior reusing stable resume plumbing; unlikely superseded.

### 2026-05-01-rich-diff-in-chat
- **Date:** 2026-05-01
- **Frontend surface:** EditToolRenderer diff in chat (shared `<RichDiff>` from DiffPanel), desktop vs mobile branch
- **User-facing behavior:** On desktop, expanding an Edit tool card in chat shows a rich syntax-highlighted diff (matching FileDiffView fidelity); on mobile it keeps the lightweight homegrown unified patch.
- **Test cases (Playwright candidates):**
  - On a desktop viewport, expanding an Edit tool card with old/new text renders the RichDiff (syntax-highlighted) and not the homegrown DiffView.
  - On a mobile viewport, expanding an Edit tool card renders the homegrown DiffView and not RichDiff.
  - On desktop, an Edit card with three edits renders exactly three RichDiff instances separated by borders.
  - On mobile, an Edit card with three edits renders exactly three homegrown DiffView instances.
  - An Edit card with neither old/new text nor edits renders raw JSON in a `<pre>` regardless of viewport.
  - The Edit tool card is collapsed by default and the rich diff only mounts after the user expands it.
- **Drift risk:** Low — a focused fidelity upgrade to a stable tool-renderer surface with clear viewport branching; the diff-in-chat behavior is core and unlikely to be reverted.

### 2026-05-01-session-card-last-activity-badge
- **Date:** 2026-05-01
- **Frontend surface:** Session card header relative-time badge
- **User-facing behavior:** The session card's time badge shows time since last activity (ticking "5s", "1m", resetting to "0s" on new activity) rather than time since spawn; ended sessions show time-since-end; hovering shows a "Started <date>" tooltip.
- **Test cases (Playwright candidates):**
  - After activity in a session, its card badge shows a small relative time (e.g. "0s"/"5s") reflecting last activity, not spawn time.
  - An idle session's badge advances over time (e.g. from "1m" to "2m").
  - Hovering a session card badge shows a `title` tooltip containing the original spawn date ("Started …").
  - An ended session's badge reflects time-since-end while the tooltip still shows the spawn time.
- **Drift risk:** Low — a stable, core session-card labeling behavior.

### 2026-05-01-session-card-unread-stripes
- **Date:** 2026-05-01
- **Frontend surface:** SessionCard (card body animation states)
- **User-facing behavior:** A session card shows cyan scrolling stripes when the agent did something attention-worthy while the user was not viewing it; opening the session clears the unread state. The bit persists across server restarts.
- **Test cases (Playwright candidates):**
  - When a non-viewed session's agent finishes a turn (streaming → idle), its card body shows cyan scrolling stripes rather than a blank body.
  - Opening/viewing an unread session clears the cyan stripes from its card.
  - A streaming session shows yellow stripes, not cyan, distinguishing streaming from unread.
  - An `ask_user` (input-requested) transition on a non-viewed session marks its card unread (cyan).
  - Per-message text streaming on a non-viewed session does NOT mark its card unread.
  - The unread cyan state on a card persists across a page reload / server restart.
- **Drift risk:** Low — core glanceable-state behavior with an explicit persistence guarantee; unlikely to be superseded, though exact color class may shift.

### 2026-05-02-add-darwin-x64-build
- **Date:** 2026-05-02
- **Frontend surface:** None (CI/Electron build pipeline; dashboard load is only a downstream smoke check)
- **User-facing behavior:** Intel Mac users get a working x64 DMG that launches the app, which eventually serves the dashboard in a browser.
- **Test cases (Playwright candidates):**
  - (no browser-observable UI behavior)
- **Drift risk:** Low — CI matrix/packaging change; no dashboard UI surface altered, so nothing for later UI changes to supersede.

### 2026-05-02-add-jj-workspace-plugin
- **Date:** 2026-05-02
- **Frontend surface:** jj-plugin session-card badge (JjWorkspaceBadge), JjActionBar, JjWorkspaceList/View, JjFoldBackDialog — gated to sessions inside a jj repo
- **User-facing behavior:** Sessions whose cwd is inside a Jujutsu repo show a jj workspace badge and action bar; users can list/add/forget jj workspaces and fold back changes, all rendered only when the session is in a jj repo/workspace.
- **Test cases (Playwright candidates):**
  - A session whose cwd is inside a jj repo renders the JjWorkspaceBadge on its card; a non-jj session does not.
  - The JjActionBar renders only for sessions in a jj repo/workspace and is hidden otherwise.
  - Opening the jj workspace view lists existing jj workspaces.
  - Triggering fold-back opens JjFoldBackDialog with the expected prompt content.
- **Drift risk:** Medium — a per-session predicate-gated plugin surface; badge/action-bar placement and predicate conditions are likely to be refined as the plugin evolves.

### 2026-05-02-fix-darwin-dmg-arch-collision
- **Date:** 2026-05-02
- **Frontend surface:** (none — Electron Forge DMG packaging config)
- **User-facing behavior:** Fixes macOS DMG artifact naming so both arch DMGs are produced with distinct filenames; no browser UI effect.
- **Test cases (Playwright candidates):**
  - (no browser-observable UI behavior)
- **Drift risk:** Low — packaging/release infra only.

### 2026-05-02-fix-replay-duplicates-tool-and-flushed-rows
- **Date:** 2026-05-02
- **Frontend surface:** ChatView message/tool-call rows (reducer replay path on reconnect/reload)
- **User-facing behavior:** After reconnects/reloads, each historical tool call and flushed assistant row renders exactly once instead of stacking dozens of duplicate copies, so the chat height and scrolling behave normally.
- **Test cases (Playwright candidates):**
  - Opening a long historical session renders each tool-call card exactly once in the DOM (no duplicated identical tool runs).
  - Reloading the chat tab (reconnect) leaves the rendered tool-card set byte-stable — count does not grow per reload.
  - A previously duplicated tool call (e.g. a specific command row) appears once, not 14–16×, after load.
  - Chat scroll height does not balloon after repeated reconnects.
- **Drift risk:** Low — a core reducer idempotency correctness fix with concrete before/after DOM verification; unlikely to be reverted.

### 2026-05-02-fix-slot-fallback-masks-content
- **Date:** 2026-05-02
- **Frontend surface:** ChatView / session detail pane (`sessionDetail`), plugin `content-view` slot in `App.tsx`
- **User-facing behavior:** Selecting a session shows its chat/detail view instead of silently rendering nothing when no plugin claims the content-view slot.
- **Test cases (Playwright candidates):**
  - Selecting a session with no content-view plugin claimed renders the session detail/chat pane (not a blank content area).
  - With a session selected, the chat view remains visible after a server restart / reload (regression guard for the disappearing content view).
- **Drift risk:** Medium — the plugin-slot fallback wiring is structural and later plugin extractions (`command-route`, `anchored-popover`) may have reshaped the fallback chain.

### 2026-05-02-fix-workspace-publishing
- **Date:** 2026-05-02
- **Frontend surface:** (none — npm publish/workspace packaging)
- **User-facing behavior:** Fixes broken npm publishing so all runtime workspace packages resolve on install; no dashboard UI effect.
- **Test cases (Playwright candidates):**
  - (no browser-observable UI behavior)
- **Drift risk:** Low — pure release/packaging infra with no UI surface.

### 2026-05-02-relax-tasks-parser-id-optional
- **Date:** 2026-05-02
- **Frontend surface:** TasksPopover (OpenSpec Tasks button/popover)
- **User-facing behavior:** The Tasks popover lists all checkbox rows even when tasks.md has no numeric id prefixes, instead of showing "No tasks." while the button reads a count.
- **Test cases (Playwright candidates):**
  - Opening the Tasks popover for a change whose tasks.md has id-less checkboxes shows all rows (e.g. 36 rows, 24 ticked) rather than "No tasks."
  - The popover row count matches the button label count (e.g. `Tasks 24/36`).
  - Toggling a row in an id-less-tasks popover flips the checkbox state and persists.
  - Opening the Tasks popover for a change with numeric ids still renders and toggles correctly (unchanged).
- **Drift risk:** Low — popover parsing fix for a stable core feature.

### 2026-05-02-strip-token-backgrounds-in-code-blocks
- **Date:** 2026-05-02
- **Frontend surface:** Syntax-highlighted code blocks in chat / Read / Write tool results and DiffPanel "File" view
- **User-facing behavior:** Code blocks no longer paint per-token background pills; characters render cleanly over a single panel background driven by the app theme (`var(--bg-code)`), including inside fenced `diff` blocks.
- **Test cases (Playwright candidates):**
  - A syntax-highlighted code block's individual tokens have no per-token background color (transparent token backgrounds).
  - The inner `<code>` element of a code block does not paint an opaque prism panel color over the themed panel background.
  - The code panel background matches `var(--bg-code)` for the active theme.
  - A fenced ```diff block shows no red/green per-token background wash on characters.
  - The DiffPanel "File" view renders with the same token-background stripping applied.
- **Drift risk:** Medium — a CSS/theme-level visual tweak to code rendering; likely to be revisited as themes/highlighter styles evolve.

### 2026-05-03-add-lightbox-to-markdown-images
- **Date:** 2026-05-03
- **Frontend surface:** MarkdownContent images (PiAssetImg) and ImageLightbox
- **User-facing behavior:** Clicking an image rendered in markdown (pi-asset, external URL, or inline data URL) opens the full-screen ImageLightbox with zoom/pan; unresolved placeholders are not clickable.
- **Test cases (Playwright candidates):**
  - Clicking a resolved `pi-asset:` image in markdown opens an ImageLightbox showing the resolved image.
  - Clicking an external `https://` markdown image opens the lightbox with that URL.
  - Clicking an inline `data:` markdown image opens the lightbox with that data URL.
  - An unresolved `pi-asset:` placeholder renders as a non-clickable span with no image.
  - Rendered markdown images show a `cursor-pointer` affordance.
  - Pressing Escape or clicking the backdrop closes the lightbox.
- **Drift risk:** Low — reuses an established lightbox pattern; stable interaction.

### 2026-05-03-auto-scroll-selected-session-card
- **Date:** 2026-05-03
- **Frontend surface:** SessionList — auto-scroll of the selected session card
- **User-facing behavior:** The sidebar keeps the currently-selected card in view when it moves under the user (status flip, hidden toggle, cwd/folder move, reorder) and on deep-link mount, but does NOT scroll when the user clicks a different card. Scroll uses `block: "nearest"` (no-op when already visible), instant.
- **Test cases (Playwright candidates):**
  - Deep-linking to `/session/:id` for a card below the fold scrolls it into view on initial load.
  - Clicking a session card below the fold does NOT scroll the list.
  - Ending the selected active session (causing a reorder) scrolls its card to its new position.
  - Hiding a non-selected session does NOT scroll the list.
  - Toggling hidden on the selected session scrolls if its card moves.
  - A background reorder (sessionOrderMap change) of the selected card scrolls it into view; a card already visible is not jittered.
- **Drift risk:** Low — a stable, well-scoped scroll-behavior helper unlikely to be replaced.

### 2026-05-03-chat-markdown-local-images-and-math
- **Date:** 2026-05-03
- **Frontend surface:** MarkdownContent in ChatView (assistant message rendering)
- **User-facing behavior:** Assistant messages now render local-file images (via `pi-asset:` resolution) and LaTeX-style inline/block math (KaTeX), both during streaming and after replay.
- **Test cases (Playwright candidates):**
  - An assistant message containing `[image not found: /abs/path.png]` renders an actual image, not a dropped/broken placeholder.
  - Inline math `$x = \beta$` in an assistant message renders as typeset math rather than literal dollar-bracketed text.
  - Block math `$$\sum_i^n i$$` renders as a centered typeset math block.
  - A local image appears the moment the closing `)` of the markdown token streams in, without waiting for message end.
  - After reconnect/replay of a session whose log contains `asset_register`, the referenced local image still renders.
  - A missing/oversized/non-image local path renders a visible placeholder text (e.g. `[image not found: …]`).
- **Drift risk:** Low — rendering capability in the core chat markdown surface; additive and unlikely to be removed.

### 2026-05-03-fix-pathpicker-windows-trailing-sep
- **Date:** 2026-05-03
- **Frontend surface:** PathPicker (Pin Directory dialog)
- **User-facing behavior:** On Windows, pressing Enter or clicking Select on a path ending in `\` (including UNC `\\server\share\`) confirms the directory instead of red-flashing invalid.
- **Test cases (Playwright candidates):**
  - With a `C:\Users\me\` input, pressing Enter confirms the selection and closes the picker without an invalid red flash.
  - With a `C:\Users\me\` input, clicking the Select button confirms the selection.
  - With a UNC `\\server\share\` input, pressing Enter confirms the selection.
- **Drift risk:** Low — narrow correctness fix to stable picker confirm rules.

### 2026-05-03-fix-stale-sessions-on-reconnect
- **Date:** 2026-05-03
- **Frontend surface:** Sidebar session list ordering across the "Show N ended" divider (on server restart / reconnect)
- **User-facing behavior:** After a server restart and automatic WebSocket reconnect, the sidebar replaces its session list atomically so no running session appears below the "Show N ended" divider, and stale sessions from the previous server lifetime disappear without a manual refresh.
- **Test cases (Playwright candidates):**
  - After a server restart with automatic reconnect, no active session renders below the "Show N ended" divider.
  - Sessions that existed only in the previous server lifetime are gone from the sidebar after reconnect (no manual refresh needed).
  - A session shown as active before restart is re-rendered as ended when the reconnect snapshot marks it ended.
- **Drift risk:** Low — a reconnect-correctness fix on a core sidebar behavior; stable and regression-guarded.

### 2026-05-03-preserve-pending-prompt-across-replay
- **Date:** 2026-05-03
- **Frontend surface:** ChatView optimistic pending-prompt bubble (ended-session resume)
- **User-facing behavior:** When a user submits a prompt to an ended session, their optimistic message bubble (with spinner) stays visible through the resume/replay round trip instead of vanishing.
- **Test cases (Playwright candidates):**
  - Typing a prompt into an ended session's chat and pressing Enter keeps the optimistic bubble visible across the resume→replay→first user_message round trip (never blanks out).
  - The optimistic bubble survives a session_state_reset without disappearing.
  - Pressing Stop/Esc during an in-flight resume clears the optimistic pending bubble.
  - A stalled resume still surfaces the existing 30s error path.
- **Drift risk:** Low — a core optimistic-prompt invariant reinforced repeatedly across later changes; behavior remains load-bearing.

### 2026-05-04-add-dashboard-plugin-skill
- **Date:** 2026-05-04
- **Frontend surface:** (none — pi skill/scaffolding tooling for plugin authors)
- **User-facing behavior:** Adds a `dashboard-plugin-scaffold` skill and template renderers; no dashboard browser UI is changed.
- **Test cases (Playwright candidates):**
  - (no browser-observable UI behavior)
- **Drift risk:** Low — tooling/scaffolding, not a rendered dashboard surface.

### 2026-05-05-consolidate-packages-settings-ui
- **Date:** 2026-05-05
- **Frontend surface:** Settings → Packages tab (UnifiedPackagesSection, PackageRow)
- **User-facing behavior:** The Packages tab shows a single unified list of package rows grouped into Core / Recommended / Other, each row with display name, source caption, source-type badge, and version, with no duplicate rows.
- **Test cases (Playwright candidates):**
  - The Packages tab renders three group headings: Core, Recommended Extensions, and Other.
  - A package on the Core whitelist that is also configured in settings appears in exactly one group (no duplicate row).
  - Core rows show an Update affordance and no Uninstall affordance.
  - Each package row displays a display name, source-type badge, and version string.
  - Opening a package row's kebab menu reveals its update/uninstall actions per group.
- **Drift risk:** Medium — Settings-panel layout is a frequently reorganized surface; grouping semantics may be revised.

### 2026-05-05-electron-server-launch-controls
- **Date:** 2026-05-05
- **Frontend surface:** Electron loading-page error state (loading.html) + system tray menu
- **User-facing behavior:** When the server can't start, the loading page offers a "Start server"/"Retry launch" button, an "Open Doctor" link, and a collapsible "Server log" panel; tray gains Start/Restart server items.
- **Test cases (Playwright candidates):**
  - The loading-page error state renders a "Start server" / "Retry launch" primary button.
  - Clicking the "Retry launch" button triggers a new launch attempt and updates the loading-page status text.
  - The loading-page error state renders an "Open Doctor" secondary link.
  - Expanding the "Server log" panel displays the last lines of server.log when present.
- **Drift risk:** Medium — Electron shell (loading.html) surface, not the main React dashboard; later bootstrap/launch changes (e.g. 2026-05-18) may reshape this error UI.

### 2026-05-05-fix-cold-boot-openspec-protocol
- **Date:** 2026-05-05
- **Frontend surface:** FolderOpenSpecSection (OpenSpec label + loading spinner)
- **User-facing behavior:** On cold boot (Electron), a folder's OpenSpec section appears without a manual reload, showing a brief grey spinner while polling and no section for folders lacking `openspec/changes/`.
- **Test cases (Playwright candidates):**
  - A folder with a pending OpenSpec poll (`pending: true`) renders a grey spinner in place of the OPENSPEC label.
  - A folder with `pending: false` and no openspec dir renders no spinner and no OpenSpec section.
  - When an `openspec_update` with populated changes arrives, the spinner is replaced by the OPENSPEC (N CHANGES) label.
- **Drift risk:** Low — spinner/pending UX is a focused stable addition tied to a documented spec.

### 2026-05-05-fix-terminal-half-height-dual-mount
- **Date:** 2026-05-05
- **Frontend surface:** `/folder/:cwd/terminals` — `TerminalsView` / `TerminalView` mounting
- **User-facing behavior:** Browser terminals fill the full content column height instead of half, with a single mount per terminal (no input duplication / scrollback drift).
- **Test cases (Playwright candidates):**
  - Opening `/folder/:cwd/terminals` with one terminal yields exactly one `.xterm` element (`querySelectorAll('.xterm').length === 1`).
  - Adding a second terminal yields exactly two `.xterm` elements (one per terminal, not two per terminal).
  - The rendered terminal fills the available content column height (no half-height ancestor at `window.innerHeight / 2`).
  - Typing a command shows output occupying the full visible viewport.
  - Resizing the browser window re-fits the terminal with no half-rendering/flicker.
- **Drift risk:** Low — a correctness fix pinning a stable single-mount invariant.

### 2026-05-05-platform-path-normalization
- **Date:** 2026-05-05
- **Frontend surface:** Pin directory grouping (sidebar) and the path picker input (parsePathInput), primarily server/shared normalization
- **User-facing behavior:** Sessions group correctly under their pinned folder across OSes (mixed separators / trailing separators / drive-letter case no longer split them); the path picker splits typed paths correctly per-OS. Mostly an internal correctness change.
- **Test cases (Playwright candidates):**
  - A session whose cwd differs from a pinned directory only by separator style / trailing separator / drive-letter case still groups under that pinned folder in the sidebar.
  - Typing a path with mixed separators into the path picker input splits into the correct parent/partial and shows expected autocomplete suggestions.
- **Drift risk:** Low — path-normalization correctness underpins grouping; behavior is foundational and unlikely to be reverted, though most logic is non-UI.

### 2026-05-05-render-skill-invocations-collapsibly
- **Date:** 2026-05-05
- **Frontend surface:** SkillInvocationCard (collapsible skill invocation in chat), CommandInput history recall, session name/search display
- **User-facing behavior:** A `/skill:*` chat message renders as a collapsed card showing `/skill:name args` with a chevron to expand the full body and copy buttons (including "Copy as message"); up-arrow recall and session names use the condensed form, not the full skill body.
- **Test cases (Playwright candidates):**
  - A skill-invocation user message renders as a collapsed card showing `/skill:<name> <args>` rather than the full inlined skill body.
  - Clicking the chevron expands the card to reveal the full skill body; clicking again collapses it.
  - The card shows a "Copy as message" button only when args are present, and clicking it copies the args verbatim.
  - The slash/args text is selectable by mouse drag (not swallowed by a header button).
  - The session display name derived from a skill-invoked first message shows the condensed skill name, not the skill body text.
- **Drift risk:** Low — introduces a dedicated card with a stable collapse/copy contract; core behavior is durable.

### 2026-05-05-replace-hardcoded-provider-lists
- **Date:** 2026-05-05
- **Frontend surface:** Settings → Provider Authentication (API-key section)
- **User-facing behavior:** The API-key section lists every provider pi knows (deepseek, fireworks, cerebras, moonshot, etc.), including runtime extension-registered ones, instead of a fixed hardcoded set.
- **Test cases (Playwright candidates):**
  - Opening Settings → Provider Authentication shows API-key rows for providers beyond the old hardcoded set (e.g. deepseek, fireworks, cerebras, mistral).
  - A provider whose env var is set displays its `envVar` on the row.
  - Saving then removing an API key for a newly listed provider (e.g. deepseek) updates its row state.
  - The anthropic OAuth login flow still completes and the anthropic-api row remains independent.
  - A provider registered at runtime by an extension appears as an API-key row after refresh.
- **Drift risk:** Low — Settings provider list is stable core behavior, though row detail may evolve.

### 2026-05-05-spawn-failure-diagnostics
- **Date:** 2026-05-05
- **Frontend surface:** Spawn error surfacing (spawn_error hints, spawn_register_timeout event); mostly server/bridge diagnostics
- **User-facing behavior:** Failed spawns surface classified error codes mapped to actionable hints and, on register timeout, an event with stderr tail; underlying tailing/classification is backend.
- **Test cases (Playwright candidates):**
  - A failed spawn surfaces an error whose classified code maps to an actionable hint (e.g. open wizard / rescan tools) rather than a raw message string.
  - A spawn that never registers surfaces a register-timeout indication after the watchdog window.
- **Drift risk:** Medium — primarily backend diagnostics; the UI hint surface is thin and later spawn-error toast work (harden-worktree-spawn) reshaped it.

### 2026-05-06-doctor-rich-output
- **Date:** 2026-05-06
- **Frontend surface:** Settings → Diagnostics page (DiagnosticsSection), Electron Doctor window; `GET /api/doctor` data
- **User-facing behavior:** The Doctor diagnostic renders as a rich, styled, section-grouped view (runtime / pi-tooling / server / setup / diagnostics) with per-problem suggestions and actions, available in both a web Settings → Diagnostics page and an Electron Doctor window.
- **Test cases (Playwright candidates):**
  - Settings → Diagnostics renders a Doctor view populated from `/api/doctor` (checks grouped into sections).
  - Each error/warning check displays a suggestion / next-step affordance.
  - Checks are grouped under section headings (runtime, pi-tooling, server, setup, diagnostics).
  - The diagnostics page is reachable from a remote browser (not only the Electron menu).
- **Drift risk:** Low — establishes a durable diagnostics surface with a stable data contract; core view unlikely to be replaced.

### 2026-05-06-fix-uuid-rename-bug
- **Date:** 2026-05-06
- **Frontend surface:** SessionCard (session name label) + attached-proposal chip
- **User-facing behavior:** A session card no longer auto-renames itself to a UUID-shaped token from OpenSpec paths; valid change slugs (e.g. `add-auth`) still auto-attach and rename correctly.
- **Test cases (Playwright candidates):**
  - Triggering OpenSpec activity referencing a UUID-shaped path does not change the SessionCard name to that UUID and leaves the attached-proposal chip unset.
  - Triggering activity for a real change (`openspec/changes/add-auth/...`) auto-renames the SessionCard to `add-auth` and shows it attached.
- **Drift risk:** Low — auto-attach/rename is core session behavior; the fix targets a stable invariant.

### 2026-05-07-fix-custom-provider-flag-race
- **Date:** 2026-05-07
- **Frontend surface:** Settings → Provider Authentication → API Keys list
- **User-facing behavior:** Custom providers from providers.json no longer appear as duplicate "Add Key" rows under API Keys; they stay only in the LLM Providers section.
- **Test cases (Playwright candidates):**
  - Opening Settings → Provider Authentication → API Keys within a second of load shows no custom-provider row (e.g. `proxy`) in the API Keys list.
  - Opening Settings → Provider Authentication → API Keys still shows pi-ai default API-key providers (deepseek, mistral) as rows.
  - Opening Settings → LLM Providers still lists the custom provider as a managed CRUD entry.
  - The custom provider's models still appear in the model selector dropdown.
- **Drift risk:** Low — the API Keys vs LLM Providers separation is stable core behavior of the Settings surface.

### 2026-05-07-fix-provider-retry-infinite-loop
- **Date:** 2026-05-07
- **Frontend surface:** ChatView retry banner ("Rate-limited — retrying…"), Stop button
- **User-facing behavior:** When a provider rate-limits, a transient retry banner appears above the input with an indeterminate spinner, and the Stop button reliably cancels the session.
- **Test cases (Playwright candidates):**
  - When a retryable provider error occurs, a "Rate-limited — retrying…" banner renders above the chat input.
  - The retry banner shows an indeterminate spinner (no countdown) rather than a numeric retry timer.
  - The retry banner disappears when a successful response or agent end arrives.
  - Clicking Stop during the retry phase clears the banner and stops the session.
- **Drift risk:** Medium — the retry banner concept persists, but 2026-06-29-unify-error-retry-lifecycle explicitly reframes this banner, so the exact rendering here is likely superseded.

### 2026-05-07-fix-providers-list-spurious-models-refreshed
- **Date:** 2026-05-07
- **Frontend surface:** ModelSelector (session model dropdown)
- **User-facing behavior:** Navigating away and back to a previously-visited session no longer leaves the model selector dead/disabled — the model list stays populated.
- **Test cases (Playwright candidates):**
  - Navigating session A → B → back to A keeps A's ModelSelector enabled with a chevron and its selected model shown.
  - After the A→B→A sequence, the ModelSelector button is not rendered `disabled` and not muted.
  - Clicking the ModelSelector after returning to a prior session opens the model dropdown (handler is active).
- **Drift risk:** Low — a regression fix guarding a core, long-lived control behavior.

### 2026-05-08-add-dashboard-model-proxy
- **Date:** 2026-05-08
- **Frontend surface:** None (server-side `/v1/...` proxy endpoints and API-key surface)
- **User-facing behavior:** Adds always-on OpenAI/Anthropic-compatible HTTP model endpoints on the dashboard server for external clients; no browser UI is described.
- **Test cases (Playwright candidates):**
  - (no browser-observable UI behavior)
- **Drift risk:** Low — backend capability tied to the dashboard daemon lifecycle; no UI surface to be superseded.

### 2026-05-08-add-openspec-change-grouping
- **Date:** 2026-05-08
- **Frontend surface:** FolderOpenSpecSection, ArchiveBrowserView, SessionOpenSpecActions attach dialog — group pills, group manager, substring filter
- **User-facing behavior:** OpenSpec change listings can be organized into per-repo named/colored groups; users switch group pills, filter by name substring, manage groups, and repos without a groups file behave as a flat "Ungrouped" list.
- **Test cases (Playwright candidates):**
  - With groups defined, a pill row appears and selecting a pill filters visible changes to that group.
  - Typing in the substring filter narrows the visible change list by name.
  - Changes render under their group sections in the folder OpenSpec view.
  - A repo with no groups file shows a flat list with no pill row (Ungrouped behavior).
  - Deleting a group moves its previously assigned changes into Ungrouped after refresh.
  - Group sections/pills appear in both the archive view and the attach dialog.
- **Drift risk:** Medium — a feature layered across three OpenSpec listing surfaces; those surfaces are actively reworked by adjacent changes, so pill placement may drift.

### 2026-05-08-migrate-pi-fork-to-earendil
- **Date:** 2026-05-08
- **Frontend surface:** None (package resolution chains / jiti loader / Electron launch cwd)
- **User-facing behavior:** With pi installed under the `@earendil-works` scope, the server starts without the "Cannot find pi's TypeScript loader" error; only visible as the dashboard loading normally.
- **Test cases (Playwright candidates):**
  - (no browser-observable UI behavior)
- **Drift risk:** Low — dependency/resolution rename; no dashboard UI component touched.

### 2026-05-09-add-session-status-to-folder-proposal-rows
- **Date:** 2026-05-09
- **Frontend surface:** `FolderOpenSpecSection` linked-session rows (sidebar OpenSpec proposal pills)
- **User-facing behavior:** Each linked-session pill under a proposal shows a source icon colored by session status (with pulse for streaming/resuming), and the row owning the currently-open session gets a blue selected border.
- **Test cases (Playwright candidates):**
  - A streaming linked-session row shows `linked-session-status-icon` with `text-yellow-500` and `animate-pulse`.
  - An idle linked-session row shows the status icon with `text-green-500` and no `animate-pulse`.
  - An ended linked-session row shows the status icon with `text-[var(--text-muted)]` and no `animate-pulse`.
  - A resuming linked-session row shows `text-yellow-500` + `animate-pulse` (resuming overrides status).
  - When `selectedId` matches a row's session, that `linked-session-row` carries `data-selected="true"` and `border-blue-500/60`.
  - Unselected linked-session rows render `border-transparent` and no `data-selected` attribute.
  - Selected and unselected rows render at identical height (no layout shift on selection).
  - Lifecycle action icons (hide/unhide/resume/fork) on the row still fire without selecting the row (event propagation stopped).
- **Drift risk:** Low — status-visual vocabulary is a stable core signal mirrored from SessionCard.

### 2026-05-09-fix-extension-slash-commands-in-dashboard
- **Date:** 2026-05-09
- **Frontend surface:** ChatView — command feedback card (CommandFeedbackCard)
- **User-facing behavior:** Typing an extension slash command (e.g. `/ctx-stats`) shows a command-feedback row that transitions in place from started to completed/failed, with the error message rendered on failure, instead of echoing the slash text to the LLM.
- **Test cases (Playwright candidates):**
  - Typing `/ctx-stats` renders a single command-feedback row that transitions from a started (in-progress) state to a terminal state in place.
  - On an unsupported-dispatch environment, the `/ctx-stats` feedback row shows a red error state with the full error message text rendered.
  - A failed extension slash command does not append the literal slash text as an LLM user message in the timeline.
  - A command-feedback row shows exactly one started and one terminal event (no duplicate rows).
  - Typing an unknown slash like `/totally-unknown-command` passes through without emitting a command-feedback card.
- **Drift risk:** Medium — command-feedback rendering is fairly stable, but the started→terminal dedup/transition detail is subtle and could change with reducer refactors.

### 2026-05-09-fix-fork-empty-session-silent-timeout
- **Date:** 2026-05-09
- **Frontend surface:** Session card Fork action, new-session placeholder card, degradation toast
- **User-facing behavior:** Forking a freshly-spawned empty session immediately creates a fresh session in the same cwd (~1s) with a non-blocking toast, instead of a 30s stalled placeholder and error banner.
- **Test cases (Playwright candidates):**
  - Clicking Fork on an empty (no-history) session produces a new session card in the same cwd within a few seconds.
  - A non-blocking toast explaining the fork degradation appears on the new session card.
  - The forked-degraded session does not display the 30s "Pi started but never connected" banner.
  - Forking a session that has real history still forks normally (no degradation toast).
- **Drift risk:** Low — the fork degradation UX addresses a core reliability path likely to remain.

### 2026-05-09-fix-session-card-icon-import-and-shell-boundary
- **Date:** 2026-05-09
- **Frontend surface:** `SessionCard` (source icon), layout chrome `ErrorBoundary` in `App.tsx`
- **User-facing behavior:** Spawning a fresh session no longer blanks the window; a render error in shell chrome degrades to an in-window recoverable message with a reload link.
- **Test cases (Playwright candidates):**
  - Spawning several fresh sessions in succession keeps the window rendered (no blank window, session cards visible).
  - A session card with an unknown `source` renders the fallback console icon without crashing the tree.
  - A render-time throw in a shell chrome component shows the ErrorBoundary fallback message with a working "Reload page" link (instead of a blank window).
- **Drift risk:** Low — the error-boundary safety net and icon fallback are stable defensive behaviors.

### 2026-05-09-linked-session-pill-lifecycle-icons
- **Date:** 2026-05-09
- **Frontend surface:** FolderOpenSpecSection linked-session pills (sidebar)
- **User-facing behavior:** Each attached-session pill under a change row gains inline lifecycle icons — hide/unhide, resume, and fork — while the name region still jumps to the session.
- **Test cases (Playwright candidates):**
  - For an alive, non-hidden linked session, the pill shows a hide (eye-off) icon and a fork icon, with no unhide or resume icon.
  - For a hidden linked session, the pill shows an unhide (eye) icon and a resume icon, with no hide icon.
  - For a non-alive session with a session file, the pill shows a resume icon.
  - A session lacking a session file shows neither resume nor fork icons.
  - Clicking a pill's hide/unhide/resume/fork icon fires its action and does NOT trigger navigation (stopPropagation).
  - Clicking the pill's name region navigates to that session.
- **Drift risk:** Low — additive inline controls with explicit conditional-rendering rules; behavior is well-specified and scoped.

### 2026-05-09-redesign-session-card-subcards
- **Date:** 2026-05-09
- **Frontend surface:** SessionCard body reorganized into subcards (OPENSPEC, WORKSPACE, PROCESS, MEMORY, FLOWS), source-icon status gutter, folder header parallel redesign
- **User-facing behavior:** The session card groups controls into titled inset subcard panels with uppercase capsule legends; empty subcards are hidden; the status dot is replaced by a source icon colored by status; the left gutter becomes the drag zone.
- **Test cases (Playwright candidates):**
  - When every section has content, all five subcard titles (OPENSPEC, WORKSPACE, PROCESS, MEMORY, FLOWS) render in order.
  - With `processes=[]`, the PROCESS subcard is hidden.
  - With no plugin claiming `session-card-memory`, the MEMORY subcard is hidden.
  - On a mobile viewport, no subcard panels render.
  - A selected card's outer `<li>` retains the `border-blue-500/60` and `ring-1 ring-blue-500/30` classes.
  - A streaming session's outer `<li>` carries the `card-working-pulse` class.
  - The status gutter renders the source icon (TUI/Headless/tmux/Zed) colored by session status, with the source label as its tooltip.
- **Drift risk:** High — an early subcard redesign; the next-in-sequence `redesign-session-card-and-composer` re-split WORKSPACE into GIT/JJ and changed the same subcards, so this exact layout is likely superseded.

### 2026-05-09-register-build-time-tools
- **Date:** 2026-05-09
- **Frontend surface:** None (tool-registry definitions, CI/Docker/postinstall build scripts)
- **User-facing behavior:** Registers `electron`/`node-pty` in the ToolRegistry so build-time resolution works regardless of npm hoisting; purely build/infra.
- **Test cases (Playwright candidates):**
  - (no browser-observable UI behavior)
- **Drift risk:** Low — backend/build resolution only.

### 2026-05-09-spawn-correlation-token
- **Date:** 2026-05-09
- **Frontend surface:** Spawn/fork flow — placeholder spawn card + session auto-select in sidebar
- **User-facing behavior:** Spawning or forking a session shows a placeholder card that resolves to the correct new session and auto-selects it; killing a forked session no longer kills its parent.
- **Test cases (Playwright candidates):**
  - Clicking "New Session" shows a placeholder spawn card in the target folder group.
  - The placeholder card is replaced by (or resolves into) the real session card when the session registers.
  - Two spawns launched in the same folder produce two distinct placeholder cards, not one.
  - After a fork completes, the newly forked session becomes the selected/open session automatically.
  - Killing a forked session removes only that card and leaves the parent session card present.
- **Drift risk:** Medium — core spawn-correlation behavior is stable, but placeholder-card UI keyed by requestId may have been restyled by later card changes.

### 2026-05-09-unify-opsx-colon-hyphen-aliases
- **Date:** 2026-05-09
- **Frontend surface:** ChatView command input / SkillInvocationCard (collapsible skill-invocation rendering)
- **User-facing behavior:** Typing a slash command with either separator (`/opsx:archive` or `/opsx-archive`) resolves the same skill and renders a collapsible skill card; prompt templates stay un-wrapped; unknown names pass through unchanged.
- **Test cases (Playwright candidates):**
  - Typing `/opsx:archive` in the command input renders a collapsible SkillInvocationCard.
  - Typing `/opsx-archive` (same skill) renders the same collapsible SkillInvocationCard.
  - Typing a prompt-template command (`/opsx-continue my-change` or `/opsx:continue my-change`) produces an un-wrapped expansion with no skill card.
  - Typing `/opsx:nonexistent foo` passes the input through unchanged (no card, no expansion).
- **Drift risk:** Medium — alias resolution logic is stable, but the SkillInvocationCard UI could have been restyled by later rendering changes.

### 2026-05-09-unify-server-launch-ts-loader
- **Date:** 2026-05-09
- **Frontend surface:** None (shared server-launcher consolidation, jiti resolver)
- **User-facing behavior:** Consolidates five server-launch call sites into one shared launcher; internal refactor with no browser UI effect.
- **Test cases (Playwright candidates):**
  - (no browser-observable UI behavior)
- **Drift risk:** Low — backend launch-path refactor only.

### 2026-05-10-add-session-card-status-mosaic-rail
- **Date:** 2026-05-10
- **Frontend surface:** SessionCard left gutter (status rail + source icon chip)
- **User-facing behavior:** Each session card's left gutter shows a status-tinted rail line whose color reflects session state (streaming/resuming amber, etc.), giving a glanceable status signal.
- **Test cases (Playwright candidates):**
  - A streaming/resuming session card's gutter rail renders with the amber status color.
  - Idle/waiting/ended/error session cards render their respective rail colors (green/muted/red palettes).
  - A selected session card swaps the rail to the `-400` selected shade.
  - The source icon chip renders in the gutter above the rail.
- **Drift risk:** High — this is a purely visual gutter treatment that went through three rejected iterations; a later redesign likely superseded the exact rail geometry/alpha.

### 2026-05-10-honcho-dashboard-plugin
- **Date:** 2026-05-10
- **Frontend surface:** Honcho settings-section panel, session-card-memory slots (badge + actions), anchored-popover session-name editor
- **User-facing behavior:** A Honcho settings page mirrors the TUI surfaces; when the extension is absent an "Install pi-memory-honcho" CTA with live progress renders; per-card memory badges/actions and a name-editor popover appear once installed.
- **Test cases (Playwright candidates):**
  - When `pi-memory-honcho` is not installed, the settings panel shows an "Install pi-memory-honcho" call-to-action button.
  - Clicking the install CTA shows a spinner, streaming progress, and an indeterminate progress bar.
  - On install success the panel shows a success banner; on failure it shows a retry button.
  - Per-card memory badge and action slots stay hidden until the extension is installed and render once it is.
  - The per-card name-editor popover round-trips: open → edit → save → reopen shows the new value.
- **Drift risk:** Medium — plugin slot targets were rerouted (session-card-badge/action-bar → session-card-memory), so card surfaces likely shifted.

### 2026-05-10-merge-windows-integration-linear
- **Date:** 2026-05-10
- **Frontend surface:** (none directly — platform abstraction layer, ToolRegistry, Windows correctness; cross-cutting)
- **User-facing behavior:** A curated cherry-pick merge introducing platform primitives and Windows fixes; no specific browser-observable UI change asserted in the record.
- **Test cases (Playwright candidates):**
  - (no browser-observable UI behavior)
- **Drift risk:** Low — integration/refactor branch without a described UI surface.

### 2026-05-10-replace-tsx-with-jiti
- **Date:** 2026-05-10
- **Frontend surface:** (none — runtime/bootstrap loader change)
- **User-facing behavior:** Removes tsx as a TypeScript loader/dependency in favor of jiti across bin, install lists, and doctor; no browser UI effect.
- **Test cases (Playwright candidates):**
  - (no browser-observable UI behavior)
- **Drift risk:** Low — infra/tooling change with no UI surface.

### 2026-05-10-session-card-attached-change-link
- **Date:** 2026-05-10
- **Frontend surface:** SessionCard (attached-proposal badge)
- **User-facing behavior:** A session card with an attached OpenSpec change shows the change name as a distinct clickable link that scrolls to the matching change card.
- **Test cases (Playwright candidates):**
  - A session card with an attached proposal renders the change name as a styled link (colored text, hover underline) rather than plain text.
  - Clicking the attached-change link scrolls the matching change card (`[data-change-name="…"]`) into view.
  - Each change card exposes a `data-change-name` attribute matching its change name.
- **Drift risk:** Medium — depends on the OpenSpec section layout, which the 2026-06-14 board redesign restructured (scroll target may have moved).

### 2026-05-10-simplify-electron-bootstrap-derived-state
- **Date:** 2026-05-10
- **Frontend surface:** (none for the web client — Electron bootstrap + `/api/health`)
- **User-facing behavior:** Electron startup derives launch decisions from filesystem probes and stamps a `DASHBOARD_STARTER` value; no browser-rendered UI change.
- **Test cases (Playwright candidates):**
  - (no browser-observable UI behavior)
- **Drift risk:** Low — Electron/server bootstrap internals with no web-client surface.

### 2026-05-10-wire-plugin-registry-into-shell
- **Date:** 2026-05-10
- **Frontend surface:** Plugin slot rendering wiring (jj-plugin badge/action-bar, settings-section panels) — build-time registry generation
- **User-facing behavior:** Manifest-declared plugin slot claims finally render in the UI: a jj workspace session shows the jj badge and action bar, and the settings panel shows plugin settings sections.
- **Test cases (Playwright candidates):**
  - Opening a jj workspace session renders the jj badge and action bar once, in the slot area below OpenSpec actions.
  - The Settings panel shows the JjPluginSettings and FlowsAnthropicBridgeSettings sections.
- **Drift risk:** Medium — this is enablement wiring rather than a distinct visual surface; the rendered slots themselves were later moved by the session-card subcard redesigns.

### 2026-05-11-add-plugin-ui-primitive-registry
- **Date:** 2026-05-11
- **Frontend surface:** UI-primitive registry (shell → plugin) enabling flows-plugin to consume `MarkdownContent`, `AgentCardShell`, `ConfirmDialog`, `DialogPortal` via lookup
- **User-facing behavior:** Plugins render dashboard primitives (markdown, agent card, confirm dialog) via a registry instead of direct imports; visually flow content still renders the same rich markdown and agent cards.
- **Test cases (Playwright candidates):**
  - Flow content that uses the markdown primitive renders formatted markdown (headings/lists) rather than raw text.
  - A flow agent card rendered via the `ui:agent-card` primitive displays its name, status, and stats.
  - A plugin-triggered confirm dialog renders via the shared confirm primitive with its message and confirm label.
- **Drift risk:** Medium — primarily an internal wiring/registry change; the visible output depends on flow surfaces that later redesigns and extractions continued to move.

### 2026-05-11-adopt-server-driven-intent-rendering
- **Date:** 2026-05-11
- **Frontend surface:** Plugin slot consumers (ContentViewSlot, SessionCardActionBarSlot) — IntentStore / IntentRenderer resolving server-driven intents
- **User-facing behavior:** Plugin UI is now driven by server-broadcast JSON intents that each client resolves through its local primitive registry, so all connected clients render the same plugin UI identically and in sync.
- **Test cases (Playwright candidates):**
  - A broadcast plugin intent for a slot renders the resolved primitive component in that slot.
  - Two intents for the same slot from different plugins both render.
  - A null intent for a slot clears the previously rendered content.
  - An unknown primitive in an intent falls back gracefully (e.g. "Unknown primitive") rather than crashing the view.
  - The dashboard loads with all plugins active and no console errors/white-screen.
- **Drift risk:** Low — this is the foundational architecture pivot for plugin rendering; it defines the intended stable contract rather than being superseded.

### 2026-05-11-auto-hide-empty-session-subcards
- **Date:** 2026-05-11
- **Frontend surface:** SessionCard OPENSPEC subcard, MEMORY subcard (honcho-plugin), SettingsPanel OpenSpec toggle
- **User-facing behavior:** The OPENSPEC subcard hides for sessions whose cwd has no `openspec/` dir (or when disabled in Settings); the MEMORY subcard hides when the honcho memory extension is not installed (claims render nothing). Empty subcards no longer show as blank boxes.
- **Test cases (Playwright candidates):**
  - A session whose cwd has no `openspec/` directory does not render the OPENSPEC subcard.
  - A session with a pending OpenSpec change renders the OPENSPEC subcard.
  - Disabling "Enable OpenSpec" in Settings hides the OPENSPEC subcard across all session cards; re-enabling restores it.
  - With the `pi-memory-honcho` extension not installed, no session card shows a MEMORY subcard.
  - When the honcho extension is installed, the MEMORY subcard appears on the next render.
- **Drift risk:** Medium — the hide-when-empty rule is durable, but subcard structure overlaps with other session-card reworks.

### 2026-05-11-pluginize-flows-via-registry
- **Date:** 2026-05-11
- **Frontend surface:** Session card flow badge/actions, FlowDashboard content header, flow agent detail route, FlowArchitect, `/flows` slash commands (all now plugin-owned; shell contains zero flow references)
- **User-facing behavior:** Flow rendering is fully driven by plugin slot claims and a new event-stream hook; a user still sees the flow badge, dashboard, agent detail, architect view, and `/flows` command menus exactly as before.
- **Test cases (Playwright candidates):**
  - Running a flow shows the flow activity badge on the session card.
  - Running a flow renders FlowDashboard in the content header.
  - Clicking a flow agent opens the agent detail view via its content-view route, and Back navigates correctly.
  - Typing `/flows` opens the flow picker; `/flows:new` opens the new-flow dialog; `/flows:edit` opens the edit picker; `/flows:delete` opens the delete picker.
  - A session that triggers architect mode renders FlowArchitect, and architect detail navigates and dismisses.
- **Drift risk:** Medium — the slot/registry wiring is core and stable, but the exact badge subcard placement was corrected soon after in `fix-flows-plugin-polish`.

### 2026-05-11-slot-generic-claim-entry
- **Date:** 2026-05-11
- **Frontend surface:** Dashboard plugin slot registry / ClaimEntry typing (build-time type contract)
- **User-facing behavior:** Type-level tightening of plugin slot predicates; no browser-observable UI change (slot/predicate mismatches now surface at build time).
- **Test cases (Playwright candidates):**
  - (no browser-observable UI behavior)
- **Drift risk:** Low — internal type contract, no rendered surface.

### 2026-05-12-add-flows-subcard
- **Date:** 2026-05-12
- **Frontend surface:** SessionCard — FLOWS subcard (desktop subcard stack), flow action buttons
- **User-facing behavior:** Session cards gain a dedicated translucent "FLOWS" subcard grouping the flow controls (Run/New/Edit/Delete), shown only when a session has flows available, positioned between PROCESS and MEMORY.
- **Test cases (Playwright candidates):**
  - When a session has flow claims available, a subcard with the "FLOWS" legend title is visible on its card.
  - When a session has no flow plugin claims, the FLOWS subcard is absent from its card.
  - Subcards render in the order OPENSPEC → WORKSPACE → PROCESS → FLOWS → MEMORY on a card with all present.
  - Clicking Run / New / Edit / Delete inside the FLOWS subcard opens their respective dialogs.
  - The generic action-bar region below the subcard stack no longer contains flow buttons.
- **Drift risk:** Medium — subcard grouping is tied to the redesigned card layout and slot taxonomy that later plugin/intent changes actively reworked, so exact placement may shift.

### 2026-05-12-overlay-url-routing
- **Date:** 2026-05-12
- **Frontend surface:** URL routes for previously state-only overlays (OpenSpecPreview, ArchiveBrowserView, SpecsBrowserView, README, pi-resources, session diff), unified back navigation
- **User-facing behavior:** Every full-screen overlay gets a real URL, so browser back/forward, refresh, deep-linking, and open-in-new-tab work, and Back from an overlay returns to the exact prior view (e.g. Settings) instead of `/`.
- **Test cases (Playwright candidates):**
  - Navigating from `/settings` to an OpenSpec proposal artifact then clicking Back returns to `/settings` (not `/`).
  - Opening an OpenSpec preview URL cold (refresh) renders the artifact correctly without prior state.
  - Opening the OpenSpec archive, specs, README, pi-resources, pi-resource query, and session diff URLs each render the correct view from a cold load.
  - A multi-overlay chain (Settings → proposal → archive → README) with three Back presses returns to `/settings`.
  - From `/` opening `/session/:id` and clicking the header back arrow returns to `/`.
  - Switching tabs within the preview does not push a new URL, and Back still returns to the URL that opened the preview.
- **Drift risk:** Low — establishes browser history as the single source of truth for on-screen views; core navigation behavior that later features build on rather than replace.

### 2026-05-13-add-ui-model-selector-primitive
- **Date:** 2026-05-13
- **Frontend surface:** Settings → General → pi-flows Roles (BuiltInRolesSettings) — model picker via `ui:model-selector` primitive (ModelSelector)
- **User-facing behavior:** The bespoke inline role model picker is replaced by the shared ModelSelector primitive (with provider filter); picking a model persists the full `provider/modelId` string, and role pills render the provider-qualified label.
- **Test cases (Playwright candidates):**
  - In Settings → General → pi-flows Roles, clicking a role (e.g. `@planning`) opens the shared model selector with a provider filter.
  - A bare-id role with a matching live model renders a pill showing a synthesized `provider/id` label.
  - A slash-form role value renders verbatim in its pill.
  - Picking a model updates the role pill to the full `provider/id` string.
- **Drift risk:** Medium — Settings roles UI and the primitive registry are actively evolving areas; the picker host may be restructured.

### 2026-05-13-fix-pi-flows-end-to-end
- **Date:** 2026-05-13
- **Frontend surface:** `/roles` row above `ModelSelector`, flows-anthropic-bridge status panel, plugin registry drift banner
- **User-facing behavior:** Flow abort takes effect promptly, the `/roles` UI renders as a row above the model selector, the bridge status panel reports reporting sessions, and stale remote clients get a plugin-registry mismatch signal.
- **Test cases (Playwright candidates):**
  - The `/roles` UI renders as a row above the `ModelSelector` (its own slot mount point), not embedded inside the selector.
  - Aborting a running flow transitions the flow UI out of the "running" state promptly (does not stay stuck running).
  - The `/api/flows-anthropic-bridge/status` panel shows reporting sessions instead of "no sessions reporting" when a flow session is active.
  - A client with a stale plugin registry surfaces a mismatch/out-of-sync banner instead of silently missing slots.
- **Drift risk:** Medium — multi-part fix spanning UI and backend; the `/roles` slot and bridge panel could be reworked as the flows plugin evolves.

### 2026-05-14-add-shared-pi-package-resolver
- **Date:** 2026-05-14
- **Frontend surface:** None (shared package resolver; plugin bridge peer probe; /api/health JSON)
- **User-facing behavior:** Plugin bridges resolve pi-installed peers and move from `waiting_peers` to `active`; visible only via the `/api/health` JSON endpoint, not rendered UI.
- **Test cases (Playwright candidates):**
  - (no browser-observable UI behavior)
- **Drift risk:** Low — backend resolver/plugin plumbing; no dashboard DOM surface.

### 2026-05-14-surface-mid-turn-prompt-queue
- **Date:** 2026-05-14
- **Frontend surface:** QueuePanel (mid-turn prompt queue), CommandInput enable/disable state, pending-prompt safety banner
- **User-facing behavior:** Typing a prompt while the agent is streaming shows the queued messages in a panel with order/count; a Clear-all empties the queue, and the misleading pending-prompt timeout is suppressed while items are queued.
- **Test cases (Playwright candidates):**
  - Sending a prompt while the agent is streaming adds a chip to the QueuePanel showing the pending text.
  - Multiple queued prompts render in insertion order with a correct count display.
  - The QueuePanel caps rendered chips with an overflow indicator when more than five are queued.
  - Clicking Clear-all empties the QueuePanel.
  - CommandInput stays enabled when a prompt is pending while streaming and is disabled when a prompt is pending while idle.
  - The "prompt may not have been received" error banner does not fire while a prompt is queued.
- **Drift risk:** Low — introduces a distinct queue surface with well-defined behavior; core interaction unlikely to be wholly replaced.

### 2026-05-15-defer-role-persistence-with-save-reload
- **Date:** 2026-05-15
- **Frontend surface:** Settings → pi-flows Roles section (role pills, Save/Reload buttons, dirty markers, preset Load/Save)
- **User-facing behavior:** Picking a role model no longer auto-saves; instead the pill shows a dirty dot and a Save badge count; Save persists all pending picks, Reload discards them and snaps to server values; loading a preset while dirty prompts to discard unsaved changes.
- **Test cases (Playwright candidates):**
  - Picking a model for a role marks its pill with a dirty dot and does not immediately persist (no `role_set` on pick).
  - Re-picking the persisted value clears the pill's dirty dot.
  - The Save badge count increases with each distinct dirty role and returns to clean after Save.
  - Clicking Save persists all pending role changes; after reload the new values are shown.
  - Clicking Reload clears all dirty dots and snaps pills back to server values.
  - Clicking a preset's Load while there are unsaved role changes shows a discard confirmation.
- **Drift risk:** Medium — settings section behavior is fairly stable, but roles UX has iterated (preset delete button, etc.).

### 2026-05-15-folder-workspaces
- **Date:** 2026-05-15
- **Frontend surface:** Sidebar workspaces tier (named collapsible folder containers) above the top-level pinned/session groups
- **User-facing behavior:** Users can create named, collapsible workspace containers that group one or more folders; workspaces render above the top-level area, are independently closable, persist server-side, and keep a folder visible even when unpinned and with zero sessions.
- **Test cases (Playwright candidates):**
  - A created workspace renders as a named container above the top-level pinned/session groups.
  - Adding a folder to a workspace keeps that folder visible inside the workspace even when it is unpinned and has zero sessions.
  - Collapsing a workspace hides its folder rows; the collapsed state persists across a page reload.
  - Removing a folder from a workspace returns it to top-level behavior (visible only if pinned or has sessions).
  - Adding a folder already in workspace A to workspace B moves it out of A (appears in only one workspace).
  - Top-level area (pinned folders + session-discovered groups) still renders below the workspaces area unchanged.
- **Drift risk:** Medium — workspaces are a reintroduced concept and the DnD reorder was deferred to a later change; the container UI is core but still being extended.

### 2026-05-16-add-plugin-activation-ui
- **Date:** 2026-05-16
- **Frontend surface:** Plugin activation UI (plugin list with enable/disable toggles), slot-registry enable filter
- **User-facing behavior:** Users see a list of discovered plugins with a toggle to enable/disable each; disabling a plugin stops its claims from rendering (no broken buttons).
- **Test cases (Playwright candidates):**
  - The plugin activation UI lists each discovered plugin with its `displayName` and an enable/disable toggle.
  - Toggling a plugin off removes its slot claims from the rendered UI (its buttons no longer appear).
  - Toggling a plugin surfaces a "restart required" indication to the user.
- **Drift risk:** Medium — mixed backend/UI feature; the activation surface layout may evolve as more plugin metadata is added.

### 2026-05-18-add-steering-message
- **Date:** 2026-05-18
- **Frontend surface:** CommandInput (chat message composer), optional pi queue-state display
- **User-facing behavior:** In the chat input, Enter sends a steering message (interrupts sooner) and Alt+Enter sends a follow-up message.
- **Test cases (Playwright candidates):**
  - Pressing Enter in CommandInput sends the prompt with delivery "steer".
  - Pressing Alt+Enter in CommandInput sends the prompt with delivery "followUp".
  - A pending prompt's delivery indicator clears on agent_start/agent_end/abort.
- **Drift risk:** Low — Enter/Alt+Enter send semantics mirror the TUI and are a stable core interaction.

### 2026-05-18-fix-electron-cold-launch-probe-cascade
- **Date:** 2026-05-18
- **Frontend surface:** None (Electron LaunchSource resolver / CLI wrapper / self-heal pipeline)
- **User-facing behavior:** The app cold-boots from the icon without the "Cannot find pi's TypeScript loader (jiti)" fatal error; success is only visible as the dashboard eventually loading.
- **Test cases (Playwright candidates):**
  - (no browser-observable UI behavior)
- **Drift risk:** Low — pure backend resolution fix; no dashboard DOM surface to be superseded.

### 2026-05-18-route-frontend-openspec-to-skills
- **Date:** 2026-05-18
- **Frontend surface:** SessionOpenSpecActions, MobileActionMenu, NewChangeDialog (OpenSpec action buttons)
- **User-facing behavior:** OpenSpec action buttons (New, Continue, FF, Apply, Verify, Archive) emit `/skill:openspec-<verb>-change` slash commands instead of `/opsx:<verb>`. Button labels, icons, and disabled states are unchanged.
- **Test cases (Playwright candidates):**
  - Clicking Apply in the OpenSpec actions row sends a prompt containing `/skill:openspec-apply-change` (not `/opsx:apply`).
  - Clicking Verify sends `/skill:openspec-verify-change`.
  - Clicking Archive sends `/skill:openspec-archive-change`.
  - Opening the New Change dialog and confirming sends `/skill:openspec-new-change`.
  - The mobile action menu OpenSpec rows emit the `/skill:openspec-<verb>-change` form when tapped.
  - Button labels and icons remain unchanged (visual regression against prior labels/icons).
- **Drift risk:** Low — command-routing behavior tied to maintained skill surface; button structure stable, only emitted string changed.

### 2026-05-19-add-followup-edit-and-steer-cancel
- **Date:** 2026-05-19
- **Frontend surface:** `QueuePanel`/`PromptQueuePanel` (steer + follow-up chips), steering inline bubbles in `ChatView`
- **User-facing behavior:** Users can cancel all steering, and edit/remove a queued follow-up via chip controls; queue state survives browser reconnect. (Note: largely superseded by 2026-05-29-rework-mid-turn-prompt-queue.)
- **Test cases (Playwright candidates):**
  - Sending a steer mid-stream shows a `STEERING` ghost bubble anchored after the streaming assistant text.
  - Clicking ✕ on the steering bubble removes it and the agent continues.
  - Clicking "Cancel all steering" wipes all visible steer chips.
  - Clicking ✏ on a follow-up chip opens an inline editor; submitting updates the chip text.
  - Clicking ✕ on a follow-up chip removes it.
  - Sending a steer then refreshing the browser: the chip is still visible on reconnect (state survives via server cache/replay).
  - When both steer and follow-up queues are empty, the queue panel is hidden.
- **Drift risk:** High — this UI (per-chip steer cancel/edit, follow-up-as-single-slot) was explicitly superseded by the later mid-turn-queue rework; assertions likely stale.

### 2026-05-21-add-flow-agent-popout
- **Date:** 2026-05-21
- **Frontend surface:** Flow agent popout page, subagent popout page, shell overlay routes (`FlowAgentPopoutPage`, `SubagentPopoutPage`)
- **User-facing behavior:** Users can open a flow agent's or subagent's full timeline in a dedicated full-window tab via a permalink URL, and reopen it cold from that URL while the main session view stays free.
- **Test cases (Playwright candidates):**
  - Navigating to `/session/<sid>/subagent/<aid>` on a desktop viewport renders the SubagentPopoutPage (its `data-testid` present) and does NOT render the LandingPage.
  - Navigating to `/session/<sid>/flow/<flow>/agent/<agent>` on a desktop viewport renders the FlowAgentPopoutPage.
  - Navigating to either popout URL on a mobile viewport renders the page inside the mobile detail panel.
  - Cold-opening a popout URL with no prior subscription triggers exactly one session subscribe request before content renders.
  - Clicking the eye/popout button on a flow agent card opens the corresponding popout tab.
- **Drift risk:** Medium — routing-slot plumbing is fairly load-bearing, but later flow-plugin polish changes moved buttons and hardened URLs, so specific selectors may have shifted.

### 2026-05-21-extract-minimal-chat-view
- **Date:** 2026-05-21
- **Frontend surface:** Shared `MinimalChatView` component consumed by SubagentDetailView and FlowAgentDetail (agent/subagent timeline renderer)
- **User-facing behavior:** Subagent and flow-agent timelines are rendered by one shared component with a consistent header (status pill, title, model, tokens, duration) and tool/text/thinking/error rows; inline, popout, and row modes look identical to before extraction.
- **Test cases (Playwright candidates):**
  - Expanding a subagent card renders the shared timeline with the same title, status pill, and tool/text/thinking entries as before.
  - Opening the subagent popout URL `/session/<sid>/subagent/<aid>` renders a layout matching the inline view.
  - Clicking the eye button on a FlowAgentCard opens a popover showing the same detail layout (title, tools, summary footer).
  - Each of the four entry kinds (tool, text, thinking, error) renders its expected elements.
  - A tool entry with output shows an expand toggle that opens on click; a tool entry without output shows no toggle.
  - A tool entry with `isError: true` paints the row border and name red.
  - A subtitle path renders in monospace below the title, and header meta (↑/↓ tokens, duration) is hidden when meta is omitted.
- **Drift risk:** Low — a de-duplication extraction preserving the existing rendering contract; consolidating both call sites onto one component makes this the stable renderer going forward.

### 2026-05-21-fix-flows-plugin-polish
- **Date:** 2026-05-21
- **Frontend surface:** FlowArchitectDetail (now MinimalChatView), FlowAgentCard/FlowArchitect expand+popout buttons, FLOWS subcard status pill, ChatView widget-bar prompt suppression
- **User-facing behavior:** Architect detail now uses the shared timeline look; the Details (eye) and Popout buttons are larger with text labels; the running-flow status pill lives in the FLOWS subcard (not WORKSPACE); popout opens a real tab; flow-question prompts render only in the upper slot, not doubled in chat.
- **Test cases (Playwright candidates):**
  - Expanding a FlowArchitect detail renders the MinimalChatView-style timeline.
  - The FlowAgentCard shows a visible "Details" label next to the eye icon and "Popout" next to the open-in-new icon (labels hidden on narrow viewports).
  - Clicking Popout opens a valid session URL tab, not `about:blank`.
  - A running flow shows the status pill (e.g. "▶ custom:test (running) N/M agents") with an abort button inside the FLOWS subcard.
  - The WORKSPACE subcard contains no flow content.
  - Answering a flow-question prompt shows it only as a pill in the upper slot and not inline in ChatView.
  - After confirming "Run now?", the upper slot transitions from the architect view to the flow view.
- **Drift risk:** Medium — a polish sweep on flow-plugin internals; badge placement and button styling are exactly the kind of visual detail later redesigns (session-card subcards) may re-touch.

### 2026-05-21-route-flow-asks-to-upper-slot
- **Date:** 2026-05-21
- **Frontend surface:** FlowDashboard upper slot (`content-header-sticky`) — flow-question prompt routing vs. chat stream
- **User-facing behavior:** When a running flow needs human input, the question renders in the FlowDashboard upper slot above the chat (not inline in the chat stream) when the flows-plugin is enabled; otherwise it falls back to the chat.
- **Test cases (Playwright candidates):**
  - With flows-plugin enabled and a flow-tagged prompt, the question widget renders in the FlowDashboard upper slot, not in the chat message stream.
  - With flows-plugin disabled (or old pi-flows without metadata), a flow question renders inline in the chat stream.
  - A non-flow `ask_user` prompt continues to render via the default chat adapter.
- **Drift risk:** Medium — flow-plugin slot placement is part of the actively evolving flows UI (see later flow-graph fixes), so the upper-slot surface may be reworked.

### 2026-05-23-fix-restart-port-loss
- **Date:** 2026-05-23
- **Frontend surface:** None (restart-helper orchestrator argv)
- **User-facing behavior:** After `POST /api/restart` on a non-default port, the server reappears on the same port so WS clients reconnect correctly; no rendered UI change.
- **Test cases (Playwright candidates):**
  - (no browser-observable UI behavior)
- **Drift risk:** Low — server restart argv fix, no UI.

### 2026-05-23-reset-shadow-queues-on-shutdown
- **Date:** 2026-05-23
- **Frontend surface:** pendingQueues steering/follow-up chips in the chat view
- **User-facing behavior:** Shutting down (or aborting) a session with queued steering/follow-up messages clears the queued chips immediately instead of briefly showing stale chips.
- **Test cases (Playwright candidates):**
  - With queued steering/follow-up messages, clicking Shutdown clears the pending queue chips (a final empty queue_update) rather than leaving stale chips visible.
  - Clicking Stop/Abort on a session with queued messages clears the pending queue chips.
- **Drift risk:** Medium — queue-chip rendering is browser-observable but the chip UI is a niche region that later queue work may adjust.

### 2026-05-25-add-dynamic-pwa-manifest-naming
- **Date:** 2026-05-25
- **Frontend surface:** Settings panel (PWA display name input); PWA manifest/install metadata
- **User-facing behavior:** A settings text input "PWA display name (shown when installed as an app)" lets users override the installed-app name; blank reverts to a host-based default.
- **Test cases (Playwright candidates):**
  - Settings panel renders a text input labeled "PWA display name (shown when installed as an app)".
  - Typing a name into the PWA display-name input and saving persists the value across reload.
  - Clearing the PWA display-name input and saving reverts the field to empty (host-based default).
- **Drift risk:** Low — a single stable settings input; server-side manifest generation is not browser-DOM observable.

### 2026-05-25-fix-retry-banner-stuck-on-limit-exceeded
- **Date:** 2026-05-25
- **Frontend surface:** ErrorBanner and RetryBanner (chat header banners)
- **User-facing behavior:** On a hard usage-limit/billing error, only the terminal red ErrorBanner shows; the transient yellow RetryBanner no longer stays stuck.
- **Test cases (Playwright candidates):**
  - When a usage-limit error occurs, the red ErrorBanner is displayed.
  - After a usage-limit error, the yellow RetryBanner is not displayed (does not remain stuck).
  - The two banners are never displayed simultaneously for a usage-limit error.
- **Drift risk:** Medium — banner behavior depends heavily on backend event ordering that later changes may re-tune.

### 2026-05-26-adapt-windows-integration-pr9
- **Date:** 2026-05-26
- **Frontend surface:** ToolRegistry override UI (Settings-area binary override) — mostly cross-platform server/infra
- **User-facing behavior:** Ships Windows correctness, a platform strategy-router, and a ToolRegistry with a binary-override UI and REST endpoints; primarily backend/build correctness.
- **Test cases (Playwright candidates):**
  - The ToolRegistry binary-override UI renders and allows setting an override path (if exposed in Settings).
- **Drift risk:** Medium — the override UI may exist but is a small surface; most of the change is non-browser infra likely stable at the API level.

### 2026-05-26-add-ci-electron-on-demand-build
- **Date:** 2026-05-26
- **Frontend surface:** (none — GitHub Actions CI workflow / Electron packaging)
- **User-facing behavior:** Adds a manually-dispatchable CI workflow that builds Electron installers on a branch with no npm publish or GitHub Release; no browser UI effect.
- **Test cases (Playwright candidates):**
  - (no browser-observable UI behavior)
- **Drift risk:** Low — CI/infra only, no dashboard UI surface.

### 2026-05-26-add-worktree-lifecycle-actions
- **Date:** 2026-05-26
- **Frontend surface:** WorktreeActionsMenu in the WORKSPACE subcard, cwd-missing session indicator/recovery UI
- **User-facing behavior:** Worktree sessions get a menu of lifecycle actions (push, open PR, merge into base, remove) with safety pre-flights (e.g. active-session kill-confirm); sessions whose cwd disappeared get a visual "cwd missing" cue and recovery affordance.
- **Test cases (Playwright candidates):**
  - A worktree session's WORKSPACE subcard renders a WorktreeActionsMenu with push, open PR, merge, and remove actions.
  - Triggering "remove" on a worktree with active sessions shows a kill-confirm dialog listing the active sessions before destructive removal.
  - A session whose `cwdMissing` flag is set renders a distinct "cwd missing" visual indicator on its card.
  - The merge/push/PR actions surface success (e.g. PR URL / merge result) or error feedback in the UI.
- **Drift risk:** Medium — a broad new action surface built atop the still-evolving worktree pill/subcard; menu layout and states likely to be refined.

### 2026-05-26-add-worktree-spawn-dialog
- **Date:** 2026-05-26
- **Frontend surface:** Session card WORKSPACE subcard (worktree pill next to branch), session grouping in sidebar, worktree create/list button
- **User-facing behavior:** Worktree sessions are grouped under their parent repo and cluster together; the session card's WORKSPACE subcard shows a "worktree" pill beside the `⎇ <branch>` line (base branch in tooltip); a button lists existing worktrees and creates new ones under `.worktrees/<slug>/`.
- **Test cases (Playwright candidates):**
  - A session with `gitWorktree` set renders a "worktree" pill in its WORKSPACE subcard next to the `⎇ <branch>` line.
  - The `⎇ <branch>` display remains present and unchanged when the worktree pill is shown.
  - The worktree pill's tooltip/title exposes the base branch.
  - Sessions belonging to a worktree appear grouped under the parent repo's group (not in a separate orphan group) and cluster adjacent to each other.
  - A session without `gitWorktree` shows no worktree pill.
- **Drift risk:** Medium — supersedes two prior proposals and introduces the pill/grouping that later lifecycle work builds on; grouping logic is fairly stable but the pill's exact placement may have been refined.

### 2026-05-26-eliminate-electron-runtime-install
- **Date:** 2026-05-26
- **Frontend surface:** None (Electron packaging / dependency layout / build + install pipeline); minor Doctor advisory on upgrade
- **User-facing behavior:** Backend/packaging change — pi/openspec/tsx become regular dependencies pre-installed at build/install time, eliminating the runtime-install machinery; no dashboard web-UI behavior changes (an Electron Doctor advisory may appear on legacy-dir upgrades).
- **Test cases (Playwright candidates):**
  - (no browser-observable UI behavior)
- **Drift risk:** Low — infrastructure/packaging change with no web UI surface.

### 2026-05-26-fix-vite-proxy-hardcoded-port
- **Date:** 2026-05-26
- **Frontend surface:** Dev-mode Vite proxy config (build/infra; indirectly affects Stop button, streaming, flow ops)
- **User-facing behavior:** In dev mode with a non-default port, API/WebSocket requests reach the correct server so session controls (Stop/abort, send_prompt, flow ops) work.
- **Test cases (Playwright candidates):**
  - (no browser-observable UI behavior) — this is a Vite proxy/config fix; observable symptoms depend on a non-default dev port setup, not a DOM assertion.
- **Drift risk:** Low — a build-config fix with no standalone UI element to drift.

### 2026-05-26-history-nav-only-when-empty
- **Date:** 2026-05-26
- **Frontend surface:** CommandInput (chat input textarea) keyboard handling
- **User-facing behavior:** ArrowUp/ArrowDown only recall prompt history when the input is empty; with text present they move the cursor. Ctrl/Cmd+ArrowUp/Down force history recall regardless.
- **Test cases (Playwright candidates):**
  - Pressing ArrowUp on a single-line non-empty draft does NOT replace the draft with history.
  - Pressing ArrowUp on the first line of a multi-line draft does NOT trigger history recall.
  - Pressing ArrowUp on an empty input populates it with the most recent prompt.
  - Pressing ArrowUp with empty text but a pending image attached does NOT recall history and keeps the image.
  - Pressing Ctrl+ArrowUp (or Cmd+ArrowUp) with non-empty text recalls the most recent prompt, and Escape restores the prior draft.
  - Pressing Ctrl+ArrowDown walks forward in history and past the newest entry restores the in-progress draft.
  - Pressing Ctrl+ArrowUp while the `/`-command dropdown is open does NOT recall history.
- **Drift risk:** Low — core chat-input keyboard semantics; stable behavior unlikely to be reverted.

### 2026-05-26-workspace-actions
- **Date:** 2026-05-26
- **Frontend surface:** Sidebar group headers (SessionList), Add Worktree dialog (AddWorktreeDialog)
- **User-facing behavior:** Directory group headers gain an "Add worktree" icon button that opens a modal to create a git worktree (branch name input, auto-derived path preview, create/cancel); the "Add pi-agent" spawn button already existed.
- **Test cases (Playwright candidates):**
  - The group header renders an "Add worktree" icon button when the group has a detected git branch, and hides it when there is no git branch.
  - The "Add worktree" button is only shown on a localhost connection (hidden on remote).
  - Clicking "Add worktree" opens the AddWorktreeDialog showing the base branch, a branch-name input, and an auto-derived worktree path preview.
  - Typing a branch name updates the auto-derived path preview.
  - Confirming the dialog triggers the create action and shows a toast on success.
  - The existing "Add pi-agent" spawn button (`spawn-session-btn`) is present in the group header.
- **Drift risk:** Medium — this change was largely unimplemented (worktree tasks unchecked) and later superseded by `add-worktree-spawn-dialog`; the worktree UI shape likely differs from what shipped.

### 2026-05-26-worktree-awareness
- **Date:** 2026-05-26
- **Frontend surface:** SessionCard git-info indicator (worktree vs branch)
- **User-facing behavior:** A session whose CWD is a git worktree shows a worktree identity (🌲 folder name) instead of the branch (⎇ branch); group headers keep showing branch + PR.
- **Test cases (Playwright candidates):**
  - A session card whose session is a worktree shows `🌲 <folder-name>` instead of `⎇ <branch>`.
  - A session card in a plain (non-worktree) git repo still shows the `⎇ <branch>` branch indicator.
  - The directory group header continues to show branch + PR (unchanged) regardless of worktree sessions.
- **Drift risk:** Medium — worktree display on the card is fairly specific and may have been reworked when git/composer git-group rendering evolved (referenced in the 2026-06-23 E2E change).

### 2026-05-27-fix-doctor-stale-managed-install-check
- **Date:** 2026-05-27
- **Frontend surface:** Settings → Diagnostics (DiagnosticsSection)
- **User-facing behavior:** On a clean install, Diagnostics shows no "Managed install (~/.pi-dashboard)" warning row; when a legacy directory exists, exactly one "Legacy install directory" warning row appears.
- **Test cases (Playwright candidates):**
  - Opening Settings → Diagnostics on a clean install shows no row labeled "Managed install (~/.pi-dashboard)".
  - Opening Settings → Diagnostics on a clean install shows no perpetual yellow warning for managed install.
  - When a legacy `~/.pi-dashboard` is present, Diagnostics renders exactly one "Legacy install directory" warning row.
- **Drift risk:** Medium — Diagnostics section is a stable surface, but exact row wording is historic and may have changed.

### 2026-05-27-fix-node-resolution-under-electron
- **Date:** 2026-05-27
- **Frontend surface:** Settings → Tools (node/npm/npx rows), Doctor view
- **User-facing behavior:** On a packaged Electron install, Settings → Tools shows `node` (and npm/npx) as found with source "bundled" instead of a false "not found".
- **Test cases (Playwright candidates):**
  - In Settings → Tools on a packaged Electron install, the `node` row shows as found (not the ❌ "not found" state).
  - The tools rows for `node`/`npm`/`npx` display source "bundled".
  - The Doctor view no longer shows a "node not detected" false-positive row.
- **Drift risk:** Low — a correctness fix to a stable tool-status display; unlikely to be superseded structurally.

### 2026-05-27-tighten-process-list-ux
- **Date:** 2026-05-27
- **Frontend surface:** ProcessList on the session card
- **User-facing behavior:** The session-card process list hides self-spawned dashboard infrastructure, surfaces real subprocesses faster, and pads to a stable 5-row minimum so the card height stops jumping.
- **Test cases (Playwright candidates):**
  - When one process is present, ProcessList renders 1 real row plus skeleton rows padding to 5 slots.
  - When 5 processes are present, ProcessList renders 5 real rows with no overflow row.
  - When 6 processes are present, ProcessList renders 5 real rows plus an overflow row.
  - ProcessList renders nothing (null) when there are 0 processes.
  - Process rows are ordered by elapsed time descending.
  - The overflow row's title/tooltip lists the hidden process commands.
- **Drift risk:** Low — the 5-slot floor and ordering are concrete, stable rendering rules; self-spawn exclusion is server/bridge-side (not browser-observable).

### 2026-05-28-SUPERSEDED-bridge-owned-followup-queue
- **Date:** 2026-05-28
- **Frontend surface:** QueuePanel (follow-up queue chips with edit/remove/promote/pull controls); ChatView steer ghost bubble
- **User-facing behavior:** Follow-ups queued while the agent streams appear as chips with `[✎]` edit, `[✕]` remove, `[⇧]` promote, and `[→ editor]` pull buttons; queued items drain one per turn end without ghost duplicates; a "Clear all" appears when more than one is queued.
- **Test cases (Playwright candidates):**
  - Queuing a follow-up while the agent is streaming shows a chip with `[✎]`, `[✕]`, `[⇧]`, and `[→ editor]` buttons.
  - Clicking `[✎]` on a chip reveals an inline textarea; editing and confirming updates that chip in place without creating a ghost duplicate.
  - Clicking `[✕]` removes that chip from the queue.
  - The `[⇧]` promote button is disabled for the first (index 0) chip.
  - Clicking `[→ editor]` removes the chip from the queue and populates the composer draft with its text.
  - A "Clear all" control appears only when more than one follow-up is queued.
  - Reloading the dashboard empties the follow-up queue chips.
- **Drift risk:** High — the change id is explicitly marked SUPERSEDED; this queue architecture was revived/replaced, so its UI is likely not the current form.

### 2026-05-28-SUPERSEDED-honest-mid-turn-queue-surface
- **Date:** 2026-05-28
- **Frontend surface:** QueuePanel (read-only follow-up cycler), ChatView (inline ghost user-message bubbles for steering)
- **User-facing behavior:** The queue panel is a read-only follow-up cycler with no mutation buttons (no per-chip remove/edit/promote, no "Clear all"). Steering entries render inline as ghost user-message bubbles in the chat, not in the queue panel.
- **Test cases (Playwright candidates):**
  - The QueuePanel does not render remove, edit, promote, editor, or "Clear all" controls (their test-ids are absent).
  - Multiple queued follow-up entries display in the read-only cycler and can be cycled through.
  - A steering entry appears as a ghost user-message bubble inline in ChatView rather than in the queue panel.
- **Drift risk:** High — explicitly SUPERSEDED; a follow-up change (`bridge-owned-followup-queue`) reworks this same UI path.

### 2026-05-28-add-editor-keeper-sidecar
- **Date:** 2026-05-28
- **Frontend surface:** Editor iframe (`/editor/<id>/`) embedded view; Settings → editor toggle
- **User-facing behavior:** After a dashboard restart, the embedded code-server editor reappears at the same URL with tabs preserved; a settings toggle controls whether editors stop on dashboard exit.
- **Test cases (Playwright candidates):**
  - After a dashboard restart, the editor iframe loads the same `/editor/<id>/` URL as before the restart.
  - The Settings "Stop editors when dashboard exits" toggle renders and its value persists across reload (round-trips through /api/config).
- **Drift risk:** Low — mostly server/sidecar infra; the browser-observable stable-URL behavior is a durable core guarantee.

### 2026-05-28-adopt-model-resolve-handler-and-roles-ownership
- **Date:** 2026-05-28
- **Frontend surface:** RolesSettingsSection (Settings → roles)
- **User-facing behavior:** Users manage model roles and role presets in Settings; the underlying event handlers moved into the dashboard but the UI behavior is preserved.
- **Test cases (Playwright candidates):**
  - Opening the Roles settings section lists current role assignments (get-all).
  - Setting a role for a model persists and the assignment remains after reload.
  - Loading a role preset replaces the displayed role assignments wholesale.
  - Saving a new role preset adds it to the preset list; deleting a preset removes it from the list.
- **Drift risk:** Medium — event names preserved for one release and a `roles:*` rename is deferred, so the wiring behind this UI is explicitly slated to change.

### 2026-05-28-bump-pi-compat-to-0-75
- **Date:** 2026-05-28
- **Frontend surface:** pi-compatibility banner / "consider upgrading" hint (version-handling UI)
- **User-facing behavior:** The dashboard declares compatibility with pi 0.75.x, so users on 0.75 no longer see a stale upgrade framing.
- **Test cases (Playwright candidates):**
  - A session running a pi 0.75.x version does not show the stale "consider upgrading" compatibility hint.
- **Drift risk:** Medium — a version-floor JSON bump; the banner text/thresholds it affects change every release and are quickly superseded.

### 2026-05-28-configurable-chat-display
- **Date:** 2026-05-28
- **Frontend surface:** ChatView (⚙ View ▾ popover), Settings ▸ General ▸ Display, first-launch modal, TokenStatsBar, ContextUsageBar, ThinkingBlock, ToolCallStep, CollapsedToolGroup
- **User-facing behavior:** Users control which chat-view elements render (token bar, context bar, reasoning, tool calls/results) via global settings and per-session overrides. A first-launch modal offers Simple/Standard/Show-everything presets; a per-session "View" popover toggles elements and can reset to global.
- **Test cases (Playwright candidates):**
  - On fresh install, the first-launch display modal appears with three radio options (Simple / Standard / Show everything).
  - Selecting "Simple" hides reasoning blocks and tool results in the chat without a reload.
  - Toggling a display element in Settings ▸ General ▸ Display updates the chat immediately (and a second open tab updates via WS broadcast).
  - Opening the ChatView "⚙ View ▾" popover and hiding bash tool calls affects only the current session; another session is unchanged.
  - After a per-session override, a "view modified" pill appears; clicking "Use global settings" clears the override and removes the pill.
  - The first-launch modal is skippable and defaults to Standard.
- **Drift risk:** Medium — gating logic spans many components and is likely refined by later chat-display changes, though the preference mechanism is durable.

### 2026-05-28-extension-ui-system
- **Date:** 2026-05-28
- **Frontend surface:** Generalized extension UI slots (management-modal, footer-segment, agent-metric, breadcrumb, gate, toast, settings-section)
- **User-facing behavior:** Extensions describe UIs as data that the dashboard renders in a bounded set of named slots — e.g. a slash-command-triggered management modal with table/grid/form views, plus footer segments, metrics, and settings sections.
- **Test cases (Playwright candidates):**
  - Triggering an extension's registered slash command opens its management-modal slot rendering the declared table/grid/form view.
  - A descriptor-declared footer-segment renders in the dashboard footer slot.
  - A descriptor `settings-section` renders a UiField-driven form in the Settings page.
  - An extension-emitted toast descriptor renders a toast in the dashboard.
  - Extension-provided table data (`ui_data_list`) populates the management-modal's table view.
- **Drift risk:** Medium — a generalized slot framework; the mechanism is foundational but individual slot kinds and rendering evolve as new phases land.

### 2026-05-28-extract-flows-as-plugin
- **Date:** 2026-05-28
- **Frontend surface:** All flow rendering (FlowDashboard, FlowAgentCard, FlowAgentDetail, FlowSummary, FlowGraph, FlowArchitect, FlowActivityBadge, SessionFlowActions, flow badges on SessionCard)
- **User-facing behavior:** Flow rendering is moved into a standalone plugin package; with the plugin present the flow badge, dashboard, agent detail, and architect view still appear identically, and with it disabled no flow UI renders even when flow events arrive.
- **Test cases (Playwright candidates):**
  - Launching a flow in a session shows the flow activity badge on that session card.
  - Clicking into a running flow agent opens the agent detail view.
  - A session with both flow and architect state populated renders the sticky headers in the expected order (FlowArchitect above/with FlowDashboard).
  - With the flows plugin disabled, no flow UI renders even when `flow_*` events are received.
  - Completing a flow renders the flow summary footer, and dismissing returns the session card to its non-flow state.
- **Drift risk:** Medium — this is a file-move refactor preserving behavior, but the JSX-to-slot migration was explicitly deferred to follow-ups, so the mount points changed shortly after.

### 2026-05-29-rework-mid-turn-prompt-queue
- **Date:** 2026-05-29
- **Frontend surface:** `QueuePanel` (follow-up queue), steering inline ghost bubbles in `ChatView`
- **User-facing behavior:** The follow-up queue is bridge-owned with per-entry edit/remove/promote/pull-to-editor and a cycler; the steer queue renders read-only inline ghost bubbles.
- **Test cases (Playwright candidates):**
  - Queuing 3 follow-ups shows the QueuePanel with a "3 OF 3" indicator and ↑/↓ cycler.
  - The cycler navigates back through queued follow-up entries (c → b → a).
  - Promote (⇧) on the middle entry reorders it to the front while keeping the visible entry stable.
  - Editing an entry (Cmd/Ctrl+Enter or Save) updates that entry's text in place; Esc cancels.
  - Remove (✕) on an entry deletes it (with confirm for long text) and adjusts the visible index.
  - "Clear all" control is only shown when more than one follow-up is queued.
  - A mid-stream steer renders an inline `STEERING` ghost user bubble in ChatView that disappears when the turn drains.
- **Drift risk:** Medium — the queue UX was reworked multiple times (Phase 1/3/4); still subject to further iteration.

### 2026-05-29-show-full-tool-call-args
- **Date:** 2026-05-29
- **Frontend surface:** ToolCallStep, CollapsedToolGroup (collapsed summaries), BashToolRenderer (expanded command)
- **User-facing behavior:** Collapsed tool-call summaries no longer hard-slice argument strings; CSS ellipsis handles overflow and a hover `title` shows the full summary. Expanding a bash tool call shows the complete command, wrapped across lines.
- **Test cases (Playwright candidates):**
  - A long bash command in a collapsed ToolCallStep row is ellipsized via CSS (not hard-cut at 60 chars) and the row's `title` attribute contains the full command.
  - A collapsed CollapsedToolGroup row exposes the full summary in its `title` attribute (no 50-char slice).
  - Expanding a bash tool call renders the complete command, wrapping (`break-all`) rather than truncating.
  - A long `Agent` description and a long `ask_user` title show their full text in the collapsed row's tooltip.
- **Drift risk:** Low — a bounded readability fix to stable tool-call rows.

### 2026-05-29-unify-status-banner-and-terminal-limit-stop
- **Date:** 2026-05-29
- **Frontend surface:** SessionBanner (replaces RetryBanner + inline lastError red banner), mounted sticky above the command input
- **User-facing behavior:** A single status banner shows one of three variants — yellow `retrying` (with Stop), red `error` (with Retry + Dismiss), red `limit-exceeded` (Dismiss + "Session stopped automatically." hint, no Retry) — instead of two overlapping banners.
- **Test cases (Playwright candidates):**
  - A transient retry state shows the yellow `retrying` banner with a Stop button and nothing else.
  - A terminal `usage_limit_reached` error shows the red `limit-exceeded` banner with Dismiss and hint text and NO Retry button.
  - A non-billing terminal error shows the red `error` banner with a Retry button.
  - `data-testid="error-banner"` and `data-testid="error-banner-dismiss"` resolve within the `error` and `limit-exceeded` variants.
  - Clicking Stop on the retrying banner fires the abort and the banner does not show "Aborted by user".
  - A long banner message truncates with a toggle, and the copy control writes the full message to the clipboard.
  - The `hidden` variant renders no banner.
- **Drift risk:** Low — a consolidation onto one banner selector driven by core session state (retry/error/limit); this is stable failure-surface behavior unlikely to be replaced wholesale.

### 2026-05-30-document-login-shell-non-interactive-fix
- **Date:** 2026-05-30
- **Frontend surface:** None (shared platform binary-lookup + docs)
- **User-facing behavior:** Documents and test-guards the `$SHELL -lc` (no `-i`) invariant in login-shell tool detection; no browser UI effect.
- **Test cases (Playwright candidates):**
  - (no browser-observable UI behavior)
- **Drift risk:** Low — internal shell-detection logic and docs only.

### 2026-05-30-fix-changed-files-desktop-route
- **Date:** 2026-05-30
- **Frontend surface:** FileDiffView routing on desktop (`/session/:id/diff`), SessionHeader above diff
- **User-facing behavior:** Clicking "Changed Files" on desktop now renders the FileDiffView (with the SessionHeader above it) instead of collapsing to the empty LandingPage.
- **Test cases (Playwright candidates):**
  - Navigating to `/session/<id>/diff` on desktop renders FileDiffView and does not show the "Pick a session on the left" LandingPage.
  - The SessionHeader remains visible above the diff view on the diff route.
  - Clicking "Changed Files" in a session with file changes opens the diff view; clicking Back returns to the chat view in the same session.
  - Mobile navigation to the diff route still renders the diff view unchanged.
- **Drift risk:** Low — a routing bug fix restoring the intended diff view; core behavior, unlikely to be re-broken/replaced.

### 2026-05-30-openspec-worktree-spawn-button
- **Date:** 2026-05-30
- **Frontend surface:** FolderActionBar (`+Worktree`), FolderOpenSpecSection (per-change `⑂+` button), WorktreeSpawnDialog, SettingsPanel (gitWorktreeEnabled checkbox)
- **User-facing behavior:** A per-change `⑂+ spawn-attached-in-worktree` button sits next to the existing `▶` spawn button and opens the worktree dialog prefilled with branch `os/<change-name>` and the change attached. A new setting toggles visibility of both the folder `+Worktree` and per-change worktree buttons.
- **Test cases (Playwright candidates):**
  - The per-change `⑂+` button renders next to the `▶` spawn-attached button in a git-repo folder's OpenSpec row.
  - Clicking `⑂+` opens WorktreeSpawnDialog with the branch input prefilled to `os/<change-name>`.
  - Disabling "Show worktree spawn buttons" in Settings hides both `+Worktree` and `⑂+`; enabling shows both together.
  - In a non-git folder, the `+Worktree` and `⑂+` buttons do not render.
  - Typing a branch name matching an orphan `.worktrees/<name>` dir surfaces an inline warning and a Clean-up button.
- **Drift risk:** Medium — depends on FolderOpenSpecSection layout which has churned across several OpenSpec-card changes.

### 2026-05-30-redesign-session-card-and-composer
- **Date:** 2026-05-30
- **Frontend surface:** SessionCard (split GIT/JJ subcards, OPENSPEC stepper), ComposerSessionActions strip, selected-card ring
- **User-facing behavior:** The session card splits workspace into separate GIT and JJ subcards, shows a seven-node OpenSpec lifecycle stepper with done/current/todo states, mirrors session actions in a composer strip, and gives the selected card a neon ring identity.
- **Test cases (Playwright candidates):**
  - A colocated repo shows both GIT and JJ subcards; a pure-git repo hides the JJ subcard; a pure-jj repo hides the GIT subcard.
  - The OPENSPEC stepper renders seven nodes (Explore→Proposal→Design→Specs→Tasks→Apply→Archive) with the current step marked and highlighted.
  - The `Explore` button is enabled only when no proposal is attached; `Archive` is enabled only when a proposal is attached.
  - Clicking `Apply` in the composer action strip sends the prompt `/skill:openspec-apply-change <change>`.
  - With session status streaming, every composer action button is disabled while refresh stays enabled.
  - The selected desktop card renders the selected ring; the mobile session list shows no ring.
- **Drift risk:** High — an early structural/visual redesign of the card; the very next-day `redesign-session-card-subcards` and later polish changes re-organized the same subcards, so this layout is likely superseded.

### 2026-05-31-auto-fill-branch-from-proposal-in-worktree-dialog
- **Date:** 2026-05-31
- **Frontend surface:** WorktreeSpawnDialog — branch input + derived path preview
- **User-facing behavior:** When a proposal is attached to the worktree dialog, the branch field auto-fills to `os/<name>` (and path follows) unless the user has already typed a custom branch.
- **Test cases (Playwright candidates):**
  - Mounting the dialog with `attachProposal="add-foo"` and no initialBranch renders branch `os/add-foo` and path preview `<repo>/.worktrees/add-foo`.
  - Changing `attachProposal` to `add-foo` after mount updates the branch input to `os/add-foo` when the user has not typed.
  - If the user types `feature/x` into the branch field, a later `attachProposal` change does not overwrite it (dirty wins).
  - Clearing `attachProposal` to undefined when not dirty reverts the branch field to the initialBranch/empty value.
  - With `initialBranch="os/preset"` and no attachProposal, the branch input renders `os/preset`.
- **Drift risk:** Medium — a plumbing change on a dialog that continued to evolve (checkout-existing-branch, PR mode); the specific dirty-flag behavior may be reshaped.

### 2026-05-31-fix-cold-start-worktree-session-grouping
- **Date:** 2026-05-31
- **Frontend surface:** Sidebar session grouping + FolderOpenSpecSection linked-session row
- **User-facing behavior:** After a cold start (reboot, no bridge), previously-hidden ended worktree sessions render under their pinned parent repo group and under their attached OpenSpec change row.
- **Test cases (Playwright candidates):**
  - An ended worktree session appears nested under its parent repo group in the sidebar rather than in a separate group.
  - A worktree session attached to a parent-repo proposal renders as the linked session under that change's row in FolderOpenSpecSection.
- **Drift risk:** Medium — depends on cold-start/reboot state that is hard to reproduce in-browser and on grouping rules that later sidebar changes may adjust.

### 2026-05-31-linkify-tool-output
- **Date:** 2026-05-31
- **Frontend surface:** `GenericToolRenderer` / Bash tool-result output in ChatView
- **User-facing behavior:** File paths (with `:line[:col]`) and URLs inside tool output become clickable — files open in the editor or a read-only preview, URLs open in a new tab.
- **Test cases (Playwright candidates):**
  - Tool output containing `src/foo.ts:42` renders an inline clickable OpenFile button/link, not plain text.
  - Tool output containing an `http(s)://` URL renders an `<a target="_blank" rel="noopener noreferrer">`.
  - A `javascript:` / `data:` URI in tool output is NOT rendered as a clickable link.
  - Prose like `version 1.0.0` or `and/or` in tool output produces no file link (no false positives).
  - On a remote/mobile client with no editor, clicking a file link opens the inline read-only preview overlay instead of the editor.
- **Drift risk:** Low — targeted additive affordance on a stable tool-render surface.

### 2026-05-31-render-file-previews
- **Date:** 2026-05-31
- **Frontend surface:** `/view` slash command in `CommandInput`, `PreviewCard` in ChatView, per-format preview renderers, full-screen preview overlay
- **User-facing behavior:** Typing `/view <file-or-url>` renders an inline preview card (PDF, video, AsciiDoc, HTML, markdown, YouTube) that survives reload and can expand to full screen.
- **Test cases (Playwright candidates):**
  - Typing `/view <path>` and sending renders an inline `PreviewCard` in the chat, and the message is not forwarded to the agent.
  - The `PreviewCard` shows an `⤢ expand` control that opens the same renderer in a full-screen overlay.
  - A `/view` markdown target renders via the markdown preview renderer inside the card.
  - A `/view` of a local `.html` file renders inside a sandboxed `<iframe>`.
  - A persisted `/view` preview card is still present after a page reload.
  - `@`-file autocomplete in the composer surfaces URLs scraped from the current session's chat.
- **Drift risk:** Low — self-contained new preview subsystem with distinct testids; unlikely to be wholesale replaced.

### 2026-05-31-unify-tool-renderer-code-font-size
- **Date:** 2026-05-31
- **Frontend surface:** ChatView tool-call cards — Read/Write/Edit/Bash/Generic tool renderers (code/diff payload)
- **User-facing behavior:** All code and diff payloads inside chat tool cards render at a uniform 12px, removing the visible size jump between e.g. a Read block and an Edit block.
- **Test cases (Playwright candidates):**
  - A Read tool card's code payload root renders at computed font-size 12px.
  - An Edit tool card's desktop diff payload renders at computed font-size 12px (not the inherited ~14px).
  - A Bash tool card's `<pre>` output renders at computed font-size 12px.
  - Filename headers and status/button chrome retain their existing text-xs size (not 12px code size).
- **Drift risk:** Low — a stable cross-renderer sizing invariant enforced by a shared utility class, unlikely to be superseded.

### 2026-06-02-align-content-header-context-usage
- **Date:** 2026-06-02
- **Frontend surface:** Content header context-usage bar (desktop TokenStatsBar + mobile info-strip context bar) vs session card bar
- **User-facing behavior:** The selected-session content header's context-usage bar now uses the same live-or-persisted fallback as the session card, so a freshly loaded/reconnected session shows a filled context bar in the header matching the card instead of an empty one.
- **Test cases (Playwright candidates):**
  - For a freshly loaded session with persisted usage but no live turn yet, the content header context bar renders filled matching the card (not empty).
  - The desktop TokenStatsBar context bar and the session card bar show the same context usage before any new turn runs.
  - When live usage is present, the header bar reflects the live value (live-wins).
- **Drift risk:** Low — a data-source alignment fix on stable context-usage bars.

### 2026-06-02-gate-context-bar-independently
- **Date:** 2026-06-02
- **Frontend surface:** TokenStatsBar (stats vs context-window progress bar), SettingsPanel/ChatViewMenu toggles
- **User-facing behavior:** The `contextUsageBar` and `tokenStatsBar` prefs independently gate the header progress bar and the stats/chart, so users can show either, both, or neither.
- **Test cases (Playwright candidates):**
  - With stats off and context bar on, only the context-window progress bar renders (no chart/stats).
  - With context bar off and stats on, only the chart/stats render (no progress bar).
  - With both prefs off, the TokenStatsBar header is not mounted.
  - Toggling `contextUsageBar` in Settings shows/hides the header progress bar independently of the stats toggle.
- **Drift risk:** Low — a small independent-gating wiring change on a stable component.

### 2026-06-02-persist-process-drawer-collapse
- **Date:** 2026-06-02
- **Frontend surface:** SessionCard PROCESS subcard — background-processes drawer
- **User-facing behavior:** The background-processes drawer now starts collapsed and remembers the user's open/collapse choice across reloads and devices.
- **Test cases (Playwright candidates):**
  - A session with background processes and no stored choice renders the drawer collapsed.
  - The always-visible `⚠ N background processes` summary row shows the count while collapsed.
  - Toggling the drawer open flips it optimistically and persists across a page reload.
  - A cross-client broadcast updates the drawer collapsed state in an already-open dashboard.
- **Drift risk:** Medium — supersedes an earlier auto-expand default; the drawer UI itself may be restructured by later process-list redesigns.

### 2026-06-02-redesign-process-list-activity-bar
- **Date:** 2026-06-02
- **Frontend surface:** SessionCard PROCESS subcard — activity bar (in-flight bash) + background processes drawer
- **User-facing behavior:** The PROCESS subcard splits into an activity bar (`⏵ <command> <elapsed> [⏹]` per in-flight bash toolCall, capped at 2 with "+N more") whose `⏹` aborts the tool call, and a collapsible "⚠ N background processes" drawer for PGID-scanner output. The drawer opens by default when the activity bar is empty.
- **Test cases (Playwright candidates):**
  - An in-flight bash toolCall renders an activity-bar row showing the command, elapsed time, and a `⏹` stop control.
  - Clicking `⏹` triggers abortToolCall for that tool (not a PGID kill).
  - The activity bar disappears when no bash tool is in flight.
  - With more than 2 in-flight bash rows, a "+N more" chip appears after 2 rows.
  - With no active tool and background processes present, the subcard shows only the drawer and the drawer is open.
  - When the activity bar has rows, the background drawer is collapsed by default.
  - On mobile viewport, the background drawer collapses to a tappable count chip (`⚠2`) that opens a sheet.
- **Drift risk:** Medium — Phase 1 ships a known cosmetic dedup gap that Phase 2 changes; the split layout may be revised.

### 2026-06-03-classify-process-list-entries
- **Date:** 2026-06-03
- **Frontend surface:** SessionCard PROCESS drawer
- **User-facing behavior:** The PROCESS drawer no longer lists pi's own plumbing (pi/context-mode/node helpers) and shows real user tasks and subagents with type icons and meaningful labels.
- **Test cases (Playwright candidates):**
  - The PROCESS drawer does not list pi's own process group rows (pi, context-mode sidecar, same-group node helper).
  - A sub-session process row renders with a 🤖 icon and a label showing the referenced session's name/model.
  - A plugin process row renders with a 🔌 icon and the plugin name label (e.g. context-mode).
  - A generic user task row renders with a ⚙ icon and the command as its label.
- **Drift risk:** Medium — classification/label/icon presentation in the drawer is a plausible target for later restyling, though the filtering behavior is stable.

### 2026-06-03-generalize-worktree-init-hook
- **Date:** 2026-06-03
- **Frontend surface:** Directory/worktree row — "Initialize" button; init failure card
- **User-facing behavior:** An "Initialize" button appears on a directory/worktree row only when the project's gate reports needs-init; clicking runs the hook, and failures surface in a card.
- **Test cases (Playwright candidates):**
  - A directory/worktree row whose gate reports needs-init shows an "Initialize" button.
  - A directory/worktree row whose gate reports no init needed does not show the "Initialize" button.
  - Clicking "Initialize" triggers the init run (button transitions to a running/progress state).
  - A failed init run surfaces an error card.
- **Drift risk:** Medium — a new gated row control that could be repositioned as directory-row UI evolves.

### 2026-06-03-relocate-view-menu-to-status-bar
- **Date:** 2026-06-03
- **Frontend surface:** ChatView toolbar row (removed) and StatusBar (bottom model-selector row)
- **User-facing behavior:** The `⚙ View` display-preferences button moves out of a dedicated top toolbar row in ChatView down into the bottom StatusBar, between the reload button and the model selector.
- **Test cases (Playwright candidates):**
  - The `⚙ View` button renders inside the StatusBar, positioned after the refresh button and before the ModelSelector.
  - The standalone full-width display-prefs toolbar row no longer appears at the top of ChatView.
  - The chat scroll area / first message sits directly below the TokenStatsBar (no intervening toolbar band).
  - Clicking `⚙ View` in the StatusBar still opens the ChatViewMenu display-preferences popover.
- **Drift risk:** Medium — a placement/layout tweak; the location of a single control is prone to being moved again in later UI reshuffles.

### 2026-06-04-harden-worktree-spawn
- **Date:** 2026-06-04
- **Frontend surface:** +Worktree dialog (dep-install progress, existing-worktree rows), global spawn_error Toast
- **User-facing behavior:** The +Worktree dialog auto-installs deps with live progress before spawning, existing-worktree rows lacking node_modules show "⚠ Install deps first", and spawn errors for off-screen cwds surface as a global toast.
- **Test cases (Playwright candidates):**
  - Clicking "Create + Spawn →" in the +Worktree dialog shows an "Installing…" state with a live install log before the session card appears.
  - An existing-worktree row without `node_modules` shows "⚠ Install deps first" instead of "Spawn →".
  - A spawn_error for a cwd not in any visible folder group enqueues a toast showing the cwd, error code, and reason.
- **Drift risk:** Medium — dialog/toast flow is recent but structurally involved; manual UI steps were left unverified, so exact rendering may drift.

### 2026-06-05-add-ctx-tool-renderer
- **Date:** 2026-06-05
- **Frontend surface:** CtxToolRenderer for `ctx_*` tool call cards in the chat view
- **User-facing behavior:** `ctx_*` tool calls render as compact structured cards (per-tool header chip + body: code block, indexed-section lists, per-query answers) instead of raw JSON; errors show an error card and malformed output falls back safely.
- **Test cases (Playwright candidates):**
  - A `ctx_execute` tool call renders a header chip and a syntax-highlighted code block body (not raw JSON).
  - A `ctx_search` tool call renders a header chip showing the query count and per-query answer blocks.
  - A `ctx_batch_execute` tool call renders command-label chips and an indexed-sections list.
  - An errored `ctx_*` call renders the error card; a validation error shows collapsible args.
  - The leading `context-mode … outdated` noise line is absent from the rendered card body.
  - A malformed `ctx_*` result renders a raw fallback with the header chip still present and no crash.
- **Drift risk:** Low — a dedicated tool renderer keyed to stable result grammar; core chat rendering behavior.

### 2026-06-05-add-worktree-from-pull-request
- **Date:** 2026-06-05
- **Frontend surface:** WorktreeSpawnDialog (PrCombobox / "From a pull request" mode)
- **User-facing behavior:** In the Worktree spawn dialog, the user picks "From a pull request", sees a typeahead list of open PRs, filters and selects one, and a worktree is created checked out at that PR's head.
- **Test cases (Playwright candidates):**
  - Opening the Worktree dialog and selecting "From a pull request" mode reveals the PR typeahead/combobox.
  - Typing in the PR typeahead filters the listed pull requests.
  - Selecting a PR from the list submits and closes the dialog into the worktree-creation flow.
  - When `gh` is logged out / unavailable, the "From a pull request" mode toggle is disabled with a hint.
- **Drift risk:** Medium — dialog-mode UI is reasonably stable, but the typeahead shell was shared/extracted from a dependency change and could be restructured.

### 2026-06-05-elevate-folder-spawn-buttons
- **Date:** 2026-06-05
- **Frontend surface:** FolderSpawnButtons (folder header), trimmed FolderActionBar
- **User-facing behavior:** Two full-width stacked buttons (+ New Session green, + New Worktree orange) sit in the always-visible folder header; +Session/+Worktree are removed from the action bar; clicking spawn on a collapsed folder auto-expands it.
- **Test cases (Playwright candidates):**
  - A folder header renders a full-width green "+ New Session" button above a "+ New Worktree" button.
  - The "+ New Worktree" button is hidden for a non-git folder and shown only when worktree gating holds.
  - The FolderActionBar no longer contains +Session or +Worktree entries.
  - Clicking "+ New Session" on a collapsed folder expands the folder and then shows the placeholder/new session card.
  - Spawn buttons render in the header for a folder with 0 sessions.
  - The "+ New Worktree" button is disabled when its handler/gating is not available.
- **Drift risk:** Low — recent (June) and specific to folder header layout; stable within its window.

### 2026-06-05-fix-file-mention-search-ranking
- **Date:** 2026-06-05
- **Frontend surface:** `@` file-mention autocomplete dropdown in the chat composer
- **User-facing behavior:** Typing `@` shows relevance-ranked file matches (top-level first for bare `@`, directory-scoped for `x/db/`), instead of an arbitrary truncated first-20 set.
- **Test cases (Playwright candidates):**
  - Typing a bare `@` opens the mention dropdown showing top-level entries first (alphabetical), not deep nested files.
  - Typing `@<basename>` ranks exact/prefix basename matches above substring/path-only matches in the dropdown.
  - Typing `@x/db/co` scopes results to files under `x/db/` and ranks `co` as a basename match.
  - A query matching many files still returns a capped list whose visible entries are the highest-ranked (not first-reached).
- **Drift risk:** Low — ranking correctness fix to a stable core composer affordance.

### 2026-06-05-session-card-plus-session-button
- **Date:** 2026-06-05
- **Frontend surface:** SessionCard action row (+Session and +Worktree buttons)
- **User-facing behavior:** Every session card shows always-visible +Session and +Worktree buttons that spawn a sibling session (inheriting cwd and attached proposal) or open the worktree spawn dialog.
- **Test cases (Playwright candidates):**
  - A live (non-ended) session card renders the +Session button.
  - An ended session card shows +Session alongside Resume/Fork (all coexist).
  - A session card with no sessionFile still renders +Session (not Fork-gated).
  - Clicking +Session on a card with an attached proposal spawns with the parent's cwd and proposal pre-attached.
  - A session with `cwdMissing: true` renders +Session disabled with a changed tooltip and no spawn on click.
  - The +Worktree button renders only when git worktree is enabled and opens the WorktreeSpawnDialog scoped to the session cwd.
  - Clicking +Worktree on a card with an attached proposal opens the proposal-aware dialog (branch `os/<change>`).
- **Drift risk:** Low — additive card actions on stable lifecycle surface; recent and likely intact.

### 2026-06-05-wire-tool-renderer-slot
- **Date:** 2026-06-05
- **Frontend surface:** ToolCallStep (per-tool renderer dispatch), plugin `tool-renderer` slot, demo-plugin green box
- **User-facing behavior:** Plugin-contributed tool renderers now actually render in chat; a plugin claim for a tool name wins over the built-in renderer, and MCP/ctx_* tools can get custom rendering instead of a raw JSON dump.
- **Test cases (Playwright candidates):**
  - With the demo plugin enabled, a `DashboardDemo` tool call mounts the demo's green-box component (not the built-in or generic fallback).
  - A plugin `tool-renderer` claim matching a tool name renders instead of the built-in renderer for that tool.
  - A tool with no plugin claim renders via the built-in registry renderer.
  - A plugin claim whose `shouldRender` is false falls through to the built-in/generic renderer.
  - When a plugin renderer throws, an error boundary is shown rather than falling through to the built-in renderer.
- **Drift risk:** Low — wires a slot into the stable ToolCallStep dispatch path; the resolution-order contract is foundational and unlikely to be reverted.

### 2026-06-05-worktree-base-branch-typeahead
- **Date:** 2026-06-05
- **Frontend surface:** WorktreeSpawnDialog — "Base branch" field (BranchCombobox / BranchListbox)
- **User-facing behavior:** The base-branch native `<select>` is replaced by a collapsed combobox that opens a filterable popover; users type to narrow branches, arrow-navigate, and pick one.
- **Test cases (Playwright candidates):**
  - Opening the Worktree dialog shows the base-branch trigger collapsed by default (not an open list).
  - Clicking the base-branch trigger opens a popover with the filter input autofocused.
  - Typing in the filter narrows the visible branch list.
  - ArrowUp/ArrowDown moves the highlighted branch and Enter selects it, updating the trigger label.
  - Pressing Escape closes the popover without closing the Worktree dialog.
  - Clicking outside the popover closes only the popover.
  - Typing a string that matches no branch and pressing Enter is a no-op (no free-text base accepted).
- **Drift risk:** Low — a directly user-requested interaction pattern on a core dialog; stable behavior.

### 2026-06-06-worktree-checkout-existing-branch
- **Date:** 2026-06-06
- **Frontend surface:** WorktreeSpawnDialog — branch-mode selector (Fork to new / Check out existing / From a PR)
- **User-facing behavior:** The worktree dialog offers a "Check out existing branch" mode (picker only, no new-branch input); plain +Worktree defaults to checkout, proposal-driven ⑂+ defaults to fork.
- **Test cases (Playwright candidates):**
  - Opening plain +Worktree (no proposal) defaults the dialog to "Check out existing branch" with a branch picker and no new-branch input.
  - The "Check out existing branch" mode shows a path preview like `.worktrees/develop` for the selected branch.
  - Opening the dialog via OpenSpec ⑂+ (proposal attached) defaults to "Fork to new branch" with the new-branch input visible.
  - Toggling to "Fork to new branch" reveals the new-branch input and a "Base branch" label.
  - Selecting a branch already checked out elsewhere shows a `branch_in_use` message with the holding worktree path inline.
- **Drift risk:** Medium — active area of the worktree dialog with sibling changes landing around it; mode labels/defaults may have shifted.

### 2026-06-07-add-ask-user-input-multiline-paste
- **Date:** 2026-06-07
- **Frontend surface:** InputRenderer (standalone `ask_user{input}` dialog) and BatchRenderer input step — shared InputComposer (textarea + image paste + ImagePreviewStrip)
- **User-facing behavior:** The ask_user input dialog (and batch input sub-questions) become a multiline textarea supporting image paste, with pasted images shown as previews; Cmd/Ctrl+Enter submits and Enter inserts a newline.
- **Test cases (Playwright candidates):**
  - The standalone `ask_user{input}` dialog renders a multiline textarea, not a single-line `<input type="text">`.
  - Pasting an image into the input dialog shows a thumbnail in the preview strip.
  - Pressing Enter in the composer inserts a newline; Cmd/Ctrl+Enter submits the response.
  - After submitting an input with an attachment, the answered summary shows a `(+N image)` pill.
  - Submitting the input dialog blank shows the `(left blank)` summary.
  - A batch input sub-question renders the same InputComposer (textarea + paste) instead of a single-line input.
- **Drift risk:** Low — extends an established composer pattern into the ask_user dialogs; the multiline+paste behavior is core and reused.

### 2026-06-07-add-inline-terminal-card
- **Date:** 2026-06-07
- **Frontend surface:** Inline interactive terminal card in the chat stream + composer terminal button
- **User-facing behavior:** Typing bare `!!` or clicking the composer button opens a fixed-height (~16-row) interactive terminal card in chat; closing freezes it to a scrollable read-only transcript.
- **Test cases (Playwright candidates):**
  - Entering bare `!!` in the composer opens an inline terminal card in the chat stream.
  - Clicking the composer terminal button opens the same inline terminal card.
  - The inline terminal card renders at a fixed height with internal scrollback.
  - Closing the card freezes it into a read-only scrollable transcript.
  - Reloading the dashboard reconstructs the inline terminal card at its position in the stream.
  - Ephemeral inline terminals do not appear in the content-area TerminalsView tab bar.
- **Drift risk:** Medium — new feature reusing stable terminal infra; card placement/trigger UI may evolve.

### 2026-06-07-add-worktree-spawn-placeholder-card
- **Date:** 2026-06-07
- **Frontend surface:** SessionList (PlaceholderSessionCard), WorktreeSpawnDialog, parent folder "+ New Session" button
- **User-facing behavior:** Clicking "Spawn →" for a worktree session immediately shows a placeholder skeleton card in the parent repo's folder group and disables that folder's "+ New Session" button until the session registers or creation fails.
- **Test cases (Playwright candidates):**
  - Submitting a worktree spawn renders a placeholder session card under the parent repo's folder group (not a separate worktree-path group).
  - During the in-flight worktree spawn, the parent folder's "+ New Session" button is disabled.
  - When worktree creation fails (e.g. branch_in_use), the placeholder card is removed immediately and the dialog stays open showing the error.
  - Once the worktree session registers, the placeholder is replaced by the real session card.
- **Drift risk:** Low — targeted spawn-feedback behavior building on the stable placeholder-card pattern.

### 2026-06-07-elevate-dashboard-add-buttons
- **Date:** 2026-06-07
- **Frontend surface:** Sidebar list top ("add" line buttons), sidebar filter bar, WorkspaceHeader, expanded workspace body
- **User-facing behavior:** Dashboard-scope add actions are elevated to full-width stacked line buttons at the top of the sidebar list (`📁 + Add Folder`, `▦ + New Workspace`); the old `📌 Folder` chip, the mid-list dashed `+ New workspace…` item, and the cramped workspace-header pin icon are removed, with an `+ Add Folder` button added at the bottom of each expanded workspace.
- **Test cases (Playwright candidates):**
  - The sidebar list's first item is a stacked pair of full-width `📁 + Add Folder` (yellow) and `▦ + New Workspace` buttons.
  - Clicking `+ Add Folder` opens the pin-folder dialog.
  - Clicking `+ New Workspace` opens the new-workspace flow.
  - The `+ New Workspace` button is hidden when the create-workspace capability is not provided.
  - The `📌 Folder` chip no longer renders in the sidebar filter bar (search inputs + Hidden toggle remain).
  - The mid-list dashed `+ New workspace…` item no longer renders.
  - WorkspaceHeader no longer renders the `mdiPin` add-folder icon; an expanded workspace body shows a full-width `+ Add Folder` button instead.
- **Drift risk:** Medium — sidebar "add" affordance layout; placement and labels of these buttons are the kind of thing later UX passes reshuffle.

### 2026-06-07-parallelize-test-suite
- **Date:** 2026-06-07
- **Frontend surface:** (none — test infrastructure)
- **User-facing behavior:** Raises vitest worker counts and ports test servers to dynamic ports to run the suite in parallel; no UI change.
- **Test cases (Playwright candidates):**
  - (no browser-observable UI behavior)
- **Drift risk:** Low — test-harness change with no UI surface.

### 2026-06-07-unify-dialog-system
- **Date:** 2026-06-07
- **Frontend surface:** Dialog primitive and Confirm preset (all confirmation/modal dialogs: ConfirmDialog, JjForgetConfirmDialog, FlowLaunchDialog confirm step, MergeConfirmDialog, etc.)
- **User-facing behavior:** All dialogs share one look and behavior — consistent overlay tint, single confirm-button styling, body scroll lock, Esc-to-dismiss, click-outside close, and focus trap/restore.
- **Test cases (Playwright candidates):**
  - Opening a dialog renders an element with `role="dialog"` and `aria-modal="true"`.
  - Pressing Esc while a dialog is open dismisses it.
  - Clicking the dialog overlay (`data-testid="<id>-overlay"`) closes the dialog.
  - Opening a dialog moves focus into it and Tab/Shift+Tab cycle stays trapped within the dialog.
  - Closing a dialog restores focus to the element that opened it.
  - Opening a dialog locks body scroll and closing it restores scroll.
- **Drift risk:** Low — this is a consolidation onto a single shared primitive that later dialogs are expected to keep using; the cross-cutting behaviors are stable core UX.

### 2026-06-07-unify-file-link-openability
- **Date:** 2026-06-07
- **Frontend surface:** FileLink, OpenFileButton, MarkdownContent (assistant prose/inline code), FilePreviewOverlay
- **User-facing behavior:** File references become openable everywhere — absolute and `file://` paths resolve to themselves, Read/Edit/Write headers fall back to a preview overlay when no editor is detected, assistant prose and inline-code paths become clickable FileLinks, and the preview popup renders code with syntax highlighting and line numbers.
- **Test cases (Playwright candidates):**
  - An absolute POSIX path (`/Users/me/app.ts`) in Bash output opens the correct file (root not stripped).
  - A `file://` link (including `%20`-encoded) in tool output opens the correct decoded file.
  - With no editor detected, clicking a Read/Edit/Write header opens the FilePreviewOverlay instead of doing nothing.
  - A file path in assistant prose and inside an inline-code span renders as a clickable FileLink.
  - A path inside a fenced/multi-line code block is NOT linkified.
  - The preview overlay for a `.ts`/`.tsx` file renders syntax-highlighted content with a line-number gutter; an unknown extension falls back to plain text.
- **Drift risk:** Low — foundational linkification/preview behavior that later surfaces depend on.

### 2026-06-09-fix-model-proxy-settings-persistence
- **Date:** 2026-06-09
- **Frontend surface:** SettingsPanel — Model Proxy section (enabled toggle, default model, second port)
- **User-facing behavior:** Editing model-proxy settings and clicking Save now persists them so they survive a page reload/server restart instead of reverting.
- **Test cases (Playwright candidates):**
  - Changing a model-proxy setting and clicking Save persists it; after reload the new value is still shown.
  - Saving with model-proxy unchanged does not alter the previously saved model-proxy value.
- **Drift risk:** Low — a persistence bugfix on a stable settings save flow.

### 2026-06-09-fix-openspec-artifact-tab-url-sync
- **Date:** 2026-06-09
- **Frontend surface:** OpenSpecPreview artifact tabs (P/D/S/T) + URL routing
- **User-facing behavior:** Switching artifact tabs inside the OpenSpec preview updates the URL, so refresh keeps position, links are shareable, and browser Back/Forward step through artifacts.
- **Test cases (Playwright candidates):**
  - Clicking a different artifact tab in OpenSpecPreview updates the URL to `/folder/:cwd/openspec/:change/:artifactId`.
  - Loading a route ending in `/design` renders the design tab as active.
  - Refreshing while on an artifact tab keeps that same artifact visible.
  - Browser Back after switching P→D→S walks the artifacts in reverse.
  - Switching tabs updates the visible content without remounting the preview.
  - Archive preview tab-switching updates the URL/active tab the same way.
- **Drift risk:** Low — cements URL/tab sync that later changes build on; core routing behavior likely retained.

### 2026-06-09-fix-popout-scroll-height
- **Date:** 2026-06-09
- **Frontend surface:** Shell overlay-route popouts (subagent / flow-agent / flow-architect / archivist popout pages)
- **User-facing behavior:** Popout pages regain correct height so overflowing content scrolls instead of being clipped.
- **Test cases (Playwright candidates):**
  - Opening a flow-agent popout URL with overflowing content shows a working scrollbar.
  - Opening a subagent popout URL with overflowing content shows a working scrollbar.
  - The archivist popout (`/session/:sid/architect`) renders with full height and scrolls.
  - The desktop detail popover (eye button in FlowAgentCard) at `h-[70vh]` scrolls its overflowing content.
  - Unmatched overlay-route paths render nothing (the height wrapper is absent).
- **Drift risk:** Low — a core layout-height fix for a shared slot; stable behavior all popouts depend on.

### 2026-06-11-add-keeper-output-capture-toggle
- **Date:** 2026-06-11
- **Frontend surface:** Settings ▸ General (diagnostic tools section)
- **User-facing behavior:** A toggle in Settings ▸ General lets users opt in to capturing pi's stdout/stderr into keeper logs (default off).
- **Test cases (Playwright candidates):**
  - Settings ▸ General renders a keeper output-capture toggle among the diagnostic tools.
  - Toggling the keeper-capture control and reloading shows the persisted state (`keeperLog.capturePiOutput` round-trips via the config API).
- **Drift risk:** Low — a small, self-contained settings toggle backed by a persisted config key; unlikely to be removed.

### 2026-06-11-add-openspec-profile-settings
- **Date:** 2026-06-11
- **Frontend surface:** Settings → Advanced → OpenSpec Workflow Profile section
- **User-facing behavior:** Users pick an OpenSpec profile (Core/Expanded/Custom), save it, update projects, and see per-project staleness badges.
- **Test cases (Playwright candidates):**
  - Selecting the Custom radio reveals the 11-chip workflow multiselect.
  - Clicking Save profile with a selected radio persists the choice across reload (radio stays selected).
  - The per-cwd project list is collapsed by default and expands on click.
  - Clicking a per-cwd Update button flips that project's staleness badge to up-to-date.
  - Clicking Update all projects triggers updates and flips stale badges.
- **Drift risk:** Medium — settings section may be restructured, but the profile-selection behavior is a stable feature surface.

### 2026-06-11-add-subagent-inspector
- **Date:** 2026-06-11
- **Frontend surface:** Subagent inspector (`AgentToolRenderer` card, `SubagentDetailView`, `SubagentPopoutPage`)
- **User-facing behavior:** Users can expand a subagent (Agent tool) card inline to see its full timeline (tool calls, reasoning, assistant text, errors), pop it out to a dedicated route, and see the agent's source `.md` file path.
- **Test cases (Playwright candidates):**
  - Expanding a subagent card with timeline entries shows kind-specific rows for tool calls, text, and thinking.
  - A running subagent with no entries shows the activity indicator plus token/tool counters and a footnote.
  - A completed or failed subagent with no entries shows a result/error block.
  - A subagent with no useful data shows the "No detail available yet." fallback.
  - The inspector displays the agent's source `.md` file path.
- **Drift risk:** Medium — the record is marked WIP/unfinished (App.tsx wiring and reducer backfill pending), and `extract-minimal-chat-view` later replaced the internal timeline renderer.

### 2026-06-11-enrich-model-selector-capabilities-favorites
- **Date:** 2026-06-11
- **Frontend surface:** ModelSelector dropdown (capability badges, favorites, provider grouping/filter)
- **User-facing behavior:** The model dropdown groups models by provider with favorites pinned on top, shows reasoning/vision capability badges (with `?` for assumed capabilities), lets users star/favorite models and filter to favorites, and persists the provider filter.
- **Test cases (Playwright candidates):**
  - The model dropdown groups models under provider headings.
  - A reasoning-capable catalog model shows a 🧠 badge; a vision-capable one shows a 👁 badge.
  - A model with fallback metadata shows `🧠?` / `👁?` rather than a confident badge.
  - Clicking a model's star adds it to a favorites group pinned at the top.
  - Toggling the favorites filter shows only favorited models.
  - Selecting a provider filter and reopening the dropdown preserves that provider selection.
- **Drift risk:** Medium — enriches the earlier model selector; badge/grouping layout is likely to keep evolving.

### 2026-06-11-fix-openspec-profile-load-race
- **Date:** 2026-06-11
- **Frontend surface:** Settings → Advanced → OpenSpec Workflow Profile section (load state)
- **User-facing behavior:** The profile section shows a loading state until the real config resolves, retries transient failures, and surfaces an error instead of silently defaulting to Core.
- **Test cases (Playwright candidates):**
  - On open, the profile section shows a loading state and does not present a concrete profile as selected before config resolves.
  - After a saved `expanded` profile loads, the section consistently shows Expanded across rapid remounts.
  - A transient config-fetch failure surfaces a visible error rather than silently selecting Core.
- **Drift risk:** Medium — load-race fix on the same settings surface as 2026-06-11-add-openspec-profile-settings; UI wording may change.

### 2026-06-11-fix-settings-panel-and-reset
- **Date:** 2026-06-11
- **Frontend surface:** ChatViewMenu ("View" popover) + SettingsPanel DisplayPrefsSection + "Use global settings" reset
- **User-facing behavior:** The chat "View" popover flips upward near the viewport bottom, global display prefs save through proxies, and "Use global settings" actually clears the session override on all browsers.
- **Test cases (Playwright candidates):**
  - Opening the ChatViewMenu popover in the upper viewport opens it downward.
  - Opening the ChatViewMenu popover within ~200px of the viewport bottom flips it upward so it stays on-screen.
  - The popover re-evaluates its flip direction on window resize.
  - Clicking "Use global settings" clears the session display-prefs override and reflects on other connected browsers.
- **Drift risk:** Low — targeted positioning/serialization bug fixes on stable settings controls; unlikely fully replaced.

### 2026-06-11-rebase-flows-track-onto-develop
- **Date:** 2026-06-11
- **Frontend surface:** Session cards (subcard layout), `AgentCardShell` background, flows-plugin badge/dashboard
- **User-facing behavior:** After the rebase, session cards use the new subcard layout with a blended background, no FLOWS subcard appears, and flows sessions render via plugin slot claims.
- **Test cases (Playwright candidates):**
  - Dashboard loads with no console errors after the rebase deploy.
  - Session cards render with the new subcard layout.
  - No card displays a "FLOWS" subcard.
  - An active flows-plugin session shows its badge and dashboard rendered through slot claims.
  - Unselected session cards show the blended secondary+tertiary background (not the old single-tone bg).
- **Drift risk:** Medium — captures a specific card-layout snapshot at a merge point; later SessionCard redesigns may supersede the exact visuals.

### 2026-06-13-add-async-action-feedback
- **Date:** 2026-06-13
- **Frontend surface:** Action buttons across the app (TunnelButton, restart, provider-auth), Toast component, ActionButton wrapper
- **User-facing behavior:** Clicking an async action button shows immediate feedback — the button disables and shows a pending/spinner state, and success/error/info toasts appear when the action completes.
- **Test cases (Playwright candidates):**
  - Clicking a button wired to `useAsyncAction` disables it and shows a pending indicator until the fetch resolves.
  - After a successful http-mode action, the button re-enables and a success-variant toast appears.
  - After a failed action, an error-variant toast appears and the error state is shown.
  - Double-clicking an action button does not fire a second concurrent run (button stays disabled during pending).
  - For a ws-confirm action, the button stays pending after the fetch resolves until the correlated WS event arrives.
  - On ws-confirm timeout, the pending state clears and an info "Still working in the background…" toast appears.
  - A success-variant toast renders with distinct (non-red) styling; a default toast renders with error styling.
  - TunnelButton connect shows a pending state during the request instead of silent no-feedback.
- **Drift risk:** Low — introduces a reusable feedback primitive that codifies an established pattern; behavior is broadly applicable and stable.

### 2026-06-13-add-image-fit-recommended-extension
- **Date:** 2026-06-13
- **Frontend surface:** Recommended Extensions card (Packages tab)
- **User-facing behavior:** A `pi-image-fit` extension entry appears in the dashboard's Recommended Extensions list with an install affordance, letting users discover and one-click install it.
- **Test cases (Playwright candidates):**
  - Opening the Packages tab renders a `pi-image-fit` extension card.
  - The `pi-image-fit` card shows its enriched description and an install affordance.
  - The `pi-image-fit` card renders without a `+plugin:` badge.
- **Drift risk:** Low — a manifest-data addition to a stable card surface; the presence of the entry is a durable, easily-verifiable behavior.

### 2026-06-13-extract-client-utils-package
- **Date:** 2026-06-13
- **Frontend surface:** Shared client components/hooks consumed by flows-plugin and jj-plugin (AgentCardShell, MarkdownContent, dialogs, zoom controls)
- **User-facing behavior:** Plugin UIs that reuse shared client components continue to render identically after the utilities move to a shared package.
- **Test cases (Playwright candidates):**
  - Flows-plugin card (using shared `AgentCardShell` / `MarkdownContent`) still renders correctly in the dashboard.
  - jj-plugin `ConfirmDialog` still opens and renders after the package extraction.
- **Drift risk:** Low — pure package/import refactor with no intended behavior change; shared components remain stable core.

### 2026-06-13-extract-subagents-as-plugin
- **Date:** 2026-06-13
- **Frontend surface:** Tool-call renderers for `Agent`, `steer_subagent`, `get_subagent_result` (subagent/agent cards in ChatView)
- **User-facing behavior:** Subagent-related tool calls render as a custom agent card (status, stats line) when the subagents plugin is present; without it they fall back to the generic JSON tool renderer.
- **Test cases (Playwright candidates):**
  - With the subagents plugin enabled, an `Agent` tool call renders the custom AgentToolRenderer card (status + stats line) rather than the generic JSON dump.
  - With the subagents plugin enabled, a `steer_subagent` tool call renders its dedicated renderer.
  - With the subagents plugin enabled, a `get_subagent_result` tool call renders its dedicated renderer.
  - With the plugin disabled/absent, an `Agent` tool call falls back to the GenericToolRenderer JSON view.
- **Drift risk:** Medium — plugin-slot extraction of existing card UI; the card visuals are stable but the plugin loader/registration path is newer architecture that later changes may re-wire.

### 2026-06-13-fix-editor-settings-persistence
- **Date:** 2026-06-13
- **Frontend surface:** EditorView (code-server iframe)
- **User-facing behavior:** Reopening a folder editor restores open tabs, layout, and dirty buffers, with no Workspace Trust dialog, Welcome tab, or update banner; concurrent opens of the same folder don't spawn duplicate editors.
- **Test cases (Playwright candidates):**
  - Opening an editor folder does not surface a Workspace Trust dialog, a Welcome/Walkthrough tab, or an update banner in the iframe.
  - Mounting EditorView (including StrictMode double-mount) issues exactly one `/api/editor/start` request.
- **Drift risk:** Low — editor-iframe integration behavior is stable core functionality.

### 2026-06-13-linkify-any-text-extension
- **Date:** 2026-06-13
- **Frontend surface:** Tool-output/markdown linkifier — clickable file-path links in chat/tool output
- **User-facing behavior:** File references with path structure (any extension, dot-directories, multi-level `../../`) render as correct clickable links; bare filenames in prose still do not link.
- **Test cases (Playwright candidates):**
  - An assistant message containing `.pi/settings.json` renders a single clickable link with the full path (no truncation to `.js`, no stray `on`).
  - `../../foo.ts` renders as one clickable relative-path link (not mis-parsed as absolute).
  - `config/app.toml` and other generic extensions render as clickable file links.
  - A bare `README.md` or `Node.js` in prose does NOT render as a clickable file link.
- **Drift risk:** Low — parsing/linkify correctness fix on a stable rendering path; unlikely to be superseded.

### 2026-06-14-add-board-drag-visual-feedback
- **Date:** 2026-06-14
- **Frontend surface:** OpenSpecBoardView (ProposalCard cursor, DragOverlay chip, BoardColumn drop-zone highlight)
- **User-facing behavior:** On the OpenSpec board, cards show a grab/grabbing cursor, a lightweight chip preview follows the pointer during a drag, and the hovered target column highlights.
- **Test cases (Playwright candidates):**
  - Hovering a draggable ProposalCard shows the grab (open-hand) cursor.
  - Pressing/holding a card shows the grabbing cursor.
  - Dragging a card renders a chip preview that follows the pointer while the origin slot dims.
  - Dragging a card over a column highlights that target column.
  - Dropping a card on another column reassigns it and the change persists.
- **Drift risk:** Medium — drag affordances are additive rendering polish; the board view is actively evolving so overlay/highlight styling may shift.

### 2026-06-14-add-faux-model-integration-tests
- **Date:** 2026-06-14
- **Frontend surface:** Test infrastructure (faux provider fixtures; ChatView renderer/interactive matrices) — no product UI change
- **User-facing behavior:** No user-facing change; this adds deterministic faux-model integration tests that drive a prompt→stream round-trip and assert the correct tool/interactive renderers mount for real pi event streams.
- **Test cases (Playwright candidates):**
  - (no browser-observable UI behavior)
- **Drift risk:** Low — pure test/QA infrastructure with no shipped UI surface to drift.

### 2026-06-14-add-goal-continuation-plugin
- **Date:** 2026-06-14
- **Frontend surface:** Goal plugin status chip + "Set Goal" control (plugin UI slot)
- **User-facing behavior:** A goal status chip shows the standing objective's state (status/goal/turns) and a Set Goal affordance lets the user set/pause/resume/clear the goal.
- **Test cases (Playwright candidates):**
  - Setting a goal via the "Set Goal" affordance displays a status chip reflecting the active goal state.
  - The goal status chip updates its displayed status/turn count when the plugin broadcasts a new snapshot.
  - Pause/resume/clear controls on the goal surface change the chip's displayed status accordingly.
- **Drift risk:** Medium — new plugin UI depends on the `@ricoyudog/pi-goal-hermes` extension being installed; chip rendering may not appear without it and surface may evolve.

### 2026-06-14-add-session-closing-indicator
- **Date:** 2026-06-14
- **Frontend surface:** SessionCard (closing state)
- **User-facing behavior:** Clicking ✕ to close a session immediately dims the card, swaps the ✕ for a spinner, and disables re-clicks until the card is removed; a stuck close reverts after a timeout.
- **Test cases (Playwright candidates):**
  - Clicking ✕ on an idle session immediately dims the card and shows a spinner in place of the ✕.
  - While closing, re-clicking the close control does nothing (disabled).
  - When `session_removed` arrives, the card disappears.
  - Closing a streaming session first shows a confirm; on confirm the closing state appears.
  - If `session_removed` never arrives, after the timeout the card reverts to normal and the ✕ works again.
- **Drift risk:** Medium — closing-state visuals mirror the resuming pattern and are fairly stable, but card styling is a common drift target.

### 2026-06-14-embed-git-bash-on-windows
- **Date:** 2026-06-14
- **Frontend surface:** (mostly none — Windows git/sh bundling; indirect Tools/branch UI)
- **User-facing behavior:** On Windows without Git installed, git-dependent dashboard features (branch lists, dirty-state, bang-prefix commands) work via bundled git/sh instead of showing empty/error states.
- **Test cases (Playwright candidates):**
  - On a Windows host lacking Git, the Tools/branch UI populates the branch list instead of showing red error rows (bundled git active).
  - (core change is build/runtime PATH plumbing — most assertions are non-browser)
- **Drift risk:** Low — Windows-only infra fix; the indirect UI restoration is a stable baseline behavior.

### 2026-06-14-emit-openspec-pending-from-poll
- **Date:** 2026-06-14
- **Frontend surface:** OpenSpec section on folder/session card (loading spinner)
- **User-facing behavior:** A new cwd's OpenSpec section shows a loading spinner during the poll instead of popping in the final "OpenSpec (N)" with no transitional state.
- **Test cases (Playwright candidates):**
  - When a new cwd with an existing openspec/ directory registers, its OpenSpec section shows a spinner before resolving to "OpenSpec (N)".
  - When openspec/ is created late (init hook), the section transitions through the spinner rather than jumping straight from nothing to initialized.
- **Drift risk:** Medium — transitional loading indicator on a surface that later OpenSpec UI changes may restyle.

### 2026-06-14-fix-mobile-back-depth-aware
- **Date:** 2026-06-14
- **Frontend surface:** Mobile back navigation (MobileShell/SessionHeader back arrow, swipe-back) across ChatView / card list / overlays
- **User-facing behavior:** On mobile, pressing the header back arrow or swiping back moves exactly one depth up (chat → card list, overlay → detail), never landing on a sibling session or leaving the app.
- **Test cases (Playwright candidates):**
  - On a mobile-width viewport with a session open, pressing the header back arrow navigates to the session-card list (`/`).
  - Swipe-back from ChatView on mobile returns to the card list rather than a sibling chat.
  - From a depth-2 overlay (e.g. openspec preview / diff / file preview), back returns to the underlying detail route, not to `/`.
  - Back never navigates to a different `/session/:id` than the one open, and never navigates away from the dashboard app.
  - Desktop overlay back-arrows still close to the prior view (no regression).
- **Drift risk:** Low — a targeted navigation correctness fix with strong invariants and tests; core behavior likely to persist.

### 2026-06-14-fix-openspec-board-mobile-scroll
- **Date:** 2026-06-14
- **Frontend surface:** OpenSpec board (`/folder/:cwd/openspec`) column area on mobile/tablet
- **User-facing behavior:** On narrow screens the stacked board columns scroll vertically to the last card instead of clipping past the first viewport.
- **Test cases (Playwright candidates):**
  - Loading the OpenSpec board at ≤540px width lets the column area scroll vertically down to the last card with columns stacked full-width.
  - Loading the board at 540–900px width scrolls vertically with no horizontal scrollbar and columns wrapped to rows.
  - Loading the board at >900px width preserves horizontal kanban scroll with each column body scrolling internally.
  - The top bar and filter bar stay fixed in place while the column area scrolls underneath at ≤900px.
- **Drift risk:** Medium — a CSS-regression fix on a responsive layout that later restyles could re-break or supersede.

### 2026-06-14-fix-popover-viewport-flip
- **Date:** 2026-06-14
- **Frontend surface:** ChatViewMenu (⚙ View popover in StatusBar) plus WorktreeActionsMenu, PackageRow, OpenSpecGroupPicker, ThemePicker, ModelSelector, ThinkingLevelSelector, CommandInput autocomplete (shared `usePopoverFlip`)
- **User-facing behavior:** Popovers auto-flip upward and cap their height when they would overflow the viewport bottom, so all rows (e.g. the ⚙ View menu's tool-call toggles) stay reachable.
- **Test cases (Playwright candidates):**
  - Opening the ⚙ View popover from the bottom StatusBar renders it upward with all rows (including tool-call toggles) within the viewport.
  - Opening a bottom-anchored popover (e.g. WorktreeActionsMenu) low in a scroll container flips it upward instead of clipping past the viewport edge.
  - A flipped popover applies a capped max-height with internal scroll when content exceeds available space.
  - A popover with ample space below still opens downward by default.
- **Drift risk:** Low — a viewport-clipping bug fix via a shared primitive; behavior is stable and broadly adopted.

### 2026-06-14-redesign-openspec-board
- **Date:** 2026-06-14
- **Frontend surface:** OpenSpec board (new full-page kanban route) + FolderOpenSpecSection entry point
- **User-facing behavior:** The folder card's inline OpenSpec accordion is replaced by an `OpenSpec (N) →` button that navigates to a full-page kanban board where groups are columns and changes are draggable proposal cards with lifecycle steppers and session lists.
- **Test cases (Playwright candidates):**
  - Clicking the folder card's `OpenSpec (N) →` button navigates to `/folder/:encodedCwd/openspec`.
  - The board top bar renders Back, Refresh, Specs, Archive, and `+ New proposal` controls.
  - The board renders one column per group plus an always-present `Ungrouped` column.
  - Each group column header shows a dot, name, count, `＋`, `⚙`, and a drag grip.
  - A `+ Add group` ghost column appears at the end of the board.
  - The folder card no longer renders inline group pills, search, or an accordion after the redesign.
  - A proposal card displays a name, a state pill (PLANNING/READY/IMPLEMENTING/COMPLETE), the OpenSpecStepper, a task-progress bar, and a session list.
  - At ≤540px viewport, board columns stack full-width; at ≤900px they wrap to multiple rows.
  - Clicking a column-header `⚙` opens inline group manage (rename/recolor/delete).
- **Drift risk:** Medium — large structural UI that is the current design, but kanban layouts iterate frequently and the noted plugin-extraction rebase may relocate the slot.

### 2026-06-14-register-bash-and-tool-install-help
- **Date:** 2026-06-14
- **Frontend surface:** Settings → Tools (tool rows, source badges, `[Install ▾]` control), inline missing-tool chat error
- **User-facing behavior:** A `bash` row appears in Settings → Tools; missing binary tools show install guidance (`[Install ▾]` with OS-specific commands) instead of a bare "not found".
- **Test cases (Playwright candidates):**
  - Settings → Tools lists a `bash` row alongside jj/gh/zrok/git/npx.
  - A missing registered tool row shows an `[Install ▾]` affordance rather than only "not found".
  - Opening the `[Install ▾]` control on a missing tool shows an OS-appropriate install command/link.
  - Running `!ls` in chat with bash unavailable surfaces a MissingToolInlineError with a deep-link (not a bare ENOENT).
- **Drift risk:** Low — Settings → Tools registry/override UX is stable core behavior; this adds one row + install hints without restructuring the surface.

### 2026-06-14-replace-proposal-dialog-with-race-handling
- **Date:** 2026-06-14
- **Frontend surface:** Replace-proposal confirmation dialog on session cards
- **User-facing behavior:** When the LLM pivots to a different OpenSpec change on a manually-attached proposal, a dialog asks the user to confirm; a banner offers "Use latest" while the commit target only changes on explicit action.
- **Test cases (Playwright candidates):**
  - When both an attached proposal and a pending replace target exist, the replace-proposal dialog renders.
  - The Replace button label shows the committed target, not the latest incoming suggestion.
  - When a newer changeName arrives, a divergence banner appears; clicking `[Use latest]` updates the committed target text.
  - Clicking Replace sends `accept_replace_proposal` with the committed target.
  - Pressing Esc / Cancel sends `dismiss_replace_proposal` and closes the dialog.
  - The dialog unmounts when the pending replace proposal clears.
  - Switching sessions while the dialog is open mounts a fresh dialog state for the new session.
- **Drift risk:** Low — dialog encodes a documented commit-vs-suggestion invariant central to the feature.

### 2026-06-14-simplify-session-card-ordering
- **Date:** 2026-06-14
- **Frontend surface:** SessionList / folder card ordering (ACTIVE → ENDED → HIDDEN tiers)
- **User-facing behavior:** Each folder renders cards from one persisted flat list partitioned by status; "first" means first of the whole folder, and worktree/jj siblings no longer force-cluster.
- **Test cases (Playwright candidates):**
  - Cards within a folder render partitioned in ACTIVE, then ENDED, then HIDDEN order.
  - A resumed session lands at the top of its own status tier.
  - Dragging a card to reorder within a folder persists the new position across reload.
  - Worktree/jj sibling cards are ordered by the flat list, not forced adjacent.
- **Drift risk:** Medium — ordering is a repeatedly-reworked subsystem; this consolidation may itself be revised by later changes.

### 2026-06-14-stepper-compact-done-letters
- **Date:** 2026-06-14
- **Frontend surface:** OpenSpecStepper (compact variant, full-page board) done-node glyphs
- **User-facing behavior:** On the full-page OpenSpec board, completed artifact nodes show their letter (P/D/S/T) instead of a generic green check, preserving phase identity; the labelled sidebar variant keeps checks.
- **Test cases (Playwright candidates):**
  - In the compact stepper, a done artifact node renders its letter span (P/D/S) rather than a check icon.
  - In the compact stepper, a done non-artifact node (Explore/Apply) still renders the mdi-check.
  - In the sidebar (labelled) variant, a done artifact node still renders the mdi-check with its text label.
  - Done artifact nodes retain the green border/tint in compact mode alongside the letter.
- **Drift risk:** Medium — a fine-grained glyph decision on the stepper; visual details like this are frequently re-tuned in later redesigns.

### 2026-06-14-surface-input-streaming-behavior
- **Date:** 2026-06-14
- **Frontend surface:** ChatView status row / user-message row (steer vs followUp indicator)
- **User-facing behavior:** When the user types mid-stream, the transcript shows whether the message will interrupt ("steer") or queue ("followUp") the current turn, instead of burying it in raw event JSON.
- **Test cases (Playwright candidates):**
  - Sending input mid-stream with `streamingBehavior: "steer"` renders a status row/badge indicating the message steered/interrupted the turn.
  - Sending input mid-stream with `streamingBehavior: "followUp"` renders a status row/badge indicating the message queued.
  - Sending input while idle (`streamingBehavior` undefined) renders no steer/queue indicator.
- **Drift risk:** Medium — final UI shape was an open design question (status row vs badge), so the exact rendered element is uncertain and may differ from what shipped.

### 2026-06-15-auto-init-worktree-on-spawn
- **Date:** 2026-06-15
- **Frontend surface:** Settings toggle ("Initialize on worktree"), WorktreeInitButton, worktree init progress/failure card
- **User-facing behavior:** With the new preference ON and a trusted hook, spawning a worktree auto-runs initialization; untrusted hooks still show the manual Initialize button.
- **Test cases (Playwright candidates):**
  - Settings shows an "Initialize on worktree" (autoInitWorktreeOnSpawn) toggle defaulting to off.
  - With the preference ON and a trusted hook, spawning a worktree shows the init progress without clicking Initialize.
  - With the preference ON but an untrusted hook, the WorktreeInitButton still appears and requires a manual trust grant.
  - The Initialize button renders only when the hook exists and the checkout needs init.
- **Drift risk:** Medium — depends on Settings toggle and WorktreeInitButton surfaces that later worktree-flow changes may rework.

### 2026-06-15-fix-worktree-spawn-placeholder-and-ordering
- **Date:** 2026-06-15
- **Frontend surface:** Session cards / "Starting new session…" placeholder within a folder group
- **User-facing behavior:** Spawning a worktree session replaces the "Starting…" placeholder in place at the top of the parent group instead of orphaning it and dropping the real card to the bottom.
- **Test cases (Playwright candidates):**
  - Spawning a worktree session replaces the "Starting new session…" placeholder in its slot (no orphaned placeholder remains).
  - The resulting worktree session card appears at the top of the parent repo group, not the bottom.
  - A plain (non-worktree) spawn continues to replace its placeholder in place unchanged.
- **Drift risk:** Medium — placeholder/ordering behavior tied to session-card and grouping internals that may shift.

### 2026-06-15-reorganize-settings-into-pages
- **Date:** 2026-06-15
- **Frontend surface:** SettingsPanel — left-nav page layout replacing 7 top-tabs
- **User-facing behavior:** Settings uses a grouped left nav rail (Dashboard/Network/Extensions/Advanced) of focused full-width pages, with URL routing `/settings/:page` and legacy `?tab=` redirects.
- **Test cases (Playwright candidates):**
  - Navigating to `/settings/<page>` renders that page in the settings panel.
  - Navigating to `/settings` redirects to the general page.
  - Navigating to `/settings?tab=advanced` (or `?tab=servers`) replace-redirects to the canonical page.
  - Editing fields on two different settings pages then saving persists changes from both (draft preserved across navigation).
  - A given settings section renders on only one page (no duplicate across pages).
- **Drift risk:** Low — this is the current settings architecture and the likely superseding change for earlier settings-tab layouts.

### 2026-06-16-fix-settings-mobile-layout
- **Date:** 2026-06-16
- **Frontend surface:** SettingsPanel nav-rail + content wrapper (responsive layout)
- **User-facing behavior:** On mobile-width viewports the Settings nav stacks as a horizontal scrollable tab strip on top with the content filling below (visible instead of collapsed to zero width); on desktop the vertical rail-left / content-right layout is unchanged.
- **Test cases (Playwright candidates):**
  - At 390px viewport on /settings/general, the settings content panel has non-zero width and is fully on-screen.
  - At 390px viewport, the settings nav renders as a horizontal scrollable strip above the content (wrapper stacked as a column).
  - At ≥md (e.g. 1024px), the settings nav renders as the vertical rail on the left with content filling the right.
  - On a content-heavy settings page, content scrolls within the content area while the header stays fixed.
- **Drift risk:** Low — a durable responsive-layout fix on a stable Settings structure.

### 2026-06-16-show-chat-history-loading-indicator
- **Date:** 2026-06-16
- **Frontend surface:** ChatView empty-state / loading indicator
- **User-facing behavior:** When opening an old/ended session, the chat area shows a loading spinner (instead of "No messages yet") while history is transferring; the spinner is replaced by content as it streams in, and a genuinely empty session still shows "No messages yet".
- **Test cases (Playwright candidates):**
  - Opening a session whose history is still loading (empty messages, loading flag set) renders a loading indicator and does NOT show "No messages yet".
  - Once history arrives, the loading indicator is replaced by message bubbles with no "No messages yet" flash.
  - Opening a genuinely empty/new session shows "No messages yet" and no stuck spinner.
  - A session with messages present renders bubbles and never shows the loading spinner over content.
- **Drift risk:** Low — targeted, well-tested three-way empty-state branch on a core view; stable behavior unlikely to be reverted.

### 2026-06-17-cap-followup-display-height
- **Date:** 2026-06-17
- **Frontend surface:** QueuePanel follow-up display chip (`queue-chip-followup`)
- **User-facing behavior:** A large multi-line follow-up queue entry is height-capped and scrolls internally instead of pushing the chat input and layout off-screen.
- **Test cases (Playwright candidates):**
  - The `queue-chip-followup` element carries the `max-h-80` and `overflow-auto` classes.
  - A long follow-up entry stays within the capped height and scrolls internally rather than overflowing the layout.
- **Drift risk:** Low — small, targeted CSS constraint on a stable queue chip.

### 2026-06-17-extend-whats-new-to-all-packages
- **Date:** 2026-06-17
- **Frontend surface:** What's-New (ⓘ) icon on package rows + WhatsNewDialog
- **User-facing behavior:** Any updatable package row (not just pi core) shows a What's-New icon that opens its changelog; up-to-date packages show no icon.
- **Test cases (Playwright candidates):**
  - A package row with a pending update renders the What's-New (ⓘ) icon.
  - An up-to-date package row renders no What's-New icon.
  - Clicking the What's-New icon opens the WhatsNewDialog showing changelog/release entries.
  - The pi core row shows the What's-New icon.
- **Drift risk:** Low — additive generalization of an existing stable affordance across more rows.

### 2026-06-18-suppress-hidden-session-auto-navigation
- **Date:** 2026-06-18
- **Frontend surface:** ChatWindow auto-navigation on `session_added` (client message handler)
- **User-facing behavior:** When a hidden headless worker registers, the chat view does not jump to it and does not steal the real spawned session's auto-select; visible sessions still auto-navigate.
- **Test cases (Playwright candidates):**
  - Triggering a hidden worker (subagent/`memory`) while viewing a session keeps the ChatWindow on the current session.
  - A hidden worker appears only as a dimmed card in the Hidden tier, not selected.
  - Spawning a real visible session from a folder still auto-selects/opens it after a hidden worker registered with the same cwd.
- **Drift risk:** Low — correctness guard on core navigation behavior; unlikely reverted.

### 2026-06-19-fix-settings-back-to-launching-route
- **Date:** 2026-06-19
- **Frontend surface:** SettingsPanel header back arrow, mobile MobileShell back arrow, flow YAML preview (ContentViewSlot) back button
- **User-facing behavior:** Opening Settings from a session and pressing back returns to that session (not the empty card list); closing a flow YAML preview leaves the user on the session chat instead of jumping to the card list.
- **Test cases (Playwright candidates):**
  - Opening Settings from a session on desktop and pressing the SettingsPanel back arrow returns to the originating `/session/:id`.
  - Opening Settings from a session on mobile and pressing the shell back arrow returns to the originating session.
  - Cold-loading `/settings` directly (no in-app predecessor) and pressing back navigates to `/` (card list).
  - Opening a flow YAML preview from a session and pressing its back arrow leaves the user on `/session/:id` (URL unchanged), not the card list.
  - Opening tunnel-setup from a session and pressing back returns to the originating route.
- **Drift risk:** Low — precise modal-route back-navigation fix with unit + manual coverage; stable correctness behavior.

### 2026-06-19-roles-standalone-defaults-and-local-install-detection
- **Date:** 2026-06-19
- **Frontend surface:** Roles panel (default role rows + setup banner), Subagents panel, recommended-extensions install status
- **User-facing behavior:** The Roles panel always shows the default role rows (planning, coding, compact, fast, vision, research) with a "No roles have been set up — set up now" banner instead of an empty dead-end; assigning a model hides the banner; Subagents still loads when Roles is empty; git/local-build extensions correctly show as installed.
- **Test cases (Playwright candidates):**
  - On a fresh/unconfigured install, the Roles panel renders the six default role rows, each showing "— set a model —".
  - An unconfigured Roles panel shows the "No roles have been set up — set up now" banner.
  - Assigning a model to a role hides the setup banner.
  - The Subagents panel still loads and renders when Roles is empty/disabled (no cascade-disable).
  - A globally-installed-from-local-build extension shows as "installed" in the recommended-extensions list (not "not installed").
  - The stale "install pi-flows" empty-state copy no longer appears in the Roles panel.
- **Drift risk:** Medium — Roles/Subagents UX is comparatively new and copy/layout ("set up now" banner, default rows) is likely to be iterated.

### 2026-06-19-unify-settings-save-contract
- **Date:** 2026-06-19
- **Frontend surface:** SettingsPanel (Save Bar, left nav rail dirty indicators)
- **User-facing behavior:** Every Settings control buffers edits into a draft; a Save Bar appears only when there are unsaved changes, showing an unsaved-changes count, Discard, and Save, with per-page dirty indicators in the nav rail.
- **Test cases (Playwright candidates):**
  - Changing a display-preference toggle in Settings does not persist immediately and instead marks the draft dirty.
  - Editing any settings control makes the Save Bar appear; with no edits the Save Bar is hidden.
  - The Save Bar shows an unsaved-changes count reflecting the number of dirty controls.
  - Clicking Discard reverts buffered edits and hides the Save Bar.
  - A page with unsaved edits shows a dirty indicator next to it in the left nav rail.
  - The standalone "Save profile" button is no longer present in the OpenSpec Workflow Profile section.
  - A failed save source stays dirty and exposes a Retry affordance.
- **Drift risk:** Low — this is a deliberate persistence-contract redesign meant to be the durable model for the whole Settings surface.

### 2026-06-20-workspace-directory-drag-reorder
- **Date:** 2026-06-20
- **Frontend surface:** Sidebar SessionList — WorkspaceHeader drag handles, workspace/folder SortableContexts, drop indicator (DragOverlay)
- **User-facing behavior:** Users can drag-reorder workspaces and drag-reorder folders within a workspace; the dragged workspace auto-collapses during drag (visual-only), and hovered drop slots show a dashed highlight.
- **Test cases (Playwright candidates):**
  - Dragging a workspace to a new position reorders the workspace tier (emits `reorder_workspaces`).
  - Dragging a folder within a workspace reorders it (emits `reorder_workspace_folders`); dropping into another workspace is a no-op.
  - The dragged workspace visually collapses during drag and restores its prior expanded/collapsed state on drop.
  - A hovered drop slot for a workspace, workspace-folder, or pinned-group shows a dashed outline + faint accent background.
  - Individual session slots do NOT show the dashed drop indicator (slide-only feedback).
- **Drift risk:** Low — additive drag behavior on an established sidebar with server support already present; stable.

### 2026-06-21-add-automation-plugin
- **Date:** 2026-06-21
- **Frontend surface:** Automation content view — sidebar folder section, board, triage inbox, session-card badge, settings section
- **User-facing behavior:** A new Automation feature adds a sidebar nav entry leading to a board/triage view of scheduled agent runs; runs land as result artifacts, with configurable board visibility and a session-card badge marking automation runs.
- **Test cases (Playwright candidates):**
  - The sidebar shows an Automation folder-section nav entry.
  - Navigating to Automation renders its board/content view.
  - A created schedule automation appears in the automation list/board (or is hidden when marked not-visible).
  - An automation-kind run session card shows an automation badge.
  - Automation exposes a settings section in the settings panel.
- **Drift risk:** Medium — a new plugin-based content surface likely to be iterated on heavily after introduction.

### 2026-06-21-add-goals-folder-page
- **Date:** 2026-06-21
- **Frontend surface:** Folder group "Goals (N) →" / "+ Goal" nav slot + goals board route (`/folder/:cwd/goals`)
- **User-facing behavior:** Goals become folder-scoped: a Goals nav slot opens a board of goal cards (objective, status badge, progress, expandable linked-sessions), with create/link/open-session actions mirroring the OpenSpec board.
- **Test cases (Playwright candidates):**
  - A folder group renders a "Goals (N) →" nav slot and a "+ Goal" affordance alongside Automations/OpenSpec.
  - Clicking "Goals (N) →" navigates to `/folder/:encodedCwd/goals` and renders the goals board (Back, title, Refresh, "+ New Goal", status filter bar).
  - The status filter bar (All / Pursuing / Paused / Achieved) filters the visible goal cards.
  - A goal card shows objective, status badge, and progress (turns n/m + success criteria).
  - Expanding a goal card reveals its linked-sessions list with a `⚑ driver` tag on the loop session.
  - Clicking a session-card goal chip navigates to the owning goal's detail page.
  - Clicking a linked-session row opens that session's chat view.
- **Drift risk:** Low — recent, structurally distinct folder-level surface following the established board pattern.

### 2026-06-21-docker-packaging
- **Date:** 2026-06-21
- **Frontend surface:** (Electron first-run wizard "Remote" mode — not the browser web client)
- **User-facing behavior:** Adds a Docker image and an Electron wizard "Remote" mode to attach to a hosted dashboard; the browser web client itself is unchanged.
- **Test cases (Playwright candidates):**
  - (no browser-observable UI behavior)
- **Drift risk:** Low — containerization and Electron-wizard concern, decoupled from the served web UI.

### 2026-06-21-fix-automation-slot-parity-and-routing
- **Date:** 2026-06-21
- **Frontend surface:** FolderAutomationSection sidebar row (re-skinned to match FolderOpenSpecSection), AutomationBoard route via `shell-overlay-route`
- **User-facing behavior:** The sidebar Automations row now matches the OpenSpec row (10px uppercase `AUTOMATIONS (N) →` title, refresh icon, right-aligned `+ New` chip) and its link opens the automation board (previously dead); `+ New` opens the Create-Automation dialog directly.
- **Test cases (Playwright candidates):**
  - The sidebar Automations row renders an uppercase `AUTOMATIONS (N) →` title with a refresh icon and a `+ New` chip, matching the OpenSpec row anatomy.
  - Clicking the Automations title navigates to `/folder/<encodedCwd>/automations` and renders the automation board (not a blank page).
  - The board mounted at `/folder/:encodedCwd/automations` renders using the decoded cwd from the route.
  - Clicking the `+ New` chip opens the Create-Automation dialog directly.
  - An invalid-count warning badge (`⚠ N`) renders in the re-skinned header when applicable.
- **Drift risk:** Medium — recent plugin-slot/skin fix on an evolving automation surface; sidebar section styling may be re-tuned by later parity passes.

### 2026-06-21-remove-project-readme-button
- **Date:** 2026-06-21
- **Frontend surface:** Sidebar pinned-folder header ("View README.md" button), README overlay route
- **User-facing behavior:** The per-folder "View README.md" button and its overlay preview route are removed; README access remains only via the editor/file browser.
- **Test cases (Playwright candidates):**
  - The pinned-folder header no longer renders the "View README.md" button (`data-testid="view-readme-btn"` absent).
  - Navigating to a `/folder/:encodedCwd/readme` route no longer renders a README preview overlay.
- **Drift risk:** Low — a removal change; absence of the button/route is a stable end state.

### 2026-06-22-restore-windows-nsis-installer
- **Date:** 2026-06-22
- **Frontend surface:** (none — Windows installer/CI packaging)
- **User-facing behavior:** Windows users install the dashboard via a per-user NSIS Setup.exe with Start Menu shortcut and uninstaller; no browser-rendered change.
- **Test cases (Playwright candidates):**
  - (no browser-observable UI behavior)
- **Drift risk:** Low — installer/packaging concern isolated from the web client; unaffected by UI evolution.

### 2026-06-22-throttle-idle-ui-animations
- **Date:** 2026-06-22
- **Frontend surface:** Selected SessionCard neon glow ring (`.card-ring-fx`/`.card-glow-fx`), document root `app-hidden` class
- **User-facing behavior:** The selected-card neon ring uses transform-based (compositor-only) gradients instead of a per-frame animated blur, and all CSS animations pause when the window/tab is hidden, cutting idle CPU/GPU use.
- **Test cases (Playwright candidates):**
  - Selecting a session card renders a neon ring overlay layer on that card.
  - Hiding the document (visibility hidden / tab blur) adds an `app-hidden` class to the document root.
  - Restoring visibility (focus) removes the `app-hidden` class.
  - The neon ring layer uses a CSS transform (rotate) rather than an animated `--neon-angle` custom property. *(inspectable via computed style)*
- **Drift risk:** Low — a performance/structural fix to a stable visual element; behavior (ring on selection, pause on hide) is intended to persist.

### 2026-06-23-add-e2e-spawn-scenarios
- **Date:** 2026-06-23
- **Frontend surface:** LandingPage onboarding / pin dialog + session spawn round-trip; git-branch-btn; terminal (E2E harness scenarios)
- **User-facing behavior:** Provider-ready test harness enables real folder-pin + session-spawn scenarios; a spawned session's card appearing proves the WS round-trip, and a git session shows its branch indicator.
- **Test cases (Playwright candidates):**
  - Pinning a directory then starting a session results in the new session card appearing (spawn round-trip).
  - A spawned session in a git repo shows the `git-branch-btn` branch indicator on its card.
  - Opening the terminal for a session shows the terminal surface.
  - Onboarding step-2 CTA unlocks Add-folder / Start-session once providers are ready.
- **Drift risk:** Low — these are the current E2E scenario specs defining expected UI behavior; effectively the living test contract.

### 2026-06-23-add-markdown-knowledge-base
- **Date:** 2026-06-23
- **Frontend surface:** None (SQLite/FTS5 kb store + agent pull tool)
- **User-facing behavior:** Adds a local markdown knowledge-base search tool for agents; backend capability with no browser-rendered UI.
- **Test cases (Playwright candidates):**
  - (no browser-observable UI behavior)
- **Drift risk:** Low — backend/agent-tool capability, no UI surface.

### 2026-06-23-add-playwright-e2e
- **Date:** 2026-06-23
- **Frontend surface:** Dashboard shell / root app (smoke-level render + WebSocket connection indicator)
- **User-facing behavior:** The dashboard loads its shell at the browser URL and maintains a live WebSocket connection without showing a disconnect banner.
- **Test cases (Playwright candidates):**
  - Navigating to `/` renders the dashboard shell root selector (stable root element / title present).
  - After load, no `role="alert"` disconnect banner appears within a short hold window (WS stays connected).
- **Drift risk:** Low — smoke-level shell render + WS liveness are stable core behaviors, and this change is the test harness itself.

### 2026-06-23-fix-automation-result-capture
- **Date:** 2026-06-23
- **Frontend surface:** Automation plugin result view (`result.md` content surfaced via automation UI/API)
- **User-facing behavior:** An automation run's result shows the assistant's actual reply (e.g. "PONG") instead of echoing the injected prompt text.
- **Test cases (Playwright candidates):**
  - After an automation run completes, the automation result panel displays the assistant's reply text, not the prompt text.
  - A run that produces no genuine assistant findings is shown as auto-archived / empty rather than displaying the echoed prompt.
- **Drift risk:** Low — targeted capture-correctness fix; automation result surface is stable.

### 2026-06-23-port-session-card-state-visuals-to-openspec-board
- **Date:** 2026-06-23
- **Frontend surface:** `OpenSpecBoardView` — `BoardSessionRow` and `ProposalCard`; board auto-scroll
- **User-facing behavior:** Kanban board rows and proposal cards show the same animated status stripes as sidebar session cards (yellow=running, cyan=unread, purple=ask_user) and the board auto-scrolls the active card into view.
- **Test cases (Playwright candidates):**
  - A running/streaming board session row renders a `.card-stripes-fx` child with `card-stripes-running`.
  - An unread board session row renders `card-stripes-unread`; an `ask_user` row renders `card-stripes-input`.
  - An idle/ended board session row renders no `.card-stripes-fx` overlay.
  - A `ProposalCard` with one `ask_user` child and one running child paints `card-stripes-input` (precedence) on the card root.
  - An all-ended proposal card renders no card-level `.card-stripes-fx`.
  - Selecting an off-screen session (via sidebar/deep-link) triggers `scrollIntoView` on the board; clicking a visible row does not scroll.
- **Drift risk:** Medium — port of visual logic between two surfaces; a later board redesign could rework the stripe/scroll integration.

### 2026-06-23-redesign-automation-editor-and-board
- **Date:** 2026-06-23
- **Frontend surface:** CreateAutomationDialog (grouped editor) and AutomationBoard, two-level trigger picker, ModelSelector integration
- **User-facing behavior:** The automation create/edit dialog is reorganized into Identity/Trigger/Action/Advanced groups with a two-level event-category→event-type trigger picker, a ModelSelector/@role dropdown, and an improved board with per-automation actions.
- **Test cases (Playwright candidates):**
  - The automation dialog renders grouped sections (Identity, Trigger, Action, Advanced) with Advanced collapsed by default.
  - The Model field renders a ModelSelector plus an `@role` dropdown instead of a free-text input.
  - The trigger picker shows a level-1 event-category tab strip and a level-2 event-type checklist.
  - Selecting the `scheduled` category shows the cron helper with a next-run preview.
  - Categories/events not yet wired render disabled ("coming soon").
  - The `worktree` mode option is disabled when the target is not a git repo.
  - Opening an existing automation loads its values into the editor (edit path), and a delete action is reachable from the board.
- **Drift risk:** Medium — a large multi-part UI redesign of a newer plugin; internal seams (e.g. planned trigger categories) likely evolve as events get wired.

### 2026-06-23-redesign-goal-create-dialog
- **Date:** 2026-06-23
- **Frontend surface:** goal-plugin — CreateGoalDialog (modal), FolderGoalsSection (`+ Goal`), GoalsBoardClaim (`+ New Goal`)
- **User-facing behavior:** The `+ Goal` (sidebar) and `+ New Goal` (board) affordances open one shared modal `CreateGoalDialog` (centered overlay, backdrop-dismiss) wrapping the existing GoalForm, instead of rendering an inline panel that displaced the list/board.
- **Test cases (Playwright candidates):**
  - Clicking `+ New Goal` on the goals board opens a centered `goal-create-dialog` modal and no longer renders the inline `goals-board-create` container.
  - Clicking `+ Goal` in the folder sidebar section opens the same `CreateGoalDialog` modal.
  - Clicking the backdrop or the ✕ closes the dialog.
  - Submitting the GoalForm inside the dialog creates a goal (calls createGoal) and the new goal card appears.
  - The board cards behind the open dialog are dimmed and not displaced.
- **Drift risk:** Low — recent change aligning goal create with the stable automation-dialog pattern.

### 2026-06-23-replay-persisted-flow-runs
- **Date:** 2026-06-23
- **Frontend surface:** Flow card in ChatView (persisted flow-run replay)
- **User-facing behavior:** After `/resume`, browser refresh, or server restart, a flow card reappears with its full per-agent timeline, including step-level error entries, instead of vanishing.
- **Test cases (Playwright candidates):**
  - After refreshing the browser on a session that ran a flow, the flow card reappears with its per-agent timeline.
  - A flow run that had a step-level agent failure shows a `{ kind: "error" }` entry in the agent's detail timeline after replay.
  - After a server restart or `/resume`, the previously-run flow card is still visible (not blank).
- **Drift risk:** Low — recent replay-correctness contract for the flow card; unlikely superseded.

### 2026-06-23-sophisticate-goal-authoring-and-control
- **Date:** 2026-06-23
- **Frontend surface:** Goal plugin — create form, goal board/detail page, goal chip, live-control buttons
- **User-facing behavior:** Users author a goal with acceptance criteria, budget, and judge model, then control the live loop (pause/resume/done/clear/subgoal) and see per-turn judge verdict history on the board/detail views.
- **Test cases (Playwright candidates):**
  - The goal create form exposes inputs for acceptance criteria, budget (max turns / max spend), and judge model selection.
  - Creating a goal with criteria/budget/judge renders those values on the goal board and detail page.
  - The goal chip renders for a created goal.
  - Clicking Pause on a running goal transitions its status to paused in the UI.
  - The detail page renders per-turn judge verdict history entries (continue/satisfied/paused).
- **Drift risk:** Medium — a plugin surface that expanded a single text box into a full authoring/control UI; recent and mockup-backed, but plugin UIs churn.

### 2026-06-24-add-code-quality-skill
- **Date:** 2026-06-24
- **Frontend surface:** None (Biome config, npm scripts, skill files — build/CI tooling)
- **User-facing behavior:** Adds a code-quality analyzer and goal-loop oracle; no browser-rendered UI change.
- **Test cases (Playwright candidates):**
  - (no browser-observable UI behavior)
- **Drift risk:** Low — pure tooling, no UI surface to drift.

### 2026-06-24-align-pi-080-and-publish-baseline-packages
- **Date:** 2026-06-24
- **Frontend surface:** Recommended-extensions list (Extensions/Packages settings); otherwise dependency/publish infra
- **User-facing behavior:** The curated recommended-extensions list shown in settings is updated (adds context-mode, pi-hermes-memory, model-proxy, goal-hermes, pi-simplify; fixes stale sources); the pi dependency bump and package publishing are non-UI.
- **Test cases (Playwright candidates):**
  - The recommended-extensions list in settings includes `context-mode` (marked strongly-suggested).
  - The recommended-extensions list includes `pi-hermes-memory`, `@ricoyudog/pi-goal-hermes`, `@blackbelt-technology/pi-model-proxy`, and `pi-simplify`.
- **Drift risk:** Medium — the recommended-extensions manifest is periodically re-curated, so exact membership drifts with later releases.

### 2026-06-24-automation-ui-mockup-parity
- **Date:** 2026-06-24
- **Frontend surface:** AutomationBoard cards (status rail/dot/pill, glow/stripe FX, headless icon, last-run summary) + CreateAutomationDialog editor + runs table
- **User-facing behavior:** Automation cards now read like session cards — status rail, status pill badges, headless source icon, barber-pole stripe on running cards, neon glow/rim on the selected card, per-card last-run summary, mode meta and repo crumb; the editor gains bordered group boxes and segmented controls; the runs table adds findings and status-specific links; a running run can be Stopped.
- **Test cases (Playwright candidates):**
  - An automation card renders a status rail and status pill badge whose color matches its state (active/idle green, running amber, error red, disabled muted).
  - A running automation card shows the barber-pole stripe overlay and a "Stop" control.
  - The selected automation card shows the neon glow/rim FX.
  - Each card shows an inline last-run summary (status pill + relative time + findings + result/log link) when a run exists, and nothing when none.
  - The editor renders Identity/Trigger/Action/Advanced as bordered group boxes with Advanced collapsed by default.
  - Scope and Action kind render as segmented controls rather than plain `<select>`.
  - The runs table shows a findings count column and a status-specific link label (watch/result/log).
- **Drift risk:** Medium — recent, but visual-parity work is inherently prone to further mockup-driven restyling.

### 2026-06-25-rework-flows-plugin-for-new-pi-flows
- **Date:** 2026-06-25
- **Frontend surface:** flows-plugin — flow card grid, code/code-decision step cards, outputs KV section, authoring tool-call renderer (removes FlowArchitect UI)
- **User-facing behavior:** The flows plugin drops all flow-architect UI and renders new node types — `code` and `code-decision` cards (with chosen branch and `↻ n/max` loop pill), a typed `outputs` section, and authoring tool calls (`flow_write`/`flow_agents`) as timeline tool-call entries.
- **Test cases (Playwright candidates):**
  - A running `code` step renders a code card in the flow grid.
  - A `code-decision` step renders its chosen branch and a `↻ n/max` loop pill.
  - A completed step with typed outputs renders an `outputs` key/value section.
  - A `flow_write` / `flow_agents` authoring call renders as an ordinary tool-call timeline entry (via the tool-renderer slot).
  - No FlowArchitect components or architect input prompt render for any flow event.
  - An event lacking `nodeKind` falls back to an agent-card without breaking the grid.
- **Drift risk:** Medium — new node-type cards are recent, but tied to an evolving pi-flows contract that may shift again.

### 2026-06-26-expandable-flow-summary-rows
- **Date:** 2026-06-26
- **Frontend surface:** FlowSummary per-step rows
- **User-facing behavior:** Each completed flow step gains a chevron disclosure; expanding reveals full agent summary, typed-output chips, file list, and failure outcome; error steps auto-expand.
- **Test cases (Playwright candidates):**
  - A completed row with a summary renders a collapsed chevron plus a truncated one-line peek.
  - Clicking a row's chevron reveals the full summary, typed-output chips, and the file list.
  - An `error`-status row renders expanded on mount.
  - A row with no summary/files/typedOutputs renders no interactive chevron and cannot expand.
  - Expanding one row leaves other rows' expanded state unchanged.
- **Drift risk:** High — same-day companion to show-flow-cards-in-summary; the summary card was in active flux and likely iterated further.

### 2026-06-26-fix-plugin-config-write-persistence
- **Date:** 2026-06-26
- **Frontend surface:** Plugin settings-section forms (flows, automation, goal, roles, subagents, etc.)
- **User-facing behavior:** Saving any plugin's settings actually persists; the "N unsaved change" indicator clears after Save and the value survives reload.
- **Test cases (Playwright candidates):**
  - Toggling a plugin setting and clicking Save clears the "N unsaved change" indicator.
  - After saving a plugin setting and reloading the page, the saved value is still applied.
  - A save that fails (non-2xx) keeps the draft marked dirty and surfaces an error.
- **Drift risk:** Low — a wiring fix on a generic persistence path every plugin depends on; core behavior likely stable.

### 2026-06-26-fix-plugin-tailwind-source-scan
- **Date:** 2026-06-26
- **Frontend surface:** Sidebar folder card "Goals (N) →" row hover state (goal-plugin indigo utilities)
- **User-facing behavior:** The "Goals (N) →" row and its "+ Goal" chip now show hover feedback (indigo color/border change) matching the sibling Automations/OpenSpec rows, because the previously purged Tailwind utilities are now emitted.
- **Test cases (Playwright candidates):**
  - Hovering the sidebar "Goals (N) →" row title applies the indigo hover text color (visible hover feedback like sibling rows).
  - Hovering the "+ Goal" chip applies its indigo hover text and border color.
  - The "Automations (N) →" row retains its existing blue hover feedback (no regression).
- **Drift risk:** Low — a build/CSS-emission fix on stable sidebar rows.

### 2026-06-26-improve-flow-graph-dialog-and-card-interaction
- **Date:** 2026-06-26
- **Frontend surface:** FlowSummary (flow-summary-view), FlowGraph expand dialog (new `size="full"` Dialog), FlowAgentCard details, bidirectional node/card highlight
- **User-facing behavior:** Expanding the flow graph opens a near-fullscreen wide dialog fitting the horizontal DAG; clicking a graph node highlights and scrolls to its card (and vice versa); the agent Details button opens a Dialog instead of a popover/popout tab.
- **Test cases (Playwright candidates):**
  - Clicking ⤢ Expand on the flow summary opens a Dialog at the `full` (near-fullscreen, `max-w-[95vw]`) size.
  - Inside the expanded dialog the horizontal DAG fills the wide stage without an inner 70vh scroll cap.
  - Clicking a graph node adds a selection ring/glow to the node and scrolls the matching agent card into view.
  - Clicking an agent card selects it and scrolls the matching graph node into view.
  - Pressing Esc or re-clicking the selected element clears the selection.
  - Clicking an agent card's Details (eye) button opens the agent detail in a Dialog rather than an anchored popover or new browser tab.
- **Drift risk:** Medium — refines an actively-evolving flow surface; interaction details may be further adjusted by subsequent flow changes.

### 2026-06-26-improve-flow-ui
- **Date:** 2026-06-26
- **Frontend surface:** FlowGraph (live graph), static flow Mermaid snapshot, FlowAgentDetail / MinimalChatView tool-call rows
- **User-facing behavior:** The flow graph draws decision-branch and `on_complete`/`on_error` routing edges consistently in both the live graph and the static snapshot; per-tool-call status glyphs are removed from the flow agent detail view; the dead subflow (`flow-ref`) node and its tab navigation are gone.
- **Test cases (Playwright candidates):**
  - The live FlowGraph renders decision-branch edges (fork / agent-decision / code-decision) and `on_complete`/`on_error` routing edges while a flow runs.
  - The static flow snapshot graph renders implicit-sequential and `on_complete`/`on_error` edges matching the live graph's edge set.
  - Backward/loop edges render with distinct dashed/loop styling in both views.
  - Tool-call rows in the FlowAgentDetail view no longer show a leading per-entry status glyph.
  - No `flow-ref`/subflow node or subflow tab navigation renders in the flow UI.
- **Drift risk:** Medium — flow-graph rendering is an actively evolving surface; edge-derivation details are likely to be further refined, and the manual verification was deferred.

### 2026-06-26-show-flow-cards-in-summary
- **Date:** 2026-06-26
- **Frontend surface:** FlowSummary widget (agent cards + summary section)
- **User-facing behavior:** After a flow completes, users see the frozen FlowAgentCard grid above a collapsible summary section, retaining detail popouts and view-source affordances.
- **Test cases (Playwright candidates):**
  - After a flow completes, FlowSummary renders the frozen agent cards grid above the summary lines.
  - Collapsing the summary section hides the summary rows while the agent cards remain visible.
  - The frozen cards expose the detail-popout (eye) and view-source affordances.
  - An agent with no card snapshot still renders its summary line (graceful fallback).
- **Drift risk:** High — flow-summary layout was actively being reworked (companion expandable-rows change same date), so this composition is likely superseded/iterated.

### 2026-06-27-extend-client-utils-state-feedback-primitives
- **Date:** 2026-06-27
- **Frontend surface:** client-utils primitives — EmptyState, Skeleton, `.focus-ring` utility, StatusPill/status presentation; consumers ChatView, OpenSpecBoardView, SessionList search boxes, CommandInput composer
- **User-facing behavior:** Shared state/feedback primitives replace ad-hoc UI: value-framed empty states with a single CTA, content-shaped skeletons (respecting reduced-motion), a visible ≥2px focus ring on keyboard focus, and non-hue status channels (icon/shape) for accessibility.
- **Test cases (Playwright candidates):**
  - The chat "No messages yet" state renders an EmptyState with a value-framed heading and at most one primary CTA.
  - The OpenSpec board "No proposals" empty state renders via EmptyState.
  - The chat-history load shows skeleton bubbles (not a centered spinner) with no layout shift when real bubbles arrive.
  - Under `prefers-reduced-motion`, skeletons render static (no shimmer animation).
  - Keyboard-tabbing to a search box or the composer textarea shows a visible focus ring; a mouse click does not.
  - Status indicators convey state via a non-color channel (icon/shape), not hue alone.
- **Drift risk:** Low — foundational shared primitives intended for broad, durable adoption.

### 2026-06-27-fix-file-preview-survives-message-churn
- **Date:** 2026-06-27
- **Frontend surface:** ChatView FilePreviewOverlay (file-link inline preview), FilePreviewProvider
- **User-facing behavior:** An open inline file preview stays open when new chat messages arrive or the assistant streams more tokens; only one preview is open at a time.
- **Test cases (Playwright candidates):**
  - Opening a file preview then receiving a new chat message keeps the overlay (`data-testid="file-preview-overlay"`) present.
  - Opening a file preview on the streaming message and advancing streaming text keeps the overlay present.
  - The streaming→committed message transition keeps an open preview overlay present.
  - Opening file A then file B shows exactly one overlay displaying file B.
  - Pressing Esc, clicking the backdrop, or clicking the close button dismisses the preview.
  - A localhost+editor file click calls the editor open path and renders no overlay.
- **Drift risk:** Low — a targeted correctness fix to stable preview behavior; unlikely to be superseded.

### 2026-06-27-fix-worktree-link-origin
- **Date:** 2026-06-27
- **Frontend surface:** FileLink in tool output (worktree-session file links)
- **User-facing behavior:** File links in a worktree session point at the worktree's own tree copy, so opening them targets the correct path.
- **Test cases (Playwright candidates):**
  - Clicking a worktree-session file link for a token under the parent root opens the re-rooted worktree path via `POST /api/open-editor`.
  - Clicking a foreign absolute-path link still opens the path verbatim.
- **Drift risk:** Low — corrects link-origin targeting; a stable per-link behavior with dedicated tests.

### 2026-06-27-improve-dashboard-attention-routing
- **Date:** 2026-06-27
- **Frontend surface:** SessionCard (rail, status dot, ActivityIndicator), theme status tokens
- **User-facing behavior:** A session blocked waiting on the user ("ask_user") gets a dedicated "needs-you" color on its dot/rail/icon and a "Needs you" label with a comment-question icon, while a finished turn shows a muted "Idle" label — so the urgent state is distinguishable without relying on hue alone.
- **Test cases (Playwright candidates):**
  - A session in the chat-routed ask_user state renders its rail and status dot in the needs-you color (not the green idle color).
  - A session in the ask_user state shows the label "Needs you" with the comment-question icon.
  - A finished/idle session shows the label "Idle" in a muted style.
  - The needs-you dot, rail, and source-icon tint all render the same status color simultaneously.
  - An error-state session renders the error color, taking precedence over the needs-you color when both flags are present.
  - A widget-bar (non-chat) prompt does NOT trigger the needs-you rail/dot color.
- **Drift risk:** Medium — status-visual token layer is a fairly stable core behavior, but exact labels/colors are visual and may be retuned by later theme changes.

### 2026-06-27-improve-frontmatter-rendering
- **Date:** 2026-06-27
- **Frontend surface:** MarkdownContent → FrontmatterProperties panel (FilePreviewOverlay, MarkdownPreviewView, skill/spec surfaces)
- **User-facing behavior:** YAML frontmatter in `.md` files renders as a collapsible Obsidian-style Properties panel (typed rows, badges, chips) instead of one giant mangled heading.
- **Test cases (Playwright candidates):**
  - Opening a `.md` file with frontmatter in FilePreviewOverlay shows a collapsed `▸ Properties · N fields` panel above the body (not a giant heading).
  - Clicking the Properties header expands it to show typed rows.
  - A `status` frontmatter key renders as a colored badge.
  - A list-valued frontmatter field renders as chips and a boolean renders as a check/cross.
  - A nested object renders as an indented sub-grid.
  - Malformed YAML frontmatter renders a warn banner with raw values instead of crashing.
  - In default chat rendering (frontmatter="hide"), the frontmatter block is hidden rather than shown as a heading.
- **Drift risk:** Low — recent, well-specified rendering component adopted across multiple stable markdown surfaces.

### 2026-06-27-inline-agent-screenshot-artifacts
- **Date:** 2026-06-27
- **Frontend surface:** Tool-call result renderer (chat, screenshot/image results)
- **User-facing behavior:** Screenshot tool results display the image inline in the chat instead of a clickable path link that could 403.
- **Test cases (Playwright candidates):**
  - A screenshot tool result renders an inline image block and no path-link text for that image.
  - A tool result with two image paths, one over the size cap, renders one inline image and one remaining path-link.
  - A tool result referencing a non-image path leaves that path untouched (no inline image).
  - Inline image blocks render for a generic tool call, not only for the Read-tool renderer.
- **Drift risk:** Medium — depends on tool-result rendering internals that later renderer changes could alter.

### 2026-06-27-refresh-folder-header-branch
- **Date:** 2026-06-27
- **Frontend surface:** Sidebar folder-header branch label (GroupGitInfo)
- **User-facing behavior:** The folder-header branch name updates live when a folder's git HEAD changes outside the dashboard, showing the folder's own HEAD rather than a child worktree's branch.
- **Test cases (Playwright candidates):**
  - Dispatching a `git_head_update { branch: "develop" }` overwrites a stale branch label and the header shows `develop`.
  - A group with a worktree session branch plus a folder HEAD entry renders the folder HEAD (folder outranks child branch).
  - With no folder HEAD entry, the header falls back to the session/fetched branch (unchanged behavior).
- **Drift risk:** Low — targeted correctness fix with a stable server-pushed update contract.

### 2026-06-27-selectable-tool-output-links
- **Date:** 2026-06-27
- **Frontend surface:** Tool output linkification (FileLink `<button>`, UrlLink `<a>`) in chat/tool cards
- **User-facing behavior:** Users can click-drag across auto-linked file paths and URLs to select and copy their text; a plain click still opens the file/URL.
- **Test cases (Playwright candidates):**
  - The rendered URL link `<a>` has `draggable=false` and still navigates on a plain click.
  - The rendered file link `<button>` has `draggable=false` and `user-select: text` styling.
  - A mouse drag starting on or crossing a file/URL link extends `window.getSelection()` to include the link text (no drag hijack).
  - A plain click on a file link still opens the preview/editor.
- **Drift risk:** Low — restores native browser selection on a stable link widget; core interaction unlikely to be superseded.

### 2026-06-27-serve-agent-artifact-previews
- **Date:** 2026-06-27
- **Frontend surface:** FilePreviewOverlay (image preview for linkified artifact paths in tool output)
- **User-facing behavior:** Clicking a linkified screenshot path (e.g. from the browser skill) opens the image in the preview overlay instead of showing "Failed to load image".
- **Test cases (Playwright candidates):**
  - Clicking a linkified screenshot artifact path opens FilePreviewOverlay showing the image (no "Failed to load image").
  - Clicking a non-image artifact path does not render an image in the overlay (error/blocked state).
  - Opening a deleted artifact image path shows a not-found state, not a rendered image.
- **Drift risk:** Low — FilePreviewOverlay is an established component and this is a containment fix to a stable preview path.

### 2026-06-28-add-dashboard-slash-commands
- **Date:** 2026-06-28
- **Frontend surface:** BashOutputCard (slash-exec output rendering) in ChatView
- **User-facing behavior:** `/dashboard:*` slash commands run bash and render output deterministically via a BashOutputCard footer (source: slash-exec) without invoking the LLM; `!`/`!!` bash output shows no such footer.
- **Test cases (Playwright candidates):**
  - Running `/dashboard:server-health` renders a BashOutputCard with the command output and a slash-exec source footer, and no assistant/LLM message is produced.
  - Running `/dashboard:session-info <id-prefix>` renders the session fields (and a usage message on missing args).
  - A `!echo` / `!!echo` command renders bash output with no slash-exec source footer.
- **Drift risk:** Low — recent (June) deterministic command surface; stable.

### 2026-06-28-inject-session-context-into-agent
- **Date:** 2026-06-28
- **Frontend surface:** ChatView (assistant message rendering) + attached-proposal chip
- **User-facing behavior:** A session's agent receives an injected system-prompt fragment naming its session/cwd and attached change; when echoed, the assistant text in ChatView contains the injected context fragment.
- **Test cases (Playwright candidates):**
  - Sending `[[faux:echo-system-context]]` in a session renders assistant text in ChatView containing `── pi-dashboard session context ──` and `You are pi session`.
  - After attaching a proposal, the attached-proposal chip reflects the attached change in the session UI.
- **Drift risk:** Low — the injection→ChatView render path is a stable, E2E-verified core behavior.

### 2026-06-29-add-workspace-reorder-dnd
- **Date:** 2026-06-29
- **Frontend surface:** Sidebar workspace tier drag-and-drop (SortableWorkspaceHeader) and folder-within-workspace drag reorder
- **User-facing behavior:** Users can drag workspace headers to reorder workspaces, and drag folders within a workspace to reorder them; the new order persists across reload. Cross-type drags do nothing.
- **Test cases (Playwright candidates):**
  - Dragging a workspace header to a new slot reorders the workspaces and the new order persists after a page reload.
  - Dragging a folder within a workspace reorders folders inside that workspace, persisting after reload.
  - Dragging a workspace header onto itself (drop-on-self) leaves the order unchanged.
  - A cross-type drag (workspace header over a pinned group, or a workspace-folder across two workspaces) is a no-op with no reorder.
- **Drift risk:** Low — completes the deferred DnD for the existing workspace tier reusing the proven pin-reorder pattern; recent and directly tested.

### 2026-06-29-fix-custom-provider-save-and-auth
- **Date:** 2026-06-29
- **Frontend surface:** SettingsPanel → LLM providers (custom "proxy" provider form)
- **User-facing behavior:** Saving a custom LLM provider with a real key persists correctly and reports "configured" instead of "no API key setup"; empty-name providers surface an error instead of being silently dropped.
- **Test cases (Playwright candidates):**
  - Saving a custom provider with a valid name and literal key shows it as configured (not "no API key setup").
  - Attempting to save a provider with an empty/whitespace name shows an inline error and does not silently drop it.
  - Re-saving a provider whose key field shows the masked `***` does not visibly corrupt/overwrite the stored key indicator.
- **Drift risk:** Medium — Settings provider UI is actively evolving; the configured/status labels here may be restyled later.

### 2026-06-29-fix-expanded-pinned-group-drag
- **Date:** 2026-06-29
- **Frontend surface:** SessionList sidebar — drag-and-drop reordering of pinned directory groups
- **User-facing behavior:** Pinned directory groups can be reordered by drag-and-drop even when the groups (or drop targets) are expanded; dragging a session card inside an expanded group no longer disturbs group order.
- **Test cases (Playwright candidates):**
  - With two pinned groups expanded, dragging group A onto group B swaps their order and persists the new order.
  - After reordering, collapsing both groups and dragging again still reorders (previously-working path unregressed).
  - Dragging a session card inside an expanded group reorders sessions without changing pinned-group order.
  - Dragging an ended session onto an alive session inside an expanded group still triggers drag-to-resume.
- **Drift risk:** Low — targeted collision-detection bug fix restoring an existing promised behavior; core sidebar DnD structure is stable.

### 2026-06-29-fix-flow-ui-graph-zoom-summary
- **Date:** 2026-06-29
- **Frontend surface:** FlowGraph (flow visualization), FlowSummary, FlowDashboard — flows-plugin UI
- **User-facing behavior:** Flow graph nodes become clickable (graph⇄card selection), empty summary rows are hidden, routing edges render correctly, `on_complete` labels are suppressed, panel collapse persists per session, and error-route edges are hidden by default with a persisted toggle.
- **Test cases (Playwright candidates):**
  - Clicking a flow-graph node without dragging selects it (fires its onClick, not a pan).
  - Dragging past the ~4px threshold pans the graph instead of selecting a node.
  - Agents with no summary text do not appear as rows in the Summaries list, and the `Summaries (N)` count reflects only rows with text.
  - The Summaries subsection header/divider is hidden when no summary rows remain.
  - Happy-path `on_complete` edges render as plain solid arrows with no `on_complete` label; `branch`/`on_error` edges keep labels.
  - Collapsing a flow panel and reloading keeps it collapsed for that session.
  - Error-route (`⚠`) edges are hidden by default and the toggle state persists across remounts/reload.
- **Drift risk:** Low — targeted bug fixes to established flow behavior/invariants; the shared-deriver contract is the intended stable state.

### 2026-06-29-fix-stale-bundled-server-cache
- **Date:** 2026-06-29
- **Frontend surface:** (none — Electron bundle build pipeline)
- **User-facing behavior:** Ensures the packaged Electron app ships a resolvable client build so the served UI loads instead of an API-only "No client build found" error.
- **Test cases (Playwright candidates):**
  - (no browser-observable UI behavior)
- **Drift risk:** Low — build/bundling correctness concern, not a rendered UI feature.

### 2026-06-29-guard-client-fetch-json
- **Date:** 2026-06-29
- **Frontend surface:** WorktreeSpawnDialog load-error surface (transport-hygiene, mostly non-visual)
- **User-facing behavior:** When a `/api/git/*` request returns a non-JSON error (e.g. proxy 502/504), the WorktreeSpawnDialog shows the real HTTP status instead of a cryptic "Unexpected token '<'" JSON parse error.
- **Test cases (Playwright candidates):**
  - Opening the +Worktree dialog against a backend returning a non-JSON error page shows an HTTP-status error message (e.g. "HTTP 504 Gateway Timeout") rather than a JSON syntax error.
- **Drift risk:** Low — defensive transport helper affecting an error string; stable and unlikely to be reverted.

### 2026-06-29-improve-flow-graph-fidelity
- **Date:** 2026-06-29
- **Frontend surface:** FlowGraph (flows-plugin DAG rendering) — on_error edge classification, parallel-step layout, error-route toggle
- **User-facing behavior:** The flow graph renders error routes distinctly (returning routes as backward/loop arcs, terminal routes as a collapsed tail sink), hides error elements entirely when toggled off, and lays out parallel sibling steps in the same rank instead of a false serial chain.
- **Test cases (Playwright candidates):**
  - Two same-segment steps with no dependency between them render in the same dagre rank (stacked vertically, same x), not left-to-right serial.
  - A returning on_error route renders as a backward/loop arc below the spine, error-tinted.
  - A terminal on_error route collapses into a single tail sink node rather than N inline handler nodes.
  - Toggling the error-route display off removes error nodes/edges so graph height matches a flow with no error routes.
  - A step immediately following a separator (fork/agent-decision/code-decision) still shows an implicit edge from that separator.
- **Drift risk:** Medium — flow-graph rendering fidelity is actively evolving (see the 06-26 flow-graph dialog change), so exact layout specifics may shift.

### 2026-06-29-open-code-handler-from-flow-card
- **Date:** 2026-06-29
- **Frontend surface:** FlowAgentCard (flow code-node source viewer dialog)
- **User-facing behavior:** A code node on a flow card shows a code-braces icon button that opens a dialog rendering the handler `.ts` file with syntax highlighting.
- **Test cases (Playwright candidates):**
  - A code-kind flow card with a `codeTarget` renders the code-source (code-braces) button.
  - An agent-kind flow card does not render the code-source button.
  - A code-kind flow card without `codeTarget` does not render the code-source button.
  - Clicking the code-source button opens a dialog and issues a fetch to `/api/pi-resource-file?path=<codeTarget>`.
  - The loaded handler content renders inside a fenced `ts` code block (syntax-highlighted, not prose).
  - A fetch error renders the error message inside the dialog.
- **Drift risk:** Low — recent, additive plugin-local change mirroring the existing agent doc-viewer; unlikely already superseded.

### 2026-06-29-replace-wmic-with-powershell
- **Date:** 2026-06-29
- **Frontend surface:** Settings → Tools (binary/tool status rows)
- **User-facing behavior:** On Windows 11 22H2+, the wmic tool no longer shows as a red "not found" row in Settings → Tools; VM detection and editor-PID resolution work silently.
- **Test cases (Playwright candidates):**
  - Settings → Tools no longer lists a `wmic` binary row.
- **Drift risk:** Medium — mostly backend platform code; the only UI effect (removed Tools row) is minor and could be superseded by Tools-list changes.

### 2026-06-29-unify-error-retry-lifecycle
- **Date:** 2026-06-29
- **Frontend surface:** SessionBanner / error-lifecycle surface, inline chat error card, Dismiss ✕ and Stop-retrying controls
- **User-facing behavior:** A session shows a single unified error-lifecycle banner (error anchor with a live retry sub-line); yellow and red never appear together; the Dismiss ✕ actually aborts the retry; the error persists until a confirmed good response.
- **Test cases (Playwright candidates):**
  - During a retry, only one error-lifecycle surface renders (no simultaneous yellow banner + red inline error card for the same failure).
  - The retry status renders as a sub-line within the error banner (e.g. "retrying… attempt N") rather than replacing the error.
  - Clicking the Dismiss ✕ on a retrying/retryable surface aborts the session (retry stops).
  - The error banner remains visible after clicking Retry until a confirmed non-error response arrives.
  - A failed retry updates the banner in place without the error momentarily disappearing.
  - No duplicate red error card renders in the chat stream for a failure already shown in the banner.
- **Drift risk:** Low — recent, deliberate consolidation of the error/retry model; likely current.

### 2026-06-30-add-internal-monaco-editor-pane
- **Date:** 2026-06-30
- **Frontend surface:** Internal Monaco editor pane (route `/session/:id/editor?file=<path>`), multi-file tabs, collapsible file-tree rail, per-kind viewers (Monaco/Image/Markdown/Pdf/BinaryWarn), `OpenFileButton`
- **User-facing behavior:** Clicking a file's OpenFileButton opens an in-dashboard read-only viewer pane replacing chat, with multi-file tabs, a file-tree rail, and per-file-kind renderers; tabs persist across reload and server restart.
- **Test cases (Playwright candidates):**
  - Clicking OpenFileButton opens the editor pane with the selected file in a tab.
  - Opening a second file adds a second tab and switches the active tab to it.
  - Closing a tab activates the next tab.
  - Reloading the page restores the previously open tabs.
  - Opening a `.md` file renders the MarkdownViewer, a text file renders Monaco, a `.png` renders the ImageViewer, a `.pdf` renders the PdfViewer, and a binary file shows the BinaryWarn notice without rendering content.
  - With a Monaco tab open, the editor background is a concrete (non-transparent) color inheriting the current theme, and switching themes recolors it live without reload.
  - Clicking the file body (not the native-editor dropdown) opens the internal pane route; the Back button returns to chat.
- **Drift risk:** Low — recent (2026-06-30) and heavily E2E-covered; v1 read-only viewer is a fresh, self-contained surface unlikely to be superseded soon.

### 2026-06-30-adopt-pi-071-072-073-features
- **Date:** 2026-06-30
- **Frontend surface:** ProviderAuthSection (Settings → Provider Authentication), ThinkingLevelSelector, chat message/tool-output view, session stop controls, status bar
- **User-facing behavior:** Users see the provider-auth list without dead Google OAuth rows (unsupported OAuth rows disabled with a tooltip), a thinking-level picker that only shows levels the current model supports, tool output that streams and keeps the LAST lines with a hidden-lines marker plus "Show full output", a "Stop after turn" soft-stop control, and immediate status-bar updates on thinking-level changes.
- **Test cases (Playwright candidates):**
  - Opening Settings → Provider Authentication renders no rows for gemini-cli or antigravity providers.
  - For an OAuth catalogue row whose id is not in the handler-id set, the login button is `disabled` and its tooltip reads "OAuth flow not yet supported in dashboard for `<displayName>`".
  - For an OAuth catalogue row whose id IS in the handler-id set, the login button is enabled.
  - Running a tool call producing >200 lines of output renders the LAST 200 lines plus a "«N earlier lines hidden»" marker (not the first 200).
  - Clicking "Show full output" on a truncated tool result expands to display the complete output.
  - Opening ThinkingLevelSelector against an Anthropic model shows only that model's supported levels, not all six of off/minimal/low/medium/high/xhigh.
  - Changing the thinking level without changing the model updates the status bar immediately.
  - Clicking "Stop after turn" during a streaming session ends the session after the current turn with the final assistant message intact and no aborted-tool error entries.
  - The "Force Kill" control remains present and distinct from "Stop after turn".
  - A message finalized via message_end content replacement shows identical text on live render and after `/reload`.
- **Drift risk:** Medium — bundles six independently evolving surfaces (provider-auth UI, thinking-level picker, tool-output truncation, stop controls); the truncation limits and selector options are the kind of detail later changes commonly re-tune, while the core controls are more stable.

### 2026-06-30-card-gradient-state-animation
- **Date:** 2026-06-30
- **Frontend surface:** SessionCard (state-signal background animation) + OpenSpec board/folder proposal cards
- **User-facing behavior:** Session cards signal running/unread/ask_user state via a soft horizontal sweep gradient (gliding color band over a flat tint) instead of the old diagonal barber-pole stripes, keeping text readable.
- **Test cases (Playwright candidates):**
  - A running-state card exposes the `card-stripes-running` class and renders the sweep gradient (no `repeating-linear-gradient(45deg…)` diagonal stripes).
  - An unread-state card carries the `card-stripes-unread` class with the cyan sweep treatment.
  - An ask_user-state card carries the `card-stripes-input` class with the purple sweep treatment.
  - With `prefers-reduced-motion` emulated, a stateful card renders a static tinted background (no animated transform/drift).
  - An OpenSpec board proposal card in a running state shows the same sweep animation classes as sidebar cards (shared CSS, no stripe).
  - A selected card renders the sweep gradient underneath the rotating rainbow neon ring (`card-ring-fx`) without visual conflict.
- **Drift risk:** Medium — purely a visual restyle of existing state classes; class wiring is stable but the exact gradient look can be superseded by later visual passes.

### 2026-06-30-directory-settings-page-and-scoped-md-editing
- **Date:** 2026-06-30
- **Frontend surface:** `FolderActionBar` button (cog / "Directory Settings"), new Directory Settings page (`/folder/:cwd/settings/:page?`), Instructions markdown editor page
- **User-facing behavior:** The directory surface becomes a real cog-iconed Directory Settings page with left-nav pages (Instructions · Packages · Resources); markdown instruction files become editable in both directory and global scope.
- **Test cases (Playwright candidates):**
  - The `FolderActionBar` button shows a cog icon and the label "Directory Settings" (not the toy-brick "Pi Resources").
  - Navigating to `/folder/:cwd/settings` renders a left-nav settings shell with Instructions, Packages, and Resources pages.
  - The Instructions page renders an editable markdown editor for project `AGENTS.md` / `.pi/*.md`.
  - Editing and saving an instruction file writes the change (editor exits render-only state and persists the edit).
  - Global Settings → Advanced exposes the same Instructions editor for `~/.pi/agent/*.md`.
- **Drift risk:** Medium — a recent large settings restructure; page grouping and routing may still shift as the settings surfaces converge.

### 2026-06-30-distinguish-offline-from-network-denied
- **Date:** 2026-06-30
- **Frontend surface:** ServerSelector, connection-status banner, Pin Directory (/api/browse) UI
- **User-facing behavior:** Remote users no longer see a phantom "localhost" server row; a network-denied (403) state shows a remedy hint distinct from a genuine "server offline" state.
- **Test cases (Playwright candidates):**
  - When the page origin is loopback, ServerSelector seeds a "Local" localhost row.
  - When the page is served from a remote (non-loopback) host, ServerSelector does not render a phantom "localhost" row.
  - When /api/browse returns 403 `error: "network_not_allowed"`, the UI shows a remedy hint (add subnet / sign in), not a bare "Access denied".
  - When a probe fails on a dead socket (true offline), the UI shows the offline/retry banner distinct from the denied state.
- **Drift risk:** Low — this is a targeted correctness fix to core connection-status semantics likely to remain stable.

### 2026-06-30-optimistic-prompt-progress
- **Date:** 2026-06-30
- **Frontend surface:** ChatView optimistic prompt bubble (idle-session send) with sending→sent→confirmed states
- **User-facing behavior:** Sending to an idle session instantly shows an optimistic bubble that progresses sending → sent → confirmed with no layout shift; mid-turn sends show only a queue chip, not a bubble.
- **Test cases (Playwright candidates):**
  - Sending a prompt to an idle session immediately renders an optimistic bubble in the "sending" state.
  - The optimistic bubble transitions to "sent" (green check) on bridge acknowledgment, then to "confirmed" when the user message_start lands.
  - The bubble geometry stays identical across sending/sent/confirmed (no layout shift).
  - Sending mid-turn renders a queue chip only and no optimistic bubble.
  - Sending to a freshly-selected idle session with no existing state still shows the optimistic bubble.
- **Drift risk:** Low — restores and hardens a core optimistic-send behavior with E2E coverage; recent and load-bearing.

### 2026-06-30-reduce-session-replay-traffic
- **Date:** 2026-06-30
- **Frontend surface:** Session chat replay / IndexedDB rehydration + collapsible heavy tool-output cards
- **User-facing behavior:** Reopening a previously seen session repaints chat instantly from a local cache and only fetches new events; heavy tool outputs show a truncated view with "Show full output".
- **Test cases (Playwright candidates):**
  - Reloading a previously seen session resubscribes with `lastSeq > 0` (delta replay) rather than full history.
  - After reload, the chat repaints from the IndexedDB cache without waiting for full replay.
  - A large tool-result card renders a truncated preview with a control to expand the full output.
  - Expanding a heavy tool-result card fetches and renders the untruncated body.
- **Drift risk:** Medium — Strategy B was reconciled/dropped onto a parallel "Show full output" feature; the exact tool-output UI mechanism changed mid-flight.

### 2026-06-30-restore-pi-version-skew-surface
- **Date:** 2026-06-30
- **Frontend surface:** PiVersionAdvisory banner component + per-session pi-version label
- **User-facing behavior:** A small non-blocking advisory banner appears when the bundled pi is below recommended (yellow soft-warning) or below minimum (red), and hides when compatible; each session shows a per-session pi-version label.
- **Test cases (Playwright candidates):**
  - When `/api/health` reports `upgradeRecommended: true`, a yellow soft-warning advisory pill renders.
  - When compatibility reports a below-minimum error, a red advisory renders.
  - When `compatibility` is null or compatible, no advisory banner renders.
  - A session displays a per-session pi-version label sourced from the bridge.
- **Drift risk:** Medium — advisory is a small recent surface, but version-skew UI is prone to being reshaped by future compat bumps.

### 2026-07-01-decouple-automation-action-registry
- **Date:** 2026-07-01
- **Frontend surface:** Automation action dialog (action picker rendered from ActionDescriptors)
- **User-facing behavior:** The automation action dialog lists available actions published by active plugins (flows, core prompt/skill); an action appears only when its plugin is loaded.
- **Test cases (Playwright candidates):**
  - The automation action dialog lists the core prompt and skill actions.
  - The automation action dialog lists a flows action when the flows plugin is active.
  - The automation action dialog omits an action whose contributing plugin is not loaded.
- **Drift risk:** Medium — plugin/registry plumbing is largely backend; the dialog's rendered action set is observable but the automation UI is new and evolving.

### 2026-07-01-fix-automation-overflow-menu-clip
- **Date:** 2026-07-01
- **Frontend surface:** AutomationBoard automation card `⋯` overflow menu (Edit / Delete)
- **User-facing behavior:** Clicking the `⋯` overflow button on an automation card opens a visible Edit/Delete menu that renders over the card instead of being clipped; outside-click and Esc dismiss it.
- **Test cases (Playwright candidates):**
  - Clicking `overflow-<name>` renders `overflow-menu-<name>` with visible `edit-<name>` and `delete-<name>` items at document/body level (portaled, not clipped).
  - Clicking outside the open overflow menu closes it without firing Edit or Delete.
  - Pressing Esc while the overflow menu is open closes it without firing Edit or Delete.
  - Card decorative FX (glow/stripe/ring/rail) remain clipped to the rounded border while the menu escapes the clip.
- **Drift risk:** Low — recent, targeted fix with preserved `data-testid` hooks and stable Edit/Delete contract.

### 2026-07-01-fix-flow-agents-renderer-truncation
- **Date:** 2026-07-01
- **Frontend surface:** FlowAgentsToolRenderer (flow_agents authoring card in flows-plugin)
- **User-facing behavior:** The flow_agents "list" card no longer shows a false "0 agents" when its result was line-truncated; it reads the real count from structured details or shows a truncated/expandable indicator.
- **Test cases (Playwright candidates):**
  - A flow_agents list card whose text result is the truncation-marker form renders a truncated/expandable indicator and does NOT show "0 agents".
  - A flow_agents list card with `toolDetails` carrying a count of 7 renders "7 agents" and the agent names.
  - A flow_agents list card with a valid untruncated catalog of N agents renders "N agents" with names.
  - A flow_agents list card with a genuinely empty result (`[]`) and no details renders "0 agents".
  - Expanding "Show full output" reveals the full JSON catalog.
- **Drift risk:** Medium — noted as superseded by a later flow-agents-readable-list change, so this renderer's exact display may already be replaced.

### 2026-07-01-fix-plugin-and-scoped-back-navigation
- **Date:** 2026-07-01
- **Frontend surface:** Global back button across plugin overlay routes (Automations board, run monitor), Directory Settings file picker, and session editor pane
- **User-facing behavior:** The back button now works on plugin-contributed overlay routes and walks file→file in the Directory Settings picker instead of ejecting to the card list; back from the run monitor returns to the launching board route, and back from the session editor returns to the session.
- **Test cases (Playwright candidates):**
  - On the Automations board route, clicking Back navigates to `/` (its declared parent).
  - On the automation run monitor route, clicking Back returns to the launching board route (not home).
  - In the Directory Settings file picker, Back walks from file to file rather than ejecting to the card list.
  - From the session editor pane (`/session/:id/editor`), Back returns to `/session/:id`.
- **Drift risk:** Low — recent fix pinned by regression tests on the current navigation model.

### 2026-07-01-flow-agents-readable-list
- **Date:** 2026-07-01
- **Frontend surface:** FlowAgentsToolRenderer (flow_agents op:"list" card)
- **User-facing behavior:** The `flow_agents op:"list"` card shows an always-visible per-agent list (name, description, source badge), each row expandable to reveal tools/inputs/outputs/use_when — no "Show full output" needed.
- **Test cases (Playwright candidates):**
  - With `toolDetails.agents` present, the card renders one row per agent (name + description + source badge) and an "N agents" count, without a "Show full output" control.
  - Expanding a row reveals a detail block listing only the present fields (tools/inputs/outputs/use_when); absent fields are not shown.
  - Rows are collapsed by default (no detail block visible until a row is expanded).
  - With no `toolDetails` but a valid text catalog, rows still render from the parsed text.
  - With a truncated `result` and no `toolDetails`, the card shows "output truncated — expand" and never "0 agents".
- **Drift risk:** Low — this is the current/latest iteration of the agents-list card with explicit regression guards.

### 2026-07-01-refresh-model-selector-models
- **Date:** 2026-07-01
- **Frontend surface:** ModelSelector dropdown footer (refresh control) via StatusBar
- **User-facing behavior:** The model selector dropdown has a footer refresh control that re-requests the model list for the current session, showing a busy spinner until the fresh list arrives.
- **Test cases (Playwright candidates):**
  - The model selector dropdown footer renders a refresh control.
  - Activating the refresh control shows a busy/spinner state until the new model list arrives.
  - The refresh control is disabled while busy.
  - After authenticating a provider and clicking refresh, the dropdown updates with new models without a session restart.
  - The busy state clears on a new models list or after the safety timeout.
- **Drift risk:** Low — recent, additive control on the model selector; likely current.

### 2026-07-01-register-plugin-automation-events
- **Date:** 2026-07-01
- **Frontend surface:** Create-automation dialog (action control)
- **User-facing behavior:** The create-automation dialog's fixed prompt|skill segmented control becomes an inline grouped accordion listing all plugin-contributed actions (e.g. `flows.run`) available for the current cwd.
- **Test cases (Playwright candidates):**
  - The create-automation dialog's action control renders as a grouped accordion rather than a two-option segmented control.
  - The action accordion lists the built-in `core.prompt` and `core.skill` actions.
  - When the flows plugin is active for the cwd, a `flows.run` action appears selectable in the dialog.
  - Selecting a contributed action renders its schema-driven payload inputs.
- **Drift risk:** Medium — mostly a server/registry seam; the dialog UI portion is new and may evolve, but built-in action presence is a stable contract.

### 2026-07-02-fix-file-preview-backdrop-blocks-composer
- **Date:** 2026-07-02
- **Frontend surface:** FilePreviewOverlay backdrop vs. CommandInput composer (send button)
- **User-facing behavior:** With a file preview open, the user can still click the composer send button and send a new prompt; the preview no longer blocks composer interaction.
- **Test cases (Playwright candidates):**
  - With a file preview overlay open, clicking the composer send button successfully sends a prompt (not intercepted by the backdrop).
  - The composer send button is hittable (not pointer-event-obscured) while a preview is open.
  - The preview stays open and its content intact across new-message/streaming/streaming→committed churn.
  - Pressing Esc dismisses the file preview overlay.
- **Drift risk:** Low — a very recent layering fix guarding a documented coexistence invariant; unlikely already superseded.

### 2026-07-03-add-kb-folder-slot
- **Date:** 2026-07-03
- **Frontend surface:** Sidebar folder nav — KB row slot + per-folder KB settings page
- **User-facing behavior:** Each folder shows a `KB · N chunks` row with a reindex/Index-now affordance and a settings page to manage indexed paths.
- **Test cases (Playwright candidates):**
  - A folder with zero chunks renders the KB row in the empty state with a prominent Index now button.
  - A folder with chunks > 0 shows the chunk count and a reindex (↻) icon.
  - Hovering the chunk count shows a tooltip including the file count.
  - Clicking the `→` arrow opens the per-folder KB settings page listing sources with add/remove/reorder controls.
  - A folder with no project config shows Create project config and Copy from parent options in KB settings.
- **Drift risk:** Medium — new nav slot; superseded partly by 2026-07-04 feedback fix, and layout of the row may evolve.

### 2026-07-03-colorize-mermaid-default-nodes
- **Date:** 2026-07-03
- **Frontend surface:** MermaidBlock (rendered diagram SVG)
- **User-facing behavior:** Mermaid diagram nodes without author-set colors get a deterministic per-node soft accent tint (fill ~8% alpha, full-accent border), while author-colored nodes stay untouched; colors follow the active theme.
- **Test cases (Playwright candidates):**
  - A default (un-authored) flowchart node renders with a low-opacity accent fill and a full-accent border.
  - An author-colored node (inline `style` with `fill:`) renders unchanged (full saturation).
  - The same node id keeps the same hue across re-renders when an unrelated node is added.
  - Switching theme (dark vs light) swaps the accent palette applied to default nodes.
  - Node labels keep the theme's normal text color regardless of the tint.
- **Drift risk:** Low — latest change (2026-07-03) and a self-contained SVG post-process; unlikely already superseded.

### 2026-07-03-fix-dox-lint-false-positives
- **Date:** 2026-07-03
- **Frontend surface:** (none — `kb dox lint` CLI tooling)
- **User-facing behavior:** Fixes `kb dox lint` false-positive orphan reports and `--fix` data loss; no dashboard UI effect.
- **Test cases (Playwright candidates):**
  - (no browser-observable UI behavior)
- **Drift risk:** Low — internal docs-tooling fix with no UI surface.

### 2026-07-03-fix-duplicate-inlined-screenshot
- **Date:** 2026-07-03
- **Frontend surface:** ChatView tool-result image rendering (ToolResultImages)
- **User-facing behavior:** A `browser` screenshot returned by the MCP tool renders once in ChatView instead of appearing duplicated side-by-side.
- **Test cases (Playwright candidates):**
  - After an MCP `browser` screenshot tool-result renders in ChatView, exactly one screenshot image is displayed (not two side-by-side).
  - A tool result containing a native image plus a path to a different file still renders both distinct images.
- **Drift risk:** Low — recent, targeted fix to a specific rendering invariant in ChatView.

### 2026-07-03-improve-content-editor
- **Date:** 2026-07-03
- **Frontend surface:** Internal editor pane — file tree rail, tabs, viewers (Monaco, markdown, PDF, image, video, audio, mermaid, html, live-server)
- **User-facing behavior:** The editor tree shows hidden directories with per-kind mime icons, syncs tree↔tabs, offers a markdown Preview/Edit toggle, follows the dashboard theme live, and adds rich viewers plus a live-server preview.
- **Test cases (Playwright candidates):**
  - The file tree renders hidden directories (`.git`, `.pi`) as expandable folders.
  - Each tree row and tab shows a distinct per-kind icon for `.ts/.json/.png/.mp4/.mp3/.mmd/.pdf`.
  - Opening a deep file auto-expands all ancestor folders and reveals/highlights its tree row.
  - Switching tabs highlights the corresponding tree row (bidirectional sync).
  - A markdown tab shows a Preview/Edit toggle; editing sets a dirty state and saves via the write guard.
  - Switching the dashboard theme recolors the open Monaco/markdown editor live.
  - Opening a PDF renders it via the pdfjs canvas viewer (not a download link).
  - Opening an HTML/mermaid/video/audio file renders in its dedicated viewer kind.
- **Drift risk:** Medium — recent, broad editor rework; individual viewers likely stable but tree/tab UI may keep evolving.

### 2026-07-03-migrate-file-index-to-agents-tree
- **Date:** 2026-07-03
- **Frontend surface:** None — repo documentation/tooling (`kb dox`, per-directory `AGENTS.md` tree)
- **User-facing behavior:** Internal migration of the codebase map from centralized `docs/file-index-*.md` splits to a per-directory `AGENTS.md` tree; no dashboard UI effect.
- **Test cases (Playwright candidates):**
  - (no browser-observable UI behavior)
- **Drift risk:** Low — documentation/infra only, no UI surface to supersede.

### 2026-07-03-project-init-skill-and-profiles
- **Date:** 2026-07-03
- **Frontend surface:** Initialize button (folder/session card action)
- **User-facing behavior:** Clicking Initialize on an unconfigured directory launches an interactive project-init session that asks profile questions; on a directory with a hook it runs the hook instead.
- **Test cases (Playwright candidates):**
  - Clicking Initialize on a directory with no worktreeInit hook opens an interactive session surface rather than silently running a hook.
  - Clicking Initialize on a directory that has a worktreeInit hook triggers the hook path (no interactive scaffolder session appears).
- **Drift risk:** Medium — Initialize button behavior is stable, but the interactive scaffolder UI is new and its surface may be restyled by later changes.

### 2026-07-03-split-editor-workspace
- **Date:** 2026-07-03
- **Frontend surface:** Content router — ChatView + Monaco editor SplitWorkspace, session-header split toggle, editor file-search panel
- **User-facing behavior:** Users can view chat and a code editor side-by-side with a draggable divider; a split/unsplit toggle lives in the session header; opening a file auto-opens the split; the editor pane has filename + content search.
- **Test cases (Playwright candidates):**
  - Clicking the session-header split toggle shows the editor pane beside ChatView.
  - Dragging the outer divider resizes the chat and editor panes.
  - Dragging the inner divider resizes the editor file-browse rail independently of the outer split.
  - Opening a file (via chat file-link/tree click/search result) while the split is closed auto-opens the split and loads the file.
  - Below the mobile breakpoint the split stacks vertically (chat top / editor bottom) with a row-resize divider.
  - The editor search panel toggles between Filenames and Contents modes.
  - A changed-on-disk banner appears when a cached open file changes on disk.
  - Split ratio, rail width, open state, and orientation persist per session across reload.
  - Session A's 50/50 split and Session B's closed split remain isolated after reload.
- **Drift risk:** Low — this is a recent (near-latest) structural feature, unlikely to be superseded yet.

### 2026-07-04-add-panel-elevation-system
- **Date:** 2026-07-04
- **Frontend surface:** SessionCard (session cards), WorkspaceHeader / folder header bars, session-name typography
- **User-facing behavior:** Session titles render heavier (weight 600) and cards/folder header bars read as raised beveled panels via an inset top-highlight plus deeper drop shadow.
- **Test cases (Playwright candidates):**
  - The session-name span carries the `font-semibold` class in both desktop and mobile card layouts.
  - A session card container renders a multi-shadow box-shadow (`inset 0 1px 0 …` + `0 4px 8px …`), not a single `shadow-md`.
  - The folder/workspace header bar renders the bevel box-shadow (`inset 0 1px 0 …` + `0 2px 4px …`).
  - The selected card still shows its blue border + ring + glow treatment unchanged after the elevation change.
- **Drift risk:** Medium — cosmetic elevation/typography change; likely to be re-tuned or superseded by later visual passes.

### 2026-07-04-add-server-keypair-pairing
- **Date:** 2026-07-04
- **Frontend surface:** Settings (paired-devices registry / device management), QR + copy-string pairing screen, device-approval compare-code prompt
- **User-facing behavior:** A user pairs a phone by scanning a QR code or pasting a copy-string; the server and device show a numeric compare-code to approve, and paired devices are listed and revocable in Settings.
- **Test cases (Playwright candidates):**
  - Opening the pairing view renders both a QR code image and a copyable pairing string.
  - Initiating pairing shows a numeric compare-code that appears identically on the dashboard approval prompt.
  - Approving a pending device requires an authenticated browser session (approval controls are absent/blocked otherwise).
  - A paired device appears in the Settings paired-devices list with its label, created-at, and last-seen.
  - Clicking Revoke on a listed device removes it from the paired-devices list.
- **Drift risk:** Medium — new auth surface added alongside OAuth; core registry UI likely stable, but pairing view layout is new and may be restyled.

### 2026-07-04-auto-launch-first-run-skip-welcome
- **Date:** 2026-07-04
- **Frontend surface:** Electron first-run wizard window (removed) + splash progress screen
- **User-facing behavior:** The first-run welcome wizard is removed; the app auto-launches the server on first run, showing continuous splash progress instead of an interstitial click screen.
- **Test cases (Playwright candidates):**
  - (no browser-observable UI behavior) — Electron startup state machine / window removal; splash is a native Electron window, not the served web DOM.
- **Drift risk:** Low — removal of an Electron-shell interstitial; not a served-UI surface.

### 2026-07-04-fix-kb-index-feedback
- **Date:** 2026-07-04
- **Frontend surface:** FolderKbSection (per-folder KB row in sidebar)
- **User-facing behavior:** Clicking Index now shows a live indexing spinner during the walk and surfaces a Retry/error state if the trigger fails, instead of a frozen dead button.
- **Test cases (Playwright candidates):**
  - Clicking Index now on a not-indexed folder shows the animated indexing indicator while the job runs.
  - After indexing settles, the row shows the populated state with a chunk count > 0.
  - When the reindex trigger fails, the row shows a failed state with a Retry affordance.
  - A transient stats poll miss during a live walk keeps the spinner visible rather than dropping to error.
- **Drift risk:** Low — fixes reachability of two documented KB-row states; the five-state row is core to the KB feature.

### 2026-07-04-flag-package-source-overrides
- **Date:** 2026-07-04
- **Frontend surface:** Package rows (PackageRow) — `override` pill next to source-type badge
- **User-facing behavior:** A recommended npm extension that is actually installed from a local/git checkout renders a compact `override` pill next to its source-type badge, with a tooltip/aria-label naming the declared npm identity. A git-prefixed source now badges `git` (not `global`).
- **Test cases (Playwright candidates):**
  - A recommended extension installed from a local checkout renders an `override` pill with an `aria-label` naming the declared npm identity.
  - A `git:`-prefixed override row badges `git` (not `global`).
  - A normally npm-installed recommended extension shows no `override` pill.
  - Update affordances on override rows behave exactly as before (no gating change).
- **Drift risk:** Low — recent, narrowly-scoped verbal-remark addition.

### 2026-07-04-folder-resource-activation-toggle
- **Date:** 2026-07-04
- **Frontend surface:** Settings / PiResourcesView (Resources tab) resource rows — activation toggle
- **User-facing behavior:** Each pi resource (extension/skill/prompt/theme) row gets an enable/disable toggle reflecting pi's activation state, letting users turn an installed resource off per scope without uninstalling.
- **Test cases (Playwright candidates):**
  - A resource row in the Resources view renders an enabled/disabled toggle reflecting the resource's `enabled` state.
  - A resource disabled in settings (`-<pattern>`) renders as toggled off; an unmatched resource renders as toggled on.
  - Toggling a resource off then on updates the control's state (POST /api/resources/toggle) without uninstalling the resource.
  - The toggle appears for both local-scope and global-scope resources.
- **Drift risk:** Low — recent additive control on an existing resources listing.

### 2026-07-04-reasoning-auto-collapse-timer
- **Date:** 2026-07-04
- **Frontend surface:** ThinkingBlock (reasoning display) in ChatView, SettingsPanel reasoning preference
- **User-facing behavior:** A live-streamed reasoning block stays expanded for a configurable window (default 30s) after it finishes, then auto-collapses; clicking it freezes it under manual control; replayed/reloaded reasoning blocks stay collapsed on arrival. A `reasoningAutoCollapseMs` setting (0 = never) appears in SettingsPanel.
- **Test cases (Playwright candidates):**
  - After a live reasoning block finishes streaming, it remains expanded, then collapses after the configured window elapses.
  - Reloading the page renders historical (replayed) reasoning blocks collapsed immediately, with no auto-collapse timer.
  - With `reasoningAutoCollapseMs` set to 0, a live reasoning block stays expanded until clicked.
  - Clicking (toggling) a live reasoning block before expiry cancels its auto-collapse so it stays under manual control.
  - SettingsPanel exposes a `reasoningAutoCollapseMs` field alongside the reasoning toggle.
  - Toggling the unrelated `reasoning` setting does not reset `reasoningAutoCollapseMs`.
- **Drift risk:** Low — newest change (dated same as "today"), directly tested via Playwright; represents current intended behavior.

### 2026-07-04-remove-vestigial-tsconfig-references
- **Date:** 2026-07-04
- **Frontend surface:** (none — build/tsconfig cleanup)
- **User-facing behavior:** Removes unused TypeScript project references from five package tsconfigs; no runtime or UI change.
- **Test cases (Playwright candidates):**
  - (no browser-observable UI behavior)
- **Drift risk:** Low — pure build-config change with no UI surface.
