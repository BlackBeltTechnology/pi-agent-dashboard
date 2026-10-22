# Design — triage-codeql-alert-debt

## Context

Measured on `develop` 2026-10-21/22. The analysed commit moves with every `develop` push, so task 1.2 re-measures every count and line number below at execution time. Function names are the stable anchors.

**Baseline.** `codeql-baseline.json` has 182 entries:
- 43 `untriaged`;
- 78 `js/path-injection` `operator-authz` (80 results);
- 4 `false-positive` and 3 `accepted-risk`;
- the rest `github-dismissed`.

**Threat-model mismatch.** The local analysis passes `--threat-model=remote` (`scripts/codeql-local.mjs`, `analyseLanguage`, `database analyze` argv). The CI workflow passes no threat model (`.github/workflows/codeql.yml`, `build-mode: none` plus `config-file`). With the flag removed, the same database gave local == CI exactly (`docs/code-quality.md` "Known limitation — local ≠ GitHub", cause 1). The decision recorded there on 2026-10-17 was "follow-up drops `--threat-model=remote`". The workflow runs on every push to `develop` (`codeql.yml` `on.push`).

**Open alerts.** 24 untriaged entries have no open GitHub alert on their rule and file (local-only); 19 do (CI-visible). Of the triaged non-path entries, only #436, #434 and #222 have open alerts. The other four (`GatewayTlsSection.tsx` `false-positive`, `runtime-plugin-loader.ts` `accepted-risk` ×2, `app-mount.ts` `accepted-risk`) have none.

**How `--mirror-dismissal` works** (`scripts/codeql-local.mjs` `mirrorRun`, `alertProblem`, `confirmAlerts`). It only rewrites a reason when the last recorded run meets all of these conditions:
- it analysed this snapshot;
- the tree was clean (`writeRunRecord` excludes `codeql-baseline.json` from that check);
- `headCommit` equals every named alert's analysed commit;
- every named alert is `dismissed` for the same rule and file, with one shared reason;
- the alert lines equal the recorded result lines as a multiset, and the alert count equals the entry count.

It never dismisses anything itself. When a GitHub alert is re-analysed at a newer commit, it keeps its dismissed state but its `commit_sha` moves to that commit.

**Validator.** `operator-authz:` is only valid on `js/path-injection`, `js/command-line-injection` and `js/shell-command-constructed-from-input` (`reasonError`). The seed mode (`--write-baseline`) writes every key as `untriaged` by spec ("Prune, accept and seed modes"), so "no untriaged entries" is a state this change reaches, not a lasting invariant.

## Goals / Non-Goals

**Goals** (verified by tasks, not by new requirements — see D7):
- G1: local `javascript-typescript` results equal CI's at the same commit.
- G2: no `untriaged` entry remains.
- G3: every `operator-authz:`, `false-positive:` and `accepted-risk:` entry with an open alert at the mirror commit is dismissed on GitHub and mirrored as `github-dismissed (…)`.

**Non-Goals**
- The 29 plugin-server results that `**/__tests__/**` hides on both sides (cause 2). Nothing owns that today. Task 8.5 records the gap as a GitHub issue so it is not lost.
- Closing `js/path-injection` alerts by code. That belongs to `core-cwd-admission`, which this change follows.
- Python and Actions languages.
- An automated gate that keeps G3 true after this change. A follow-up can add a check mode; `docs/code-quality.md` gains the convention (task 8.1).

## Decisions

### D1 — Align local with CI by dropping the flag

`database analyze` no longer passes any `--threat-model`. The spec delta MODIFIES "Local analysis runs on a content-addressed snapshot": the threat-model clause and the "Analysis options" scenario. Parity is verified by a task (D7).

*Alternative considered:* raise CI to the remote threat model (a `threat-models` entry in `codeql-config.yml`). The operator rejected this on 2026-10-21 (proposal option 1), in line with 2026-10-17. It would add about 24 client-code GitHub alerts to triage on both sides. D2 bounds the coverage this decision loses.

### D2 — One-pass security review of the local-only results before pruning

The local-only results only exist because of the flag. Pruning them blind could hide a real XSS, redirect or SSRF.

**Review set:** computed mechanically per result, not from the counts above. It is every result of the flag-on run at `H` (D5) with no open alert at the same (rule, file, start line), whatever its baseline reason. Lines are comparable because the run and the alerts share commit `H`. A per-file look gives a lower bound only:
- the 24 untriaged local-only entries;
- the four triaged FP/AR entries;
- at least six triaged `operator-authz` `js/path-injection` results in files with no open alert (`path-containment.ts`, `dependencies-file.ts` ×2, `workflow-schema.ts`, `shared/src/openspec-dependencies.ts` ×2);
- the surplus results in files with more results than alerts (e.g. `file-routes.ts`, 14 results vs 11 alerts).

