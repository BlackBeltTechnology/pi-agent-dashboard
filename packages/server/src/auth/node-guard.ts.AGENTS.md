# node-guard.ts — index

Re-exports `isAffectedNode`/`isOutOfEnginesRange` from shared `node-version.ts` (public API unchanged). Owns `buildEnginesRangeMessage`, `buildNodeUpgradeMessage`, `assertNodeVersionSupported` (preflight refuse-to-start, exit 1). See change: unify-node-version-gate.
