---
name: pi-dashboard-control
description: Control the local pi-dashboard over its REST API with curl - list pi sessions, send a prompt, abort a run, spawn a session. Use after pi-dashboard-bootstrap has printed BASE, whenever the user wants to see or steer pi sessions.
---

# Control pi sessions through the dashboard

Run `pi-dashboard-bootstrap` first and use its literal `BASE` (for example `http://localhost:8000`).
REST is the command path. Full endpoint list: [references/api-reference.md](references/api-reference.md).

```bash
curl -s BASE/api/health
curl -s BASE/api/sessions
curl -s -X POST BASE/api/session/ID/prompt -H 'Content-Type: application/json' -d '{"text":"run the tests"}'
curl -s -X POST BASE/api/session/ID/abort -H 'Content-Type: application/json' -d '{}'
curl -s -X POST BASE/api/session/spawn -H 'Content-Type: application/json' -d '{"cwd":"/path/to/project"}'
```

Take `ID` from `GET /api/sessions`. Replace `BASE` with the literal URL every time.

## When a call is refused

A `401`, or a `403` with `"reason":"local_proof_required"`, means the dashboard needs a token.
Ask the user to run:

```bash
pi-dashboard token create --label claude-code --tier control
```

`control` covers prompt, spawn and abort. Ask for a higher tier only if the user explicitly wants one.

Preferred: the user saves the line `Authorization: Bearer <token>` in a file they create with
owner-only permissions and tells you its path. Never create that file yourself. Send every
credentialed request in the same command as a verification, so credentials only reach a verified dashboard:

```bash
sh "${CLAUDE_SKILL_DIR}/../pi-dashboard-bootstrap/scripts/ensure-dashboard.sh" --check && curl -s -H @/path/to/header-file BASE/api/sessions
```

Otherwise accept a token the user pastes, send it only as an `Authorization: Bearer` header, and
never write it to a file or repeat it in output. Tell the user it then stays in the conversation history.

Never add curl verbose or trace options to credentialed requests: they print the header.
