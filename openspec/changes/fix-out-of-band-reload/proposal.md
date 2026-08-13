# Make out-of-band reload actually reload, instead of no-op'ing or restarting the session

## Why

A reload can be triggered from several places that are **not** the chat composer — the reload
button, `pnpm run reload` (`scripts/reload-all.sh`), a successful settings save (the server
dispatches `/reload` to every connected session,
`packages/server/src/pi-agent-settings.ts`, `docs/architecture.md:210`), and package
install/remove (`reloadSessions()`, `packages/server/src/package/package-manager-wrapper.ts:486,564,704`).

Neither of the two existing reload paths behaves acceptably for those out-of-band triggers
(`docs/architecture.md:911-935`):

1. **Non-headless (tmux / wt / wsl-tmux): reload silently does nothing.**
   The bridge's `reload()` calls `globalThis[RELOAD_KEY]`
   (`packages/extension/src/bridge.ts:1252-1260`), which is only populated once a human has
   typed `/__dashboard_reload` in pi's TUI (`bridge.ts:1362-1374`). pi's `ExtensionContext`
   has no `reload()`; only `ExtensionCommandContext` does. Until that TUI bootstrap happens,
   every out-of-band reload logs `reload not available — type /__dashboard_reload in pi TUI
   once to bootstrap` **to bridge stderr and nowhere else**. The operator saves settings or
   installs a package, the dashboard reports success, and nothing reloaded. Silent failure.

2. **Headless: reload kills and respawns the session.**
   `shouldInterceptReload` (`packages/server/src/browser-handlers/session-action-helpers.ts:29`)
   routes to `handleHeadlessReload`, which SIGTERMs the pi process and re-spawns it with
   `mode:"continue"` (`session-action-handler.ts:106`). State is carried over by
   `memorySessionManager.register`, but the session is genuinely closed and restarted — the
   process, its in-memory state, and any in-flight work die. A reload triggered as a **side
   effect** of saving settings or installing a package should never terminate a session.

There is a documented better mechanism. pi's own extension docs
(`node_modules/@earendil-works/pi-coding-agent/docs/extensions.md:1300`) state that contexts
without `reload()` should "use a command as the reload entrypoint, then expose a tool that
queues that command as a follow-up user message" — i.e. `pi.sendUserMessage("/reload-runtime",
{ deliverAs: "followUp" })`. That reaches `ExtensionCommandContext.reload()` with **no TUI
bootstrap and no process kill**.

## What Changes

- **Replace the TUI-bootstrap dependency.** The bridge SHALL trigger reload by queueing its
  registered reload command as a follow-up user message (pi's documented pattern) rather than
  depending on a `globalThis`-captured `ctx.reload` that only a human TUI invocation can
  populate. Out-of-band reload SHALL work on a session that has never been touched in a TUI.
- **Stop terminating sessions for a reload.** With a working in-process path, the
  kill-and-respawn interception SHALL be reduced to a **fallback** for sessions where the
  in-process path is genuinely unavailable — not the default for every headless session. A
  reload triggered by settings-save or package-install SHALL NOT close and restart a healthy
  session.
- **No silent failures.** When a reload cannot be delivered, the outcome SHALL be reported to
  the dashboard (the existing `command_feedback` channel) instead of only to bridge stderr, so
  "settings saved" never implies "settings applied" when nothing reloaded.
- **All trigger sources converge.** Reload button, `/reload` in the composer,
  `pnpm run reload`, settings-save dispatch, and package-operation `reloadSessions()` SHALL all
  take the same path and produce the same observable outcome.

**Out of scope (follow-ups):**
- Reworking *which* events auto-trigger a reload (settings save / package ops keep their
  current triggers).
- Server restart (`POST /api/restart`) — a separate lifecycle, unchanged.
- Removing kill-and-respawn entirely; it is retained as a last-resort fallback.

## Capabilities

### Modified Capabilities

- `session-reload`: reload triggered outside the chat composer must reach a running session
  without a prior `/__dashboard_reload` TUI bootstrap (currently a stderr-only no-op), must not
  kill and respawn a healthy session as its normal path (currently the headless default), and
  must report an undeliverable reload to the dashboard rather than failing silently.

## Impact

- `packages/extension/src/bridge.ts` — reload entrypoint: queue the reload command as a
  follow-up message; keep the registered command as the actual `ctx.reload()` site; retire the
  `globalThis[RELOAD_KEY]` bootstrap requirement.
- `packages/server/src/browser-handlers/session-action-helpers.ts` /
  `session-action-handler.ts` — `shouldInterceptReload` narrows from "any headless session" to
  the genuine-fallback case; `handleHeadlessReload` becomes the fallback.
- Feedback surface: `command_feedback` emission for undeliverable reload.
- Callers unchanged in shape: `pi-agent-settings.ts` reload-on-save,
  `package-manager-wrapper.ts` `reloadSessions()`, `scripts/reload-all.sh`.
- Docs: `docs/architecture.md` "`/reload` Flow (two code paths)" is rewritten by this change.
- Tests: extension bridge reload-dispatch behaviour; `shouldInterceptReload` narrowing;
  no-silent-failure feedback path.
- **Risk:** touches the shared reload path used by settings save, package install, and the
  reload button. A regression here is silent-by-nature, so the observable contract (feedback on
  every trigger) is part of the change rather than a follow-up.

## Discipline Skills

- `systematic-debugging` — root-cause the current no-op/respawn split from evidence (which path
  a given session actually takes) before changing dispatch.
- `doubt-driven-review` — the fallback narrowing is the risky, hard-to-reverse part; stress-test
  it before it stands.
- `review-code` — cross-package change (extension + server) reviewed before commit.
