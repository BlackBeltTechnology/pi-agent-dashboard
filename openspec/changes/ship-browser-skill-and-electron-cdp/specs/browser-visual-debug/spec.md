## REMOVED Requirements

### Requirement: pi-agent-browser package installation

**Reason**: Replaced by the bridge-shipped universal `browser` skill (see `default-browser-skill` capability), whose Step-0 preflight handles the `agent-browser` CLI presence check on demand. Pre-installing `pi-agent-browser` as a project-local package forced every developer of this repo to take the dependency even if they never used the skill — strictly worse than the on-demand model.

**Migration**: Remove `"npm:pi-agent-browser"` from this repo's `.pi/settings.json` `packages` array if present. Agents needing the `browser` tool can run `pi install npm:pi-agent-browser` themselves; the universal skill's Step-0 preflight tells them when and how.

### Requirement: Skill SKILL.md with core workflows

**Reason**: The repo-local skill at `.pi/skills/browser-visual-debug/SKILL.md` is being removed. Its content is migrated into the universal `browser` skill shipped by the bridge extension at `packages/extension/.pi/skills/browser/SKILL.md`, where it benefits all dashboard users rather than only sessions in this repo.

**Migration**: Use `/skill:browser` instead of `/skill:browser-visual-debug`. The universal skill's `SKILL.md` covers the same four core workflows (visual verification, interactive debugging, responsive checks, console error hunting) via its preflight + recipe-routing structure.

### Requirement: Dashboard detection script

**Reason**: The `scripts/detect-dashboard.sh` helper that auto-detects the running dashboard URL is being migrated into the universal `browser` skill's references where it remains useful for any dashboard user, not just developers of this repo.

**Migration**: The detection script SHALL be reproduced under `packages/extension/.pi/skills/browser/scripts/detect-dashboard.sh` (or equivalent path inside the universal skill). The universal skill's `references/web.md` SHALL document how to invoke it.

### Requirement: Dashboard-specific recipes reference

**Reason**: Repo-local skill being removed. Dashboard-specific visual-debug recipes are migrated into the universal `browser` skill where they remain accessible to anyone debugging the dashboard, regardless of which repo their pi session is rooted in.

**Migration**: Recipe content from `.pi/skills/browser-visual-debug/references/dashboard-recipes.md` (or equivalent) is folded into the universal skill's `references/web.md` or its own reference file under `packages/extension/.pi/skills/browser/references/`.

### Requirement: Responsive testing reference

**Reason**: Repo-local skill being removed. Responsive-testing recipes (viewport presets, common breakpoints, browser tool invocations) are useful for all dashboard users, not just this repo.

**Migration**: Content from `.pi/skills/browser-visual-debug/references/responsive-testing.md` is migrated into the universal skill's references — either appended to `references/web.md` or as a dedicated `references/responsive.md` file.

### Requirement: Commands cheatsheet reference

**Reason**: Repo-local skill being removed. The `agent-browser` commands cheatsheet is generic reference material applicable to any dashboard user.

**Migration**: Content from `.pi/skills/browser-visual-debug/references/commands-cheatsheet.md` is migrated into the universal skill's references. The vendored `agent-browser` upstream content (`core` skill) already contains substantially the same material; the cheatsheet content SHALL be merged with it rather than duplicated.
