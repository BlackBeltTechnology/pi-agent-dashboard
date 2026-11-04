# DOX — packages/client/src/components

Root-level components foldered into per-domain subfolders (each owns its files via its own `AGENTS.md`; tree is walked, no per-subfolder pointer rows). See change: fold-oversized-agents-directories.
| `__tests__/ClaudeCompatUninstallNotice.test.tsx` | #E14: switch on/off × installed scoped/legacy/fork/none; dismissal survives remount; exact normalized name match. See change: retire-anthropic-messages-bridge. |
| `AgentSelect.tsx` | Labelled native agent select bound to folder memory; renders nothing without agents. Used by DirectoryHomeView + WorktreeSpawnDialog. See change: add-acp-session-driver. |
| `AgentSpawnPicker.tsx` | Split button (APG menu button). Chevron always rendered. Menu = agent radios (only when ACP agents) + lazy `SpawnChoiceChip` menu item (disabled under ACP agent; item focusable until the chip loads; keeps the chip off the landing chunk). Main spawns remembered agent, else pi with `getEffectiveSpawnChoice(cwd)` (`onSpawn(agent?, choice?)`; no args when nothing to carry). Choosing never spawns. Keys Arrow/Home/End/Enter/Esc; ArrowDown on chevron opens; document Escape closes when focus drifted. See changes: add-acp-session-driver, add-spawn-model-choice. |
| `__tests__/AddFoldersDialog.test.tsx` | onPin carries piTrust. See change: mirror-dashboard-trust-to-pi. |
