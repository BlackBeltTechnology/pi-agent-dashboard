## Context

See `proposal.md` — Why for the problem and the measured numbers. What shapes the how:

**The card is a composition of two owners.** `FlowAgentCard` (`packages/flows-plugin/src/client/FlowAgentCard.tsx`) renders a bare `<div data-step={stepId}>` (line 98) around the shell, and the shell is the registered `agentCard` ui primitive: `registerUiPrimitive(primitiveRegistry, UI_PRIMITIVE_KEYS.agentCard, AgentCardShell)` in `packages/client/src/main.tsx:69`, where `AgentCardShell` lives in `packages/client-utils/src/AgentCardShell.tsx`. Its root is `flex flex-col` with **no height** (line 25-37) and its children container is `flex-1 flex flex-col` (line 53). The shell is shared with chat subagent cards, so it is a fixed constraint, not a candidate for change. The grid item (`div[data-step]`) already stretches to the row; only the shell does not fill it — that is the 137/154/135/154/154px raggedness.

**The grid is duplicated.** `FlowDashboard.tsx:389` (`grid gap-2 mt-2`) and `FlowSummary.tsx:156` (`grid gap-2`) each carry the same inline `gridTemplateColumns: repeat(auto-fill, minmax(200px, 1fr))`. Neither declares a row track, so a row's height is emergent from its tallest card.

**Reserved height is faked.** Three `&nbsp;` rows (`FlowAgentCard.tsx:136-152`, `text-[10px]`) pad the body to three lines; two of the three paths pad pointlessly once the tool list is 2 long.

**Contrast and targets are token/box choices, not new design.** `packages/client/src/index.css:94-98` already documents `--text-tertiary` as the token that carries 10–11px body text at AA on both `--bg-tertiary` and `--bg-surface` (`#919191` dark / `#636363` light), and `--text-muted` (`#585858` / `#aaaaaa`) as hints/disabled. `FlowAgentCard.tsx:114` (waiting + stats line) and `:185` (the `‹› <absolute path>` line) use `--text-muted` on the card fill. The two file controls (`:193`, `:202`) are `p-0.5` boxes around a `0.45` icon.

**Reachability is a flex fact.** The `content-header-sticky` wrapper is `App.tsx:2343` (`sticky top-0 z-10`), a direct flex child of the chat pane (`SplitWorkspace.tsx:104-112`: `flex min-h-0 min-w-0 flex-col overflow-hidden`). The row is classified `fixed` with `bound: "content"` in `packages/client/src/lib/layout/chat-pane-row-class.ts:75-78`. A flex item's automatic minimum is `min-height: auto`, so that row cannot shrink below its 476px of content inside a 243px pane: it overflows its own row, the pane's `overflow-hidden` clips it, and the card control row — the thing the user aims at — ends up in the clipped band, where the hit test lands on the neighbouring editor pane instead of the button. That is the "element is covered by `<h1>`" report and the A→B dead-button symptom; the route chain is not involved.

Existing machinery to reuse rather than replace: `chat-pane-row-class.ts` is the declared single source of truth for row classification, and the two shrinkable rows apply their own constants at the call site (`ChatView.tsx:1801` `flex: 3 3 64px` + `minHeight: 16px`; `CommandInput.tsx:927-932` `minHeight: 72px` + `shrink min-h-0`). Tailwind v4 container queries are already in use in the client (`CommandInput.tsx:1058` `@container` + `@[44rem]:` variants on descendants; a raw `@container (width < 250px)` block in `index.css:993`), and plugin sources are already scanned by `@source "../../flows-plugin/src/client"` (`packages/client/src/index.css:18`).

## Goals / Non-Goals

**Goals:**

- One geometry contract for the flow card grid, shared by the live grid and the frozen post-flow grid, so a row's cards are equal height and their control rows align.
- A card whose content is legible in one glance: stats, one basename line, two reserved body lines — without padding rows.
- Card secondary text and file controls that clear the WCAG floors the rest of the design system already clears.
- A flow panel that stays reachable inside a short chat pane (split editor open), by making the existing pane height budget cover the sticky header row instead of adding a second, parallel cap.

