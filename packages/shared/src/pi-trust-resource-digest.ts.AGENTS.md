# pi-trust-resource-digest.ts — index

Remote folder proof, Node-only. `trustResourceManifest(cwd,{home,signal})` async walk of pi's trust-requiring resources (`.pi/*` + ancestor `.agents/skills`), file content hashed; `null` on empty set, symlink, special file, >1,000 entries, >16 MiB, bad settings refs, abort. `trustResourceDigest(salt,cwdKey,manifest)` HMAC-SHA256. `TRUST_REQUIRING_PROJECT_CONFIG_RESOURCES` literal, pinned to pi by golden test. See change: mirror-dashboard-trust-live-remote.
