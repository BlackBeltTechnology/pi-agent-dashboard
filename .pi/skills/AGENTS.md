# DOX — .pi/skills

Files in this directory. One row per file. Non-source area (migrated from `docs/file-index-skills-misc.md`; source of truth now here). See change: migrate-file-index-to-agents-tree.

| File | Purpose |
|------|---------|
| `code-quality/SKILL.md` | code-quality skill. Biome analyze→fix→test. changed-files (goal-loop) + whole-repo (cleanup) modes. oracle `npm run quality:changed`. safe/unsafe fix policy. grandfather rough edge. See change: add-code-quality-skill. |
| `code-review/references/` | Language guides + architecture/performance/security review references |
| `code-review/SKILL.md` | Skill: comprehensive code review with severity labels |
| `distill-session-knowledge/SKILL.md` | Skill. Offline-mine pi session JSONL into verified reusable artifacts. Dry-run default. Routes to skill_manage / memory / docs+ctx_index. Wraps `packages/session-distiller` orchestrator. |
| `document-converter/SKILL.md` | NL-triggered document conversion. Ingest PDF/DOCX/PPTX/XLSX→md for kb; produce md→DOCX/PDF templated. Routes to packages/document-converter facade. See change: document-converter. |
| `nano-banana-imagegen/references/` | Prompting guide, example prompts |
| `nano-banana-imagegen/SKILL.md` | Skill: AI image generation/editing via Google Gemini (nano-banana CLI) |
| `openspec-shared/scripts/effective-status.sh` | Bash wrapper around `openspec status --change <name> --json`; applies same R1/R2/R3 promotion as dashboard so OpenSpec workflow skills (`openspec-{continue,ff,apply,verify}-change`) + dashboard session-card buttons cannot disagree about change's next-ready artifact. Inlines rule logic via `find` + `grep -E`; `jq` for JSON mutation; falls back to raw CLI output if `jq` absent. **Repo-lint** `packages/shared/src/__tests__/no-raw-openspec-status-in-skills.test.ts` blocks raw `openspec status ... --json` calls in any of four governed skills (opt-out: `ban:openspec-status-ok`). Parity test: `packages/shared/src/__tests__/openspec-effective-status-script.test.ts`. See change: fix-openspec-design-detection. |
| `pi-dashboard/commands/` | `/dashboard:*` slash-command templates (33 `dashboard-*.md`). 13 LLM-free (`executable: bash` → run as bash, no LLM, "ran locally" footer); 20 LLM-bound (expand to user message). Naming `/dashboard:<resource>-<verb>[-<modifier>]`. README.md documents frontmatter + convention. Reference: `references/slash-commands.md`. See change: add-dashboard-slash-commands. |
| `pi-dashboard/references/api-reference.md` | Complete REST API reference for skill |
| `pi-dashboard/references/recipes.md` | Multi-step orchestration recipes |
| `pi-dashboard/scripts/dashboard-api.sh` | Helper script with port auto-detection + auth |
| `pi-dashboard/SKILL.md` | Bundled skill: monitor + control dashboard from any pi session. `commands/` subdir ships `/dashboard:*` slash templates; `references/slash-commands.md` documents them. See change: add-dashboard-slash-commands. |
| `release-cut/SKILL.md` | Cuts new release: promotes `## [Unreleased]` in CHANGELOG → dated section, bumps every workspace package.json, commits, tags, pushes (fires `publish.yml`). Skill's `Next steps (human)` block enumerates **7 platform artifacts** releaser expects on draft GitHub Release: `PI-Dashboard-darwin-arm64-<ver>.dmg` (Apple Silicon), `PI-Dashboard-darwin-x64-<ver>.dmg` (Intel), Linux `.deb` × 2 (x64+arm64), Linux `.AppImage` (x64 only — appimagetool no arm64 build), Windows NSIS+ZIP+portable (x64), Windows ZIP+portable (arm64, no NSIS cross-compile). Missing artifacts in draft = CI failure; do NOT click Publish. (change: add-darwin-x64-build updated count 6 → 7, split macOS DMG into two arches.) |
| `spec-coherence-check/references/proposal-queue-schema.md` | JSON schema for `.pi/proposal-queue.json` |
| `spec-coherence-check/SKILL.md` | Skill: sweep proposals for staleness, conflicts, obsolescence against codebase |
| `switch-extension-source/scripts/switch-source.ts` | Toggle script. Commands: status \| local <pkg> [--overlay] \| npm <pkg>. <pkg> = monorepo dir or npm name. Purges all other representations, backs up `*.bak-switch-*`, validates JSON. Skips dashboard-managed bridge plugins. |
| `switch-extension-source/SKILL.md` | Skill. Switch monorepo extension/skill package between published npm source and local working-tree source. Guarantees one source per package. Two config layers: global `~/.pi/agent/settings.json` packages[], project `.pi/settings.json` overlay. Takes effect next session start. |
