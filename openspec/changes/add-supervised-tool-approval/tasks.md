# Tasks — add-supervised-tool-approval

## 1. Shared tool-gate primitive (bridge)
- [ ] 1.1 Add a risky-tool predicate `isRiskyTool(toolName, args)` (default set `bash`,
      `write`, `edit`) with a config-overridable set. → verify: unit test — read-family tools
      return false, mutating/exec tools return true, custom set extends it.
- [ ] 1.2 Add a `tool_call` interceptor helper that, given `{ supervised, isRisky, confirm }`,
      escalates via `ctx.ui.confirm(...)` and returns `{ block: true, reason }` on deny,
      `undefined` on approve. → verify: unit test with a fake `ctx.ui.confirm` — approve ⇒
      no block; deny ⇒ `{block:true}`; timeout/undefined ⇒ fail-closed `{block:true}`.
- [ ] 1.3 Register the interceptor on `pi.on("tool_call", …)` in the bridge, gated by the
      session `supervised` flag; non-supervised or non-risky ⇒ pass through untouched.
      → verify: unit test — flag off ⇒ handler never calls confirm; flag on + risky ⇒ calls
      confirm and honors the result.
- [ ] 1.4 Build a human-readable action summary per tool (bash: command; write/edit: path +
      compact diff/summary). → verify: unit test snapshots the summary for each tool type.

## 2. Mode flag wiring (dashboard → bridge)
- [ ] 2.1 Add a `supervised` default to shared config (`~/.pi/dashboard`), read at session
      start. → verify: unit test — config `supervised:true` ⇒ new sessions start gated.
- [ ] 2.2 Add a session-scoped live toggle signal (dashboard → bridge) that flips the flag
      for a running session. → verify: integration test — toggle on ⇒ next risky tool_call
      prompts; toggle off ⇒ next risky tool_call runs without a prompt.

## 3. Approval UI (client)
- [ ] 3.1 Add a Full-access ↔ Supervised toggle to the session view; reflect current mode.
      → verify: component test — clicking toggles and emits the control signal.
- [ ] 3.2 Add a tool-approval interactive renderer variant: tool name, command/args or
      file+diff, Approve / Deny. → verify: component test — renders a bash prompt and a
      write+diff prompt; Approve/Deny post the correct `prompt_response`.
- [ ] 3.3 Confirm reconnect replay + answered-history card work for tool-approval prompts
      (inherit PromptBus behavior). → verify: test — reload mid-prompt re-renders the pending
      approval; answered prompt shows a resolved card.

## 4. Observability
- [ ] 4.1 Log every decision `{ sessionId, toolName, argsSummary, outcome, answeredBy }`.
      → verify: test asserts a log line on approve and on deny.

## 5. Docs & safety wording
- [ ] 5.1 Session/help copy states Supervised = "approve each action", NOT "sandboxed";
      point users to the container path for real isolation. → verify: copy review; no
      "sandbox"/"safe" wording on the approval surface.
- [ ] 5.2 Delegate the `docs/` note (supervised mode: scope, container-for-isolation) to a
      subagent in caveman style per the Documentation Update Protocol.

## 6. End-to-end
- [ ] 6.1 E2E (docker harness): supervised session, agent runs `bash` → dashboard shows an
      approval card → Deny blocks the command (agent told), Approve runs it. → verify:
      Playwright spec in `tests/e2e/`.

## 7. Cross-reference add-chat-gateway
- [ ] 7.1 Factor the risky-tool predicate + interceptor helper (tasks 1.1–1.2) so
      `add-chat-gateway`'s L3 hard tool policy can consume the same primitive. → verify: the
      helper has no dashboard/Discord-specific imports; both surfaces inject their own
      `confirm`.
