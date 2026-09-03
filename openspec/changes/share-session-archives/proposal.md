# Share pi session transcripts across machines (portable, encrypted, resumable archives)

## Why

A pi session's JSONL transcript is the highest-fidelity record of *how a proposal
was actually developed* — every prompt, every steer, every dead end. Today that
record is trapped on one machine, and its on-disk layout makes it structurally
non-portable:

```mermaid
flowchart LR
  subgraph disk["~/.pi/agent/sessions/"]
    slug["--Users-robson-Project-pi-agent-dashboard--/<br/><em>the directory name IS the absolute path</em>"]
    jsonl["&lt;ts&gt;_&lt;uuid&gt;.jsonl<br/>append-only, parentId tree"]
    meta["&lt;ts&gt;_&lt;uuid&gt;.meta.json<br/>full-rewrite, 1s debounce"]
    slug --> jsonl
    slug --> meta
  end
```

Measured on this repo (one project):

| Fact | Value |
|---|---|
| Files in the slug dir | 4 224 |
| Size | 851 MB (1.5 GB across all projects) |
| `meta.json.cwd` | absolute, machine-specific |
| Absolute paths inside one large `.jsonl` | project cwd ×47, `~/.agent-browser/tmp` ×131, `~/.nvm` ×4 |
| gzip on a text-only session | ~2:1 |
| gzip on an image-heavy session | 29 MB → 22 MB (base64 is already high-entropy) |

Three separate surfaces encode the source machine's filesystem: the **slug
directory name**, **`meta.json.cwd`**, and **path strings inside the transcript
body** (tool arguments, tool results, diffs, stack traces). Any sharing mechanism
must neutralise all three, and must reverse the mapping on import so the session
can be **resumed** against the target machine's copy of the project.

Two structural properties of the on-disk format make this tractable, and they
drive the entire design:

- **`.jsonl` is append-only.** Forks write a *new* file via
  `createBranchedSessionFile`; compaction (`replay-compaction.ts`) is a
  replay-only pass that never rewrites the store. So a live/incomplete session is
  always a strict **prefix** of its later self — merge is decidable, not
  heuristic.
- **`.meta.json` is a small full-rewrite blob** with no ordering guarantee — a
  different merge rule entirely (field-level, not prefix).

## What Changes

Introduce a **portable session archive**: a per-project, content-addressed,
client-side-encrypted store of sealed transcript segments, synchronised in both
directions by a background daemon, with imported sessions resumable in place.

```mermaid
flowchart TB
  subgraph A["Machine A"]
    SA["~/.pi/agent/sessions/&lt;slugA&gt;/"]
  end
  subgraph IDX["Index repo — plain git, no LFS, stays small. All objects encrypted."]
    M["manifest — uuid → segment identities"]
    ME["meta"]
    OR["origin — provenance"]
    G["goals"]
    CL["claims — lease, opaque machine id"]
  end
  subgraph S3["Blob store — generic S3 API"]
    B["blobs/&lt;opaque-key&gt;<br/>zstd + age-encrypted segments"]
  end
  subgraph B2["Machine B"]
    SB["~/.pi/agent/sessions/&lt;slugB&gt;/"]
  end
  SA -->|"scrub → canonical → seal · scan · compress · encrypt"| B
  SA --> IDX
  IDX -->|"list sessions offline (no materialisation)"| SB
  B -->|"lazy fetch on open/resume"| SB
```

### A canonical form, then segmented immutable transcripts

The **canonical form is the scrubbed transcript**; the expanded on-disk file is a
rendering of it. Sealing, digesting, and publishing operate only on canonical
bytes, so a session imported onto a differently-rooted machine continues the same
segment sequence instead of diverging at segment zero.

A live transcript is sealed into immutable segments on a
`bytes ∥ lines ∥ idle-seconds` policy. Each sealed segment is scanned,
compressed, encrypted, and uploaded once — never rewritten. **Segment identity is
the digest of canonical plaintext**, while the blob key is opaque: encryption is
non-deterministic, so digesting stored bytes would make identical content look
divergent, and keying blobs by content digest would leak content equality to the
store.

This single decision resolves four problems at once:

| Problem | Resolution |
|---|---|
| Re-uploading a growing file costs O(N²) | each append seals a *new small* blob → O(N) |
| An imported session re-sealing from local bytes | canonical form makes the sequence machine-independent |
| Incomplete / working sessions | not a special case — a live session is "sealed segments + a tail the archive does not have". Remote view = *up to last checkpoint*; lag = seal interval |
| Two-way merge | segments are immutable and content-addressed → sync is a **set union**, not a merge |
| Divergence detection | two different `seg-0003` for one uuid is a **provable** fork, no heuristics |
| Where to scan for secrets | seal is a natural once-per-blob boundary |

