## Context

Inline terminal cards (`add-inline-terminal-card`) freeze to a read-only transcript when the user clicks ✕. The transcript is read at close time from the PTY ring buffer via `TerminalManager.getTranscript`. Three facts about the current code collide:

1. `pty.onExit` (terminal-manager.ts:165) and the Windows kill fallback (:279) both call `entries.delete(id)`. That deletion is load-bearing: `list()` drops the tab, `attach()` throws, and `options.onExit(id)` drives the `terminal_removed` broadcast (`server.ts:671`).
2. `getTranscript` (:298) is `entries.get(id)?.buffer ?? ""` — no history beyond the live entry.
3. `eventStore.insertEvent` clamps events: production runs `maxStringFieldSize = 0` (per-field pass disabled) and `maxEventDataSize = 20_000`, so an over-cap event's entire `data` is replaced by `truncatedPlaceholder` — including the `terminalId` the client reducer keys on. `inline_terminal_close` is not a subagent-timeline event, so it gets no reduction path: it is placeholder-or-nothing.

## Goals / Non-Goals

**Goals**
- The transcript shown in a frozen card reflects what actually happened, including when the shell exited before the card was closed.
- `inline_terminal_close` can never lose `terminalId` to the event-store size ceiling.
- A card the user never interacted with leaves no trace, live or replayed.

**Non-Goals**
- Changing when a card freezes (still user-initiated ✕ only).
- Full-fidelity scrollback persistence. The event store is not an archive; a bounded tail is the product intent.
- Any change to non-inline terminal tabs.

## Decisions

### D1 — Tombstone map for ephemeral terminals, not deferred deletion

Keep `entries.delete(id)` exactly as-is and add a separate bounded `transcripts: Map<string, TranscriptTombstone>` where `TranscriptTombstone = { transcript: string; sawInput: boolean }`.

```
onExit / kill-fallback:
  if (entry.session.ephemeral && !released.has(id))
    transcripts.set(id, { transcript: capTranscript(buffer), sawInput: entry.sawInput })
  // NOTE: `released` is NEVER cleared here — see D1b. Both exit paths may run.
  entries.delete(id)                      // unchanged
  options.onExit?.(id)                    // unchanged

getTranscript(id) / getTerminalRecord(id) =
  live entry (buffer + sawInput)  ??  transcripts.get(id)  ??  { transcript: "", sawInput: false }
```

*Alternative rejected:* keeping the whole `TerminalEntry` alive with `status: "ended"`. It changes `list()`, `get()`, `attach()` and the tab lifecycle at once — a much larger blast radius for the same user-visible outcome, and it holds a dead `IPty` handle.

**Ephemeral-only (D1a).** Only terminals spawned with `ephemeral: true` — i.e. inline cards — write tombstones. Non-inline tab terminals produce tombstones nobody reads; under tab churn they would evict the inline entries this change exists to preserve. `entry.session.ephemeral` is already on the session, so the filter is free.

**Release is a sticky suppression flag, not a delete (D1b).** The live-close path reads the transcript from the *live* buffer and then calls `kill()`; the tombstone would be written afterwards, by the async `onExit`, and never consumed — orphaning one tombstone per normal close. A synchronous `transcripts.delete(id)` inside `kill()` cannot fix this: it races ahead of the later `onExit` write and is a silent no-op. Instead `releaseTranscript(id)` adds `id` to a `released: Set<string>` which the exit path **checks but never clears**.

