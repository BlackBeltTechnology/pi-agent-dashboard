## 1. Extract the shared create-or-reuse function

- [ ] 1.1 Write failing tests for `ensureWorktree`: create, reuse, fail-on-exists, not_git, branch_invalid (`../x`, invalid ref chars), git failure mapping
- [ ] 1.2 Extract `ensureWorktree` from the `POST /api/git/worktree` handler (D1, D3); route keeps byte-identical responses (existing route tests stay green)
- [ ] 1.3 Add per-repo mutex; failing test: two concurrent reuse calls create exactly one worktree (D4)

## 2. Plugin SDK + host hook

- [ ] 2.1 Add `PluginSpawnOptions.worktree` and worktree fields on `PluginSpawnResult`; mapper sanitizes the block (non-object → absent)
- [ ] 2.2 Write failing tests: block present → session cwd is the worktree; bare `mode: "worktree"` → legacy local; untrusted plugin → refused
- [ ] 2.3 Implement the host hook branch in `server.ts` calling `ensureWorktree` then the shared post-create wiring (D5)
- [ ] 2.4 Write failing tests: `attachChange` attaches on register; untrusted init hook does not run; trusted + auto-init runs
- [ ] 2.5 Log create/reuse/failure with branch and reason code

## 3. Docs + verification

- [ ] 3.1 Update AGENTS.md rows (`server-context.ts`, `git-worktree/`, `server.ts` sidecar); DocScribe note in `docs/architecture.md` plugin-spawn section
- [ ] 3.2 Full test run; manual check spawning a worktree session from a test plugin action
