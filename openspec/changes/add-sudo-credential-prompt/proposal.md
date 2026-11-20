# Add sudo credential prompt (SUDO_ASKPASS bridge)

## Why

Issue [#1099](https://github.com/BlackBeltTechnology/pi-agent-dashboard/issues/1099): when pi runs a command that needs `sudo`, a dashboard-controlled session cannot ask the operator for the password. The command fails instead.

Verified root cause (CONFIRMED):

- pi's bash tool spawns `bash -c <cmd>` with `stdin: "ignore"`, `detached: true` (new session, so no controlling tty), `env: process.env + PATH` (`node_modules/@earendil-works/pi-coding-agent/dist/core/tools/bash.js:63-67`, `getShellEnv` in `dist/utils/shell.js:147-157`). `sudo` has no terminal to read from.
- Nothing in the repo handles `sudo`/`SUDO_ASKPASS` (`grep -rniE 'sudo|askpass' packages/` finds no handler). The existing prompt road (`PromptBus` → `prompt_request`/`prompt_response`, `packages/extension/src/prompt-bus.ts`, `browser-gateway.ts:2539`) has no masked/secret input and records answers in `QuestionStore`/event replay, so it must not carry a password.
- Empirically verified on macOS (sudo 1.9.17p2): with no tty and `SUDO_ASKPASS` set, `sudo true` invokes the helper **without `-A`**, helper `$PPID` is `sudo`, and sudo re-invokes it up to 3 times on a wrong password. `sudoers(5)`: with no tty the timestamp is tied to the parent pid, so every bash tool call prompts again unless the dashboard supplies its own short in-memory cache (see D3).

Existing pattern reused: the bridge already writes names into `process.env` for agent tools (`packages/extension/src/vault-delivery.ts:4,249`) and gates remote delivery on `decideVaultTrust` (`packages/server/src/vault/vault-delivery-hub.ts:67`).

## What Changes

- **Bridge** (macOS/Linux, **on by default**, owner decision, confirmed (owner, 2026-11-20)): at `session_start` write a private askpass wrapper + node helper and a Unix socket in a 0700 dir; set `process.env.SUDO_ASKPASS`; remove on `session_shutdown`.
- Helper (invoked by sudo) sends `{ promptText, ppid }` to the bridge socket; bridge verifies the parent is the system `sudo`, a bash tool call is in flight, and it is not blocked by a prior Cancel for that call; then answers from the in-memory password cache if a fresh entry exists, else asks the dashboard.
- **New WS messages** (not `prompt_request`): `sudo_credential_request` (server→browsers; metadata + running command text only), `sudo_credential_response` / `_cancel` / `_forget` (browser→server→bridge), `sudo_credential_dismiss`, `sudo_credential_cache` (bridge→server→browsers; `{expiresAt|null}` metadata only, drives a "Forget" chip). The password is relayed, never stored: bypasses `QuestionStore`, event store, replay, and log lines.
- **Client**: masked-password modal (`data-testid="sudo-credential-dialog"`), shows session, the bash command, sudo's prompt text (sanitized); Cancel/Esc → helper exits non-zero; sticky for that tool call.
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
- Not a sandbox: a same-user agent can still run arbitrary commands; this change only keeps the password out of the model/transcript/state.
- No filesystem/Docker/VM safety policy.

## Relationship

- `add-mid-turn-tool-oauth` (exploration draft, unstarted): different credential (OAuth consent), shares only the "operator card for a headless tool" idea. Separate; no fold.
- `add-supervised-tool-approval` (active): approves *tool calls*; this supplies a *credential* after explicit input. Orthogonal. If supervised mode lands, a `bash` approval does not imply password entry; each is its own prompt.
- `add-vault-llm-delivery` / `absorb-service-secrets-into-vault`: vault pushes stored secrets into env; this stores nothing on disk (in-memory session cache only). Reuses `decideVaultTrust` and the env-write pattern only.
- Archive sweep: no archived change covers sudo/askpass (`ls openspec/changes/archive | grep -iE 'sudo|askpass'` empty).

## Discipline Skills

- `security-hardening` — secret transport, in-memory cache lifecycle/zeroing, non-persistence, phishing-by-agent threat model; accepted risks are documented, not mitigated.
- `doubt-driven-review` — the helper→bridge authentication is a documented residual (same-OS-user agent); review before it stands.
- `review-code` — non-trivial change, before commit.
- `observability-instrumentation` — new socket + WS messages: metric-only logs (no prompt/command text, never the password).

## Impact

- New: `packages/extension/src/sudo-askpass/` (helper, socket server, verifier), `packages/server/src/sudo-credential/` (relay), `packages/client/src/components/SudoCredentialDialog.tsx`, protocol types in `packages/shared/src/protocol.ts` + `browser-protocol.ts`.
- Edited: `bridge.ts` (lifecycle), `browser-gateway.ts` (route), `ws-message-scope.ts` (add types to `SESSION_OWNED_MESSAGES`), `config.ts` (key), Security settings tab; new cache module in `packages/extension/src/sudo-askpass/`.
- Compatibility: additive; old servers ignore unknown message types and the bridge stays disabled when the server lacks the capability. **Default on** → a behaviour change: sudo in a bash call now raises an operator modal instead of failing; set `sudoCredentialPrompt.enabled=false` to restore the old behaviour.
- Rollback: set `enabled=false` (env var removed on next session start, cache cleared) or revert; nothing persisted, no migration.
- Rebuild: extension → `npm run reload`; server/shared → `restart-server.ts`; client → `npm run build` + restart.
