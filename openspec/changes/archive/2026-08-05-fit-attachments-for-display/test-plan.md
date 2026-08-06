# Test Plan — fit-attachments-for-display

Stage: design   Generated: 2026-08-04

All clarification gates resolved before generation (cache policy, recovery bound,
endpoint scope, durability guarantee, latency budget, layout reservation, two-phase
behaviour). No open markers.

Measured constants these scenarios assert against:
`fitted max 212 KB (768 px/q75)` · `ceiling 256 KB` · `assert floor 24_000` ·
`raw p50 125.7 KB / max 10.5 MB` · `resize cost 174–874 ms`.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | Images fitted before store | BVA (max) | L1 | automated | 10.5 MB PNG (observed max) | ingest | stored event `data` ≤ 256 KB; contains `data.message` |
| E2 | Images fitted before store | BVA (p99) | L1 | automated | 2.2 MB image | ingest | stored event ≤ 256 KB; fitted block present |
| E3 | Images fitted before store | BVA (p50) | L1 | automated | 126 KB image | ingest | stored event ≤ 256 KB |
| E4 | Already-small not enlarged | BVA (min) | L1 | automated | 0.2 KB image, 40×40 px | ingest | output bytes == input bytes; dimensions unchanged |
| E5 | Already-small not enlarged | BVA (just under bound) | L1 | automated | image 767 px long edge | ingest | not resized; bytes unchanged |
| E6 | Images fitted before store | BVA (just over bound) | L1 | automated | image 769 px long edge | ingest | resized to 768 px long edge |
| E7 | Message survives any size | EP | L1 | automated | message: text + 10.5 MB image | ingest | event is NOT `{__truncated}`; `data.message.role === "user"` |
| E8 | Message survives any size | EP | L1 | automated | message: 20 attachments, 2 MB each | ingest | event ≤ 256 KB; all 20 blocks fitted; no placeholder |
| E9 | Replayed sessions fitted | state | L1 | automated | session JSONL with inline 5 MB image | replay | emitted event ≤ 256 KB; carries fitted block |
| E10 | Ceiling raise | BVA | L1 | automated | fitted image at 212 KB (measured max) | ingest | event under ceiling with headroom; no truncation |
| E11 | Boot assert armed | decision-table | L1 | automated | `maxStringFieldSize` unset (→ 4000), ceiling 256 KB | boot | `deriveTranscriptCapBytes` evaluates against 4000, returns 192 KB, does not throw |
| E12 | Boot assert armed | decision-table | L1 | automated | `maxStringFieldSize` unset, ceiling 20 KB (pre-raise) | boot | throws — proves the assert is armed, not skipping |
| E13 | Boot assert armed | decision-table | L1 | automated | `maxStringFieldSize` = 50_000, ceiling 256 KB | boot | throws (`50_000 × 6 ≥ 262_144`) |
| E14 | Original allow-list typing | EP | L1 | automated | originals of mime jpeg/png/gif/webp | serve | `Content-Type` matches the allow-list value |
| E15 | Original allow-list typing | EP (invalid) | L1 | automated | stored blob claiming `text/html` | serve | refused or coerced; never served as active content |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | Fitting does not block | event-loop lag | L1 | automated | ingest one 10 MB image | max event-loop lag < 50 ms | duration of ingest |
| P2 | Fitting does not block | concurrency | L1 | DEFERRED (skipped) | 5 × 2 MB images ingested back-to-back | max event-loop lag < 50 ms; all 5 complete | duration |
| P3 | Ceiling raise vs transport | payload-size | L1 | automated | image-bearing message, fitted | broadcast frame < 256 KB; ≪ 4 MB `MAX_WS_BUFFER` | per frame |
| P4 | Original recovery bounded | memory | L1 | automated | cache miss on a 50 MB transcript | peak RSS delta < 50 MB (streamed, not slurped) | per request |
| P5 | Replay of image-heavy session | soak | L3 | automated | session with 20 image-bearing messages | replay completes; no frame dropped at the gateway | full replay |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | Row renders before image | state-transition | L3 | automated | message + 5 MB attachment | send | user row present in DOM before any fitted image; placeholder occupies attachment position |
| F2 | Image replaces placeholder | state-convergence | L3 | automated | as F1 | fitting completes | converges to: placeholder gone, `<img>` present in same position, row count unchanged |
| F3 | Fitting failure is honest | state-transition (illegal edge) | L3 | automated | corrupt/unsupported image bytes | fitting fails | converges to explicit failed-attachment state; row still present; no indefinite pending |
| F4 | Row renders regardless | state-transition | L3 | automated | 10.5 MB attachment | send, then reload before fitting completes | after reload the row renders; attachment resolves or shows failed state |
| F5 | Original opens full-res | state-transition | L3 | automated | rendered fitted image | user opens it | full-resolution original displayed; byte-identical to attached input |
| F6 | Original failure degrades only zoom | fault (abort) | L3 | automated | original endpoint returns 404 | user opens image | fitted image still rendered in transcript; only the zoom view degrades |
| F7 | Replay renders images | state-transition | L3 | automated | session containing image messages | reload session | every image-bearing row renders an image after replay |
| F8 | Row height stability | state-convergence | L3 | automated | virtualized transcript with image rows | scroll image row out and back | row height stable; no collapse or overlap (guards the existing chat-view invariant) |
| F9 | Fitted image legibility | visual/subjective | — | manual-only | UI screenshot at 768 px/q75 | human reads it | [judgment: is UI text legible enough that click-to-original is an enhancement, not a necessity?] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | Original authorisation | fault (authz) | L1 | automated | caller lacks authorisation for session A | GET session A's attachment | refused; bytes not returned |
| X2 | Original authorisation | fault (cross-session) | L1 | automated | caller authorised for session B only | GET session A's attachment by valid hash | refused — hash is not a capability |
| X3 | Path safety | fault (malformed id) | L1 | automated | attachment id containing `../` or non-hex | GET original | rejected; no filesystem access outside the store root |
| X4 | Recovery from transcript | fault (cache miss) | L1 | automated | blob evicted from cache, transcript intact | GET original | recovered from transcript and served |
| X5 | Eviction safety | fault (eviction) | L1 | automated | cache at 2 GB cap, LRU evicts | GET evicted original | still retrievable via recovery; never permanently lost |
| X6 | Recovery when transcript gone | fault (abort) | L1 | automated | blob evicted AND transcript deleted | GET original | clean 404; no crash; transcript row unaffected |
| X7 | Worker failure | fault (abort) | L1 | automated | resize worker crashes mid-task | ingest | event still stored with `data.message`; attachment resolves to failed state |
| X8 | Worker unavailable | fault (delay) | L1 | automated | worker pool saturated | ingest | ingest does not block the event loop; task queues |
| X9 | Unsupported format | fault (bad input) | L1 | automated | valid `image/*` mime, bytes jimp cannot decode | ingest | no crash; message stored; attachment failed state |
| X10 | Animated GIF | fault (lossy transform) | L1 | automated | animated GIF over the bound | ingest | either preserved intact or fitted to a still with animation loss recorded — never a corrupt frame |

