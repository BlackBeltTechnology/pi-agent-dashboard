---
name: project-access
description: 'Map, suggest and request the folder access a project needs. Three modes: `map` (read-only report of what this project''s sessions can already reach), `suggest` (draft `.pi/access.json` from grants this project''s sessions created), `provision` (submit the profile as a request the operator approves line by line in the dashboard). Use when an agent keeps getting folder access prompts, when asked "what folders can this project reach", "set up folder access", "which grants does this repo have", to write or submit `.pi/access.json`, or to retry access setup after project-init.'
license: MIT
metadata:
  author: pi-dashboard
  version: "1.0"
---

# Project Access

Work out which folders outside a project its agents need, and ask the dashboard
operator to approve them once, ahead of time, instead of one prompt per denial.

You only ever **propose**. The operator answers per line in the dashboard.
Nothing in this skill grants access, changes configuration, or answers for the
operator.

## Setup — server URL

Discover the server the way the `pi-dashboard` skill does (config `port`, default 8000):

```bash
PORT=$(grep -m1 '"port"' ~/.pi/dashboard/config.json 2>/dev/null | grep -o '[0-9]*'); PORT=${PORT:-8000}
BASE="http://localhost:$PORT"
curl -s "$BASE/api/health"
```

(`grep -m1` takes the top-level `port`; the config also nests other `port` keys.)

If health does not answer, say the dashboard is not running and stop (every mode
needs it, except reading `.pi/access.json`). When auth is enabled, pass the JWT
cookie as the `pi-dashboard` skill describes (`curl -b "pi_dash_token=…"`).

**Project root** = `git rev-parse --show-toplevel` from the cwd; when that
fails, the cwd if it holds a `.pi` directory. A root with neither `.git` nor
`.pi` is not a project: say so and stop.

## Profile — `.pi/access.json` (format v1)

Optional file in the project root. A **proposal only**: the dashboard server
never reads it, and the file alone grants nothing. Its contents take effect only
through an approved `provision` request.

```json
{
  "version": 1,
  "folders": [{ "path": "../shared-lib", "why": "sibling package used by tests" }],
  "remote": ["lan"]
}
```

- `folders[].path`: absolute, `~/`-rooted or relative to the project root.
  `why` is optional, plain text, shown to the operator (cut at 200 characters).
- `remote` (optional): any of `lan`, `internet`, `device`. A goal only points the
  operator at the Remote access dialog; nothing is configured for them.
- At most 32 folder lines.
- An unknown `version` (or a missing/non-numeric one): refuse. Say the file is
  not version 1, show the value found, and do not read or send any of it.

## Mode `map`

Read-only. It never writes a file, a grant or a configuration value. Report, for
the project root and each session cwd inside it (`GET $BASE/api/sessions`, rows
whose `cwd` lies in the root; if unreachable, say "session roots: unknown" and
use the project root alone):

1. **Covering grants** — `GET $BASE/api/access/grants` → `pathGrants`. A grant
   covers a folder when its `subject` equals it or is an ancestor. For each, say
   how it was created: `via: "provision"` = approved through a provisioning
   request for project `origin`; `via: "prompt"` = allow-always on an access
   dialog; `via: "agent-prompt"` = answered on an agent file-access prompt; no
   `via` = created from the Access page. Include `scope` and `grantedAt`.
   Also list `projectTrust` / `worktreeTrust` / `kbTrust` entries covering it.
2. **Profile coverage** — when `.pi/access.json` exists, resolve each folder and
   mark it covered / not covered by the grants above. A missing or non-directory
   path is reported as missing.
3. **YOLO** — `GET $BASE/api/access/prompts` → `data.yolo.session`: `null` (off)
   or `{source, expiresAt, unscoped, roots}`. Also `data.prompting` (is the
   operator being asked at all, and `blockers`).
4. **pi trust** — `GET $BASE/api/access/pi-trust` → `data.effective` entries
   covering the root (`sourceLabel`), else "not trusted by the dashboard mirror".
5. **Path-gate** — `GET $BASE/api/config` → `agentPathGate.enabled` (default on).
   `PI_DASHBOARD_AGENT_PATH_GATE=off|on` in the environment overrides it; report
   that value when set.
6. **`bash` is not gated.** Always say so: grants and the path gate cover the
   file tools, not shell commands, which run with the operator's own rights.

End with one line naming what could not be read. Every read that fails is
reported as unknown, never guessed.

## Mode `suggest`

Draft `.pi/access.json` from grants this project's sessions created.

1. Read `GET $BASE/api/access/grants` → `pathGrants`. A grant is **this project's**
   when its `origin` equals the project root, or `origin` is a session id whose
   `cwd` (from `GET $BASE/api/sessions`, best effort) lies in the root.
2. Count what you could not attribute: grants whose `origin` is `unknown`, and
   grants whose origin is a session id you could not resolve. Record whether the
   sessions API answered.
