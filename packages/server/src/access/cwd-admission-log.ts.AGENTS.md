# cwd-admission-log.ts — index

`createIndeterminateLogger(logger)` — rate-limited `[cwd-admission] indeterminate` sink: 1 line per canonical cwd per 60 s, LRU-bounded 512. Wired as `host.cwdAdmissionOnIndeterminate`. See change: harden-plugin-cwd-admission.
