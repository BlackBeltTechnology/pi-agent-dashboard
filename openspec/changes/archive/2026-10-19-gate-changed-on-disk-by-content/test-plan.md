# Test Plan — gate-changed-on-disk-by-content

Stage: design   Generated: 2026-10-19

No clarifications needed: every Triple slot resolves to a value stated in the specs or design.md.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | settings-panel: editor large-file limit (parser) | EP+BVA | L1 | automated | config `editor.largeFileLimitMb` ∈ {absent, 0, 1, 10, 256, 257, 5000, 10.4, 10.6, "64", null, NaN} | `loadConfig()` parses it | resolved values {10, 1, 1, 10, 256, 256, 256, 10, 11, 10, 10, 10} |
| E2 | internal-monaco: oversized fallback | BVA | L1 | automated | limit 10 MiB; `data.csv` size `10*1024*1024` and `10*1024*1024+1` | `CappedViewer` mounts | exactly-cap mounts `SpreadsheetPreview`; cap+1 mounts `TooLargePreview` naming 10 MB |
| E3 | internal-monaco: raised limit | EP | L1 | automated | limit 64 MiB (store hydrated); `notes.md` size 30 MiB | `CappedViewer` mounts | `MarkdownViewer` mounts; no `TooLargePreview` |
| E4 | internal-monaco: office 413 names office cap | decision-table | L1 | automated | limit 256 MiB; `.docx` 60 MiB; server returns 413 | office preview handles 413 | `TooLargePreview` names the docx cap (40 MB), not 256 MB |
| E5 | digest endpoint: ceiling | BVA | L1 | automated | regular files of 0 B, 1 KiB, `256 MiB`, `256 MiB + 1` (sparse) under cwd | `GET /api/file/digest` | first three carry correct hex `sha1` + full-precision `mtime` + `size`, no `content` key; the last has no `sha1` |
| E6 | digest endpoint: parity with /api/file | decision-table | L1 | automated | paths: in-cwd file, in-cwd symlink → regular file, `~/.pi` file, outside-cwd file, missing outside-cwd, unknown session cwd, url-encoded `file://` path | both routes requested opted out of grant prompt | identical admit/refuse; refusals share status, `error` string and remedy fields; missing-outside-cwd = containment refusal, not 404 |
| E7 | digest endpoint: non-regular | EP | L1 | automated | a directory and a FIFO (`mkfifo`) under cwd | `GET /api/file/digest` | `404` for both; request returns within 1 s (FIFO does not block) |
| E8 | digest endpoint: no cache | EP | L1 | automated | contained file | `GET /api/file/digest` | response header `Cache-Control: no-store` |
| E9 | write returns hash | EP | L1 | automated | `.md` content with BOM, CRLF and non-ASCII chars | `POST /api/file/write`, then `GET /api/file/digest` | write data has `mtime`, `size` (UTF-8 byte length) and `sha1`; digest `sha1` equals write `sha1` |
| E10 | write body limit | BVA | L1 | automated | `.md` content of 20 MiB, and content of 256 MiB + 1 B UTF-8 | `POST /api/file/write` | 20 MiB → 200 with `sha1`; above ceiling → 413 and file untouched |
| E11 | banner: identical rewrite | EP | L1 | automated | `foo.ts` open, baseline sha1 = S | `file_changed` candidate; digest returns S | no banner; candidate cleared |
| E12 | banner: real change | EP | L1 | automated | baseline S | candidate; digest returns S′ ≠ S | banner shown for `foo.ts` |
| E13 | banner: failure never silent | decision-table | L1 | automated | baseline S | candidate; digest returns 404 / 403 / network error / `{size,mtime}` without sha1 | banner shown in all four cases |
| E14 | banner: change then revert | state-transition | L1 | automated | baseline S; banner shown after S′ | new candidate; digest returns S | banner clears |
| E15 | baselines are per session | EP | L1 | automated | session A cwd `/a`, session B cwd `/b`, both tab `X`; baselines differ | session switch A→B, candidate for `X` in A | maps cleared on switch; A's candidate never compared with B's baseline |
| E16 | folder scope off | EP | L1 | automated | folder-scoped pane (`changeDetection` false) with `foo.ts` open | tab mount, then a `file_changed` for `foo.ts` | zero `/api/file/digest` requests; no banner; viewer mounts without waiting |
| E17 | settings field validation | EP+BVA | L1 | automated | Editor large-file limit field entries `0`, `1`, `256`, `257`, `12.5`, `abc` | user types each | `1`/`256` valid; others flagged and Save blocked |
| E18 | settings save path | EP | L1 | automated | field changed 10 → 64 | Save | `computeConfigPartial` emits `{ editor: { largeFileLimitMb: 64 } }`; General page dirty chip shown before save |
| E19 | config write applies live | EP | L1 | automated | `PUT /api/config` `{ editor: { largeFileLimitMb: 64 } }` | write handler | file stores 64; `GET /api/config` returns 64; `restartRequired` false; `config_updated { section: "editor" }` broadcast |
| E20 | route registration | EP | L1 | automated | route inventory with `/api/file/digest` | `mcp-manifest-completeness.test.ts` + route-tier check | `ROUTE_TIERS` row `observe`; route in `tools.denylist.ts`; test green |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | digest load bound (D4) | concurrency invariant | L1 | automated | 6 concurrent digest requests on 32 MiB files | at most 2 hashes in flight at any instant (instrumented semaphore) | single run |
| P2 | baseline priority (D4) | ordering invariant | L1 | automated | 4 queued `purpose=verify` digests, then 1 `purpose=baseline` | baseline acquires the next free slot before any queued verify | single run |
| P3 | slot release on abort (D4) | fault-injection (abort) | L1 | automated | 2 in-flight digests on large files; client aborts both | a third digest starts within 100 ms of the aborts | single run |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | baseline before viewer mount (D2) | state-convergence | L1 | automated | session pane, `foo.ts` tab opening; digest response delayed 200 ms | tab activation | `CappedViewer` not mounted until the digest resolves; then mounted once |
| F2 | second change during verification | state-transition | L1 | automated | baseline S; candidate g1 verifying (digest pending) | candidate g2 arrives; g1 digest returns S, g2 digest returns S′ | g1 result discarded; banner shown |
| F3 | own save during verification | state-transition | L1 | automated | candidate verifying (digest pending, returns pre-save S) | `trackedFileWrite` succeeds with sha1 T (version bump) | in-flight result discarded; re-verify against T; no banner |
| F4 | own save suppresses its own event | state-transition | L1 | automated | editable `README.md`, baseline S | Save → write returns T; candidate arrives before the response | candidate waits for save; digest T == baseline T; no banner |
| F5 | failed / unknown save | decision-table | L1 | automated | baseline S | save returns 409 → then candidate digest S′; separately save network-fails → candidate digest S | 409: baseline stays S, banner on S′; unknown: baseline null, banner on next candidate |
| F6 | save-wait bound | fault-injection (delay) | L1 | automated | save request that never responds; candidate queued | fake timers advance 60 s | request aborted; verification runs against current baseline |
| F7 | in-pane repair writers | EP | L1 | automated | `MarkupRepairBanner` and `MermaidApplyFix` apply a fix to an open file | write succeeds; candidate arrives | both go through `trackedFileWrite`; no banner |
| F8 | Dismiss vs in-flight verification | state-transition | L1 | automated | banner shown; a verification in flight returning S′ | user Dismiss before it resolves | banner stays dismissed; baseline unchanged; next different change banners again |
| F9 | Refresh resets baseline + re-sends watch | state-transition | L1 | automated | banner shown for `foo.ts` | Refresh | `/api/file` re-fetched; banner cleared; new baseline captured; `watch_files` re-sent with the open set |
| F10 | activation clears stale candidate | state-transition | L1 | automated | `foo.ts` background tab with pending candidate | user activates the tab | baseline re-captured; candidate + verified cleared; no banner |
| F11 | mount catch-up | state-convergence | L1 | automated | new tab baseline S; disk changes to S′ with no `file_changed` | fake timers advance 1 s | catch-up verification → banner; timer cancelled if tab closed first (no digest request) |
| F12 | catch-up skipped on null baseline | EP | L1 | automated | baseline digest refused (403) | fake timers advance 1 s | no catch-up request; no banner until a real candidate |
| F13 | reconnect re-declares + catches up | state-transition | L1 | automated | 2 open tabs with baselines | WS connection generation bumps | `watch_files` re-sent with both paths; one verification per non-null baseline |
| F14 | config gate waits for hydration | state-convergence | L1 | automated | limit 64 MiB server-side; store not loaded; 30 MiB `.md` | `CappedViewer` mounts; config arrives after 500 ms / never arrives | loading state, then `MarkdownViewer` (no `TooLargePreview` flash); never-arrives → default gate after 3 s |
| F15 | live limit change | state-convergence | L1 | automated | store loaded with 10 MiB; 30 MiB `.md` tab showing fallback | `config_updated {section:"editor"}` → refetch returns 64, tab refreshed | `MarkdownViewer` mounts, no reload |
| F16 | end-to-end banner behaviour | state-convergence | L3 | automated | harness session with `foo.ts` open in the pane | out-of-band: `touch foo.ts`; identical rewrite; atomic tmp+rename identical; then a different write | no banner after the first three; banner after the different write |
| F17 | end-to-end own save | state-convergence | L3 | automated | harness session with editable `notes.md` open | edit + Save; then out-of-band different write | no banner after Save; banner after the external write |
| F18 | end-to-end raised limit | state-convergence | L3 | automated | harness; 30 MiB `big.md` in workspace | open → fallback; Settings limit 64 + Save; reopen tab | fallback first; after save the markdown viewer with Edit toggle renders, no reload |
| F19 | banner/notice look | visual/subjective | — | manual-only | banner + Settings field on desktop and mobile widths | human looks | [judgment: field label/hint readable, banner layout unchanged] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | watch survives atomic replace (D5) | fault-injection | L1 | automated | watched file replaced via tmp+rename | different write 0 ms, 20 ms and 500 ms after the rename | `onChange` fires for each write; `activeWatchCount()` stays 1 |
| X2 | delete + re-create | fault-injection (delay) | L1 | automated | watched file deleted | re-created at 250 ms, then written | re-attached by the 300 ms retry; later write fires `onChange` |
| X3 | delete without re-create | fault-injection (abort) | L1 | automated | watched file deleted, never re-created | fake timers past 1000 ms | key dropped; `activeWatchCount()` 0; no pending timers |
| X4 | replaced by a directory | fault-injection | L1 | automated | watched path renamed away and a directory created at it | rename event | key dropped (no directory watch); `onChange` emitted once |
| X5 | retry vs teardown | fault-injection | L1 | automated | delete pending retry | `clearConnection` (and separately reconcile-removal) at 50 ms | no watcher created afterwards; 0 handles, 0 timers |
| X6 | error handler vs successor | fault-injection | L1 | automated | old watcher emits `error` after re-attach | error event on the old instance | successor watcher stays open; count 1 |
| X7 | `change` events never re-attach | EP | L1 | automated | watched file | 5 in-place writes | same watcher instance throughout (no close/open churn) |
| X8 | grant opt-out header survives wrapper | fault-injection | L1 | automated | installed global fetch wrapper | `fetchWithoutGrantPrompt('/api/file/digest?…')` | outgoing request carries `X-Pi-Grant-Channel: ""` |
| X9 | opted-out digest never held | fault-injection | L1 | automated | prompt-eligible containment miss | digest request with empty grant-channel header | immediate 403 + remedy, no suspension; denial-ledger behaviour asserted (no record, or record suppressed for digest) |
| X10 | grant-admitted swap refused | fault-injection | L1 | automated | path admitted only via grant; swapped to a symlink / FIFO between gate and open | digest request | refused exactly like `/api/file` (verified open throws → same 403 shape) |

---

## Coverage summary

- Requirements covered: 5/5 (banner, oversized fallback, digest endpoint, settings field, containment by reference)
- Scenarios by class: edge 20 · perf 3 · frontend 19 · error 10
- Scenarios by level: L1 48 · L2 0 · L3 3 · manual 1
- Scenarios by disposition: automated 51 · manual-only 1

## New infra needed

- none (L3 rows reuse the docker harness and the out-of-band filesystem mutation pattern from `tests/e2e/tool-created-files.spec.ts`)
