---
name: "pre-scaffold-openspec-coherence-check"
description: "Run before scaffolding any OpenSpec proposal in the project to catch duplicates of archived work and contradictions with already-shipped architecture. Always run when about to create openspec/changes/&lt;name&gt;/ (proposal.md/design.md/tasks.md), especially for proposals touching any subsystem with a recent archive entry. Skipping this check produces stale proposals that duplicate archived work and contradict shipped architecture. Triggers: 'scaffold OpenSpec', 'write a proposal', 'create change', 'openspec change new'."
version: 1
created: "2026-06-13"
updated: "2026-06-13"
---
## When to Use
Use before scaffolding any new OpenSpec change in this project, regardless of whether the topic feels novel. Two of the most damaging mistakes the assistant has made are (a) re-proposing work that already shipped and was archived, and (b) basing claims about current code on stale file-index harvests or grep results that miss the actual wiring idiom. This skill front-loads the cheap checks that would have caught both.

Trigger this skill when about to run any of: openspec change new, Write to openspec/changes/&lt;name&gt;/proposal.md, the openspec-new-change skill, the openspec-ff-change skill, or any drafted "## Why / ## What Changes" markdown that will become a proposal.

Do NOT skip even when the explore-mode conversation feels grounded. The Explore subagent harvests the file-index which can be days stale; the main agent's own grep can answer the wrong question (e.g. grepping for a consumer component when the wiring is inline).

## Procedure
1. Archive sweep: ls openspec/changes/archive/ | grep -iE ‘&lt;topic-keywords&gt;’. For tool-renderer / plugin-slot / MCP / ctx_* / context-mode topics specifically check for 2026-06-05-wire-tool-renderer-slot and 2026-06-05-add-ctx-tool-renderer. If any archive entry matches the topic, READ its proposal.md before writing a new one.
2. Active sweep: openspec list | grep -iE ‘&lt;topic-keywords&gt;’. Read any active change that overlaps so the new proposal does not collide on filename, capability, or scope.
3. Current-code verification (for behaviour claims): if the proposal says ‘X is not wired’, ‘Y never fires’, ‘Z falls through to Generic’, grep for the FUNCTIONAL pattern not just the named component. For tool-renderer claims specifically: grep -rn 'getClaims.*tool-renderer\\|forToolName' packages/client/src/components/ToolCallStep.tsx and read the current dispatch block (lines 90–120). The slot wiring inlines useSlotRegistryOrNull + forToolName + claimShouldRender; the ToolRendererSlot consumer component is unused, but that does NOT mean the slot is unwired.
4. Slot-prop contract check: cat packages/shared/src/dashboard-plugin/slot-props.ts and read SlotPropsMap[‘&lt;slot&gt;’]. Confirm the required fields (every slot requires pluginContext: AnyPluginContext) and the optional fields. Do not invent a contract.
5. Registry check (built-in renderers): cat packages/client/src/components/tool-renderers/registry.ts. The ctx_* family is mapped to a single CtxToolRenderer with a ctx_-prefix safety net for new tool names. Honour this architecture choice unless explicitly proposing to revisit it.
6. Architecture-choice review: when the topic intersects an existing implementation, search recent commits with git log --oneline --since=&lt;30 days&gt; -- &lt;relevant paths&gt; to understand which design the team picked and the rationale. The choice between core built-in vs plugin for ctx_* was DELIBERATE (high-frequency tool, hot path); do not propose to reverse it without an explicit justification section.
7. Optional but recommended: run the spec-coherence-check skill (project skill) which sweeps all active proposals for staleness, conflicts, and obsolescence against the current codebase and archived changes. Treat its output as authoritative.

## Pitfalls
- Trusting an Explore subagent that read only the file-index. The file-index can lag commits by days; for any claim about CURRENT code behaviour, verify against the source tree directly.
- Misreading grep results: 'rg ToolRendererSlot returns no hits' is technically correct but does NOT imply 'plugin tool-renderer claims do not fire'. The wiring may be inline. Always grep for the FUNCTIONAL identifier (getClaims, forToolName) not just the named component.
- Skipping the archive sweep because the topic feels new. Topics that already shipped get archived under YYYY-MM-DD-prefixed folder names; ls openspec/changes/archive/ once, costs nothing.
- Inventing a slot prop contract from memory. Every plugin slot in slot-props.ts requires pluginContext: AnyPluginContext on top of the slot-specific fields. Missing this in a spec is a silent gap.
- Re-proposing a plugin-based architecture without acknowledging the team chose core built-in (commit 858464d0 for ctx_*). The proposal must explicitly argue why the existing choice should be reversed; otherwise it contradicts shipped reality.
- Pushing a proposal commit straight to develop without running these checks. develop accumulates contributions quickly; a stale proposal there gets cleaned up by others (which is what happened to openspec/changes/wire-tool-renderer-slot/ in commit e4e63989 — someone deleted my folder upstream, and I had to revert the rest).

## Verification
1. The archive sweep ran and either returned no matches OR I read every matching proposal.md and either align with it (delta-style change) or explicitly argue why a fresh proposal is needed.
2. For every behaviour claim in the proposal's ## Why section, I have a direct grep / cat result from current code that supports it, not a recollection.
3. The proposal's ## What Changes section does not contradict any code in packages/client/src/components/tool-renderers/registry.ts, packages/client/src/components/ToolCallStep.tsx, or packages/shared/src/dashboard-plugin/slot-props.ts.
4. If proposing a new capability name, it does not collide with any folder under openspec/changes/ or openspec/changes/archive/. Specifically: openspec/changes/&lt;name&gt;/ does not exist AND openspec/changes/archive/*-&lt;name&gt;/ does not exist.
5. openspec validate &lt;change-name&gt; passes (catches structural issues but not contradictions — the above checks catch those).