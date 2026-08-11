# session-group-path.ts — index

Hoisted `inferPlatform`/`pathKey`/`resolveSessionGroupPath` from client session-grouping.ts. Single source of truth. Server keys order map by same resolved path client reads. Precedence pin > gitWorktree.mainPath > cwd. See change: simplify-session-card-ordering.
