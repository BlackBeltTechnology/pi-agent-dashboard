## Context

See `proposal.md` — Why. Current state relevant to the approach:

- **Bridge `tool_call` handlers.** `packages/extension/src/bridge.ts:2835`
  registers the fan-out admission handler (`fanoutAdmission.onToolCall`), wrapped
  in `safe(...)`. pi runs every extension's `tool_call` handler before the tool
  executes; any handler returning `{ block: true, reason }` cancels it.
  `tool_call` fires **after** `tool_execution_start`, and sibling calls from one
  assistant message are **preflighted sequentially** (`docs/extensions.md:802-806`).
- **pi path resolution.** pi's `read` / `write` / `edit` resolve their path with
  `resolveToCwd` (`dist/core/tools/path-utils.js`): `~` expansion, `@`-prefix
  strip, Unicode-space normalisation, then resolve against `cwd`; `read`
  additionally tries same-directory filename variants (NFD, curly quote, AM/PM).
  These helpers are **not** exported from the package entry point.
- **Prompt transport.** The bridge patches `ctx.ui.confirm` / `select` onto
  PromptBus (`bridge.ts`, `tui-prompt-adapter.ts`). A prompt renders as a card in
  the session's ChatView (`components/interactive-renderers/registry.ts`) and,
  with no dashboard, in the pi TUI. First response wins; pending prompts replay
  on reconnect; `select` resolves `undefined` on dismiss.
- **Attention.** The server folds a pending prompt into `currentTool: "ask_user"`
  **only when `currentTool` is empty** (`packages/server/src/event-wiring.ts:2112`,
  precedence D3 of an earlier change). The needs-you rollup and urgency sort key
  off that state. `tool_execution_start` writes `currentTool` unconditionally
  (`session/event-status-extraction.ts:122`).
- **Prompt visibility at the server.** `prompt_request` (with `metadata`)
  passes through the server (`protocol.ts:665-676`); browser `prompt_response`
  is forwarded without recording the answer (`pairing/browser-gateway.ts:1870`);
  a TUI answer reaches the server only as a value-less `prompt_dismiss`
  (`bridge.ts:3092`). The server can therefore see a prompt **raised**, not how
  it was answered.
- **Server identity at the bridge.** `session_register` has no acknowledgement
  (`connection.ts:671`); the bridge does not learn the server's instance id on
  an established connection.
- **Precedent.** `packages/chat-gateway/src/guard/index.ts`
  (`createToolCallGuard`) is a shipped `tool_call` → `ctx.ui.confirm` →
  fail-closed-timeout → `{ block: true }` loop. `add-supervised-tool-approval`
  (0/70 tasks) plans to extract it into a shared tool-gate package.
- **Path-grant store.** `packages/server/src/access/access-grants.ts`:
  `~/.pi/dashboard/access-grants.json`, subjects are **directories, realpath'd at
  grant time**, `recordGrant({subject, scope, origin, via})`, per-scope cap 200,
  atomic write. Project-scope grants persist; session-scope grants are
  server-process memory only. Grants from the HTTP surfaces are bound to a
  recorded denial id (`path-anchor-grants`).
- **Subject helpers.** `forbidden-subjects.ts` (`whole` / `sensitive` lists,
  `isUngrantableSubject`) and `canonical-subject.ts` (`isSubjectWithin`:
  component-wise, volume-case-aware) live in `packages/server/src/access/`.
- **Checkout root.** `file-read-containment` / `git-checkout-root-resolution`
  define nearest-root resolution with binding checks, a bounded probe, and
  fail-closed-to-`cwd`.
- **Local instances.** `packages/shared/src/instance-directory.ts`
  `listLocalInstances()` enumerates dashboard instances registered in **this
  machine's** `~/.pi/dashboard`; the bridge already uses it for endpoint
  resolution (`bridge.ts:1970`).

## Goals / Non-Goals

**Goals:**
- Out-of-root `read` / `write` / `edit` is gated before execution; in-root calls
  pay no round-trip.
- The gate decides on exactly the path the tool will open.
- The ask happens in the session's own conversation (dashboard card or TUI).
- One grant store shared with the dashboard's filesystem plane.
- Default on, with a machine-level off switch.

**Non-Goals:**
- `bash`, `grep`, `find`, `ls` and custom/MCP tools. The gate covers pi's three
  path-argument tools by name only.
