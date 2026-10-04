# DOX — packages/extension/src/path-gate

Agent path gate: asks the operator before pi's `read`/`write`/`edit` leave the session's roots. One row per source file. Approval control, not a sandbox (`bash`/custom tools uncovered). See change: ask-agent-file-access-in-chat.

| File | Purpose |
|------|---------|
| `decide.ts` | Pure `decidePathAccess` → `in-root` \| `ask`. Component-wise containment (`isWithin`, never string prefix, NFC + optional case fold) over workspace / read-only / read+write / grant roots. Ask carries `sensitive`, `subject` (containing dir, never an ancestor), `grantable`, lexical `suppressionKey`. `buildOptions`: Always allow only for grantable + store match, else note. |
| `grant-cache.ts` | `GrantCache`: read-only mtime/size-gated reader of `~/.pi/dashboard/access-grants.json`; project-scope subjects only; missing/malformed/unknown version → empty. |
| `grant-link.ts` | `createGrantLink`: `dashboard_identity` token vs local `~/.pi/dashboard/grant-store-id` (`storeMatches`, re-evaluated per frame); `requestGrant` → `path_grant_request`/`path_grant_result`, unsent/timeout/reset → `ok:false`. |
| `handler.ts` | `createPathGateHandler`: gated tools read/write/edit only; settlement table (Allow once / Deny / dismiss / Always allow + confirm); ONE budget (`timeoutSeconds`) cancelling open prompts; per-session mutex; 120 s suppression; fail closed (`denied`/`timeout`/`no-ui`/`error`/`recently-denied`); own try/catch → block; log `[path-gate] <outcome> tool= access= path= session= sensitive=`. Prompt metadata kinds `agent-path-gate` / `agent-path-gate-confirm`. |
| `index.ts` | `createPathGate`: assembles handler + roots + grant cache + grant link; hooks `onSessionStart` / `onBeforeAgentStart` / `onServerMessage` / `reset`; config re-read ≤1 s with env override; PromptBus prompter (fails closed when no bus). |
| `resolve.ts` | `resolveToolPath` (pi `resolveToCwd` parity: Unicode spaces, `@`, win32 shell paths, `~`, `file://`) + `canonicalizeTarget` (nearest-existing-ancestor realpath + tail). Injectable `path` flavour / platform / realpath. |
| `roots.ts` | `RootsProvider`: cwd + bound checkout roots (async probe at `session_start`, bounded `PROBE_BOUND_MS`, fail closed to cwd), built-ins (pi agent dir, docs, skills, context files; tmpdir, `/tmp`, session dir) real-pathed once. |
| `suppression.ts` | `Suppression`: per-session "recently denied" map keyed by lexical parent dir, `SUPPRESSION_MS` = 120 s. |
