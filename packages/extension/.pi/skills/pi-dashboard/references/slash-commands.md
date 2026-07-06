# Pi Dashboard Slash Commands

Every `/dashboard:*` command, its arguments, what it does, and whether it runs
without the LLM. Templates live in [`../commands/`](../commands/).

- **LLM-free** = `executable: bash` frontmatter. Body runs as bash; output
  renders in chat; the LLM is never invoked. A footer "ℹ ran locally — LLM not
  invoked" appears beneath the output. These get `PI_DASHBOARD_PORT` /
  `PI_DASHBOARD_BASE` env injected.
- **LLM-bound** = no `executable` frontmatter. The body expands into a user
  message the LLM interprets (mutations needing judgment or free-form text).

Naming grammar: `/dashboard:<resource>-<verb>[-<modifier>]`. Resource is
singular. Files are `dashboard-<resource>-<verb>[-<modifier>].md`.

## LLM-free (read-only, no token cost)

| Command | Args | Does |
|---|---|---|
| `/dashboard:server-health` | — | Server pid + uptime. |
| `/dashboard:server-config` | — | Server config (secrets redacted). |
| `/dashboard:server-tunnel-status` | — | Tunnel status + public URL. |
| `/dashboard:session-list` | — | All sessions: id, status, name, cwd. |
| `/dashboard:session-list-active` | — | Streaming/active sessions only. |
| `/dashboard:session-list-here` | — | Sessions whose cwd == current dir. |
| `/dashboard:session-info` | `<id-prefix>` | Every field of the matched session. |
| `/dashboard:session-diff` | `<id-prefix>` | File changes (git diff) for the session. |
| `/dashboard:proposal-archive` | — | Archived OpenSpec changes for cwd (newest first). |
| `/dashboard:git-branches` | — | Git branches for cwd (current marked `*`). |
| `/dashboard:peer-list` | — | Known remote dashboard servers. |
| `/dashboard:peer-scan` | — | mDNS scan for peer servers on the network. |
| `/dashboard:pin-list` | — | Pinned directories. |

## LLM-bound (mutations / judgment)

| Command | Args | Does |
|---|---|---|
| `/dashboard:session-tell` | `<id-prefix> <text>` | Send a prompt to another session. |
| `/dashboard:session-abort` | `<id-prefix>` | Abort the session's current run. |
| `/dashboard:session-abort-all` | `[filter]` | Abort multiple running sessions (asks scope first). |
| `/dashboard:session-kill` | `<id-prefix>` | Shut down a session (DESTRUCTIVE; confirms). |
| `/dashboard:session-rename` | `<id-prefix> <name>` | Rename a session. |
| `/dashboard:session-hide` | `<id-prefix>` | Hide a session from the list. |
| `/dashboard:session-unhide` | `<id-prefix>` | Unhide a hidden session. |
| `/dashboard:session-spawn` | `[cwd]` | Spawn a new session (default cwd = current dir). |
| `/dashboard:session-resume` | `<id-prefix>` | Resume a session (continue mode). |
| `/dashboard:session-fork` | `<id-prefix>` | Fork a session into a new one. |
| `/dashboard:list-models` | `[annotated]` | List reachable models via `GET /api/models`; `annotated` adds `excludedReason`. Never file-parse. |
| `/dashboard:session-model` | `<id-prefix> <provider/modelId>` | Switch a session's model. |
| `/dashboard:session-thinking` | `<id-prefix> <level>` | Set a session's thinking level. |
| `/dashboard:proposal-attach` | `<id-prefix> <change-name>` | Attach an OpenSpec change to a session. |
| `/dashboard:proposal-detach` | `<id-prefix>` | Detach the OpenSpec change. |
| `/dashboard:flow-abort` | `<id-prefix>` | Abort the running flow. |
| `/dashboard:flow-auto` | `<id-prefix>` | Toggle autonomous mode for the flow. |
| `/dashboard:git-init` | `[cwd]` | git init in a directory (default current dir). |
| `/dashboard:git-stash-pop` | `[cwd]` | git stash pop in a directory (default current dir). |
| `/dashboard:server-tunnel-on` | — | Connect the public tunnel. |
| `/dashboard:server-tunnel-off` | — | Disconnect the public tunnel. |

## Notes

- **Quoting**: positional args for LLM-free commands are whitespace-split; v1
  does not honour quotes. Every LLM-free command takes simple identifiers, so
  this never bites. Free-form text (`session-tell`) is LLM-bound by design.
- **id-prefix**: any leading substring of a session id; the first match wins.
- **Disjoint from extension commands**: a `pi.registerCommand` extension
  command of the same name takes precedence (extension dispatch runs first).
