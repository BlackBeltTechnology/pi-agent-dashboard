## Context

pi owns provider retry entirely. Effective policy lives in pi's own settings; the dashboard has
never read or written them, and `retry-tracker.ts` reconstructs the retry lifecycle by observation
because pi exposes no `auto_retry_*` event to extensions.

**Scope decision (owner: human, this change).** pi owns retry. The dashboard **configures** it and
**displays** it; it never re-drives a turn. Concretely:

1. **Settings** — a GLOBAL editor only, over all six native fields, written to
   `~/.pi/agent/settings.json`, merge-preserving every unrelated key byte-identical. No
   `.pi/settings.json` write. No project-scope editor.
2. **Session surface** — runtime STATUS only (waiting / attempt n / countdown / Stop). No policy
   values on a session, no per-session editor.
3. **No dashboard-side retry loop, ever.** `specs/dashboard-retry-loop/spec.md` stays absent.
4. **No per-card ticking countdown.** The banner/pill owns it.

An earlier draft of this design proposed a server-owned phase-2 loop that re-drove the failed turn.
That is retired; the evidence below is why, and every decision is re-expressed to the scope above.

## Evidence

E1–E7 measured in a sandboxed lab (`HOME=/tmp/pi-retry-lab`, fake OpenAI-compatible provider
returning `503 overloaded_error`, probe extension logging timestamped events). E8–E11 read from
installed pi sources.

**E1 · `maxRetries` is unbounded; the curve is `baseDelayMs · 2^(n-1)`, uncapped.**
`maxRetries: 8`, `baseDelayMs: 200` produced 9 provider hits with measured gaps
226 / 413 / 816 / 1613 / 3208 / 6417 / 12818 / 25634 ms against expected
200 / 400 / 800 / 1600 / 3200 / 6400 / 12800 / 25600. No clamp on either knob.

**E2 · Every attempt is a full agent turn.** The real sequence is
`agent_start → message_end(error) → agent_end` **per attempt**, with exactly one `agent_settled`
after the final `agent_end`. The tracker's founding assumption — a retry chain inside one agent
turn — does not hold.

**E3 · The shipped tracker therefore emits nothing.** Replaying E2's order through the pre-change
`RetryTracker` produced `auto_retry_start emitted: 0`. `observeAgentEnd` called
`pending.delete(sessionId)` on every `agent_end`, so `observeMessageStart` always short-circuited.
The retry surface was dead in production — this is the live defect the change fixes.

**E4 · Abort during backoff is effectively instant.** In `--mode rpc`, an abort sent 15 806 ms into
a 16 s sleep produced `auto_retry_end` at 15 808 ms and `agent_settled` at 15 810 ms — **2 ms**.
`ctx.abort()` → `AgentSession.abort()`, which calls `abortRetry()` before `agent.abort()`;
`_extensionAbortHandler` is set only by interactive TUI mode. So Stop genuinely cancels pi's native
retry rather than only hiding a banner.

**E5 · pi emits a real retry payload — on a channel the bridge cannot read.** The RPC stream carries
`{"type":"auto_retry_start","attempt":2,"maxAttempts":6,"delayMs":2000,"errorMessage":"…"}` before
each sleep. It is not on the extension bus (subscribing `pi.events` to `auto_retry_*` never fires),
and the RPC keeper spawns pi with `stdio:["pipe","ignore","ignore"]`, discarding pi's stdout.

**E6 · The provider retry layer is unobservable.** For anthropic, openai-responses,
openai-completions, azure and openrouter, `onPayload` fires once before `retryProviderRequest` and
`onResponse` once after it succeeds; all retries and sleeps happen inside, emitting nothing. Only
the codex path fires `onResponse` per attempt. `transformHeaders` runs once per `streamSimple`.

**E7 · Settings are read once, at session construction.** `settingsManager.settings` is an in-memory
merge refreshed only by `session.reload()`. A settings write cannot reshape an in-flight backoff,
nor affect a running session at all.

**E8 · `agent_end.willRetry` exists in 0.83 but is STRIPPED on the extension channel.** Two emits in
`core/agent-session.js`:
- line 353 (session → RPC/SDK): `this._emit(event.type === "agent_end" ? { ...event, willRetry: this._willRetryAfterAgentEnd(event) } : event)` — **carries `willRetry`**.
- line 433 (extension): `await this._extensionRunner.emit({ type: "agent_end", messages: event.messages })` — **drops it**.

`AgentEndEvent` in `core/extensions/types.d.ts` is `{type, messages}`. The only `willRetry` in
extension types is on `session_before_compact` / `session_compact` (overflow-recovery compaction).
The bridge is an extension, so `agent_end.willRetry` is not available to it.

