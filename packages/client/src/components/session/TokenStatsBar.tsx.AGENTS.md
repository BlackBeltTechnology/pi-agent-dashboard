# TokenStatsBar.tsx — index

Exports `TokenStatsBar`. Renders per-turn butterfly chart (input up / output down) + stats panel only. Props `turnStats`, `tokensIn`, `tokensOut`, `cacheRead`, `cacheWrite`, `cost`, `onTurnClick`, `showStats`. `formatTokens` helper. Context bar removed (header `ContextRing` replaces it). See change: reorganize-session-header.

See change: virtualize-chat-transcript-tanstack (task 9.3) — clickable turn bars (when `onTurnClick` + `turnIndex>=0`) now carry `data-testid="turn-bar"` + `data-turn-index` so the off-screen `scrollToTurn` e2e can drive the jump affordance.
