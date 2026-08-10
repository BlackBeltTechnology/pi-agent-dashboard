# openspec-board-drop-indicator.spec.ts — index

L3 spec (change: fix-openspec-board-drop-targeting). Drag-time indication + cost: E15/F4/F7/F8/F9/F16/F19/F20/P1 — marker tracks a midpoint crossing, final slot indicated by the rail without hovering it, continuous-indication sweep, sticky rail reachable at any scroll position, dnd-kit auto-scroll at the bottom edge, tablet-wrap + phone-stack, and a 64-card frame budget (gate = median ≤ one refresh interval + zero >25ms frames; a literal `>16.7ms` predicate fires on rAF quantisation, not jank).
