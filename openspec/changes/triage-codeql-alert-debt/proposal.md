## Why

`develop` has 95 open code-scanning alerts on GitHub. Most are triaged in the local ratchet baseline but were never closed on GitHub, so the Security tab is too noisy to show anything new:

- 71 are `js/path-injection`. The baseline already marks them `operator-authz`.
- The baseline holds about 47 `untriaged` entries on other rules (XSS, request-forgery, shell/command injection, URL redirection, and a few more).

The new-alert triage on 2026-10-20 (commits `7bd6edfb4`, `97f5a59f4`) cleared the 5 new alerts and the 27 cache-poisoning residuals. It did not touch this backlog.

The path-injection backlog is mostly one pattern. The sink sits in a lib module (`git-operations.ts` ×13, `changelog-fs.ts`, `openspec-*.ts`, `grep.ts`, `canvas-settings.ts`, …). The guard sits in the calling route as an ad-hoc check that CodeQL cannot see:

- `sessionManager.listAll().some(s => s.cwd === cwd)` membership (`file-routes.ts` ×11, `openspec-routes.ts`);
- `within()` from `lib/path-containment.ts`;
- `validateCwd`.

**`validateCwd` (`git-routes.ts:1111`) checks only that the cwd exists and is a directory, not that it is a known folder.** The worktree endpoints therefore accept any directory on the host. This is a real gap that the `operator-authz` reason papers over.

## What Changes

- **Spike gate first.** Prove that a `barrierGuardModel` data extension (the `cwd-guard.model.yml` mechanism) closes a CI alert when the guard is a shared-package export used across the route→lib boundary. Prove it on one site before rolling out. If it does not close the alert, stop and re-plan (fallback: bulk dismissal with the baseline reason).
- **Shared, modelled guards.** Two guards are exported from `@blackbelt-technology/pi-dashboard-shared`:
  - a known-session/known-folder cwd admission check, which reuses `isAllowedCwd` semantics: session cwds ∪ pinned dirs ∪ their main checkout;
  - path containment, `within()` moved from `packages/server/src/lib/path-containment.ts`.

  Both are added to `.github/codeql/extensions/` as barrier guards.
- **Route sites adopt them.** Ad-hoc membership checks and `within()` call sites in core routes switch to the shared guards. No other behaviour changes, except the item below.
- **Tightening: git worktree endpoints admit the cwd.** `validateCwd` additionally requires the cwd to be admitted (known folder). A request for an unknown directory gets the existing stable `cwd_invalid` code with a new message.
- **Ignore throwaway code.** `spike/**` and `**/test-support/**` are added to `codeql-config.yml` `paths-ignore`. This removes 5 request-forgery entries under `spike/` and the `fake-oidc-issuer.ts` redirect.
- **Per-finding triage of the remaining `untriaged` entries.** Each entry is fixed in code, or re-reasoned (`false-positive:` / `accepted-risk:`) and dismissed on GitHub with the same text. No entry stays `untriaged`.
- **Residue.** Path-injection alerts that the modelled guards cannot reach are dismissed on GitHub with the baseline `operator-authz` reason. Dismissed alert numbers are recorded in the baseline as `github-dismissed (#n, …)`, so the two sides stay in sync.

## Capabilities

### New Capabilities
- `core-cwd-admission`: core (non-plugin) server routes that take a caller-supplied `cwd` admit it through the shared, CodeQL-modelled guard before any disk access. This includes the git worktree endpoints.

### Modified Capabilities
- `codeql-local-ratchet`: `paths-ignore` also excludes throwaway spike code and test-support fixtures. Barrier-guard data extensions are part of the shared configuration. Every baseline reason other than `untriaged` is mirrored by a GitHub dismissal carrying the same text.

## Impact

- **Code.**
  - `packages/shared/src/` gains the guard exports. `packages/server/src/lib/path-containment.ts` re-exports or moves to shared.
  - `packages/server/src/routes/{file,git,openspec,folder-project}-routes.ts` and the lib sinks they call change.
  - XSS / request-forgery / shell fixes land in client previews (`MermaidBlock`, `DocxPreview`, `DiagramPreview`, `WhatsNewDialog`, `UsersSection`, `ToolsSection`), `client-utils/identity/*`, and `shared/platform/{exec,process,spawn-runtime}.ts`, as triage decides.
- **Config.** `.github/codeql/codeql-config.yml` and `.github/codeql/extensions/*.model.yml` change, plus `codeql-baseline.json`.
- **Behaviour.** The only intended change is the worktree endpoints refusing unknown directories. Clients already handle `cwd_invalid`.
- **Compatibility / rollback.** No data migration. Revert the commit to roll back. Alerts dismissed by this change must be re-opened (`-f state=open`) on revert; the list is kept in the baseline reasons.
- **Not a required check.** CodeQL stays advisory in CI. The local ratchet remains the gate.

## Non-goals

- Changing the `operator-authz` policy itself, or adding login for trusted-CIDR callers.
- Fixing the CodeQL local≠CI coverage gap documented in `docs/code-quality.md`. That belongs to `harden-codeql-ratchet-followups` follow-ups.
- Dependabot dependency alerts (163). That is a separate change.

## Discipline Skills

- `security-hardening`: untrusted `cwd`/path input on file, git and openspec routes, plus the XSS / request-forgery / command-injection triage.
- `doubt-driven-review`: before the `validateCwd` tightening stands (public-API behaviour), and before each bulk dismissal (irreversible signal loss if wrong).
- `systematic-debugging`: if the spike shows the barrier model does not close CI alerts.
- `review-code`: before commit.
