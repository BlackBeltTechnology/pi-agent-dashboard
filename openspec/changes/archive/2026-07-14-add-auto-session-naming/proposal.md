## Why

A pi session's display name is either the user's manual rename or, absent that, the cwd basename (`session-rename`). Most sessions never get renamed, so a directory full of work reads as a wall of identical folder names. The typed first prompt (`meta.firstMessage`) is a poor label — it restates *what the user typed*, not *what the session is about*.

We want each session to name itself by its **topic** — a short, human title inferred from the conversation — automatically, cheaply, and only once it has enough signal to be meaningful. Greetings, "test", and one-off commands must not produce a name.

## What Changes

Add **automatic topic naming** to the bridge. After each turn, an unnamed session asks a fast model for a short topic title and applies it via `pi.setSessionName(...)`. The name is the **real pi session name** (visible in the pi TUI and mirrored to the dashboard through the existing `session_name_update` path) — not a dashboard-only label.

- **Placement — pure bridge, no proxy.** The bridge already holds pi's `ModelRegistry` and resolves `@fast` to a `provider/modelId` literal via `lookupRole()`. It calls the model in-process with pi-ai's `streamSimple` + `registry.getApiKeyAndHeaders(model)` — the exact primitives the server's model-proxy uses, minus the HTTP round-trip. No dependency on the dashboard server being reachable; a session names itself.
- **Trigger cadence.** On each terminal turn (`agent_end`), if the feature is on AND the session is not user-named AND has no auto-name yet, attempt naming. The **first successful name ends the loop permanently** for that session.
- **"Not enough info" gate.** A cheap pre-filter skips pure greetings, sub-threshold-length first messages, and bare slash-commands (no model call spent). Past the filter, the summarizer prompt itself returns the sentinel `NULL` when there is no nameable topic yet; the bridge treats `NULL`/empty/over-long output as "wait, retry next turn".
- **Manual rename wins, permanently.** A new `SessionMeta.nameSource?: "auto" | "user"` records provenance. Any name change the bridge did **not** originate (dashboard rename UI, or in-pi `/name`) marks `"user"` and locks out auto-naming forever. An auto-set name marks `"auto"` and stops the loop but is not a user lock.
- **Global toggle, default ON.** `preferences.json` gains `autoNameSessions: boolean` (default `true`), surfaced in the Settings panel and relayed to bridges via config push. Off ⇒ the bridge never attempts.
- **Errors are silent on the name + a client toast.** If `@fast` is unconfigured, resolves to an OAuth-only provider the bridge can't authenticate, or the model call errors/returns garbage, the bridge does **nothing** to the name and emits a one-shot notification surfaced as a **client toast** ("Couldn't auto-name session: <reason>"). It does not retry in a tight loop on hard-config errors.

## Capabilities

### Modified Capabilities

- `session-rename`: add auto-naming — bridge-side topic inference on `agent_end`, the pre-filter + `NULL`-sentinel "enough info" gate, the once-only lifecycle, the `nameSource` provenance rule (manual rename permanent lockout), and the error→toast path. Manual rename and cwd-fallback behaviour are unchanged.
- `global-preferences`: add `autoNameSessions: boolean` (default `true`) persisted in `preferences.json`, read on startup, relayed to bridges.
- `meta-json-session-cache`: `SessionMeta` gains optional `nameSource?: "auto" | "user"` (additive; all fields already optional).

## Impact

**Code touched:**
- `packages/shared/src/session-meta.ts` — `nameSource?: "auto" | "user"`.
- `packages/shared/src/protocol.ts` — new bridge→server `auto_name_error` message (reason string); config push carries `autoNameSessions`.
- `packages/server/src/preferences-store.ts` — `autoNameSessions` read/write/default.
- `packages/server/src/*` — relay `autoNameSessions` to bridges; forward `auto_name_error` to subscribers as a toast.
- `packages/extension/src/` — the naming module: `agent_end` hook, gate + pre-filter, `@fast` resolution (reuse `lookupRole`), in-process `streamSimple` call (new: acquire pi-ai module the way the server does), `setSessionName`, provenance tracking of self-vs-external name changes, error emission.
- `packages/client/src/` — Settings toggle; toast on `auto_name_error`.
- Tests: gate/pre-filter unit tests, `NULL`-sentinel handling, provenance state machine, prompt-output parsing, error→toast wiring.

**Not touched:**
- The server model-proxy — deliberately bypassed; the bridge calls the model directly.
- The existing rename wire path (`rename_session` / `session_name_update`) — reused verbatim as the apply + mirror mechanism.

## Discipline Skills

- `doubt-driven-review` — the `nameSource` provenance state machine and the "self vs external name change" detection are subtle and drive a permanent, user-visible lockout; stress-test before it stands.
- `security-hardening` — conversation text is sent to a model to produce a title; confirm the transcript window is bounded and no secret-bearing content is forwarded beyond the intended window.
- `observability-instrumentation` — the error path must be diagnosable (why a session didn't get named): the `auto_name_error` reason + a server log line.

## Open Questions

- Pre-filter thresholds: proposed `< 15` chars / pure-greeting / bare slash-command. Tunable constant — confirm the exact set.
- Transcript window fed to the summarizer: proposed first substantive user message + first assistant reply, truncated. Confirm size.
- Toast frequency: one-shot per session on first hard error (not per turn). Confirm no repeat toast on transient errors.
