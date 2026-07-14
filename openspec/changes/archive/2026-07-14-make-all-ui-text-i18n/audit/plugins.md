# Plugin i18n Audit

Audit date: 2026-07-14

**i18n system**: `packages/client/src/lib/i18n.tsx` — exports `t()` / `useI18n()` / `i18nT()`

**Scan method**: JSX text content (`>Text<`), attributes (`title`, `placeholder`, `aria-label`, `alt`), message calls (`confirm()`, `throw new Error()`, `toast()`). Filtered for CSS class/URL/code-identifier noise.

---

## Zero-Coverage Plugins

**ALL 8 plugin packages have zero i18n imports.** No plugin file references `lib/i18n`, `useI18n`, or `i18nT`.

| Plugin | Files scanned | Untranslated strings | Severity |
|--------|:------------:|:--------------------:|:--------:|
| `automation-plugin` | 7 | ~40 | All UI visible to end users |
| `dashboard-plugin-runtime` | 8 | ~12 | Developer error messages, slot labels |
| `flows-anthropic-bridge-plugin` | 1 | ~8 | Status table, labels, legend text |
| `flows-plugin` | 22 | ~50 | Dashboard, settings, dialogs, tool renderers |
| `goal-plugin` | 9 | ~35 | Claim UI, form labels, settings, confirm dialogs |
| `kb-plugin` | 4 | ~10 | Settings panel, source management |
| `roles-plugin` | 2 | ~15 | Settings section, role CRUD, confirm dialogs |
| `subagents-plugin` | 5 | ~8 | Detail view, settings, popout page |

**Estimated total: ~180 untranslated user-facing strings** across 53 source files.

---

## Detailed Findings

### automation-plugin (`packages/automation-plugin/src/client/`)

| File:Line | Category | String |
|-----------|----------|--------|
| `AutomationBoard.tsx:192` | JSX-text | `Automations` |
| `AutomationBoard.tsx:226` | JSX-text | `Definitions` |
| `AutomationBoard.tsx:228` | JSX-text | `No automations in this folder.` |
| `AutomationBoard.tsx:252` | JSX-text | `Recent runs` |
| `AutomationBoard.tsx:122` | confirm | `Delete automation "{name}"?` |
| `AutomationSettings.tsx:95` | JSX-text | `Automations` |
| `AutomationSettings.tsx:96` | JSX-text | `Plugin settings apply globally across all repos.` |
| `AutomationSettings.tsx:100` | JSX-text | `Default run visibility` |
| `AutomationSettings.tsx:107` | JSX-text | `hidden (off the board, watch in Automations)` |
| `AutomationSettings.tsx:108` | JSX-text | `shown (render as a normal board card)` |
| `AutomationSettings.tsx:113` | JSX-text | `Run retention (keep last N per automation)` |
| `AutomationSettings.tsx:145` | JSX-text | `Default model (fallback for unresolved @role)` |
| `AutomationRunMonitor.tsx:73` | JSX-text | `Findings` |
| `CreateAutomationDialog.tsx:403` | title | `Identity` |
| `CreateAutomationDialog.tsx:435` | title | `Trigger` |
| `CreateAutomationDialog.tsx:477-507` | JSX-text | Day/month labels (`hourly`, `daily`, `weekly`, `Mon`–`Sun`) |
| `CreateAutomationDialog.tsx:567` | JSX-text | `Select one or more event types:` |
| `CreateAutomationDialog.tsx:600` | title | `Action` |
| `CreateAutomationDialog.tsx:738` | JSX-text | `local` |
| `CreateAutomationDialog.tsx:756-758` | JSX-text | `skip` / `queue` / `parallel` |
| `CreateAutomationDialog.tsx:769-771` | JSX-text | `read-only` / `workspace-write` / `full-access` |
| `CreateAutomationDialog.tsx:784-786` | JSX-text | `use settings default` / `hidden` / `shown` |
| `CreateAutomationDialog.tsx:936` | aria-label | `Filter actions` |
| `CreateAutomationDialog.tsx:942` | JSX-text | `No actions match "{search}". Try a plugin (flows) or verb (run).` |
| `FolderAutomationSection.tsx:66` | title | `Open automation board` |
| `FolderAutomationSection.tsx:84` | title | `Refresh` |

### dashboard-plugin-runtime (`packages/dashboard-plugin-runtime/src/`)

