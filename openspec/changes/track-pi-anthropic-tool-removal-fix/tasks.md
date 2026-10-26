# Tasks — track-pi-anthropic-tool-removal-fix

## 1. Check whether the fix shipped (repeat after each pi update)

- [ ] 1.1 Issue state:
  `gh issue view 11376 -R earendil-works/pi --json state,stateReason,closedAt`
- [ ] 1.2 Installed vs latest pi:
  `pi --version; npm view @earendil-works/pi-coding-agent version`
- [ ] 1.3 Changelog mention (installed copy):
  `grep -n -i "tool_removal\|tool_reference\|top-level tool" "$(npm root -g)/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/CHANGELOG.md"`
- [ ] 1.4 Code check: in `pi-ai/dist/api/anthropic-messages.js` `convertMessages`,
  `tool_removal` is no longer emitted for tools that are only in the top-level
  `params.tools` list.

Continue to section 2 only when 1.1–1.3 point to a fix.

## 2. Verify without the workaround

- [ ] 2.1 Repro dir `/tmp/pi-repro` (recreate if `/tmp` was cleared): `ext.ts`
  registers tool `foo` and removes it at the first `turn_end` via
  `pi.setActiveTools(...)`; `agent/` holds only `auth.json` + `settings.json`
  (no overrides). Full script is in issue #11376.
- [ ] 2.2 Run:
  `cd /tmp/pi-repro && PI_CODING_AGENT_DIR=/tmp/pi-repro/agent pi -ne -e ./ext.ts --model anthropic/claude-opus-5-5 --session-dir /tmp/pi-repro/sessions -p "Run 'echo one', then 'echo two', then 'echo three', then reply DONE."`
- [ ] 2.3 Pass = reply ends with `DONE`, no `tool_reference_unresolved`.

## 3. Remove the workaround

- [ ] 3.1 Back up `~/.pi/agent/models.json`, then delete
  `providers.anthropic.modelOverrides.<id>.compat.supportsMidConvoToolChanges`
  for the 7 models listed in `proposal.md`; drop empty objects.
- [ ] 3.2 Open `/model` (reloads `models.json`) and run one normal session turn.
- [ ] 3.3 Delete the failure memory about this bug, or mark it fixed with the pi version.
- [ ] 3.4 Archive this change.

## Rollback

Restore `~/.pi/agent/models.json.bak-20261024180228` (or re-add the overrides)
if any session hits `tool_reference_unresolved` again.
