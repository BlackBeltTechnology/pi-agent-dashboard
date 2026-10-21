# Design

## Context

See proposal.md (Why) for the alert counts. These constraints shape the approach:

- **Existing modelled guards.** `.github/codeql/extensions/cwd-guard.model.yml` already models these from `@blackbelt-technology/pi-dashboard-shared/cwd-guard`:
  - `isAllowedCwd` (sync);
  - `admissionAllows` / `tokenAllows` (sync predicates over an async `admitCwd` verdict);
  - `admitCwd` as a barrier on its own argument.

  Plugin routes (kb-plugin, mcp-client) use them, and their alerts stay closed. Core routes never adopted them.
- **Models are package-scoped.** A data extension can only name a function by import path. Today `within()` lives in `packages/server/src/lib/path-containment.ts`, which no model can name.
- **The local ratchet does not load the extension today.** `docs/code-quality.md` records that a run with the model pack gave identical results at the time. This was measured before any core route used a modelled guard, so the claim is unproven for this change.
- **Two kinds of tainted input per route.** A core route usually takes two tainted inputs: `cwd`, and a relative `path` joined under it. A cwd guard sanitizes only `cwd`. The joined path needs a containment guard as well.

## Goals / Non-Goals

**Goals:**
- Path-injection alerts close because CodeQL sees a modelled guard, not because they are dismissed.
- One admission semantics for core and plugin routes.

**Non-Goals:**
- Rewriting the lib sinks' signatures, or pushing guards down into lib modules. Guards stay at the route boundary.
- Closing the local≠CI coverage gap (see proposal Non-goals).

## Decisions

### D1 — Reuse `admitCwd` + `admissionAllows` for core routes; add no new cwd guard
Core routes call `await admitCwd(cwd, known, opts)` and branch on `admissionAllows(admission, cwd)`, exactly as plugin routes do. Both are already modelled.

- *Alternative:* a new sync `isKnownSessionCwd(sessionManager, cwd)` plus a new model. Rejected. It would be a second admission semantics, missing pinned dirs and main-checkout derivation, and it would need its own model and spec.
- *Cost:* routes that are sync today become async around the guard. Fastify handlers are already async.

### D2 — Move `within()` to shared and model it as a barrier guard on Argument[0]
`within(p, base)` moves to `packages/shared/src/path-containment.ts`, and `packages/server/src/lib/path-containment.ts` re-exports it so existing imports keep working. The model entry is `Member[within].Argument[0]`, `"true"`, `path-injection`.

- **Soundness caveat.** The guard is only meaningful when `base` is itself trusted: an admitted cwd, or its realpath. Treating `p` as safe for any `base` would over-sanitize. Mitigation: a repo-lint test (task 2.4) asserts that every core-route call to `within` passes a `base` derived from an admitted cwd, i.e. a variable assigned from the admission result. CodeQL cannot check this, so the lint test is the control.
- *Alternative:* model `safeRealpath`. Rejected. Realpath canonicalizes and does not contain anything.

### D3 — Spike before rollout (task group 1)
On one isolated site, `openspec-routes.ts` (1 alert, a `listAll` membership check), adopt D1 and push a throwaway branch. The CodeQL run on its PR must close that one alert. Repeat with one `within` site (D2), `office-preview.ts`.

- **Exit criteria:** both alerts are absent from the PR's analysis.
- **On failure:** stop. Run `systematic-debugging` on the model (package path / `.js` suffix variants, as `cwd-guard.model.yml` does). If it is still not closed, re-plan to bulk dismissal. The tasks after group 1 are then void.

### D4 — The local ratchet loads the same extension files
`scripts/codeql-local.mjs` passes the extension directory to `database analyze`. It uses `--additional-packs` with a tiny generated qlpack wrapper, or `--model-packs`; the spike picks whichever the pinned CLI 2.27.2 accepts. This keeps local and CI aligned for modelled sites (spec: "Modelled barrier guard suppresses on both sides").

### D5 — Triage decision table for the remaining `untriaged` entries

| Rule / area | Default disposition |
|---|---|
| `js/xss` in preview renderers (`MermaidBlock`, `DocxPreview`, `DiagramPreview`, `adoc-math`) | Verify the sanitizer path (DOMPurify / sandboxed iframe). Sanitized → `false-positive:` naming the sanitizer. Otherwise fix. |
| `js/xss` / `js/client-side-unvalidated-url-redirection` in `WhatsNewDialog`, `UsersSection`, `ToolsSection`, `CtxToolRenderer`, `login-flow.ts` | Fix: scheme allowlist (`http:`/`https:`) on hrefs, text not HTML. |
| `js/request-forgery` in `model-proxy-api.ts`, `provider-probe.ts`, `oidc-flow.ts`, `login-flow.ts` | Operator-configured endpoints → `accepted-risk:` with the config source named. A URL taken from a response body → fix. |
| `js/request-forgery` under `spike/`; `fake-oidc-issuer.ts` | Removed by `paths-ignore` (`spike/**`, `**/test-support/**`). |
| `js/shell-command-*` / `js/command-line-injection` in `shared/platform/{exec,process,spawn-runtime}.ts`, `cli.ts` | These are the spawn primitives. Fix where `shell: true` can be avoided. Otherwise `operator-authz:` (the rule allows it for these two rule ids). |
| `scripts/*.mjs` (`i18n-*`, `heap-probe`, `ab-context`) | Dev-only scripts with operator input → `accepted-risk:`. |
| `js/regex-injection`, `js/polynomial-redos`, `js/prototype-polluting-assignment`, `js/resource-exhaustion`, `js/xml-bomb`, `js/double-escaping`, `js/unvalidated-dynamic-method-call` | Fix: `escapeRegExp`, bounded quantifiers, `Object.create(null)` / key denylist, size caps. |

Every non-fix disposition is mirrored on GitHub with the same text (spec: "Baseline reasons are mirrored on GitHub").

### D6 — Dismiss last
Bulk dismissal of the residue (task group 6) runs only after the post-merge `develop` CodeQL scan. Then the open set is exactly what the modelled guards could not reach. Dismissing earlier would hide alerts the guards were meant to close, and the check would be lost.

## Risks / Trade-offs

- **[Over-sanitization via the `within` model]** A future `within(p, untrustedBase)` silences a real bug. → D2 lint test; the model comment states the precondition.
- **[Worktree tightening breaks a workflow]** An operator creates a worktree for a folder that is neither a session cwd nor pinned. → The known set includes pinned dirs and main checkouts. The `cwd_invalid` message tells the operator to pin the folder. Called out in CHANGELOG `### Changed`.
- **[Async admission adds latency to hot file routes]** → `admitCwd` limits concurrency and is already on the plugin hot path. Measure `/api/file` p50 before and after (task 3.5). Budget: +2 ms.
- **[Local≠CI drift grows]** The model loads on one side only. → D4 plus the spike verifies both sides.
- **[Dismissal is irreversible signal loss if wrong]** → D6 ordering, doubt-driven-review before group 6, and alert numbers recorded in baseline reasons for re-open on revert.

## Migration Plan

- No data migration.
- Deploy is ordinary: server restart (jiti, no build) plus a client build for the D5 client fixes.
- **Rollback:** revert the commits, then re-open every alert listed in `github-dismissed (#n, …)` reasons added by this change (`gh api -X PATCH …/alerts/<n> -f state=open`).
