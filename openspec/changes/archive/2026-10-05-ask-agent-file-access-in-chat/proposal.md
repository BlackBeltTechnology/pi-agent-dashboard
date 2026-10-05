## Why

A pi session's `read` / `write` / `edit` tool calls touch disk in-process. The
bridge extension has no path-grant awareness, so an agent reading or writing
outside its session `cwd` is never denied and the operator is never asked. The
dashboard's filesystem access plane (`add-access-grant-dialog`) only guards the
dashboard's own `/api/file*` routes.

The operator wants to be asked when the agent reaches outside its roots.

### Where to ask: in the agent's conversation, not an app-wide modal

Rule: **ask where the blocked thing lives.**

- An operator UI load that is refused (editor tab, `FilePreviewOverlay`,
  `ImageLightbox`) already raises the app-wide grant dialog — the operator is
  acting now. Agent-caused preview loads (canvas auto-open, inline renders)
  already show an in-chat `DenialNotice` (`surface-denial-remedy-in-previews`
  D4). Verified in source: `EditorPane.tsx:187`, `FilePreviewOverlay.tsx:108`,
  `ImageLightbox.tsx:48`. **No change there.**
- An agent turn that is blocked asks **in that session's ChatView**, like
  `ask_user`:
  - the operator sees *why* (preceding turn, tool call, content just read) —
    the strongest control against a prompt-injected agent steering a
    habituated "Allow always";
  - reuses the live `ctx.ui.confirm` → PromptBus → chat-card path
    (first-response-wins, reconnect replay, timeout) and works in the TUI when
    no dashboard tab is open;
  - scales across parallel sessions through existing attention routing
    (`session-attention-routing` needs-you badge / folder rollup) instead of
    stacking modals;
  - needs no new browser-side eligibility path and no `hostGate` enforce mode
    — nothing is held over HTTP.

## What Changes

- **Bridge path gate.** A `tool_call` handler for `read` / `write` / `edit`
  resolves the target path exactly as pi's tools do (`~`, `@` prefix, `..`,
  symlinks) and checks it against the session `cwd`, its checkout root,
  built-in roots, and the granted directories in the existing path-grant store.
  In-root → no prompt, no round-trip. Out-of-root → ask.
- **In-chat file-access card.** A PromptBus prompt with a file-access variant:
  tool name, canonical path, read vs. write, and for writes the target and diff
  summary. Verdicts: **Allow once** / **Deny** (dismissing = Deny). **Allow always** sits behind a deliberate second step (disclosure +
  exact-path confirm), is never pre-selected, and never offers an ancestor
  directory.
- **One grant store.** Allow always writes the same path-grant store the
  dashboard's filesystem plane uses, so Settings ▸ Access lists and revokes it
  and the editor does not ask again for that path. The write goes through the
  server (bridge never writes the store directly).
- **Fail closed.** Deny, timeout, a gate error, or no UI to ask on →
  `{ block: true, reason }`. Ungrantable targets (`forbidden-subjects.ts`: home,
  `/`, system roots) get no Always allow; sensitive ones (`~/.ssh`, `~/.pi`)
  are also flagged in the card. Grant *checks* read the store locally, so the gate
  works with no dashboard (asks in the TUI); Allow always is offered only when
  a dashboard registered on this machine can record it. A denied directory is
  not re-asked in the same session for 120 s (blocked silently, logged).
- **On by default** for reads and writes, with built-in roots for pi's own
  files (agent dir, loaded skills, loaded context files) and the temp dir.
  `agentPathGate.enabled` / `PI_DASHBOARD_AGENT_PATH_GATE=off` turn it off;
  Settings ▸ Security toggle.
- **Waiting visibility.** A session blocked on a file-access card counts as
  needs-you in attention routing even though a tool is in flight (server fold
  rule change); non-modal toast "Session ‹name› is
  waiting for file access → open".

Out of scope: `bash` (paths inside a shell string are not reliably parseable —
`add-supervised-tool-approval` / Docker); agent-caused preview loads (keep the
in-chat notice); network / CORS planes; the app-wide grant dialog (unchanged).

## Capabilities

### New Capabilities
- `agent-path-confinement`: bridge `tool_call` gate for `read` / `write` /
  `edit` against `cwd` + granted roots; in-chat file-access prompt; restricted
  verdicts; fail-closed settlement; timeout.

### Modified Capabilities
- `path-anchor-grants`: agent-approved subjects written to the same store over
  the bridge connection, marked as agent-prompted; ancestor rungs never offered.
- `session-attention-routing`: a pending file-access card counts as needs-you.

## Impact

- `packages/extension/src/bridge.ts` + new `packages/extension/src/path-gate/`
  — `tool_call` handler and pure decision module.
- `packages/shared/src/config.ts` — `agentPathGate`; forbidden-subject logic
  shared between bridge and server.
- `packages/server/src/access/` — new bounded confirm registry
  (`agent-confirm-registry.ts`) and the session- and prompt-bound agent grant
  write; `grant-store-id` token file; `canonical-subject.ts` +
  `forbidden-subjects.ts` move to `packages/shared` (server re-exports; never
  imported by the browser client).
- `packages/server/src/event-wiring.ts` + session model — new
  `awaitingFileAccess` session field set/cleared by the agent path-gate prompt
  kinds; `currentTool` untouched.
- `packages/shared/src/protocol.ts` — `path_grant_request` /
  `path_grant_result`, `dashboard_identity { grantStoreId }`.
- `packages/client/src/` — needs-you predicate reads `awaitingFileAccess`, waiting toast, Settings ▸
  Security toggle, Access page label for agent-prompted grants. The card itself
  reuses the existing `select` / `confirm` renderers.
- Coordination with `add-supervised-tool-approval`: this ships standalone with a
  pure decision function that supervised mode composes later (path gate first,
  then action approval) — design D1.

## Discipline Skills

- `security-hardening` — path canonicalisation of agent-supplied input
  (symlink, `..`, hard links); agent-driven confused-deputy on Allow always;
  bridge → server grant-write authorisation.
- `performance-optimization` — `tool_call` budget for in-root paths
  (p95 < 1 ms, no round-trip).
- `observability-instrumentation` — log path gate outcome (in-root / asked /
  allowed-once / allowed-always / denied / timeout / error) per session.
- `doubt-driven-review` — in-flight review of the Allow-always second step and
  the gate's fail-closed paths before they stand.