| File:Line | Category | String |
|-----------|----------|--------|
| `plugin-context.tsx:179` | throw | `Slot consumer must be rendered inside <PluginContextProvider>` |
| `plugin-context.tsx:196` | throw | `Slot consumer must be rendered inside <PluginContextProvider>` |
| `plugin-context.tsx:203` | throw | `Slot consumer must be rendered inside <PluginContextProvider>` |
| `plugin-context.tsx:268` | throw | `Slot consumer must be rendered inside <PluginContextProvider>` |
| `plugin-context.tsx:319` | throw | `Slot consumer must be rendered inside <PluginContextProvider>` |
| `plugin-context.tsx:327` | throw | `usePluginLogger must be called from a plugin slot contribution` |
| `plugin-context.tsx:335` | throw | `Slot consumer must be rendered inside <PluginContextProvider>` |
| `plugin-context.tsx:342` | throw | `Slot consumer must be rendered inside <PluginContextProvider>` |
| `plugin-context.tsx:357` | throw | `Slot consumer must be rendered inside <PluginContextProvider>` |
| `ui-primitive-context.tsx:36` | throw | `useSlotContext must be used within a SlotContextProvider` |
| `ui-primitive-context.tsx:79` | throw | `useSlotContent must be used within a SlotContentProvider` |
| `shell-sessions-context.tsx:46` | throw | `useShellSessions must be used within a ShellSessionsProvider` |

### flows-anthropic-bridge-plugin (`packages/flows-anthropic-bridge-plugin/src/`)

| File:Line | Category | String |
|-----------|----------|--------|
| `client.tsx:101` | JSX-text | `flows-anthropic-bridge` |
| `client.tsx:105` | JSX-text | `Forwards @pi/anthropic-messages hooks into every pi-flows` |
| `client.tsx:155` | JSX-text | `PID` |
| `client.tsx:156` | JSX-text | `Status` |
| `client.tsx:183` | JSX-text | `Gate overrides` |
| `client.tsx:193` | JSX-text | `(sets PI_ANTHROPIC_MESSAGES_FORCE_CANONICAL)` |
| `client.tsx:203` | JSX-text | `Disable bridge entirely (sets PI_ANTHROPIC_MESSAGES_DISABLE_CANONICAL)` |

### flows-plugin (`packages/flows-plugin/src/client/`)

| File:Line | Category | String |
|-----------|----------|--------|
| `FlowActivityBadge.tsx:60` | title | `Abort running flow` |
| `FlowActivityBadge.tsx:20` | label | `error` (status labels) |
| `FlowAgentCard.tsx:84` | error | `No source path recorded for this agent.` |
| `FlowAgentCard.tsx:98` | error | `Failed to read source` |
| `FlowAgentCard.tsx:117` | error | `No handler target recorded for this node.` |
| `FlowAgentCard.tsx:131` | error | `Failed to read handler` |
| `FlowAgentCard.tsx:362` | JSX-text | `Details` |
| `FlowAgentDetail.tsx:91` | JSX-text | `Summary` |
| `FlowDashboard.tsx:197` | title | `Toggle autonomous mode` |
| `FlowDashboard.tsx:205` | title | `Abort flow` |
| `FlowInputWiring.tsx:150` | JSX-text | `Inputs` |
| `FlowInputWiring.tsx:230` | JSX-text | `Bind trigger to pass the fired file path · literal for a fixed typed value · leave an optional` |
| `FlowLaunchDialog.tsx:63` | placeholder | `Describe the task (optional)...` |
| `FlowQuestionCard.tsx:64` | title | `Dismiss` |
| `FlowSummary.tsx:19` | label | `complete` |
| `FlowSummary.tsx:20` | label | `failed` |
| `FlowSummary.tsx:21` | label | `aborted` |
| `FlowWriteToolRenderer.tsx:85` | JSX-text | `Flow graph` |
| `FlowWriteToolRenderer.tsx:93` | JSX-text | `Result` |
| `FlowYamlPopoverButton.tsx:56` | error | `Failed to read flow YAML` |
| `FlowYamlPreview.tsx:54` | title | `Back` |
| `FlowsCommandRoutes.tsx:106` | title | `Flows` |
| `FlowsCommandRoutes.tsx:108` | placeholder | `Search flows...` |
| `FlowsCommandRoutes.tsx:194` | title | `Edit Flow` |
| `FlowsCommandRoutes.tsx:196` | placeholder | `Search flows...` |
| `FlowsCommandRoutes.tsx:229` | title | `Delete Flow` |
| `FlowsCommandRoutes.tsx:231` | placeholder | `Search flows...` |
| `FlowsSettings.tsx:42` | JSX-text | `Flows` |
| `FlowsSettings.tsx:55` | JSX-text | `Edit mode` |
| `SessionFlowActions.tsx:131` | title | `Run Flow` |
| `SessionFlowActions.tsx:133` | placeholder | `Search flows...` |
| `SessionFlowActions.tsx:159` | title | `New / Edit flow` |
| `SessionFlowActions.tsx:161` | placeholder | `Pick a flow to edit, or + New flow…` |
| `SessionFlowActions.tsx:189` | title | `Delete Flow` |
| `SessionFlowActions.tsx:191` | placeholder | `Search flows...` |

### goal-plugin (`packages/goal-plugin/src/client/`)

