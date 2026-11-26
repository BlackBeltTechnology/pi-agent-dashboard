# Review gate notes — `add-agent-teams-ui` tasks 3.1 + 3.2

Method: `doubt-driven-review` (adversarial, evidence-based, 2 cycles).
Cross-model status: **skipped — no subagent-spawn tool exists in this environment**,
so no `@propose-review-N` pass could run; single-model adversarial pass performed
as degraded self-review against REAL core file:line (not memory). Owner decisions
(design D14) were not reopened. Cycle 2 re-read every finding against the
artifact text; no new blockers; stop condition met.

## 3.2 — Core-name verification (all names exist; nothing is MISSING)

| # | Name UI relies on | Verdict | Evidence (worktree paths) |
|---|---|---|---|
| 1 | `formatEnvelope` | PRESENT-as-assumed | `shared/mail-format.ts:82` — `(kind,sender,urgent)`, throws on bad kind/sender, `· urgent` segment |
| 2 | `parseEnvelope` | PRESENT-different | `shared/mail-format.ts:103` — first-line-only, `{kind,sender,urgent,known,label,body}`, null on malformed; but sender is **not** validated (any `[a-z][a-z0-9-]{0,31}`, so `system`/`all`/`user` also parse) and the peer-note group is permissive. Reserved/grammar rejection is UI-side work using #10. |
| 3 | `store.on` — `change` | PRESENT-as-assumed | `server/store.ts:116` (`on`), `:33` map, `:142-145` emit `{team, rev}` with in-memory monotonic `rev` (`:91-160`, reset on restart) |
| 4 | `store.on` — `team_created` / `lead_bound` / `team_closed` | PRESENT-as-assumed | `server/store.ts:238` (`{team}`), `:259` (`{team, rebind}`), `:283` (`{team}`) |
| 5 | `abortMember(team,name,{actor:'user'})` | PRESENT-different | `server/ops.ts:700` — actor `user` valid (`server/types.ts:48`); **but** codes are `unknown_recipient` / `member_gone` / `interrupt_unavailable`, NOT `not_busy`/`not_connected` (UI mapping job, see F1); **and** success always enqueues core's own waking notice (`:707`), colliding with the wrapper's task-list notice (see F2) |
| 6 | `teamDelete(team,{actor:'user',force:true})` | PRESENT-as-assumed | `server/ops.ts:718` — `user` always forces (`:721`); `closed`→`team_closed` (`:719`); lead session never shut down (`:712-717`); repeat on `closing` re-posts member mails (only the grace timer is guarded, `:752-758`) → UI must not call twice (see F4) |
| 7 | `setRouteVisibility` | PRESENT-as-assumed | `server/extension-points.ts:52,113` — `(team, req) => boolean\|Promise`, default allow-all; fail-closed + 1000 ms timeout enforced core-side (`server/routes.ts:56-70`, `ROUTE_VISIBILITY_TIMEOUT_MS`, `shared/constants.ts:59`) |
| 8 | `Team.owner` / `leadSessionId` / `closeReason` | PRESENT-as-assumed | `shared/types.ts:109` (`owner?: string`), `:98` (`leadSessionId?`, unset while `starting`), `:105` + `:10-18` (`CloseReason` incl `"user"`; user actor defaults to it, `ops.ts:724`) |
| 9 | `enqueueLeadNotice(team,{text,wake})` | PRESENT-as-assumed | `server/ops.ts:328` — drains coalescer first, `Mail\|undefined`; queues while lead absent, `mailer.flush(LEAD)` on (re)bind (`ops.ts:415-419`) — orphaned-stop/shutdown notices are covered |
| 10 | Snapshot `rev` / `mailTotal` | PRESENT | `server/snapshot.ts:98` (`rev`), `:105` (`mailTotal: log.length`); wire shape `shared/snapshot.ts` (`truncated`, `SNAPSHOT_MAIL_LIMIT=100`, `SNAPSHOT_MAIL_TEXT_MAX=2000`, `constants.ts:57-58`) |
| 11 | Member-name grammar exports | PRESENT | `MEMBER_NAME_REGEXP` + `MAX_LENGTH=32` (`constants.ts:14-15`), `RESERVED_MEMBER_NAMES` / `RESERVED_SENDERS` (`:21-23`), `ENVELOPE_LIMITS={40,200}` (`:64`); all re-exported via `shared/index.ts` (import, never copy) |
| 12 | Rate-limit constants | PRESENT | `REST_READ_RATE={8,16}`, `REST_WRITE_RATE={2,5}` (`constants.ts:53-54`); enforced in `routes.ts` via `@fastify/rate-limit` |
| 13 | Resume persisted `closing` at startup | PRESENT | `resumeClosing()` (`ops.ts:776`) called at startup (`runtime.ts:124`); no-timer `closing` closes at once, else re-requests shutdown (reason fallback `team_delete`) |
| 14 | Mail line caps | PRESENT | `MAX_MAIL_LINES=150`, `capMailLines`/`collapseBlankRuns`/`truncationMarkerLine` — applied at chat render (`bridge/index.ts:249` via `formatMail`), marker counted inside the cap (`mail-format.ts:143-151`); snapshot path is char-capped only (see N3) |
| 15 | Notice markers `• ` / `│ ` | PRESENT | `formatNoticeItem` (`mail-format.ts:172`) used by `renderNoticeItem` (`notices.ts:43-46`); flush joins items, wake = any (`notices.ts:57-69`); peer envelope-lookalikes neutralised with `│ ` (`mail-format.ts:153`) so peer text can never start an item |
| 16 | Lead-stamp key `agent-teams-lead` | PRESENT-as-assumed | Pending registry accepts any non-reserved key, `agent-teams-lead` not reserved (`pending-plugin-ref-registry.ts:27-51,124-151`); binder reads only `ref["agent-teams"]` + member string (`spawn.ts:284-301`) or `role:"lead"` (`ops.ts:944-952`) → stamp ignored; `assignSessionRef` trusted-gated at priority ≤100 (`server.ts:4639`), plugin priority is 100 (`package.json:49`); `undefined` deletes, `null` survives JSON (`plugin-refs.ts` merge/project); bag ≤16 KiB, persisted + projected top-level |