---

## Coverage summary

- Requirements covered: 6/6
- Scenarios by class: edge 15 · perf 5 · frontend 9 · error 10 (39 total)
- Scenarios by level: L1 26 · L2 0 · L3 12 · manual-only 1
- Scenarios by disposition: automated 38 · manual-only 1

## New infra needed

- **P2 is DEFERRED, not passing.** It is `it.skip` in `display-fit-perf.test.ts`, so it
  contributes no coverage. Under the vitest runner its sample captured the burst's
  WALL TIME (runner CPU contention + worker startup), not loop blocking, so the
  assertion compared two numbers that do not mean what the row says. Measured
  outside the runner both paths block ~0 ms and the pool is ~1.7x faster, which is
  why D4 stands on throughput + CPU isolation. Re-enable only as a THROUGHPUT
  assertion measured outside vitest.
- **Resize worker harness** — P1/P2/X7/X8 need to observe event-loop lag and force worker
  failure. No existing L1 test measures event-loop lag; a small helper is required.
- **Attachment-endpoint fixtures** — X1–X6 need a session with a known attachment hash and
  an unauthorised caller. No existing fixture covers per-session authorisation of a binary
  endpoint.
- No new *level* is required — all rows route to existing L1 (vitest) and L3 (Playwright
  vs the docker harness on its derived `dashboardPort`) tiers.

## Notes

- L2 (`qa/` VM smoke) is intentionally unused: every scenario here is either pure logic or
  rendered-UI, and the rendered-UI/smoke boundary is not crossed.
- F9 is the only `manual-only` row — legibility of a downscaled UI screenshot is a human
  judgment with no automatable observable. It directly tests the main risk of the 768 px
  choice, so it should not be dropped, only deferred.
- E12 is deliberately a *negative* boot test: it proves the assert is genuinely armed
  rather than silently skipping, which is the defect found in `server.ts:684`.
