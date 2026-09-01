# pi-changelog-routes.ts — index

`GET /api/pi-core/changelog?pkg&from&to`. Whitelist-validates `pkg` against `CORE_PACKAGE_NAMES`. Bootstrap-gated (503 unless ready). 200 + empty release list when CHANGELOG missing. See change: pi-update-whats-new-panel.
