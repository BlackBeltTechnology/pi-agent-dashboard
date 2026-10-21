## Context

See proposal.md (Why) and the parent design `openspec/changes/archive/2026-10-18-mirror-dashboard-trust-to-pi/design.md` (D1–D8). Requirements: `specs/pi-trust-mirror/spec.md`, `specs/bridge-extension/spec.md`. This change relies on the following current state:

- **Bridge timing.** `registerProjectTrust` (`packages/extension/src/bridge-handlers/lifecycle.ts:186-204`) is synchronous and wrapped in `inst.safe(...)`. On a rejected promise, `safe()` resolves to `undefined` (`packages/extension/src/bridge.ts` `safe`).
  - pi awaits handlers serially, and the first yes/no wins (`@earendil-works/pi-coding-agent/dist/core/extensions/runner.js` `emitProjectTrustEvent`: `await handler(event, ctx)`). A thrown error or a result without `.trusted` is caught into `errors` and falls through.
  - The gateway WebSocket opens only in `session_start` (`lifecycle.ts:462-468`), so the first `project_trust` of a process has no connection.
  - `packages/server/src/pi/pi-gateway.ts` drops frames from a socket that has not claimed its session id ("one live bridge per session id").
- **Requester authentication already exists.** Two kinds:
  - **Genuinely local**: loopback, no forwarding headers, and an `X-Pi-Local-Proof` HMAC. It is keyed from `~/.pi/dashboard/local/token` and bound to `addr:port` and to `http <METHOD> <path>` (`packages/shared/src/local-credential-proof.ts`, `packages/server/src/auth/local-proof.ts`).
  - **Paired device**: an opaque bearer (`packages/server/src/auth/bearer-auth.ts`), tier-gated through `ROUTE_TIERS` (`packages/shared/src/route-tiers.ts`; `POST /api/ws-ticket` is `operate` at `:474`).

  Every route must also be classified in `packages/server/src/identity/http-road-classification.ts`, whose totality its test asserts, and checked against `identity-floor.ts`. A remote bridge already sends `PI_DASHBOARD_TOKEN` to HTTP to mint tickets (`packages/extension/src/bridge-ticket-client.ts`).
- **Live sources** (all process-wide, keyed by server-side real paths):
  - **Worktree-init session trust** (`packages/server/src/git-worktree/worktree-init-trust.ts:50-54`): a `Set`. `recordTrust(scope="session")` returns before `save()`/`trustChanged` (`:132-134`), and a session-only revoke does not notify either.
  - **Session access grants** (`packages/server/src/access/access-grants.ts:352-358`): returned before `notifyGrantsChanged()`. `revokeGrant` likewise.
  - **`YoloController`** (`packages/server/src/access/yolo-session.ts`): expiry is checked lazily in `status()` (`:120-122`). There is no timer and no listener.
- **pi's trust-requiring resources** (`dist/core/trust-manager.js:8-17,151-170`): `<cwd>/.pi/{settings.json, mcp.json, extensions, skills, prompts, themes, SYSTEM.md, APPEND_SYSTEM.md}`, plus `<d>/.agents/skills` for every ancestor `d` of the cwd except `~/.agents/skills`. `hasTrustRequiringProjectResources` is exported from the pi package root.
- **Parent plumbing to reuse:**
  - `filterMirrorEntries`, `isMirrorDenied`, `piTrustKey`, `statFolderIdentity`, `identityMatches`, `findCoveringEntry` (`packages/shared/src/pi-trust-mirror.ts`);
  - `readPiTrustMirrorSnapshot`, `coverSnapshot`, `safePiTrustKey` (`packages/shared/src/pi-trust-mirror-snapshot.ts`);
  - `host-project-trust.ts` (`packages/server/src/pi/`);
  - `PiTrustMirrorConfig` / `parsePiTrustMirror` (`packages/shared/src/config.ts:860-895`).

## Goals / Non-Goals

