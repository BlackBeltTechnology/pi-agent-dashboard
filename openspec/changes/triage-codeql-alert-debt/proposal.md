> Planned 2026-10-22 (plan-proposal: 3 doubt-review cycles, same-model + cross-model). `codeql-model-pack-and-mirror` has landed (#1011): `--mirror-dismissal` and local model loading exist. This change runs after `core-cwd-admission` and `core-file-cwd-admission` (the residue is what those changes cannot close; design D5 checks that both merges are ancestors of the mirror commit).

## Why

After the 2026-10-20 triage (`c1d6f7173`, `ce26933f3`) and the #1011 merge, `codeql-baseline.json` holds 182 entries, **43 of them `untriaged`** (re-measured 2026-10-21, `develop` `fa227a300`). Many triaged entries (`operator-authz`, `false-positive`, `accepted-risk`) have open GitHub alerts that were never dismissed, so the Security tab cannot show anything new.

**24 of the 43 untriaged entries never exist on GitHub.** The local script passes `--threat-model=remote` (`scripts/codeql-local.mjs:771`), CI passes none. Those 24 are client code sourced from `fetch(...)` responses: all 8 `js/xss`, all 6 `js/client-side-unvalidated-url-redirection`, 5 of 6 `js/request-forgery`, `xml-bomb`, both `resource-exhaustion`, `unvalidated-dynamic-method-call`, and the `settings-model.ts` `regex-injection`. They have no alert to dismiss, so "same text on GitHub" cannot hold for them. `docs/code-quality.md` ("Known limitation — local ≠ GitHub") recorded the gap and the 2026-10-17 decision to drop the flag; no change ever did it.

The #1011 spike (`openspec/changes/archive/2026-10-21-codeql-model-pack-and-mirror/evidence/spike.md`) also shows that the fixed cwd-guard model suppresses only guarded `isAllowedCwd` / `isPortableProjectName` sinks and closed **no** baseline entry. All 78 `operator-authz` `js/path-injection` entries (80 results; 71 open alerts across 21 files on GitHub) remain residue.

## What Changes

- **Align local with CI first.** Drop `--threat-model=remote` from local `database analyze` (MODIFIED delta in `specs/codeql-local-ratchet/spec.md`). Re-run the analysis and `--prune` the entries that disappear. Verify local == the GitHub analysis at the same commit SHA for `javascript-typescript` (the parity record in `docs/code-quality.md`).
- Fix or reason every remaining `untriaged` entry (19 CI-visible today, 0 local-only expected after alignment), using the same text on GitHub.
- Mirror the triaged entries that are already open on GitHub and have no dependency on `core-cwd-admission`: `js/server-side-unvalidated-url-redirection` in `auth/auth-plugin.ts` (#436) and `routes/local-proof-routes.ts` (#434), and `js/polynomial-redos` in `skill-block-parser.ts` (#222).
- Dismiss the residue left after `core-cwd-admission` has merged and been analysed, on GitHub, at an analysed `develop` SHA and before any code commit in the branch (`--mirror-dismissal` binds to the analysed commit; design D5). Mirror each dismissal into the baseline. Every dismissal comment names this change, so a revert can re-open them.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `codeql-local-ratchet`: MODIFIED "Local analysis runs on a content-addressed snapshot" (no `--threat-model` option). Local == CI parity, "no untriaged entries" and "triaged entries are mirrored on GitHub" are change goals verified by tasks, not requirements (design D7).
- `provider-connection-test`: MODIFIED "Server exposes POST /api/providers/test": the probe does not follow redirects (design D3 #19: a redirect forwarded the stored `x-api-key`).
- `editor-file-search`: MODIFIED "Server SHALL provide a content-search endpoint": the in-process fallback runs off the main thread with a 10 s bound and answers 504 on timeout (design D3 #216, a ReDoS reachable at `observe` tier).

## Impact

- `packages/server/src/lib/grep.ts` + `grep.test.ts` (#216 fallback). `scripts/codeql-local.mjs` (analyze argv), its CLI tests (`scripts/__tests__/codeql-local-cli.test.mjs` "Analysis options" case), `codeql-baseline.json`.
- `docs/code-quality.md`: "Known limitation — local ≠ GitHub" (cause 1 closed, parity numbers) and the analysis-options text. Write through DocScribe.
- Fix sites TBD at planning (the 19 CI-visible entries).
- Rollback: re-add the flag and revert the baseline prune commit. GitHub dismissals re-open by the change name in their comments.

## Open findings carried from doubt-review cycles 1–2 (resolve during planning)

1. **`operator-authz:` scope.** It is valid only on `js/path-injection`, `js/command-line-injection` and `js/shell-command-constructed-from-input` (validator `reasonError`, `scripts/codeql-local.mjs:141`). The three `js/shell-command-injection-from-environment` entries (`packages/shared/src/platform/exec.ts` #27, `scripts/i18n-parity.mjs` #28, `scripts/i18n-migrate-auto-keys.mjs` #29) need a fix or `accepted-risk:`.
2. **Request-forgery triage.** Only `packages/server/src/package/provider-probe.ts` (#19) is CI-visible. Its URL never comes from a response body, but redirects forward the stored `x-api-key`: fix with `redirect: "error"` (design D3). `model-proxy-api.ts` ×2, `oidc-flow.ts`, `login-flow.ts` and `scripts/heap-probe.mjs` are local-only and see finding 9.
3. **`fake-oidc-issuer.ts`** (#345, `js/server-side-unvalidated-url-redirection`). It is vendored into the Electron resources. Prove it is loopback-only, or fix it with a same-origin check. Do not path-ignore it.
4. **No phantom rule.** There is no `polynomial-redos` entry in the untriaged set. The `false-positive` `skill-block-parser.ts` entry has open alert #222, so it is a mirror candidate.
5. **Residue mapping.** Map residue by baseline key `(rule, file, lineHash)`, not by the open-set diff. Require the post-merge scan's head SHA to equal the merge commit. List unmapped new alerts as blocking, not as residue.
6. **Bounded residue.** Enumerate every `js/path-injection` file and its disposition, taken from the open alerts at the mirror commit, before any dismissal (21 files carry open alerts today). Make the doubt review a gate on that list (design D5 step 4).
7. **Archive order.** Archive only after the dismissals, so the "mirrored" requirement is never archived while it is false. Resolved by design D5: the dismissals happen before the merge.
8. **Tests first.** Write tests first per fix: an href allowlist unit test, an argv spawn matrix on the CI OS matrix, and so on. The flag removal flips the existing "Analysis options" CLI test first.
9. **Do not prune blind.** Dropping the flag removes the local gate's only coverage of `fetch`-response sources, which is a deliberate signal loss already decided on 2026-10-17. Before the prune commit, review the 24 local-only results once (`security-hardening`). Fix any true positive (e.g. a server-supplied href/redirect in `login-flow.ts`, `WhatsNewDialog.tsx`, `ToolsSection.tsx`) instead of letting it fall out of the baseline. Record the review outcome in `evidence/local-only-review.md` (design D2).
10. **Re-measure, don't assume.** The documented cause (2026-10-17) attributed 29 local-only results to the flag; 24 remain. Confirm after the flag drop that local-only == 0. Any survivor is a new gap: block, don't triage it.
11. **Plugin-server coverage gap (out of scope).** `docs/code-quality.md` cause 2: 29 plugin-server results are hidden on BOTH sides by `**/__tests__/**`. "No untriaged debt" will pass without them. This change does not close that gap. No change owns it today, so the implementation files a GitHub issue for it (design Non-Goals).

## Discipline Skills

- `security-hardening`: XSS, request-forgery and command-injection triage fixes; the one-pass review of the 24 local-only results before they are pruned (finding 9).
- `doubt-driven-review`: before the flag drop + prune (removes local coverage) and before the bulk residue dismissal (irreversible signal loss if wrong).
- `review-code`: before commit.
