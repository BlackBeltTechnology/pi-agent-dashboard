# @blackbelt-technology/pi-dashboard-openspec-workflow

A pi package — **skills only, no tools** — with helpers for the
[OpenSpec](https://github.com/Fission-AI/OpenSpec) change lifecycle.

Reusable in any OpenSpec + pi project.

## Install

```bash
pi install npm:@blackbelt-technology/pi-dashboard-openspec-workflow
# or try without installing:
pi -e npm:@blackbelt-technology/pi-dashboard-openspec-workflow
```

## Skills

| Skill | What it does |
|-------|--------------|
| `spec-coherence-check` | Sweep all active proposals for staleness, conflicts, and obsolescence against the current codebase and archived changes. Produces a gap-analysis report + priority queue. |
| `pre-scaffold-openspec-coherence-check` | Run before scaffolding a new proposal to catch duplicates of archived work and contradictions with already-shipped architecture. |
| `fix-worktree-opsx-skills-not-created` | Repair a git worktree missing the generated `openspec-*` (opsx) skills. Root cause: bare `npx openspec` resolves a squatted registry stub instead of the real CLI. |
| `reverse-spec-from-code` | Reverse-generate `openspec/specs/<cap>/spec.md` from spec-less code, using parallel blind generators + auditors, to enrich the `kb_search` corpus. |

Skills load by natural-language trigger, or explicitly via `/skill:<name>`.

## How loading works

Pure-skill package: `package.json` `pi.skills` points pi at each skill
directory. No `extension.ts`, no build step.

## License

MIT
