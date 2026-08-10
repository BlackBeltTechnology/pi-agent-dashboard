# Design — split `notify` out of `prompt_request`

> **Revised after doubt-driven-review** (single-model + cross-model on
> `@propose-review-1`). Both reviewers independently found the same blockers.
> Two claims in the first draft were factually wrong (old Decision 4's escape
> hatch, old Decision 5's render mechanism) and one contract violation was
> missed entirely (`bridge-extension` SHALL). Corrections are marked below.

## Decision 1: A distinct message type, not a discriminator on `prompt`

Rejected alternative: leave the wire shape alone and have every consumer branch
on `prompt.type === "notify"`.

That is where the bug came from. The current code has **five** independent
consumers of a `prompt_request` (registry tracking, `currentTool` fold, unread
stamp, `questionFirst` reorder, client `interactiveRequests`) and a sixth
indirect one (the reaper's `hasPendingAsk` union). A discriminator obliges each
of them, forever, to remember the exception. Any future consumer added to the
`prompt_request` branch inherits the bug by default.

A distinct `type: "notify"` makes the correct behaviour the default: a consumer
that only handles `prompt_request` simply never sees a notify.

```
        BEFORE                              AFTER
   ─────────────────                  ─────────────────
   ui.notify ──┐                      ui.notify ──► notify ──► render + log only
               ├──► prompt_request                              (no registry,
   ask_user ───┘         │                                       no fold,
                         ▼                                       no unread,
              track / fold / unread                              no reorder)
              / reorder / interactive
                                       ask_user ──► prompt_request ──► unchanged
```

## Decision 2: The server keeps a skew guard — permanently

`@earendil-works/pi-dashboard-bridge` publishes to npm on its own cadence. A
running server pairs with whatever bridge version the user's pi install carries.
Dropping the old shape would mean: new server + old bridge = the bug persists.

So the server's `prompt_request` branch keeps an early-out:

```
 if (msg.type === "prompt_request") {
   owner/ended guard …
+  if (msg.prompt?.type === "notify") {
+    handleNotify(sessionId, fromLegacyPromptRequest(msg));  // log + deliver
+    return;                                                 // no track/fold/unread/reorder
+  }
   trackPromptRequest …
 }
```

The early-out sits *after* the owner/`ended` guard and *before*
`trackPromptRequest`.

**Corrected:** the first draft justified the placement as "it returns before the
branch's tail delivery". That was incoherent — the tail *is* `sendToSubscribers`,
which the early-out calls itself, so nothing is skipped. The real reason the
placement is load-bearing is `trackPromptRequest`: everything downstream of the
bug flows from that one call, so the guard must precede it.

**The server owns the normalization, and it is the only owner.** Because the
guard converts the legacy shape into the notify shape *before* delivery, a
browser never receives a raw `prompt_request { prompt.type: "notify" }`. The
client therefore needs **no** legacy branch — which also retires the objection
that new clients would carry both paths forever.

**The normalization must extract and normalize `level`.** An old bridge carries
the level in `component.props.level` as an unvalidated `string`, and the new
bridge's send-site normalization cannot retro-fix an already-published bridge.
So `fromLegacyPromptRequest` reads `component.props.level` and maps an
unrecognized value to `"info"`.

## Decision 3: Notify pushes to `messages[]` only, never `interactiveRequests[]`

**Corrected — this supersedes the first draft's `notifications: NotifyEntry[]`
side-list, which could not have worked.**

`addInteractiveRequest` (`event-reducer.ts:906-930`) writes to **two** places:

```
  addInteractiveRequest(id, method, params)
        │
        ├──► interactiveRequests[]  ── "the user is blocked"  ◄── the bug
        │
        └──► messages[] { id: `ui-${id}`, role: "interactiveUi", content: method }
                                     ── the chat row           ◄── what we must keep
```

`NotifyRenderer` is reachable only via `getInteractiveRenderer(method)` from an
`interactiveUi` row in `messages[]` (`ChatView.tsx:203-211`). A separate flat
side-list would therefore (a) never invoke `NotifyRenderer` at all and (b) have
no way to express "same chat position", because chat position **is** insertion
order in `messages[]`.

So the fix is a split, not a move: a notify SHALL push the `interactiveUi` row
into `messages[]` and SHALL NOT push an entry into `interactiveRequests[]`.

Consequences:
- chat position is preserved exactly — same array, same insertion order
- `registry.ts`'s `["notify", NotifyRenderer]` entry stays **required**
- no new render path, no ordering anchor, no merge mechanism to design
- the blocking semantics disappear, because they live entirely in
  `interactiveRequests[]`

## Decision 4: Notify durability needs a server-side notify log

**Corrected — the first draft missed this regression entirely.**

Today a notify survives a browser refresh, and it does so **because of the bug**:
`trackPromptRequest` stores it in `pendingPromptRequests`, and
`replayPendingUiRequests` (`browser-gateway.ts:299`) re-sends every tracked entry
to each freshly-subscribing browser socket.

Remove the tracking and the notify becomes fully ephemeral — a notify is not a
`DashboardEvent`, so it is not in the event store and `event_replay` will not
restore it either. Only browsers subscribed at fire-time would ever see it.
Contract 2 ("no regression in transcript position") forbids that.

**Replay must be idempotent.** Today `addInteractiveRequest` dedups by
`requestId`, which is what makes `replayPendingUiRequests` safe to re-fire on a
warm reconnect. The notify path bypasses that helper and so loses the free
dedup — while `replayNotifyLog` fires at both *delta* subscribe sites. The notify
reducer MUST therefore skip a row whose `ui-<notifyId>` id already exists, or a
warm reconnect duplicates every still-logged notification.

**Ordering trade-off.** Today a notify and a genuine pending prompt share one
list and replay in insertion order. Split across two logs they replay as two
batches, so a session holding both loses the interleaving. Accepted: both groups
land after the replayed event transcript either way, and the coexistence window
is now narrow because the notify is no longer permanently stuck.

**Wiring site.** `replayPendingUiRequests` is invoked from four call sites, all in
`browser-handlers/subscription-handler.ts` (`:222` stale-lastSeq full replay,
`:245` delta/full with events, `:250` delta without events, `:301` cold on-disk
hydration). A sibling `replayNotifyLog` SHALL be added and called at all four —
not folded into `replayPendingUiRequests`, which would undo the strict separation
this decision exists to establish. Touching only `event-wiring.ts` and
`browser-gateway.ts` silently drops Contract 2.

So the server keeps a **notify log**, deliberately distinct from the pending-ask
registries:

| | `pendingPromptRequests` | `notifyLog` (new) |
|---|---|---|
| semantics | user is blocked | transcript history |
| feeds `hasPendingAsk` | yes | **never** |
| feeds `currentTool` fold | yes | **never** |
| cleared by | `prompt_dismiss` / reconcile | bounded ring only |
| survives session end | no (cleared in `onUnregister`) | **yes** |
| survives server restart | no | **yes** (persisted) |
| replayed on browser subscribe | yes | yes |

**Retention (resolved at the scenario-design gate).** The log is deliberately
*not* cleared in `onUnregister`. Clearing it would make an ended session's
transcript lose rows it displayed while alive — visible before the session ended,
gone after — which Contract 2 forbids. What the reapability gate needs is not
deletion but *exclusion*: `hasPendingAsk` and `hasPendingPromptRequests` simply
never read the notify log, so a retained log cannot keep a dead session alive.
That is the whole point of the strict-separation table above.

**Persistence.** The log is persisted alongside the session JSON. The rest of a
transcript survives `/api/restart` via the event store; an in-memory-only notify
log would make notifications the one row type that silently disappears on
restart.

**Cap: 50 entries per session, oldest evicted.** Observed real usage is a handful
of notices per session (startup/status), so 50 is ~10× headroom while still
bounding a pathological emitter. The cap is deliberately modest rather than
generous because retention now spans *ended* sessions too — the bound is
multiplied across every retained session, not just live ones.

The alternative — promote notify to a real `DashboardEvent` so it rides the event
store and replays with everything else — is architecturally cleaner and would
delete the notify log entirely. It is deferred because it widens the change from
a bug fix to an event-schema change, and the event store has its own persistence
and replay-window semantics to reason about. Recorded here as the follow-up.

## Decision 5: Do not retro-clear stuck live sessions

**Corrected — the first draft's "accidental escape hatch" was wrong in both
direction and mechanism.**

The first draft claimed a browser refresh clears a stuck session via
`reconcilePromptRequests`. It does not:

- `reconcilePromptRequests` has exactly one caller,
  `reconcileAndRecomputeOnReplayExit` (`event-wiring.ts:611`), which runs at
  **bridge** replay exit (`replay_complete` or the 5s safety timeout) — the
  browser and bridge sockets are independent
- a browser refresh does the **opposite**: `replayPendingUiRequests` re-sends the
  stuck entry to the new socket, re-entrenching it

A stuck legacy session clears on **server restart or a bridge WS reconnect**,
never on a plain refresh. No migration is in scope; restart resolves it.

## Decision 6: `level` widens to include `success`

The archived `interactive-ui-dialogs` spec types notify params as
`level?: "info" | "warning" | "error"`. But `NotifyRenderer.levelColors:5`
already handles `"success"`, and the bridge proxy forwards pi's `level` as an
unvalidated `string`.

Adopting the narrow 3-value union would silently drop `success` notifications
that render today, and would force a cast at the send site — contradicting this
change's own "no `as any` at the send site" requirement.

So the wire union is `"info" | "success" | "warning" | "error"`, and the bridge
proxy normalizes an unrecognized `level` to `"info"` rather than passing it
through untyped.

## Decision 9: Old-server + new-bridge loses notifications — accepted, bounded

The third skew direction, missed until cycle 3 of review. The new bridge always
emits `type: "notify"`. The server's bridge-message dispatch is a chain of
independent `if (msg.type === …)` blocks with **no catch-all forward**, and there
is no bridge↔server version handshake. So an old server drops the message and no
notification reaches any browser for the whole skew window.

The bridge resolves the server ambiently
(`require.resolve("@blackbelt-technology/pi-dashboard-server/package.json")`, not
a declared dependency), so this pairing is genuinely reachable — a user who
upgrades pi (and with it the bridge) without upgrading the dashboard server.

**Accepted**, on three grounds:

1. Every workspace package is version-bumped and released together, so the skew
   requires a deliberate partial upgrade, not a normal one.
2. The failure mode is a missing informational toast — strictly less harmful than
   today's behaviour on that same pairing, which delivers the toast *and* leaves
   the session permanently phantom-blocked and unreapable.
3. The obvious mitigations are worse. Dual-emitting both shapes re-creates the
   ambiguity Decision 1 exists to remove and double-renders on a new server; a
   version handshake (bridge reads `/api/health#version` before choosing a shape)
   adds a startup round-trip and a new coupling for a transient window.

Rejected-for-scope, recorded so the next reader does not re-derive it.

## Decision 7: Old-client + new-server skew is an accepted trade-off

The bridge gets a permanent guard because pi installs and dashboard servers
version independently. The client does **not** get the mirror treatment, because
the client is **served by the server** — they ship as one artifact. The only skew
window is a stale cached bundle (PWA / service worker), which resolves on reload.

Accepted: an old cached client drops an unknown `notify` at its reducer
`default:` until it reloads. Documented rather than engineered around, because
the mitigation (dual-emitting both shapes from the server) would re-create
exactly the ambiguity Decision 1 exists to remove.

## Decision 8: `NotifyMessage` carries no `placement` field

**Corrected twice.** The first draft justified the guard's placement-in-code
incoherently; the second draft replaced that with a claim that the wire
`placement` field drives widget-bar suppression. That is also false.

`ChatView.tsx:992-996` suppresses a widget-bar row by reading
`params._promptBusComponent.type` and looking it up via
`isWidgetBarPrompt(type)` — whose `placement` is a **registry property**, a
different concept that merely shares the name with the wire field. The wire
`placement` (`_promptBusPlacement`) is written by both reducers
(`useMessageHandler.ts:938`, `useSessionState.ts:147`) and read by **zero**
consumers.

So `placement` on a notify would be dead data, and a widget-bar-suppression
scenario for notify is untestable: `NotifyMessage` carries no `component`, so
there is nothing for `isWidgetBarPrompt` to evaluate, and `"notify"` was never a
widget-bar component type anyway.

`NotifyMessage` therefore has no `placement` field, and the change asserts no
widget-bar behaviour for notifications.

## Verification shape

The regression is only visible at rest, so a test that asserts immediately after
the notify would pass even with the bug. The load-bearing assertion is the
**re-arm**:

1. bridge sends a notify
2. session runs a tool (`tool_execution_start` → `tool_execution_end`)
3. assert `currentTool` is `null` after the end event — *not* `"ask_user"`

Plus, for the same fixture: `unread` unset, no `questionFirst` reorder,
`hasPendingPromptRequests(sessionId) === false`, and the notify **did** reach
subscribers.

Run that fixture **twice** — once with the new `notify` type, once with the
legacy `prompt_request { type: "notify" }` shape.

Additional assertions the first draft's verification shape missed, all surfaced
by review:

- **client leak, legacy shape** — no `interactiveRequests` entry is created
- **refresh durability** — a browser subscribing *after* a notify still receives it
- **not a pending ask** — the notify log does not feed `hasPendingAsk`
- **legacy `level`** — an old-bridge notify with an unrecognized level is
  normalized to `"info"` server-side
- **warm-reconnect idempotence** — a notify already delivered live is not
  duplicated when `replayNotifyLog` fires on a delta reconnect
- **both client reducers** — `useMessageHandler.ts` (main app) and
  `useSessionState.ts` (embed) are separate switches with separate
  `addInteractiveRequest` call sites; each needs its own coverage

And a pinned negative: a genuine `ask_user` must still re-arm after
`tool_execution_end` (that is `restore-ask-user-tool-state-on-reconnect` working
as designed, and the one behaviour this change must not break).

## Open questions

- Does any plugin construct a `prompt_request` with `prompt.type: "notify"`
  directly, bypassing `ctx.ui.notify`? The Decision 2 guard covers it at runtime
  either way.
- Follow-up candidate: promote notify to a real `DashboardEvent` and delete the
  notify log (see Decision 4).
