# Retire the extension slash-dispatch maze via `sendUserMessage({ expandPromptTemplates: true })`

## Why

Dashboard-originated slash commands that target a **pi extension command**
(`/ctx-stats`, `/curator`, `/agents`, `/flows:*`, …) go through a three-way
decision in `packages/extension/src/slash-dispatch.ts` that exists only because
pi 0.70–0.74's `ExtensionAPI` had no way to dispatch a command from inside an
extension:

- **Path B** — `pi.dispatchCommand(...)`: never shipped in pi. Dead code kept
  "for future use".
- **Path C** — headless RPC sessions only: bridge emits
  `dispatch_extension_command` → server `dispatch-router.ts` writes an RPC
  `prompt` line to the per-session keeper UDS → keeper → pi stdin → pi's
  `--mode rpc` reader calls `session.prompt(text, {source:"rpc"})`. Server
  emits an *optimistic* `command_feedback {completed}` on UDS write. The only
  end-to-end measurement in this repo (`dispatch-reload.ts`, docker harness)
  wrote `/__dashboard_reload` — a registered extension command — and pi's
  built-in `/help` to the keeper socket and saw both reach the model as
  literal text. That measurement predates pi 0.84.2; on the installed 0.86.1,
  rpc-mode's `prompt()` defaults `expandPromptTemplates` to `true`, so Path C
  most likely works today — but only for headless sessions, and its
  `completed` is a socket-write receipt.
- **Path D** — every other session (tmux, terminal, user-launched):
  `command_feedback {status:"error"}`. **Extension slash commands from the
  dashboard simply do not work in these sessions.**

