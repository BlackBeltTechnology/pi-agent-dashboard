---
name: faq-mine
description: >-
  Mine docs/faq.md from README.md and docs/*.md. Dispatches haiku subagents per
  source doc to extract recurring how-to / what-is questions, dedupes against
  existing FAQ, and merges entries in caveman style. Use when the user asks to
  "build / regenerate / extend the FAQ", "mine docs into FAQ", "create FAQ from
  README + docs", or "process knowledge into faq.md".
license: MIT
compatibility: Requires haiku subagents (general-purpose) + write access to docs/.
metadata:
  author: robson
  version: "1.0"
---

Orchestrate FAQ extraction from project knowledge docs into `docs/faq.md`.

**Inputs**:
- Optional `--docs <a.md>,<b.md>` — explicit doc list. Default = README.md + every evergreen `docs/*.md`.
- Optional `--max <N>` — entry cap per doc (default ~10).

---

## Phase 0 — Pre-flight

1. Read `docs/faq.md` if it exists. Extract every `## <Question>` heading into a dedupe list.
   - If file missing, create with header:
     ```
     # FAQ

     FAQ. How-to answers that already live in README.md + docs/. New entries here when same question recurs.
     ```
2. Enumerate candidate source docs:
   ```bash
   ls README.md docs/*.md 2>/dev/null
   ```
   Exclude:
   - `docs/faq.md` itself
   - `docs/AGENTS.md` and any `AGENTS.md` (index, not narrative)
   - `docs/session-knowledge-*.md` (point-in-time notes)
   - `docs/spec-gap-analysis.md` and any `*-resolved.md` (transient analyses)
   - Anything matching `docs/.faq-draft-*.md` (in-flight draft)
3. For each remaining doc, capture `wc -l` to surface size.

## Phase 1 — Confirm scope

Use `ask_user` (`multiselect`) to let the user pick which docs to mine. Pre-select the evergreen set. Skip the prompt only when the user already passed `--docs`.

## Phase 2 — Parallel extraction (haiku subagents)

For each selected doc, dispatch ONE `general-purpose` subagent with `model: haiku`, `run_in_background: true`. All N agents run in parallel — each writes to its OWN draft file `docs/.faq-draft-<basename>.md` to avoid write conflicts.

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

Wait for all agents to finish.

## Phase 3 — Cross-draft dedupe

1. Run:
   ```bash
   grep -n '^## ' docs/.faq-draft-*.md
   ```
2. Cluster near-duplicate questions across drafts (same topic, different phrasing). Keep the entry with more concrete tokens / detail; remove the weaker one with a targeted `Edit`.
3. Detect false-positive headings inside fenced code blocks and ignore (e.g. `## [Unreleased]` example inside ```` ```markdown ```` blocks is content, not a heading).

## Phase 4 — Merge & cleanup

```bash
cat docs/.faq-draft-*.md >> docs/faq.md && rm docs/.faq-draft-*.md
grep -c '^## ' docs/faq.md
wc -l docs/faq.md
```

Report to user:
- Total entries before / after.
- Entries added per source doc (table).
- Any duplicates dropped during Phase 3.
- One-line note on false-positive `## ` headings inside code fences (if any).

---

## Rules — Documentation Update Protocol compliance

This skill writes under `docs/`. Per AGENTS.md:
- All `docs/` writes go through subagents (general-purpose). Main orchestrator only `cat`/`rm`/`Edit`s for merge + targeted dedupe.
- Caveman style is mandatory and passed verbatim to every subagent prompt.
- Every command/path/flag in a generated entry must be verified against the source doc; no speculation.

## Anti-patterns (do not)

- Do NOT have multiple subagents write to the same file in parallel — race condition.
- Do NOT mine `AGENTS.md` (incl. `docs/AGENTS.md`) — index, not narrative knowledge; FAQ entries from it would just restate file paths.
- Do NOT mine `session-knowledge-*.md` or `spec-gap-analysis.md` — point-in-time notes; entries would rot fast.
- Do NOT skip Phase 0 dedupe — re-running the skill must not double-add the same questions.
- Do NOT drop the per-entry `Cross-refs:` block — agents lose the source trail otherwise.