### Path scrubbing and rehydration

Placeholders are substituted **longest-prefix-first**, with only two tokens:

| Source | Token | On import |
|---|---|---|
| inside the project root | `{{CWD}}` | target project root (+ root-relative offset for worktrees/subdirs) |
| any other home-relative path | `{{HOME:remote}}` | **never expanded** |

A third token for home-relative paths inside the project ancestry was considered
and removed: it has no safe expansion, since `{{HOME}}/Project/x` becomes
`/home/bob/Project/x` on a machine whose projects live in `~/dev` — a
plausible-but-nonexistent path, the exact hazard the foreign token prevents.
Matching is **component-bounded** so a sibling directory sharing a string prefix
(`dashboard-other` against root `dashboard`) is never mis-tokenised, and paths
under neither the project root nor home (`/tmp`, `/private/var/folders/…`) pass
through verbatim — portable in the contract sense, but not resolvable on the
target, which is why a session whose own cwd sits there is reported
non-resumable rather than imported broken.

Substitution covers every published value (bodies, metadata, goals, provenance);
encryption is not a substitute for it. The archive addresses projects by
`projectKey` — a hash of the **canonicalised** git remote URL (scheme, userinfo,
`.git` and trailing slash stripped, host lowercased, and the SCP-style
`host:path` separator rewritten to `host/path`, without which the ssh and https
forms differ by a colon and split one project into two archives) — else a
user-assigned name, never the path slug.

**Username erasure is explicitly out of scope.** Transcripts carry usernames in
`ls -la` output, git author lines, and `git@host:user/repo` remotes; erasing an
identity from free text is a different problem, and under the trusted-teammate
threat model the username is not a secret.

### Secret gate — asynchronous, so the daemon stays hands-off

Automatic push and human review are only compatible if the review gate is
non-blocking:

```mermaid
flowchart LR
  seal["segment sealed"] --> scan{"secret scan"}
  scan -->|clean| push["encrypt → upload"]
  scan -->|flagged| q["quarantine queue<br/>(dashboard inbox)"]
  q --> redact["redact"] --> push
  q --> approve["approve as-is"] --> push
  q --> drop["drop segment"]
```

Detection is **known-format patterns only** (`sk-`, `ghp_`, `AKIA`, JWT, PEM
blocks, `scheme://user:pass@host`). Entropy heuristics are deliberately excluded:
this repo holds 29 MB image-heavy sessions whose base64 would trip them
constantly, and a queue that flags everything trains reflexive approval — the
failure mode that would defeat the control entirely.

**Push is irreversible-by-default, so the gate runs before first upload.** A
segment is never re-uploaded after correction; a missed secret is handled by
`DeleteObject` + credential rotation.

### Transport: index in git, blobs in S3

Git LFS was evaluated and rejected on a security argument, not a cost one: LFS
history is effectively permanent, so a missed secret cannot be *withdrawn* —
recovery means `filter-repo`, force-push, every clone re-fetched, and LFS store
surgery. The quarantine queue is a preventive control; without deletion there is
no corrective control at all. GitHub's 1 GiB free LFS quota against an 851 MB
first push is a secondary problem.

The split keeps what git is genuinely good at:

| Layer | Carries | Why there |
|---|---|---|
| **Index repo** (plain git) | manifest, meta, origin, goals, claims — **all encrypted** | tiny; versioned; `git push` on a ref is a **compare-and-swap**, giving atomic claims with no lock server |
| **Blob store** (generic S3 API) | sealed segments under opaque keys | real `DELETE`, lifecycle rules, presigned GET, per-prefix IAM, no quota cliff |

The permanence argument that rejected LFS applies to the index as well, so every
index object is encrypted and claims carry an opaque machine id rather than a
hostname. Content and claims live in **separate ref namespaces**: history
compaction is a non-fast-forward rewrite and the lease depends on renewal being
strictly fast-forward, so only the content namespace is ever squashed.

Git is demoted from *merge engine* to *atomic transport for small objects* —
`meta.json` is merged field-wise by us after decryption, in a
fetch → decrypt → merge → re-encrypt → re-push optimistic-concurrency retry.

### Client-side encryption

Every published object is encrypted **before** upload with age-style
multi-recipient encryption keyed to per-machine **X25519 archive keypairs
generated for this feature**. The existing `~/.pi/dashboard/identity.key` is
deliberately *not* reused: it is Ed25519, serves TOFU pairing and bearer auth,
and conflating authentication with confidentiality would make the recipient set
derivable from pairing state. No shared secret to distribute; adding a teammate
appends a recipient, removing one drops it from future segments — and past
segments can genuinely be re-encrypted and the originals deleted, which is only
possible because the transport is not LFS.