**Non-Goals:**

- Any change to `AgentCardShell` (`packages/client-utils`) or to chat subagent cards that share it.
- Any change to the card's control-row button set, their titles, or the `FlowAgentDetail` Details dialog.
- Any change to the card→editor route chain (`flow-files.ts` `useOpenFileInEditor`, `SplitRouteSync`, `openInSplit`).
- Any change to the reducer's 3-entry `recentTools` retention (`flow-reducer.ts:242-247`) — the 2-line rule is display-only.
- No server, protocol, persistence, or dependency change; no new plugin primitive.

## Decisions

### D1 — One plugin-local grid helper, not a shell-side component

New `packages/flows-plugin/src/client/flow-card-grid.ts` exporting the grid props (container class + grid class, or class + style pair) that both `FlowDashboard.tsx` and `FlowSummary.tsx` spread onto their grid, plus `FLOW_CARD_ROW_MIN`/`FLOW_CARD_ROW_MIN_COMPACT` (124 / 76) as the single numeric source. Call sites keep their own margin (`mt-2`).

- *Alternative — put it in `client-utils`*: rejected. `client-utils` is the shared shell library whose `AgentCardShell` this change must leave alone; a flow-shaped grid constant there drags a plugin-presentation concern into the shared package's public surface for two call sites.
- *Alternative — leave both call sites inlined*: rejected. Two copies are already the reason the current min-width is duplicated and drifts.

### D2 — Equal height: wrapper `h-full` + child `h-full`, row track `minmax(124px, auto)`

The `div[data-step]` wrapper (grid item, already stretched) gets `h-full` plus `[&>*]:h-full` so the shell — its direct child, which cannot be edited — fills the row cell. Row track becomes `minmax(<FLOW_CARD_ROW_MIN>, auto)` so a one-card row keeps the intended height. Because `AgentCardShell` already ends with a `flex-1 flex flex-col` child container and the card's control row uses `mt-auto` (`FlowAgentCard.tsx:189`), bottom alignment follows for free once the card has a height.

- *Alternative — add a `className`/`fill` prop to `AgentCardShell`*: rejected. Touches the shared package and every consumer for one plugin's layout.
- *Alternative — wrap the shell in a second `h-full` div*: rejected. The `data-step` wrapper is already the grid item; a second box buys nothing and adds a node to every card.

### D3 — Reserved body height via `min-height`, not padding rows

The body slot becomes one element with an explicit line box — `text-[10px] leading-[15px] min-h-[30px]` (2 × 15px), matching the mockup's `.card-b .body { min-height:30px; font-size:10px; line-height:1.5 }` — and holds 0–2 single-line `truncate` entries. The three `&nbsp;` rows are deleted: one pad block per path today (the code branch's fixed 3-row block, the agent branch's `max(0, 3 - recentTools.length)` block), never six.

The two-line reservation applies to agent nodes and to code nodes without program logs. A code node WITH logs renders the shared `LogBlock` preview (`previewLines={2}`, copy-full-log and expand retained), whose own height defines the body and grows the card past the reservation; the row track is `minmax(124px, auto)`, so the row grows and its cards stay equal height (Risks).

- *Alternative — keep padding rows but only two of them*: rejected. They are invisible markup that fixes geometry by accident and cannot be asserted; a `min-height` is one property and is measurable.
- *Alternative — give the whole card a fixed height*: rejected. Cards must be able to grow for extras (branch line, output chips, soft/hard outcome), so only the two-line body slot is reserved.

### D4 — One basename line, full path as `title`

The card renders exactly one monospace line: `basename(codeTarget)` for code/code-decision, else `basename(sourcePath)`, else the `@alias` model string, each with the full path/alias as the line's `title`. The `<div … title={agent.codeTarget}>‹› {agent.codeTarget}</div>` line (`:184-186`) and the separate alias line (`:109-111`) both disappear. `basenameOf` is a module-local helper in `FlowAgentCard.tsx` (2 lines, mirroring the existing local copies in `packages/client/src/components/editor-pane/*`).

