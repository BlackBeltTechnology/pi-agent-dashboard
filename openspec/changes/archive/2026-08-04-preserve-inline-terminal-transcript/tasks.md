> Scenario ids (E#/P#/F#/X#) reference `test-plan.md`, which is the source of truth for automated-vs-manual disposition. All 44 rows are `automated`; there are no `manual-only` rows to defer. TDD order: author the failing test, verify it fails, then implement.

## 1. Transcript cap helper (red first)

- [x] 1.1 Author `capTranscript` byte-boundary tests in `packages/server/src/__tests__/terminal-manager.test.ts` (see the existing `RingBuffer` describe block for harness glue) — **E1** exactly-15 000 B verbatim, **E3** 14 999 B verbatim, **E6** empty string, **E7** near-cap where the marker exceeds the overflow (result incl. marker ≤ budget). (test-plan #E1,#E3,#E6,#E7)
- [x] 1.2 Author the unit-vs-byte tests, same file — **E4** 15 000 CJK code units (~45 000 B) truncates; **E5** 8 000 ESC-dense units (~48 000 B) truncates. Both assert serialized size ≤ 15 000 B, proving the cap measures bytes not `length`. (test-plan #E4,#E5)
- [x] 1.3 Author **E2**: 15 001 B input → result begins `…[N chars hidden]…\n`, tail preserved, serialized size ≤ budget. (test-plan #E2)
- [x] 1.4 Verify group 1 FAILS (export missing).
- [x] 1.5 Implement `capTranscript(s: string, capBytes: number): string` in `packages/server/src/terminal/terminal-manager.ts` — binary-search the largest tail slice whose serialized size including the marker fits, using `measureBytes` from `memory-event-store.ts` (already exported; returns a `cap + 1` sentinel usable as the comparator). Budget is a parameter, never a module constant. Marker `…[N chars hidden]…\n` matches the `capString` precedent.

## 2. Derived budget + startup validation (red first)

- [x] 2.1 Author config-validation tests — **E12** `maxStringFieldSize=0` passes; **E13** `3334` with ceiling 20 000 fails naming both values; **E14** `3333` passes; **E15** `maxEventDataSize=0` yields a 15 000 budget, not 0. (test-plan #E12,#E13,#E14,#E15)
- [x] 2.2 Verify group 2 FAILS.
- [x] 2.3 Implement the derivation at wiring time in `packages/server/src/server.ts`: `ceiling = config.maxEventDataSize || DEFAULT_MAX_EVENT_DATA_SIZE`, `transcriptCapBytes = floor(ceiling * 0.75)`, passed to `createTerminalManager` as an option.
- [x] 2.4 Implement the boot assertions: `derivedCap < ceiling`, and `maxStringFieldSize === 0 || maxStringFieldSize * 6 < ceiling` (6 = worst-case serialized bytes per code unit, `ESC` → `\u001b`). Fail loudly with both values in the message.

## 3. Transcript tombstone + input tracking (red first)

- [x] 3.1 Author retention tests in `terminal-manager.test.ts` (see the existing "fallback cleanup fires if onExit does not within 3 s" test for the mock-PTY + fake-timer glue) — **X2** removal semantics after exit (`list()` excludes, `get` undefined, `attach` throws, `onExit` invoked); **X3** kill-fallback path retains a capped transcript when the mock PTY never fires `onExit`. (test-plan #X2,#X3)
- [x] 3.2 Author bound tests — **E8** 65th exit evicts the oldest; **E9** exactly 64 all retained. (test-plan #E8,#E9)
- [x] 3.3 Author ephemeral-filter tests — **E10** ephemeral retains / non-ephemeral does not; **E11** 100 non-ephemeral spawn+exit do not evict a retained ephemeral. (test-plan #E10,#E11)
- [x] 3.4 Author suppression tests — **X5** release-then-exit writes nothing; **X4** fallback → close → late real `onExit` leaves no tombstone; **X6** suppression still in force at 59 s; **X7** record reclaimed past the 60 s TTL. (test-plan #X4,#X5,#X6,#X7)
- [x] 3.5 Author input-tracking test **F6**: a `{"type":"resize"}` control frame does NOT set `sawInput`; a keystroke frame does. (test-plan #F6)
- [x] 3.6 Verify group 3 FAILS.
- [x] 3.7 Implement `transcripts: Map<id, {transcript, sawInput}>` (insertion-ordered, `TOMBSTONE_CAP = 64`) written in `pty.onExit` (:165) and the kill fallback (:279) **before** `entries.delete(id)`, gated on `entry.session.ephemeral && !released.has(id)`. Never clear `released` in the exit path.
- [x] 3.8 Implement `released: Map<id, timestamp>` with `RELEASED_TTL_MS = 60_000`, lazily swept; `releaseTranscript(id)` sets the record and deletes any tombstone.
- [x] 3.9 Implement `sawInput` on `TerminalEntry`, set in the single `pty.write` site inside `attach`'s `ws.on("message")` handler (the only user-input write path in the repo).
- [x] 3.10 Implement the `getTranscript` tombstone fallback and confirm groups 1–3 pass with the pre-existing terminal-manager tests unchanged.

## 4. Close handler (red first)

- [x] 4.1 Author the **acceptance gate X1** in `packages/server/src/__tests__/inline-terminal-handler.test.ts`: scrollback far over the ceiling, mixed CJK + emoji + ANSI, inserted through a real `createMemoryEventStore` with production args (`maxStringFieldSize = 0`, default `maxEventDataSize`) → `data.terminalId` intact, `data.transcript` non-empty, no `__truncated`. (test-plan #X1)
- [x] 4.2 Author idempotency tests — **X8** second close emits nothing; **X9** concurrent second close arriving while the entry is still live emits nothing and live transcript == replay transcript; **X10** unknown id emits nothing and does not throw; **X13** close-then-evict-then-duplicate-close preserves content. (test-plan #X8,#X9,#X10,#X13)
- [x] 4.3 Author **X11**: evicted tombstone → close emits `transcript:""` without throwing. (test-plan #X11)
- [x] 4.4 Verify group 4 FAILS.
- [x] 4.5 Implement `handleCloseInlineTerminal`: check `released.has(id)` **first** (before any liveness or tombstone lookup) and return without emitting; else read the record, emit `""` when `sawInput` is false otherwise `capTranscript(transcript, transcriptCapBytes)`, then `releaseTranscript(id)`. Keep broadcasting the **stored** event read back from the store, never the pre-insert object.

## 5. Event-store essentials (red first)

- [x] 5.1 Author **F12** in `packages/server/src/__tests__/memory-event-store.test.ts` (see the existing per-session trim describe block): drive the buffer past `maxEventsPerSession` with an old inline `open`/`close` pair → neither event dropped, and reducing the trimmed buffer places the card at its original position. (test-plan #F12)
- [x] 5.2 Verify 5.1 FAILS.
- [x] 5.3 Add `inline_terminal_open` and `inline_terminal_close` to `ESSENTIAL_CHAT_EVENT_TYPES`.

## 6. Reducer (red first)

- [x] 6.1 Author predicate tests in `packages/client/src/lib/__tests__/event-reducer.inline-terminal.test.ts` — **E16** `transcript:""` removes the row; **E17** single ANSI-decorated prompt line stays frozen; **E18** whitespace-only stays frozen. E17/E18 exist specifically to prove no text inspection was reintroduced. (test-plan #E16,#E17,#E18)
- [x] 6.2 Author **X12**: an empty close targeting a row already frozen with non-empty content leaves that row intact. (test-plan #X12)
- [x] 6.3 Verify group 6 FAILS.
- [x] 6.4 Implement in `event-reducer.ts` `inline_terminal_close` (~:1995): when `transcript === ""` splice the matched row out (and append nothing in the defensive close-without-open branch); otherwise freeze as today. Guard per 6.2. No ANSI stripping, no line counting, no whitespace analysis.

## 7. End-to-end behaviour (Playwright)

> All L3 rows run against the docker harness on the port derived in `.pi-test-harness.json` (`dashboardPort`) — never a hardcoded `:18000`. Copy harness glue from the nearest existing spec for this surface in `tests/e2e/`.

- [x] 7.1 Author **F1** (flagship repro): run `ls`, type `exit`, click ✕ → frozen read-only card showing the pre-exit scrollback. (test-plan #F1)
- [x] 7.2 Author **F2** open via bare `!!` and close untouched → no card, no placeholder; and **F3** same with a 3-line shell prompt → still removed. (test-plan #F2,#F3)
- [x] 7.3 Author **F4** type only `exit` → frozen not removed; and **F5** press only arrow keys / Tab → frozen not removed. (test-plan #F4,#F5)
- [x] 7.4 Author **F7** reload after `open` + empty `close` → no card; and **F8** reload after `open` + non-empty `close` → frozen at its original stream position. (test-plan #F7,#F8)
- [x] 7.5 Author **F9**: two browsers, one stays connected and one reloads after the close → identical card state and identical transcript bytes. (test-plan #F9)
- [x] 7.6 Author regression rows **F10** live-PTY reattach on reload and **F11** dead-PTY reattach shows the disconnected notice — both must be unchanged by this change. (test-plan #F10,#F11)
- [x] 7.7 Author **P1**: close a card holding a full 256 KB scrollback, 20 iterations, assert p95 < 500 ms from click to frozen card rendered. (test-plan #P1)

## 8. Verify

- [x] 8.1 `npm test 2>&1 | tee /tmp/pi-test.log` then `grep -nE 'FAIL|Error|✗|✘' /tmp/pi-test.log` — clean.
- [x] 8.2 `npm run test:e2e` against the harness — clean.
- [x] 8.3 `npm run quality:changed` — clean.
- [x] 8.4 Rebuild per the `implement` skill matrix: server + shared changed ⇒ `curl -X POST http://localhost:8000/api/restart`; client changed ⇒ `npm run build` then restart.

## 9. Docs

- [x] 9.1 Update the purpose row in `packages/server/src/terminal/terminal-manager.ts.AGENTS.md` — `capTranscript` export, ephemeral-only transcript retention, `released` TTL suppression, `sawInput`, `See change: preserve-inline-terminal-transcript`.
- [x] 9.2 Update `packages/client/src/lib/chat/event-reducer.ts.AGENTS.md` — empty-transcript row removal on `inline_terminal_close`.
- [x] 9.3 Update `packages/server/src/persistence/memory-event-store.ts.AGENTS.md` — inline terminal lifecycle events added to `ESSENTIAL_CHAT_EVENT_TYPES`.
- [x] 9.4 Delegate any `docs/` prose write to DocScribe in caveman style (only if QA surfaces something worth an FAQ entry).
