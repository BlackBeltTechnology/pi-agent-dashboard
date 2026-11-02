## Why

pi-flows builds each flow agent with an in-memory resource loader that holds only its guard extension plus factories announced on `pi.events` `flow:register-agent-extension` (pi-flows `extensions/flow-engine/execution.ts:396-437`). It never loads the settings packages, so the dashboard extension's Claude compat rewrite never reaches a flow agent. `seed-claude-compat-on-upgrade` removed the flows-plugin announce assuming otherwise, and flow agent steps on `anthropic` models (e.g. an `@coding` Apply node) now fail with "You're out of extra usage" while the switch is on.

## What Changes

- The flows-plugin bridge announces one stable `claudeCompatExtension` factory on `flow:register-agent-extension` when it activates and on every `session_start` (pi-flows dedupes by reference and may re-seed its list on `/reload`).
- The factory reads the switch from the dashboard bridge's process-global state (`claudeSubscriptionCompat`, mirrored on `preferences_update`) and judges each agent by its own model.
- Plugin code only. No change to pi-flows, the dashboard extension, the server or the client.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `claude-subscription-compat`: the "Flow agents receive the same rewrite" requirement names how flow agents receive the rewrite (pi-flows' agent-extension registration, from the flows plugin).

## Impact

- `packages/flows-plugin/src/bridge/index.ts` — announce + module-level factory.
- Test: `packages/flows-plugin/src/bridge/__tests__/flow-agent-compat.test.ts`.
- `packages/flows-plugin/src/bridge/AGENTS.md` row; CHANGELOG `[Unreleased]`.

## Discipline Skills

None apply: no auth, untrusted input, secrets, endpoint, latency budget or irreversible step.