**E9 · `_willRetryAfterAgentEnd` is 2/3 reachable, and the third part is banned.** It is
`settings.enabled && this._retryAttempt < settings.maxRetries && this._isRetryableError(lastAssistant)`.
The bridge can honor **`enabled`** and **`attempt < maxRetries`** (both settings-readable). It MUST
NOT replicate `_isRetryableError` — that is pi's regex classifier, whose duplication
`bridge-retry-observability` explicitly forbids and `simplify-error-retry-single-card` deliberately
removed. So retryability stays observed, never predicted.

**E10 · pi has no persisted per-session retry policy.** `AgentSession.setAutoRetryEnabled` delegates
to `SettingsManager.setRetryEnabled`, which writes the GLOBAL `~/.pi/agent/settings.json`. There is
nothing per-session to edit, so the dashboard must not present one.

**E11 · Version reality.** `node_modules` contains exactly one pi — **0.80.10** — which is what the
test suite loads. PATH pi is **0.83.0**. `packages/server/package.json` declares `^0.83.0`. The
session-layer retry code (`_prepareRetry`, `getRetrySettings`, the uncapped `2^(n-1)` curve) is
byte-identical across 0.80.10, 0.81.1 and 0.83.0, so E1–E7 hold for both; E8/E9 were read from
0.83.0 and are the only version-sensitive findings.

## Goals / Non-Goals

**Goals:**

- pi retries far beyond three attempts, configurably, including across a multi-hour quota reset.
- At every moment during a retry the UI answers three questions without interaction: *is it still
  retrying*, *which attempt*, *how long until the next one*.
- Exactly one always-reachable control ends retrying; the error surface can be reduced to one line
  but never to nothing while a retry is pending.
- Fix the zero-events defect (E3) so the retry surface works at all.
- All six native retry fields editable in one global place.

**Non-Goals:**

- A dashboard-owned retry loop or any re-drive of a turn.
- A project-scoped (`.pi/settings.json`) retry editor, or any per-session retry policy (E10).
- A bounded delay schedule / 60 s ceiling — impossible without an upstream change we cannot make.
- Replicating pi's `_isRetryableError` classifier (E9).
- A per-sidebar-card ticking countdown.
- A single-shot manual Retry control (needs the missing re-drive mechanism).

## Decisions

### D1 · pi owns retry; the dashboard configures and displays, never re-drives

*Rejected: a server-owned loop re-driving the turn via `resume mode:"continue"`.* Not a preference —
it has no mechanism. `handleResumeSession` refuses `mode:"continue"` unless
`session.status === "ended"`, and after an error the server sets status `"idle"`; even for a genuinely
ended session, continue-mode resolves to `pi --session <file>`, which reopens the session **idle**
and drives no turn. The goal-supervisor proves the shape: it respawns a dead driver and must then
dispatch `/goal` via `sendPrompt`, because — quoting its own doc — "meta-stamping alone boots idle".

Raising `retry.maxRetries` achieves the goal with zero new mechanism, and because pi never settles
the turn while budget remains, the re-drive question disappears entirely.

### D2 · The settings editor is GLOBAL and covers all six native fields

The editor writes `retry.{enabled,maxRetries,baseDelayMs}` and
`retry.provider.{timeoutMs,maxRetries,maxRetryDelayMs}` to `~/.pi/agent/settings.json`. The write is
merge-preserving: every unrelated key survives byte-identical, including keys the dashboard has
never heard of. `.pi/settings.json` is never written, and no project-scope editor exists (E10).

The provider sub-block is included **because it is part of pi's native policy and belongs in the one
place a user edits that policy** — even though a wait routed through that layer is unobservable
(E6). The UI therefore states that consequence rather than hiding the fields.

*Note on the reader:* the bridge's read-only reader mirrors pi's own merge (global, then project
override) so the rendered countdown matches what pi will actually do if a project block exists by
hand. Reading is not editing; the editor stays global-only.

### D3 · Applying reloads connected sessions

Because of E7 a write alone is inert for running sessions, so a successful save fans a reload out to
every connected session via the existing `{type:"reload"}` command arm. A failed write reloads
nothing. The tab ships with pi's own defaults so installing the dashboard changes nothing until the
user opts in.

*Accepted consequence:* this is a global setting — it changes plain CLI/TUI pi sessions too. The UI
must say so.

### D4 · Observe the chain via `agent_end` + `agent_settled`, and honor `enabled`

Corrects E3. Keyed to E2's real sequence:

- error assistant `message_end` → record the pending error text (unchanged)
- error **`agent_end`** → an attempt ended and another is coming. Advance the counter, arm the next
  `agent_start`, and emit a **waiting signal** with `attempt`, `delayMs`, and
  `nextAttemptAt = agent_end_timestamp + delayMs`. **Do not clear the chain.**
- retry **`agent_start`** → the awaited attempt is in flight → emit `auto_retry_start`.
- **`agent_settled`** → the sole terminal signal. Close the chain with `auto_retry_end` and clear all
  per-session tracking. pi's own doc for `agent_settled` — "no automatic retry, compaction, or queued
  continuation will run" — is what makes this the correct terminal.

