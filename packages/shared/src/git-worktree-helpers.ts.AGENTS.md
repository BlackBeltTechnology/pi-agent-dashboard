# git-worktree-helpers.ts — index

Pure worktree helpers shared by server + client. `slugifyBranch(branch)` → fs-safe slug; `localNameOf(ref)` strips remote prefix; `resolveCheckoutLocalName(base, baseIsLocalBranch)`; `resolveDefaultBase(input)` picks current→develop→main→master→fail. No fs/child_process.

`slugifyBranch` trims `-` at both ends with index loops, then `slice(0, 64)` (was quadratic regex). See change: fix-codeql-small-findings.
