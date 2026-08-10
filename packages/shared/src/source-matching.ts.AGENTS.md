# source-matching.ts — index

`sourcesMatch` cross-kind matcher. Adds `npm ↔ raw` branch: npm-declared package installed from local path (raw kind) matches by comparing local path basename to unscoped npm name. Mirrors existing `git ↔ raw` rule. See change: roles-standalone-defaults-and-local-install-detection.
