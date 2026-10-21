# chat-pane-below-floor-allocation.spec.ts — index

Browser E2E for below-floor chat pane allocation (change: define-chat-pane-below-floor-allocation). Verifies shrinkable rows, deficit sharing, and fixed row preservation.

Row summary (formerly inline in `tests/e2e/AGENTS.md`): L3 below-floor chat pane allocation.

add-composer-dock: fixed `composer-context-strip` probe → 0 px `composer-stack-anchor`; new #F13 (pane = floor sum − 50 px with YOLO + a Context lane: footer 32 px and card inside the pane, lane region scrolls, transcript ≥ its 16 px bound). See change: add-composer-dock.
