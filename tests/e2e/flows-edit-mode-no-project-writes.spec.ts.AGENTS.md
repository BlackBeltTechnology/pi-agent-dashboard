# flows-edit-mode-no-project-writes.spec.ts — index

L3 spec (change: stop-flows-edit-mode-project-writes). Real pi-flows >= 0.8.1 (Dockerfile `PI_FLOWS_VERSION`).
Container files via `docker exec` (`resolveContainer`): global `$HOME/.pi/agent/settings.json`, project `/fixtures/sample-git/.pi/settings.json`; both snapshotted (base64) in `beforeEach`, restored in `afterEach`.
F3: global `flows.editFlow:true` → fresh session, menu `New / Edit…`, reload twice → `git status --porcelain` + project settings bytes + `.pi/skills/manage-flows` unchanged.
F4: nothing set → menu shows `Turn on edit mode for this project`, no `New / Edit…` → `/settings/plugins/flows` `flows-edit-mode-toggle` → `save-btn` → global `flows.editFlow:true`, `New / Edit…` appears, no `send_prompt` frame, repo unchanged.
F5: global false, two sessions in fixture cwd → A `Turn on edit mode for this project` → project `flows.editFlow:true`; B menu `Turn off edit mode for this project` + `New / Edit…`; global bytes unchanged.
