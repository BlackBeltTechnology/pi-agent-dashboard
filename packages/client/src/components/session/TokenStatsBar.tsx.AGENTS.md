# TokenStatsBar.tsx — index

Exports `TokenStatsBar`. Renders per-turn butterfly chart (input up / output down) + stats panel + context-window stacked progress bar. Props `turnStats`, `contextUsage`, `tokensIn`, `tokensOut`, `cacheRead`, `cacheWrite`, `cost`, `onTurnClick`, `showStats`, `showContextBar`. Uses `contextGradientColor`. `formatTokens` helper.

See change: virtualize-chat-transcript-tanstack (task 9.3) — clickable turn bars (when `onTurnClick` + `turnIndex>=0`) now carry `data-testid="turn-bar"` + `data-turn-index` so the off-screen `scrollToTurn` e2e can drive the jump affordance.
