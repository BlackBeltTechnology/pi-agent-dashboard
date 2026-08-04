## 1. Facts (gathered — recorded, do not re-derive)

- [x] 1.1 Root cause proven: `truncateStrings` exempts `data`+`mimeType` (line 224);
      `exceedsSerializedSize` trips the 20 KB ceiling → `{__truncated}` → no
      `data.message` → no row, silently.
- [x] 1.2 Measured end-to-end at production defaults: 8/8 over-ceiling assistant messages
      survive; 3/3 image-bearing user messages collapse.
- [x] 1.3 Size distribution (n=1587, 3137 transcripts): p50 125.7 KB, p90 757.3 KB,
      p99 2233.3 KB, max 10.5 MB. Raw ceiling coverage at 256 KB is only 74.9 %.
- [x] 1.4 Resize (n=40, jimp 768 px/q75): p50 42 KB, p90 101 KB, **max 212 KB** — the
      tail becomes bounded, which is what makes a 256 KB ceiling deterministic.
- [x] 1.5 Resize cost: 174–874 ms single-threaded → must be offloaded.
- [x] 1.6 Only `type:"image"` carries `data`+`mimeType` in real data.
- [x] 1.7 `pi-image-fit` is installed but unusable here (ephemeral caches, pi-session
      process, model-input policy) — use jimp directly.

## 2. Resolve remaining design decisions

- [x] 2.1 D9 — **accept** the `0.75 ×` coupling and the 15 KB → 192 KB terminal-cap shift;
      document it. Derivation stays coupled; the boot assert keeps validating the pair.
- [x] 2.2 D10 — **cache** fitted derivatives on disk keyed by content hash; a miss re-fits.
      Optimisation only, never a source of truth.
- [x] 2.3 D11 — **exempt** animated GIFs from fitting; they stay subject to the existing
      ceiling and truncate as today. Never emit a corrupt frame (X10).

## 3. Tests — L1 unit (vitest)

