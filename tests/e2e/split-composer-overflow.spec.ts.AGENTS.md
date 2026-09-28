# split-composer-overflow.spec.ts — index

Browser E2E gate for `fix-split-composer-overflow`. Opens `layout-mode-split` at viewport 1280 (≥ md); asserts composer `send-button` right edge stays within `split-chat-pane` bounds + toolbar folds to `overflow-button` (`⋯`). Container-query fold discriminator.

Asserts the send button sits in `composer-input-row`, not `composer-settings-row`. See change: redesign-composer-session-strip.
