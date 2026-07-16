# Tasks

Scope: **Phase 1** (lazy server resolution + tilde + `~/.pi` allowlist). Phase 2
(loose detection + unique-only fuzzy) is deferred to a follow-up change — see the
non-checkbox section at the end.

## 1. Server resolver library

- [x] 1.1 Add `packages/server/src/lib/resolve-file-mention.ts` exporting
  `resolveFileMention(mention, { cwd })` → `{ resolved: string; kind: "abs" |
  "tilde" | "relative" } | null`. Expand leading `~/` via `os.homedir()`; try
  absolute then `path.resolve(cwd, mention)`; authorize via `isAllowed` with
  anchors `[cwd, gitRoot(cwd), join(os.homedir(), ".pi")]` BEFORE `fs.stat`. The
  `~/.pi` anchor is a server constant, never from request input. → verify: 1.2.
- [x] 1.2 Unit tests for `resolveFileMention`: `~/.pi/...`→resolves under `~/.pi`;
  relative→cwd resolves; nonexistent→null; `~/.ssh/id_rsa`→null (outside `~/.pi`);
  `~/../../etc/passwd`→null (containment reject); `~user/x`→not expanded. → verify:
  tests pass.

## 2. Resolve endpoint

- [x] 2.1 Add `POST /api/file/resolve-mention` in `file-routes.ts`: body `{ cwd,
  mention }`, `preHandler: networkGuard`. Reject `cwd` not in the known-session
  set (403) BEFORE resolving (reuse the `/api/file/exists` cwd-validation, NOT its
  absolute-only probe rule). Call `resolveFileMention`; return `{ resolved, kind }`
  or `{ resolved: null }`. → verify: route test — untrusted cwd `/etc`→403 (no
  stat); junk mention→null; real repo file→resolved.

## 3. Open/preview routes honor the ~/.pi anchor

- [x] 3.1 Extend the open/preview containment (`/api/file`, `/api/open-editor`,
  preview `/api/file/raw` path) so the anchor set includes `join(os.homedir(),
  ".pi")` alongside cwd + git-root — so a resolved `~/.pi/...` path the resolve
  endpoint accepts also OPENS/previews without a 403. → verify: test — `/api/file`
  read of a `~/.pi/...` path with a project cwd succeeds; a `~/.ssh` path 403s.

## 4. Client: tilde token + resolve-on-click

- [x] 4.1 Add ONE `~/` file-token branch to `linkify-tool-output.ts` (leading
  `~/` + absolute-segment grammar, `absolute: true`, verbatim `~/…` retained). No
  other detection change. → verify: tokenizer test — `~/.pi/x.json` is ONE file
  token, `~` not orphaned; join-coverage holds; existing linkify tests green.
- [x] 4.2 `FileLink` resolves on click via `/api/file/resolve-mention` and opens
  the server-resolved absolute path across ALL three open paths — external editor,
  preview overlay, AND `canSplitOpen` (which ALWAYS routes through resolve now,
  G2; it currently short-circuits before resolve). Pass the resolved path
  directly; do NOT run `resolveLinkOrigin` on a server-resolved path. Send the
  token's processed `path` (not verbatim `text`). On a null result, render an
  INLINE not-found affordance (strikethrough/disabled) and make NO open call
  (G1). → verify: component test — click resolves + opens resolved path;
  null→inline not-found affordance, no open call; split-open path also resolves.
- [x] 4.3 On resolve-request FAILURE (network/5xx/timeout, distinct from null),
  fall back to today's client-side `resolveLinkOrigin` open; catch the rejection
  (no unhandled promise; fault-isolation preserved). → verify: test — mocked 5xx →
  client-side open path taken, not treated as absent.

## 5. Tests (folded from test-plan.md)

L1 server resolver — new `packages/server/src/lib/__tests__/resolve-file-mention.test.ts`, copy harness glue from `packages/server/src/__tests__/file-absolute-containment.test.ts` (fake HOME + containment setup):

