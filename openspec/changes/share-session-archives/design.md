## Context

pi session transcripts are the highest-fidelity record of how work was actually
done, but their on-disk layout is machine-bound in three independent ways: the
slug directory name encodes the absolute cwd, `meta.json.cwd` is absolute, and
the transcript body carries absolute paths in tool arguments, tool results,
diffs, and stack traces.

Current state, verified against the working tree:

| Fact | Source |
|---|---|
| Sessions at `~/.pi/agent/sessions/<slug>/`, slug = cwd with `/`→`-` | `session-scanner.ts` |
| Discovery is a filesystem scan: `readdirSync` for `*.jsonl`, read `.meta.json`, stat `meta.cwd` for `cwdMissing` | `session-scanner.ts` |
| `<ts>_<uuid>.jsonl` is append-only *by the server*; forks write a NEW file | `session/session-file-reader.ts::createBranchedSessionFile` |
| A fork file is named `<uuid>.jsonl`, **not** `<ts>_<uuid>.jsonl`, and is therefore invisible to `extractSessionId` | `session/session-scanner.ts` (pre-existing quirk) |
| Compaction and truncation are replay-only, on the in-memory store; the server never writes the `.jsonl` | `replay-compaction.ts`, `replay-truncate.ts` |
| `.jsonl.bak` and `.jsonl.bak-pre-imgfix-*` files exist on disk today | 4 files in the live session store |
| `.meta.json` is a full-rewrite blob, 1 s debounce, **plus eager non-debounced writers** (`setLiveness`, `setDisplayPrefsOverride`, `setProcessDrawerCollapsed`) and scanner-side rewrites on stale cache | `meta-persistence.ts`, `session-scanner.ts` |
| Inline image originals live **inside the transcript**, no side store | `attachments/original-store.ts` (D7 of `fit-attachments-for-display`) |
| `attachmentId` = sha256 of the **original base64 text**, encoding-sensitive | `attachment-ingest.ts::attachmentIdFor` |
| The context-window inference in `extractSessionStats` pins any `claude` model to 200 000 and ignores 1M variants; live meta on disk shows `contextTokens: 269644 / contextWindow: 1000000` | `session/session-stats-reader.ts` |
| A git worktree may live **outside** the project root (verified: one at `/private/var/folders/…/tmp.AH18lnlujb`) | `git worktree list` |
| `~/.pi/dashboard/attachments/<sessionId>/<hash>.<ext>` holds `ask_user` pasted images, written so the Read tool can open them, and is **deleted at session end** | `packages/extension/src/ask-user-attachments.ts` (`writeFileSync` → `cleanupAttachmentsForSession`) |
| `identity.key` is an **Ed25519** keypair for TOFU pairing and bearer auth | `auth/identity.ts` |
| Goals are per-cwd records carrying absolute `cwd`, `objective`, verdicts | `goal/goal-store.ts` |
| Scale, this repo alone | 4 224 files / 851 MB; 1.5 GB all projects |

Stakeholders are a small group of trusted teammates sharing one project's
history. The threat model is *accidental* disclosure — a secret pasted into a
prompt, a `.env` read into a tool result — not a hostile insider.

Two structural properties carry the design: the transcript is **append-only**
(so a live session is a strict prefix of its later self, and merge is decidable),
and `meta.json` has **no ordering guarantee** (so it needs field-level merge
instead). The `.bak-pre-imgfix` files are evidence that the append-only invariant
has been broken historically by an out-of-band migration, so it is treated as an
invariant to *verify and guard*, not to assume.

## Goals / Non-Goals

**Goals:**

- Export one project's sessions into a machine-independent archive and import
  them on a machine whose project root and home directory differ.
- Resume an imported session as a first-class local session.
- Bidirectional, hands-off synchronisation that tolerates incomplete (live)
  sessions on either side.
- Make accidental secret disclosure both *unlikely* (pre-publication gate) and
  *recoverable* (real deletion + rotation).
- Show provenance: a session that came from elsewhere is visibly marked.

**Non-Goals:**

- Cross-session deduplication (D6 — mutually exclusive with sound encryption).
- Entropy-based secret detection (D5 — would flag every image-bearing session).
- **Username erasure.** Substitution covers *paths*. A transcript legitimately
  contains `ls -la` output, git author lines, and `git@github.com:user/repo`
  remotes; erasing an identity from free text is a different and much harder
  problem. Under the trusted-teammate threat model the username is not a secret.
  Stated explicitly because an earlier draft over-promised it.
