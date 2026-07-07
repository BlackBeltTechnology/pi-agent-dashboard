## Why

Tool-call grouping (change `2026-07-06-group-tool-call-bursts`) only kicks in at 3+ consecutive calls, so single and paired tool calls render as bare rows — the timeline mixes framed groups with loose rows and reads inconsistently. Reasoning leaks out of groups (see the reasoning defects below). The running header is a plain text line with no motion, and the completed header is a terse count that hides what actually happened (which tools, how long, any failures). This change makes grouping **universal, informative, and alive**: every run of tool calls becomes one consistent framed group, the active group animates while it works, and the finished group summarizes richly.

## What Changes

- **Universal grouping (threshold → 1).** Every maximal run of consecutive tool-like items forms a group, including a single call. A one-member group collapses to a single informative summary line (the tool's own summary, not `"1 tool calls"`); multi-member groups keep the `N tool calls` header. The timeline becomes a clean stack of framed group summaries instead of mixed framed/loose rows.
- **Turn-scoped reasoning folding.** `burstWindow` absorbs BOTH leading transparent rows (the turn's opening plan reasoning, before the first tool) AND trailing transparent rows (concluding reasoning, after the last tool), bounded by the surrounding HARD rows. All absorbed reasoning renders through the real `ThinkingBlock` (labeled, collapsible) inside the group frame instead of standalone rows above/below or demoted grey narration. The whole turn's tool activity + its reasoning read as one fold.
- **Animated running state.** While any member runs, the group renders expanded with an **indeterminate shimmer** sweep across the header, a pulsing live spinner, a ticking `N done` count, and the live command with a console glyph. NO fabricated total denominator or determinate progress bar (honesty rule preserved) — motion is indeterminate only.
- **Richer completed state.** The done header shows per-tool-kind **icons + counts** (`🔍 3 · 📄 5 · ⎇ 1`), the aggregate duration, and — when any member errored — a red `N failed` badge. A single-member group shows its tool icon + one-line summary + duration.
- **Full-height expansion (no inner scrollbox).** An expanded group grows to whatever height its content needs and scrolls with the chat timeline — the old fixed `max-height` + inner `overflow-y` scroll container is removed. No scroll trap; long groups just extend the page.
- **Stunning, consistent frame.** One group chrome (rounded frame, accent left-rail, hover affordance) shared by running and done, single and multi. A brief expand/collapse height transition; a completed-flash when a group finishes.
- **Live streaming response.** While the assistant response bubble is streaming, it carries the SAME liveness cue as a running group — an edge-pulse glow + shimmer sweep alongside the streaming caret — and settles static the instant streaming ends. One consistent "this is alive" language across tool groups and prose.
- **`toolGroupDefaultCollapsed` preference (new).** A boolean (default `false`) that, when on, keeps every tool group collapsed by default — including while running — so users who want a quiet timeline can start all groups closed. Now that grouping is universal (threshold→1), this is the escape hatch. Set as a **GLOBAL default** in the Settings page (inherited by every session) and overridable **per-session** in the View popover; per-instance manual toggle still wins.

## Capabilities

### Modified Capabilities
- `chat-view` — lowers the burst-formation threshold to 1, redefines single vs multi header content, enriches running/done headers, adds animation + reasoning-in-group requirements.

## Impact

- `packages/client/src/lib/group-tool-bursts.ts` — threshold → 1; `burstWindow` trailing-transparent absorption.
- `packages/client/src/components/ToolBurstGroup.tsx` — single vs multi header, icon breakdown, error badge, `ThinkingBlock` for absorbed reasoning, shimmer/pulse animation, completion flash; REMOVE the body's `max-h-[190px] overflow-y-auto` so it grows in flow.
- `packages/client/src/components/ChatView.tsx` — streaming response bubble gains the edge-pulse + shimmer liveness class while `streamingText` is active.
- `packages/shared/src/display-prefs.ts` — add `toolGroupDefaultCollapsed: boolean` (default `false`) to `DisplayPrefs`, the three `DISPLAY_PRESETS`, and `mergeDisplayPrefs`; backfill legacy files.
- `packages/client/src/components/ChatViewMenu.tsx` — add the per-session toggle row to the View popover.
- `packages/client/src/components/SettingsPanel.tsx` — add the GLOBAL toggle to the chat-display section (next to the reasoning toggles), wired through the Unified-Save draft registry.
- `packages/client/src/components/ToolBurstGroup.tsx` — seed `expanded = override ?? (prefs.toolGroupDefaultCollapsed ? false : isRunning)`.
- `packages/client/src/components/CollapsedToolGroup.tsx` — reconciled with the unified frame (nested `×N` still one line).
- `packages/client/src/lib/tool-summary.ts` — reused for single-member and live-command summaries; may add per-kind icon mapping.
- CSS: reduced-motion respected (`prefers-reduced-motion` disables shimmer/pulse).
- Display-only. No protocol, server, event-reducer, or persistence change.

## Discipline Skills

- `performance-optimization` — animations must be GPU-cheap (transform/opacity only), no layout thrash on a streaming timeline.
- `code-simplification` — collapse the running/done/single/multi branches into one frame, not four.
