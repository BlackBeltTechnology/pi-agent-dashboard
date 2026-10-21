# project-access/SKILL.md — index

Bundled skill: map, suggest and request folder access for a project. Propose-only; operator approves per line in dashboard. Server URL discovery as `pi-dashboard` skill (config.json port, default 8000).
Profile `.pi/access.json` v1 `{version:1, folders:[{path, why?}], remote?:["lan"|"internet"|"device"]}`; ≤32 lines; unknown version → refuse; server never reads it.
`map`: read-only. Sources: `GET /api/sessions` (session roots), `/api/access/grants` (covering grants + how created: `via` provision/prompt/agent-prompt/absent=Access page), `/api/access/prompts` (YOLO, prompting), `/api/access/pi-trust`, `/api/config` `agentPathGate`; always states `bash` not gated.
`suggest`: draft profile from grants whose `origin` = project root or a session id with cwd in root; states skipped (`unknown` origin) count + "may be partial" when sessions API unreachable BEFORE `ask_user` confirm to write.
`provision`: `POST /api/access/provision` `{projectRoot, lines, remote?}`; refusal table (`empty` `too-many-lines` `invalid-root` `no-operator` `prompting-disabled` `report-mode` `disabled` `pending-exists` `capacity` `rate-limited` `cooldown`); polls `GET /api/access/provision/:id` to non-`pending`; 404 → "unknown — check Settings ▸ Access"; reports each line outcome.
States consent-not-containment + machine-wide reach. Never calls `/settle` or `/dismiss-all`; never writes `access-grants.json`.
Registered: `packages/extension/package.json` `pi.skills` + `files`. Guard: `packages/extension/src/__tests__/project-access-skill-text.test.ts`. See change: add-access-provisioning.
