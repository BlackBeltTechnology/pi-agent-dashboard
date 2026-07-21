## Why

Session file changes can survive a failed tool call while the Changes view loses the failure context or classifies the files as unrelated working-tree changes. The gap affects provider-specific tool names such as Codex `apply_patch` and Grok `Shell`, even though pi already exposes provider-neutral `toolCallId`, `isError`, `result`, and `details` data.

## What Changes

- Correlate file-affecting `tool_execution_start` and `tool_execution_end` events by `toolCallId`.
- Preserve files changed before a tool failure, including partial patch results and failed shell operations.
- Normalize standard pi failures and structured `partial_failure` results without parsing provider error prose.
- Recognize shipped file-mutation tool families and aliases, including Write/Edit, shell, string-replace, and patch tools.
- Add failure metadata to the additive session-diff response contract.
- Show associated failures in the Changes view and mark affected files without attributing unrelated failures by timestamp proximity alone.
- Keep general model/provider errors and non-file tool failures in the existing chat error surfaces.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `session-diff-extraction`: Retain and correlate file-affecting tool failures across live and replayed session events.
- `change-summary-table`: Render associated failed operations and affected-file status in the shared Changes view.

## Discipline Skills

`security-hardening`, `doubt-driven-review`

## Impact

- Shared: additive session-diff failure types in `packages/shared/src/diff-types.ts`.
- Server: provider-neutral lifecycle correlation and path attribution in `packages/server/src/session-diff.ts`.
- Client: diff refresh signal, Changes tree failure section, affected-file badges, and localized labels.
- Tests: live/replay-equivalent errors, partial patch results, tool aliases, false-attribution guards, and rendered Changes behavior.
- Provider packages: no required changes to `pi-codex-conversion` or `pi-grok-cli`; dashboard consumes their existing pi events and structured results.
