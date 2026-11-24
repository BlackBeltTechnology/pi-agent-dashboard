# DOX — packages/agent-teams-plugin/src/bridge

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `index.ts` | Bridge entry: `activate(pi)` → `createBridge(pi, opts)`. Role tools registered synchronously from the env hint (confined ⇒ none); `hello` at every `session_start` (retry while the lane is unavailable; reply confirms/downgrades; `not_in_team` drops tools + guard); `agent-teams:mail` → custom message (`deliverAs:"steer"`, `triggerTurn`=wake) → ack, id de-dup (re-ack + re-hello); teammate `busy`/`idle`(`agent_end` text/error, `agent_settled`); `agent-teams:team_closed` drops lead-only tools. |
| `tools.ts` | `createTeamTools(transport)`: the 11 tool definitions (schemas, lead guidance, peer-message trust, advisory limit note); a failed call throws a lowercase `code: text` error. |
| `lane.ts` | `createLaneClient(request)` over `requestPluginServer("agent-teams", …)` (`call/hello/busy/idle/ack`), `LaneResult` (transport failures flagged), `describeError` code → text. |
| `guard.ts` | Teammate guard (copy-adapted from `team-plugin/src/extension/guard.ts`): `decideToolCall` (name gate, sleep/git guards, `SKILL.md` read confinement), `grantedSkillFilter`, `isRefusedInput`, pi handler factories over a `GuardState`. |
| `shell-guard.ts` | Advisory `bash` checks: `splitSimpleCommands`, `isSleepPoll` (GNU durations, total ≥ 10 s), `commandWritesGit` (`commit/push/rebase/merge/reset --hard`, env prefix, `sh -c`). `bash -c`/`$(…)`/scripts are the pinned advisory limit. |
| `__tests__/` | → see `__tests__/AGENTS.md`. |
