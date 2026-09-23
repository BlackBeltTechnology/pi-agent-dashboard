# bus-client-goal-plugin-action.spec.ts — index

L3/P1 (change: add-dashboard-bus-client-scripting). Drives `BusClient` from host against the harness (port from `.pi-test-harness.json`): connect, spawn (spawn_result + new-session poll), `plugin("goal",…)` no-throw/no-drop, `plugin("flows",…)`→NoPluginHandlerError. Needs `PI_SPAWN_STRATEGY=headless`.

Row summary (formerly inline in `tests/e2e/AGENTS.md`): L3/P1 `BusClient` host scripting (add-dashboard-bus-client-scripting).
