# Add authoring skills — port general-purpose `~/Documents` skills into the monorepo

## Why

The user maintains a personal skill library under `~/Documents` (mirrored across
`.claude`/`.gemini`/`.opencode`/`.agents`/`.pi`). A scan found three families:

1. **Already shipped here** — the `openspec-*` pipeline and the document-conversion
   stack. No action.
2. **Personal / infra-bound** — `document-organizer`, `downloads-scanner`,
   `docling-graph` (Neo4j), `pdf-to-markdown-tax-docs` (Hungarian NAV),
   `project-mail`, `wise-*`, etc. Not portable.
3. **General-purpose, project-independent, missing here** — the subject of this change.

A key discovery during the scan: the doc-pipeline skills `markdown-table-profiler`
and `frontmatter-filler` are **already folded into** `packages/document-converter`
(`engine/markdown_table_profiler/profile.py`, `engine/frontmatter_filler/fill.py`,
`engine_cli.py` subcommands `profileTables`/`fillFrontmatter`, TS facade
`dc.profileTables()`/`dc.fillFrontmatter()`, documented in its SKILL). The
`~/Documents` copies are the upstream source — porting them would duplicate
shipped code, so they are **out of scope**.

That leaves three genuinely portable, general-purpose skills with no home here:

- **`skill-creator`** — guide for authoring/updating skills. Complements the
  existing `dashboard-plugin-scaffold` (which scaffolds *dashboard plugins*, not
  generic skills). Single self-contained `SKILL.md`, no personal coupling.
- **`session-to-guideline`** — turns a pi session JSONL transcript into a
  "how-we-did-it" Markdown guideline. Reads the *pi-standard* session path
  (`~/.pi/agent/sessions/...`) — not a personal path. The dashboard generates
  this JSONL constantly and already has an `os-distill-session-knowledge`
  effort, so this is the highest-leverage port.
- **`doc-summarizer`** — chunked + subagent summarization of large documents.
  Overlaps `document-converter`'s extraction stack, so it belongs *with* it,
  reusing the existing engine rather than its own bundled extractors.

`system-architect` was evaluated and **rejected**: it is a pasted blog-post
"master prompt" (37 lines, no procedure, ends "Would you like me to refine…"),
and `eng-disciplines` already covers architecture/design.

## What Changes

- **New package `packages/authoring-toolkit`** — pure-skill package (manifest
  only, no `extension.ts`), mirroring how `eng-disciplines` / `anti-slop`
  register skills via `package.json` `pi.skills[]` + `files[".pi/skills/"]`.
  Ships two skills:
  - `.pi/skills/skill-creator/SKILL.md` — copied, `license:` tidied; Anthropic-MIT
    attribution in a `NOTICE` (same pattern `eng-disciplines` uses for Addy Osmani).
  - `.pi/skills/session-to-guideline/` — copied with `scripts/` + `references/`;
    the script invocations adapted from `bun scripts/…` to `npx tsx scripts/…`
    (repo convention). Reads the pi-standard session JSONL path unchanged.
  - `package.json` (`@blackbelt-technology/pi-dashboard-authoring-toolkit`),
    `README.md`, `NOTICE`.

- **New skill `packages/document-converter/.pi/skills/doc-summarizer/SKILL.md`**
  — folded into `document-converter` (its natural home; shares the extraction
  stack). **Option A (orchestrate-only):** the SKILL drives chunking + subagent
  summarization and calls the *existing* Docker-quarantined engine for
  extraction; the upstream skill's own host-side `extract_text.py` /
  `pdf_to_markdown.py` are **NOT** copied, preserving the package invariant
  "engine quarantined in Docker, TS is the only call surface". Registered by
  adding `.pi/skills/doc-summarizer` to that package's `pi.skills[]`.

- **Docs** — file-index rows for the new package + new skills per the
  Documentation Update Protocol; pointer rows where appropriate.

## Impact

- Affected: new `packages/authoring-toolkit`; `packages/document-converter`
  (+1 skill, +1 `pi.skills` entry); `docs/file-index-*` rows.
- No runtime/server/client behavior change — skills load by NL trigger.
- No new host-side python (Option A keeps `document-converter`'s Docker-only
  extraction invariant intact).
- Out of scope: `markdown-table-profiler`, `frontmatter-filler` (already shipped),
  `system-architect` (rejected), all personal/infra-bound skills.
