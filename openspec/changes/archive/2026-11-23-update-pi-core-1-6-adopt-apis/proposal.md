## Why

pi 1.6.0 is the latest release (2026-11-20). The repo pins, type-checks and tests against `1.5.0` (`pnpm-workspace.yaml:63-65`, `packages/server/package.json:19-20,78`, `docker/Dockerfile:116`), and the lockstep policy (`pi-core-version-check`) moves the floor with the pin. Releases 1.5.1, 1.5.2 and 1.6.0 change four things the dashboard mirrors or depends on (versions verified against the packed 1.5.0, 1.5.1 and 1.6.0 releases):

- **`cacheWarming` defaults to `"idle"` (1.5.1).** pi's `docs/settings.md` documents `"idle"` as the default; the dashboard's schema still declares `"streaming"` (`packages/shared/src/pi-settings-schema.ts:113`). `pi-settings-schema-parity.test.ts` reads the installed pi's docs and fails once the pin moves.
- **`ctx.shutdown()` exits cleanly on its own when idle, and the exit waits for credential writes (1.5.1, #11599, #11692).** RPC mode used to act on an extension's shutdown request only after the next command or `agent_settled`; it now shuts down when idle (`dist/modes/rpc/rpc-mode.js`, `setImmediate(checkShutdownRequested)`). Interactive mode already did (`interactive-mode.js` `shutdownHandler`). `runtimeHost.dispose()` now waits for an in-progress token refresh to be saved, because the provider already replaced the single-use refresh token. The bridge's `shutdown` handler hard-exits 500 ms after `ctx.shutdown()` (`packages/extension/src/bridge.ts:1421-1434`), which can cut that dispose short and lose the login.
- **`ModelRuntime.settleCredentialWrites()` (1.5.1).** "Call before the process exits so a rotated token is not lost" (`dist/core/model-runtime.d.ts:96-99` in 1.6.0). The server hosts a pi `ModelRuntime` (`packages/server/src/model-proxy/server-model-runtime.ts:116`) and none of its exit paths waits for credential writes. A correct adoption needs an exit barrier, so it is split out (see Out of scope).
- **`pi.exec` reports 128 + the signal number for a signal-terminated command (1.6.0).** A `!` command killed on timeout now forwards `exitCode: 143` instead of `0`. The bridge forwards `ExecResult.code` verbatim (`command-handler.ts:1582`); the `bash-execution` scenarios already cover both shapes, so this is a visible behaviour change with no code change.

## What Changes

### Pin bump + floor (atomic)
- Pin `@earendil-works/pi-coding-agent`, `pi-ai` and `pi-tui` to `1.6.0` on every governed surface:
  - the server dependency (`^1.6.0`) and `piCompatibility.minimum`/`recommended` (`1.6.0`);
  - the root `package.json` peers (`>=1.6.0`) and the pi-ai devDependency (`^1.6.0`);
  - every `packages/*/package.json` pi peer (`>=1.6.0`, still optional) and pi devDependency (`^1.6.0`); the `rg '1\.5\.0'` sweep over `package.json` files is the list;
  - `docker/Dockerfile:116`, plus the two `npm i -g …@1.5.0` steps in `.github/workflows/ci-e2e-browser.yml:504,563` that `e2e-browser-workflow-contract.test.ts` (E3) requires to equal the Dockerfile pin;
  - `scripts/verify-release-deps.mjs` `minVersion` (and its `.AGENTS.md` sidecar);
  - the `pnpm-workspace.yaml` `overrides` and the `minimumReleaseAgeExclude` entries (`pi-agent-core`, `pi-ai`, `pi-coding-agent`, `pi-tui`, `pi-codemode`, `pi-mcp`, `pi-telemetry`, `pi-schema`), derived from the lockfile after `pnpm install`.
- Pin-encoding fixtures move first (TDD): `verify-release-deps-pi-coherence.test.mjs`, `pi-version-skew.test.ts`, `pi-version-update-handling.test.ts` (X3) and `bundled-node-meets-pi-floor.test.ts` (new `1.6.0` row; pi 1.6.0 keeps Node `>=22.19.0`). The floor smoke tests move with them: `tests/e2e/pi-1-5-floor-smoke.spec.ts` → `pi-1-6-floor-smoke.spec.ts` (`FLOOR = "1.6.0"`, plus its `.AGENTS.md` sidecar and the `tests/e2e/AGENTS.md` row) and `qa/tests/01-install.sh` `PI_FLOOR="1.6.0"` (plus `qa/tests/AGENTS.md:8`).
- **BREAKING (publishable peers):** every `@earendil-works` pi peer becomes `>=1.6.0` (optional, no upper bound), and pi devDependencies become `^1.6.0`.
- Dependency delta, verified from the packed manifests:
  - pi-coding-agent replaces `grok-mermaid` `0.2.3` with `lovely-mermaid` `0.3.3`; `undici` 8.12.3 → 8.12.4 (security advisories);
  - pi-ai: `@google/genai` 2.21.0 → 2.32.0, `openai` 7.19.0 → 7.59.0; new `exports` subpaths `./session-resources`, `./lazy-bedrock-provider`, `./lazy-oauth` (additive);
  - pi-agent-core and pi-tui: only the internal `1.6.0` lockstep;
  - Node engines (`>=22.19.0`), `typebox` (`1.3.27`) and every existing `exports` subpath are unchanged.
- **Not a pin surface:** `PLUGIN_HOST_API_VERSION` (dashboard plugin host API) and `nano-banana` `PI_MIN_VERSION` (a feature gate) stay.

### Adopted
- **`cacheWarming` default `"idle"`.** `pi-settings-schema.ts` declares `"idle"` as the default and pi's new description as the hint. A stored `"streaming"` stays valid and is shown as stored.
- **Bridge shutdown leaves pi time for a clean exit.** The bridge keeps calling `ctx.shutdown()` first; its hard-exit fallback moves from 500 ms to 5 s (`BRIDGE_SHUTDOWN_FALLBACK_MS`) and is `unref()`'d. The logic moves into a small module (`packages/extension/src/bridge-shutdown.ts`) so tests drive the real code.
  - Callers: the server's `{type:"shutdown"}` WS message (`command-handler.ts:1189-1192`), sent by the stop flow (`session-action-handler.ts:1069`) and by the automation reaper (`spawn-process/abort-spawned-run.ts:52`, via `server.ts:3060`), and `/quit` / `/exit` (`command-handler.ts:385-387,737-741`).
  - In the dashboard's stop flow the server's termination ladder ends a busy session: a headless session gets SIGTERM at once from the PID-registry rung (`spawn-process/headless-pid-registry.ts:437`), a tmux session after the 1.5 s `SHUTDOWN_GRACE_MS` (`session-action-handler.ts:1016,1088`); SIGKILL follows 2 s after SIGTERM (`timeoutMs: 2000` literals at `session-terminator.ts:141,212` and `headless-pid-registry.ts:437,489`). A busy pi that still has its signal handlers runs the same clean dispose on that SIGTERM.
  - The fallback is the only exit when nothing else ends the process: `/quit` / `/exit`, or a ladder that declines to signal (`not-local`, `no-identity`, `refused-identity` — likelier on the reaper path, which verifies identity).

### Audited, deliberately NOT consumed
- `registerMarkdownTransformer(…, { messageTypes })` / `MarkdownMessageType` (1.5.1; the dashboard registers no Markdown transformer).
- `ctx.ui.custom()` overlays honouring `blocked` (1.5.1; no dashboard caller).
- pi-ai's new `./session-resources`, `./lazy-bedrock-provider`, `./lazy-oauth` subpaths (no consumer; the server keeps reading OAuth providers through pi-coding-agent's model-runtime surface, `provider-auth-server`).
- `AgentSessionRuntime.takeUnreportedDiagnostics()` (the dashboard hosts no `AgentSessionRuntime`).
- `pi auth login|logout` shell commands (the dashboard has its own provider-auth flow).
- `ModelRuntime.settleCredentialWrites()` (1.5.1) on the server's runtime and on `nano-banana`'s own runtime (`packages/nano-banana/src/pi-backend.ts:167`): split out to a follow-up change, because a one-shot settle on `stop()` / `/api/shutdown` / `/api/restart` guarantees nothing without an exit barrier (auth work started after the settle can still write), Electron restarts exit through their own branch (`system-routes.ts:1660-1663`), and the signal handlers (`cli.ts:400-409`, `lifecycle/home-lock-release.ts:46-62`) race each other.
- `models.json` `compat.promptCacheKeyMode` / `compat.requiresNonNullAssistantContent` (1.5.1; the dashboard mirrors no `compat` keys).