- OS sandboxing. The gate is an approval control on a cooperating runtime. The
  agent runs as the operator's user and can write `access-grants.json` itself;
  nothing here defends against a hostile local process.
- Changing the app-wide grant dialog or preview behaviour.
- Free-text deny reasons.

## Decisions

### D1 — Gate lives in the bridge as its own `tool_call` handler

A pure decision module `packages/extension/src/path-gate/` (`decidePathAccess`)
plus a thin handler registered in `bridge.ts` after the fan-out admission
handler. Standalone, not inside the chat-gateway guard.

- *Alternative: land inside `add-supervised-tool-approval`'s extracted tool-gate
  package.* Rejected for now: that change is unstarted (0/70) and its extraction
  is a refactor of shipped security code. The decision function is pure and
  exported, so supervised mode composes it later (path gate first, then action
  approval).
- The handler is **not** wrapped in the fail-open `safe(...)`: its own
  `try/catch` maps any internal error — including a throwing `ctx.cwd` getter
  after session teardown — to `{ block: true, reason }`.

### D2 — Canonicalisation matches the tool, then roots are compared component-wise

**Target.** The gate resolves the tool's path argument with the same rules pi
applies (`~` expansion, `@` strip, Unicode-space normalisation, resolve against
`cwd`), then real-paths the nearest existing ancestor and re-appends the
remaining segments. pi's helper is not exported, so the gate carries its own
implementation plus a **parity test** that imports pi's
`dist/core/tools/path-utils.js` by file path and asserts identical output over a
fixture table (`~/x`, `@/etc/x`, `@~/x`, NBSP/thin-space names, `../`,
absolute, Windows drive forms). A pi upgrade that changes resolution fails the
test. `read`'s filename-variant fallback only changes the final segment within
the same directory, so it cannot move a target across a root boundary.

**Roots** (each real-pathed once when computed):

1. the session `cwd` and its checkout root, resolved by the **same rules as
   `file-read-containment`** (nearest root, worktree / submodule /
   separate-git-dir binding checks, bounded async probe, fail closed to `cwd`).
   The probe starts at session start; a decision that needs it awaits it up to
   its bound, else uses `cwd` only;
2. read-only built-ins: the pi agent dir, each loaded skill's directory, the pi
   package docs dir, and the context files pi loaded for the session;
3. read+write built-ins: `os.tmpdir()` (and `/tmp` on POSIX), the session dir
   under `~/.pi/agent/sessions`;
4. persisted (project-scope) grants from `access-grants.json`.

**Comparison** uses `isSubjectWithin` (component-wise, never string prefix;
case sensitivity probed from the volume). `canonical-subject.ts` and
`forbidden-subjects.ts` move to `packages/shared/src/` with server re-exports,
so the bridge and the server share one implementation. They import `node:fs` /
`node:os` / `node:path`, like the existing `shared/node-installs/*`: the browser
client MUST NOT import them (the Access page's agent-prompt label reads `via`
from the API, never these modules); a client-side import guard test enforces it.

**Windows.** The parity and containment tests take an injected `path.win32`
flavour and platform, so drive-letter and UNC forms are exercised on POSIX CI;
the Windows QA VM runs the same suites natively.

**Probe timing.** The checkout-root probe starts at `session_start`. The
in-root latency budget applies once it has settled; a decision that arrives
earlier for a target outside `cwd` awaits the probe up to its bound.

Writes to read-only roots are out-of-root → ask. Allow-once answers are never
remembered (D4), so there is no per-session allowance set.

- *Alternative: `path.resolve(cwd, arg)`.* Rejected: `read ~/.ssh/id_rsa`
  resolves to `<cwd>/~/.ssh/id_rsa` (in-root) while pi opens the real file — a
  fail-open bypass; same for `@/etc/...`.
- *Alternative: ask the server for every call.* Rejected: a WS round-trip on
  every `read` breaks the p95 < 1 ms in-root budget and makes the gate depend on
  the dashboard being up for the common case.

### D3 — Grant reads are local; grant writes go through the server

- **Read:** the bridge reads `access-grants.json` directly (read-only, mtime-
  gated cache; malformed → empty). Same machine, no round-trip, works with no
  dashboard. Session-scope grants (server memory) are not visible to the gate —
  see Risks.