**Goals:**
- Server-lifetime trust reaches pi and server consumers. Nothing live is written to disk; the snapshot carries a count only.
- Remote bridges are trusted only when the code pi would load is byte-identical to the server's.
- One deadline (`liveQueryTimeoutMs`) bounds the whole live step. Every failure yields undecided.
- No new secret and no new credential type.

**Non-Goals:**
- Path mapping between machines. Canonical paths must be equal.
- Defending against a malicious bridge. A bridge decides only for its own pi process. The proofs defend an honest bridge against a *different folder at the same path*.
- Binding npm packages that pi installs from refs in `.pi/settings.json`. The refs are bound; the fetched bytes are not (see Risks).
- Pushing revocations to running pi processes. pi decides at startup (parent).
- Persisting any live entry or choice.

## Decisions

### D1 — One-shot authenticated HTTP request, not the gateway WebSocket
The bridge sends `POST /api/pi-trust/query` with body `{ cwd }`, where `cwd` is the bridge's `piTrustKey`. It authenticates with its existing credential: a freshly minted endpoint-bound local-credential proof on loopback, or `Authorization: Bearer <PI_DASHBOARD_TOKEN>` for a remote dashboard. It sends no session kind, because the server cannot verify one; `coverInteractive` is enforced by the bridge (D2).

The route is registered in three places:
- `ROUTE_TIERS` at `operate`, the tier of `POST /api/ws-ticket` (`route-tiers.ts:474`), so a device that may run a bridge may ask;
- `http-road-classification.ts`, in the same category as `/api/ws-ticket` (`IDENTITY_ROUTES`, `:129`; totality asserted by `http-road-classification.test.ts`);
- the identity-floor checks (not PRE_AUTH).

Local admission requires a verified proof (`kind === "proof"` from the `createLocalCredentialVerifier` path: MAC, binding, freshness, replay cache; `packages/server/src/auth/local-credential.ts:132-203`) plus loopback and no forwarding headers. Unlike ticket minting (`bridge-ticket-eligibility.ts`, which accepts the legacy raw token via `hasLocalCredential`), the legacy raw token, a browser login session and trusted-network admission do not suffice. The proof binds method+path, not the body: `cwd` is unauthenticated input, re-validated against the server's own canonical key. Canonicalization throws (relative, NUL, length) map to 400, never 500. Locality on both sides uses one shared loopback predicate (127.0.0.0/8, ::1), replacing the bridge's 4-literal check for this path.

Handler order:
1. auth;
2. per-requester rate limit;
3. body cap (8 KiB → 413) and validation;
4. server switches and deny rules;
5. cover lookup;
6. proof. Local identity answers are a map lookup and take no permit; remote digests run under a global semaphore of 4 (1 per device), excess → 429.
7. for a YOLO entry, re-check liveness after the proof is built; ended or expired → not covered.

Logged cwd and device strings are stripped of control characters.

Alternatives rejected:
- (a) a `trust_query` frame on the gateway WS: there is no connection at the first `project_trust`, and opening one early would race the identity claim and the duplicate-bridge contention logic;
- (b) a dedicated short-lived WS: needs a ticket mint (an extra remote round trip) plus an upgrade.

### D2 — When the bridge asks, under one deadline
`decideBridgeProjectTrust` becomes async. Its order:
1. store unreadable;
2. recorded pi entry;
3. activation rule;
4. snapshot cover (synchronous, keeps the parent's p95 < 20 ms);
5. **live query**.

The live query runs only if all of these hold:
- `enabled && liveQuery` in `config.json`;
- the `coverInteractive` rule allows this session;
- `!isMirrorDenied(cwd)`;
- `liveCount > 0 || isRemoteBridge`.

`isRemoteBridge` means the bridge's resolved dashboard endpoint is not loopback (`localhost` counts as loopback, `remote-registration-gate.ts:20`) and a `PI_DASHBOARD_TOKEN` is present, the same predicate under which `prepareRemoteUpgrade` mints a ticket.

"The snapshot yields no cover" means `coverSnapshot` returned no positive cover for any reason, including `identity-mismatch` (`project-trust.ts:125-134`). A shared-home remote therefore reaches the live path.

The deadline is enforced by racing, not by cooperation. The live step is `Promise.race([work, deadline])`, where `deadline` resolves to `live-timeout` after `liveQueryTimeoutMs`. Every filesystem call of the live step (key, identity stat, walker) is `fs/promises` inside `work`, including an async variant of `identityMatches`; only the parent's snapshot step stays synchronous (its hung-mount exposure is the parent's residual, see Risks). On deadline the controller aborts the `fetch` and the signal is passed into every `fs/promises` read, so no socket or walk outlives the handler. `work` uses `fetch` with `redirect: "error"` and an `AbortSignal`, then the *async* `fs/promises` proof walker, which checks `signal.aborted` after every awaited read. The `AbortController` is created per call, never at module scope (`bridge-decomposition`). After the race the handler re-checks `inst.isActive()`; a stale instance yields undecided.

