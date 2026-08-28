# Guard coverage — phase 7.1 (task 7.1)

**Question:** do the guard's hooks fire for subagent tool loops, not only the
main session? Guard state is per-process / per-session; a surface the guard
cannot see MUST keep its per-turn prose (spec: "A surface the guard cannot
observe keeps its doctrine").

## Finding: the guard does NOT see subagent tool loops

Evidence chain:

1. This repo's `Agent` tool spawns subagents **in-memory**
   (`openspec/changes/ab-test-rlm-delegation-claim/research.md` §"Four
   subagent implementations compared": pi-dashboard-subagents = in-memory; the
   official pi example = child process — neither shares the parent's hook bus).
2. The subagent runner constructs its session with
   `createAgentSession({ cwd, sessionManager, modelRegistry?, ... })`
   (`pi-dashboard-subagents/extensions/agent.ts`, ~line 1082). It passes NO
   `ResourceLoader` and never calls `runtime.session.bindExtensions(...)`.
3. pi SDK contract (`docs/sdk.md`): extensions are loaded by a ResourceLoader
   and bound per session; "if you use extensions, call
   `runtime.session.bindExtensions(...)` again for the new session".

Therefore the subagent session runs with **no extensions at all**: no
`tool_call` hook, no guard, no kb tools from kb-extension inside the subagent.
(Secondary: even a re-bound subagent session would get a FRESH
`createReindexState`/guard instance — state is not shared with the runner.)

## Consequence (binding for 7.6)

- The in-memory subagent surface is a **surface the guard cannot observe**.
- Per spec, the per-turn doctrine for that surface SHALL NOT be reduced: the
  PRESSURE half of the gate cannot be dropped while subagent loops are
  invisible to the guard.
- The 7.6 trim is therefore **blocked at the 7.1 gate** regardless of the M1/M2
  measurements, unless upstream first binds extensions into subagent sessions
  (and the guard is made multi-instance-aware). Recorded as the follow-up
  condition; no code change in this repo ships it.
- Routing half (table, corpus boundaries, lane pick, fall-through) is retained
  unconditionally — it was never a trim candidate.
