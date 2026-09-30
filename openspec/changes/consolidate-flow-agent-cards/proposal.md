## Why

The flows-plugin agent cards are geometrically ragged and partly unreachable. Measured on the real card grid: visible cards are 137/154/135/154/154px tall while their control rows sit at 498/500/517/517/517px, because the grid child (`div[data-step]`) stretches to the row and the shared `AgentCardShell` has no `h-full`. Equal height is faked with three `&nbsp;` pad rows. The widest line of 4 of 5 cards is a truncated absolute path (`‹› /Users/…`), the file buttons measure 15×21px (below the WCAG 2.5.8 24×24 minimum), and two secondary lines use `--text-muted` at 2.47:1 dark / 2.13:1 light on the card fill (below the WCAG 1.4.3 4.5:1 floor) where `--text-tertiary` is 5.58 / 5.51. Separately, with the split editor open the chat pane was 243px tall while the `content-header-sticky` row (`App.tsx:2343`) was 476px, so the card grid was clipped and a real click on a card's "Open handler in editor" landed on the editor pane ("element is covered by `<h1>`") — the reported symptom is that opening file A from a card makes card B's button dead until the editor is closed. (The route chain itself — `useOpenFileInEditor` → `/session/:id/editor?file=` → `SplitRouteSync` → `openInSplit` — was proven correct for A→B, relative and absolute paths.)

## What Changes

- **Uniform card geometry (direction B).** Grid columns `repeat(auto-fill, minmax(190px, 1fr))`, gap 8px, rows `minmax(124px, auto)`, from ONE shared helper/constant used by both the live grid (`FlowDashboard.tsx`) and the frozen post-flow grid (`FlowSummary.tsx`). The `div[data-step]` wrapper keeps `data-step` and gets `h-full` with the card `h-full`, so every card in a row is the same height and the control row is bottom-aligned. The three `&nbsp;` pad rows are removed.
- **Card content consolidation** (`FlowAgentCard.tsx`, flows plugin; the shared `AgentCardShell` in `packages/client-utils` MUST NOT change — chat subagent cards use it too):
  - header unchanged (status icon · name · `headerRight` loop/run pill with `mdiRefresh`, else kind chip);
  - stats line (shell `stats` prop, kept as the carrier so cost stays "in the stats line"): pending with `blockedBy` → `waiting: <deps>`, else the existing chain (tokens · cost · duration when complete, else resolved model, else role);
  - one monospace basename line (`--text-tertiary`): basename of `codeTarget` for code/code-decision, else basename of `sourcePath`, else the `@alias` model line; the full path becomes the `title` tooltip. Replaces both the `‹› <absolute codeTarget>` line and the separate alias line;
  - body, 2 reserved lines via explicit line box `text-[10px] leading-[15px] min-h-[30px]` (no pad hack): agent nodes = LAST 2 tool calls, newest first (▸ newest, · previous; the reducer still keeps 3 — display only); code nodes = `LogBlock` preview with `previewLines={2}` (copy-full and expand retained). A code node WITHOUT logs uses the same two-line reservation; a code node WITH logs lets the `LogBlock` define the body height, so that card grows and its row grows with it (`minmax(124px, auto)`, cards in the row stay equal) — see design D3/Risks;
  - extras kept as today (`AgentMetricSlot`, branch line, typed-output chips, soft/hard outcome) — they may grow a row;
  - control row bottom-right: file buttons UNCHANGED in set and titles (handler `{}` "Open handler in editor" when code-kind + `codeTarget`; agent doc "Open `<name>` source in editor" when `sourcePath`) + Details. Each file button gets a 24×24 hit target. No additional eye icon.
  - every secondary text line uses `--text-tertiary`, never `--text-muted`.