All L1 rows extend `packages/server/src/__tests__/memory-event-store.test.ts`
(harness exemplar: that file's `createMemoryEventStore(neverPinned)` fixtures).

- [ ] 3.1 E1/E2/E3 fitting bounds the event (test-plan #E1 #E2 #E3) — input 10.5 MB / 2.2 MB /
      126 KB image · trigger ingest · observable stored event ≤ 256 KB with `data.message`.
      **Must fail before implementation.**
- [ ] 3.2 E4/E5/E6 no-upscale + fit boundary (test-plan #E4 #E5 #E6) — input 0.2 KB, 767 px,
      769 px · trigger ingest · observable unchanged / unchanged / long edge 768 px.
- [ ] 3.3 E7 message survives (test-plan #E7) — input text + 10.5 MB image · trigger
      ingest · observable event is not `{__truncated}`, `data.message.role === "user"`.
- [ ] 3.4 E8 many attachments (test-plan #E8) — input 20 × 2 MB blocks · trigger ingest ·
      observable event ≤ 256 KB, all blocks fitted.
- [ ] 3.5 E9 replay is fitted (test-plan #E9) — input JSONL with inline 5 MB image ·
      trigger replay · observable emitted event ≤ 256 KB.
- [ ] 3.6 E10 fitted max fits ceiling (test-plan #E10) — input 212 KB fitted image ·
      trigger ingest · observable under ceiling, no truncation.
- [ ] 3.7 E11/E12/E13 boot assert armed (test-plan #E11 #E12 #E13) — input cap unset + 256 KB /
      cap unset + 20 KB / cap 50_000 + 256 KB · trigger boot · observable passes / throws
      / throws. E12 is the negative proof the assert no longer skips.
- [ ] 3.8 E14/E15 content-type allow-list (test-plan #E14 #E15) — input jpeg/png/gif/webp
      and a blob claiming `text/html` · trigger serve · observable allow-listed type,
      never active content.
- [ ] 3.9 X1/X2 authorisation (test-plan #X1 #X2) — input unauthorised caller and a
      wrong-session caller with a valid hash · trigger GET original · observable refused.
- [ ] 3.10 X3 path safety (test-plan #X3) — input id with `../` or non-hex · trigger GET ·
      observable rejected, no fs access outside the store root.
- [ ] 3.11 X4/X5/X6 recovery + eviction (test-plan #X4 #X5 #X6) — input evicted blob with
      transcript intact / at 2 GB cap / transcript deleted · trigger GET · observable
      recovered / still retrievable / clean 404 without crash.
- [ ] 3.12 X7/X8/X9 worker faults (test-plan #X7 #X8 #X9) — input worker crash / saturated pool
      / undecodable bytes · trigger ingest · observable message stored with `data.message`,
      attachment resolves to failed state, event loop not blocked.
- [ ] 3.13 X10 animated GIF (test-plan #X10) — input animated GIF over bound · trigger
      ingest · observable preserved intact or fitted to a still; never a corrupt frame.
- [ ] 3.14 P1/P2 event-loop lag (test-plan #P1 #P2) — workload one 10 MB image, then
      5 × 2 MB · metric max event-loop lag < 50 ms · needs the new lag helper (§6.1).
- [ ] 3.15 P3 broadcast payload (test-plan #P3) — workload fitted image-bearing message ·
      metric frame < 256 KB, ≪ 4 MB `MAX_WS_BUFFER`.
- [ ] 3.16 P4 recovery memory (test-plan #P4) — workload cache miss on a 50 MB transcript ·
      metric peak RSS delta < 50 MB, proving the scan streams rather than slurps.

## 4. Tests — L3 Playwright e2e

All L3 rows go in `tests/e2e/`; harness exemplar
`tests/e2e/chat-transcript-virtualization.spec.ts` (row-measure + virtualized transcript
glue) and `tests/e2e/chat-render-fx.spec.ts` (chat render assertions). Read the harness
port from `.pi-test-harness.json` (`dashboardPort`) — never hardcode `:18000`.

- [ ] 4.1 F1/F2 two-phase render (test-plan #F1 #F2) — input message + 5 MB attachment ·
      trigger send, then fitting completes · observable row present before any image,
      placeholder in the attachment position, converging to `<img>` in the same position
      with row count unchanged.
- [ ] 4.2 F3 fitting failure is honest (test-plan #F3) — input corrupt image bytes ·
      trigger fitting fails · observable explicit failed state, row still present, no
      indefinite pending.
- [ ] 4.3 F4 reload mid-fit (test-plan #F4) — input 10.5 MB attachment · trigger reload
      before fitting completes · observable row renders; attachment resolves or shows
      failed state.
- [ ] 4.4 F5/F6 original view (test-plan #F5 #F6) — input rendered fitted image; then a
      404 from the original endpoint · trigger user opens it · observable full-resolution
      original byte-identical to input; on failure the fitted image still renders and only
      zoom degrades.
- [ ] 4.5 F7 replay renders images (test-plan #F7) — input session with image messages ·
      trigger reload · observable every image-bearing row renders an image.
- [ ] 4.6 F8 row-height stability (test-plan #F8) — input virtualized transcript with
      image rows · trigger scroll out and back · observable stable height, no collapse or
      overlap. Guards the existing `chat-view` invariant.
- [ ] 4.7 P5 image-heavy replay (test-plan #P5) — workload 20 image-bearing messages ·
      trigger replay · observable completes with no gateway frame dropped.

## 5. Implement

- [ ] 5.1 Display-fit worker (jimp, 768 px/q75) invoked off the event loop.
- [ ] 5.2 Ingest seam: fit image blocks, store the derivative inline.
- [ ] 5.3 Two-phase emission: row first, attachment resolves later (D3).
- [ ] 5.4 Raise `DEFAULT_MAX_EVENT_DATA_SIZE` to 256 KB.
- [ ] 5.5 Export `DEFAULT_MAX_STRING_SIZE`; pass the store's effective cap to
      `deriveTranscriptCapBytes` (`server.ts:684`) — land atomically with 5.4.
- [ ] 5.6 D9: keep the terminal cap derivation coupled; document the 15 KB → 192 KB shift
      in `packages/server/src/terminal/` docs + the inline-terminal spec.
- [ ] 5.7 Session-scoped originals endpoint + transcript-backed streaming resolver.
- [ ] 5.8 Blob cache (2 GB LRU, disk) as an optimisation over the transcript.
- [ ] 5.10 D10: fitted-derivative disk cache keyed by content hash; miss re-fits.
- [ ] 5.11 D11: animated-GIF detection → bypass fitting, keep existing ceiling handling.
- [ ] 5.9 Client: placeholder → image swap; click-to-original overlay.

## 6. New infra

- [ ] 6.1 Event-loop-lag helper for L1 (no existing test measures it) — needed by 3.14.
- [ ] 6.2 Attachment-endpoint fixtures: a session with a known hash plus an unauthorised
      caller — needed by 3.9–3.11.

## 7. Verify

- [ ] 7.1 `npm test 2>&1 | tee /tmp/pi-test.log` then `grep -nE 'FAIL|Error|✗' /tmp/pi-test.log`.
- [ ] 7.2 `npm run build` + `curl -X POST http://localhost:8000/api/restart`.
- [ ] 7.3 Acceptance — the original report: open session `019fca04`, scroll to "The layout
      is not ok"; the screenshot renders.
- [ ] 7.4 Paste a fresh ~2 MB screenshot: row appears immediately, image swaps in, still
      renders after reload, and click opens the original.
- [ ] 7.5 Update `packages/server/src/persistence/AGENTS.md` + the new worker/endpoint
      directory rows (Documentation Update Protocol).

## 8. Manual (deferred post-merge — test-plan disposition: manual-only)

- [ ] 8.1 F9 legibility (test-plan #F9, manual-only) — view a UI screenshot fitted at
      768 px/q75 and judge whether text is legible enough that click-to-original is an
      enhancement rather than a necessity. Directly tests the main risk of the 768 px
      choice; if it fails, revisit the display size.

## 9. Follow-up filings

- [ ] 9.1 Mid-turn `bridgeFollowUp` image loss (`bridge.ts:355` is `string[]`; images
      dropped on drain while streaming) — a genuine *delivery* bug, separate from this.
- [ ] 9.2 Retire now-unreachable inline-attachment truncation paths once no
      full-resolution base64 reaches the store (`capContentBlocks` slicing, the line-224
      exemption, `isImageBlock`'s depth-limit use).
