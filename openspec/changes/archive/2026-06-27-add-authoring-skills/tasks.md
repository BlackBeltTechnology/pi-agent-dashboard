# Tasks — Authoring skills port

## 1. New package: authoring-toolkit (scaffold)

- [x] 1.1 Create `packages/authoring-toolkit/package.json` (`@blackbelt-technology/pi-dashboard-authoring-toolkit`, `pi.skills` listing both skills, `files: [".pi/skills/", "README.md", "NOTICE"]`) → verify: `cat` shows valid JSON; `pi.skills` paths match dirs created below.
- [x] 1.2 Add `packages/authoring-toolkit/README.md` (what it ships, trigger phrases) and `NOTICE` (skill-creator = Anthropic MIT attribution) → verify: files exist; NOTICE names source + license.
- [x] 1.3 Confirm the workspace picks up the new package → verify: `npm install` clean; package resolves in the monorepo workspace.

## 2. skill-creator (copy, clean)

- [x] 2.1 Copy `~/Documents/.claude/skills/skill-creator/SKILL.md` → `packages/authoring-toolkit/.pi/skills/skill-creator/SKILL.md`; tidy `license:` frontmatter → verify: frontmatter has `name`, `description`, valid `license`; no `/Users/robson` or personal strings (`grep -niE '/Users/robson|Csákány|Róbert' = empty`).

## 3. session-to-guideline (copy, adapt bun → tsx)

- [x] 3.1 Copy SKILL.md + `scripts/{extract_session,list_sessions}.ts` + `references/guideline-template.md` into `packages/authoring-toolkit/.pi/skills/session-to-guideline/` → verify: tree matches source.
- [x] 3.2 Replace `bun scripts/…` invocations in SKILL.md with `npx tsx scripts/…` → verify: `grep -n 'bun ' SKILL.md` empty.
- [x] 3.3 Replace any bun-only APIs in the `.ts` scripts (`Bun.*`) with `node:` equivalents → verify: `grep -rn 'Bun\.' scripts/` empty.
- [x] 3.4 Run the scripts against a real session → verify: `npx tsx scripts/list_sessions.ts --cwd "$(pwd)" --limit 5` lists sessions; `extract_session.ts` produces a guideline on the latest.

## 4. doc-summarizer → document-converter (Option A, orchestrate-only)

- [x] 4.1 Create `packages/document-converter/.pi/skills/doc-summarizer/SKILL.md` (copied, rewritten to call the existing engine extract instead of bundled extractors; subagent fan-out + synthesis) → verify: SKILL describes engine-based extraction; does NOT reference `pdf_to_markdown.py`/`extract_text.py`.
- [x] 4.2 Do NOT copy `extract_text.py` / `pdf_to_markdown.py`; carry `chunk_text.py` only if the procedure needs it → verify: skill dir has no host-side extractor scripts; no `engine/doc_summarizer/` added.
- [x] 4.3 Append `.pi/skills/doc-summarizer` to `document-converter` `package.json` `pi.skills[]` → verify: array contains both entries; JSON valid.
- [x] 4.4 Confirm no personal coupling carried over → verify: `grep -niE '/Users/robson|Csákány|Róbert|NAV' SKILL.md` empty.

## 5. Docs (Documentation Update Protocol)

- [x] 5.1 Add file-index rows (matching `docs/file-index-<area>.md` split) for: authoring-toolkit package files + 2 skills, doc-summarizer skill, package.json edits → verify: rows alphabetical; delegated to docs subagent with caveman-style rule.
- [x] 5.2 Add splits-table row in `docs/file-index.md` if a new area split is created → verify: pointer resolves.

## 6. Validate

- [x] 6.1 `openspec validate add-authoring-skills --strict` → verify: passes.
- [x] 6.2 Sanity-load: start a session, confirm the three skills appear/trigger by NL → verify: each skill is discoverable.
