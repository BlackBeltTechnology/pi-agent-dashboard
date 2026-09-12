# ask-user-tool.ts — index

Register `ask_user` pi tool at `session_start` (avoids static-name conflict). Exports `registerAskUserTool`. Methods `confirm`/`select`/`multiselect`/`input`/`batch`; flat root JSON-Schema object keeps OpenAI strict-mode happy; per-method validation enforced at runtime in `execute`. CWD-INDEPENDENT: pure `ctx.ui` interaction — resolves no filesystem path, spawns no process, never reads `ctx.cwd` (starts-with-cwd audit result, change: update-pi-core-0-85-adopt-apis task 5.1).