- Syncing the global `preferences.json` slice. Provenance is the only dashboard
  state that travels.
- Public or untrusted-audience publishing.
- Real-time streaming of a live session. Remote freshness is bounded by the seal
  interval, by construction.

## Decisions

### D1 — The canonical form is the scrubbed transcript; the local file is a view

This is the load-bearing invariant, and everything else depends on it.

```mermaid
flowchart LR
  local["local transcript<br/>(expanded, machine paths)"] -->|scrub| canon["CANONICAL<br/>(placeholder tokens)"]
  canon -->|expand| local
  canon --> seg["segments · digests · manifest"]
```

Sealing, digesting, and publishing operate **only** on the canonical form. The
expanded on-disk transcript is a rendering of it, never a source.

*Why:* without this, an imported session re-seals from *expanded local bytes*
whose content differs from the archived canonical, producing a divergent
`seg-0000` on the very first sync with nobody misbehaving. The feature would
fork every session it successfully imported.

*Required property:* `scrub(expand(x)) == x`.

This obliges a **token-escaping pass distinct from path substitution**. A literal
`{{CWD}}` in prose is not a path, so the path matcher never touches it; without a
separate pass, expansion would substitute a real path into prose. The pass is
symmetric and covers **both** tokens: scrub escapes any literal `{{CWD}}` or
`{{HOME:remote}}` occurring in content, expand unescapes them. Asymmetry here is
a live hazard — an imported transcript legitimately *contains* unexpanded
`{{HOME:remote}}` tokens, so escaping one token but not the other makes a
re-seal on the importing machine produce different canonical bytes for identical
content, which is precisely the false divergence D3 exists to prevent. The
escaping pass is structural like D4, skipping image payloads.

*Known limit — the invariant does not self-police tokenisation.* A mis-scoped
substitution (D4) still round-trips cleanly on the machine that produced it, so
`scrub(expand(x)) == x` passing is **not** evidence that tokenisation is
correct. Boundary correctness needs its own tests.

### D2 — Segment the canonical transcript into sealed, immutable units

A session becomes an ordered list of segments over the canonical form; the
unsealed tail stays local. Seal fires on `bytes ∥ lines ∥ idle-seconds`.

*Why:* re-uploading a growing file costs O(N²). Sealing makes each append a new
*small* immutable blob → O(N). It also collapses three other problems: an
incomplete session stops being a special case, two-way sync becomes a **set
union** over immutable identities rather than a merge, and divergence becomes
provable instead of heuristic. Seal is additionally the natural once-per-blob
scanning boundary.

*Alternatives:* whole-file re-upload (O(N²)); ended-sessions-only export (kills
cross-machine resume of in-flight work); a live tail over the dashboard's peer
channel (two transports; the seal interval already bounds staleness).

### D3 — Segment identity is the digest of canonical plaintext; the blob key is opaque

| Value | Derivation | Visible to |
|---|---|---|
| segment identity | sha256(canonical plaintext) | key holders only (manifest is encrypted) |
| blob object key | random opaque id | the blob store |

*Why not digest the stored bytes:* encryption is non-deterministic by design
(D6), so identical content yields different ciphertext and therefore different
stored-byte digests. Divergence detection built on that would report a **false
fork** whenever two machines sealed identical content — which is exactly what
happens after a lease handover. Digesting the plaintext makes "same content ⇒
same identity" true again.

*Why the blob key must not be the plaintext digest:* it would make content
equality visible to the blob store, reintroducing precisely the leak that
refusing dedup (D6) exists to avoid.

### D4 — Scrub paths structurally, with two tokens only

| Source | Token | On import |
|---|---|---|
| inside the project root | `{{CWD}}` | target project root |
| any other home-relative path | `{{HOME:remote}}` | **never expanded** |
| neither under the project root nor under home | *(unchanged)* | — |

*Matching is component-bounded.* A prefix match must end on a path separator:
`/Users/u/Project/dashboard-other` shares a string prefix with project root
`/Users/u/Project/dashboard` but is a different directory, and a naive
longest-prefix rule emits `{{CWD}}-other`, which expands into a fabricated
target path. Only whole-component prefixes tokenise.

