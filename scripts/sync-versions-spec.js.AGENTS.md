# sync-versions-spec.js — index

Pure helper extracted from sync-versions.js for unit tests. Exports isRewritableSemverSpec(spec) — true for X.Y.Z / ^X.Y.Z / ~X.Y.Z / prerelease+build; false for `*`, `latest`, workspace:*, git URLs, file:, OR-unions, empty/non-string.
