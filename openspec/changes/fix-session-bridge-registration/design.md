## Context

One symptom (session absent from dashboard), three causes (#1175 guard, #1127 buffer eviction,
#1128 silent kill). Only #1127 and #1128 involve a real choice.

## D1 — #1175: release ownership on every shutdown except `quit`

Options: (a) allow-list `reload|new|resume|fork`; (b) release on every reason; (c) compare
`targetSessionFile`/session ids.
**Chosen (a)**: allow-list of the four replacement reasons; `quit` keeps the existing test E7b
("no shutdown → different pi still skipped") meaning and nothing loads after quit anyway. (b) also
works but widens the guard needlessly; (c) needs pi data that is absent for `reload`.
Safety: a subagent loads a different `ExtensionAPI` in the same process but never receives the
parent's `session_shutdown`, so `prev.pi` stays set and the guard still rejects it. Compatibility: the
package floor is pi >= 1.5.0 where all four reasons tear down and reload the runtime
(`agent-session-runtime.js:107-141`), so the release is safe. Residual (accepted, same as the existing
`reload` release): if pi shuts the owner down and never loads a replacement, `prev.pi` stays undefined and
a later different-instance load would pass the guard. This is the same fail-open window `reload` already
has.
Verify (task): the replacement instance's `handleSessionChange` sends a second `session_unregister`
for the already-unregistered outgoing id (`session-sync.ts:~267`); the server must treat it as a
no-op, including under `harden-bridge-session-claim` ownership gating. The existing
`bridge-resume-disconnect.test.ts` passes because it reuses the SAME `pi` object; the new bridge test
uses a distinct `pi2` so it cannot regress to that simulation. Relationship: the main
`bridge-extension` requirement "Bridge WebSocket survives session replacement" is the outcome contract;
the new requirement is the ownership mechanism for it.

## D2 — #1127: pin all control frames in the send buffer

Baseline (code + main spec at HEAD): commit e78b4c2c0 (#1138, archived `fix-bridge-keep-session-register-on-overflow`)
already keeps `session_register`/`session_unregister` on overflow — `bufferMessage` (`connection.ts:733`)
`findIndex`es the oldest non-lifecycle frame in the single `string[]` buffer and `splice`s it (O(n) per
eviction), gated by `isLifecycleFrame` (`:721`). It does **not** keep `replay_complete`, `commands_list`,
`models_list`, `providers_list`, has no bound on pinned frames, never reorders, and reports only the first
dropped type. This change generalises that pin; it does not introduce it.

Options:
- **A. Pin control frames** — two FIFO queues (control, other) with a monotonic sequence number per
  frame. Overflow means non-control queue length > `maxBufferSize`: evict the oldest non-control frame
  (O(1) `shift`, replacing the O(n) `findIndex`+`splice`). Control queue capped at 256 (oldest control
  evicted beyond that, still counted). Flush merges the two queues by sequence number so wire order is
  unchanged. Total retained ≤ `maxBufferSize` + 256.
- B. Expose/derive `maxBufferSize` from branch length — unbounded memory on a 76 MB session; rejected.
- C. Batch replay into fewer frames — protocol change across bridge+server+old bridges; rejected here.
- D. Do not buffer replay while the socket is down; replay once it opens — most correct (history is not
  truncated) but needs a first-connect hook (`onReconnect`/`onPostFlush` fire only on reconnect,
  `connection.ts:1097-1120`) and touches replay ordering/skip-wipe; follow-up.
**Chosen A** + aggregated drop report. Known residual: with A the head of a very large replay can still
be evicted while the register survives, so the server shows a truncated transcript for that session
(pre-existing, was previously masked by the session not appearing at all). The aggregated report makes
it visible; D is the follow-up (confirmed (owner, 2026-11-20), see DECISIONS).

No re-parsing: the buffer stores serialized strings and eviction today `JSON.parse`s each evicted frame to
learn its type (`connection.ts:744`). `send()` (`:575`) has the frame object, so it reads `frame.type`
once and passes it through `sendOne`/`bufferMessage`, storing `{ data, type, seq }`. Classification,
per-type counting and eviction never parse; `isLifecycleFrame` is removed. A test asserts no
`JSON.parse` on the eviction path. The per-type drop counts are reset when the buffer flushes.

Control set (named const `PINNED_FRAME_TYPES` in `connection.ts`): `session_register`,
`session_unregister`, `replay_complete`, `commands_list`, `models_list`, `providers_list`.
`event_forward` (incl. `replay: true`) is never pinned. Known residual (not pinned): one-shot sync
frames `session_name_update`, `first_message_update`, `usage_recorded` can still be evicted in a flood;
the session still registers. Whether to widen the set is an open owner question.

## D3 — #1128: honest wording + evidence, reclaim unchanged

Options: (a) text + evidence only; (b) also skip reclaim when the bridge is transferring data;
(c) scale the window by transcript size.
**Chosen (a)** (confirmed — owner, 2026-11-20). The `spawn-register-watchdog` spec forbids changing reclaim to
favour recovery; (b) needs per-spawn socket attribution that does not exist before a register; with
#1127 fixed a healthy-but-slow bridge registers first-frame, so (c) is moot.
`_reclaimSpawn` kills each target pid under its own try/catch (today one outer try/catch aborts the
remaining kills on the first throw, `spawn-register-watchdog.ts:338-352`) and returns the pids whose
termination it dispatched without throwing. "Signalled" means dispatched, not verified exit: the default `kill`
seam is fire-and-forget (`:134-140`) so the diagnostic is not delayed, and `killProcess` returns `ok:false`
without throwing for an already-dead pid. `terminated` therefore means "the SIGTERM → SIGKILL reclaim was
sent to these pids" — accurate for the banner (the ladder always runs to completion) and deliberately not a
liveness check; making the seam observable was rejected as extra mechanism for a negligible gain. `_fireEntry` currently appends the failure record (`:300`) before reclaim (`:316`),
so the order becomes: read stderr tail → reclaim → append failure record (with `terminated`/`terminatedPids`)
→ `ws.readyState` early return → message. Reclaim stays ahead of the early return. Record: failure log
`terminated: true`, `terminatedPids` (owned by the `spawn-failure-log` delta), and optional fields on
`SpawnRegisterTimeoutMessage`.