*The third band is deliberately untokenised and non-portable.* Paths under
neither the project root nor home — `/tmp`, `/private/var/folders/…`,
`/opt/homebrew` — pass through verbatim. They contain no home or project path, so
the portability contract holds, but they are not resolvable on the target. This
matters because **a git worktree can live outside the project root** (verified on
this machine), and such a session's own cwd falls in this band: it is
exportable but not resumable, and must be reported as such rather than
silently importing broken.

*Why only two tokens:* an earlier draft had a third, plain `{{HOME}}`, for
home-relative paths "within the project ancestry". It has no safe expansion —
`{{HOME}}/Project/x` becomes `/home/bob/Project/x` on a machine whose projects
live in `~/dev`, fabricating a plausible-but-nonexistent path. That is the exact
hazard the foreign-path token exists to prevent, so the middle band is removed
rather than specified.

*`{{CWD}}` anchors the project root, not the session cwd.* Sessions frequently
run in a subdirectory or a git worktree of the project (this repo uses worktrees
routinely), so a session records a root-relative offset alongside the token.
Anchoring on cwd would make two sessions of the same project non-portable to
each other.

*Why structural, not regex — the second load-bearing constraint:*
`attachmentId` is the sha256 of the **original base64 text**, and originals are
recovered by scanning the transcript itself (`original-store.ts`). A blind
line-level substitution matching inside a base64 `data` field would corrupt the
image *and* change its digest, breaking click-to-original with no error
anywhere. The scrubber parses each JSONL entry, walks it, and skips image-block
`data` fields.

*Scope:* scrubbing applies to transcript bodies, `meta`, goals, and provenance —
every published value. Encryption is not a substitute for substitution; the two
are independent obligations.

### D5 — Address projects by a normalised `projectKey`

`projectKey` = hash of the **canonicalised** git remote URL, else a
user-assigned name. Canonicalisation strips the scheme, userinfo, `.git` suffix
and trailing slash, lowercases the host, **and rewrites the SCP-style
`host:path` separator to `host/path`**.

*Why the SCP rule is load-bearing:* without it the algorithm fails its own
requirement. Executed against the earlier draft's rules,
`git@github.com:u/x.git` yields `github.com:u/x` while
`https://github.com/u/x` yields `github.com/u/x` — colon versus slash, two
different keys, one project split into two archives.

### D6 — Split transport: index in git, blobs in an S3-compatible store

```mermaid
flowchart TB
  subgraph IDX["Index repo — plain git, no LFS. Every object encrypted."]
    M["manifest"]
    ME["meta"]
    OR["origin"]
    G["goals"]
    CL["claims"]
  end
  subgraph BS["Blob store — generic S3 API"]
    B["blobs/&lt;opaque-key&gt;"]
  end
  IDX -->|"identity + key reference"| BS
```

