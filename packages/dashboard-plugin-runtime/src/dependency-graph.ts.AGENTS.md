# dependency-graph.ts — index

Pure plugin-activation dependency graph. Exports `GraphNode`, `Graph`, `buildGraph`, `transitiveDependents`, `transitiveDependencies`, `computeToggleImpact` (returns `cascadeEnable`/`cascadeDisable`/`blockers`), `detectCycles`, `topologicalSort` (priority+id tier tiebreak, cyclic nodes appended last). Shared by server route handler + client cascade confirm dialog.
