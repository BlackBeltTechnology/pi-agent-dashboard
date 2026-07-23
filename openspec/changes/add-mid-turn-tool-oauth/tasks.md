# Tasks — add-mid-turn-tool-oauth (courier MVP)

TDD-first: write the failing test, then the minimal code to pass. Tasks marked **[manual]**
require a real provider consent screen and cannot be automated in CI; they are verified by
hand during QA.

## 1. AuthChallengeDetector interface + registry

- [ ] 1.1 Write failing unit test asserting a per-tool adapter registry resolves an adapter by tool id and returns `undefined` for unknown tools
- [ ] 1.2 Define `AuthChallengeDetector` interface (`launch` / `detect` / `complete`) and the `AuthChallenge` union (`{kind:"url",url}` | `{kind:"device",verificationUrl,userCode}` | `{kind:"paste",url}` | `{kind:"done"}` | `{kind:"none"}`) in the server package
- [ ] 1.3 Implement the adapter registry (register + resolve); make 1.1 pass

## 2. rclone adapter (structured detection)

- [ ] 2.1 Write failing test: given a captured rclone `--non-interactive` JSON blob whose `State` begins with `*oauth`, the rclone adapter classifies `{kind:"url",url}` with the authorize URL extracted
- [ ] 2.2 Write failing test: given rclone output with no oauth state (already configured), adapter classifies `{kind:"done"}`
- [ ] 2.3 Implement the rclone adapter: launch `rclone config create <name> drive --non-interactive --auth-no-open-browser`, parse the JSON state machine, classify; make 2.1–2.2 pass
- [ ] 2.4 Write failing test for the `--continue`/`--state`/`--result` loop advancing past the first `*oauth` state; implement the continue loop; make it pass

## 3. Prose-fallback detection (device kind, gh as example)

- [ ] 3.1 Write failing test: given captured `gh auth login` device-mode prose, a gh adapter classifies `{kind:"device",verificationUrl,userCode}`
- [ ] 3.2 Implement the gh prose adapter (regex extraction of code + verification URL); make 3.1 pass
- [ ] 3.3 Write failing test that the shared detection path prefers structured output when present and only falls back to prose otherwise; implement; make it pass

## 4. ChatView card per challenge kind

- [ ] 4.1 Write failing client test: a `url` challenge renders an "Open in browser" card action
- [ ] 4.2 Write failing client test: a `device` challenge renders the user code prominently + verification URL text
- [ ] 4.3 Write failing client test: a `paste` challenge renders the URL + a paste field
- [ ] 4.4 Implement the card variants over the existing `ask_user`/`PromptBus` `prompt_request` path; make 4.1–4.3 pass

## 5. Browser-open + remote-access gating

- [ ] 5.1 Write failing test: `url` kind + local/trusted request → calls the existing `openBrowser` on the server host
- [ ] 5.2 Write failing test: `url` kind + remote request → does NOT spawn a browser and returns the "open the dashboard on <host>" instruction
- [ ] 5.3 Write failing test: `device` kind + remote request → ceremony proceeds (not gated)
- [ ] 5.4 Implement the gating using existing `system-open-capability` + remote-access detection; make 5.1–5.3 pass

## 6. Completion detection + credential-ownership guard

- [ ] 6.1 Write failing test: successful tool exit (0 / listener / poll) resolves the card to "connected"
- [ ] 6.2 Write failing test: non-zero exit or timeout resolves the card to "error" with a message
- [ ] 6.3 Write failing test asserting the courier flow never writes the token to any dashboard store and never logs it
- [ ] 6.4 Implement completion detection + the no-persist/no-log guard; make 6.1–6.3 pass

## 7. Wire the courier flow end to end

- [ ] 7.1 Write failing integration test (mocked tool): invoke → detect `url` → card → simulated completion → connected
- [ ] 7.2 Implement the orchestration that ties adapter → card (PromptBus) → browser-open gating → completion; make 7.1 pass
- [ ] 7.3 Expose the entry point the agent/tool uses to start a courier auth for a named tool

## 8. Instrumentation (observability-instrumentation)

- [ ] 8.1 Emit structured events for: challenge-kind classification, browser-open gating decision (local vs remote-blocked), and completion outcome (success/error/timeout) — assert via a test that they fire, with no secret in the payload

## 9. Docs + per-file records

- [ ] 9.1 Add directory `AGENTS.md` rows for every new source file (adapter registry, rclone adapter, gh adapter, courier orchestrator, card components)
- [ ] 9.2 Update `docs/architecture.md` (delegate to DocScribe, caveman style) with a "mid-turn tool OAuth (courier)" data-flow entry and the loopback-local-only vs device-remote-OK rule

## 10. Manual QA (real consent screens — cannot automate)

- [ ] 10.1 **[manual]** rclone → Google Drive, local dashboard: full ceremony resolves to connected; rclone.conf written; dashboard stores/logs contain no token
- [ ] 10.2 **[manual]** rclone `url` kind from a remote/tunnel ChatView: card instructs to open the dashboard on the host; no server-side browser spawned
- [ ] 10.3 **[manual]** gh device flow from a remote/tunnel ChatView: code + verification URL shown; entering the code on a phone completes the poll and resolves the card
- [ ] 10.4 **[manual]** Failure path: deny consent / cancel → card resolves to a clear error state