`meta` is encrypted too: `firstMessage` is the session title and is verbatim
conversation prose. Encrypting bodies while leaving titles in the clear would be
a half-measure.

**Cross-session dedup is explicitly a non-goal**, and that is what permits
random-nonce AEAD. Dedup would require convergent encryption, under which a
bucket holder can prove two sessions share content and can confirm any guessed
plaintext.

### Claims, resume, provenance

- **Claims gate publication, not merely resume.** A session is owned by one
  machine; only the owner publishes segments for it, and the origin writes an
  *explicit* claim at session creation. Gating only *resume* would leave the
  origin publishing unclaimed, so any concurrent resume would fork every time.
  Claims live on per-session refs; a losing racer gets a non-fast-forward
  rejection — a real mutex. Renewal is fast-forward-only (a force-push would
  destroy the CAS property) and publishes a next-renewal deadline; a holder
  releases voluntarily when its session ends.
  **Stated plainly: this makes concurrent resume impossible, not merely safe.**
  While the origin holds a live claim, another machine's resume is refused. The
  supported flow is *handover* — voluntary release, or expiry once the origin
  goes idle — not two machines working one session at once. Divergence that
  happens anyway (partition) is resolved by a deterministic tie-break in which a
  redaction marker outranks an unredacted segment, so resolution can never
  promote secret-bearing content over its redacted version.
- **Resume preflight never substitutes silently**, and evaluates capacity against
  the **archived** `contextWindow` — never a locally inferred one, since
  `inferContextWindow` pins Claude models to 200k and would reject a real
  on-disk session recording `contextTokens: 269644 / contextWindow: 1000000`.
- **Provenance** is an `origin.json` sidecar (ours to write, and it travels with
  the session — unlike dashboard-local state, and unlike `meta.json` whose
  debounced writer we would be fighting). The session card renders an
  *imported-from-`<machine>`* badge.
- **Backfill** is configurable per project (full vs. horizon), with a warning
  when the estimate exceeds the remote's quota.

## Scope

**In scope:** the canonical form and its round-trip invariant; archive format and
segment sealing; path scrubbing + rehydration; known-format secret scanning and
the quarantine queue; the index-repo/blob-store transport with client-side
encryption; bidirectional daemon sync; claim/lease protocol gating publication;
resume of imported sessions with model preflight; provenance record and card
badge; goals travelling with sessions.

**Out of scope:** cross-session dedup; entropy-based secret detection; username
erasure; syncing the global `preferences.json` slice (`sessionOrder`, pinned
directories, workspace membership) — provenance is the only dashboard state that
travels; public or untrusted-audience sharing; `identity.key`,
`paired-devices.json`, `headless-pids.json`, `editor-pids.json`, which must never
leave the machine.

**Distinct from `add-cloud-sync-connector`**, which syncs user *documents* to
Drive/Dropbox/OneDrive. This change syncs *session transcripts* to a
content-addressed archive with a different unit, threat model, and merge
semantics. They share no engine.

## Open questions

1. Seal policy defaults (`bytes ∥ lines ∥ idle`) trade remote freshness against
   blob count and have no obviously correct value — needs measurement against
   real write patterns.
2. How imported sessions reference attachments and goals is untraced; a
   rehydrated session must not render broken attachments.
3. Pattern-only scanning accepts known false negatives by design. The residual
   risk is carried by encryption + the ability to delete, not by detection.
4. The surface is large (daemon, bucket, index repo, keyring). A manual
   export → import → resume path exercises the riskiest unknowns — does scrubbing
   round-trip, does a rehydrated session actually resume — at a fraction of the
   machinery, and tasks should be phased so that slice stands alone.

## Discipline Skills

- `security-hardening` — the core of this change: transcripts carry secrets,
  private source, and credentials; scrubbing, the secret gate, multi-recipient
  encryption, key rotation/revocation, and bucket credential handling.
- `doubt-driven-review` — upload is irreversible in practice; the scrub, scan,
  and encryption decisions must be stress-tested *before* the first push stands.
- `performance-optimization` — 4 224 files / 851 MB per project; seal policy,
  lazy fetch, and the daemon's watcher debounce are all measured budgets.
- `observability-instrumentation` — a background daemon making external calls
  needs evidence it is working: sync lag, quarantine depth, claim contention,
  upload failures.
- `systematic-debugging` — divergence, claim expiry, and partial-upload recovery
  paths.
