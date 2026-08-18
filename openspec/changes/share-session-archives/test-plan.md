# Test Plan — share-session-archives

Stage: design   Generated: 2026-08-19

Provisional constants resolved at the clarification gate (spike 1.1 may revise
the seal values; scenarios are written against these numbers):

| Constant | Value |
|---|---|
| Seal thresholds | 256 KB ∥ 2000 lines ∥ 60 s idle |
| Claim renewal / expiry deadline / skew tolerance | 60 s / 300 s / 30 s |
| Sync debounce window | 30 s |
| Perf budgets | list 4 224 sessions < 2 s p95 · materialise one session < 5 s p95 · scrub throughput > 10 MB/s |

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | format: sealed segments | BVA | L1 | automated | canonical transcript of 255 KB, 1 line under 2000, last append 59 s ago | seal evaluation runs | no segment sealed; tail remains unsealed |
| E2 | format: sealed segments | BVA | L1 | automated | canonical transcript reaching exactly 256 KB | seal evaluation runs | exactly one segment sealed covering the full range |
| E3 | format: sealed segments | BVA | L1 | automated | canonical transcript at 2000 lines, 100 KB | seal evaluation runs | segment sealed on the line threshold, not the byte threshold |
| E4 | format: sealed segments | BVA | L1 | automated | 10 KB tail, last append 61 s ago | seal evaluation runs | segment sealed on idle threshold |
| E5 | format: sealed segments | BVA | L1 | automated | 300 KB canonical range whose 256 KB point falls mid-line | seal evaluation runs | segment ends at the preceding newline; concatenation parses as valid JSONL |
| E6 | format: immutability | state-transition | L1 | automated | session with sealed `seg-0002`, then 50 KB appended | seal + publish runs | `seg-0002` identity byte-identical to before; new content only in `seg-0003` or tail |
| E7 | format: canonical form | EP | L1 | automated | transcript containing literal `{{CWD}}` in assistant prose | scrub then expand | prose still contains literal `{{CWD}}`; no local path substituted |
| E8 | format: canonical form | EP | L1 | automated | transcript containing literal `{{HOME:remote}}` in prose | scrub then expand then re-scrub | canonical bytes identical to the origin's canonical bytes for that content |
| E9 | format: reconstruction | EP | L1 | automated | session of 5 segments | scrub → segment → compress → encrypt → decrypt → decompress → concat | result byte-identical to canonical sealed range |
| E10 | format: identity | decision-table | L1 | automated | two machines seal byte-identical canonical content | each encrypts with random-nonce AEAD | both segments share one identity; stored bytes and object keys differ |
| E11 | format: identity | EP | L1 | automated | manifest identity `X`; blob whose decrypted plaintext digests to `Y` | reconstruction | blob rejected with an integrity error |
| E12 | format: manifest | EP | L1 | automated | session with an unpublished tail | manifest is written | manifest records the session as incomplete |
| E13 | format: manifest | EP | L1 | automated | session that ended and flushed its tail | manifest is written | manifest records the session as complete, distinguishable from E12 |
| E14 | portability: component-bounded | BVA | L1 | automated | project root `/x/dashboard`; entry path `/x/dashboard-other/file.ts` | scrub | entry unchanged; NOT tokenised as `{{CWD}}-other/file.ts` |
| E15 | portability: component-bounded | BVA | L1 | automated | project root `/x/dashboard`; entry path `/x/dashboard/file.ts` | scrub | entry becomes `{{CWD}}/file.ts` |
| E16 | portability: two tokens | EP | L1 | automated | entry path `/Users/u/.agent-browser/tmp/x.png`, home `/Users/u` | scrub | entry becomes `{{HOME:remote}}/.agent-browser/tmp/x.png` |
| E17 | portability: third band | EP | L1 | automated | entry path `/private/var/folders/ab/tmp.XYZ/f.ts` | scrub | entry unchanged; archive still free of home and project paths |
| E18 | portability: longest-prefix | decision-table | L1 | automated | project root nested under home; entry inside the project | scrub | `{{CWD}}` wins over any home-relative tokenisation |
| E19 | portability: projectKey | EP | L1 | automated | remotes `git@github.com:u/x.git` and `https://github.com/u/x` | canonicalise both | both yield one identical `projectKey` |
| E20 | portability: projectKey | EP | L1 | automated | project with no git remote and no assigned name | export attempted | export refused with an error requesting a project name |
| E21 | portability: image safety | EP | L1 | automated | transcript with an inline image whose base64 contains a run matching the home path | scrub → expand | `attachmentId` (sha256 of original base64 text) unchanged; payload bytes unchanged |
| E22 | portability: offset | EP | L1 | automated | session cwd `<root>/.worktrees/feat-x` | export then import onto root `/home/b/dash` | imported cwd is `/home/b/dash/.worktrees/feat-x` |
| E23 | portability: scope | EP | L1 | automated | goal record and session meta each carrying an absolute cwd | publish | both carry placeholder tokens, not absolute paths |
| E24 | gate: known formats | decision-table | L1 | automated | segments containing each of `sk-…`, `ghp_…`, `AKIA…`, a JWT, a PEM block, `postgres://u:p@h` | scan | each flagged with its matching rule and offending location |
| E25 | gate: no entropy scoring | EP | L1 | automated | 8 MB base64 image segment containing no known-format credential | scan | not flagged |
| E26 | gate: index objects | EP | L1 | automated | `meta.firstMessage` containing `sk-…` | publish metadata | metadata flagged and held; not uploaded |
| E27 | sync: set union | EP | L1 | automated | machine A knows `0000-0002`; archive has `0000-0004` | reconcile | both manifests reference `0000-0004`; identities of `0000-0002` unchanged; no segment bytes fetched |
| E28 | sync: field merge | decision-table | L1 | automated | machine A cleared `closedReason`; machine B holds its prior value | merge | field remains deleted (tombstone honoured) |
| E29 | sync: drop tombstone | EP | L1 | automated | segment dropped and tombstoned; peer still holds its identity | union merge | segment not restored to the manifest |
| E30 | sync: claim expiry | BVA | L1 | automated | claim with deadline 300 s, elapsed 299 s | machine B claims | refused |
| E31 | sync: claim expiry | BVA | L1 | automated | claim with deadline 300 s + 30 s skew, elapsed 331 s | machine B claims | granted |
| E32 | sync: claim expiry | BVA | L1 | automated | claim deadline exceeded by 15 s (inside 30 s skew) | machine B claims | refused — skew tolerance not yet exhausted |
| E33 | sync: voluntary release | state-transition | L1 | automated | holder ends session and releases | machine B claims immediately | granted without waiting for the deadline |
| E34 | sync: tie-break | decision-table | L1 | automated | divergence where branch P carries a redaction marker and branch Q does not | resolve | P retained; Q forked — regardless of machine id ordering |
| E35 | sync: tie-break | decision-table | L1 | automated | divergence, neither branch redacted, machine ids `m-aaa` / `m-bbb` | resolved independently on both machines | both retain the same branch and fork the same branch |
| E36 | sync: backfill | EP | L1 | automated | 4 224 pre-feature sessions | backfill runs | each is claimed before its segments publish and released afterwards |
| E37 | resume: context window | BVA | L1 | automated | archived `contextTokens` 269 644, `contextWindow` 1 000 000; recorded model available | preflight | resumes without prompting; archived window used, not an inferred 200 000 |
| E38 | resume: context window | BVA | L1 | automated | archived `contextTokens` 269 644; user selects a 200 000-window model | preflight | selection refused with an explicit capacity error |
| E39 | resume: context window | BVA | L1 | automated | archived `contextTokens` 199 999; user selects a 200 000-window model | preflight | selection accepted |
| E40 | resume: idempotence | EP | L1 | automated | same session imported twice | second import | exactly one local session; no duplicate file |
| E41 | transport: exclusions | decision-table | L1 | automated | archive published from a machine holding `identity.key`, `paired-devices.json`, `headless-pids.json`, `editor-pids.json`, `preferences.json` | publish | none appear in index or blob store |
| E42 | transport: encryption | EP | L1 | automated | same segment content encrypted twice | compare ciphertexts | ciphertexts differ (non-deterministic AEAD) |
| E43 | transport: recipients | state-transition | L1 | automated | recipient removed, then new segments published | removed recipient attempts decrypt | fails for the new segments |
| E44 | transport: key domain | EP | L1 | automated | archive encryption configured on a machine with an existing Ed25519 `identity.key` | inspect keys | archive keypair is X25519 and distinct from the pairing identity |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | transport: listing | tail-latency | L1 | automated | index describing 4 224 sessions, decrypted from disk | p95 wall-clock < 2 s, zero blob-store requests | 20 runs |
| P2 | resume: materialisation | tail-latency | L1 | automated | one 29 MB session of ~120 segments | p95 end-to-end materialise < 5 s | 20 runs |
| P3 | portability: scrub | throughput | L1 | automated | 851 MB corpus of real transcripts | scrub throughput > 10 MB/s | full corpus |
| P4 | sync: debounce | threshold | L2 | automated | session appending continuously for 30 s | exactly ≤ 1 publish issued in the window | 5 min soak |
| P5 | sync: claim heartbeat | tail-latency | L2 | automated | 200 sessions renewing claims on per-session refs concurrently | zero renewals rejected due to contention | 10 min soak |
| P6 | transport: index growth | threshold | L2 | automated | 1 000 seal-and-publish cycles | index `.git` size bounded after compaction; claims namespace unrewritten | full run |
| P7 | gate: scanning | throughput | L1 | automated | 851 MB corpus | scan adds < 20% to publish wall-clock vs scan disabled | full corpus |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | resume: badge | state-transition | L3 | automated | session with a provenance record | session list renders | card shows an imported indicator naming the origin machine's display alias |
| F2 | resume: badge | state-transition | L3 | automated | locally created session with no provenance record | session list renders | card shows no imported indicator |
| F3 | resume: substitution | state-transition | L3 | automated | imported session resumed with a substituted model | session list renders | card discloses the substitution |
| F4 | sync: listing | state-convergence | L3 | automated | peer publishes a new session | dashboard open, sync runs | list converges to include it as a remote session; no transcript written to the slug dir |
| F5 | resume: materialisation | state-convergence | L3 | automated | remote session listed but not materialised | user opens it | converges to a materialised, readable session; discovery reports no missing cwd |
| F6 | portability: non-resumable | state-transition | L3 | automated | session whose worktree cwd does not exist on the target | user opens it | readable and marked non-resumable; no `cwdMissing` state |
| F7 | gate: quarantine inbox | state-transition | L3 | automated | one flagged and one clean segment | publish pipeline runs | clean segment publishes; flagged one appears in the inbox with its rule and location |
| F8 | gate: quarantine actions | decision-table | L3 | automated | flagged segment | reviewer picks redact / approve / drop | redact publishes redacted bytes only; approve publishes unchanged; drop tombstones the index |
| F9 | sync: claim refusal | state-transition | L3 | automated | session held by another machine | user attempts resume | resume blocked; holder named by display alias, no hostname shown |
| F10 | backfill: warning | state-transition | L3 | automated | estimate exceeding the configured storage limit | user starts backfill | warning shown; no upload begins without confirmation |
| F11 | gate: review usability | visual/subjective | — | manual-only | a realistic batch of ~30 flagged segments from this repo's own transcripts | reviewer works the queue | [judgment: is the queue actually reviewable, or does volume train reflexive approval] |
| F12 | resume: badge legibility | visual/subjective | — | manual-only | long session list mixing local and imported sessions | human scans the list | [judgment: imported sessions distinguishable at a glance] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | format: reconstruction | fault-injection (abort) | L1 | automated | blob for `0001` unretrievable, no tombstone | reconstruct | fails with an explicit gap error naming `0001`; no partial transcript written |
| X2 | gate: unresolved segment | fault-injection (abort) | L1 | automated | segment `0004` quarantined and unresolved | reconstruct | fails with an explicit error naming `0004`; publication of `0005` still succeeded |
| X3 | format: dropped segment | EP | L1 | automated | segment `0001` carries a drop tombstone | reconstruct | transcript produced with an explicitly marked gap at `0001`, distinguishable from intact |
| X4 | gate: scan failure | fault-injection (abort) | L1 | automated | scanner throws on a segment | publish pipeline runs | segment not uploaded; routed to quarantine |
| X5 | gate: ordering invariant | fault-injection (abort) | L1 | automated | upload attempted for a segment with no completed scan | publish | upload refused |
| X6 | gate: deletion | state-transition | L1 | automated | published segment later found to hold a credential | operator deletes it | blob removed; manifest de-references it; reconstruction then reports a gap |
| X7 | sync: stale copy, no tail | fault-injection (delay) | L1 | automated | machine holds `0000-0002`, archive has `0000-0004`, no unsealed tail | claim acquired, session resumed | re-materialised to `0004` before sealing; next seal is `0005`; no divergence |
| X8 | sync: stale copy WITH tail | fault-injection (delay) | L1 | automated | machine holds `0000-0002` plus unpublished local entries; archive has `0000-0004` | claim acquired, session resumed | local entries sealed onto a fork recording `forkedFrom`; neither discarded nor grafted |
| X9 | sync: losing publisher | fault-injection (abort) | L1 | automated | segment publish CAS-rejected at an index | peer resolves divergence | loser's identity and object key available from the divergence namespace; both branches retrievable |
| X10 | sync: publication gating | fault-injection (abort) | L1 | automated | machine without the claim | attempts a segment publish | refused |
| X11 | sync: post-handover | state-transition | L1 | automated | origin handed the claim to B | origin's local transcript seals another segment | origin does not publish it |
| X12 | sync: claim race | fault-injection (delay) | L1 | automated | two machines claim one unclaimed session simultaneously | both push | exactly one succeeds; the other is refused |
| X13 | sync: final tail | state-transition | L1 | automated | session ending with appends below every seal threshold | session ends and holder releases | tail sealed and published first; manifest records the session complete |
| X14 | format: append-only guard | fault-injection (abort) | L1 | automated | an out-of-band rewrite of an already-published prefix | publish pipeline runs | session quarantined; the rewrite is not published |
| X15 | transport: unconfigured | fault-injection (abort) | L1 | automated | no blob-store configuration | export attempted | explicit configuration error; nothing published |
| X16 | transport: blob store down | fault-injection (abort) | L2 | automated | S3 endpoint refuses connections | daemon publish cycle runs | publish retried; index not advanced past unpublished blobs; no partial manifest |
| X17 | transport: index push rejected | fault-injection (delay) | L1 | automated | index advanced concurrently by a peer | metadata push rejected | daemon re-reads, re-merges, retries; concurrently-written fields survive |
| X18 | transport: compaction ⊗ claims | fault-injection (delay) | L1 | automated | content namespace compacted during an in-flight claim renewal | renewal completes | claims namespace unrewritten; renewal unaffected |
| X19 | resume: model unavailable | state-transition | L3 | automated | imported session recording a model not configured locally | user resumes | warned and asked to choose; no resume until a choice is made |
| X20 | resume: claim refused | fault-injection (abort) | L3 | automated | session claimed by another machine | user resumes | blocked, holding machine reported by alias |
| X21 | e2e: cross-machine round trip | fault-injection (env) | — | manual-only | real second machine, real S3 bucket, real teammate recipient keys | export → import → resume | [judgment: full-fidelity round trip on genuinely different hardware and account] |

---

## Coverage summary

- Requirements covered: 26/26
- Scenarios by class: edge 44 · perf 7 · frontend 12 · error 21 — **84 total**
- Scenarios by level: L1 62 · L2 5 · L3 14 · — 3
- Scenarios by disposition: automated 81 · manual-only 3

## New infra needed

- **Two-machine sync harness** — no existing level exercises two independent
  dashboard instances reconciling against one archive. X7–X13, E35, and P5 need
  a fixture that runs two isolated session stores plus a shared index+bucket
  (an in-process fake S3 and a temp git repo suffice at L1; `docker/test-up.sh`
  would need a second instance for an L2/L3 variant).
- **851 MB corpus fixture** — P3 and P7 need the real session store, or a
  generated corpus with comparable image/text ratio. The live store is not a
  reproducible fixture; generation is required.
