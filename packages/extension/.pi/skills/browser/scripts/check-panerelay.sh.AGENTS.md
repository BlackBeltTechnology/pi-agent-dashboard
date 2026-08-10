# browser/scripts/check-panerelay.sh — index

AUTHORED. Dependency-free Panerelay diagnostic. Emits key=value (`AGENT_BROWSER`, `VERSION_OK`, `PLUGIN`, `GLOBAL_DEFAULT`, `NATIVE_HOST`, `EXTENSION`, `TABS`, `READY`) plus a single `NEXT=` action on failure. `--deep` adds `@panerelay/setup doctor`. Gates on CLI >= 0.33.0.

Step 5b: on probe failure, speaks `agent-browser.plugin.v1` `browser.launch` to the native host directly, because the CLI reports only `success=false` and drops the plugin's message. Distinguishes ambiguous-browser (emits `AMBIGUOUS_BROWSER=yes` + one `BROWSER_ID=` line per registration), host-healthy-CLI-hop-failed, and pass-through host errors from a genuinely disconnected extension. Session name defaults to `panerelay-check-$$` (unique per run) — daemons stick to their first-resolved browser; override via `PANERELAY_CHECK_SESSION`. Deliberately never calls `close --all` (not session-scoped).
