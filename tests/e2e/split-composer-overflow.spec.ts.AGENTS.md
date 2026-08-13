# split-composer-overflow.spec.ts — index

Browser E2E gate for `fix-split-composer-overflow`. Opens `split-toggle` at viewport 1280 (≥ md); asserts composer `send-button` right edge stays within `split-chat-pane` bounds + toolbar folds to `overflow-button` (`⋯`). Container-query fold discriminator.
