# __tests__/check-pi-settings-paths.test.mjs — index

Drives `absoluteSourceViolations`, `emptyFilterViolations` and `main([{file,raw}])` directly so detection is pinned independently of what `.pi/settings.json` holds. Negative cases carry the weight: `npm:`/`git:`/`https://`/`ssh://` sources, bare-string entries and `autoload:false` deltas must NOT be flagged. Pins hint routing: `CORRECTION` + `pi install` note only for absolute hits, once each; parse error reported once. See issue #371, change: fix-switch-source-empty-overlay.
