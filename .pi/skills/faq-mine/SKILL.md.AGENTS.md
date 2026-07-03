# faq-mine/SKILL.md — index

Skill: mine `docs/faq.md` from README.md + evergreen `docs/*.md`. 4 phases — Phase 0 dedupe existing `## ` headings; Phase 1 `ask_user` multiselect scope; Phase 2 parallel haiku subagents each write `docs/.faq-draft-<base>.md`; Phase 3 cross-draft dedupe via `grep '^## '`; Phase 4 `cat >> faq.md` + rm drafts. Enforces caveman style, `Cross-refs:` blocks. Excludes `AGENTS.md` (incl. `docs/AGENTS.md`), `session-knowledge-*.md`, `spec-gap-analysis.md`.
