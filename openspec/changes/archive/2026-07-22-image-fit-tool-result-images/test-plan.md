# Test Plan — image-fit-tool-result-images

Stage: design   Generated: 2026-07-21

All Triples fill from the corrected spec (thresholds 1568 px / 4 MiB / quality 85, mime-derived output format, mime-keyed bounded cache, cheap-probe gate, role-agnostic traversal, fail-open). No blocking spec gaps → no clarifications. The one empirical unknown (subagent seam coverage) is a `manual-only` build-time probe, not a spec defect.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | Resize policy (pixel BVA, just-above) | BVA | L1 | automated | message with one `image/png` block, 1569×800 px, ~200 KB | context handler runs | block resized so long edge ≤ 1568; `{messages}` returned with new `data` |
| E2 | Resize policy (pixel BVA, at boundary) | BVA | L1 | automated | one `image/png` block exactly 1568×800 px, < 4 MiB | context handler runs | NOT resized; handler returns `undefined` (no change) |
| E3 | Resize policy (dims-over, bytes-under — the incident) | EP | L1 | automated | one `image/png` block 8956×5080 px, ~411 KB (< 4 MiB) | context handler runs | resized (long edge ≤ 1568); proves dimension check, not byte-only short-circuit |
| E4 | Resize policy (byte BVA, just-above) | BVA | L1 | automated | one block ≤ 1568 px long edge but decoded bytes > 4 MiB | context handler runs | resized/re-encoded to a smaller block |
| E5 | Resize policy (format-adaptive) | decision-table | L1 | automated | three oversize blocks: `image/png`, `image/webp`, `image/gif` | context handler runs | png→`image/png` out; webp→`image/jpeg` out; gif→`image/jpeg` out (first frame, animation lost by design) |
| E6 | Resize policy (aspect ratio) | BVA | L1 | automated | one oversize `image/png` block 4032×3024 px | context handler runs | output dims 1568×1176 (±1 px) |
| E7 | Seam (role-agnostic traversal) | state/partition | L1 | automated | oversize image block inside a custom/non-user/non-tool role message carrying `content:(Text\|Image)[]` | context handler runs | block resized (traversal does not branch on role) |
| E8 | Seam (string content skipped) | partition | L1 | automated | a message whose `content` is a plain string | context handler runs | message skipped, no throw, no WARN logged |
| E9 | Seam (multi-image turn) | partition | L1 | automated | one message with 2 oversize blocks + 1 within-limit block | context handler runs | both oversize blocks resized, small block untouched, single `{messages}` returned |
| E10 | Seam (no-change return) | partition | L1 | automated | messages where every image block is within limits | context handler runs | handler returns `undefined`; no `{messages}` allocation |
| E11 | Seam (non-image blocks untouched) | partition | L1 | automated | messages with text + tool-call blocks, no image | context handler runs | all blocks byte-identical; returns `undefined` |
| E12 | Seam (disabled via env) | partition | L1 | automated | `PI_IMAGE_FIT_DISABLE=1` at load | extension loads | `context` handler is not registered; message content never inspected |
| E13 | Cache (mime collision guard) | decision-table | L1 | automated | two oversize blocks, identical base64 `data`, mimes `image/png` vs `image/webp` | context handler runs | two distinct cache keys; each re-encoded to its own format; neither serves the other's bytes |
| E14 | Cache (hit on repeat turn) | state-transition | L1 | automated | same oversize image block present on turn 1 and turn 2 (unchanged thresholds) | context handler runs twice | `resizeBuffer` invoked exactly once; turn 2 served from cache |
| E15 | Cache (threshold change invalidates) | state-transition | L1 | automated | oversize image cached, then `PI_IMAGE_FIT_MAX_EDGE` changed | context handler runs again | new cache key → fresh resize |
| E16 | Cache (bounded LRU eviction) | BVA | L1 | automated | injected small byte budget; add distinct oversize fits exceeding it | Nth distinct fit added | least-recently-used entry evicted; re-access re-resizes |
| E17 | Cache + policy (within-limit not hashed) | partition | L1 | automated | one within-limit image block | context handler runs | hash + cache-put spies NOT invoked for that block |
| E18 | Seam (on-disk transcript not rewritten) | partition | L1 | automated | messages loaded from a transcript file containing an oversize block | context handler runs | returned deep-copy block is fitted AND the source transcript file bytes are unchanged after |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | Cheap-probe gate (within-limit steady state) | call-count invariant | L1 | automated | one within-limit image block over one turn | full `jimp` pixel-decode invocations = 0 (header probe only) | single turn |
| P2 | Cache (repeat oversize steady state) | call-count invariant | L1 | automated | one oversize image block present across 3 consecutive turns | `resizeBuffer` invocations = 1 total (cached after first) | 3 turns |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | Fail-open (undecodable block) | fault-injection | L1 | automated | image block with non-decodable base64 `data`, flagged oversize by byte estimate | context handler runs | block unchanged; exactly one `[pi-image-fit] WARN`; no throw; turn proceeds |
| X2 | Fail-open (one bad does not block others) | fault-injection | L1 | automated | turn with one undecodable oversize block + one valid oversize block | context handler runs | valid block resized; bad block passes through unchanged |
| X3 | Fail-open (resize throws mid-encode) | fault-injection (abort) | L1 | automated | jimp encode made to throw for one block | context handler runs | that block unchanged + one WARN; sibling blocks still processed |
| X4 | Resize policy (unparseable header fallback) | fault-injection | L1 | automated | a valid oversize image whose header the cheap probe cannot parse | context handler runs | falls back to a bounded `jimp` decode and still fits it (per design D4 fallback) |

### Frontend-quirk / integration (manual)

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| M1 | Seam coverage in subagents (design Open Q #1) | empirical probe | — | manual-only | a subagent (`Agent` tool) whose tool result surfaces an oversize image | subagent LLM call fires | record whether the parent session's `context` handler fits it or the image bypasses fitting — decides whether any-origin extends to subagents |
| M2 | End-to-end rescue reproduction | scenario replay | — | manual-only | a real session transcript containing an oversize image block (the `019f8604` failure mode) | resume the session; next LLM call fires | provider request succeeds (within limits) with on-disk transcript unchanged |

---

## Coverage summary

- Requirements covered: 4/4 (seam, resize policy, content-hash cache, fail-open)
- Scenarios by class: edge 18 · perf 2 · error 4 · frontend/integration 2
- Scenarios by level: L1 24 · manual-only 2
- Scenarios by disposition: automated 24 · manual-only 2

## New infra needed

- none for the automated rows — all L1 in `packages/image-fit-extension/src/__tests__/` (vitest), the package's existing tier.
- M1 (subagent coverage) has no existing automatable harness in this package; it is an empirical build-time probe (manual-only), feeding the design Open Question. If it proves subagents bypass the seam, a follow-up change — not this one — would add coverage.
