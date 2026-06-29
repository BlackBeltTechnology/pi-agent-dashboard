# authoring-skills — delta

## ADDED Requirements

### Requirement: Authoring-toolkit skill package

The monorepo SHALL provide a pure-skill package `packages/authoring-toolkit`
that registers general-purpose authoring skills via its `package.json`
`pi.skills[]` array and ships them under `files[".pi/skills/"]`, with no
`extension.ts`. It SHALL include a `NOTICE` crediting third-party skill sources
and their licenses.

#### Scenario: Package registers its skills

- **WHEN** the workspace resolves `packages/authoring-toolkit`
- **THEN** `package.json` `pi.skills[]` SHALL list `.pi/skills/skill-creator` and `.pi/skills/session-to-guideline`
- **AND** both skill directories SHALL exist with a `SKILL.md`.

#### Scenario: No personal coupling in ported skills

- **WHEN** any ported skill file is inspected
- **THEN** it SHALL NOT contain personal paths or identifiers (`/Users/robson`, personal names, named clients).

### Requirement: session-to-guideline runs under repo toolchain

The `session-to-guideline` skill SHALL invoke its scripts via `npx tsx` (repo
convention), not `bun`, and its scripts SHALL NOT depend on bun-only runtime
APIs. It SHALL read pi session transcripts from the pi-standard session path.

#### Scenario: Scripts invoked via tsx

- **WHEN** the skill's `SKILL.md` documents script invocation
- **THEN** invocations SHALL use `npx tsx scripts/…`
- **AND** the `.ts` scripts SHALL contain no `Bun.*` API references.

#### Scenario: Lists sessions for the current project

- **WHEN** `npx tsx scripts/list_sessions.ts --cwd "$(pwd)" --limit 5` runs in a project with pi sessions
- **THEN** it SHALL list candidate session transcripts.

### Requirement: doc-summarizer folded into document-converter without host-side extraction

The `doc-summarizer` skill SHALL live under
`packages/document-converter/.pi/skills/doc-summarizer` and SHALL be registered
in that package's `pi.skills[]`. It SHALL perform document extraction by calling
the existing Docker-quarantined engine, preserving the package invariant that
the engine is the only extraction surface. It SHALL NOT introduce host-side
extractor scripts (`extract_text.py`, `pdf_to_markdown.py`) or a new
`engine/doc_summarizer/` subcommand.

#### Scenario: Reuses the existing engine

- **WHEN** the `doc-summarizer` SKILL describes extraction
- **THEN** it SHALL reference the existing engine call surface
- **AND** it SHALL NOT bundle host-side extractor scripts.

#### Scenario: Registered in document-converter

- **WHEN** `packages/document-converter/package.json` is inspected
- **THEN** `pi.skills[]` SHALL contain `.pi/skills/doc-summarizer` alongside `.pi/skills/document-converter`.
