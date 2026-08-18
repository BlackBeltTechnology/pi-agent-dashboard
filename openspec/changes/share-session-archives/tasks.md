Phases are ordered so that **no network publish exists until the secret gate
does** (phases 1–3 write only to a local directory target). Phase 3 stands alone
as a shippable slice: it validates the riskiest unknowns — does scrubbing
round-trip, does a rehydrated session actually resume — with none of the
transport, encryption, or daemon machinery.

Because phase 3 has no index and therefore no ref to compare-and-swap on, its
resume path is **single-machine by construction** and the claim requirement does
not apply to it. Claim gating lands with the sync phase, and the resume path is
re-gated there.

Test tasks are folded from `test-plan.md` (sections 10–13) and are the single
source of automated coverage; implementation phases below carry no hand-authored
test tasks. Provisional constants: seal 256 KB ∥ 2000 lines ∥ 60 s idle · claim
renew 60 s / deadline 300 s / skew 30 s · debounce 30 s.

## 1. Spikes and unknowns

- [ ] 1.1 Measure real session write patterns in `~/.pi/agent/sessions/` (append size, append interval, idle gaps) and confirm or revise the provisional seal thresholds; update design.md Open Question 1 and the constants in test-plan.md
- [ ] 1.2 Inspect `goal-store.ts` records for absolute paths and session-id references; define their scrubbing rules and fork behaviour
- [ ] 1.3 Specify how a fork re-identifies a *running* session and how a live pi process is signalled to adopt a new id (design.md Open Question 3)
- [ ] 1.4 Decide whether a session may be re-imported after the target already resumed and diverged locally (design.md Open Question 4)
- [ ] 1.5 Investigate branch-safety of segment boundaries: transcripts are parentId trees, and leaf detection after a mid-branch seal is untested (design.md Open Question 5)
- [ ] 1.6 Define the goals contract — sync, fork, and drop semantics — and add requirements to a spec; goals are in scope but currently have none (design.md Open Question 6)
- [ ] 1.7 Confirm the append-only assumption empirically against a pinned pi version: verify no code path rewrites a published prefix of a `.jsonl` (checking `session/session-file-reader.ts`, `session/replay-compaction.ts`, `session/replay-truncate.ts`, and pi's own writer)
- [ ] 1.8 Build the two-machine sync fixture named in test-plan.md "New infra needed": two isolated session stores plus a shared index repo and an in-process fake S3
- [ ] 1.9 Build the corpus fixture named in test-plan.md "New infra needed": a generated ~851 MB session corpus with an image/text ratio comparable to the live store

## 2. Path portability

- [ ] 2.1 Implement the structural scrubber: parse each JSONL entry, walk it, substitute string fields only, skipping inline image payload fields
- [ ] 2.2 Implement two-token substitution with component-bounded, longest-prefix-first matching: `{{CWD}}` inside the project root, `{{HOME:remote}}` for other home-relative paths, verbatim pass-through otherwise
- [ ] 2.3 Implement the symmetric token-escaping pass covering both tokens, structural like the substitution pass
- [ ] 2.4 Implement `projectKey` derivation: canonicalised git remote hash (strip scheme/userinfo/`.git`/trailing slash, lowercase host, rewrite SCP `host:path` to `host/path`), else user-assigned name, else refuse export
- [ ] 2.5 Implement the root-relative offset so subdirectory and worktree sessions import beneath the target root, and mark sessions whose cwd lies outside the project root as non-resumable
- [ ] 2.6 Implement placeholder expansion on import, leaving `{{HOME:remote}}` unexpanded
- [ ] 2.7 Implement scrubbing of session metadata, goals, and provenance — encryption is not a substitute for substitution

## 3. Local archive format and manual export/import/resume — standalone slice

- [ ] 3.1 Implement the canonical-form invariant: seal, digest, and publish from canonical bytes only, treating the expanded local file as a rendering
- [ ] 3.2 Implement the segmenter with the `bytes ∥ lines ∥ idle` seal policy and the sealed/unsealed tail boundary, ending segments on line boundaries
- [ ] 3.3 Implement zstd compression, segment identity as SHA-256 of canonical plaintext, and an opaque blob object key unrelated to that digest
- [ ] 3.4 Implement the per-session manifest: ordered identities, object keys, sizes, seal timestamps, publishing machine id, drop tombstones, completeness flag
- [ ] 3.5 Implement identity-mismatch integrity rejection on retrieval
- [ ] 3.6 Implement gap semantics: an unresolved or unexpectedly missing segment fails reconstruction with no partial transcript, while a tombstoned drop reconstructs as an explicitly marked gap
- [ ] 3.7 Implement final-tail seal-and-publish at session end so an ended session is not archived permanently truncated
- [ ] 3.8 Implement the runtime append-only guard: a detected rewrite of an already-published prefix quarantines the session instead of publishing the rewrite
- [ ] 3.9 Implement export to a local directory target — no network
- [ ] 3.10 Implement import: reconstruct, expand placeholders, rewrite `meta.cwd` to the target root plus the recorded offset, check the expanded cwd exists, and write into the target slug directory so `session-scanner.ts` discovers it
- [ ] 3.11 Make import idempotent — re-importing the same session creates no duplicate
- [ ] 3.12 Implement the `origin.json` provenance sidecar, written outside the pi-owned `.meta.json`
- [ ] 3.13 Implement the model preflight: warn and require a choice, evaluate capacity against the archived `contextWindow`, never substitute silently
- [ ] 3.14 Add the imported badge to the session card, naming the origin machine's display alias, plus the model-substitution disclosure

## 4. Secret gate — must land before any network publish

- [ ] 4.1 Implement the pattern-only scanner with no entropy scoring: provider key prefixes, JWT, PEM blocks, `scheme://user:pass@host`
- [ ] 4.2 Extend scanning to every published object carrying free text — session metadata, goals, provenance — so the gate is not bypassable by position
- [ ] 4.3 Implement the ordering invariant: a segment that has not completed a scan can never be uploaded; a scan error routes to quarantine
- [ ] 4.4 Implement the quarantine queue store with redact / approve / drop, keeping clean segments publishing while a flagged one is held
- [ ] 4.5 Implement drop semantics: a manifest tombstone so reconstruction reports a marked gap, and union merge does not resurrect the segment from a peer
- [ ] 4.6 Implement redaction as a published, archive-wide marker carrying the pre-redaction canonical identity, recording the published identity separately from the local canonical digest
- [ ] 4.7 Build the quarantine review UI showing the matching rule and offending location
- [ ] 4.8 Invoke the `security-hardening` discipline skill over the gate, the redaction path, and the ordering invariant

## 5. Encryption

- [ ] 5.1 Implement multi-recipient encryption keyed to a per-machine X25519 archive keypair generated for this feature — the existing `~/.pi/dashboard/identity.key` is Ed25519 and must not be reused
- [ ] 5.2 Encrypt every published object: segments, manifests, metadata, provenance, goals, claims
- [ ] 5.3 Implement recipient add/remove and the machine display alias published alongside the opaque machine id
- [ ] 5.4 Implement re-encrypt-and-delete for revocation of already-published segments

## 6. Transport — index repo and blob store

- [ ] 6.1 Implement the git index repository layout with every object encrypted: manifest, meta, origin, goals, claims — claims on per-session refs in a namespace separate from the content namespace
- [ ] 6.2 Implement the generic S3 blob client with operator-supplied endpoint, bucket, and credentials; refuse export with an explicit error when unconfigured
- [ ] 6.3 Implement the machine-local exclusion list (`identity.key`, `paired-devices.json`, `headless-pids.json`, `editor-pids.json`, blob-store credentials, `preferences.json`)
- [ ] 6.4 Implement content-namespace history compaction that never rewrites the claims namespace
- [ ] 6.5 Implement blob deletion plus manifest de-referencing
- [ ] 6.6 Add project-level configuration UI for `projectKey`, endpoint, bucket, credentials, recipient public keys, seal thresholds, claim renewal interval and skew tolerance, the machine display alias, and the storage limit used for backfill warnings

## 7. Bidirectional sync daemon

- [ ] 7.1 Implement the publish side: watcher, 30 s debounce window, seal, and publish
- [ ] 7.2 Implement the retrieve side and index-driven listing of remote sessions without materialisation
- [ ] 7.3 Implement set-union reconciliation over immutable segment identities
- [ ] 7.4 Implement field-wise metadata merge with deletion tombstones and the fetch → decrypt → merge → re-encrypt → re-push retry on push rejection
- [ ] 7.5 Implement claims on per-session refs using push compare-and-swap, with fast-forward-only renewal publishing a next-renewal deadline, skew-tolerant expiry, and voluntary release on session end
- [ ] 7.6 Gate publication on claim ownership: refuse a segment publish without the claim, write the origin's explicit claim at session creation, and stop the origin publishing after handover
- [ ] 7.7 Gate resume on claim acquisition, reporting the holder by display alias, and re-materialise a stale local copy to the archive head before sealing any new segment — sealing an unpublished local tail onto a fork rather than discarding or grafting it
- [ ] 7.8 Implement the divergence namespace so a CAS-rejected publisher records its losing branch, making both branches retrievable and the tie-break computable by every peer
- [ ] 7.9 Implement fork-on-divergence with a new session id and `forkedFrom`, a deterministic tie-break in which a redaction marker outranks an unredacted segment before machine id is consulted, and materialisation that avoids pi's `<uuid>.jsonl` fork-file convention
- [ ] 7.10 Invoke the `systematic-debugging` discipline skill over claim expiry, partial-upload recovery, and divergence paths

## 8. Backfill, observability, and rollback

- [ ] 8.1 Implement backfill scope selection (full vs. horizon) with an estimated object count and total size reported before any upload, claiming and releasing each pre-existing session
- [ ] 8.2 Implement the configured-limit warning requiring confirmation before upload begins
- [ ] 8.3 Instrument sync lag, quarantine depth, claim contention, index size, and upload failures; invoke the `observability-instrumentation` discipline skill
- [ ] 8.4 Verify rollback: disabling the daemon and deleting the index repo plus bucket prefix leaves local sessions untouched and already-imported sessions valid
- [ ] 8.5 Invoke the `performance-optimization` discipline skill against the corpus fixture: seal policy, lazy fetch, watcher debounce

## 9. Verification and documentation

- [ ] 9.1 Run the full suite: `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log`, then grep for failures
- [ ] 9.2 Run `npm run quality:changed` and clear Biome findings
- [ ] 9.3 Invoke the `doubt-driven-review` discipline skill on the scrub, scan, and encryption decisions before the first real publish stands
- [ ] 9.4 Invoke `review-code` on the full diff
- [ ] 9.5 Delegate `docs/` prose to DocScribe: archive format, configuration, threat model, and the recovery runbook for a leaked segment (delete + rotate)
- [ ] 9.6 Add per-file rows to the nearest directory `AGENTS.md` for every new source file
- [ ] 9.7 Run `node scripts/check-conventions.mjs --base <ref>` and `kb dox lint`

## 10. Folded scenarios — L1 unit (vitest)

Exemplars: `packages/server/src/session/__tests__/session-diff-cache.test.ts` for session-store logic, `packages/server/src/attachments/__tests__/attachment-ingest.test.ts` for digest/payload work, `packages/server/src/__tests__/meta-persistence.test.ts` for metadata writers.

- [ ] 10.1 E1 seal below every threshold — input: canonical 255 KB, 1999 lines, last append 59 s ago · trigger: seal evaluation · observable: no segment sealed, tail unsealed — see `session-diff-cache.test.ts` (test-plan #E1)
- [ ] 10.2 E2 seal at the byte threshold — input: canonical exactly 256 KB · trigger: seal evaluation · observable: exactly one segment sealed covering the range — see `session-diff-cache.test.ts` (test-plan #E2)
- [ ] 10.3 E3 seal at the line threshold — input: 2000 lines, 100 KB · trigger: seal evaluation · observable: sealed on lines, not bytes — see `session-diff-cache.test.ts` (test-plan #E3)
- [ ] 10.4 E4 seal on idle — input: 10 KB tail, last append 61 s ago · trigger: seal evaluation · observable: sealed on idle threshold — see `session-diff-cache.test.ts` (test-plan #E4)
- [ ] 10.5 E5 seal never splits a line — input: 300 KB range whose 256 KB point falls mid-line · trigger: seal · observable: ends at preceding newline, concat parses as valid JSONL — see `session-diff-cache.test.ts` (test-plan #E5)
- [ ] 10.6 E6 sealed segments are immutable — input: session with sealed `seg-0002`, 50 KB appended · trigger: seal + publish · observable: `seg-0002` identity unchanged, new content only in `seg-0003`/tail — see `session-diff-cache.test.ts` (test-plan #E6)
- [ ] 10.7 E7 literal `{{CWD}}` round-trips — input: transcript with literal `{{CWD}}` in prose · trigger: scrub then expand · observable: literal preserved, no path substituted — see `attachment-ingest.test.ts` (test-plan #E7)
- [ ] 10.8 E8 literal `{{HOME:remote}}` round-trips symmetrically — input: transcript with the literal in prose · trigger: scrub → expand → re-scrub · observable: canonical bytes equal the origin's — see `attachment-ingest.test.ts` (test-plan #E8)
- [ ] 10.9 E9 byte-exact reconstruction against canonical — input: 5-segment session · trigger: full scrub/segment/compress/encrypt/decrypt/decompress/concat · observable: byte-identical to canonical sealed range — see `session-diff-cache.test.ts` (test-plan #E9)
- [ ] 10.10 E10 identical content yields one identity — input: two machines sealing identical canonical bytes · trigger: random-nonce encryption · observable: shared identity, differing stored bytes and object keys — see `attachment-ingest.test.ts` (test-plan #E10)
- [ ] 10.11 E11 tampered blob rejected — input: manifest identity X, blob digesting to Y · trigger: reconstruction · observable: integrity error — see `attachment-ingest.test.ts` (test-plan #E11)
- [ ] 10.12 E12 incomplete session recorded — input: session with unpublished tail · trigger: manifest write · observable: recorded incomplete — see `meta-persistence.test.ts` (test-plan #E12)
- [ ] 10.13 E13 complete session distinguishable — input: ended session with flushed tail · trigger: manifest write · observable: recorded complete, distinguishable from E12 — see `meta-persistence.test.ts` (test-plan #E13)
- [ ] 10.14 E14 component-bounded negative — input: root `/x/dashboard`, path `/x/dashboard-other/file.ts` · trigger: scrub · observable: unchanged, not `{{CWD}}-other` — see `session-diff-cache.test.ts` (test-plan #E14)
- [ ] 10.15 E15 component-bounded positive — input: root `/x/dashboard`, path `/x/dashboard/file.ts` · trigger: scrub · observable: `{{CWD}}/file.ts` — see `session-diff-cache.test.ts` (test-plan #E15)
- [ ] 10.16 E16 foreign home path tokenised — input: `/Users/u/.agent-browser/tmp/x.png`, home `/Users/u` · trigger: scrub · observable: `{{HOME:remote}}/.agent-browser/tmp/x.png` — see `session-diff-cache.test.ts` (test-plan #E16)
- [ ] 10.17 E17 third band passes through — input: `/private/var/folders/ab/tmp.XYZ/f.ts` · trigger: scrub · observable: unchanged, archive still free of home and project paths — see `session-diff-cache.test.ts` (test-plan #E17)
- [ ] 10.18 E18 longest-prefix ordering — input: project root nested under home, entry inside the project · trigger: scrub · observable: `{{CWD}}` wins over home tokenisation — see `session-diff-cache.test.ts` (test-plan #E18)
- [ ] 10.19 E19 projectKey SCP normalisation — input: `git@github.com:u/x.git` and `https://github.com/u/x` · trigger: canonicalise · observable: one identical key — see `session-diff-cache.test.ts` (test-plan #E19)
- [ ] 10.20 E20 projectKey unresolvable — input: no git remote, no assigned name · trigger: export · observable: refused with a name-request error — see `session-diff-cache.test.ts` (test-plan #E20)
- [ ] 10.21 E21 attachmentId survives scrub — input: inline image whose base64 contains a home-path-matching run · trigger: scrub → expand · observable: `attachmentId` and payload bytes unchanged — see `attachment-ingest.test.ts` (test-plan #E21)
- [ ] 10.22 E22 worktree offset preserved — input: cwd `<root>/.worktrees/feat-x` · trigger: export then import onto `/home/b/dash` · observable: cwd `/home/b/dash/.worktrees/feat-x` — see `session-diff-cache.test.ts` (test-plan #E22)
- [ ] 10.23 E23 metadata and goals scrubbed — input: goal record and meta each with an absolute cwd · trigger: publish · observable: both carry tokens — see `meta-persistence.test.ts` (test-plan #E23)
- [ ] 10.24 E24 known-format detection matrix — input: segments containing `sk-`, `ghp_`, `AKIA`, JWT, PEM, `postgres://u:p@h` · trigger: scan · observable: each flagged with rule and location — see `attachment-ingest.test.ts` (test-plan #E24)
- [ ] 10.25 E25 base64 image not flagged — input: 8 MB base64 image segment, no credential · trigger: scan · observable: not flagged — see `display-fit.test.ts` (test-plan #E25)
- [ ] 10.26 E26 credential in firstMessage gated — input: `meta.firstMessage` containing `sk-…` · trigger: publish metadata · observable: flagged and held, not uploaded — see `meta-persistence.test.ts` (test-plan #E26)
- [ ] 10.27 E27 set-union fast-forward — input: A knows `0000-0002`, archive has `0000-0004` · trigger: reconcile · observable: both reference `0000-0004`, prefix identities unchanged, no bytes fetched — see `session-diff-cache.test.ts` (test-plan #E27)
- [ ] 10.28 E28 deletion tombstone honoured — input: A cleared `closedReason`, B holds prior value · trigger: merge · observable: field remains deleted — see `meta-persistence.test.ts` (test-plan #E28)
- [ ] 10.29 E29 dropped segment not resurrected — input: tombstoned drop, peer holds the identity · trigger: union merge · observable: not restored — see `session-diff-cache.test.ts` (test-plan #E29)
- [ ] 10.30 E30 claim just before expiry — input: deadline 300 s, elapsed 299 s · trigger: B claims · observable: refused — see `session-diff-cache.test.ts` (test-plan #E30)
- [ ] 10.31 E31 claim after deadline plus skew — input: deadline 300 s + 30 s skew, elapsed 331 s · trigger: B claims · observable: granted — see `session-diff-cache.test.ts` (test-plan #E31)
- [ ] 10.32 E32 claim inside skew tolerance — input: deadline exceeded by 15 s · trigger: B claims · observable: refused — see `session-diff-cache.test.ts` (test-plan #E32)
- [ ] 10.33 E33 voluntary release enables immediate handover — input: holder ended and released · trigger: B claims · observable: granted without waiting the deadline — see `session-diff-cache.test.ts` (test-plan #E33)
- [ ] 10.34 E34 redaction dominates the tie-break — input: divergence, branch P redacted, Q not · trigger: resolve · observable: P retained regardless of machine-id ordering — see `session-diff-cache.test.ts` (test-plan #E34)
- [ ] 10.35 E35 tie-break determinism — input: divergence, neither redacted, ids `m-aaa`/`m-bbb` · trigger: resolved on both machines · observable: identical retain/fork decision — see `session-diff-cache.test.ts` (test-plan #E35)
- [ ] 10.36 E36 backfill claims and releases — input: 4 224 pre-feature sessions · trigger: backfill · observable: each claimed before publish, released after — see `session-diff-cache.test.ts` (test-plan #E36)
- [ ] 10.37 E37 archived context window honoured — input: `contextTokens` 269 644 / `contextWindow` 1 000 000, model available · trigger: preflight · observable: resumes unprompted using the archived window — see `meta-persistence.test.ts` (test-plan #E37)
- [ ] 10.38 E38 insufficient window refused — input: `contextTokens` 269 644, user picks a 200 000-window model · trigger: preflight · observable: refused with a capacity error — see `meta-persistence.test.ts` (test-plan #E38)
- [ ] 10.39 E39 sufficient window accepted — input: `contextTokens` 199 999, 200 000-window model · trigger: preflight · observable: accepted — see `meta-persistence.test.ts` (test-plan #E39)
- [ ] 10.40 E40 import idempotence — input: same session imported twice · trigger: second import · observable: exactly one local session — see `session-diff-cache.test.ts` (test-plan #E40)
- [ ] 10.41 E41 machine-local exclusions — input: machine holding the five excluded files · trigger: publish · observable: none appear in index or blob store — see `session-diff-cache.test.ts` (test-plan #E41)
- [ ] 10.42 E42 non-deterministic encryption — input: same segment encrypted twice · trigger: compare · observable: ciphertexts differ — see `attachment-ingest.test.ts` (test-plan #E42)
- [ ] 10.43 E43 removed recipient loses access — input: recipient removed, new segments published · trigger: removed recipient decrypts · observable: fails for new segments — see `attachment-ingest.test.ts` (test-plan #E43)
- [ ] 10.44 E44 archive key distinct from pairing identity — input: machine with an Ed25519 `identity.key` · trigger: configure archive encryption · observable: archive keypair is X25519 and distinct — see `attachment-ingest.test.ts` (test-plan #E44)
- [ ] 10.45 P1 listing latency — workload: index of 4 224 sessions decrypted from disk · metric: p95 < 2 s and zero blob-store requests · window: 20 runs — see `display-fit-perf.test.ts` (test-plan #P1)
- [ ] 10.46 P2 materialisation latency — workload: one 29 MB, ~120-segment session · metric: p95 end-to-end < 5 s · window: 20 runs — see `display-fit-perf.test.ts` (test-plan #P2)
- [ ] 10.47 P3 scrub throughput — workload: 851 MB corpus fixture · metric: > 10 MB/s · window: full corpus — see `display-fit-perf.test.ts` (test-plan #P3)
- [ ] 10.48 P7 scanning overhead — workload: 851 MB corpus fixture · metric: < 20% added publish wall-clock vs scan disabled · window: full corpus — see `display-fit-perf.test.ts` (test-plan #P7)
- [ ] 10.49 X1 missing blob fails reconstruction — fault: blob `0001` unretrievable, no tombstone · trigger: reconstruct · observable: explicit gap error naming `0001`, no partial transcript — see `session-diff-cache.test.ts` (test-plan #X1)
- [ ] 10.50 X2 unresolved quarantine fails reconstruction — fault: `0004` quarantined · trigger: reconstruct · observable: explicit error naming `0004` while `0005` publication succeeded — see `session-diff-cache.test.ts` (test-plan #X2)
- [ ] 10.51 X3 dropped segment reconstructs as marked gap — input: `0001` tombstoned · trigger: reconstruct · observable: transcript with an explicitly marked gap, distinguishable from intact — see `session-diff-cache.test.ts` (test-plan #X3)
- [ ] 10.52 X4 scanner throw routes to quarantine — fault: scanner throws · trigger: publish · observable: not uploaded, quarantined — see `attachment-ingest.test.ts` (test-plan #X4)
- [ ] 10.53 X5 unscanned segment cannot upload — fault: upload attempted with no completed scan · trigger: publish · observable: refused — see `attachment-ingest.test.ts` (test-plan #X5)
- [ ] 10.54 X6 published segment deletable — input: leaked published segment · trigger: operator delete · observable: blob removed, manifest de-referenced, reconstruction reports a gap — see `session-diff-cache.test.ts` (test-plan #X6)
- [ ] 10.55 X7 stale copy without tail re-materialises — fault: local `0000-0002`, archive `0000-0004`, no tail · trigger: claim + resume · observable: re-materialised to `0004`, next seal `0005`, no divergence — see `session-diff-cache.test.ts` (test-plan #X7)
- [ ] 10.56 X8 stale copy with tail forks — fault: local `0000-0002` plus unpublished entries, archive `0000-0004` · trigger: claim + resume · observable: tail sealed onto a fork with `forkedFrom`, neither discarded nor grafted — see `session-diff-cache.test.ts` (test-plan #X8)
- [ ] 10.57 X9 losing publisher recorded — fault: publish CAS-rejected at an index · trigger: peer resolves · observable: loser's identity and key available from the divergence namespace, both branches retrievable — see `session-diff-cache.test.ts` (test-plan #X9)
- [ ] 10.58 X10 publication without claim refused — fault: machine lacks the claim · trigger: segment publish · observable: refused — see `session-diff-cache.test.ts` (test-plan #X10)
- [ ] 10.59 X11 origin stops publishing after handover — input: claim handed to B · trigger: origin seals another segment · observable: origin does not publish it — see `session-diff-cache.test.ts` (test-plan #X11)
- [ ] 10.60 X12 concurrent claim race — fault: two machines claim simultaneously · trigger: both push · observable: exactly one succeeds — see `session-diff-cache.test.ts` (test-plan #X12)
- [ ] 10.61 X13 final tail flushed on release — input: session ending below every seal threshold · trigger: end + release · observable: tail sealed and published first, manifest records complete — see `session-diff-cache.test.ts` (test-plan #X13)
- [ ] 10.62 X14 append-only guard quarantines a rewrite — fault: out-of-band rewrite of a published prefix · trigger: publish · observable: session quarantined, rewrite not published — see `session-diff-cache.test.ts` (test-plan #X14)
- [ ] 10.63 X15 unconfigured transport refuses export — fault: no blob-store config · trigger: export · observable: explicit configuration error, nothing published — see `session-diff-cache.test.ts` (test-plan #X15)
- [ ] 10.64 X17 index push rejection retries — fault: index advanced by a peer · trigger: metadata push · observable: re-read, re-merge, retry; concurrent fields survive — see `meta-persistence.test.ts` (test-plan #X17)
- [ ] 10.65 X18 compaction leaves claims intact — fault: content namespace compacted during a renewal · trigger: renewal completes · observable: claims namespace unrewritten, renewal unaffected — see `session-diff-cache.test.ts` (test-plan #X18)

## 11. Folded scenarios — L2 process smoke (qa/tests)

Exemplars: `qa/tests/17-bridge-contention.sh` for contention/soak shape, `qa/tests/16-e2e-memory-bound.sh` for bounded-resource assertions. No rendered-UI assertions in this tier.

- [ ] 11.1 P4 debounce bound — workload: session appending continuously for 30 s · metric: ≤ 1 publish issued per window · window: 5 min soak — see `qa/tests/17-bridge-contention.sh` (test-plan #P4)
- [ ] 11.2 P5 claim heartbeat contention — workload: 200 sessions renewing per-session-ref claims concurrently · metric: zero renewals rejected for contention · window: 10 min soak — see `qa/tests/17-bridge-contention.sh` (test-plan #P5)
- [ ] 11.3 P6 index growth bounded — workload: 1 000 seal-and-publish cycles · metric: index `.git` size bounded after compaction, claims namespace unrewritten · window: full run — see `qa/tests/16-e2e-memory-bound.sh` (test-plan #P6)
- [ ] 11.4 X16 blob store unavailable — fault: S3 endpoint refuses connections · trigger: daemon publish cycle · observable: publish retried, index not advanced past unpublished blobs, no partial manifest — see `qa/tests/17-bridge-contention.sh` (test-plan #X16)

## 12. Folded scenarios — L3 browser e2e (tests/e2e)

Exemplars: `tests/e2e/ended-session-endedat.spec.ts` for session-card state, `tests/e2e/large-session-replay.spec.ts` for heavy-session rendering, `tests/e2e/blackhole-settings.spec.ts` for settings surfaces. Read the harness port from `.pi-test-harness.json` (`dashboardPort`) — never hardcode `:18000`.

- [ ] 12.1 F1 imported badge shown — input: session with a provenance record · trigger: list renders · observable: card shows an imported indicator naming the origin alias — see `ended-session-endedat.spec.ts` (test-plan #F1)
- [ ] 12.2 F2 local session unbadged — input: session with no provenance record · trigger: list renders · observable: no imported indicator — see `ended-session-endedat.spec.ts` (test-plan #F2)
- [ ] 12.3 F3 model substitution disclosed — input: imported session resumed on a substituted model · trigger: list renders · observable: card discloses the substitution — see `ended-session-endedat.spec.ts` (test-plan #F3)
- [ ] 12.4 F4 remote session listed without materialisation — input: peer publishes a session · trigger: sync with dashboard open · observable: converges to a listed remote session, no transcript in the slug dir — see `session-reap.spec.ts` (test-plan #F4)
- [ ] 12.5 F5 open materialises — input: listed but unmaterialised remote session · trigger: user opens it · observable: converges to a materialised readable session, no missing-cwd report — see `large-session-replay.spec.ts` (test-plan #F5)
- [ ] 12.6 F6 non-resumable worktree session — input: session whose worktree cwd is absent on the target · trigger: user opens it · observable: readable and marked non-resumable, no `cwdMissing` state — see `out-of-cwd-session-diffs.spec.ts` (test-plan #F6)
- [ ] 12.7 F7 quarantine inbox surfaces a flag — input: one flagged and one clean segment · trigger: publish pipeline · observable: clean publishes, flagged appears with rule and location — see `blackhole-settings.spec.ts` (test-plan #F7)
- [ ] 12.8 F8 quarantine actions — input: flagged segment · trigger: reviewer picks redact/approve/drop · observable: redact publishes redacted bytes only, approve publishes unchanged, drop tombstones the index — see `blackhole-settings.spec.ts` (test-plan #F8)
- [ ] 12.9 F9 claim refusal surfaced — input: session held by another machine · trigger: user resumes · observable: blocked, holder named by alias, no hostname shown — see `ended-session-endedat.spec.ts` (test-plan #F9)
- [ ] 12.10 F10 backfill limit warning — input: estimate exceeding the configured limit · trigger: user starts backfill · observable: warning shown, no upload without confirmation — see `blackhole-settings.spec.ts` (test-plan #F10)
- [ ] 12.11 X19 unavailable model prompts — input: imported session recording an unconfigured model · trigger: user resumes · observable: warned and asked to choose, no resume until chosen — see `list-models-registry-ready.spec.ts` (test-plan #X19)
- [ ] 12.12 X20 resume blocked by claim — fault: session claimed elsewhere · trigger: user resumes · observable: blocked, holder reported by alias — see `ended-session-endedat.spec.ts` (test-plan #X20)

## 13. Manual verification (deferred post-merge)

- [ ] 13.1 F11 work a realistic batch of ~30 flagged segments from this repo's own transcripts and judge whether the quarantine queue is genuinely reviewable or trains reflexive approval (test-plan: manual-only)
- [ ] 13.2 F12 scan a long session list mixing local and imported sessions and judge whether imported ones are distinguishable at a glance (test-plan: manual-only)
- [ ] 13.3 X21 run a full export → import → resume round trip against a real second machine, a real S3 bucket, and real teammate recipient keys (test-plan: manual-only)