| File:Line | Category | String |
|-----------|----------|--------|
| `CreateGoalDialog.tsx:55` | title | `Close` |
| `CreateGoalDialog.tsx:56` | aria-label | `Close dialog` |
| `FolderGoalsSection.tsx:37` | title | `Open goals board` |
| `FolderGoalsSection.tsx:45` | title | `Refresh` |
| `GoalControl.tsx:49` | title | `Pause loop` |
| `GoalControl.tsx:58` | title | `Open this session's goal` |
| `GoalDetailClaim.tsx:128` | title | `Back` |
| `GoalDetailClaim.tsx:141` | title | `Refresh` |
| `GoalDetailClaim.tsx:207` | JSX-text | `Turns` |
| `GoalDetailClaim.tsx:216` | JSX-text | `Spend` |
| `GoalDetailClaim.tsx:227` | JSX-text | `Criteria` |
| `GoalDetailClaim.tsx:244` | placeholder | `Add criterion / subgoal…` |
| `GoalDetailClaim.tsx:258` | JSX-text | `Judge verdicts` |
| `GoalDetailClaim.tsx:260` | JSX-text | `No verdicts recorded yet.` |
| `GoalDetailClaim.tsx:300` | JSX-text | `No other running sessions in this folder.` |
| `GoalDetailClaim.tsx:315` | JSX-text | `No sessions linked yet.` |
| `GoalDetailClaim.tsx:329` | title | `Open chat` |
| `GoalDetailClaim.tsx:338` | title | `Unlink` |
| `GoalDetailClaim.tsx:97` | confirm | `Delete goal "{objective}"? Linked sessions are unlinked.` |
| `GoalForm.tsx:114` | JSX-text | `Objective` |
| `GoalForm.tsx:120` | placeholder | `Goal objective…` |
| `GoalForm.tsx:128` | JSX-text | `Acceptance criteria` |
| `GoalForm.tsx:138` | title | `Remove` |
| `GoalForm.tsx:148` | JSX-text | `Max turns` |
| `GoalForm.tsx:159` | JSX-text | `Judge model` |
| `GoalForm.tsx:170` | JSX-text | `Extension default` |
| `GoalsBoardClaim.tsx:120` | title | `Delete goal` |
| `GoalsBoardClaim.tsx:170` | confirm | `Delete goal "{objective}"? Linked sessions are unlinked.` |
| `GoalsBoardClaim.tsx:183` | title | `Back` |
| `GoalsBoardClaim.tsx:189` | title | `Refresh` |

### kb-plugin (`packages/kb-plugin/src/client/`)

| File:Line | Category | String |
|-----------|----------|--------|
| `KbSettingsPanel.tsx:79` | title | `Remove` |
| `KbSettingsPanel.tsx:90` | placeholder | `add glob…` |
| `KbSettingsPanel.tsx:123` | JSX-text | `No config.` |
| `KbSettingsPanel.tsx:215` | JSX-text | `Sources` |
| `KbSettingsPanel.tsx:232` | title | `Move up` |
| `KbSettingsPanel.tsx:235` | title | `Move down` |
| `KbSettingsPanel.tsx:238` | title | `Remove` |
| `KbSettingsPanel.tsx:261` | JSX-text | `Include` |
| `KbSettingsPanel.tsx:265` | JSX-text | `Exclude` |
| `KbSettingsPanel.tsx:269` | JSX-text | `DB path` |

### roles-plugin (`packages/roles-plugin/src/`)

| File:Line | Category | String |
|-----------|----------|--------|
| `RolesSettingsSection.tsx:280` | throw | `No live pi session to apply role changes` |
| `RolesSettingsSection.tsx:292` | confirm | `Discard unsaved role changes?` |
| `RolesSettingsSection.tsx:340` | confirm | `Remove custom role @{role}? This deletes it from every preset.` |
| `RolesSettingsSection.tsx:395` | aria-label | `unsaved` |
| `RolesSettingsSection.tsx:414` | aria-label | `Remove custom role @{role}` |
| `RolesSettingsSection.tsx:415` | title | `Remove custom role @{role}` |
| `RolesSettingsSection.tsx:459` | placeholder | `custom-role-name…` |
| `RolesSettingsSection.tsx:467` | title | `Pick a model for this role` |
| `RolesSettingsSection.tsx:475` | aria-label | `Cancel add custom role` |
| `RolesSettingsSection.tsx:590` | placeholder | `preset name…` |

### subagents-plugin (`packages/subagents-plugin/src/client/`)

| File:Line | Category | String |
|-----------|----------|--------|
| `SubagentDetailView.tsx:143` | JSX-text | `Result` |
| `SubagentPopoutPage.tsx:64` | JSX-text | `Parent session not found` |
| `SubagentPopoutPage.tsx:89` | title | `Back` |
| `SubagentPopoutPage.tsx:114` | title | `Back` |
| `SubagentsSettings.tsx:46` | throw | `HTTP {status}: {body or statusText}` |
| `SubagentsSettings.tsx:60` | JSX-text | `Settings for the pi-dashboard-subagents producer.` |
| `SubagentsSettings.tsx:78-81` | JSX-text | Instructions about Roles plugin, Explore agent, @fast role |
