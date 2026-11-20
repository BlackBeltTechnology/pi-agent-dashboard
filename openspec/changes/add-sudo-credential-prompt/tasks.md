## 1. Spike + protocol (tests first)
- [ ] 1.1 Failing test: `SUDO_ASKPASS` wrapper invoked by a real no-tty `sudo -A`-less child reads helper stdout (fake root-free sudo shim in test)
- [ ] 1.2 Add `sudo_credential_request|response|cancel|forget|dismiss|cache` types to `packages/shared/src/protocol.ts` + `browser-protocol.ts` (+ unions per `ServerToBrowserMessage` rule in faq)
- [ ] 1.3 Add the types to `SESSION_OWNED_MESSAGES` in `packages/server/src/identity/ws-message-scope.ts`; failing scope test first
- [ ] 1.4 Add `sudoCredentialPrompt { enabled:true, timeoutMs:120000, cacheMinutes:5 }` to `packages/shared/src/config.ts` with clamp (cacheMinutes 0–60) + test asserting the default is on

## 2. Bridge (extension)
- [ ] 2.1 Tests: wrapper/dir modes 0700, cleanup, env unset only-if-ours, win32/explicitly-disabled no-op, default config installs
- [ ] 2.2 Tests: parent verifier (system sudo accepted; script/`$SUDO_ASKPASS` direct refused), in-flight bash gate, single-pending, sticky Cancel per toolCallId
- [ ] 2.3 Implement `packages/extension/src/sudo-askpass/` (helper, socket server, verifier) and wire `session_start`/`session_shutdown`/`tool_call`/`tool_execution_*`/`user_bash` in `bridge.ts`
- [ ] 2.4 Tests+impl: password held as `Buffer`; logs carry type + callId only
- [ ] 2.5 Tests first (fake clock): cache hit within window skips modal and does not extend TTL; expiry re-prompts + zeroes; `cacheMinutes=0` stores nothing; cleared on `session_shutdown`, server-connection loss, `sudo_credential_forget`, disable; same-sudo-pid re-invocation drops cache and prompts; failed verification never returns cached value; canary absent from logs/JSONL/LLM context
- [ ] 2.6 Implement the cache in `packages/extension/src/sudo-askpass/` (Buffer, timer, zero-on-clear) + emit `sudo_credential_cache {expiresAt|null}` metadata

## 3. Server relay
- [ ] 3.1 Tests: canary password absent from event store, persisted JSON, replay, captured logs; non-owner dropped; plain-HTTP non-loopback authenticated owner accepted; remote bridge gated by `decideVaultTrust`; `_forget` routed to bridge and owner-scoped
- [ ] 3.2 Implement `packages/server/src/sudo-credential/` in-memory relay + route in `browser-gateway.ts` (bypass `QuestionStore`); first-answer-wins + dismiss; relay `_forget` and `_cache` metadata; replay metadata on subscribe

## 4. Client
- [ ] 4.1 Component tests: masked field, no `localStorage`/URL, Esc/Cancel, focus trap, a11y labels, value cleared on unmount, Forget chip shows cache expiry and sends `_forget`
- [ ] 4.2 Implement `SudoCredentialDialog.tsx` (`data-testid="sudo-credential-dialog"`) + Security-tab disable toggle (default on) + timeout + cache minutes

## 5. Verify
- [ ] 5.1 Doubt-driven review of D7 (helper→bridge auth residual) and security-hardening pass; confirm design.md `## Accepted risks (owner decision)` still matches shipped behaviour; record in design
- [ ] 5.2 Manual QA macOS + Linux: correct pw, wrong pw (3 retries, cache dropped), Cancel, timeout, direct `$SUDO_ASKPASS`, cache reuse within 5 min + expiry, Forget, plain-HTTP LAN answer
- [ ] 5.3 `npm test` (tee to /tmp/pi-test.log), `npm run reload` (extension), `restart-server.ts` (server/shared), `npm run build` + restart (client)
- [ ] 5.4 `npx openspec validate add-sudo-credential-prompt --strict` and `node scripts/check-conventions.mjs`