Outcome mapping:
- connection refused → `live-unreachable`;
- 401/403 → `live-refused`;
- 404 → `live-unsupported`;
- 429 → `live-rate-limited`;
- abort or deadline → `live-timeout`;
- not covered → `live-not-covered`;
- 5xx, redirect, malformed body, or a covered answer missing proof fields → `live-error`.

The handler body has its own try/catch that resolves to `{trusted:"undecided"}` on every path, so it never relies on `safe()` or pi's runner.

### D3 — Server: one counted set, live entries with recorded identity
A live-entry provider in the mirror service enumerates:
- `listSessionTrust()`: new export; hook hash re-checked;
- session grants (`listGrants` filtered by `scope==="session"`, project-root re-check);
- the roots of `yolo.status()` while live and `!unscoped`, evaluated at answer time.

When a live entry is created (session trust recorded, session grant recorded, YOLO activate / addRoot / env activation), the server stats the folder and keeps `{dev, ino, birthtimeMs?}` in an in-memory map keyed `<source>\0<key>`, next to the per-entry choice. An unstatable folder gets no identity and never counts.

The listener gaps are fixed:
- `recordTrust`/`revokeTrust` session branches call the trust-changed listener;
- `recordGrant`/`revokeGrant` session branches call the grants-changed listener;
- `YoloController` gets `setChangeListener` (activate, addRoot, end, env activation) and an unref'd expiry timer that clears the session and fires the listener.

Every listener triggers a `liveCount` recompute. The snapshot is rewritten only when the count changes. Boot writes `liveCount: 0`. A stale count only causes an extra or missed query, never a wrong yes.

Server consumers (`host.isProjectTrusted`, `projectTrustSource`, the MCP view) evaluate `decidePiTrust` over durable plus live entries with no folder proof, since they observe their own folders. The MCP view therefore matches what a local *covered* session decides, meaning a dashboard-spawned headless session, or any session when `coverInteractive` is on. The folder MCP page already discloses the `coverInteractive` caveat, and its requirement is MODIFIED to name a live entry's lifetime.

Session worktree-trust keys are `path.resolve` keys and are translated through `piTrustKey` on read, exactly like the durable store (parent D2). `liveCount` is recomputed and the snapshot rewritten synchronously inside the action that changed it, before that action reports success. A failed rewrite is logged and does not fail the action: the count is advisory, and an under-count only skips a query.

When answering, the server:
1. checks `piTrustKey(cwd) === cwd` on its side, and answers not covered otherwise (symlink or `..` confusion);
2. applies `enabled`, `liveQuery` and `isMirrorDenied`;
3. finds the nearest covering entry;
4. builds the proof for the requester class (D4/D5).

### D4 — Local proof = recorded identity
A genuinely local requester gets `{key, sourceKind, dev, ino, birthtimeMs?}`, recorded at entry creation (durable entries: the snapshot values). The bridge compares them with its own stat through `identityMatches`. A re-created folder fails (`identity-mismatch`), matching the parent rule.

### D5 — Remote proof = salted digest of pi's trust-requiring resources
A paired-device requester gets `{covered:true, salt, digest}`, with no source kind and no identity. The salt is 16 random bytes. The digest is:

`HMAC-SHA256(salt, "pi-trust-live/v1\n" + cwdKey + "\n" + manifest)`

`manifest` lists every entry under the resource set pi's gate protects, sorted in code-point order. The resource set is:
- the cwd's `.pi/{settings.json, mcp.json, extensions, skills, prompts, themes, SYSTEM.md, APPEND_SYSTEM.md}` (recursive), labelled `c/<relative POSIX path>`;
- `<d>/.agents/skills` for the cwd and each ancestor (recursive) except `~/.agents/skills`, where `~` is each side's own home, labelled `a<k>/<relative path>` with `k` = levels above the cwd, starting at 0 for the cwd itself (pi checks the cwd first).

Each entry contributes, depending on what `lstat` reports:
- a file: `label \0 "f" \0 sha256(content)`;
- a directory: `label \0 "d"`;
- any other type (fifo, socket, device) → `null`.

The result is `null` when:
- the set is empty, or
- a cap (1,000 entries, 16 MiB read) is exceeded, or
- any read fails, or
- any **symlink** appears, or
- `.pi/settings.json` fails to parse, has a ref shape the walker does not recognise, or references code outside the set (a `packages` entry, or an extension/skill path resolving outside it): pi would load bytes the digest does not bind.

Symlinks fail closed because pi follows them (`existsSync`) to bytes outside the set: hashing a link string would bind nothing, and following links would open escapes and cycles. pnpm-style symlinked extension trees therefore get no remote trust (see Risks).

A server-side `null` answers not covered. On the bridge, a `null` on either side yields `identity-weak`. The bridge compares only two non-null digests; unequal → `identity-mismatch`.

The walker is `async` (`fs/promises`), takes an `AbortSignal`, and reads each file once.

The shared function is `trustResourceManifest(cwd, {home, signal})`, in a Node-only shared module. Its resource-name list is a literal, because pi does not export `TRUST_REQUIRING_PROJECT_CONFIG_RESOURCES` (only `hasTrustRequiringProjectResources` is exported from the package root). Drift is caught by a golden test that:
- extracts the array literal from the installed pi's `dist/core/trust-manager.js` and asserts set equality with our list;
- asserts that our "non-empty" verdict equals pi's `hasTrustRequiringProjectResources` for a matrix of trees, and that the manifest's entry set covers every path pi's check would consult (including `<cwd>/.agents/skills`).

Live identities are carried as decimal strings, like the parent's `PiTrustSnapshotEntry` `dev`/`ino` (`pi-trust-mirror-types.ts:42-44`), and are compared through `identityMatches`.

Why content and not a listing or a secret:
- The cycle-1 review showed a listing (names, sizes, mtimes) is copyable, and does not bind `.pi/mcp.json` content in an mtime-preserving copy.
- A secret in the dashboard dir proves only that the requester can read `~/.pi/dashboard`.
- Content equality of exactly what pi would execute is the property trust is about.

The cwd key inside the HMAC binds an answer to its path. Replaying the answer for another path fails.