pi 0.84.2 added `expandPromptTemplates` to `pi.sendUserMessage()` options
(pi PR #7857). Verified against the installed 0.86.1 `agent-session.js`
(`prompt()` L938–978, runtime binding L2122–2128):
`sendUserMessage(text, {expandPromptTemplates: true})` calls
`prompt(text, {expandPromptTemplates: true, source: "extension"})`, whose
**first** step is `_tryExecuteExtensionCommand(text)` — before the compaction
guard, before `input` handlers, before the streaming branch. It is core
`AgentSession` — no TUI, no stdin — so it works identically in headless RPC,
tmux and terminal sessions. The dashboard's enforced pi floor is 0.85.1
("0.85.1 lockstep floor", `bridge.ts`), so the API is present in every
dashboard-spawned session.

## What Changes

- **Extension commands**: `slash-dispatch.ts` collapses Paths B/C/D into one
  in-process call — `pi.sendUserMessage(text, { expandPromptTemplates: true,
  deliverAs })` — and emits `command_feedback` itself. Works in every session
  kind.
- **Feedback contract** (honest to the API): `pi.sendUserMessage` returns
  `void`; pi runs `prompt()` fire-and-forget and swallows rejections into its
  own runner error channel, which the bridge cannot observe. So `completed`
  means **"handed to pi for dispatch"**, emitted immediately after the call.
  `error` is a **stale-context-only** signal: the sole synchronous throw is
  pi's `assertActive` in the extension loader; compaction, no-model, no-auth
  and handler failures all resolve as `completed`. This is no less informative
  than Path C's optimistic `completed` and strictly more useful than Path D's
  unconditional `error` in terminal sessions, but it is NOT a success signal.
  Handlers that report via `ctx.ui.*` still reach the dashboard through the
  bridge's PromptBus wrappers.
- **Old-pi gate**: the extension's published peer range is
  `@earendil-works/pi-coding-agent >=0.80.10` and
  `@mariozechner/pi-coding-agent >=0.73.1`; below 0.84.2 the option is
  silently ignored and the raw slash would reach the model as a bogus turn.
  The bridge reads the version of the pi it is **running inside** —
  `readPkgVersionByWalkUp` anchored on `process.argv[1]` (pi's own CLI entry),
  accepting either package name, wrapped so any failure yields `undefined` —
  and, below 0.84.2, emits `started` + `error` ("Extension slash commands
  from the dashboard require pi 0.84.2+"). Resolving by package name would
  find the nearest `node_modules` copy (this monorepo hoists a pinned
  earendil), not the running binary — the hoisted-copy probe bug
  `pnpm-workspace.yaml` already documents. Loud beats silent.
- **Remove** Path B/C/D, `hasDispatchCommand`, the `connection` parameter of
  `tryDispatchExtensionCommand`, and `packages/server/src/rpc-keeper/dispatch-router.ts`
  + the server's UDS write client (`headlessPidRegistry.writeRpc`,
  `keeperManager.writeRpc` — no other caller).
- **Tombstone** the server's `dispatch_extension_command` arm for one release:
  an un-reloaded bridge that still sends it gets
  `command_feedback {status:"error", message:"bridge outdated — reload the
  session"}` through the existing `emitCommandFeedback` closure (persist via
  `eventStore.insertEvent` + broadcast — an ephemeral broadcast alone
  re-creates the stuck pill on reattach). The protocol type stays (marked
  deprecated) until the tombstone is removed. The `extension-rpc-dispatch`
  capability itself is left with one `**DEPRECATED**` tombstone requirement
  naming `command-routing` as successor (main-spec integrity rule: a
  zero-requirement spec does not validate).
- **`isHeadlessRpcSession`** stays — it has a live caller (`bridge.ts`
  `isHeadless:` at session registration). Only its dispatch use goes.
- **Keep the RPC keeper sidecar.** It is the default headless spawn path and
  owns pi's stdin for durability across server restarts
  (`enable-rpc-keeper-by-default`); only its slash-dispatch use retires.
- **Plumb `delivery`**: the `bridge.ts` call site currently omits it; the
  helper receives and forwards `deliverAs` (`steer` | `followUp`).
- **Unchanged**: `prompt-expander.ts` disk resolution AND the
  `sendUserMessage` passthrough for skills/templates/unknown slashes. No
  `expandPromptTemplates` flag is added to the passthrough: pi's resource
  loader already scans `.pi/prompts`, so flagging a miss could expand an
  exec-mode template's bash body into the model, and the disk resolver already
  consults pi's command registry — the flag would add risk and ~no value.
- **Supersedes** `openspec/changes/retire-rpc-keeper-when-dispatchcommand-available`
  (no tasks, 2026-05): its Phase 0 waits for an upstream `dispatchCommand`
  that is now unnecessary. Decision (planning, 2026-09-21): **withdraw it** —
  this change deletes `openspec/changes/retire-rpc-keeper-when-dispatchcommand-available/`.
  Keeper retirement (its Phase 2) is out of scope here and remains a separate
  future decision.
- Specs: `extension-rpc-dispatch` 4 REMOVED; `command-routing` 2 REMOVED
  ("Slash command routing through session.prompt()", "Bridge feature-detects
  pi.dispatchCommand"), 1 ADDED, 2 MODIFIED ("Command routing order",
  "Extension slash command detection"); `bridge-extension` 2 REMOVED
  ("three-way decision", "wires connection"), 1 ADDED;
  `dashboard-slash-commands` 1 MODIFIED (wording); `rpc-keeper-sidecar` 1
  MODIFIED (wording).

Behaviour notes (visible, not regressions):
- Headless sessions: `prompt()` `source` changes from `"rpc"` (Path C) to
  `"extension"`; an extension `input` handler branching on `source === "rpc"`
  stops matching for these. tmux/terminal sessions gain `input`-handler
  interception where they previously got an error.
- Routing order is unchanged: user-defined flow fast-path (step 8) still
  precedes extension dispatch (step 9); `getCommands()` throwing on a stale
  ctx still falls through to the passthrough (existing behaviour).

## Discipline Skills

- `doubt-driven-review` — ran during planning (single-model + cross-model on
  `@propose-review-1`); re-run on the protocol-arm tombstone before it stands
  in the worktree.
- `scenario-design` — session-kind matrix, mid-stream `deliverAs`, old-pi
  gate boundary (0.84.1 / 0.84.2), stale-ctx throw, un-reloaded bridge →
  tombstone, flow-name collision, exactly-one-terminal-event invariant.
- `review-code` — before commit.
- `code-simplification` — after green: `slash-dispatch.ts` should be a single
  decision plus one gate, not a residue of three paths.

## Impact

- `packages/extension/src/slash-dispatch.ts` (+ `slash-dispatch.ts.AGENTS.md`),
  `bridge-context.ts`, `bridge.ts` (call site: pass `delivery`),
  `command-handler.ts` (call site), `model-tracker.ts` (new
  `readRunningPiVersion()` anchored on `process.argv[1]`, never throws).
- Tests (no `slash-dispatch.test.ts` exists; the helper's tests live in
  `bridge-slash-command-routing.test.ts`): rewrite its Path B/C/D assertions
  and drop its `describe("hasDispatchCommand")` block (L~444); drop the same
  block in `extension-slash-command-detection.test.ts` (L~85–112), keep the
  detection tests; server `dispatch-extension-command-router.test.ts`
  (delete), `keeper-manager.test.ts` `describe("KeeperManager.writeRpc")`,
  `headless-pid-registry.test.ts` `writeRpc` cases, `cwd-policy-funnel.test.ts`
  mock, `process-manager-keeper-spawn.test.ts` `km` literal (`writeRpc`,
  `writeRpcToSockPath`, `writeCalls`) (remove).
- `packages/server/src/rpc-keeper/dispatch-router.ts` (delete);
  `keeper-manager.ts` (`writeRpc`, `writeRpcToSockPath`) +
  `spawn-process/headless-pid-registry.ts` (`writeRpc`,
  `KeeperWriter.writeRpcToSockPath`) + `headless-pid-registry.AGENTS.md`;
  `event-wiring.ts` L~2312 (tombstone arm); `server.ts` L~2227
  (`setKeeperWriter` comment mentioning `writeRpc` — update); stale
  doc-comments to update: `slash-dispatch.ts` unused `crypto` import,
  `headless-pid-registry.ts` `HeadlessEntry.keeperSockPath` ("Used by
  `writeRpc`"), `process-manager.ts` L~219, `dispatch-reload.ts` L~27–40
  ("measured … it does not" — add "on pi < 0.84.2"), and the
  `extension-rpc-dispatch` main-spec `## Purpose` (edited by hand at archive;
  `Purpose` is not delta-synced);
  `packages/shared/src/protocol.ts` (`DispatchExtensionCommandMessage`
  `@deprecated`).
- `docs/slash-command.md`, `docs/architecture.md` § RPC keeper sidecar,
  `packages/extension/src/AGENTS.md`, `packages/server/src/rpc-keeper/AGENTS.md`.
- Rebuild order matters: `npm run reload` (bridges) BEFORE `/api/restart`
  (server), so the tombstone is rarely hit.
- User-facing: extension slash commands work from the dashboard in tmux /
  terminal sessions for the first time.
