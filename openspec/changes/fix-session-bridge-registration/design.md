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
parent's `session_shutdown`, so `prev.pi` stays set and the guard still rejects it.
Verify (task): the replacement instance's `handleSessionChange` sends a second `session_unregister`
for the already-unregistered outgoing id (`session-sync.ts:~267`); the server must treat it as a
no-op, including under `harden-bridge-session-claim` ownership gating.

## D2 — #1127: pin control frames in the send buffer

Options:
- **A. Pin control frames** — two FIFO queues (control, other) with a monotonic sequence number per
  frame; overflow evicts from `other` only (oldest first); control queue capped at 256 (oldest control
  evicted beyond that, still counted); flush merges the two queues by sequence number so wire order is
  unchanged. O(1) amortised per frame (a naive "find first evictable" scan would be O(n) per frame on
  a 10 000-frame flood).
- B. Expose/derive `maxBufferSize` from branch length — unbounded memory on a 76 MB session; rejected.
- C. Batch replay into fewer frames — protocol change across bridge+server+old bridges; rejected here.
- D. Do not buffer replay while the socket is down; replay once it opens — most correct (history is not
  truncated) but needs a first-connect hook (`onReconnect`/`onPostFlush` fire only on reconnect,
  `connection.ts:1097-1120`) and touches replay ordering/skip-wipe; follow-up.
**Chosen A** + aggregated drop report. Known residual: with A the head of a very large replay can still
be evicted while the register survives, so the server shows a truncated transcript for that session
(pre-existing, was previously masked by the session not appearing at all). The aggregated report makes
it visible; D is the follow-up (confirmed (owner, 2026-11-20), see DECISIONS).

Control set (named const `PINNED_FRAME_TYPES` in `connection.ts`): `session_register`,
`session_unregister`, `replay_complete`, `commands_list`, `models_list`, `providers_list`.
`event_forward` (incl. `replay: true`) is never pinned.

## D3 — #1128: honest wording + evidence, reclaim unchanged

Options: (a) text + evidence only; (b) also skip reclaim when the bridge is transferring data;
(c) scale the window by transcript size.
**Chosen (a)** (confirmed — owner, 2026-11-20). The `spawn-register-watchdog` spec forbids changing reclaim to
favour recovery; (b) needs per-spawn socket attribution that does not exist before a register; with
#1127 fixed a healthy-but-slow bridge registers first-frame, so (c) is moot.
`_reclaimSpawn` returns the pids it signalled; the fire path records them: failure log
`terminated: true`, `terminatedPids`, and optional fields on `SpawnRegisterTimeoutMessage`.