**Procedure** (tasks 1.2, 3.1, 3.2):
1. Run the analysis with the flag still on.
2. Take every result in the review set from `last-run.json` `results`.
3. Read the source and the sink.
4. Record the verdict table in `evidence/local-only-review.md` with these columns: rule, file:line, source, sink, verdict (`true-positive` / `not-exploitable` + reason grounded in code).
   - Any sink may cite a sanitizer on the path or a fixed or validated target.
   - A CSP or sandbox boundary counts only for a sink that executes in the browser (XSS, client redirect). It never counts for a request, a parser bomb, a regex, or a resource sink.
5. Fix every `true-positive` test-first, before the flag drop.

Look at these first:
- href and redirect sinks in `packages/client-utils/src/identity/login-flow.ts`, `packages/client/src/components/packages/WhatsNewDialog.tsx`, `packages/client/src/components/settings/ToolsSection.tsx`, `packages/client/src/components/connectivity/UsersSection.tsx` and `packages/client/src/components/tool-renderers/CtxToolRenderer.tsx`;
- HTML sinks in `packages/client/src/components/preview/DiagramPreview.tsx`, `packages/client/src/components/preview/DocxPreview.tsx`, `packages/client/src/components/preview/MermaidBlock.tsx` and `packages/client/src/lib/preview/adoc-math.ts`;
- the four triaged FP/AR entries with no open alert (Context). They are probably local-only as well, and are reviewed the same way.

### D3 — Dispositions for the 19 CI-visible untriaged entries

Every **fix** row is test-first. A failing test that reproduces the flagged behaviour lands before the fix: a single-pass decode case, a guard rejection, an allowlist refusal, an argv shape, a redirect refusal, a worker timeout. A fix whose line CodeQL still reports afterwards gets a `false-positive:` / `accepted-risk:` reason that cites the fix.

