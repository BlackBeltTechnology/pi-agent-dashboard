# DOX Doctrine

Canonical per-directory `AGENTS.md` documentation doctrine. Shipped once with
the `pi-dashboard-kb-extension` and injected into the system prompt per turn.
Adapted from agent0ai/dox, extended with a kb-backed READ discipline.
Retrievable via `kb_search "dox doctrine"`.

The READ and WRITE disciplines below are delimited so the injector can compose
the right fragment: the READ section is injected when `doctrine.inject` is `kb`;
the WRITE section is appended only when `doctrine.write` is `true`. Tune both in
`.pi/dashboard/knowledge_base.json`. The scope is per project, so the injector
resolves config from the session cwd every turn.

The MAINTAIN section at the end sits deliberately **outside** those markers: it is
reference for whoever repairs a drifted tree, not a per-turn rule, so it is never
injected into a system prompt and costs nothing per turn. Reach it on demand via
`kb_search "dox maintenance"`.

<!-- dox:write:start -->
## Documentation Update Protocol (WRITE discipline)

Per-directory `AGENTS.md` files form a tree. Each directory `AGENTS.md` is the
per-file record for the files in that directory. The ROOT `AGENTS.md` holds
doctrine + architecture pointers only — never a per-file index.

**Keep the root lean.** The root `AGENTS.md` loads into every agent turn — every
byte costs tokens on every turn. A verbose root file buries the rules the model
must follow (signal dilution) and measurably degrades adherence; a lean file
keeps doctrine salient. Default assumption: your update does NOT belong in the
root — route it by the table below.

**Route every doc update by kind:**

| Kind of update | Goes in |
|---|---|
| New file in a directory, or its per-file detail / change history | Nearest directory `AGENTS.md`. Add a `` \| `<basename>` \| <purpose> \| `` row, path-alphabetical. |
| Data flow, protocol, architecture rationale | `docs/architecture.md` or a `docs/<topic>.md` |
| End-user / developer setup | `README.md` |
| Cross-cutting rule every agent needs every turn (rare) | ROOT `AGENTS.md` |

**Read before editing (chain walk).** Before editing a file, read the nearest
`AGENTS.md` chain root→leaf so you know the file's recorded purpose, contracts,
and change history. Do not edit blind.

**Update after editing (closeout pass).** After changing a file, update its row
in the nearest directory `AGENTS.md`: find the file's row, update its purpose in
place; if absent, add it in path-alphabetical order. New directory → scaffold
its `AGENTS.md`. One row per file. The purpose carries a one-line summary, key
exported symbols, contracts/invariants, and `See change: <id>` history.

**Row style (caveman).** Short declarative fragments. Drop articles. Subject →
verb → object, present tense. One fact per row. Prefer concrete tokens (paths,
symbols, env vars) over prose. Keep identifiers verbatim.

**Size rule — split an over-large directory `AGENTS.md` file-based.** pi
auto-injects a directory `AGENTS.md` on every turn when cwd sits at/below it, so
an over-large directory `AGENTS.md` (past a byte cap — typically a flat
directory holding many files) is not supported. Split it file-based: a row
exceeding the length threshold promotes to a per-file `<File>.AGENTS.md`
sidecar carrying that file's full detail (including every `See change:`). The
sidecar is pull-only — its name is not `AGENTS.md`, so pi never auto-injects it
— yet it stays search-indexed (`agents` doc_type). The directory `AGENTS.md`
keeps a one-line summary plus a `→ see \`<File>.AGENTS.md\`` pointer. Rows within
the threshold stay verbatim (lossless).
<!-- dox:write:end -->

<!-- dox:read:kb:start -->
## Finding docs (READ discipline)

`kb_*` tools return a one-line purpose + key exports per file instead of raw
bytes. **This gate fires on the ACTION, not the intent** — before you
`grep`/`rg` a symbol, `cat`/read a file to learn its purpose, or chase an
import, the kb call goes first. It fires **even mid-task when you already know
the file**. When your reflex is the left column, run the right instead:

