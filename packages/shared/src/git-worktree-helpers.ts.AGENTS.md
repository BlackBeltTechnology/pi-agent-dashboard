# git-worktree-helpers.ts — index

Pure worktree helpers shared by server + client. `slugifyBranch(branch)` → fs-safe slug; `localNameOf(ref)` strips remote prefix; `resolveCheckoutLocalName(base, baseIsLocalBranch)`; `resolveDefaultBase(input)` picks current→develop→main→master→fail. No fs/child_process.
