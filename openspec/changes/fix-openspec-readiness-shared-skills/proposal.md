## Why

Issue [#1165](https://github.com/BlackBeltTechnology/pi-agent-dashboard/issues/1165): a project whose OpenSpec skills live in the shared `.agents/skills/` root (OpenSpec 2.x layout, `.pi/skills/openspec-*` removed and committed) is folded to `STALE · missing-skills`. The folder card shows the "skills missing" pill instead of the board and the session-card OpenSpec controls are disabled, even though pi loads the skills natively.

**Verified root cause (CONFIRMED):** `hasOpenSpecSkillsFor` in `packages/server/src/directory-service.ts:591-598` stats only `<configRoot>/.pi/skills/openspec-explore`. `deriveOpenSpecReadiness` (`packages/server/src/openspec/readiness.ts:85`) turns `hasOpenSpecSkills === false` into `{STALE, missing-skills}`. The `openspec-readiness` spec ("Server SHALL report OpenSpec skill presence per cwd") hard-codes the same path.

**pi discovers `.agents/skills/` (CONFIRMED):** pi `docs/skills.md:61` — "Pi also supports the Agent Skills locations `~/.agents/skills/` and `.agents/skills/`. Project `.agents/skills/` directories are discovered from the working directory through its ancestors, stopping at the repository root."

**PARTIAL on the issue's side claims:** both `packages/server/package.json:87` and `packages/extension/package.json:55` pin `@fission-ai/openspec` `1.14.3` today (issue says server pins 1.11.0). The "Update cannot clear it" symptom is real but is a mixed-CLI-version problem, left out of scope.

## What Changes

- `hasOpenSpecSkillsFor` returns `true` when `<configRoot>/.pi/skills/openspec-explore` **or** `<configRoot>/.agents/skills/openspec-explore` exists (short-circuit; legacy first). Config-root resolution and the `null`-root refusal stay unchanged.
- `openspec-readiness` spec: skill-presence requirement + worktree requirement accept either layout; new scenarios for shared-only, both-absent, worktree via main checkout, null config root. The restated requirement also corrects the stale "fall back to the cwd" sentence to the implemented refusal (`false`, `directory-service.ts:595-598`, test E20); rationale and trade-off prose cover the committed shared layout.
- Doc comments on `OpenSpecData.hasOpenSpecSkills` (`packages/shared/src/types.ts:1414`) and `ReadinessInputs.hasOpenSpecSkills` (`readiness.ts:40`) updated. No wire-format change.

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `openspec-readiness`: skill presence satisfied by `.pi/skills/` (legacy) or `.agents/skills/` (shared) at the config root.

## Non-goals

- Parsing `.agents/skills/.openspec-target`.
- Walking ancestor `.agents/skills/` dirs the way pi does; the dashboard keeps checking the config root only.
- Changing `POST /api/openspec/init|update` (still `--tools pi`), bumping the pinned CLI, or detecting the shared layout before offering Update (issue's follow-up; separate change).
- Changing the `/skill:openspec-explore` send path.
- The `project-init` skill (`packages/extension/.pi/skills/project-init/SKILL.md:162,392`; `openspec/specs/project-init-skill/spec.md:66,89,95,134,140`) still treats `.pi/skills/openspec-explore/` as its sole "initialized" predicate: a shared-layout project is `repair`ed (`openspec init --tools pi --force`) and its verify step expects `.pi/skills/`. Dashboard readiness and that scaffold-time skill therefore disagree for shared-layout projects until a follow-up widens the skill predicate + spec (owner choice recorded in `/tmp/rev/fix-openspec-readiness-shared-skills-tradeoffs.md`). Not changed here.
- The activity detector `SKILL_PATH_RE` (`packages/shared/src/openspec-activity-detector.ts:78`, spec `openspec-detection`) matches only `.pi/skills/openspec-*/SKILL.md`, so phase detection from skill reads stays blind on shared-layout projects. Follow-up.

## Relationship

- `extract-openspec-as-plugin` (active, proposal only, no `tasks.md`) will move OpenSpec parts of `directory-service.ts` into `packages/openspec-plugin/`. This fix is a ~3-line change in `hasOpenSpecSkillsFor`; the file move carries it along. **Recommendation: keep separate and land first** — it is a user-visible bug and does not need the plugin work. Not folded; that change is not edited.
- Archived `add-openspec-init-affordances` introduced the requirement; `apply-checkout-root-to-worktree-ops` introduced config-root resolution. Both remain valid.

## Discipline Skills

- `review-code` (non-trivial change, tests pass before commit).
- None of security-hardening / performance-optimization / observability-instrumentation / doubt-driven-review apply: one extra short-circuited `stat` in the existing stat pass, no new endpoint, no public-API break.

## Impact

- Code: `packages/server/src/directory-service.ts` (`hasOpenSpecSkillsFor`), doc comments in `packages/shared/src/types.ts`, `packages/server/src/openspec/readiness.ts`; tests in `packages/server/src/__tests__/directory-service-readiness.test.ts`.
- Docs: `docs/architecture.md` (`hasOpenSpecSkills` paragraph) and `docs/faq.md` (`missing-skills` bullet), written via DocScribe.
- Compatibility: purely widens the "skills present" answer; legacy layout behaves identically. Wire shape unchanged.
- Migration: none. Rollback: revert the commit (readiness reverts to `.pi/skills`-only).
- Rebuild: server change → restart server.
