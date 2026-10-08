# .pi/skills/rebuild-package-diagrams/scripts/usage.mjs — index

`decodeSource`, `readJob`, `jobEvents` (json/csv, multi-column type), `typeToken`, `usageDraft`, `readMapping`, `checkUsage`, `aggregateUsage` (pseudonyms, kinds, actions, use cases, months, span, notLogged, neverSeen), `usageMd`, `sourceSecrets`, `leakErrors`. See change: add-usage-evidence.

RFC 4180 `csvRecords` (quoted newlines) + cell-count error; JSON `table` missing / zero rows → error. Draft = `{types: [{type, token, seen, candidates}]}` (no customers, per-customer counts, file names). `typeProblems(events, job)` (types holding user/object values, > `maxTypes` default 500; never names them), `mappingLeakErrors`, coverage hides leaky types. `ignoreLocal(path)` writes `_local/.gitignore`. Null-prototype tallies. Dirent walk (no symlink follow). `citeLine` via `appFile`. `ucsOf` memoized. PR #817 local review.

`jobEvents(job, onNote)`: per-source missing table / no rows → note (real multi-customer snapshots); table in no source or zero events → throws. Verified on the pilot (7 customers). PR #817.