| You're about to… | Do this FIRST instead |
|---|---|
| `grep -rn "SymbolName" src/` — find where a fn / type / const lives | `kb_search --doc-type agents "SymbolName"` — tree indexes key exports per file |
| `grep -rn "feature\|topic" src/` — how does X work / where's X handled | `kb_search "feature topic"` |
| `cat` / read a file just to learn its purpose before editing | `kb agents <path>` — one-line purpose + exports + change history |
| chase imports / callers across files | `kb_neighbors <path\|heading>` |
| read one doc section in full | `kb_get <path> <section>` |
| a kb hit shows `STALE` / `GONE` / `MOVED` / `FRESH` (trust verdict) | verify the row against source before acting — `MOVED` verifies at its reported successor path; `FRESH` may be acted on without re-reading; see `kb_search` verdicts (trust label, never ranking) |
| derive a fact from a large file / big command output | `ctx_execute_file` / `ctx_execute` **when present** (context-mode is optional); else read with `offset`+`limit`, or `rg`/`awk` via Bash |

`kb_search` indexes repo markdown (`docs/ openspec/ packages/ .pi/`) — NOT
`tests/ qa/ scripts/ docker/`. `ctx_search`/`memory_search` index session memory,
NOT repo docs — different corpus.

**Pick the lane — the single highest-yield kb habit.** Looking for a FILE or
SYMBOL → pass `doc_type:"agents"` (measured P@1 0.048 → 0.231, MRR 0.187 → 0.327
on mined file-lookup queries; unfiltered, verbose spec prose takes rank 1 and
buries the per-file row). Asking how something WORKS, or anything conceptual →
leave `doc_type` unset; the `agents` filter measurably HURTS prose queries.

**Fall-through (explicit):** if the kb call returns nothing relevant, `rg` /
source read is allowed — then add the missing directory `AGENTS.md` row per the
WRITE discipline. kb does NOT replace grep; it goes first.
<!-- dox:read:kb:end -->

## Maintaining a drifted tree (NOT seeded — reference only)

Three failure modes account for most rot. None is caught by a naive "does the row
exist" check, and two are invisible to tooling that only hashes files.

**1. Moving a file rots OTHER rows' prose.** A lint hashes the file behind each
row; it does not validate paths written *inside* a row's purpose text. So a
directory reorg leaves cross-references pointing at paths that no longer exist,
and the tree still lints clean. Observed cost: a subagent routing rule cited two
deleted directories for weeks, so the trigger could never fire and the agent was
never spawned. **After any move, grep the whole tree for the old path.**
`kb dox lint` reports this as `broken-ref`.

**2. An orphan row is usually a RELOCATION, not garbage.** When a row's file no
longer exists, the file has typically moved rather than died. Deleting the row
throws away a written purpose; the fix is to move it to the node that now owns
the file, creating that node if absent. Never let rows bubble up to the root
`AGENTS.md` because an intermediate directory lacks its own — the root must stay
a per-file-index-free doctrine file.

**3. `stale` means bytes changed, NOT that the row is wrong.** Staleness is a
content hash against a last-acknowledged value. A row is a one-line purpose
summary, not an export manifest: it may legitimately omit everything a diff
added. Two tempting responses are both wrong — bulk re-acknowledging launders
real drift, and a "does the row still name symbols present in the file"
heuristic produces false positives (it will flag a row that correctly documents
a symbol as *removed*). Judge each row against the actual diff since its
acknowledged state: `kb dox triage` recovers that diff by finding the commit
whose blob matches the acked hash, and can hand it to a cheap model.

**Corollary — before trusting any cleanup pass:** a scan tuned only for recall
drowns in false positives. Ranking one repo's candidate path references produced
548 raw hits for roughly 4 real defects; the discriminator that mattered was
requiring the first path segment to be a real top-level entry of *this* repo,
which rejects URL routes, MIME types, npm specifiers and descriptions of other
projects' layouts.
