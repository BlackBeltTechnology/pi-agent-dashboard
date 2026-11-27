# DOX — packages/agent-teams-plugin/src/bridge/__tests__

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `guard.test.ts` | Teammate guard (S46–S49, S99, S121): git-write/sleep tables, tool allowlist, four skill layers over real temp dirs, bypass boundary, policy transport, prompt files. Also: apply sole-writer guard (9.35 #S7): write/edit blocked on tasks.md + change specs, symlink/dangling/hardlink/case aliases, loop fail-closed, env-hint switch via `linkBridge({cwd})`. See change: add-agent-teams-openspec. |
| `bridge.test.ts` | Real bridge entry against the real server lane handlers (S7–S9, S14 simulated, S18, S38, S89, S91, S105, S106, S119): role tool table, hello, mail render/ack/de-dup, busy/idle, team_closed, guard wiring. Also: `ResourceLock` registered only with the profile env hint (4.4); lead/plain never get it. See change: add-agent-teams-openspec. |
| `command.test.ts` | `/agent-team` (#X12): args, lead registration + playbook delivery, hook confirm retry, one-time `lead.model` notice, catch-all keeps errors in `ui.notify`. See change: add-agent-teams-templates-hooks. |
| `context.test.ts` | `BridgeContext` seam: payload fields, reply/mail listeners, tool/role accessors; stub modules change nothing. See change: add-agent-teams-templates-hooks. |
| `plan-mode.test.ts` | Plan mode vs REAL server handlers (#E34, #X11, #R9, #D6, #S6, #S7, #I1): narrowing, `tool_call` backstop, hello-driven restore, reload re-derivation, batched mail, env fail-safe. See change: add-agent-teams-templates-hooks. Also: `MEMBER` = `memberTools(false)`. See change: add-agent-teams-openspec. |
