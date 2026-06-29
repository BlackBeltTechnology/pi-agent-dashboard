# Design

## Context

`FlowAgentCard.tsx` already implements the exact pattern we want to mirror, for
agent nodes:

- State: `AgentSourceState = idle | loading | loaded{content} | error{error}`.
- Trigger: a `mdiFileDocumentOutline` button toggles `sourceOpen`.
- Effect: when `sourceOpen` flips true, fetch
  `/api/pi-resource-file?path=<agent.sourcePath>`; deps are `[sourceOpen,
  agent.sourcePath]` ONLY (including state in deps self-cancels the fetch).
- Render: `ui:dialog` with body `<MarkdownContent content={...} />`.

Code nodes carry `agent.codeTarget` (set in `flow-reducer.ts` from
`data.target` at `flow_agent_started`). Today it renders only as a truncated
text line. We add a parallel affordance for it.

## Goals / Non-goals

- **Goal:** make the code handler `.ts` readable from the card, with syntax
  highlight, reusing existing primitives + endpoint.
- **Non-goal:** editing the handler; opening it in an external editor; wiring
  the same open from `FlowGraph` nodes or the `flow_write` Mermaid snapshot
  (deferred).

## Decisions

### D1 — Keep the `codeTarget` text line, add icon beside it
Keep the existing `‹› {codeTarget}` glance line (truncated). Add the
`mdiCodeBraces` button to the existing bottom-right control row (same row as the
agent doc icon + Details). Rationale: the text gives at-a-glance "what runs
here"; the icon gives "open it". Low visual cost, no layout churn.

### D2 — Render `.ts` as a fenced code block, not raw prose
The source dialog body pipes through `ui:markdown-content`. Passing raw `.ts`
would let the markdown parser eat `#`, `*`, `_`, etc. Wrap as:
```
"```ts\n" + content + "\n```"
```
This is the smallest change and gets syntax highlight if the primitive's
renderer supports fenced `ts`. (Alternative — raw `<pre className="font-mono">`
like the `flow_write` YAML toggle — loses highlight; rejected.)

### D3 — Duplicate the state machine rather than generalize
Add a second `codeSourceState` + `codeSourceOpen` pair and a second effect
keyed on `codeTarget`, rather than refactoring the agent-source machine into a
shared hook. Rationale: the two affordances differ in render (markdown vs fenced
code) and gating (sourcePath vs codeTarget); a premature shared hook adds
indirection for two call sites in one file. Extract later if a third consumer
appears (DRY trigger, not before).

## Open Questions

### O1 — Is `data.target` (codeTarget) absolute?
`/api/pi-resource-file` does `path.resolve(filePath)` against the **server** cwd
and matches the result against an allow-list of `<known-cwd>/.pi/...`. If
`codeTarget` is already absolute (e.g. `/home/u/proj/.pi/flows/flows/x/y.ts`),
the request just works. If it is relative (e.g.
`.pi/flows/flows/x/y.ts`), `path.resolve` joins it to the server cwd, the
allow-list match fails, and the endpoint 403s. The spec's "relative target
resolved against session cwd" scenario covers this defensively. **Action:**
inspect a live `flow_agent_started` event payload for a code node before
implementation; if always absolute, the resolution step is a guarded no-op.

### O2 — Does `ui:markdown-content` syntax-highlight fenced `ts`?
If the renderer does not highlight, the fence still renders as monospace inside
a code block (acceptable). No blocker either way.
