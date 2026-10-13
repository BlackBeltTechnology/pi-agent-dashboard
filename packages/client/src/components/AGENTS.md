# DOX — packages/client/src/components

Root-level components foldered into per-domain subfolders (each owns its files via its own `AGENTS.md`; tree is walked, no per-subfolder pointer rows). See change: fold-oversized-agents-directories.
| `AgentSelect.tsx` | Labelled native agent select bound to folder memory; renders nothing without agents. Used by DirectoryHomeView + WorktreeSpawnDialog. See change: add-acp-session-driver. |
| `AgentSpawnPicker.tsx` | Split button (APG menu button). No agents → today's plain button verbatim. Else main spawns the remembered agent, chevron opens radio menu (pi + agents); keys Arrow/Home/End/Enter/Esc. See change: add-acp-session-driver. |
