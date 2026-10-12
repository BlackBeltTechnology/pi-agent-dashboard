# __tests__/check-pi-settings-paths.test.mjs — index

Drives `absoluteSourceViolations` directly (12 cases) so detection is pinned independently of what `.pi/settings.json` currently holds. Negative cases carry the weight: `npm:`/`git:`/`https://`/`ssh://` sources and the bare-string package form must NOT be flagged, else the guard is unusable. See issue #371.
