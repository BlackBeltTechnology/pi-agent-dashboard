## 1. Fix the hook command

- [x] 1.1 In `.pi/settings.json`, change `worktreeInit.run.command` so `corepack enable` is best-effort: replace the leading `corepack enable && pnpm install` with `command -v corepack >/dev/null 2>&1 && corepack enable; pnpm install` (rest of the `&& …` chain unchanged). The `corepack enable` failure/absence MUST NOT abort the chain.
- [x] 1.2 Confirm the resulting `command` is still valid JSON (no unescaped quotes) and the `gate` line is unchanged.

## 2. Verify

- [x] 2.1 On a machine/shell where `corepack` is NOT on PATH (e.g. the dashboard bundled Node), run the exact `run.command` string and confirm it reaches `pnpm install` and exits 0 (given pnpm is on PATH). No `corepack: command not found` abort.
- [x] 2.2 Confirm the retry loop clears: after a successful run, the `gate` (`test ! -e node_modules/.modules.yaml || …`) exits non-zero (no re-fire).
- [x] 2.3 Sanity-check the CI/Docker path is unaffected: where `corepack` IS present, `command -v corepack` succeeds and `corepack enable` still runs.

## 3. Document

- [x] 3.1 Add a one-line known-issue note to `docs/faq.md`: Directory Initialize `corepack: command not found` under the stripped bundled Node → guard made best-effort; falls through to on-PATH pnpm. (Delegate the `docs/` write to DocScribe in caveman style per AGENTS.md.)