| Alert | Rule | Site | Disposition | Basis |
|---|---|---|---|---|
| #169 | double-escaping | `packages/client/src/components/preview/MermaidBlock.tsx` entity decode (~:63-68) | **fix** | `&amp;` is decoded before `&quot;` and `&#39;`, so `&amp;quot;` turns into `"`. Replace the chain with a single-pass decode (one regex plus a map). |
| #374 | shell-constructed | `packages/server/src/cli.ts` `const base` in the local-proof open command | `false-positive:` | The launched URL is the loopback `base`, built from the configured port, or the origin returned by `validateOpenUrl`. The code is restricted to `^[A-Za-z0-9_-]{16,128}$` just before `openUrlInBrowser`. |
| #216 | regex-injection | `packages/server/src/lib/grep.ts` `grepWithJsScan` | **fix**, then `accepted-risk:` (MODIFIED `editor-file-search` delta) | `GET /api/grep` is `observe` tier (`packages/shared/src/route-tiers.ts:147`). `rg` is not bundled; it is found on `PATH` (`grep-routes.ts:56`, `detectRipgrep`), and the Docker image installs it. Without `rg`, the fallback compiles the caller's pattern on the main thread. `REGEX_LINE_CAP` = 2000 (`grep.ts:80-85`) does not stop exponential backtracking: `(a+)+$` on about 30 characters is enough. Operator decision 2026-10-22 (option B): the fallback scan runs in a `worker_thread` terminated after `RG_TIMEOUT_MS` (10 s). A timeout answers HTTP 504 `{ success: false, error: "search timed out" }` (operator decision 2026-10-22); the client already shows any non-success as no results (`grep-api.ts:24-31`). The bound also covers patterns `rg` rejects (e.g. backreferences), which `runGrep` hands to the fallback (`grep.ts:250-256`). Regex semantics are unchanged, so "Regexp toggle switches the matcher" still holds. CodeQL still sees `new RegExp(input)`, so the reason cites the worker bound. |
| #19 | request-forgery | `packages/server/src/package/provider-probe.ts` `fetch(req.url)` (two sites) | **fix**, then `accepted-risk:` | The URL comes from an operator-configured provider base. Its sources are the `POST /api/providers/test` body (`packages/server/src/routes/provider-routes.ts:573-608`, `operate` tier at `packages/shared/src/route-tiers.ts:430`) and saved `providers.json` (`provider-routes.ts:53`, `custom-provider-discovery.ts:55`). It is never read from a response body (open finding 2). **Leak:** both `fetch` calls follow redirects by default, and Node forwards the custom `x-api-key` header (the stored provider key, `buildProbeRequest`) to a cross-origin redirect target. Fix: `redirect: "error"` on both probe fetches, so a redirecting provider reports a probe failure that asks for the final URL. Test-first: the redirect target receives no request. The residual reason: operator-configured target, `operate` tier, no redirects. |
| #152, #153 | prototype-polluting-assignment | `packages/server/src/pi/resource-entry-ownership.ts` `clearOwnedEntry` | `false-positive:` | The outer index is `projectKey(cwd) = path.resolve(cwd)` (`:35-37`), which is always an absolute path and never `__proto__`. The inner `key` is `TYPE_TO_KEY[type]` from the only caller (`packages/server/src/pi/resource-activation-toggle.ts:190`, `:432-440`), and `validate` (`isValidType`, `:136`) restricts `type` to four literals first. |
| #31, #245, #32 | command-line-injection | `packages/shared/src/platform/exec.ts` `execSync` / `execFileSync` / `spawn` wrappers | trace all sources, fix, then reason | One key per wrapper line covers **every** caller, so a reason cannot be per caller. Task 2.2 lists every source of every code flow on the alert (GitHub `instances` / SARIF `codeFlows`) in `evidence/exec-wrapper-flows.md`. Each source that does not come from an `operate`-tier route or the operator's own config/CLI is fixed at its caller, test-first. Only once every remaining source is operator-controlled is the key reasoned `operator-authz:`, naming the routes and CLI. Otherwise it stays blocking. |
| #27 | shell-from-environment | `packages/shared/src/platform/exec.ts` `spawn` | same trace, then `accepted-risk:` | Same trace and same fix-first rule. `operator-authz:` is not valid on this rule, so the remaining-sources reason is `accepted-risk:` listing them. |
| #30 | shell-constructed | `packages/shared/src/platform/process.ts` `findPortHolders` | **fix** | Return `[]` unless `Number.isInteger(port)` and 1 ≤ port ≤ 65535, then interpolate the checked integer. The string `exec` seam (`ExecFn`) and the existing tests stay as they are. If CodeQL still reports the guarded line, reason it `false-positive:` and cite the guard. |
| #274–#277 | shell-constructed | `packages/shared/src/platform/spawn-runtime.ts` `cliEntry` / `shim` | `false-positive:` | `binDir` is the resolved runtime directory (`rt.nodeBinDir`). Script and shim names are literals. |
| #345 | server-side redirect | `packages/shared/src/test-support/fake-oidc-issuer.ts` `redirect` | **fix**, then `false-positive:` if still reported | `allowed` is an unanchored `startsWith` over the caller's `redirectUriPrefixes` (`:191`). A prefix like `http://127.0.0.1:5000` therefore admits `http://127.0.0.1:50000…` or `…@evil`. Fix: parse both URLs and require the same origin plus a path-segment boundary (open finding 3: same-origin fix). The bind host (`:155`) does not matter after that. The Electron copy under `packages/electron/resources/server` is git-ignored build output (`.gitignore:27`). |
| #167 | incomplete-sanitization | `scripts/ab-context/analyze.mjs` table row (~:40) | **fix** | Use `replaceAll("|", " | ")`. The sink is `console.log` of a padded text table, not markdown. The rule only flags first-occurrence replacement. |
| #28, #29 | shell-from-environment | `scripts/i18n-parity.mjs` (~:30), `scripts/i18n-migrate-auto-keys.mjs` (~:20) | **fix** | `execFileSync` argv (`find …`, `grep -rl …`) with no shell. The old `2>/dev/null \|\| true` becomes a try/catch that returns today's empty result. |

Each reason text states its basis in one line, and the same text is used as the GitHub dismissal comment.

### D4 — Already-triaged entries with open alerts

- #436, `packages/server/src/auth/auth-plugin.ts`. Task 2.1 re-verifies the `false-positive:` basis where the OAuth state's `returnUrl` is encoded.
- #434, `packages/server/src/routes/local-proof-routes.ts`. `sanitizeReturnUrl` sits at the sink.
- #222, `packages/shared/src/skill-block-parser.ts`. `SKILL_BLOCK_RE` is anchored.

All three are mirrored in D5.

### D5 — Dismiss and mirror before any code commit, at the analysed SHA

The mirror binds to the commit GitHub analysed, so it runs **first** in the worktree.

