# split-composer-overflow.spec.ts — index

Browser E2E gate for `fix-split-composer-overflow` + `add-composer-dock`. Opens `layout-mode-split` at viewport 1280 (≥ md); asserts composer `send-button` right edge stays within `split-chat-pane` bounds, `overflow-button` (`⋯`) never renders, and the action button ends `composer-settings-row` (not `composer-input-row`).

Second describe uses a synthetic streaming bridge (`helpers/composer-bridge.ts`) and pins the composer card content width: E7 (flips at 880/640/420 ±1 px: after-turn label, status word sr-only, delivery chip → `＋` radios), E21 (longest model id ellipsis + toolbar `scrollWidth ≤ clientWidth` at 881/421), F21 (status word clipped but exposed at 375, shape visible), X10 (injected 44 px toolbar action next to Stop at 375 does not overflow), X11 (32 px root: label folds at 880, toolbar fits). See change: add-composer-dock.
