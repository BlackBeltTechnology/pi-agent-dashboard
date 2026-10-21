> **STUB — not yet planned.** Run `plan-proposal` on this change before implementation. Depends on `codeql-model-pack-and-mirror` (`--mirror-dismissal`, model loading) and runs after `core-cwd-admission` (the residue is what that change cannot close).

## Why

After the 2026-10-20 triage (`c1d6f7173`, `ce26933f3`), `codeql-baseline.json` still holds about 47 `untriaged` entries on non-path rules: XSS, request-forgery, shell/command injection, URL redirection and a few more. Many triaged entries (`operator-authz`, `false-positive`, `accepted-risk`) have open GitHub alerts that were never dismissed, so the Security tab cannot show anything new.

## What Changes

- Fix or reason every `untriaged` entry, using the same text on GitHub.
- After the post-merge scan of `core-cwd-admission`, dismiss the remaining residue. Mirror each dismissal into the baseline with `--mirror-dismissal`. Every dismissal comment names this change, so a revert can re-open them.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `codeql-local-ratchet`: draft deltas "Baseline reasons are mirrored on GitHub" and "No untriaged baseline debt" in `specs/`.

## Impact

TBD at planning.

## Open findings carried from doubt-review cycles 1–2 (resolve during planning)

1. **`operator-authz:` scope.** It is valid only on `js/path-injection`, `js/command-line-injection` and `js/shell-command-constructed-from-input` (`scripts/codeql-local.mjs:60,128-140`). The three `js/shell-command-injection-from-environment` entries (`shared/platform/exec.ts`, `scripts/i18n-parity.mjs`, `scripts/i18n-migrate-auto-keys.mjs`) need a fix or `accepted-risk:`.
2. **Request-forgery triage.** Fix first wherever the URL can come from a response body: `model-proxy-api.ts` ×2, `provider-probe.ts`, `oidc-flow.ts`, `login-flow.ts`. `scripts/heap-probe.mjs` is unassigned so far.
3. **`fake-oidc-issuer.ts`.** It is vendored into the Electron resources. Prove it is loopback-only, or fix it with a same-origin check. Do not path-ignore it.
4. **No phantom rule.** There is no `polynomial-redos` entry in the untriaged set.
5. **Residue mapping.** Map residue by baseline key `(rule, file, lineHash)`, not by the open-set diff. Require the post-merge scan's head SHA to equal the merge commit. List unmapped new alerts as blocking, not as residue.
6. **Bounded residue.** Enumerate every `js/path-injection` file and its disposition before any dismissal. That includes `verified-read.ts`, `pi-installs/*`, `platform/git.ts`, `lib/path-containment.ts`, `lib/grep.ts` and `browse.ts`. Make the doubt review a gate on that list.
7. **Archive order.** Archive only after the dismissals, so the "mirrored" requirement is never archived while it is false.
8. **Tests first.** Write tests first per fix: an href allowlist unit test, an argv spawn matrix on the CI OS matrix, and so on.
