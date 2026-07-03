# DOX Doctrine

Canonical per-directory `AGENTS.md` documentation doctrine. Shipped once with
the `project-init` skill. Adapted from agent0ai/dox, extended with a kb-backed
READ discipline. Retrievable via `kb_search "dox doctrine"`.

The scaffold seeds ONE block into a project's root `AGENTS.md` when that file
lacks the `<!-- dox-doctrine -->` marker: the WRITE discipline plus one READ
variant (kb-wired or manual). The sections below are delimited so the seeder
can compose the right block.

<!-- dox:write:start -->
## Documentation Update Protocol (WRITE discipline)

Per-directory `AGENTS.md` files form a tree. Each directory `AGENTS.md` is the
per-file record for the files in that directory. The ROOT `AGENTS.md` holds
doctrine + architecture pointers only — never a per-file index.

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

For any "where is X" / "how does Y work" / "what files relate to X" question,
consult the doc tree BEFORE grepping source:

1. `kb agents <path>` — returns the root→nearest `AGENTS.md` chain for a file or
   directory (the cheapest map: one-line purpose + key exports + change history
   per file).
2. `kb_search "<terms>"` — full-text search across the indexed markdown tree.
3. Only then open source for the few files that matter.

Grepping source before checking the tree wastes tokens and risks hallucinated
answers. Fall through to `rg` / manual search only when the tree misses — then
add the missing row per the WRITE discipline.
<!-- dox:read:kb:end -->

<!-- dox:read:manual:start -->
## Finding docs (READ discipline)

For any "where is X" / "how does Y work" / "what files relate to X" question,
consult the doc tree BEFORE grepping source:

1. Read the ROOT `AGENTS.md`, then walk down the directory `AGENTS.md` chain
   toward the file's directory. Each directory `AGENTS.md` records the files in
   that directory (one-line purpose + key exports + change history per file).
2. Read the nearest directory `AGENTS.md` for the file's row.
3. Only then open source for the few files that matter.

Grepping source before checking the tree wastes tokens and risks hallucinated
answers. Fall through to manual search only when the tree misses — then add the
missing row per the WRITE discipline.
<!-- dox:read:manual:end -->
