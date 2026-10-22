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

## View a session in the browser

To show a session to the user, list sessions and open that row's `uiUrl` (or `diffUrl` for the changes view) in your browser pane:

```bash
curl -s BASE/api/sessions
```

1. Use the full `id`, or the row's `uiUrl` / `diffUrl`, exactly as listed. Never shorten the id: build `BASE/session/<full id>` only when you have no `uiUrl`. When auth is on, this listing follows the token rules in "When a call is refused" below. The sign-in in the pane is separate and gives you no token.
2. Add `?embed=1` for a narrow pane: the page then shows the session without the session list.
3. If the page asks to sign in, ask the user to sign in inside the pane. Never put a token or any credential in a URL.
4. "Session not found" means a wrong, shortened or archived id: list again and use a full id. A session that is no longer listed is in `GET /api/sessions/archived` (50 per page: while the response has a `nextCursor`, request the next page with `?cursor=<nextCursor>` until you find it): open `BASE/session/<full id>?archived=1`.

Other pages (folders, OpenSpec board and archive) are listed in the "UI routes (browser)" section of [references/api-reference.md](references/api-reference.md).

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