- *Alternative — export a `basenameOf` from `client-utils`*: rejected. The flows plugin cannot import from `packages/client`, and a path-string helper in the shared UI package would serve one consumer; the repo already accepts local copies of this two-liner.
- *Alternative — keep the absolute path and truncate*: rejected. That is the current defect: the widest line of 4 of 5 cards is a truncated absolute path, so the user learns nothing from it.

### D5 — Narrow layout keys off PANE width, via a container query on a wrapper element

Split into two elements, because an element cannot query its own container: an outer `@container` wrapper (playing the role the grid div has today) and the inner grid carrying `grid` + `grid-cols-[repeat(auto-fill,minmax(190px,1fr))]` + `auto-rows-[minmax(124px,auto)]` plus `@max-[480px]:grid-cols-1` and `@max-[480px]:auto-rows-[minmax(76px,auto)]`; the card's basename and body lines hide with `@max-[480px]:hidden`, which resolves against the same outer container. Both classes come from D1's helper so the call sites stay one-liners.

- *Alternative — viewport breakpoints (`max-[480px]:`, `useMobile()`)*: rejected. The reported failure is a 243–480px **pane** on a 1440px viewport; a viewport query cannot see it.
- *Alternative — raw `@container (width < 480px)` CSS in `index.css`* (the OpenSpec-segment idiom): rejected as the primary mechanism, because the compact treatment is a set of per-element utilities, not two `display` flips; kept as the fallback if an arbitrary `@max-[…]` variant turns out unsupported.

### D6 — Reachability: reclassify `content-header-sticky` as shrinkable (chosen mechanism)

App.tsx adds `overflow-y-auto` and applies the row's constants inline — `style={{ flexShrink: CHAT_HEADER_WEIGHT, minHeight: CHAT_HEADER_BOUND }}` — exactly as `ChatView` and `CommandInput` do, keeping `sticky top-0 z-10`. `chat-pane-row-class.ts` gains `CHAT_HEADER_BOUND = 0`, `CHAT_HEADER_FLOOR = 1` (floor > bound is the table's validation idiom; the row's real base height is content-driven, so the floor is nominal — exactly the composer's idiom) and `CHAT_HEADER_WEIGHT = 2`, and moves `"content-header-sticky"` from the fixed table to the shrinkable table. With `min-height: 0` declared explicitly in place of the automatic `min-height: auto`, the row now shrinks into the pane's existing deficit allocation and scrolls internally; the transcript and composer keep their floors.

**Bound 0, no pixel floor.** `App.tsx` renders the wrapper for every selected session, and `ContentHeaderStickySlot` returns `null` when no plugin claims the slot (no flow attached); the flow panel also collapses. A non-zero `min-height` would pad that empty slot — or a collapsed flow panel — into a dead band inside the pane. The row needs no pixel floor to be safe: its own `overflow-y-auto` makes the flex item's automatic minimum 0, so `min-height: 0` is the honest declaration of the row's real lower bound and the row may be given all the way down to nothing.

**The existing test already accepts bound 0.** `packages/client/src/lib/__tests__/chat-pane-row-class.test.ts` asserts only (a) `shrinkableRows.length === 2` and (b) `row.floor > row.bound` for every shrinkable row. It never asserts `bound > 0` (the transcript's 16px and the composer's 72px are values, not floors). `CHAT_HEADER_BOUND = 0` / `CHAT_HEADER_FLOOR = 1` therefore satisfies (b), and the row's declaration needs no test change beyond the count 2 → 3 — what the test must accept is a bound of exactly 0 with a floor of 1.

Weight 2 is chosen deliberately: the deficit is shared as weight × base height, and this row's base is by far the largest (a 476px panel vs a 64px transcript floor), so its large content base height alone makes it the primary deficit donor rather than the transcript, while it still yields to the composer's weight-1 floor only after it has given ground. No extra mechanism is needed to "protect" it, and a row whose base height is 0 gets a 0 share.

