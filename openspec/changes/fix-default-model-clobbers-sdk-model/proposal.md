## Why

The bridge checks only `--model` before applying the Dashboard default. Native SDK launches do not carry that flag, so a pi-subagents reviewer can start on its requested model and then switch to the Dashboard default before its prompt.

## What Changes

- Keep the existing argv guard and suppress the Dashboard default when `PI_SUBAGENT_CHILD` is present.
- Capture the startup session model before asynchronous bridge setup. Suppress the Dashboard default when that model differs from the complete `defaultProvider` / `defaultModel` pair in `~/.pi/agent/settings.json`.
- Keep the message-history, reason, registry, deferred-provider retry, and coupled thinking-level rules.
- Document the approved limitation: an unmarked arbitrary SDK caller choosing exactly Pi's configured default remains indistinguishable from an automatic choice.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `bridge-default-model-gate`: expand the explicit-model guard to SDK startup signals.
- `bridge-extension`: qualify the existing brand-new default behavior with the same startup signals.

## Impact

Changes stay within the bridge gate, startup wiring, regression tests, current specs, and documentation. No dependency, protocol, schema, global settings, installed package, or shared lifecycle change. This extends archived `fix-default-model-clobbers-explicit-model`; it does not replace its argv behavior.

## Discipline Skills

- `review-code`: focused correctness and regression review before commit.
- `code-simplifier`: task-owned simplification review after passing tests.
- No authentication, new endpoint, or performance-budget changes.
