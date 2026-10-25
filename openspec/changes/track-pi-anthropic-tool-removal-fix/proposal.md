# Track the upstream pi fix for Anthropic `tool_reference_unresolved`

Watch-only change. No code in this repo changes. It records an upstream bug, the
local workaround, and the steps to remove the workaround once pi ships a fix.

## Why

pi-ai 1.4.0 (`anthropic-messages`, models with
`compat.supportsMidConvoToolChanges: true`) sends a `tool_removal` block for a
tool that was declared only in the top-level `tools` list. Anthropic rejects it:

```
400 invalid_request_error: messages.N.content.1: tool_addition/tool_removal
references unknown tool 'gmail_accounts' (error_code: tool_reference_unresolved)
```

The removal is persisted in the session, so every later request fails and the
session is unusable.

Trigger seen on 2026-10-24: a dashboard plugin reload dropped 13 tools
(`gmail_*` and three `browser_*` tools) mid-session in session
`01a15ea2-b85c-7008-a78a-e3483ea7f50b`.

- Upstream issue: https://github.com/earendil-works/pi/issues/11376
- Related upstream: #11157 (open, p0; its fix puts more sessions on this path,
  heads-up comment posted), #10954 (different 400 on the same path).

## Local workaround (in place)

`~/.pi/agent/models.json` →
`providers.anthropic.modelOverrides.<id>.compat.supportsMidConvoToolChanges = false`
for: `claude-fable-5`, `claude-fable-5-1`, `claude-haiku-5-5`,
`claude-opus-4-8`, `claude-opus-5`, `claude-opus-5-5`, `claude-sonnet-5-5`.

- Backup taken before the edit: `~/.pi/agent/models.json.bak-20261024180228`.
- Cost: the prompt cache is lost on every tool-set change.
- Scope: user-global config, not in git. Affects every session on this machine.

## What Changes

Nothing in this repo until the fix ships. Then:

- Remove the 7 overrides (keep any unrelated `models.json` content).
- Confirm with the repro in `tasks.md` that native tool changes work again.
- Archive this change.

## Fixed when

All of these hold on the installed pi:

1. #11376 is closed as completed (or a linked PR is merged), and
2. the `@earendil-works/pi-ai` CHANGELOG mentions the fix, and
3. the repro in `tasks.md` passes **without** the override.

Point 3 is the deciding check. Closed issues alone are not proof.

## Impact

- Code: none.
- Config: `~/.pi/agent/models.json` (local only).
- Compatibility: removing the override before the fix ships brings the bug back
  for any session whose tool set shrinks. Rollback = restore the override (or the
  backup file).

## Out of Scope

- Dashboard auto-retry still retries a deterministic 400 (`pi-dashboard:retry`).
  Track as a separate change if wanted.
- Why a plugin reload changed the Gmail tool set (10 tools → 3 different ones).

## Discipline Skills

None apply. No code, endpoint, auth or data path changes; the only step is a
reversible local config edit verified by a repro.
