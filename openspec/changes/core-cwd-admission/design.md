# Design

## Context

See proposal.md (Why) for counts. Constraints, with citations:

- **The shared cwd guard already exists** in `packages/shared/src/cwd-guard.ts`:
  - `admitCwd(cwd, known, opts)` (`:405`) is async and returns an `Admission`: `admit` (with a live `AdmissionToken`), `refuse`, or `indeterminate`.
  - `admissionAllows(admission, cwd)` (`:187`) is true iff the admission is `admit` and its token is live and bound to `cwd`.
  - `releaseAdmission(token)` (`:167`) ends the token.
  - Plugin routes release on reply close (`packages/server/src/routes/folder-project-routes.ts:84`) or in a `finally` (`addons-routes.ts:96`).
  - Admitting a non-missing cwd derives its main checkout, which spawns read-only git probes under it (`decideAdmission` → `derive`).
  - `indeterminate` → routes answer 503 (`folder-project-routes.ts:65-80`).
- **Model file and loading.** `.github/codeql/extensions/cwd-guard.model.yml` has a `barrierGuardModel` block (4-tuples) and a `barrierModel` block (3-tuples).
  - The directory has no `qlpack.yml`.
  - `.github/workflows/codeql.yml` references only `config-file:` and has no `packs:` input.
  - `scripts/codeql-local.mjs` passes no `--model-packs` / `--additional-packs`.
  - **It is therefore unverified whether CI has ever loaded this model.** `docs/code-quality.md` records "identical results" with and without it. The spike must establish loading.
- **Existing core guards (unchanged).**
  - `file-routes.ts` gates on live-session membership at 6 sites (`:158, :344, :385, :480, :884, :1143`). Its unknown-cwd verdict re-runs the shared guard (`openspec/specs/plugin-cwd-admission/spec.md:152`, `packages/server/src/access/cwd-verdict.ts`).
  - `validateCwd` (`git-routes.ts:1111`) is used by ten `/api/git/*` endpoints (`git-routes.ts:242–653`).
- **Two containment helpers with different semantics.** `within(p, base)` (`packages/server/src/lib/path-containment.ts:54`) is lexical and uses `path.relative`. `isPathInside` (`packages/shared/src/path-containment.ts:23`) normalises and case-folds. ~10 non-route modules call `within`.
- **Ratchet modes.** `--triage` rewrites only `untriaged` reasons and refuses any other (`scripts/codeql-local.mjs:839-846`). `operator-authz:` is valid only on `js/path-injection`, `js/command-line-injection` and `js/shell-command-constructed-from-input` (`scripts/codeql-local.mjs:60,128-140`).

## Goals / Non-Goals

**Goals:**
- Alerts close because CodeQL sees a sound, modelled guard.
- One admission semantics for core and plugin routes.
- The baseline and GitHub agree.

**Non-Goals:** see proposal. In addition: no lib-module signature changes. Guards sit at the route boundary.

## Decisions

### D1 — Core routes use `admitCwd` + `admissionAllows`
Each covered route does the following:

```
admission = await admitCwd(cwd, known)
indeterminate → 503
!admissionAllows(admission, cwd) → refuse
```

Then it passes the admitted cwd value (not the raw request value) to the lib, and calls `releaseAdmission(admission.token)` in a `finally`. Refusal keeps each route's current status and body:

- file routes keep their unknown-cwd verdict flow;
- git routes return `cwd_invalid` with a not-a-known-folder message.

`validateCwd` keeps its existence/kind checks *first*, so the missing / not-a-directory messages stay unchanged, then admits.

- **Widening accepted** (operator, 2026-10-20). Known folders are session cwds ∪ pinned dirs, plus linked worktrees / main checkouts of those.
- *Alternative rejected:* a new narrow live-session membership guard. It would be a second semantics plus a second model.
- **Read-only probes.** Admission's own read-only canonicalization and git probes run before the route's operation; that is inherent to `admitCwd`. The spec forbids the route's *operation* (the `git worktree add`, the read or write), not the guard's probe.

### D2 — New `admissionContains(admission, p)`, modelled; `within` untouched
Added to `cwd-guard.ts`. It is true iff:

- `admissionAllows(admission, admission.cwd)` holds; and
- `p`, after `path.resolve`, lies inside the admission's canonical cwd (component-wise, `isPathInside` semantics).

Routes canonicalize the joined path *after* the check, then re-check realpath containment with the same helper on the realpath. The model adds a 4-tuple to the `barrierGuardModel` block for `Member[admissionContains].Argument[1]`, with and without the `.js` suffix.

- **Why not model `within`.** Its base is unconstrained, so modelling it would over-sanitize every caller, including ~10 non-route modules. `admissionContains` takes the admission object, so its base is admitted by construction. No lint is needed.
- **Known residue.** A sink that realpaths the *raw* joined path before any check stays flagged. The spike measures whether reordering (check lexically, then realpath, then re-check) clears it.

### D3 — Spike first (group 1), on `openspec-routes.ts` (one session-membership site)
1. Establish model loading for **both** runners. Candidates:
   - a model pack: add `qlpack.yml` with `library: true` and `extensionTargets: codeql/javascript-all`, and reference it via the codeql-action `packs:` input or the config's `packs:`;
   - versus relying on auto-load.

   Record the codeql-action version and the source of the mechanism in this design.
2. Adopt D1 + D2 on the site. The PR's CodeQL analysis and the local ratchet must both drop that site's result.

**On failure:** run `systematic-debugging`; if still unresolved, re-plan to bulk dismissal (groups 2–3 void).

