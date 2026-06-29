# Open code handler source from a flow card

## Why

`FlowAgentCard` already lets you read the source behind an **agent** node: a doc
icon (`mdiFileDocumentOutline`, bottom-right, gated on `agent.sourcePath`) opens
a `ui:dialog` that fetches `GET /api/pi-resource-file?path=<sourcePath>` and
renders the agent `.md` via the `ui:markdown-content` primitive.

**Code** nodes (`code` / `code-decision`) have no equivalent. They carry a
different field — `agent.codeTarget` (`data.target`, the resolved handler `.ts`
path) — but it renders as **dead text**:

```jsx
{isCodeKind && agent.codeTarget && (
  <div className="... font-mono truncate" title={agent.codeTarget}>‹› {agent.codeTarget}</div>
)}
```

So the user can see *which* handler file a code node runs, but cannot open it.
The asymmetry: agent nodes → readable `.md`; code nodes → unreadable path string.

This is a plugin-local change. The serving endpoint already supports it:
`/api/pi-resource-file` has **no extension restriction** (reads any file utf-8)
and its allow-list accepts `<known-session-cwd>/.pi/...`, where flow handlers
live (`<cwd>/.pi/flows/flows/<ns>/<id>.ts`).

## What Changes

- **Code-node source open (`flow-agent-card`):** when a card is a code node and
  has `codeTarget`, the card SHALL render a code icon button (`mdiCodeBraces`)
  in the existing bottom-right control row. Clicking it SHALL open a `ui:dialog`
  that fetches the handler file via `/api/pi-resource-file?path=<codeTarget>` and
  renders the contents. The fetch SHALL reuse the existing `AgentSourceState`
  machine + effect, keyed on `codeTarget` instead of `sourcePath`.
- **Render `.ts` as code, not prose (`flow-agent-card`):** because the handler is
  TypeScript, not markdown, the dialog body SHALL wrap the fetched content in a
  fenced ```ts block before passing it to `ui:markdown-content` (free syntax
  highlight), so the source is not mangled by markdown parsing.
- **Path-resolution guard (`flow-agent-card`):** `codeTarget` SHALL be passed to
  the endpoint only when absolute. If `data.target` is relative, the card SHALL
  resolve it against the flow session `cwd` before fetching (the endpoint
  `path.resolve`s against the *server* cwd, which would break the allow-list
  match for a relative path). See design.md open question O1.
- **No change to the existing agent doc-icon path** — agent `sourcePath` →
  markdown render stays exactly as-is. The code icon is additive and only shows
  for code-kind cards.

## Capabilities

### Modified Capabilities
- `flow-agent-card`: adds a code-handler source-open affordance for code /
  code-decision nodes (icon → dialog → fetched `.ts` rendered as fenced code),
  alongside the existing agent `.md` doc-open.

## Impact

- **Plugin** `packages/flows-plugin/src/client/FlowAgentCard.tsx` — add a
  `codeSourceOpen` state + a fetch effect mirroring the `sourceOpen`/
  `sourcePath` pair but keyed on `codeTarget`; render an `mdiCodeBraces` button
  in the bottom-right control row (gated `isCodeKind && agent.codeTarget`); open
  a `ui:dialog` whose body renders the fetched content as a ```ts fence via
  `ui:markdown-content`. Keep the existing `‹› {codeTarget}` text line OR fold
  it into the dialog header (design decision D1).
- **Tests** `packages/flows-plugin/src/__tests__/` — code-kind card renders the
  code icon when `codeTarget` set; non-code card does not; click opens a dialog;
  fetched content is fenced as `ts`; relative `codeTarget` resolved against
  session cwd before the request (if O1 confirms relative paths occur).
- **No server change** — `/api/pi-resource-file` already serves arbitrary files
  under the allow-list.

## Open Questions (resolve before tasks)

- **O1 — is `codeTarget` absolute?** `data.target` comes from the upstream
  pi-flows runtime. If always absolute, the guard is a no-op assertion; if it can
  be relative, the card must resolve against session cwd. Confirm by inspecting a
  live `flow_agent_started` event for a code node.
- **D1 — keep the text line?** Either keep `‹› {codeTarget}` as a glanceable
  label and add the icon beside it, or drop the text and let the icon + dialog
  header carry the path. Recommend: keep the text (truncated) + add icon.
- **Scope — graph + flow_write too?** Should the `FlowGraph` node click and the
  `flow_write` Mermaid snapshot also open handler source? Deferred; this change
  scopes to the card only.