`H` is the `most_recent_instance.commit_sha` shared by the open `develop` alerts. It is read with `gh api …/code-scanning/alerts?ref=refs/heads/develop&state=open` at execution time, and it is not `develop` HEAD.

Preconditions (refuse and stop otherwise):
- the open alerts share one SHA. If they don't, an analysis is still running; wait and re-read.
- `git merge-base --is-ancestor` holds for the merge commits of `core-cwd-admission` **and** `core-file-cwd-admission` against `H`. Those changes close `js/path-injection` alerts by code, so their residue must not be dismissed before they land (`dependencies.yaml`).
- the worktree is clean, **including untracked files**. `writeRunRecord` only excludes `codeql-baseline.json`. Evidence files (`evidence/*.md`) are therefore drafted outside the tree (`$TMPDIR`) during D5 and copied in after the mirror commit.

Steps:
1. Check out `H` detached.
2. Run the analysis.
3. Run `--triage` for the new D3 reasons. The baseline is excluded from the clean check.
4. Build the residue list. This is the doubt-review gate (open finding 6):
   - every triaged entry with open alerts at `H`;
   - grouped per file, as rule, file, lineHash, count, alert numbers, reason;
   - covering the `js/path-injection` entries left after `core-cwd-admission`, the D3 non-fix entries, and D4.
5. Dismiss each alert on GitHub. The comment is `<reason> — See change: triage-codeql-alert-debt`; the GitHub reason is `false positive` for `false-positive:` entries and `won't fix` for the rest.
6. Run `--mirror-dismissal` per entry.
7. Return to the branch. Apply the baseline diff (reason text only, keys unchanged) as a patch on the branch's baseline, which may be newer than `H`, and commit it as the first commit. If a key the patch touches changed on `develop` after `H`, the patch conflicts. That is fail-closed: re-read `H` and repeat.

Any refusal is fail-closed:
- an alert count different from the entry count;
- lines that differ because the flag-on run carries extra results on a CI-visible key;
- a commit mismatch.

The entry stays unmirrored and goes to `evidence/residue.md`. A flag-on refusal cannot be retried before merge, because `H`'s script still carries the flag. Those entries are retried after the merge at the merge commit's analysed SHA, as a manual-only task that `ship-change` defers. G3 is met then, for those entries only. An open alert that maps to no baseline key blocks the change (open finding 5).

### D6 — Order inside the branch

1. Mirror commit (D5).
2. Test-first fixes (D2 true-positives and the D3 fixes).
3. Flag drop, with its CLI test flipped first.
4. Re-run, then `--prune`, then `--check-baseline-diff origin/develop`. Removals may only be:
   - D2 local-only keys;
   - D3 fixed keys;
   - keys already stale at `H` (no result in the D5 run). Those are closed by `core-cwd-admission` / `core-file-cwd-admission` if those changes did not prune them; this is listed in `evidence/residue.md`.

   Any other removal stops the change.
5. G2 and G3 verification, then docs.

### D7 — Goals stay out of the spec

"No untriaged entries" contradicts the seed mode's all-`untriaged` output. "Triaged entries are mirrored" is a fact about GitHub that no tool enforces, and it is only checkable after an analysis. Neither belongs in `codeql-local-ratchet` as a requirement. Local == CI parity (G1) is the same kind of fact: it needs a live GitHub analysis with a matching pack version. Parity also says nothing about coverage both sides lack (cause 2). All three become verification tasks plus a documented convention in `docs/code-quality.md`. The `codeql-local-ratchet` delta keeps only the MODIFIED analysis requirement (D1), and `editor-file-search` gains the #216 delta.

## Risks / Trade-offs

- **Local coverage of `fetch`-response sources is lost** (the accepted cost of D1). D2 bounds it to one reviewed snapshot. New client code that renders server strings is covered by review and the CSP from now on.
- **Wrong dismissal hides a real bug.** Mitigations: the doubt-review gate on the residue list (D5 step 4), and every comment names the change. **Rollback:** list alerts whose `dismissed_comment` contains `triage-codeql-alert-debt`, re-open them (`PATCH …/alerts/<n>` with `state=open`), and revert the mirror commit.
- **`develop` is re-analysed between D5 steps 2 and 6.** The mirror refuses with a commit mismatch. Re-read `H` and repeat; dismissals are idempotent.
- **#216 worker cost:** each fallback search (hosts without `rg` only) spawns a worker thread. A search that hits the 10 s timeout returns 504 instead of partial matches.
- **G3 can decay after this change**, because no gate enforces it (Non-Goal).
- **Flag rollback:** re-add the flag and revert the prune commit. GitHub is unaffected.