### D4 — Local ratchet loads the same model pack
`codeql-local.mjs` passes `--additional-packs <dir>` / `--model-packs` pointing at a pack. If the repo pack from D3 is not directly usable, the script generates a wrapper under `$TMPDIR/pi-codeql/<repo-hash>/model-pack/`, never in the working tree, so the snapshot id is unaffected.

- The pack's `codeql/javascript-all` dependency must resolve from the pack cache. If it doesn't: `CODEQL SKIPPED: model pack unavailable`, exit 0, and no `--download`.
- Re-measure local vs CI multiset equality before and after (`docs/code-quality.md` protocol). Growth of the unmatched share by > 5 % stops the change for a decision.

### D5 — Triage decision table

| Entries | Disposition |
|---|---|
| `js/xss` in preview renderers (`MermaidBlock`, `DocxPreview`, `DiagramPreview`, `adoc-math`) | Sanitizer present → `false-positive:` naming it. Otherwise fix. |
| `js/xss`, `js/client-side-unvalidated-url-redirection` (`WhatsNewDialog`, `UsersSection`, `ToolsSection`, `CtxToolRenderer` ×2, `client-utils/identity/login-flow.ts`) | Fix: one shared `http:`/`https:` href allowlist; untrusted text rendered as text. |
| `js/request-forgery` (`model-proxy-api.ts` ×2, `provider-probe.ts`, `oidc-flow.ts`, `login-flow.ts`) | Operator-configured endpoint → `accepted-risk:` naming the config source. A URL taken from a response body → fix. |
| `js/request-forgery` `scripts/heap-probe.mjs`; `js/incomplete-sanitization` `scripts/ab-context/analyze.mjs` | Dev-only script, operator input → `accepted-risk:`. |
| `js/request-forgery` under `spike/identity-login-plane/` (×4) | Removed by `paths-ignore: spike/**`. |
| `js/server-side-unvalidated-url-redirection` `packages/shared/src/test-support/fake-oidc-issuer.ts` | Stays analyzed (it is vendored into the Electron resources). Test fixture, loopback only → `accepted-risk:`, or fix with a same-origin check. |
| `js/shell-command-constructed-from-input` (`shared/platform/spawn-runtime.ts` ×4, `process.ts`, `server/src/cli.ts`), `js/command-line-injection` (`shared/platform/exec.ts` ×3) | Fix where argv form works. Else `operator-authz:` (valid for these two rules). |
| `js/shell-command-injection-from-environment` (`shared/platform/exec.ts`, `scripts/i18n-parity.mjs`, `scripts/i18n-migrate-auto-keys.mjs`) | `operator-authz:` is invalid here. Fix (argv form), or `accepted-risk:` for the two dev scripts. |
| `js/regex-injection` (`server/src/lib/grep.ts`, `hermes-memory-plugin/.../settings-model.ts`), `js/prototype-polluting-assignment` ×2 (`resource-entry-ownership.ts`), `js/resource-exhaustion` ×2 (`ThinkingBlock.tsx`, `useGrammarCheck.ts`), `js/xml-bomb` + `js/double-escaping` (`MermaidBlock.tsx`), `js/unvalidated-dynamic-method-call` (`worktree-init-store.ts`) | Fix: `escapeRegExp`, key denylist / `Object.create(null)`, size caps, method allowlist. |

### D6 — Mirror, then dismiss last; archive after
- **`--mirror-dismissal <rule> <file> <lineHash> --alert <n> --dismissed-reason <r>`.** It rewrites one triaged entry's reason to `github-dismissed (#n, <r>): <original text>`. It keeps the count, refuses an `untriaged` entry, and re-binds the last-run record the way `--triage` does.
- **Residue dismissal.** It runs after merge and after the post-merge `develop` scan completes. The open set is diffed by **analysis id** (pre-merge vs post-merge), so concurrent merges cannot pollute the mapping. Every dismissal comment contains `triage-codeql-alert-debt`.
- **Archive after dismissal.** Archive (`ship-change`) only after group 6, so the "mirrored" spec is never archived while it is false.

## Risks / Trade-offs

- **[Widening admits more paths to file/openspec routes]** → Operator-accepted. Same set plugin routes already use; disclosed in CHANGELOG.
- **[Tightening blocks git on an unpinned, session-less repo]** e.g. orphan-cleanup of a worktree whose repo was unpinned. → The not-a-known-folder message says "pin the folder". The spec scenario covers it.
- **[Admission→operation race]** A folder unpinned between admission and spawn. → `accepted-risk`: the token is live only for the request.
- **[Async admission on the `/api/file` hot path]** `admitCwd` realpaths every known folder per request (cost grows with session count). → Task 2.6 measures with 1 and 30 sessions: warm-up 20, median of 200, same host. Budget: +2 ms at 30 sessions.
- **[The model is not loaded by CI today]** → D3 establishes loading before anything else.
- **[Dismissal is irreversible signal loss if wrong]** → D6 ordering, doubt-review before 6.3, change id in every comment.

## Migration Plan

- No data migration.
- Deploy: server restart (jiti), plus a client build for the D5 client fixes.
- **Rollback:**
  1. Revert the commits.
  2. Re-open every alert dismissed by this change: `gh api "repos/{owner}/{repo}/code-scanning/alerts?state=dismissed&per_page=100" --paginate -q '.[]|select(.dismissed_comment|test("triage-codeql-alert-debt"))|.number'`, then `-X PATCH … -f state=open` for each.
  3. The dismissal comments, not the reverted baseline, are the durable record.
