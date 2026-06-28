## 1. Protocol — shared types

- [x] 1.1 Add `AttachProposalChangedExtensionMessage` interface in `packages/shared/src/protocol.ts` with fields `type: "attach_proposal_changed"`, `sessionId: string`, `attachedChange: string | null`
- [x] 1.2 Add the new variant to the `ServerToExtensionMessage` union in the same file
- [x] 1.3 Build `packages/shared` and confirm no type errors in dependents (`packages/server`, `packages/extension`)

## 2. Bridge — context state

- [x] 2.1 Add `attachedChange: string | null` (initial value `null`) to `BridgeContext` in `packages/extension/src/bridge-context.ts` and to `createBridgeContext` initialiser
- [x] 2.2 Mirror the field in the `bc.*` reads/writes block at the top of `packages/extension/src/bridge.ts` (the same site that already reads `bc.sessionId`, `bc.cachedCtx`, etc.)
- [x] 2.3 Unit test: constructing a fresh `BridgeContext` yields `attachedChange === null` (no `createBridgeContext` factory exists in this repo; closure init `prev.attachedChange ?? null` + `buildContextFragment(null)` omitting the attached line covers the default-null behavior)

## 3. Bridge — inbound message handler

- [x] 3.1 In `packages/extension/src/command-handler.ts` (the inbound `ServerToExtensionMessage` dispatch `switch`, alongside `case "rename_session"` / `case "list_sessions"`), add a `case "attach_proposal_changed":` arm
- [x] 3.2 Handler SHALL ignore messages whose `sessionId` does not match `bc.sessionId`
- [x] 3.3 Handler SHALL set `bc.attachedChange = msg.attachedChange` when `sessionId` matches
- [x] 3.4 Unit test: matching `sessionId` updates `bc.attachedChange`; mismatched `sessionId` leaves it untouched; `null` payload clears it

## 4. Bridge — system-prompt injector module

- [x] 4.1 Create `packages/extension/src/dashboard-context-injector.ts` exporting `registerDashboardContextInjector(pi, bc): void`
- [x] 4.2 Inside, register `pi.on("before_agent_start", handler)` returning `{ systemPrompt: spliceContextFragment(event.systemPrompt, bc.sessionId, cwd, bc.attachedChange) }`. NOTE: `bridge.ts` already subscribes `before_agent_start` as a pass-through forwarder — do not remove it; pi chains results so both handlers run.
- [x] 4.3 Implement pure `spliceContextFragment(sp, sessionId, cwd, attachedChange)` where `sessionId` is the `bc.sessionId` value passed by the caller:
  - Search for the LAST occurrence of `\nCurrent working directory: ` in `sp`.
  - If found, return `sp.slice(0, anchorIndex) + "\n" + buildContextFragment(…)`.
  - If not found (fallback), return `sp + "\n\n" + buildContextFragment(…)`.
  - cwd source: `event.systemPromptOptions?.cwd ?? process.cwd()` (pi exposes no `pi.cwd` on the extension object).
  - sessionId source: `bc.sessionId` (there is no `pi.sessionId`).
- [x] 4.4a Implement pure `buildContextFragment(sessionId, cwd, attachedChange)` returning the exact format:
  ```
  ── pi-dashboard session context ──
  You are pi session <sessionId> running in <cwd>.
  Attached OpenSpec change: <name> (artifacts at openspec/changes/<name>/)
  ```
  Mandatory delimiter + `You are pi session …` line; conditional `Attached OpenSpec change: …` line only when `attachedChange` non-empty; no trailing blank line (caller controls separators).
- [x] 4.4 Unit-test `buildContextFragment` for the three scenarios: no attach, with attach, post-detach (`null`)
- [x] 4.5 Unit-test `spliceContextFragment`:
  - Anchor present: returned SP retains everything before `\nCurrent working directory: …` verbatim, replaces from that anchor with the fragment, drops the original cwd line.
  - Anchor absent: returned SP equals input + `\n\n` + fragment.
  - Multiple anchors: only the last is replaced.
- [x] 4.6 Add repo-lint / version-probe test asserting the anchor `\nCurrent working directory: ` still appears in the installed pi's `dist/core/system-prompt.js`; skip cleanly if pi cannot be resolved from `node_modules`.

## 5. Bridge — wiring into bridge.ts

- [x] 5.1 In `packages/extension/src/bridge.ts`, call `registerDashboardContextInjector(pi, getBc, isActive)` ONCE during bridge activation (alongside the other top-level `pi.on(...)` registrations). The same `pi` instance keeps the listener across fork/resume, and the getter reads live `sessionId`/`attachedChange`, so no re-registration on `session_start` is needed. (Revised from the original `(pi, bc)` + session_start plan: a frozen `bc` snapshot would miss fork/attach changes, and re-registering would stack duplicate handlers.)
- [x] 5.2 Confirm via test that the handler reads live state through the getter (fork updates `sessionId`) and that a stale generation (`isActive() === false`) contributes nothing

## 6. Server — dispatch from applyAttachProposal