No MISSING items: no additive core change is required for names. One additive
request is recommended for F2 (default-preserving opt-out, not a semantic change).

## 3.1 — Doubt findings (before §4–§8 depend on them)

### F1 — blocking — Stop outcome mapping lives UI-side, not in core
`abortMember` cannot produce the spec's outcomes by itself: `isLive` = not
`gone`/`failed` (`op-util.ts:21`), so `idle`/`spawning`/`shutdown_pending`/
`disconnected` reach `driver.abort` → host `abortSession` (`driver.ts:154-162`,
host semantics unverified); `interrupt_unavailable` conflates "busy, no live
connection" with "host refused"; nothing checks team `closing`/`closed`.
Resolution: the route MUST pre-check from the store — status
`closing`/`closed` → `409 team_closed`; `status!=="busy"` → `409 not_busy`
(`disconnected` → `409 not_connected`) — and map `unknown_recipient`→404
(same bytes as unknown team), `interrupt_unavailable`→`409 not_connected`.
The settle race stays as specified (12.14 accepts either order).

### F2 — blocking — Stop queues TWO waking notices, tests demand one
Core success path always enqueues `"${name}'s current run was stopped by
${actor}; …"` (`ops.ts:707`); the §5.2 wrapper adds a second item with task
ids. That is 2 waking items in one coalesced mail, contradicting 12.6
("exactly one … naming member + owned tasks") and 12.38 ("exactly 1").
Resolution (pick one before §5): (a, preferred) request additive core
`abortMember` opt-out, e.g. `opts {notify?: boolean}` defaulting true — no
semantic change — UI passes `notify:false` and enqueues the single task-list
item; or (b) restate spec/tests to two items. Do not special-case by text.

### F3 — blocking — UI status pre-check is load-bearing (spurious-stop risk)
Without F1's `busy` pre-check, an `idle` member with a live session can return
host-abort-true and collect a false "stopped by user" waking notice. Same
resolution as F1; call out explicitly in `user-actions.ts`: never rely on core
to reject non-busy.

### F4 — non-blocking — Shutdown repeat guard must be check-and-set, in-flight included
Core re-posts member mails on a `closing` re-call (`ops.ts:736-751`; only the
timer is guarded). The route must answer 202 for `closing` WITHOUT calling
`teamDelete`, plus an in-flight promise guard for the active/active race
(12.13 already demands call-count 1). Status check alone is insufficient.

### F5 — non-blocking — `agent-teams-idle` mails are currently never emitted
No server path calls `mailTo` with `kind:"idle"` (S18 server-half lists
message/broadcast/task_assigned/shutdown_request/notice/spawn_prompt;
`mail-format.test.ts:213`); idle/errored-idle reports travel as coalesced
NOTICE items (`ops.ts:915-933`, error head `"${name} stopped with an error"`,
waking). Keep the idle card as forward-compat (contract tests format the
envelope directly) but do not assume chat traffic of that customType on day one;
the "no error-severity idle card" stance is consistent because errors arrive as
notice items, not idle mails.

### N1 — non-blocking — Header-truncation path is defensive, keep it
Bridge caps at 150 lines < host 200-line cap, so `«N earlier lines hidden»`
cannot occur via `formatMail`; the D4 fallback is unreachable-but-cheap. Keep;
covers non-core producers.

### N2 — non-blocking — Snapshot mail is char-capped, not line-capped
`SNAPSHOT_MAIL_TEXT_MAX=2000` bounds the message log, not `MAX_MAIL_LINES`;
a many-short-lines snapshot text is legal. The log's 400-char clamp + per-row
disclosure already handles it; no core ask.

### N3 — non-blocking — `assignSessionRef` true ≠ applied; reconcile cost
It returns `true` on empty sanitize (no-op stamps invisible); only `false`
(untrusted/unknown session) and throws are detectable — sufficient for 12.40's
log-once. `reconcileStamp` on every `change` event runs per rev bump (mail
acks included): keep it a cheap store scan, no I/O.

## Gate verdict

§4–§8 may proceed once F1–F3 are resolved as above (all UI-side except the F2
core-flag request, which has fallback (b)). No owner decision reopened.