The waiting signal is suppressed when pi will provably not retry, using the two conditions of
`_willRetryAfterAgentEnd` the bridge may legitimately read (E9): `retry.enabled === false`, or
`attempt >= maxRetries`. Retryability itself is never predicted; a non-retryable settle is corrected
by `agent_settled` ~1 ms later.

*Rejected: consume `agent_end.willRetry`.* Stripped on the extension channel (E8).
*Rejected: replicate `_isRetryableError` to reconstruct it.* Banned (E9).

### D5 · Countdown math comes from the settings we own; `agent_settled` carries no payload

`delayMs = baseDelayMs · 2^(attempt-1)` reproduces pi's arithmetic exactly (E1), and `nextAttemptAt`
derived from the `agent_end` timestamp was accurate to ~8 ms in the lab. The bridge reads pi's
settings read-only, defaulting to `3` / `2000`; unreadable settings yield `delayMs: 0`, rendered
elapsed-only. The bridge never writes them.

Native `agent_settled` carries **no `messages`** (verified), so the tracker records the terminal
disposition (`lastEndWasError`) at `agent_end` time rather than reading it from the settle payload.

*Rejected: tap pi's native RPC `auto_retry_start` (E5).* Higher fidelity, but it requires converting
the keeper from a one-way stdin forwarder into a two-way relay and covers only dashboard-spawned
headless sessions — TUI-attached sessions have no RPC stream. Recorded as a future upgrade.

### D6 · The session surface shows runtime status only

The banner/pill and the sidebar mark render *state*, never *policy*: waiting / attempt n / countdown
/ Stop. No `maxRetries`, `baseDelayMs` or provider values appear on a session, and there is no
per-session editor (E10). The attempt number is rendered bare ("attempt 7"), never "of N" —
`maxRetries` is user-set and typically large, so a denominator is noise.

### D7 · Dismiss degrades to collapse while retrying is pending

While a retry is pending, dismiss collapses the card to a one-line pill carrying error + attempt +
countdown + Stop + expand. A true dismiss appears only once retrying has stopped. Collapse is sticky
**per failure chain**, so collapsing does not un-collapse on every attempt while a later unrelated
failure still arrives expanded. Stop-session overrules retry even while collapsed. When retries run
out, the error message persists.

*Rationale:* with no error identity (D8) a dismissed card would be re-opened by the next attempt
seconds later, and a card that could truly disappear would leave a retry chain with no on-screen
handle.

*Rejected:* dismiss also stops retrying (loses "hide the noise, keep trying"); dismiss disabled while
retrying (same guarantee, no escape hatch); a sidebar-only chip (control ends up far from the
failure).

### D8 · No error identity, no classifier, one phase

Nothing fingerprints or classifies the error string; pi's own classifier governs everything. With no
dashboard loop there is only one retry phase, so the earlier `pi:` phase mark and `phase`
discriminator are removed. Marking is a minimal MDI status mark — no emoji anywhere.

### D9 · The countdown lives on the banner, not on every card

The sidebar card renders only the amber working-token mark. Duplicating a live countdown onto each
card would require a per-card timer in a render-hot component for information the banner (and its
collapsed pill) already carries.

### D10 · Long tails are warned about, never capped

`maxRetries` accepts any integer pi accepts. Above ~20 attempts the tail exceeds a day at default
base, so the surface shows a non-blocking warning carrying the computed total. A UI cap is trivially
bypassed by editing the file, so it buys no safety while removing legitimate configuration —
disclosure beats prohibition.

## Risks / Trade-offs

- **[Overshoot on long outages]** → pi's delay doubles with no ceiling, so the next attempt lands at
  ~2× elapsed; overshoot is scale-invariant (tuning `baseDelayMs` shifts which attempt lands where,
  never the ratio). Accepted; bounded by an always-visible pill and a 2 ms Stop (E4).
- **[Writing the user's GLOBAL pi settings]** → merge-preserving write, bounds-validated, defaults
  equal to pi's own so opt-in is explicit, and the UI states the global scope. The dashboard already
  writes this file for package installs and bridge registration.
- **[Exposing `retry.provider.*` whose wait is invisible]** → the fields are shown because they are
  part of pi's native policy, but the UI states that a wait routed there emits no event and renders
  as plain streaming.
- **[Bridge coupled to pi's event shape]** → that coupling already existed and already broke silently
  (E3). Mitigated by a regression test pinning pi's real observed sequence, so the next upstream shape
  change fails a test instead of the product.
- **[Tests load 0.80.10 while PATH pi is 0.83.0 (E11)]** → the retry code under test is identical
  across those versions; the version-sensitive findings (E8/E9) were read from 0.83.0 directly.
- **[Reading pi's retry settings couples us to an internal shape]** → read-only, defaulted, used only
  for display; a shape change degrades the countdown to elapsed-only.
- **[Collapse-only dismiss surprises users expecting ✕ to close]** → the pill keeps the same visual
  family and a real dismiss appears the moment retrying stops.

## Open Questions

- None outstanding.
