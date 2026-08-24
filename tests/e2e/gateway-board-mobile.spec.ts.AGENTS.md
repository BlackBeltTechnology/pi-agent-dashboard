# gateway-board-mobile.spec.ts — index

6.8/6.9 (D11) — the readiness board at 375×667: one 52px line per row, no horizontal overflow, ≥44px targets, state label ≥4.5:1 in both themes. jsdom has no layout engine, so every number here is vacuous below this level. Seeds display prefs via PATCH — the first-launch modal renders async at 375 and deadlocks against a dialog of our own. `color-mix()` resolves to `color(srgb …)` with 0..1 channels, NOT `rgb()`. See change: add-zrok-custom-reserved-name.