### D6 — Rate limiting and observability
A fixed window allows each paired device 20 queries per 10 s and the `local` requester 200 per 10 s (dashboard fleet spawns run on the server's own machine). A global semaphore allows 4 concurrent proof computations, at most 1 per paired device. Excess requests get 429, with one log line per window. No manifest cache: hashing is bounded by the caps, and a cache adds staleness to a security decision. A new `piTrustMirror.live` block in `/api/health` carries the counters `covered | notCovered | refused | rateLimited | budgetMissed`. It is emitted under the same disclosure gate as the existing access-grant health block (`packages/server/src/access/access-health.ts`). A budget miss is server handling time above the server's effective `liveQueryTimeoutMs` for that requester class (local 300 / remote 1000 by default); the client declares no budget. These counters describe the server only. A remote bridge with a shorter timeout can log `live-timeout` for an answer the server counts as `covered`, and the Access-page copy states this. The bridge logs its own reason codes.

### D7 — Config
`PiTrustMirrorConfig` gains:
- `liveQuery: boolean` (default true);
- `liveQueryTimeoutMs: number` (default 300 local / 1000 remote, clamp 50–1000, non-finite → default). It is named apart from ask-user's `timeoutMs`, which has different zero semantics;
- `sources.yolo` (default true). It is live-only: no durable store backs it, and the parent's snapshot builder skips it.

`parsePiTrustMirror` stays tolerant. Old servers ignore the new keys.

### D8 — Consent surfaces
- The worktree-init "Trust until dashboard restarts" button and session-scope grant creation carry the existing "Also trust this folder in pi" checkbox. The choice is held in memory and dies with the entry.
- YOLO activation surfaces show a one-line disclosure while `sources.yolo` is on.
- The Access page gains a lifetime column and lists every bridge reason code.

## Risks / Trade-offs

- [YOLO default ON widens YOLO from file access to project-code execution in its roots] → operator decision; disclosed on activation and on the Access page; `sources.yolo=false`; unscoped never counts; deny rules apply; the release note is part of task 6.1.
- [A marker-less relay (`ssh -R`, `socat`) plus a shared home could make a remote peer look genuinely local and get the identity proof] → building that path requires same-user access to the dashboard host, and a coincidental dev+ino(+birth) match is also needed. Accepted and documented; the identity-floor check remains authoritative for locality. Reverse case: a legit remote over a loopback tunnel (`ssh -L`) with a shared home is classed local and fails `identity-mismatch` (fail-closed); FAQ says dial the non-loopback endpoint with a device token.
- [npm packages referenced from `.pi/settings.json` are fetched by pi, not hashed] → the reference is bound by the digest; a different fetched version on the remote machine is a residual, documented in the Access-page copy and FAQ.
- [Remote bridges, and local bridges while live entries exist, pay up to `liveQueryTimeoutMs` per start on a snapshot miss] → bounded; `liveQuery=false` on that machine opts out; a connection refusal is fast.
- [Large `.pi/` trees, or symlinked (pnpm) extension trees, exceed the caps or hit the symlink rule → remote trust unavailable] → fails closed (`identity-weak`); documented.
- [`local` rate-limit key is shared by every local pi] → 200/10 s covers fleet spawns; counters show refusals.
- [Bearer rides each remote query] → same exposure class as the existing per-connect ticket mint; TLS posture unchanged, out of scope.
- [Digest checkable offline by its requester (salt returned)] → requester is an operate-tier paired device that can already read files via API; remote answers omit source kind and identity.
- [Live entries visible on observe-tier `GET /api/access/pi-trust`] → YOLO roots already exposed in the `/api/health` access block; same tier as the durable list; documented.
- [Content read races (a file changes between the server's and the bridge's hashing)] → mismatch → undecided.
- [Local identity without a birth time is dev+ino only; inode reuse after re-create] → same residual as the parent snapshot rule.
- [Files change after both sides hashed equal, before pi loads] → same class as pi's own folder trust (pins nothing).
- [No per-root YOLO opt-out; `sources.yolo` is the switch] → operator decision; disclosed at activation.
- [Benign `.pi/settings.json` edits on one side drop remote trust] → fail-closed; documented in FAQ.
- [The parent's synchronous snapshot step can block on a hung mount before the live deadline starts] → pre-existing parent behaviour; the live step itself is fully async.
- [A remote device spawning several sessions at once is serialised to 1 proof at a time; excess → `live-rate-limited`] → fail-closed; raise the per-device permit if counters show it.
- [A trust answer pre-empts later user extensions] → unchanged from the parent; documented.

## Migration Plan

1. Ship shared, server, bridge and client together. An old bridge never queries. A new bridge against an old server gets 404 → `live-unsupported` → undecided.
2. Boot writes the snapshot with `liveCount: 0`. The snapshot `version` stays 1. Readers treat a missing or invalid `liveCount` as 0; the tolerant-reader test is blocking.
3. Rollback:
   - `piTrustMirror.liveQuery=false` works with the server down, because the bridge reads `config.json`;
   - `sources.yolo=false` disables YOLO coverage only;
   - `enabled=false` disables everything.

   Nothing live is persisted.