- **Narrow-pane layout.** A Tailwind v4 container query on the grid wrapper (`@container` + `@max-[480px]:`, plugin sources already scanned via `@source` in `packages/client/src/index.css`) keys off PANE width, not viewport: single column, rows `minmax(76px, auto)`, basename and body lines hidden (compact A-style tile).
- **Reachability fix (host, `packages/client`).** The `content-header-sticky` row is reclassified from fixed to **shrinkable** so it takes a share of the chat pane's height deficit and scrolls internally, instead of painting a 476px panel inside a 243px pane and losing its cards to the clip. `CHAT_HEADER_BOUND = 0` with no explicit min-height — the row's own `overflow-y-auto` makes the flex automatic minimum 0, and the wrapper is rendered for every selected session even when the slot has no contribution (no flow attached) or the flow panel is collapsed, so any pixel floor would pad an empty slot into a dead band. `CHAT_HEADER_FLOOR = 1` is nominal (the table's floor > bound idiom; the row's base height is content-driven) and `CHAT_HEADER_WEIGHT = 2` makes the row's large content base height the primary deficit donor under weight × base allocation. No cap, no percentage max-height. Mechanism (chosen in `design.md`) respects `chat-pane-row-class.ts` semantics.
- **Stale-spec reconciliation (`flow-agent-card`).** The archived `open-code-handler-from-flow-card` requirement for the code-source button still describes opening a `Dialog` and fetching `/api/pi-resource-file?path=<codeTarget>`; the shipped code (and `attach-flow-before-run`'s design, which replaced the source dialogs) opens the file in the host editor via `/session/:id/editor?file=<path>` (`useOpenFileInEditor`). A MODIFIED delta restates the requirement as shipped and notes the drift it closes.
- Mockup: mockups/flow-agent-cards (in this change)

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `flow-card-grid`: "Agent cards display live status" (up to 3 → last 2 tool calls, newest first) and "Responsive grid layout" (`minCardWidth` 190px, equal-height rows, narrow-pane container query → single-column compact tiles); one ADDED requirement for secondary-text contrast (AA) and ≥24×24 file-button hit targets.
- `flow-card-status`: the code/code-decision card requirement — handler path as basename with the full path as tooltip, Log preview last 2 lines (`LogBlock`, copy full log, expand retained).
- `flow-agent-card`: "Code nodes expose a handler-source open affordance" — restated as shipped: the `mdiCodeBraces` button (title "Open handler in editor") and the agent doc button open the file in the host editor via `/session/:id/editor?file=<path>`, no dialog and no fetch, hidden without a session id, the doc button additive, the handler button only for `code`/`code-decision` with `codeTarget`. Closes pre-existing drift from `attach-flow-before-run`.
- `split-editor-workspace`: the chat-pane height budget — the sticky header row becomes a shrinkable row (weight 2, bound 0) that takes a share of a pane deficit and owns a scrollport, so its content stays reachable when the pane is short (split editor open).

## Non-goals

- No change to `AgentCardShell` (`packages/client-utils`) or to chat subagent cards.
- No change to the card control-row button set, titles, or to `FlowAgentDetail`/the Details dialog.
- No rework of the card→editor route chain (`flow-files.ts`, `SplitRouteSync`, `openInSplit`); it is already correct.
- No change to the flow reducer's `recentTools` retention (still 3) — display-only truncation to 2.
- No change to `FlowSummary`'s per-agent summary rows, dismiss, or graph⇄card selection.
- No new plugin primitive, dependency, server API, or migration.

## Impact

- **client** (`packages/client/src`): `App.tsx` (`content-header-sticky` wrapper), `lib/layout/chat-pane-row-class.ts` (+ its two spec tests), `components/split/SplitWorkspace.tsx` only if the pane needs an explicit height contract.
- **flows-plugin** (`packages/flows-plugin/src/client`): `FlowAgentCard.tsx`, `FlowDashboard.tsx`, `FlowSummary.tsx`, new shared grid helper.
- **tests**: `packages/flows-plugin/src/__tests__/flow-agent-card-code-source.test.tsx` (3.5 `LogBlock` expectations → `previewLines: 2`), `packages/client/src/lib/__tests__/chat-pane-row-class.test.ts` + `chat-pane-row-completeness.test.ts` (row classification: shrinkable count 2 → 3; the suite's `floor > bound` idiom accepts `bound = 0` and has no `bound > 0` assertion), `packages/client/src/lib/__tests__/theme-body-text-contrast.test.ts` (extended: `--text-tertiary` against the card fill `color-mix(in srgb, var(--bg-secondary), var(--bg-tertiary))` for every palette), `tests/e2e/chat-pane-below-floor-allocation.spec.ts` (re-run; flow-less sessions must be unchanged because the empty sticky slot renders 0px and gets a zero deficit share — re-run and update only if a real shift is observed).
- **docs**: `packages/flows-plugin/src/client/AGENTS.md` and the relevant `packages/client` AGENTS rows.
- No new dependencies. No wire-protocol, server, or persistence change.

## Discipline Skills

- `review-code`: non-trivial change (card layout + shared grid helper + host pane-height contract) reviewed before commit.
- No `security-hardening` trigger: no auth, secrets, PII, untrusted input, or new endpoint — the change is client-side layout over already-validated flow state and reuses the existing `useOpenFileInEditor` nav.
- No `performance-optimization` trigger: the change removes work (2 tool lines instead of 3, no pad rows) and adds no data path; the grid is CSS, not JS column math.
- No `observability-instrumentation` trigger: no new endpoint, job, or external call.
- No `doubt-driven-review` trigger: no irreversible step (no migration, no public API change).
