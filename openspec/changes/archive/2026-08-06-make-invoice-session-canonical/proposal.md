## Why

`POST /api/plugins/invoicebot/scoped-session { cwd, invoice_id } → { sessionId }`
resolves a per-invoice session through **reuse → recorded-session resume
candidate → spawn**, but the identity it resolves is neither **single** nor
**durable**, and the sessions it hands back can be dead-on-arrival:

- **No durable identity.** The invoice→session link lives only in an in-memory
  map plus a live-session scan. Both are lost on restart and both reject any
  candidate whose `status === "ended"`. A session spawned to open the invoice
  and then stopped can never be re-found, so the next open spawns another.
- **No single-flight.** Two near-simultaneous resolutions for the same invoice
  both miss every reuse path and both spawn. Observed live: two sessions for one
  invoice spawned **20 ms apart**, both left `active`.
- **Phantom-active.** A spawned session that exits is not finalized to `ended`;
  the manager keeps reporting `status: "active"` with **no live bridge**.
- **Send silently dropped.** `send_prompt` routes to auto-resume **only** when
  `status === "ended"`. A phantom-active session takes the live-send branch,
  `sendToSession` returns `false` (no bridge), the prompt is dropped, and the
  composer spins on "sending" until its safety timeout. The transcript still
  renders (replayed from the session file), so the surface looks healthy while
  every message is lost.
- **Re-run asymmetry.** Dispatching a flow for an invoice reuses a live session
  but, when that session is ended, the emit fails (no bridge) and a **fresh
  one-shot** session is spawned instead of resuming the existing one — a
  different, worse behavior than the send path's resume.
- **Global session adopted as an invoice's session.** The resolver's reuse gate
  accepts *any* session whose `automationRun.name` starts with `invoicebot`,
  including the shared `invoicebot-intake` folder-automation session (the
  full-surface `ask` profile — no `IB_TOOLSET`). Because that intake session is
  recorded as each processed invoice's run session, opening the invoice card
  binds to it and the operator sees the **global Ask greeting** and the
  **all-invoice tool surface** on what must be a single-invoice, scoped view.
  Observed live: an invoice opened its card onto the global intake session's
  opener instead of its own invoice-scoped opener.

Net effect: opening an invoice whose session was stopped, or re-running it,
accumulates dead sessions and cannot deliver a single operator message — and
when the intake session is the recorded one, the card is bound to a global
session that leaks the full tool surface and the wrong greeting.

## What Changes

- **One canonical session per invoice, durably linked.** The invoice→session
  link SHALL survive a dashboard restart and SHALL be the sole identity
  resolution consults. Resolution reuses the canonical session when live, and
  **resumes** it when ended-but-restorable (its session file exists), rather than
  discarding it and spawning.
- **New invoice always spawns exactly one.** An invoice with no canonical session
  SHALL spawn exactly one session and record it as canonical. Reuse/resume only
  ever engages for an invoice that already has one.
- **Single-flight resolution.** Concurrent resolutions for the same invoice SHALL
  collapse to one in-flight bootstrap, so a burst of opens yields at most one
  spawn.
- **Honest lifecycle — no phantom-active.** A spawned invoice session whose
  process exits / whose bridge drops SHALL be finalized to `ended`, so `status`
  reflects reality and the resume path is reachable.
- **A prompt with no live bridge resumes, never drops.** `send_prompt` for a
  canonical invoice session that has no live bridge SHALL auto-resume the session
  and deliver the queued prompt, instead of taking the live-send branch and
  losing it. (Covers both a cleanly-ended and a phantom-active session.)
- **Re-run reuses or resumes the canonical session.** Dispatching a flow for an
  invoice that already has a canonical session SHALL deliver to that session —
  reusing it live or resuming it if ended — instead of spawning a fresh one-shot.
  A new invoice (no canonical session) SHALL still spawn.
- **A dispatch that did not start a flow is a failure.** Delivering `flow:run` is
  not the same as starting a flow; when the runtime declines (already-running /
  unknown / gated), the dispatch SHALL be reported as a failure to the caller and
  surface to the operator — on both the REST path and the `/<flow-name>`
  slash-command path — never as a silent success.
- **Recorded-session reads dedupe.** The `view:"runs"` read boundary SHALL return
  each session id once, ordered by session recency (shape-agnostic; a no-op today,
  correct once run rows become per-run).
- **The canonical session must be scoped, never global.** The identity resolved,
  recorded, and reused for an invoice's card SHALL be a per-invoice **scoped**
  session (`invoicebot-scoped:<id>`, or an `invoicebot:process` run bound to that
  invoice) — never a global `invoicebot-intake` / `invoicebot-pull` / Ask
  session, even when the global session is the one that processed the invoice.
  When no scoped session exists, resolution spawns a fresh scoped one instead of
  adopting a global session. The looser "invoicebot session in this cwd" gate is
  retained ONLY for the `flow:run` dispatch reuse path, where delivering a run
  into a live intake session is legitimate.