- **Same-store test.** The server ensures `~/.pi/dashboard/grant-store-id`
  exists — created with exclusive-create (`O_EXCL`, `0600`, random 128-bit
  token), so concurrent local instances converge on whichever file won; an
  existing file is never overwritten. On every bridge (re)registration it
  **re-reads** the file and sends its content in a new
  `dashboard_identity { grantStoreId }` frame (never a cached value).
  The bridge reads its own `~/.pi/dashboard/grant-store-id` and offers Always
  allow only when the two are equal — i.e. the connected server writes the very
  store the gate reads. Missing frame (older server), missing local file, or a
  mismatch → not offered, with the card note "can't be remembered here".
  The offer is re-evaluated on every `dashboard_identity` (endpoint migration
  re-registers and re-announces); a `path_grant_request` that lands on a
  different server after migration finds no confirm entry and fails safe
  ("runs once, not saved").
  - *Alternative: `isRemoteEndpoint(url)`.* Rejected: a hostname test is wrong
    for an SSH port-forward (loopback URL, remote store) and for docker+zrok
    (public URL, same store).
  - *Alternative: server instance id ∈ `listLocalInstances()`.* Rejected: the
    bridge never receives the server's instance id on an established connection,
    and legacy instance files have none; the token names the store itself.
- **Write:** after the operator confirms (D4), the bridge sends
  `path_grant_request { requestId, sessionId, promptId, path, subject }`. The server keeps
  a bounded **confirm registry** (new, `access/agent-confirm-registry.ts`):
  when it forwards a `prompt_request` whose metadata `kind` is
  `agent-path-gate-confirm`, it records `{promptId, sessionId, path, subject,
  expiresAt}` — **first sight only**: a replayed `prompt_request` for a known
  `promptId` neither re-registers nor extends `expiresAt` (TTL = the gate
  timeout from first sight; cap per session). Lifecycle: `prompt_cancel`
  (timeout / gate cancel) or session end **removes** the entry; `prompt_dismiss`
  (emitted on every settlement, including the affirmative one, and possibly
  before the bridge's grant request) marks it settled and keeps it redeemable
  for 5 s only. A grant request carries `{promptId, path, subject}` and is
  accepted only if the WS connection is bound to `sessionId`, an unexpired,
  unused entry exists for `promptId` with the same `sessionId`, and both `path`
  and `subject` match the entry by `isSameSubject` (canonical, not string
  equality); the entry is consumed (single use). The server then re-derives the
  subject (containing directory, or the path when a directory, realpath'd now)
  and **refuses** if it is not the same subject the confirmation named — a
  directory created, renamed or symlink-swapped between prompt and grant is
  never persisted under a name the operator did not see. It applies
  `isUngrantableSubject`, calls
  `recordGrant({ subject, scope: "project", origin: sessionId, via:
  "agent-prompt" })`, and replies `path_grant_result { requestId, ok, subject |
  error }`. The bridge never writes the store. `via` widens to
  `"prompt" | "agent-prompt"`.
  - The server cannot observe **how** the confirmation was answered (browser
    answers are forwarded unrecorded; TUI answers arrive as a value-less
    dismiss). The answer is the bridge's assertion. The binding therefore stops
    cross-session, misrouted, replayed and path-substituted requests, and does
    **not** prove operator presence against a same-user process — which could
    edit the store file directly anyway (non-goal).

### D4 — Verdicts, the second step, and one time budget

First prompt — `ctx.ui.select`, metadata `{ kind: "agent-path-gate", path,
access, sensitive }`:

- title `Agent wants to <read|write|edit> outside its workspace`; body:
  canonical path, tool name, session cwd; for `write` / `edit` the byte count /
  edit count; a "sensitive location" line when flagged (D5).
- options `Allow once`, `Deny`, and — when D3 and D5 permit —
  `Always allow <dir>…`. No option is preselected.

Both prompts are always **chat-placed** (never widget-bar), so the needs-you
exclusion for widget-bar prompts never applies to them.

Second prompt (only for `Always allow`) — `ctx.ui.confirm`, metadata
`{ kind: "agent-path-gate-confirm", path, subject }`, naming the exact directory
(the file's containing directory; never an ancestor) and stating it persists and
is revocable in Settings ▸ Access.

Settlement:

| Answer | Result |
|---|---|
| `Allow once` | this call runs; next call to the same path asks again |
| `Deny` | block |
| first prompt dismissed (`undefined`) | block (treated as Deny) |
| `Always allow` → confirm `true` | grant request (D3); call runs |
| `Always allow` → confirm `false` / dismissed | block (treated as Deny) |

Both prompts draw from **one** budget of `agentPathGate.timeoutSeconds`
(default 120): the confirm gets only the remaining time, and the gate cancels
any open prompt via PromptBus when the budget expires.

- *Alternative: remember Allow once for the session.* Rejected: one click on an
  agent-steered path would make it silently readable for the rest of the
  session.

### D5 — Fail closed, sensitive targets, and repeat suppression

`forbidden-subjects.ts` has two lists: `whole` (refused exactly: `/`, `$HOME`,
system roots) and `sensitive` (refused with descendants: `~/.ssh`, `~/.pi`, …).
They govern what may be **granted**. The gate never hard-blocks on them: an
ungrantable containing directory gets no Always-allow option; a target inside
`sensitive` is flagged in the card. Built-in roots (D2) are evaluated first, so
pi's own `~/.pi/agent` reads never prompt.

- *Alternative: hard-block sensitive targets.* Rejected: it would make
  `write ~/.pi/agent/AGENTS.md` or `read /etc/hosts` impossible with the gate
  on, pushing operators to disable it wholesale.

**Repeat suppression** (takes precedence over asking, including for sensitive
targets). `D` is the **lexical** parent of the canonical target (canonical
nearest-existing ancestor + remaining segments, minus the last), so a
not-yet-existing `/w/newproj1/a.txt` keys `/w/newproj1`, never the shared
ancestor `/w`. After a Deny, dismissal or timeout for a target whose
containing directory is `D`, further gated calls in the **same session** under
`D` are blocked **without a prompt** for 120 s ("recently denied"), logged and
counted. Expiry or an explicit Allow elsewhere does not lift it early. The gate
also serialises its own prompts per session with a mutex, so at most one gate
prompt per session is open even if pi ever preflights siblings in parallel
(today it preflights them sequentially). Sessions are independent;
cross-session volume is bounded by the operator's open sessions and the
needs-you surfaces. This is the gate's equivalent of the access-grant registry's
same-subject backoff; exhaustion never degrades to allow.

| Condition | Result |
|---|---|
| ungrantable containing dir / target in `sensitive` | ask; Allow once / Deny only; sensitive flag |
| recently denied directory (same session, < 120 s) | block, no prompt, reason `recently-denied` |
| Deny / dismissal / confirm refused | block, reason `denied` |
| budget expired | block, prompts cancelled, reason `timeout` |
| `ctx.hasUI === false` | block, no prompt, reason `no-ui` |
| gate internal error (incl. `ctx.cwd` throws) | block, reason `error` |
| grant write fails (`ok === false`) | this call runs once (operator did approve); card note "not saved: <error>" |

### D6 — Configuration

`DashboardConfig.agentPathGate = { enabled: boolean (default true),
timeoutSeconds: number (default 120) }` in `packages/shared/src/config.ts`, read
by the bridge at session start and re-read on config change.
`PI_DASHBOARD_AGENT_PATH_GATE=off|on` overrides for a process. Settings ▸
Security gains the toggle (disabled with reason under env override). Disabled →
handler returns immediately.

### D7 — Attention and visibility

The gate's prompt fires while `currentTool` is already `read` / `write` /
`edit`, so today's fold (`event-wiring.ts:2112`) never marks the session
needs-you. Rather than overwrite `currentTool` (which would race sibling
`tool_execution_start` writes and need a fragile restore), the server keeps a
separate session field `awaitingFileAccess: boolean`, **derived** from the
server's pending-prompt tracking: true while any tracked pending prompt of the
session has `kind` `agent-path-gate` or `agent-path-gate-confirm`. Tracking
records the `kind` on every path that registers a pending prompt — the live
fan-out branch, the reconnect **replay** burst (exempt from that window's
write-nothing rule for this field only; `currentTool` keeps its replay
discipline), and unicast resync — and drops it on answer, dismiss, cancel,
session end and bridge disconnect. A reconnect therefore re-derives the flag
from the replayed prompts. `currentTool` is left untouched. The needs-you rollup
and urgency sort predicate becomes "chat-routed `ask_user` state **or**
`awaitingFileAccess`".

A non-modal toast ("Session ‹name› is waiting for file access → Open") fires
when such a prompt is first shown and the operator is not viewing that session;
it clears on settlement.

The gate runs its own budget timer and cancels its prompts through PromptBus;
PromptBus's per-bus default timer (5 min) stays as a backstop and, since D7 no
longer writes `currentTool`, a late stray cancel cannot corrupt the tool state.

### D8 — Observability

One log line per non-in-root outcome at the bridge:
`[path-gate] <outcome> tool=<t> access=<r|w> path=<canonical> session=<id>
sensitive=<bool>`, outcomes `asked | allowed-once | allowed-always | denied |
recently-denied | timeout | no-ui | error`. In-root outcomes are counted, not
logged; counters ride the bridge's existing status payload. The server logs
accepted and refused `path_grant_request`s with the refusal cause.

## Risks / Trade-offs

- [Default-on prompts on legitimate out-of-cwd reads (sibling repo, `~/Downloads`)] → built-in roots cover pi's own files and tmp; Always allow persists per directory; one switch turns it off.
- [`bash` bypasses the gate (`cat ~/.ssh/x`)] → documented non-goal; UI copy must not call the gate confinement or a sandbox.
- [An out-of-root call stalls its sibling tool calls (sequential preflight) for up to the timeout] → accepted: the batch would otherwise run on an unapproved path; the timeout bounds it and the agent receives a reason.
- [TOCTOU: symlink swapped between gate and open] → accepted residual for an approval control; documented beside the dashboard's hard-link limitation.
- [pi changes its path resolution] → parity test fails on upgrade (D2).
- [Session-scope grants made in Settings ▸ Access do not admit agent calls] → documented; the Access page labels session-scope grants "dashboard only". Project-scope grants are the shared ones.
- [Stale bridge-side grant cache after revoke] → mtime-gated read on every out-of-cwd decision (cheap `stat`).
- [Same-user process mints a grant] → out of scope by non-goal; the D3 binding prevents cross-session, replayed and path-substituted grants only.
- [Denying a file directly in `$HOME` suppresses every other file directly in `$HOME` for 120 s in that session] → accepted: fail-closed, logged, short-lived; the agent receives `recently-denied` and can say so.
- [Parity test imports pi's `dist/core/tools/path-utils.js` by file path] → a pi repackaging fails the test with an explicit "pi path-utils not found — re-verify resolution" message, distinct from a parity mismatch.
- [Older client renders a grant with `via: "agent-prompt"`] → the Access list treats any unknown `via` as a generic prompt origin (verified by a test against the current renderer); rollback shows the grant without the agent label, still revocable.
- [Older server without `dashboard_identity`] → Always allow silently unavailable; the card says why.
- [Two `tool_call` gates once supervised mode lands] → D1 keeps the decision pure; order fixed as path gate then action gate.

## Migration Plan

Additive. No store migration: `via` gains a value older builds spread through.
`awaitingFileAccess` is a new optional session field; older clients ignore it. `grant-store-id` is created on first server start after upgrade.
Rollback: `agentPathGate.enabled=false` (or the env var) — applies from the next
tool call; reverting the code leaves written grants valid for the dashboard's
file plane.

## Doubt Review Record

Three cycles of `doubt-driven-review` at planning. Cross-model reviewer
`@propose-review-2` (zai/glm-5.3); `@propose-review-1` probed empty; the
same-family fresh-context pass returned empty output.

- **Cycle 1 (13 findings, 11 actionable):** pi-parity path resolution (`~`, `@`
  bypass), same-store detection, repeat suppression, grant bound to a confirm
  prompt, needs-you precedence, checkout-root rules, deny reason dropped,
  dismiss = deny, one time budget, component-wise comparison, MODIFIED deltas.
  Trade-offs: sibling-call stall, session-scope grants not shared.
- **Cycle 2 (9 findings, 8 actionable):** the server cannot observe answers →
  binding is to the *raised* confirmation, presence asserted by the session;
  `grant-store-id` token replaces the instance-id test; `awaitingFileAccess`
  replaces the `currentTool` overwrite; probe-timing rule; Windows test flavour;
  suppression precedence; client import ban; confirm registry in Impact.
- **Cycle 3 (9 findings, all minor/major, all actionable):** flag re-derived on
  reconnect replay; registry first-sight-only, removed on cancel, 5 s after
  dismiss; subject re-check at grant time; lexical suppression key;
  `O_EXCL` store id re-read per announce; migration re-evaluates the offer;
  chat-only placement; per-session gate mutex; `via` compatibility.

Stop condition: 3-cycle bound reached. Remaining findings were at most minor and are folded.