Stickiness is load-bearing because `kill()` arms **two** independent exit paths: the 3 s fallback (:279, for Windows ConPTY where node-pty's `onExit` may not fire) and the real `pty.onExit` (:165). A flag cleared by whichever fires first lets the second one re-create a tombstone for an already-closed card:

| order | behavior |
|---|---|
| release → exit | exit sees the flag, skips the write |
| exit → release | tombstone exists; release deletes it AND sets the flag |
| release → fallback → late real `onExit` | both exit paths see the still-set flag; neither writes |

Terminal ids are random and never reused (`generateId` = 8 random bytes), so a sticky flag can never suppress a *different* terminal's transcript.

`released` is bounded **by time, not by count** — `RELEASED_TTL_MS = 60_000`, swept lazily. A count cap would defeat stickiness itself: evicting a closed terminal's flag lets a late real `onExit` re-create a tombstone for an already-closed card, which is precisely what the flag exists to prevent. A TTL cannot, because the only thing the flag must outlive is a late PTY exit, and the kill fallback fires at 3 s — so a 60 s TTL is provably more than sufficient (20× margin) while keeping the set self-draining rather than growing for the process lifetime. The two structures bound different things — one holds kilobyte payloads bounded by count, the other holds identifiers bounded by age — and must not share a policy.

`handleCloseInlineTerminal` calls `releaseTranscript(id)` after reading, so a closed card never leaves residue regardless of whether its PTY was already dead, and regardless of which exit path fires.

**Close is idempotent (D1c).** Because release destroys the retained transcript, a second `close_inline_terminal` for the same id would read an empty transcript and emit a second `inline_terminal_close` carrying `""` — which D3 would then interpret as "untouched" and **delete the already-frozen card**, live and permanently on replay. Today a double close is benign (idempotent last-write-wins freeze), so this would be a regression introduced by this change. Two guards, either sufficient, both cheap:

- **Server:** `handleCloseInlineTerminal` returns early without emitting **when `released.has(id)`** — evaluated *first*, before any live-entry or tombstone lookup. Ordering matters: a conjunctive guard ("no live entry AND no tombstone AND released") is defeated by concurrency. With two browsers on one session, A closes (flag set, `kill()` issued) and B closes before `onExit` fires; the entry is still live, so B falls through, reads the buffer, and emits a second close whose transcript may differ from A's. A's live view then shows T₁ while replay shows T₂ — live/replay divergence in exactly the concurrency case this change claims to handle. Checking `released` first makes the second close a no-op regardless of PTY liveness.
- **Client:** the reducer ignores an empty-transcript close targeting a row already frozen with non-empty content.
- A close for an id that never existed is likewise a no-op: it emits nothing rather than storing a stray empty close.

The double-click window is real: the frozen card has no ✗ button, but the live ✗ in `TerminalView` stays clickable for the duration of the broadcast round-trip.

**Storage:** the tombstone holds the **already-capped** string. Nothing larger than the cap can reach the client, so retaining more is dead weight. Serialized ceiling = `TOMBSTONE_CAP × TRANSCRIPT_CAP_BYTES` = 64 × 15 000 B ≈ 960 KB; JS heap cost is up to ~2× that (UTF-16 backing store), so budget ≈ **1.9 MB worst case**.

**Eviction:** insertion-ordered, oldest first, at `TOMBSTONE_CAP = 64`.

**Accepted trade-off — eviction is silent.** If a tombstone is evicted before the user clicks ✕, the close proceeds with an empty transcript and D3 removes the card: the history vanishes rather than surfacing "transcript unavailable". Emitting a marker instead would keep a card whose only content is an apology — exactly the tombstone-card noise this change exists to remove. With ephemeral-only writes (D1a) and a cap of 64, reaching eviction requires 64 dead-but-unclosed inline terminals in one session; accepted rather than mitigated.

### D2 — Cap by serialized JSON bytes, keeping the tail

**The cap must be measured in the same unit as the ceiling it protects.** `maxEventDataSize` is enforced by `exceedsSerializedSize` → `jsonStringByteSize`, which counts UTF-8 width plus JSON escape expansion. A cap on `string.length` counts UTF-16 code units. The two diverge badly on exactly the content a terminal produces:

| content | bytes per code unit | 15 000 units serializes to |
|---|---|---|
| plain ASCII | 1 | 15 000 B ✓ |
| ESC-dense colorized output (`\u001b` → 6 B) | up to 6 | up to ~90 000 B ✗ |
| CJK | 3 | ~45 000 B ✗ |
| emoji | ~4 | ~60 000 B ✗ |

A code-unit cap therefore still trips `truncatedPlaceholder` on realistic scrollback — reintroducing the destroyed-`terminalId` stuck-card bug this change exists to prevent, and doing so only for non-ASCII or colorized users, which an ASCII test fixture would never catch.

`capTranscript` therefore trims by **measured serialized size**:

```
budget = transcriptCapBytes                // derived; 15 000 at the default ceiling
if serializedSize(transcript) <= budget → verbatim
else → binary-search the largest tail slice such that
        serializedSize(MARKER + tail) <= budget
        result = MARKER + tail             // marker counted INSIDE the budget
```

The marker is inside the budget, so the spec's "SHALL NOT exceed the budget" holds at the boundary. A 75 % budget — 15 000 B against the 20 000 default ceiling — leaves 5 000 B for the rest of the envelope, and the non-transcript payload measures ~52 B, so the margin is still three orders of magnitude larger than needed.

The elision marker matches the store's existing `capString` precedent: `…[N chars hidden]…` followed by a newline.

The size measurement reuses the store's own byte accounting. `measureBytes` and `exceedsSerializedSize` are already exported from `memory-event-store.ts`, and `measureBytes` returns a `cap + 1` sentinel when over — directly usable as the binary-search comparator. `jsonStringByteSize` is module-private and stays that way.

**The cap must be derived, not a second literal (D2a).** `maxEventDataSize` is a `createMemoryEventStore` constructor parameter, currently sitting at its 20 000 default only because `server.ts:650` does not pass one. A hardcoded budget elsewhere in the tree is an invariant nobody re-checks: the day someone threads a config knob through, `terminalId` silently starts dying again.

*Where the derivation lives.* `EventStore` exposes no ceiling accessor and `BrowserHandlerContext` carries no config, so "ask the store at close time" is not implementable without widening the store's public surface. It is also unnecessary: **`server.ts` already owns both values** — it builds the store and the terminal manager in the same scope, and `DEFAULT_MAX_EVENT_DATA_SIZE` is already exported. The derivation therefore happens once at wiring time:

```
ceiling = config.maxEventDataSize || DEFAULT_MAX_EVENT_DATA_SIZE   // 0 = size pass off ⇒ fall back
transcriptCapBytes = floor(ceiling * 0.75)                          // 15 000 B at the default
```

and is passed to the terminal manager as an option. `capTranscript(s, capBytes)` takes the budget as a parameter rather than closing over a module constant, which also makes it directly testable at arbitrary budgets.

*Startup invariant — two knobs, not one (D2b).* Both truncation knobs can break the guarantee, and both are already configurable (`config.ts:653` reads `maxStringFieldSize`; `:652` reads `maxEventsPerSession`):

| configuration | failure |
|---|---|
| `maxEventDataSize = 0` | size pass disabled → a naive `fraction × 0` budget makes **every** transcript empty → D3 removes every interacted card |
| `maxStringFieldSize > 0` | the store's per-field `capString` re-caps in **code units**; 4 000 ESC characters serialize to ~24 KB → back over the ceiling → `terminalId` destroyed again |

So the boot check is:

```
ceiling = maxEventDataSize || DEFAULT_MAX_EVENT_DATA_SIZE   // 0 ⇒ size pass off ⇒ fall back, never a 0 budget
assert  derivedCap < ceiling
assert  maxStringFieldSize === 0 || maxStringFieldSize * 6 < ceiling
```

Factor 6 is the worst-case serialized expansion of a single code unit: a C0 control such as ESC serializes to `\u001b`, six bytes. A per-field cap that can survive that expansion and still land under the byte ceiling is safe; one that cannot is rejected at boot rather than silently corrupting events months later.

The same `capTranscript` is used by the tombstone write (D1) and the emit site, so the two cannot diverge.

*Why tail, not head:* a frozen transcript is read to answer "what happened at the end". The existing `capString` generic branch is head+tail 50/50; for a terminal scrollback the tail alone is strictly more useful, so this deliberately diverges.

*Accepted cosmetic defect:* the cut point can split a surrogate pair or a partial CSI sequence. xterm tolerates both.

### D3 — "Never interacted with" is tracked server-side; the client tests only for the empty string

Two text-inspection rules were considered and both rejected.

**Rejected — "≤ 1 non-empty line after stripping ANSI and control characters":**
- It inverts under a plausible implementation. C0 controls include LF; a natural `/[\x00-\x1f\x7f]/g` strip removes the newlines *before* the line count, collapsing every transcript to one line — every closed card would disappear, live and on replay.
- It is factually wrong on this change's own repro. Typing `exit` yields a one-line transcript, so the flagship "exit then close preserves the transcript" scenario would *delete* the card. Symmetrically, multi-line prompts (powerlevel10k and friends) make an untouched terminal read as non-blank, so "opened and closed untouched leaves no card" fails for those users.

**Rejected — "no non-whitespace content after stripping ANSI/OSC and control characters":** safer than the line count, but it still asks the rendered text a question only the input stream can answer, and it disagrees with the server in the *harmful* direction. A user who pressed only arrow keys or Tab has `sawInput = true` and gets a real transcript, yet that transcript strips to nothing — so the client deletes a card the user demonstrably interacted with, the exact inverse of the requirement. It also needs a greenfield ANSI-strip regex: no such utility exists anywhere in `packages/client/src/lib`, so the LF trap above would live in newly written code with no prior art to copy from.

**Adopted — one predicate, server-side.** PTY input flows through exactly one place: the `ws.on("message")` handler in `attach()` (terminal-manager.ts:190-224 holds the only `pty.write` statements in the repo; `terminal-gateway.ts` never writes, and there is no REST, bus, or extension input path). Set `entry.sawInput = true` there.

1. **Server (`handleCloseInlineTerminal`):** if the terminal never saw input, emit `transcript: ""`. Otherwise emit the capped transcript verbatim.
2. **Client (`event-reducer.ts`):** remove the row when `transcript === ""`. Nothing else — no stripping, no regex, no heuristic.

This is strictly better than any text rule: there is only one predicate, so client and server cannot disagree; the evicted-tombstone path (D1) also emits `""` and degrades into removal; and no new ANSI-parsing code enters the client.

*Why live and replay agree (D3a — load-bearing, currently implicit).* The agreement is not a property of the rule; it is a property of the handlers. Both `handleOpenInlineTerminal` and `handleCloseInlineTerminal` insert the event and then broadcast **the stored event read back from the store** (`broadcastEvent?.(sessionId, seq, stored)`), so the live path and the replay path consume byte-identical payloads — including any truncation the store applied. A refactor to broadcast the pre-insert object instead would silently break the agreement while every test still passed. This is pinned as a requirement, not left as an implementation accident.

The accepted cost is narrow: a transcript that is genuinely empty *despite* input having occurred would be removed rather than frozen. TTY echo makes that near-impossible to produce in practice.

### D3b — Inline terminal lifecycle events must survive per-session trim

The reducer's card position depends on `inline_terminal_open` being present at its original position in the stream. `trimBufferToLimit` drops the oldest **non-essential** events under pressure, and `ESSENTIAL_CHAT_EVENT_TYPES` currently contains only `message_start` / `message_end`. `maxEventsPerSession` is config-driven, and the store's own comments document subagent floods of thousands of events.

So in a long session the `open` can be trimmed while its `close` survives. Replay then hits the reducer's defensive close-without-open branch and appends a frozen card **at the end of the stream** rather than at its original position — breaking both "Open event fixes card position" and the live/replay agreement, in a way no test that always replays `open` would ever catch.

Both `inline_terminal_open` and `inline_terminal_close` are therefore added to the essential set. They are rare, small, and structurally paired; trimming one of a pair is never the right shed.

No protocol change — `transcript` stays a string; `sawInput` is server-internal and never crosses the wire.

*Consequence for D5:* the exit-then-close repro freezes correctly (input was seen), and the untouched-terminal case is removed regardless of how many lines the prompt occupies. Both flagship scenarios hold, which no text rule managed simultaneously.

### D4 — No auto-close on PTY exit

Rejected. `options.onExit(terminalId)` has no session id and no inline-card association, so auto-emitting `inline_terminal_close` requires a new terminal→(session, inline) registry. The card already visibly stops responding when its socket closes (`terminal-gateway.ts` destroys the socket; the client renders "[Terminal disconnected]"). The user closes it. Revisit only if the dead-but-live card proves confusing in practice.

*Known cosmetic divergence:* the frozen transcript is the PTY's output, so it lacks the client-rendered "[Terminal disconnected]" line the user saw live. Accepted.

### D5 — Interaction between D1/D2/D3

The three rules meet on the exit-then-close path: the tombstone supplies the transcript (D1), the byte cap keeps `terminalId` alive through persistence (D2), and `sawInput` keeps the card from being wrongly removed (D3). Tests must cover that path end-to-end, not just the three rules in isolation. The untouched-terminal path exercises the same three in the opposite direction.

## Risks / Trade-offs

| Risk | Mitigation |
|---|---|
| Tombstone map grows unbounded | Ephemeral-only writes + hard insertion-ordered cap + release-on-close; ~768 KB heap worst case. |
| Byte-measured cap is slower than a `slice` | Binary search over a bounded string, once per card close. Irrelevant at this frequency. |
| `sawInput` misses an input path | Exactly one `pty.write` call site for user input (`attach`'s message handler), verified repo-wide. A test asserts the flag flips on a keystroke frame and stays false without one. |
| A future client control message flips `sawInput` | The handler writes any unrecognized text frame to the PTY, so a new control message would both corrupt the PTY and flip the flag. Sound today (only `resize` is sent); a test pins that `resize` does NOT flip it. |
| Double close deletes a frozen card | D1c: server early-return + client guard, with a test for each. |
| Cap drifts out of sync with `maxEventDataSize` | D2a: the cap is derived from the ceiling, plus a startup invariant and an acceptance test through a real store. |
| Multibyte content still surprises | The acceptance test fixture is CJK + emoji + ANSI, not ASCII. |

## Migration / Rollback

No schema, protocol, or persisted-format change. `inline_terminal_close` keeps `{ terminalId, transcript }`. Rollback is a plain revert; already-stored events replay identically under either version, except that pre-existing blank ones stop rendering a card (the desired behavior) and start rendering again after a revert.

## Resolved parameters

Settled during scenario design (see `test-plan.md` clarifications C1–C6):

| parameter | value | rationale |
|---|---|---|
| `TOMBSTONE_CAP` | 64 | headroom over the plausible open-but-unclosed count; ~1.9 MB heap worst case |
| budget fraction of ceiling | 75 % → 15 000 B at the default | envelope is ~52 B, so the margin is ample; keeps more transcript |
| `released` bound | TTL 60 s, lazily swept | time-bounded, not count-bounded, so eviction can never defeat stickiness (fallback fires at 3 s — 20× margin) |
| unsafe-config predicate | `maxStringFieldSize * 6 >= ceiling` ⇒ fail startup | 6 = worst-case serialized bytes per code unit (`ESC` → `\u001b`) |
| elision marker | `…[N chars hidden]…` + newline | matches the existing `capString` precedent |
| close-path latency budget | p95 < 500 ms, close → frozen card, measured e2e | the only perf requirement; the byte-measured binary search is not separately budgeted |

## Open Questions

None outstanding.