- *Alternative — a non-zero bound (e.g. one tile's height) as a pixel floor*: rejected. It pads an empty slot (no flow attached) or a collapsed flow panel into a dead band, and it would make the pane's geometry depend on the presence of a decorative minimum rather than on the slot's actual content.
- *Alternative — cap the wrapper with a percentage `max-height` + `overflow-y-auto`, leaving the row `fixed`*: rejected. The declared table would then lie — it counts a fixed row's content height in the floor sum while the row actually renders capped — and a percentage cap resolves only against an ancestor with a definite height, so it would need a second mechanism beside the allocator the pane already has.
- *Alternative — a hard `max-h` on the flow panel inside the plugin*: rejected. It cannot know the pane height (the plugin renders into a slot), it caps the panel even when the pane is tall, and the pane is where the budget lives.

### D7 — Keep the stats line as the cost carrier

Cost stays in the shell's `stats` prop (`FlowAgentCard.tsx:89-95`), as the mockup review required; the `waiting:` segment moves onto the same line rather than becoming its own row.

- *Alternative — a dedicated cost row*: rejected. It costs a line in a 124px tile and contradicts the review decision.

## Risks / Trade-offs

- [The shell fills the row only because of a child-selector class (`[&>*]:h-full`), which is invisible coupling to the shell's DOM shape] → keep the class at D2's single helper, where the reason is commented, and note it in the plugin's `AGENTS.md` row.
- [Reclassifying a row as shrinkable is a global budget change: a pane that is short because of something else (mobile stacked split) now shortens the flow panel too] → that is the intended behaviour (the panel scrolls instead of clipping), and the row's bound is 0 so it can occupy as little as nothing; the MODIFIED `split-editor-workspace` requirement states the new invariant (every row at its content height only when the pane covers the sum of all base heights) and its scenarios must pass.
- [Nested scroll: `FlowSummary`'s inner scrollbox is capped at `max-h-[48vh]` (a viewport unit), so in a short pane it can be taller than the row's scrollport and produce two scrollbars] → verify-only note: observe the 243px split-open case and record what it does. This change does NOT alter `FlowSummary`'s `max-h-[48vh]` cap; if the observation shows a real problem, it is a separate follow-up change, not a silent edit here.
- [A code node WITH program logs renders `LogBlock` instead of the reserved two-line body, so its body height is content-defined and the row can grow past `minmax(124px, auto)`] → accepted trade-off: the log preview is the affordance the spec requires (last 2 lines + copy full log + expand), and reserving exactly two lines there would either clip the `LogBlock`'s own label/controls or fight its internal height. The row track is `auto`-tall, so the row grows as a unit and its cards stay equal height; a code node without logs keeps the two-line reservation.
- [The 480px compact threshold is an estimate from the mockup, not from the live Tailwind build] → it is a single constant behind the container query; tune after measuring the built client, no spec change.
- [A card's extras (output chips, failure banner) can push past the row's 124px minimum, so a row grows] → intended: the row track is `minmax(124px, auto)` and cards grow together, since equal height is per row, not per card.
- [The `width < 480px` container query needs `container-type` on a wrapper, i.e. one extra DOM node per grid] → it is the only way an element can be queried by its own pane width; the node replaces the grid div's role rather than adding a decoration.
- [The Details button in the control row carries a text label and may measure just under 24px high] → out of scope here (the spec targets the two file controls), tracked under Open Questions.

## Migration Plan

1. Land the card layout + grid helper (plugin only), then the host row fix, then the AGENTS rows.
2. `npm run build && curl -X POST http://localhost:8000/api/restart` (client change). `npm test` for the updated flows-plugin and client layout specs.
3. Manual/E2E verification of the reported case: open a card's handler in the split editor, then click another card's handler control without closing the editor.
4. Rollback = revert the commit. No persistence, no protocol, no data migration; nothing to unwind beyond the client bundle.

## Open Questions

- Should the Details button also get an explicit ≥24px min-height? The requirement covers the two file controls; the Details button's own box is measured during implementation and, if short, is a one-line follow-up.
- Do the compact-tile constants (480px pane threshold, 76px row) need tuning after measuring the built client at a real split ratio? Deferred; both live behind the container query.
