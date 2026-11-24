# Proposal

## Why

The dashboard only shows flows that are registered with a live session's pi-flows. A flow definition an agent just wrote somewhere else, or a flow folder that no package registers, stays invisible. Even for registered flows, the only way to open a flow graph is a human clicking **Open flow…**; an agent (and the `manage-flows` skill, which ships with pi-flows) has no way to say "look at this flow".

## What Changes

- The flows plugin bridge registers a new pi tool, `flow_open`. It exists only where the dashboard flows plugin bridge is loaded; pi-flows itself is unchanged.
- `flow_open { flow: "<ns>:<name>" }` attaches a catalog flow to the calling session's flow slot, like the **Open flow…** picker (runnable).
- `flow_open { path }` attaches a flow definition the session has not registered. The path must canonically resolve inside the session working directory. The panel is view-only: graph, YAML and pending cards, a "view only - not registered" label, and no Run, autonomous toggle or Edit….
- Delivery reaches every connected browser; each stores its own copy of the attachment and acknowledges. The tool reports `shown` (with the acknowledgement count), `no-viewer`, or `refused` with a reason. An agent pin expands the flow panel, as Open flow… does.
- The plugin's per-session flow-file allow-list gains the admitted flow's own files (definition, code handlers, known agents), each confined to the working directory and re-checked on every read; the host's general file route is never used for them.
- `flow_open` carries its own prompt guidelines: after writing, editing or inspecting a flow, call `flow_open` to show it.

Mockup: mockups/2026-11-23-flow-open-tool (in this change) — accepted: expand + every device (frames 1, 3, 4).

Out of scope: registering folders as view-only catalog entries, a view/run switch, a pi-flows `flow:inspect-dir` event, server-side attachment storage, paths outside the session working directory.

## Capabilities

### New Capabilities
- `flow-open-tool`: the agent-callable `flow_open` tool: inputs, catalog lookup, path admission, file allow-list, delivery and acknowledgement, result contract, logging.

### Modified Capabilities
- `flow-pre-run-attach`: the agent can attach flows too; agent attachments reach every connected browser (picker attachments stay on their device); path-opened flows render view-only and ignore catalog membership.
- `flow-panel-collapse-persistence`: an agent's `flow_open` expands the panel, like Open flow….
- `flow-controls`: a view-only not-started header offers Open flow… but not Edit… or Run.

## Impact

- `packages/flows-plugin/src/bridge/`: register `flow_open`.
- `packages/flows-plugin/src/server/`: `flow/open` lane handler, path admission, allow-list extension, ack collection, rate limit, log line.
- `packages/flows-plugin/src/client/`: `shell-headless` listener, attachment `viewOnly`, view-only header, no host-route fallback for view-only files, handler map for path-opened flows.
- `packages/flows-plugin/package.json`: `shell-headless` claim.
- `packages/shared/src/ws-message-tiers.ts`, `packages/server/src/identity/ws-message-scope.ts`, `packages/server/src/pairing/browser-gateway.ts` (`frameClassOf`): the acknowledgement message's tier and scope, and a never-shed class for the open frame.
- `packages/flows-plugin/src/client/FlowHeaderActions.tsx`: no Edit… for view-only.
- No change to pi-flows. No new dependency.

## Discipline Skills

- `security-hardening`: the tool takes a filesystem path from the agent and widens what the plugin server reads and serves.
- `observability-instrumentation`: a new tool and server lane need a log line per outcome.
