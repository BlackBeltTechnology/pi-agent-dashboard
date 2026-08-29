# Gate-trim classification — phase 7.3 (task 7.3)

Every line of the root `AGENTS.md` per-turn kb doctrine (the `Docs-First Gate`
section + the `Investigation Protocol` section that restates it), classified
ROUTING (which call / which lane / which corpus — never a trim candidate) vs
PRESSURE (do-this-first framing — the guard delivers it at violation time).

| Line / element | Class | Rationale |
|---|---|---|
| "`kb_*` tools return a one-line purpose + key exports per file instead of raw bytes" | PRESSURE | motivation framing for the gate; the tools' own descriptions carry the same fact |
| "This gate fires on the ACTION, not the intent" | PRESSURE | do-this-first framing |
| "It fires even mid-task when you already know the file" | PRESSURE | framing, repeated twice |
| Gate table, row: symbol lookup → `kb_search --doc-type agents` | **ROUTING** | which call + which lane |
| Gate table, row: feature topic → `kb_search "feature topic"` | **ROUTING** | which call |
| Gate table, row: file purpose → `kb agents <path>` | **ROUTING** | which call |
| Gate table, row: imports/callers → `rg` (graph cannot resolve code refs) | **ROUTING** | corpus/capability boundary |
| Gate table, row: doc section → `kb_get <path> <section>` | **ROUTING** | which call |
| Gate table, row: trust verdicts (`STALE`/`GONE`/`UNVERIFIED` → verify; `MOVED` → verify at successor path; `FRESH` → act) | **ROUTING** | what a label means for the next action (added by this change) |
| Gate table, row: build/run/install → grep faq/README/docs | **ROUTING** | which corpus |
| Gate table, row: derive from large output → ctx_execute/Read offset | **ROUTING** | which tool for which shape |
| "kb_search indexes repo markdown … NOT tests/ qa/ scripts/ docker/. ctx_search/memory_search … different corpus" | **ROUTING** | corpus boundaries |
| "Pick the lane" paragraph (doc_type P@1 0.041→0.227 / prose 0.150→0.067) | **ROUTING** | retrieval-lane selection rule + the measured reason it must survive |
| "Fall-through: if the kb call returns nothing relevant, rg/source read is allowed — then add the missing directory-AGENTS.md row" | **ROUTING** | fall-through rule |
| `Investigation Protocol` section (index-first workflow narrative) | PRESSURE | restates the gate as prose; its routing bits duplicate the table + fall-through — fold, don't keep twice |
| "kb does NOT replace grep; it goes first" | PRESSURE | framing; the fall-through row already carries the rule |

**Trim candidate = PRESSURE lines + the Investigation Protocol fold (~694 of
~3,478 injected tokens; ~820 with the protocol).** ROUTING rows survive any
trim by spec.

## Status: NOT LANDED (see guard-coverage.md)

7.6 is doubly gated and both gates currently fail:
1. **7.1**: in-memory subagent sessions run with no extensions → the guard
   cannot observe them → their prose must stay.
2. **7.5/M1** (manual-only, post-merge): A/B non-inferiority not yet measured.

The treatment is built in `gate-trim-treatment.md` for when both gates clear.

## Task 7.6 resolution — NULL RESULT branch taken (pre-merge)

7.6's own text defines the inconclusive branch as executable: "If inferior or
inconclusive: land nothing and record why — a null result here is a valid
outcome." Recorded: the trim LANDS NOTHING because (1) per 7.1
(`guard-coverage.md`) in-memory subagent sessions run no extensions, so the
guard cannot observe them and their prose must stay; (2) M2/M1 (firing rate,
A/B non-inferiority) are post-merge manual rows with no data yet. The built
treatment (`gate-trim-treatment.md`) is parked for when both gates clear.