### Documented no-ops
- **pi-tui `Component.render()` returns `readonly string[]` (breaking for extensions that mutate render output).** The only dashboard TUI component (`packages/extension/src/multiselect-list.ts:87`) builds a fresh array per render and nothing mutates a component's output; a mutable `string[]` return stays assignable. The only other pi-tui import is `Loader` (`bridge-handlers/lifecycle.ts:13`), used unchanged.
- **Reload while a response streams or a compaction runs is refused (1.5.1, #9222; "Wait for the current response to finish before reloading.").** The bridge already turns a throwing `ctx.reload()` into a `/reload` error in the chat (`command-handler.ts:750-770`). A bulk `npm run reload` now leaves busy sessions on the old extension code and reports the error, instead of swapping extensions mid-response.
- **Delivered image-only steer / follow-up messages no longer stay in pi's pending queue (1.5.1, #8612).** This unblocks `followup-drain.ts` gate 2 (`ctx.hasPendingMessages()`) instead of changing it.
- **Runtime disposal waits for active tools to finish aborting (1.5.1, #9126).** Disposal can take longer; the 5 s bridge fallback leaves room for it.
- **RPC `new_session` / `switch_session` / `fork` / `clone` run `session_start` once and stream its events (e.g. `entry_appended`) to the RPC client (1.6.0).** The server reads no pi RPC stdout events and sends none of those commands; the bridge sees `session_start` in-process as before.
- **`AgentSession.reload()` emits `session_start` for SDK hosts bound with `bindExtensions({})` (1.6.0).** The dashboard's only SDK use is the one-shot `createAgentSession` in `commit-draft-agent.ts:70`, which never reloads.
- **Errors from `pi.events` handlers are reported as extension errors** (chat in interactive mode, `extension_error` in RPC). The bridge's `pi.events.on` handlers are unchanged; nothing consumes RPC `extension_error`.
- **"Could not restore model …" and settings diagnostics are reported on resume/fork and, in RPC, to stderr (1.6.0).** Not consumed.
- **Sessions whose folder is gone offer Continue / Fork / Cancel in interactive mode (1.5.2).** The dashboard never spawns into a missing folder: `spawn-preflight.ts:46-54` refuses with `cwd_missing`.
- **`find` path patterns are relative to the search directory; `grep` `glob` is relative to `path` (1.5.1, 1.6.0).** No dashboard prompt, skill or code passes a path pattern to either tool.
- **RPC shutdown is no longer interrupted by stdin EOF or a single signal; only a repeated signal forces exit (1.5.1).** The termination ladder sends one SIGTERM, then SIGKILL after 2 s, so the outcome is unchanged. pi's up-to-1 s stdout flush applies only to non-SIGTERM exits.
- **`pi.exec` signal exit codes (128 + signal, 1.6.0).** Forwarded verbatim (see Why).
- **Transcript-content fixes inside pi** reach the dashboard through the generic event path with no dashboard code: unstarted tool calls in an Esc-aborted batch get an "Operation aborted" result, MCP tools loaded by `tool_search` survive resume and `/reload`, bash output ending in a line over ~100 KB, the `!`/`!!` truncation notice, `/copy` and RPC `get_last_assistant_text` skipping aborted messages.
- Inside pi, no dashboard code: default model moves (GPT-6.2 Sol, Claude Opus 5.5, …; no product code hard-codes a pi default model id, only help text names `deepseek-v4-flash` and test doubles use fixed ids), Qwen Token Plan gateways and retired DeepSeek ids, Anthropic message threads, the OpenAI reasoning-drop notice, the combined `Cache warmed:` line, provider retries on socket errors, grep context lines from ripgrep (`GrepOperations.readFile`, no dashboard caller), `"tools": []` omission, the llama.cpp default port, prompt-template argument quoting (the dashboard expands templates through pi), MCP transport and sign-in fixes, image resizing in steering messages, TUI / Mermaid / Kitty fixes.
- pi's default system prompt (`dist/core/system-prompt.js`) and the mirrored trust files (`core/project-trust.js`, `core/trust-manager.js`) are byte-identical between 1.5.0 and 1.6.0, so `claude-compat-pi-docs-canary.test.ts` and the trust replicas need no change.

### Out of scope
- Server-side `settleCredentialWrites()` with an exit barrier — follow-up change `settle-server-credential-writes-on-exit` (quiesce auth work, settle on every dashboard-initiated exit incl. the Electron restart branch, within the CLI 5 s / Electron 3 s HTTP budgets; also covers `nano-banana`'s runtime).
- Stop-after-turn (`bridge-handlers/forwarders.ts:253-265`) calls `ctx.shutdown()` at `turn_end`; pi defers that to `agent_settled` in both modes, so it stops after the run, not the turn. Pre-existing and unchanged by 1.6; tracked separately.
- Deriving `pi-settings-schema.ts` from pi's JSON Schema.

### Residual risks (recorded, not fixed here)
- Windows: `killProcess` is `taskkill /F`, so a busy session stopped from the dashboard gets no clean dispose.
- POSIX: SIGKILL 2 s after SIGTERM can still cut a dispose or credential write that takes longer.
- An idle tmux (interactive) session starts its clean shutdown at once, and pi unregisters its signal handlers when it stops the TUI (`interactive-mode.js` `stop()`), so the ladder's SIGTERM 1.5 s later ends a dispose still waiting on a credential write.
- For a headless session the registry rung can spend up to 2 s before the grace and the final escalation, so the 5 s bridge fallback can fire before the ladder's last SIGKILL; either way the process ends.
- A keeper-hosted pi whose PID was never linked is ended by the keeper's SIGKILL (`rpc-keeper-sidecar`), skipping its dispose.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `pi-core-version-check`: floor, recommended and pin-coherence scenarios move to `1.6.0`.
- `provider-auth-server`: the governed-pin scenario names `1.6.0`.
- `bridge-extension`: new requirement — session shutdown leaves pi time for a clean exit.
- `pi-api-feature-detection`: new requirement — the pi 1.5.1–1.6.0 adoption record.

## Impact

- Code: `packages/shared/src/pi-settings-schema.ts`, `packages/extension/src/bridge.ts` + new `bridge-shutdown.ts`, every pi pin surface listed above, `pnpm-lock.yaml`.
- Docs (DocScribe): current-state floor/pin mentions move to 1.6.0 — `docs/faq.md:2026,2030`, `docs/architecture.md:633,1941,1951,2328,6587` (and `:6068` if the shell replica is restated), `docs/security/deployment-process-supply-chain.md:137-138`; historical "1.5.0 adds" lines stay.
- Tests: pin-encoding fixtures, settings parity, bridge shutdown module, floor smoke specs.
- Users: sessions on a global pi below 1.6.0 are flagged below-floor; `!` commands killed by timeout now show a failure; `cacheWarming` unset now means `"idle"` (pi's change).
- Rollback: revert the commit; the 1.5.0 pins, and the 500 ms fallback come back together. No data migration.

## Discipline Skills

- `doubt-driven-review` — the floor raise and publishable peer ranges are a public-API step that stands once released.
- `security-hardening` — the bridge shutdown change exists so the bridge never cuts off pi's save of a rotated OAuth single-use refresh token.