3. Drop grants whose subject lies inside the project root (they need nothing).
   Express the rest relative to the root when under its parent, else absolute.
   `why` = `"granted via <via or Access page> on <date>"`.
4. Show the draft. **Before you ask to write**, state the coverage gaps: "N
   grants were skipped (origin unknown)" and, when the sessions API did not
   answer, "the sessions API was unreachable, so this list may be partial". Say
   this even when N is 0 and the API answered ("nothing skipped").
5. `ask_user` (confirm) to write `.pi/access.json`. Only on yes, write it. An
   existing file is shown in full and needs its own overwrite confirmation.
   Declined → write nothing.

The draft uses `"version": 1`. Never include credential folders (`~/.ssh`,
`~/.pi`, `~/.aws`, `~/.gnupg`, `~/.kube`, `~/.docker`, `~/Library/Keychains`):
the dashboard refuses them, so tell the user you left them out.

## Mode `provision`

Submit the profile (or lines the user names) as one request, then follow it to
its end.

1. Build `lines` from `.pi/access.json` (apply the v1 rule above) or from the
   folders the user names. Show them and `ask_user` (confirm) before sending.
2. Submit with `POST $BASE/api/access/provision`:

   ```bash
   curl -s -X POST "$BASE/api/access/provision" -H 'Content-Type: application/json' \
     -d '{"projectRoot":"<root>","lines":[{"path":"../shared-lib","why":"…"}],"remote":["lan"]}'
   ```

   Success: `{ success: true, data: { requestId, status: "pending", projectRoot,
   lines:[{lineId, path, why, classification}], remote, expiresAt } }`. Tell the
   user the dashboard is asking, and report every line's `classification` and
   real `path`: `grantable` lines wait for the operator; `in-root` / `covered`
   need nothing; `invalid`, `missing`, `forbidden` and `sensitive` can never be
   approved here — say why.
3. Refused: `{ success: false, error, reason?, requestId?, retryAfterMs? }`.
   Explain it and stop; never loop or resubmit on your own.

   | `error` | Tell the user |
   |---|---|
   | `empty` / `too-many-lines` / `invalid-request` | Fix the profile (1–32 folder lines, or a remote goal). |
   | `invalid-root` (`reason`) | The project root is not absolute, missing, not a directory, forbidden (e.g. home), or has no `.git`/`.pi`. |
   | `no-operator` | Nobody can be asked: open the dashboard in a browser (signed in as operator), then retry with this skill. |
   | `prompting-disabled` | Prompting is turned off in Settings ▸ Access. |
   | `report-mode` | Host admission is in report mode, so the dashboard cannot ask. |
   | `disabled` | The grant prompt is switched off (`PI_DASHBOARD_DISABLE_GRANT_PROMPT`). |
   | `pending-exists` | A request for this project is already open (`requestId`): follow that one. |
   | `capacity` | The dashboard has too many open requests; try later. |
   | `rate-limited` | Too many requests; retry after `retryAfterMs`. |
   | `cooldown` | A recent request for this project ended with nothing approved; retry after `retryAfterMs`, and only if the user asks. |

4. Poll until terminal with `GET $BASE/api/access/provision/<requestId>`, every
   ~3 s (bounded: one tool call at most ~60 s, then tell the user you are still
   waiting and continue):

   ```bash
   curl -s "$BASE/api/access/provision/<requestId>"
   ```

   Keep going until `data.status` is not `pending` (`settled`, `dismissed` or
   `expired`; a request expires after 10 minutes at `data.expiresAt`). A **404**
   means the server restarted and forgot the request: report
   "unknown — check Settings ▸ Access" and stop; do not resubmit automatically.
5. Report **each line's** `outcome` and `reason` to the user:
   `granted` (readable by every session now), `rejected`, `changed` (the folder
   changed after the operator saw it), `refused` (e.g. `capacity`,
   `root-changed`), `failed`, and `handed-off` for a remote goal (the operator
   was pointed to the Remote access dialog; nothing was configured). `dismissed`
   = everything rejected; `expired` = nothing granted.

## Consent, not containment

Say this when you report a request, in your own words but without softening it:

- Approved folders become readable and writable by **every session on this
  machine** until the operator revokes them on the Access page.
- Approval is **consent, not containment**: it records what the operator allowed.
  It does not stop a program on this machine (an agent's `bash`, for one) from
  changing access by other means.
- The project name is the requester's claim; the operator sees the real paths.

## Notes

- **Never call** `POST /api/access/provision/<id>/settle` or `/api/access/provision/dismiss-all`. They are operator-only; an agent answering
  its own request defeats the point.
- **Never write or edit** `~/.pi/dashboard/access-grants.json`, the dashboard
  config, or any pi trust file to obtain access.
- Requests live in the server's memory only; a restart loses pending ones.
- Related: `project-init` offers this flow as an opt-in step after scaffolding.
