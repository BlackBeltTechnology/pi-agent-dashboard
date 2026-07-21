---
name: faq-mine
description: >-
  Mine docs/faq.md from README.md, docs/*.md, AND the pi-hermes memory stores
  (project MEMORY.md + global failures.md). Dispatches @fast subagents per source
  to extract recurring how-to / what-is questions and runtime-problem fixes,
  dedupes against existing FAQ, and merges entries in caveman style. Use when the
  user asks to "build / regenerate / extend the FAQ", "mine docs into FAQ", "mine
  hermes memory into FAQ", "surface runtime problems in the FAQ", "create FAQ from
  README + docs", or "process knowledge into faq.md".
license: MIT
compatibility: Requires @fast subagents (general-purpose) + write access to docs/ + read access to ~/.pi/agent hermes stores.
metadata:
  author: robson
  version: "2.0"
---

Orchestrate FAQ extraction from project knowledge docs AND pi-hermes memory
stores into `docs/faq.md`.

Two source classes:
- **Docs** — README.md + evergreen `docs/*.md`. How-to / what-is questions.
- **Hermes memory** — accumulated runtime problems (tool-quirks, failures,
  insights, corrections) that never reach the docs. These carry the "why does X
  fail / how do I fix Y" answers a future agent keeps re-discovering.

**Inputs**:
- Optional `--docs <a.md>,<b.md>` — explicit doc list. Default = README.md + every evergreen `docs/*.md`. `--docs skip` = memory-only run (disables doc mining; the ship-change harvest path).
- Optional `--memory <off|project|failures|all>` — hermes stores to mine. Default `failures` = project store + global `failures.md` (relevance-filtered). `off` = docs only. `all` = also global `MEMORY.md`.
- Optional `--max <N>` — entry cap per source (default ~10).

Non-interactive: passing BOTH `--docs` (incl. `--docs skip`) and `--memory` skips the Phase 1 prompt — the headless invocation `faq-mine --docs skip --memory failures` runs memory-only with no `ask_user`.

---

## Phase 0 — Pre-flight

1. Read `docs/faq.md` if it exists. Extract every `## <Question>` heading into a dedupe list.
   - If file missing, create with header:
     ```
     # FAQ

     FAQ. How-to answers that already live in README.md + docs/. New entries here when same question recurs.
     ```
2. Enumerate candidate source docs (SKIP this whole step when `--docs skip` — memory-only run):
   ```bash
   ls README.md docs/*.md 2>/dev/null
   ```
   Exclude:
   - `docs/faq.md` itself
   - `docs/faq.agent.md` (condensed index derived FROM faq.md — refreshed in Phase 4, never mined)
   - `docs/AGENTS.md` and any `AGENTS.md` (index, not narrative)
   - `docs/session-knowledge-*.md` (point-in-time notes)
   - `docs/spec-gap-analysis.md` and any `*-resolved.md` (transient analyses)
   - Anything matching `docs/.faq-draft-*.md` (in-flight draft)
3. For each remaining doc, capture `wc -l` to surface size.
4. Enumerate hermes memory stores (unless `--memory off`):
   ```bash
   PROJ=$(basename "$(git rev-parse --show-toplevel)")
   ls -l "$HOME/.pi/agent/projects-memory/$PROJ/MEMORY.md" \
         "$HOME/.pi/agent/pi-hermes-memory/failures.md" \
         "$HOME/.pi/agent/pi-hermes-memory/MEMORY.md" 2>/dev/null
   ```
   - Project store `projects-memory/$PROJ/MEMORY.md` — all entries repo-scoped, **no filter**. If `$PROJ` dir absent (e.g. worktree name differs), `ls ~/.pi/agent/projects-memory/` and pick the matching dir; skip if none.
   - Global `pi-hermes-memory/failures.md` — **mixed across projects**, needs a repo-relevance filter (subagent applies it).
   - Global `pi-hermes-memory/MEMORY.md` — mixed, only when `--memory all`.
   - Any store path that does not exist: skip silently (fresh machine).

## Phase 1 — Confirm scope

Use `ask_user` (`multiselect`) to let the user pick which sources to mine — list the docs AND the resolved hermes stores as options. Pre-select the evergreen docs + the project store + `failures.md`. Skip the prompt only when the user already passed both `--docs` and `--memory`.

## Phase 2 — Parallel extraction (@fast subagents)

Dispatch ONE `general-purpose` subagent with `model: @fast`, `run_in_background: true` per selected source (docs AND stores). All agents run in parallel — each writes to its OWN draft file to avoid write conflicts:
- Docs → `docs/.faq-draft-<basename>.md`
- Stores → `docs/.faq-draft-mem-<label>.md` (`label` = `project` | `failures` | `memory`)

### Phase 2A — Doc mining

**Subagent prompt template** (substitute `<DOC>` with the source doc path):

> Mine FAQ-worthy entries from `<DOC>` and write them to a NEW file `docs/.faq-draft-<basename>.md`. Do NOT touch any other file.
>
> STEP 1 — read existing `docs/faq.md`. Extract every `## <Question>` heading. DEDUPE: skip questions already covered (or trivially equivalent).
>
> STEP 2 — read `<DOC>` fully. Identify recurring how-to / what-is questions a user or future agent would actually ask. Aim for 4–10 entries. Quality > quantity. Skip implementation trivia.
>
> STEP 3 — write the draft using the EXACT format of existing faq.md entries:
>
> ```
> ## <Question>?
>
> <one-line terse answer>
>
> Command: `<cmd>` (when applicable; omit for what-is questions).
>
> <optional bullets / sub-sections with concrete tokens>
>
> Cross-refs:
> - <DOC>:<line>
> - <other source file:line>
> ```
>
> CAVEMAN STYLE (verbatim, all docs/ prose obeys):
> - Short declarative fragments. Drop articles (a/an/the) and most copulas (is/are/was) when meaning survives.
> - Subject → verb → object, present tense. No hedging, no marketing voice, no "we", no "you".
> - One fact per line/row. No restating context the file already establishes.
> - Prefer concrete tokens (paths, function names, env vars, ports, exit codes) over prose.
> - Keep symbols/identifiers verbatim; only connective tissue compresses.
>
> Verify every command + path against the source doc. No invented flags, no speculation. Confirm completion in your final reply with the entry count.

### Phase 2B — Hermes memory mining

Runtime problems live in the hermes stores as `§`-separated terse entries, each stamped `<!-- created=…, last=… -->`. Convert each FAQ-worthy problem into a symptom-first Q&A entry. One subagent per store.

**Subagent prompt template** (substitute `<STORE>` = absolute store path, `<LABEL>` = `project`|`failures`|`memory`, `<FILTER>` = the relevance rule below):

> Mine FAQ-worthy runtime problems from the pi-hermes memory store `<STORE>` and write them to a NEW file `docs/.faq-draft-mem-<LABEL>.md`. Do NOT touch any other file.
>
> STEP 1 — read existing `docs/faq.md`. Extract every `## <Question>` heading. DEDUPE: skip any problem already covered (or trivially equivalent — e.g. RPC-keeper, ctx-stats, session-stuck entries already exist).
>
> STEP 2 — read `<STORE>` fully. Entries are separated by lines containing only `§`. Each entry may be prefixed `[failure]`/`[correction]`/`[insight]`/`[convention]`/`[tool-quirk]` and ends with an HTML `<!-- created=… -->` comment. IGNORE the comment metadata.
>
> <FILTER>
>
> STEP 3 — for each KEPT entry, write a symptom-first FAQ entry in the EXACT faq.md format:
>
> ```
> ## Why does <symptom>? (or: How do I fix <symptom>?)
>
> <one-line root cause — terse>
>
> Fix: `<cmd>` (or the concrete file/edit; omit when not a command).
>
> <optional bullets: concrete tokens — paths, env vars, flags, exit codes>
>
> Cross-refs:
> - <STORE>
> - <every file path / package named inside the entry>
> ```
>
> - Question = the OBSERVABLE symptom a user/agent would search (the error string, the wrong behaviour), NOT the internal cause. A reader who hits the problem must recognise their symptom in the heading.
> - Keep the wrong-way → right-way fix intact; that is the whole value of the entry.
> - Merge near-duplicate store entries (same problem, consolidated across dates) into ONE FAQ entry.
>
> CAVEMAN STYLE (verbatim, all docs/ prose obeys):
> - Short declarative fragments. Drop articles (a/an/the) and most copulas (is/are/was) when meaning survives.
> - Subject → verb → object, present tense. No hedging, no marketing voice, no "we", no "you".
> - One fact per line. No restating context the file already establishes.
> - Prefer concrete tokens (paths, function names, env vars, ports, exit codes) over prose.
> - Keep symbols/identifiers verbatim; only connective tissue compresses.
>
> Verify every command + path against the source entry. No invented flags, no speculation — if an entry lacks a concrete fix, skip it. Confirm completion in your final reply with the kept/skipped counts.

**`<FILTER>` value by store:**
- Project store (`<LABEL>=project`): `STEP 2b — no filter. Every entry is scoped to this repo; consider all of them.`
- Global `failures.md` / `MEMORY.md` (`<LABEL>=failures`|`memory`): `STEP 2b — RELEVANCE FILTER. This store mixes many projects. KEEP only entries about THIS project specifically, its paths (packages/, docs/, openspec/, src/), or a dev-in-this-repo tooling quirk (test runner, linter, build tool, git worktree, etc.). DROP everything else (unrelated product decks, OAuth-license research, Drive/rclone uploads, other repos). When unsure, DROP.`

Wait for all agents (2A + 2B) to finish.

## Phase 3 — Cross-draft dedupe

1. Run:
   ```bash
   grep -n '^## ' docs/.faq-draft-*.md
   ```
2. Cluster near-duplicate questions across drafts (same topic, different phrasing). Keep the entry with more concrete tokens / detail; remove the weaker one with a targeted `Edit`.
   - **Cross-store dup**: the same runtime problem can appear in BOTH the project store and `failures.md`. Keep the one carrying the concrete fix; drop the other.
   - **Doc-vs-memory dup**: when a memory draft restates a problem a doc draft already covers, keep whichever has the actionable fix + cross-refs.
3. Detect false-positive headings inside fenced code blocks and ignore (e.g. `## [Unreleased]` example inside ```` ```markdown ```` blocks is content, not a heading).

## Phase 4 — Merge & cleanup

```bash
cat docs/.faq-draft-*.md >> docs/faq.md && rm docs/.faq-draft-*.md
grep -c '^## ' docs/faq.md
wc -l docs/faq.md
```

Then refresh the condensed index `docs/faq.agent.md` so new entries appear in the pull-only map. Delegate to ONE `general-purpose` subagent (docs/ write → subagent per Rule 6):

> Append condensed one-liners for these NEW faq.md entries to `docs/faq.agent.md`. For each, add a line `- <short question stem> — <key answer / fix in ≤12 words>` under a `## Runtime problems & quirks` section (create the section if absent, at the end). Keep the existing sections untouched. Caveman style. New questions + answers: <paste the merged headings + one-line answers>.

Report to user:
- Total entries before / after (faq.md).
- Entries added per source (table: doc/store → count).
- For memory stores: kept vs skipped-by-relevance-filter counts.
- Any duplicates dropped during Phase 3 (cross-store + doc-vs-memory).
- faq.agent.md lines appended.
- One-line note on false-positive `## ` headings inside code fences (if any).

---

## Rules — Documentation Update Protocol compliance

This skill writes under `docs/` (faq.md + faq.agent.md). Per AGENTS.md:
- All `docs/` writes go through subagents (general-purpose). Main orchestrator only `cat`/`rm`/`Edit`s for merge + targeted dedupe.
- Caveman style is mandatory and passed verbatim to every subagent prompt.
- Every command/path/flag in a generated entry must be verified against the source doc / store entry; no speculation.
- Hermes stores are READ-ONLY inputs — never edit `~/.pi/agent/**`. Extraction copies knowledge into faq.md; it does not move or prune the memory.
- Do NOT rename or delete existing faq.md `## ` headings — `packages/shared/src/tool-registry/__tests__/install-hints.test.ts` asserts each tool `docsAnchor` maps to a heading. Append only.

## Anti-patterns (do not)

- Do NOT have multiple subagents write to the same file in parallel — race condition.
- Do NOT mine `AGENTS.md` (incl. `docs/AGENTS.md`) or `docs/faq.agent.md` — indexes, not narrative knowledge.
- Do NOT mine `session-knowledge-*.md` or `spec-gap-analysis.md` — point-in-time notes; entries would rot fast.
- Do NOT skip the global-store relevance filter — `failures.md`/`MEMORY.md` mix projects; unfiltered mining leaks other repos' quirks into this FAQ.
- Do NOT phrase a runtime-problem heading by its internal cause — use the observable symptom (error string / wrong behaviour) so a reader recognises it.
- Do NOT skip Phase 0 dedupe — re-running the skill must not double-add the same questions.
- Do NOT drop the per-entry `Cross-refs:` block — agents lose the source trail otherwise (memory entries cross-ref the store path).
