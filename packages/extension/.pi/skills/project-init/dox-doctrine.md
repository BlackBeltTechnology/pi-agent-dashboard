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

`kb_*` tools are faster and cheaper than raw search — they return a one-line
purpose + key exports per file, not raw bytes. **This fires on the ACTION, not
the intent** — before you `grep`/`rg` for a symbol, `cat`/read a file to learn
what it does, or chase an import, the kb call goes first. It fires **even
mid-task when you already know the file**; knowing the file does not exempt you.
When your reflex is the left column, run the right column instead:

| You're about to… | Do this FIRST instead |
|---|---|
| `grep -rn "SymbolName" src/` — find where a fn / type / const lives | `kb_search --doc-type agents "SymbolName"` — tree indexes key exports per file |
| `grep -rn "feature\|topic" src/` — how does X work / where's X handled | `kb_search "feature topic"` |
| `cat` / read a file just to learn its purpose before editing | `kb agents <path>` — one-line purpose + exports + change history |
| chase imports / callers across files | `kb_neighbors <path\|heading>` |
| read one doc section in full | `kb_get <path> <section>` |

**Fall-through (explicit):** if the kb call returns nothing relevant, `rg` /
source read is allowed — then add the missing directory `AGENTS.md` row per the
WRITE discipline. kb does NOT replace grep; it goes first.
<!-- dox:read:kb:end -->

<!-- dox:read:manual:start -->
## Finding docs (READ discipline)

The directory `AGENTS.md` tree is faster and cheaper than raw search — each row
carries a one-line purpose + key exports per file. **This fires on the ACTION,
not the intent** — before you `grep`/`rg` for a symbol, `cat`/read a file to
learn what it does, or chase an import, consult the tree first. It fires **even
mid-task when you already know the file**; knowing the file does not exempt you.
When your reflex is the left column, do the right column instead:

| You're about to… | Do this FIRST instead |
|---|---|
| `grep -rn "SymbolName" src/` — find where a fn / type / const lives | read the nearest directory `AGENTS.md`; scan rows for the symbol |
| `grep -rn "feature\|topic" src/` — how does X work / where's X handled | walk the root→nearest `AGENTS.md` chain toward the file's directory |
| `cat` a file just to learn its purpose before editing | read that file's row in its directory `AGENTS.md` (purpose + exports + change history) |
| chase imports / callers across files | follow the `See change:` / pointer references in the nearest `AGENTS.md` |
| read one doc section in full | open the specific `docs/<topic>.md` section |

**Fall-through (explicit):** if the tree misses, `rg` / source read is allowed —
then add the missing directory `AGENTS.md` row per the WRITE discipline. The tree
goes first.
<!-- dox:read:manual:end -->
