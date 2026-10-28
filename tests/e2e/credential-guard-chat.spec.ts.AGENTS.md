# credential-guard-chat.spec.ts — index

L3 F5 agent credential guard in chat. Path gate enabled (`PUT /api/config`); faux `tool-read-credentials` reads `~/.pi/agent/plugin-credentials.json`. Asserts: burst `data-running=false` + `tool-burst-failed-badge`, result text `credential_guard` on the card (toPass expands burst/member only while text hidden), path-gate card ("outside its workspace") never rendered (MutationObserver flag `__gateSeen` + final count 0), turn settles (no `stop-button`, `send-button` visible, no running burst). See change: encrypt-credentials-at-rest.
