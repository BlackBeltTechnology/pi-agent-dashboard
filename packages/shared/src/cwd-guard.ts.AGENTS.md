# cwd-guard.ts — index

Shared plugin cwd guard (kb-plugin, mcp-client). Sync `isAllowedCwd` / `canonPath` / `mainCheckoutPath` unchanged (non-route callers).

Async tri-state `admitCwd(cwd, known, opts)` → `admit{token}` | `refuse` | `indeterminate{failedProbes, elapsedMs}`. Order: realpath (errno-reporting) → missing and not known ⇒ refuse, no git → `.git` segment ⇒ refuse → canonical cwd in known ⇒ admit → classified checkout-root derivation. A failure to DECIDE is `indeterminate`, never `refuse`, never `admit`; routes answer 503 `cwd-admission-unavailable` + `Retry-After`.

Derivation: global cap `ADMISSION_MAX_CONCURRENT`=4, per-probe `ADMISSION_PROBE_TIMEOUT_MS`=1000, whole-decision `ADMISSION_DEADLINE_MS`=3000 (counted from entry, includes the semaphore wait). At the deadline: resolve `indeterminate`, abort in-flight git, free the slot only after the last child EXITED (`RunCtx.onClose`). Concurrent calls for one canonical cwd share one derivation. NO cross-request cache. `AdmitCwdOptions.onIndeterminate` lets the host log without a logger dependency; `runner` / `realpath` are test seams.

`admissionAllows(admission, cwd)` is the sync branch predicate routes use after `await admitCwd(...)` (CodeQL barrier guard, `cwd` = Argument[1]). `AdmissionToken` is request-scoped, module-private (`WeakMap`): `releaseAdmission`, `isAdmissionLive`, `tokenAllows(token, cwd)` (writer/live reader), `issueHeldAdmission(decision, rawCwd)` (mints from the host's post-verdict DECISION only when it answers this request's cwd). A token never crosses the wire.


Whole-decision deadline is fenced (no late derivation or token). Canonicalization is errno-aware: `canonKnownClassified` marks the known set `uncertain` on a non-ENOENT error, so "no match" becomes `indeterminate`; `issueHeldAdmission(decision, rawCwd)` is sync and fs-free: mints only when `decision.cwd` (the resolved cwd the host answered for) equals `resolve(rawCwd)`; the host already re-resolved the real path.

See change: harden-plugin-cwd-admission.