- [x] 5.1 `~/.pi` home file resolves: `~/.pi/dashboard/worktree-init-trust.json` exists, known cwd · resolve · `{resolved under <home>/.pi, kind tilde}` (test-plan #S2).
- [x] 5.2 home outside `~/.pi` rejected: `~/.ssh/id_rsa`, known cwd · resolve · `null` (test-plan #S3).
- [x] 5.3 tilde traversal escape: `~/../../etc/passwd`, known cwd · resolve · `null` after expand+containment (test-plan #S4).
- [x] 5.4 relative resolves: `packages/server/src/routes/file-routes.ts` under cwd · resolve · resolved rooted at cwd, kind relative (test-plan #S5).
- [x] 5.5 nonexistent → null and `~alice/x.ts` not expanded (test-plan #S6, #S7).
- [x] 5.6 containment-before-stat: `fs.stat` spy asserts stat runs only after containment passes, never before (test-plan #S8).

L1 endpoint + open route — new `packages/server/src/__tests__/resolve-mention-endpoint.test.ts`, copy from `packages/server/src/__tests__/file-endpoint.test.ts` (fastify inject):

- [x] 5.7 untrusted cwd 403: `{cwd:"/etc",mention:"passwd"}`, `/etc` not a known session cwd · POST `/api/file/resolve-mention` · 403 and no `fs.stat` (test-plan #S1).
- [x] 5.8 open route honors `~/.pi`: GET `/api/file` read of a resolved `~/.pi/agent/settings.json` with a project cwd · 200; a `~/.ssh/config` read · 403 (test-plan #S9, #S10).

L1 client tokenizer — extend `packages/client/src/lib/__tests__/linkify-tool-output.test.ts`:

- [x] 5.9 tilde token: `~/.pi/dashboard/trusted-paths.json` · `tokenize()` · ONE file token, path retains `~/…`, no orphan `~`, join-coverage holds (test-plan #S11).
- [x] 5.10 no regression: `Node.js` / `math.PI` / `and/or` · `tokenize()` · no new false-positive file token from the tilde branch (test-plan #S12).

L1 client FileLink — extend `packages/client/src/components/tool-renderers/__tests__/FileLink.test.tsx` (+ `FileLink.split.test.tsx` for split):

- [x] 5.11 click resolves + opens: link for `~/.pi/agent/settings.json`, resolve mocked → resolved · click · open called with server-resolved path (test-plan #S13).
- [x] 5.12 null → inline not-found: resolve mocked → null · click · inline not-found affordance (strikethrough/disabled), NO open call (test-plan #S14).
- [x] 5.13 request failure → fallback: resolve mocked → 5xx/reject · click · client-side `resolveLinkOrigin` open taken, rejection caught, not treated as null (test-plan #S15).
- [x] 5.14 no double re-root: worktree session, resolve → absolute · click · open target equals server path exactly (test-plan #S16).
- [x] 5.15 split-open resolves (G2): cwd-relative token in split-workspace · click · routes through resolve endpoint, no client short-circuit (test-plan #S17).
- [x] 5.16 lazy render invariant: message with N mentions · mount · zero resolve calls until a click (test-plan #S18).

L3 e2e — new `tests/e2e/file-mention-resolve.spec.ts`, copy harness glue (docker port from `.pi-test-harness.json`) from `tests/e2e/directory-home.spec.ts`:

- [x] 5.17 real message with `~/.pi/agent/settings.json` in the harness · click the link · preview/editor opens the resolved home file, not a `/`-rooted 404 (test-plan #S19).

## 6. Validate

- [x] 6.1 `npx openspec validate server-side-file-mention-resolution --strict` passes.
- [x] 6.2 `npm test` green; manual (test-plan #M1): remote/tunnel click→open
  latency (one resolve round-trip) feels acceptable — subjective, post-merge.

---

## Phase 2 — deferred to a follow-up change (NOT in this change's scope)

Loose bare-basename detection + unique-only, stat-confirmed fuzzy fallback
(`git ls-files` scoped to the session tree), with batched pre-confirm to gate
prose false positives and a MODIFIED "bare `README.md` MUST NOT link" spec rule.
Tracked as future work; the Phase-2 spec requirement is labeled accordingly.
