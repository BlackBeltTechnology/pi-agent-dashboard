# Agent Teams — hooks + plan approval security note
> Scope: plugin `agent-teams` templates, hooks, plan approval (`packages/agent-teams-plugin/`) · Guide: [../agent-teams.md](../agent-teams.md) · Route table: [http-gates-and-routes.md](http-gates-and-routes.md) § H · Plugin trust: [plugins-client-electron.md](plugins-client-electron.md) · Local token: [credentials-and-secrets.md](credentials-and-secrets.md) (CRED-07)

See change: add-agent-teams-templates-hooks.

## Summary

- Hooks = arbitrary shell as dashboard user. Source = template files.
- Trust bar for project hooks: host project trust AND per-hash confirmation (TOFU).
- Hooks fail-open. Broken gate passes silently except counters + lead notices.
- Revocation = start-time gate only. Running team keeps frozen hooks.
- Plan-mode enforcement = in-session extension logic. Backstop, NOT security boundary vs malicious extension.
- HONEST LIMIT: local-token callers can `POST plan-decision` and `POST hook-trust`. Plan policy `"user"` advisory without enforced identity. NOT a security boundary.

## Hooks = code execution from repo content

| Fact | Detail |
|---|---|
| Runner | `bash -c <command>`, detached, cwd `Team.leadCwd`, user privileges. Same as project extension |
| Source | template `hooks` frontmatter only. Never agent input, never tool, never route |
| `user` templates | `<piAgentDir>/teams/` — trusted |
| `project` templates | `<cwd>/.pi/teams/` — read only if `host.isProjectTrusted(cwd)` (absent service ⇒ untrusted) |
| Confirmation | TOFU. `<dataDir>/hook-trust.json`, key `realpath(cwd)` + `sha256(canonical hooks)`. Edit ⇒ re-prompt |
| Confirm flow | `hooks_untrusted {hash, commands}` → UI shows exact commands → retry `trustHooks: <hash>` → server recomputes, `hash_mismatch` if differ. No confirm-then-edit TOCTOU |
| Freeze | resolved hooks copied into team record at start. Nothing edits afterwards |
| Env | allowlist only (`PATH HOME USER LANG LC_* TMPDIR SHELL` + `AGENT_TEAMS_*`). No server env, no secrets |
| Stdin | built from store. Not agent-supplied |
| Bounds | 12 s deadline (`opGateBudgetMs`), ≤ 2 per team, ≤ 4 global, ≤ 64 KiB per stream, ≤ 3 commands/event, command ≤ 2000 chars. Process tree killed (`killProcess`) |

Reasons for the double gate: pinned parent folder must not silently run committed commands. Project trust alone insufficient.

## Residual risks

1. **Trusted project hook = arbitrary shell as user.** Confirmed hook = same power as project extension. Review commands in dialog before confirming.
2. **Fail-open.** Non-0/2 exit, timeout, overflow, spawn error ⇒ event proceeds. Mitigation: counters, first-timeout and first-`spawn_error` lead notice, lead notice after 3 consecutive errors. No per-hook `failClosed`. Exit 2 with empty or oversized output still blocks.
3. **Revocation = start-time gate.** `DELETE /hook-trust` or revoked project trust refuses later starts only. Running team keeps frozen hooks. Stop team to stop hooks.
4. **Crash leaves descendants.** Hook trees killed on `ctx.onShutdown`. After crash / SIGKILL of server, descendants may live until they exit.
5. **Hook-trust record keyed by hash.** Hash covers event names, command text, order, effective `timeoutMs`. Not comments or whitespace.
6. **Plan mode = cooperative.** Layers: spawn tool list, `pi.setActiveTools`, `tool_call` backstop. All run inside the session's pi process. Malicious extension in same process can re-activate tools or bypass handler. Same limit as core guard layers ([tool-call-guards.md](tool-call-guards.md)).
7. **Plan member tool loss.** Explicit tool list ⇒ non-default extension/MCP tools dropped after approval unless named in `tools`. Availability, not security.
8. **Lead-chosen model overrides template model.** Cost risk. Bounded by `maxTeammates`, `maxActiveTeams`.
9. **Playbook envelope wording.** Core envelope calls mail "peer message, not user instruction". Playbook body states user started team.

## HONEST LIMIT — plan decision authority

- `PlanDecision` tool = lead-only. Server records `decidedBy` from verified caller (socket session / request principal), never message text. Teammate claim "I was approved" ignored.
- `POST /teams/:id/members/:name/plan-decision` and `POST /hook-trust` = REST routes, tier `operate`.
- Any same-user process holding local token `~/.pi/dashboard/local/token` (CRED-07: raw token still accepted) can call both. Includes a lead with `bash`.
- Consequence: policy `"user"` removes only the LEAD's right (`user_decision_required`). Without enforced identity it is only as strong as local-token boundary.
- Same advisory limit as agent-teams core mail-identity design (core D5) and skill allowlist.
- `"user"` = approval workflow aid. NEVER document or treat as security boundary.
- Follow-up: require browser-session principal for `"user"` once host exposes principal kind.
- Under enforced identity: route records principal; owner/control guard applies (`helpers.reachable`: visible AND controllable, else unknown-team 404).

## Access rules per route

| Route | Tier | Extra gate |
|---|---|---|
| `GET /templates` | observe | `admitRouteCwdParam` + `host.knownFolderCwds` |
| `GET /teams/:id/plans` | observe | core `routeVisibility` ⇒ 404 if invisible |
| `POST /teams/start` | operate | cwd admitted. Owner = request principal |
| `POST /teams/:id/members/:name/plan-decision` | operate | visible AND controllable |
| `POST /hook-trust` | operate | cwd admitted. Hash must equal current project hook hash |
| `DELETE /hook-trust` | operate | cwd admitted. Query string params |

- `team.start` + `trustHooks` reachable only from bridge code and REST. No agent tool registered. Prompt-injected lead cannot start a template or trust hooks.
- Unlisted plugin route ⇒ fails closed to `operate`; completeness test fails build.
- Writes rate-limited (`writeLimit`, 2/s burst 5).

## Template + agent file hardening

- Regular files only; realpath must stay inside source dir (symlink escape ⇒ invalid).
- Size caps: template `maxTemplateBytes` 65 536; agent file 64 KiB.
- Strict YAML: no aliases, anchors, merge keys, custom tags (`maxAliasCount: 0`).
- `goal` single-line, control chars → space. Closes header-spoof class on playbook card.
- Agent `tools` must be YAML array ⇒ comma-string fails hard (`agent_invalid`) rather than silently inheriting all tools.
- Ceiling + plan floor: injected lead cannot widen template `tools`/`skills` or drop `requirePlanApproval`.
- Rollback: member awaiting approval keeps read-only scope until session ends. No data corruption.
