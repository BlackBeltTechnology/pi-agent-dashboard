# Add sudo credential prompt (SUDO_ASKPASS bridge)

## Why

Issue [#1099](https://github.com/BlackBeltTechnology/pi-agent-dashboard/issues/1099): when pi runs a command that needs `sudo`, a dashboard-controlled session cannot ask the operator for the password. The command fails instead.

Verified root cause (CONFIRMED):

- pi's bash tool spawns `bash -c <cmd>` with `stdin: "ignore"`, `detached: true` (new session, so no controlling tty), `env: process.env + PATH` (`node_modules/@earendil-works/pi-coding-agent/dist/core/tools/bash.js:63-67`, `getShellEnv` in `dist/utils/shell.js:147-157`). `sudo` has no terminal to read from.
- Nothing in the repo handles `sudo`/`SUDO_ASKPASS` (`grep -rniE 'sudo|askpass' packages/` finds no handler). The existing prompt road (`PromptBus` → `prompt_request`/`prompt_response`, `packages/extension/src/prompt-bus.ts`, `packages/server/src/pairing/browser-gateway.ts:2546-2550`) has no masked/secret input and records answers in `QuestionStore`/event replay, so it must not carry a password.
- Empirically verified on macOS (sudo 1.9.17p2): with no tty and `SUDO_ASKPASS` set, `sudo true` invokes the helper **without `-A`**, helper `$PPID` is `sudo`, and sudo re-invokes it up to 3 times on a wrong password. `sudoers(5)`: with no tty the timestamp is tied to the parent pid, so every bash tool call prompts again unless the dashboard supplies its own short in-memory cache (see D3).

Existing pattern reused: the bridge already writes names into `process.env` for agent tools (`packages/extension/src/vault-delivery.ts:4,249`) and gates remote delivery on `decideVaultTrust` (`packages/server/src/vault/vault-delivery-hub.ts:67`).

## What Changes

- **Bridge** (macOS/Linux, **on by default**, owner decision, confirmed (owner, 2026-11-20)): when a `dashboard_identity` advertising the `sudo-credential` feature is observed (it arrives after registration, i.e. after `session_start`; same event-driven pattern as vault delivery), write a private askpass wrapper + node helper and a Unix socket in a 0700 dir and set `process.env.SUDO_ASKPASS` (unless the operator already set one: never overridden); remove what it installed on `session_shutdown`, on server-connection loss, or when a later identity lacks the feature.
- **Stale-client guard**: a subscribed browser only counts once its dialog acks (`sudo_credential_shown`); with no ack within ~2 s the server tells the bridge to refuse (non-sticky), so an old tab/PWA/Electron client never causes a 120 s hang.
- Helper (invoked by sudo) sends `{ promptText, ppid }` to the bridge socket; bridge applies cheap **anti-accident** checks only (owner decision 2026-11-20, after review cycle 3: peer-process verification is **dropped** — a same-user process cannot be stopped by a peer check): a bash/`user_bash` call is in flight, one pending prompt, and it is not blocked by a prior Cancel for the in-flight calls; the reported `ppid` is self-reported and used only to count sudo's retries; refuses immediately when no server/browser can answer; then answers from the in-memory password cache if a fresh entry exists, else asks the dashboard.
- **New WS messages** (not `prompt_request`): `sudo_credential_request` (server→browsers; metadata + running command text only), `sudo_credential_response` / `_cancel` / `_forget` (browser→server→bridge; the server may also send `_cancel {reason:"unanswerable"}`), `sudo_credential_shown` (browser→server ack), `sudo_credential_dismiss`, `sudo_credential_cache` (bridge→server→browsers; `{expiresAt|null}` metadata only, drives a "Forget" chip). The password is relayed, never stored: bypasses `QuestionStore`, event store, replay, and log lines.
- **Client**: masked-password modal (`data-testid="sudo-credential-dialog"`), shows session, every in-flight bash command (full, scrollable), sudo's prompt text (sanitized, labelled as supplied by the command); Cancel/Esc → helper exits non-zero; sticky for the tool calls in flight.
- **Vault-masker registration** (owner decision C, kept (owner, 2026-11-20)): every operator-entered password is registered with the existing vault masker (`[REDACTED:SUDO_PASSWORD]`) before delivery, so an echo in tool output, `!` output, messages or forwarded events never reaches the transcript/JSONL/model. The `!` path is wrapped for masking and in-flight tracking whenever the feature is installed (independent of whether the vault masker is active at command start). Exact-occurrence only; the registered string is non-zeroable for the process lifetime (documented trade-off vs Buffer-only).
- **Password cache** (confirmed (owner, 2026-11-20)): the bridge keeps the last operator-entered password **in memory only**, per session, for `cacheMinutes` (default 5 = sudo's default `timestamp_timeout`, configurable, 0 disables). A fresh cache entry answers the helper with **no modal**. Cleared on session shutdown/restart, loss of the server connection (server restart), explicit Forget, expiry, or a rejected password (sudo re-invoking the helper for the same sudo pid). Never persisted, logged, put in transcript/JSONL, or sent to the LLM.
- **Settings**: Security-tab `sudoCredentialPrompt.enabled` (**default on**; the toggle only exists to disable), timeout (default 120 s), `cacheMinutes` (default 5).
- Any authenticated client owning the session may answer, **including plain-HTTP LAN** (confirmed (owner, 2026-11-20)); no loopback/TLS restriction. Remote bridges are still served only when the vault trust predicate passes (bridge-side axis, unchanged). The risks of these owner choices are recorded in `design.md` → *Accepted risks (owner decision)*.

## Capabilities

### New Capabilities
- `sudo-credential-prompt` — askpass bridge, operator prompt, transport and non-persistence rules.

### Modified Capabilities
- none (the owner-scope list `SESSION_OWNED_MESSAGES` in `packages/server/src/identity/ws-message-scope.ts` is code-only; no spec enumerates it).

## Non-goals

- Not a policy engine and no auto-approval: no allow-list of commands, no persistent "remember password"; the only reuse is the bounded in-memory per-session cache above.
- No PTY/terminal emulation, no `sudo -S` stdin feed, no Windows support (no `sudo` there), no `doas`/`pkexec`.
- Not a sandbox: a same-user agent can still run arbitrary commands and, obtain the plaintext password by opening the helper socket or running attacker code under a sudo it started (design D7 residual, owner accepted; mitigation is masking of verbatim echoes into the LLM/transcript/JSONL, a transformed echo is not masked); this change only keeps the password off every bridge-controlled path to the model/transcript/state.
- No filesystem/Docker/VM safety policy.

## Relationship

- `add-mid-turn-tool-oauth` (exploration draft, unstarted): different credential (OAuth consent), shares only the "operator card for a headless tool" idea. Separate; no fold.
- `add-supervised-tool-approval` (active): approves *tool calls*; this supplies a *credential* after explicit input. Orthogonal. If supervised mode lands, a `bash` approval does not imply password entry; each is its own prompt.
- `add-vault-llm-delivery` / `absorb-service-secrets-into-vault`: vault pushes stored secrets into env; this stores nothing on disk (in-memory session cache only). Reuses `decideVaultTrust` and the env-write pattern only.
- Archive sweep: no archived change covers sudo/askpass (`ls openspec/changes/archive | grep -iE 'sudo|askpass'` empty).

## Discipline Skills

- `security-hardening` — secret transport, masker registration (incl. `!`-path composition), in-memory cache lifecycle/zeroing, non-persistence, phishing-by-agent threat model; accepted risks are documented, not mitigated.
- `doubt-driven-review` — the same-OS-user password-exposure residual is documented and owner accepted; review before it stands.
- `review-code` — non-trivial change, before commit.
- `observability-instrumentation` — new socket + WS messages: metric-only logs (no prompt/command text, never the password).

## Impact

- New: `packages/extension/src/sudo-askpass/` (helper, socket server, in-flight gate, mask registry `sudo-mask-registry.ts`), `packages/server/src/sudo-credential/` (relay), `packages/client/src/components/SudoCredentialDialog.tsx`, protocol types in `packages/shared/src/protocol.ts` + `browser-protocol.ts`.
- Edited: `bridge.ts` (lifecycle; in-flight tracker + masking composed into the existing `user_bash` handler independent of `masker.active()`; the masker `getState` at `:1156-1169` composes the vault state with the sudo mask registry; `vault-masker.ts`/`vault-delivery.ts` untouched), `vault-redaction.ts` (optional `userBash({always})` parameter), `connection.ts` (`IMMEDIATE_TYPES`), `pairing/browser-gateway.ts` (route), `event-wiring.ts` (advertise `sudo-credential` feature; explicit bridge-message branches for `sudo_credential_request`/`_cache`; pending-slot cleanup in the existing `piGateway.onDisconnect`; ack timer), `ws-message-scope.ts` (add types to `SESSION_OWNED_MESSAGES`), `ws-message-tiers.ts` (tier `control`), `useWebSocket.ts` (no outbox for these types), `config.ts` (key), Security settings tab; new cache module in `packages/extension/src/sudo-askpass/`.
- Compatibility: additive; the bridge installs the helper only while an observed `dashboard_identity.features` advertises `sudo-credential` (precedent: `vault-delivery`), so an old server never causes a 120 s sudo hang, and a stale browser client that does not ack is refused within ~2 s. **Default on** → a behaviour change: sudo in a bash call now raises an operator modal instead of failing; set `sudoCredentialPrompt.enabled=false` to restore the old behaviour.
- Rollback: set `enabled=false` (env var removed on next session start, cache cleared) or revert; nothing persisted, no migration.
- Rebuild: extension → `npm run reload`; server/shared → `restart-server.ts`; client → `npm run build` + restart.