Goals live in the **index**, not the blob store — they are tiny JSON records.
(An earlier draft's diagram placed them in blobs; that was inconsistent.)

*Why not git LFS* — rejected on security, not cost: LFS history is effectively
permanent, so a missed secret cannot be withdrawn. The quarantine gate (D8) is a
*preventive* control; without deletion there is no *corrective* control. The
1 GiB free quota against an 851 MB first push is secondary.

*Why keep git for the index:* `git push` on a ref is a compare-and-swap, giving
atomic claims (D9) with no lock server and no dependency on whether the chosen
S3 backend implements conditional writes. Listing costs zero bucket calls and
works offline.

*Consequence:* git is demoted from *merge engine* to *atomic transport for small
objects*. `meta` is merged field-wise by us after decryption, in a
fetch → decrypt → merge → re-encrypt → re-push retry.

*The permanence argument applies to the index too.* Since git history is
permanent there as well, **every** index object — manifest, meta, origin, goals,
claims — is encrypted, and claims carry an **opaque machine id** rather than a
hostname.

*Content refs and claim refs are separate namespaces, because squash and CAS are
mechanically incompatible.* History compaction is by construction a
non-fast-forward rewrite, and D9's lease depends on renewal being strictly
fast-forward. Squashing therefore applies only to the content namespace
(manifests, meta, origin, goals); the claims namespace is never rewritten and
stays small because a claim record is bounded per session.

*Alternatives:* pure S3 (loses free CAS and offline listing); rclone/rsync over
SSH (no CAS); restic/kopia (better storage math via dedup, but snapshot-shaped —
extracting one session is against the grain); Syncthing (no lazy fetch,
all-or-nothing per device); OCI registry via ORAS (workable, unnecessary
friction).

### D7 — Listing is index-driven; materialisation is a distinct, explicit act

Remote sessions are listed from the decrypted index and are **not** written into
the local slug directory. Import — materialising the transcript and `meta` into
the slug directory so `session-scanner.ts` discovers it — happens on open or
resume.

*Why:* discovery is a `readdirSync` over slug dirs that stats `meta.cwd`.
Materialising every remote session on sync would fetch every blob (violating
lazy fetch), and writing a stub would list a session whose `cwd` is a
placeholder and immediately flag `cwdMissing`. Listing and materialising are
therefore separate states.

At materialisation, `meta.cwd` is rewritten to the target project root **plus
the session's recorded root-relative offset** — not to the bare root, which would
relocate a subdirectory or worktree session and change its slug.

*The expanded cwd is checked for existence before materialising.* An offset that
resolves inside the project root is not thereby guaranteed to exist on the
target: a session run in `.worktrees/feature-x` imports onto a machine with no
such worktree, producing exactly the plausible-but-nonexistent path that killed
the `{{HOME}}` token. Such a session is listed and readable but marked
non-resumable, rather than materialised into a `cwdMissing` state.

*An already-materialised session is re-materialised before its first new seal.*
Otherwise the stale-local-copy path breaks: a machine holding segments 0000–0002
while the origin published 0003–0004 would, on resume, either seal a conflicting
0003 (a provable false fork) or seal 0005 on top of a transcript missing two
segments (dangling `parentId` references). Re-materialisation is a precondition
of publication, not a convenience.

### D8 — Asynchronous secret gate, known-format patterns only

Clean segments upload immediately; flagged ones **park** in a dashboard
quarantine inbox offering redact / approve / drop. Detection is pattern-only:
`sk-`, `ghp_`, `AKIA`, JWT, PEM blocks, `scheme://user:pass@host`.

*Why not entropy:* 29 MB image-heavy sessions would trip it on essentially every
segment, and a queue that flags everything trains reflexive approval. Known
false negatives are accepted; residual risk is carried by encryption (D10) and
deletability (D6).

*Ordering is non-negotiable:* scan before first upload. The first upload is the
disclosure.

*A held segment blocks its session's reconstruction, and that is intended.*
Publishing continues for clean segments; recoverability is a separate matter,
and the two outcomes are deliberately different:

| Segment state | Manifest | Reconstruction |
|---|---|---|
| quarantined, unresolved | index absent, no tombstone | **fails** — no partial transcript written |
| dropped by a reviewer | tombstone recorded | succeeds with an **explicitly marked gap** |

The distinction is deliberate-versus-accidental: a tombstone is a decision that
the archive records, while an absent index is an unknown the archive must not
paper over. An earlier draft used "reconstructs with a gap" for both, which
contradicted the format contract.

*Scanning covers every published object carrying free text, not only segments.*
`meta.firstMessage` is the verbatim first user prompt, and goals carry
`objective` and verdict prose. A credential pasted into a first message would
otherwise ride the metadata into the index unscanned while the identical bytes
in a segment were gated — the gate would be trivially bypassable by position.

*Redaction and drop change the published identity.* The publishing machine
records the published identity per segment separately from its local canonical
digest, so a redacted segment does not read as divergence against its own
origin.

*A redaction is authoritative archive-wide, not a local opinion.* Two machines
scanning the same content can disagree — one redacts, one approves — producing
differing identities at one index and therefore a fork, in which a naive
tie-break could retain the **unredacted, secret-bearing** branch. A redaction is
therefore published as a marker that peers converge on, and it dominates the
tie-break (D9).

The marker **carries the pre-redaction canonical identity**. Without it a peer
holding the unredacted identity cannot tell that the published identity is a
redaction *of the segment it holds* rather than genuinely divergent content, and
the divergence exception is unevaluable.

*A drop needs a segment-level tombstone.* Merging is a set union (D9), so a peer
still holding a dropped segment's identity would otherwise resurrect it on the
next sync. D11's tombstones cover metadata fields only; segment drops carry
their own tombstone in the manifest, and union merge honours it.

### D9 — Claims gate **publication**, not merely resume

A session is *owned* by exactly one machine at a time. Only the owner publishes
segments for it. Importing and resuming elsewhere requires transferring
ownership.

```mermaid
sequenceDiagram
  participant A as Machine A (owner)
  participant R as claims ref
  participant B as Machine B
  B->>R: request claim
  R-->>B: refused — A holds it
  Note over A: A stops heartbeating
  B->>R: claim after expiry (CAS push)
  R-->>B: granted — B may now publish
```

*Why publication and not resume:* gating only resume leaves the origin machine
publishing unclaimed. The feature's headline flow — import an *incomplete*
session and resume it while the origin is still working — would then diverge
every single time, making the fork path the common case instead of the edge
case. Claims must bound *who may append to the published history*.

Claims live on **per-session refs** in a dedicated namespace, so a claim
round-trip never drags blobs and heartbeats from different sessions never
contend with each other. A single shared claims ref would serialise every
machine's heartbeat through one CAS point.

A claim carries an opaque machine id (D6). Each machine additionally publishes a
**self-chosen display alias** keyed by that id, so a refusal can name a holder
humanly without putting hostnames in permanent git history.

*The claim is explicit from creation, never implicit.* An "implicit" claim has
no representation on the ref, leaving a window in which another machine can
claim a session its origin is actively writing. The origin writes a real claim
when the session is created and heartbeats it like any other holder.

*Backfill claims and releases.* Sessions that predate the feature were never
created under this rule, so backfilling one acquires its claim, publishes, and
releases — there is no exception to claim-before-publication, because an
exception is exactly the hole the rule exists to close.

*A holder seals and publishes its final tail before releasing.* Otherwise every
session whose last appends fall inside the idle window is archived permanently
truncated, and after handover the origin may never publish them at all —
systematic loss of the ending of every session, in a feature justified on
fidelity.

*Expiry uses a published deadline, not a bare counter.* Each renewal publishes
the holder's next-renewal deadline; a claimant may take over once that deadline
has passed by more than a configured skew tolerance. An earlier draft proposed a
"heartbeat counter rather than wall-clock", which is incoherent — observing that
a counter *stopped advancing* requires a clock somewhere. Wall-clock is
unavoidable; what is avoidable is trusting an unbounded clock difference.

A holder **releases voluntarily** when its session ends, so handover does not
require waiting out an expiry.

*Honest consequence, stated plainly:* this design does not make concurrent
resume safe — it makes it **impossible**. While the origin holds a live claim,
another machine's resume is refused outright. The supported flow is *handover*
(voluntary release, or expiry after the origin goes idle), not simultaneous work
on one session. An earlier draft's framing of "resume while the origin is still
working" as the headline flow was wrong, and the proposal is corrected to match.

*Fork remains the fallback*, not the mechanism: when divergence occurs anyway
(expiry during a partition), a deterministic tie-break both machines compute
identically retains one branch and mints the other as a fork with `forkedFrom`.
The tie-break is **not** a bare machine-id comparison: a segment carrying a
redaction marker always outranks an unredacted segment at the same index, so the
resolution can never promote secret-bearing content over the redacted version of
it. The publishing machine id, recorded per segment in the manifest, breaks the
remaining ties.

*The losing branch must be published, or the tie-break has no input.* A losing
publish is CAS-rejected, so without a further step the loser's identity and
object key never reach the shared index — no peer could compute the same
resolution, and "both branches remain retrievable" would be false. A rejected
publisher therefore records its branch in a divergence namespace, from which the
resolution is computed. This is what makes the symmetric case symmetric.

*A returning machine may hold an unsealed local tail.* Re-materialising to the
archive head (D7) would orphan it. The tail is sealed onto a fork rather than
discarded or grafted — grafting would require re-parenting `parentId` chains
across a foreign continuation, which is not a merge the format supports.

*A fork must not be materialised under pi's own fork-file convention*
(`<uuid>.jsonl`), which `extractSessionId` cannot parse — the forked session
would be invisible to discovery.

### D10 — Client-side multi-recipient encryption; dedup refused to permit it

Every published object is encrypted before leaving the machine with age-style
multi-recipient encryption. Recipients are **X25519 archive keypairs generated
for this feature**, not the existing `identity.key`, which is Ed25519 and serves
TOFU pairing and bearer auth — a different security domain, and the wrong curve.

`meta` is encrypted: `firstMessage` is the session title and is verbatim
conversation prose.

*Why dedup is a non-goal:* dedup requires convergent encryption, under which a
bucket holder can prove two sessions share content and can confirm any guessed
plaintext. Refusing it permits random-nonce AEAD, which leaks nothing but
length. Content identity is preserved separately by D3.

### D11 — Metadata merge is field-wise with tombstones

`meta` fields carry a last-writer stamp, and **deletions are tombstoned**.

*Why:* `setLiveness` clears `closedReason` and `setDisplayPrefsOverride` removes
a field entirely. A naive field-wise merge that treats "absent" as "no opinion"
would resurrect a deleted field from the other side's stale copy.

### D12 — Resume preflight uses the archived context window

A session records `contextTokens` and `contextWindow` at export. The preflight
compares against the **archived** value, never `inferContextWindow`, which pins
Claude models to 200k and ignores 1M variants — live meta on this machine shows
`contextTokens: 269644 / contextWindow: 1000000`, which that heuristic would
reject outright.

The user is warned and picks whenever the recorded model is unavailable or its
window is insufficient; a recorded model that is available and sufficient
resumes without a prompt. "Never substitutes silently" governs *substitution*,
not the unambiguous case.

### D13 — Provenance in an `origin` record

*Why not `meta.json`:* it is pi's file, with a debounced writer *and* eager
non-debounced writers *and* scanner-side rewrites — three racing writers.
*Why not dashboard-local state:* it must travel. The record is ours, is
encrypted like every index object, and drives an *imported-from* badge.
Backfill scope is configurable per project with a size estimate and a warning
before exceeding a configured limit.

## Risks / Trade-offs

- **Pattern-only scanning misses novel formats** → accepted; mitigated by
  encryption and by delete + rotate as the corrective control.
- **This repo's own transcripts discuss `ghp_`, `AKIA`, and PEM literals** and
  will self-flag → accepted; the queue exists for exactly this, but it makes
  this repository an unrepresentative test case for fatigue measurement.
- **Blind scrubbing would corrupt images and break `attachmentId`** → structural
  scrubbing (D4); round-trip digest equality is a hard test obligation.
- **`scrub(expand(x)) == x` is an invariant an escaping bug silently violates**
  → property-tested, including transcripts containing literal tokens.
- **Seal interval trades freshness against blob count** → configurable; no
  defensible default without measurement.
- **Lease expiry during a partition still permits divergence** → detectable via
  plaintext identity (D3), resolved by a deterministic tie-break fork.
- **Key rotation cannot un-read what a departed teammate already read** →
  forward secrecy only.
- **Index `.git` history grows one commit per seal** → periodic squash; history
  size is a monitored metric, not an assumption.
- **The append-only invariant was broken historically** (`.bak-pre-imgfix`
  artefacts) → verified against a pinned pi version and guarded at runtime; a
  detected prefix rewrite quarantines the session rather than publishing a
  rewrite.
- **Large surface** → phased so a manual export → import → resume slice stands
  alone.

## Migration Plan

No existing data changes shape; the archive is additive and the local session
store is never rewritten. Enablement is per project.

1. Generate the X25519 archive keypair; configure `projectKey`, blob-store
   endpoint and credentials, and recipient public keys.
2. Choose backfill scope (full vs. horizon); estimate and warn.
3. Seal, scrub, scan, encrypt, and upload existing sessions; publish the index.
4. Enable the daemon.

**Rollback:** disable the daemon and delete the index repo plus bucket prefix.
Local sessions are untouched at every step. Already-materialised imports remain
valid local sessions; their provenance becomes a historical record.

## Open Questions

1. Seal-policy defaults need measurement against real session write patterns.
2. ~~Attachments side-store~~ **Resolved.** The writer is
   `packages/extension/src/ask-user-attachments.ts`; the directory holds
   `ask_user` pasted images and is deleted at session end. Those files sit under
   `~/.pi/dashboard/`, so their paths tokenise as `{{HOME:remote}}` and never
   expand, and the bytes no longer exist even on the origin machine. They need no
   transport. The residual is cosmetic and pre-existing: a transcript can
   reference an image file that is already gone, on any machine.
3. How a fork re-identifies a *running* session: the tie-break picks a branch,
   but signalling a live pi process to adopt a new session id is unspecified.
   The divergence namespace makes the one-sided partition symmetric, so this is
   now purely about in-flight re-identification, not about detection.
4. Whether a session may be re-imported after the target has already resumed and
   diverged locally; "import is idempotent" covers only the duplicate-file case.
5. Segment boundaries are line-safe but not **branch**-safe: transcripts are
   parentId trees, and leaf detection after a mid-branch seal is untested.
6. Goals have no contract in any spec despite being in scope; their sync, fork,
   and drop semantics are deferred entirely to a spike.