- [x] 6.1 In `packages/server/src/browser-handlers/session-meta-handler.ts::applyAttachProposal(sessionId, changeName, ctx)` — current signature; it sets `attachedProposal` via a `sessionManager` `updates` object (no direct `session.attachedProposal =` assignment). After the `session_updated` broadcast, call a new helper `pushAttachProposalChanged(ctx, sessionId, changeName)` that sends `{ type: "attach_proposal_changed", sessionId, attachedChange: changeName }` through `ctx.piGateway` (already present in the `Pick<BrowserHandlerContext, "sessionManager" | "piGateway" | "broadcast">` ctx)
- [x] 6.2 Helper SHALL be a silent no-op when no bridge is connected for `sessionId`
- [x] 6.3 Verify the same dispatch fires for: WS attach (via `applyAttachProposal`), the SEPARATE detach handler in `session-meta-handler.ts` (passes `null` — detach is NOT `applyAttachProposal(null)`; wire `pushAttachProposalChanged(ctx, sessionId, null)` there too), REST attach/detach via `session-api.ts`, and `pendingAttachRegistry.consume` resolution
- [x] 6.4 Unit test: invoking `applyAttachProposal` with a fake `pi-gateway` records exactly one `attach_proposal_changed` send with the expected payload (mirror the existing bridge test harness pattern — same fake-pi/fake-gateway helpers used by current `*.test.ts` in `packages/extension/src/__tests__/` and `packages/server/src/__tests__/`)

## 7. Server — replay on session_register

- [x] 7.1 In `packages/server/src/event-wiring.ts`, inside the `pi-gateway.onSessionRegistered` hook, after the existing `pendingAttachRegistry.consume` branch, look up the `DashboardSession` for the registering `sessionId`
- [x] 7.2 When the consume branch did NOT fire, and the `DashboardSession` exists, send `{ type: "attach_proposal_changed", sessionId, attachedChange }` to the registering bridge — `attachedChange` = `session.attachedProposal` when a non-empty string, else `null`. (Revised per code-review finding: the explicit `null` replay clears a stale bridge-side `attachedChange` left by a detach that occurred while no bridge owned the session.)
- [x] 7.3 When the consume branch DID fire, skip the replay (it already covered this case via `applyAttachProposal`)
- [x] 7.4 Integration test (`attach-proposal-replay.test.ts`): register-after-restart with `attachedProposal === "X"` replays `"X"`; register with `attachedProposal === null` replays `null` (clear); pending registry intent path uses the consume branch (no extra replay); unknown session → no send

## 8. Integration tests

- [x] 8.1 Bridge integration test: end-to-end `before_agent_start` SP — given a synthetic chained SP that ends with `Current date: …\nCurrent working directory: /tmp/x` — produces output that retains the `Current date:` line, drops the original cwd line, and ends with the fragment (delimiter + sessionId/cwd line + attached-change line when set)
- [x] 8.2 Bridge integration test: post-detach (`attachedChange: null`) the next `before_agent_start` SP omits the attached-change line and no message is injected
- [x] 8.3 Server integration test: WS `attach_proposal` with a connected bridge results in a recorded `attach_proposal_changed` send
- [x] 8.4 Server integration test: dashboard-restart simulation (in-memory `DashboardSession.attachedProposal === "X"`) + `session_register` triggers replay push

## 9. Documentation

- [x] 9.1 Add a row under "Bridge & extension protocol" in `docs/file-index-extension.md` for `dashboard-context-injector.ts` (caveman style — see Documentation Update Protocol in AGENTS.md)
- [x] 9.2 Add a row in `docs/file-index-shared.md` for the new `AttachProposalChangedExtensionMessage` if its location warrants its own row, otherwise update the existing `protocol.ts` row with a `See change:` annotation
- [x] 9.3 Update the `proposal-attachment` notes in `docs/file-index-server.md` (existing row for `session-meta-handler.ts`) noting the new pi-gateway dispatch + `event-wiring.ts` replay
- [x] 9.4 Delegate ALL `docs/` writes to a general-purpose subagent with the caveman-style rule passed verbatim, per AGENTS.md Documentation Update Protocol

## 10. Verification

- [x] 10.1 Run `npm test` — all existing tests pass; new unit tests pass
- [x] 10.2 Run `openspec validate inject-session-context-into-agent` — passes
- [x] 10.3 Smoke test — AUTOMATED via Docker + Playwright instead of manual. `tests/e2e/session-context-injection.spec.ts` spawns a session in the disposable Docker harness, sends `[[faux:echo-system-context]]`, and asserts the rendered assistant text contains the injected fragment (`── pi-dashboard session context ──` + `You are pi session`). Proves bridge `before_agent_start` → pi pipeline → provider → /ws → ChatView end-to-end with no LLM credential. Faux scenario `echo-system-context` echoes `context.systemPrompt`; pure extraction unit-tested in `packages/server/src/__tests__/faux-echo-system-context.unit.test.ts`. Run: `PW_E2E_USE_SYSTEM_CHROME=1 npx playwright test tests/e2e/session-context-injection.spec.ts` (or `npm run test:e2e`). NOTE: requires `docker compose -f docker/compose.yml build` first so the baked bridge includes the injector. Attached-change line + attach/replay protocol covered deterministically by unit + server integration tests.
- [x] 10.4 Confirm token-cost-baseline unchanged for sessions with no attach (sessionId/cwd line only adds ~30 tokens/turn — note in commit message)