## Capabilities

### Modified Capabilities
- `invoicebot-session-profile`: the on-demand session resolver gains a durable,
  single canonical identity per invoice; reuse-or-resume of an ended canonical
  session; single-flight de-duplication; honest end-of-life finalization; a
  send path that resumes rather than drops when no live bridge exists;
  re-run dispatch that targets the same canonical session (new invoice still
  spawns); and a scoped-profile constraint so the canonical session is always
  bound to its invoice and a global/intake/Ask session is never adopted as an
  invoice's card session.

## Impact

- **`packages/invoicebot-plugin/src/server/session-link.ts`** — durable canonical
  invoice→session link; single-flight guard around bootstrap; accept an
  ended-but-restorable canonical session as reusable (return for auto-resume);
  `dispatchFlow` reuses/resumes the canonical session instead of spawning a fresh
  one-shot when the target is ended; new invoice still spawns exactly once. A new
  `isScopedInvoiceSession(session, cwd, invoiceId)` gate governs the card's
  canonical identity (adopt/reuse/record) — matching `automationRun.name ===
  "invoicebot-scoped:<id>"` (or an `invoicebot:process` run bound to the invoice)
  — while the looser `isInvoicebotSession` is retained ONLY for the `flow:run`
  dispatch reuse path. `recordedUsableSession`/`linkedLiveScopedSession` apply the
  scoped gate so a recorded global `invoicebot-intake` session is skipped in
  favour of a fresh scoped spawn.
- **`packages/server/src/browser-handlers/session-action-handler.ts`** —
  `handleSendPrompt` resumes when the target has **no live bridge**, not only
  when `status === "ended"`, so a phantom-active session is not dropped.
- **Session lifecycle finalization** (gateway close handling for invoicebot
  spawned sessions) — a spawned invoice session whose bridge closes is finalized
  to `ended`, eliminating the phantom-active state.
- **`packages/extension/src/bridge.ts`** — the `/<flow-name>` slash path carries a
  correlation token on `flow:run` and settles the optimistic bubble with an error
  on a flow-runtime rejection, instead of an eager silent `prompt_received`; a
  return channel forwards the rejection to the server/plugin.
- **Persistence** — the canonical link is a **dedicated per-invoice store** owned
  by the plugin (Decision 1, Option B), keyed by the invoice within its
  workspace, re-pointed to a resume successor. NOT reconstructed from a session's
  own `.meta.json` (that path was found non-durable — see design.md).

## External dependencies (not implemented here)

Two platform capabilities this change consumes but does not build:

- **Scope re-establishment on resume/continue.** Resolution can return a session
  that must be **resumed** on first use. For a resumed session to behave as the
  same per-invoice scoped conversation — retaining its bound scope and able to
  re-run its own processing in place — the underlying session runtime must
  re-establish that bound scope on continue. This change passes the bound-scope
  hint into the resume spawn (task 5.4) but does not implement the runtime side.
- **A token-echoing flow rejection.** The dispatch-failure behavior needs the
  flow runtime to emit an observable rejection when a `flow:run` does not start,
  carrying a **caller-supplied correlation token** so a specific dispatch can be
  attributed (a rejection has no run id — it never started). This change consumes
  that signal; the runtime side is external.

Both are tracked as cross-repo handoffs under the shared name
`make-invoice-session-canonical`.

The client conversation contract (`/ws` subscribe / replay / `send_prompt`) is
unchanged — no new WebSocket message type.

## Discipline Skills

- `systematic-debugging` — the fix follows an evidence-first root-cause (phantom-
  active + status-gated send + non-durable link); preserve that discipline when
  implementing so each change traces to an observed failure.
- `doubt-driven-review` — session lifecycle + persistence is cross-boundary and
  hard to reverse; stress-test the canonical-identity and finalization decisions
  before they stand.
- `observability-instrumentation` — resolution, single-flight collapse, resume,
  and finalize are opaque in production today; add per-outcome logs
  (reuse / resume / spawn / dedup-collapse / finalize) so "which session and why"
  is answerable from logs.

## Gates

- **Unit (test-first):** `session-link` — canonical reuse, resume-of-ended,
  single-flight collapse (one spawn under concurrent calls), new-invoice-spawns-
  exactly-one; `handleSendPrompt` — no-live-bridge resumes (not drops);
  lifecycle — bridge close finalizes to `ended`.
- **E2E (faux, offline):** open the same invoice twice ⇒ exactly one session;
  send after the session is stopped ⇒ it resumes and answers (no stuck
  "sending"); re-run after stop ⇒ same canonical session is resumed, not a new
  one spawned.
