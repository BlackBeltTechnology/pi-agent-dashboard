---
session: 019f1481
week: 2026/W27
type: development
model: "@fast"
premium: false
premium_reason: ""
upgrade_status: n/a
openspec_changes: [guard-client-fetch-json]
proposal_excerpt: "When a user opens the `+Worktree Session` dialog (`WorktreeSpawnDialog`), it loads its prerequisites with three parallel GETs — `fetchWorktrees`, `fetchGitHead`, `fetchBranches` in `packages/client/src/lib/git-api.ts`…"
---

# How we did it: Guard client fetch helpers against non-JSON responses — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The user kicked off with a single slash command:

```
/skill:openspec-apply-change guard-client-fetch-json
```

The **real objective**, spelled out in the change proposal, was a hardening job: the
client `lib/*-api.ts` helpers parsed `res.json()` on responses that could legitimately
be non-JSON (a proxy 504 HTML page, a gateway timeout). When the `WorktreeSpawnDialog`
fired its three parallel GETs and one came back as an HTML error page, `.json()` threw
an opaque `SyntaxError: Unexpected token <` instead of a readable `HTTP 504 Gateway
Timeout`. The task: introduce a shared guarded `fetchJson` helper, migrate every
unguarded `.json()` call to it, **without** breaking the helpers that deliberately read
JSON from non-2xx status-branching responses (checkout 409, worktree-create union).

The only steering that followed was a one-liner — `use ship-change skill` — to carry the
finished change all the way to a merged PR.

## 2. TL;DR playbook

1. **Fire the apply skill on the pre-written change**: `/skill:openspec-apply-change guard-client-fetch-json`. It reads `tasks.md` + `proposal.md` and works the 12 tasks in order.
2. **TDD the helper first** — write `fetch-json.test.ts`, confirm it fails (module missing), then create `fetch-json.ts` with `ApiHttpError`, `fetchJson<T>` (guards `res.ok` **and** `content-type`), and `fetchJsonResponse<T>` (content-type guard **only**, returns `{res, json}`).
3. **Read the server before migrating** — grep `git-routes.ts` to learn which endpoints return non-2xx JSON. This is the decision that splits `fetchJson` (throw-on-failure) from `fetchJsonResponse` (status-branching).
4. **Migrate by intent, not blanket sed** — throw-on-failure helpers → `fetchJson`; union/409 helpers → `fetchJsonResponse`; leave `res.ok`-guarded or text/plain helpers untouched (Surgical Changes).
5. **Verify in three axes** — client lib suite, `tsc --noEmit` (root, the one CI uses), Biome on changed files. Separate *your* errors from pre-existing ones by grepping.
6. **Default the helper generic to `any`** to avoid ratcheting up 36 new `noExplicitAny` warnings — mirror `Response.json()`'s own `Promise<any>` return, then drop `<any>` from call sites.
7. **Ship it**: `use ship-change skill` → verify gate, archive + sync specs, commit, PR against `develop`, watch CI, wait out CodeRabbit, apply its findings, loop to green, squash-merge, clean up worktree.

## 3. How the collaboration unfolded

**Phase 1 — Apply (TDD the helper).** The AI announced the change (0/12), wrote the
failing test, watched it fail for the right reason (module absent), then created
`fetch-json.ts`. All 5 tests green. Effective because the red→green cycle proved the
test actually exercised new code, not a false pass.

**Phase 2 — Read the server, then split the design.** The pivotal moment: before
migrating `git-api.ts`, the AI grepped `git-routes.ts` and discovered the server returns
**non-2xx JSON** for status unions (checkout 409, worktree-create `path_exists`→409).
That forced the two-helper design: `fetchJson` guards both `res.ok` and content-type;
`fetchJsonResponse` guards **only** content-type so a valid 409-JSON is not converted
into an error. Reading the real contract before coding prevented a spec-violating bug.

**Phase 3 — Migrate by intent.** 17 `res.json()` calls in `git-api.ts` plus five other
modules routed by intent. A spot-check of the remaining `*-api.ts` modules showed they
**already** guard `res.ok` or branch on status — so per Surgical Changes the AI left
them alone rather than force them through the new helper and break their semantics.

**Phase 4 — Verify + warning hygiene.** Full client suite green (2687 passed). Root
`tsc` surfaced 5 errors in the new test (`err` is `unknown` under strict) — fixed. Biome
flagged `fetchJson<any>` as `noExplicitAny`. The AI checked the rule tier (advisory
`warn`, not a CI hard-gate; `off` in tests), realized explicit `<any>` at 36 call sites
would ratchet warnings up, and instead **defaulted the generic to `any`**, collapsing 36
warnings to 2 annotated signature defaults.

**Phase 5 — Ship (steering turn).** The user said `use ship-change skill`. The AI ran the
verify gate, correctly diagnosed full-suite failures as pre-existing (`pi-image-fit`
jimp dep) or flaky-under-load (passed in isolation), synced the new capability spec,
archived the change, committed, opened PR #198 against `develop`, and watched CI.

**Phase 6 — CodeRabbit loop + cleanup.** CodeRabbit was rate-limited; its "pass" was an
ACK, not a review — the AI flagged this as a decision point and the user chose to wait.
After the window, a full review flagged one **Major (perf)**: `readBodySnippet` buffered
the whole body via `res.text()`. The AI applied a streaming fix, re-verified, re-pushed,
looped CI to green, and squash-merged (`7e582f4b`). Cleanup hit the known worktree
pitfall (deleting the worktree killed the Bash cwd) and finished via the sandbox shell.

## 4. Prompts that worked

- **The goal prompt** — `/skill:openspec-apply-change guard-client-fetch-json`. Effective
  because the heavy lifting (proposal, tasks, spec deltas) was already captured in the
  OpenSpec change. A single slash command handed the AI a fully-scoped 12-task plan. The
  lesson: **front-load the spec, then let one command drive.**
- **High-leverage follow-up** — `use ship-change skill`. Four words that triggered the
  entire ship pipeline (gate → archive → PR → CI → CodeRabbit loop → merge → cleanup).
  Effective because the skill encodes the whole release discipline; the user didn't have
  to babysit each step.

The two prompts together are the model: **one command to build against a spec, one
command to land it.** Nothing needed rewriting — the pre-written change did the work a
verbose prompt otherwise would.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Stop after implementation, awaiting next move | `use ship-change skill` | Chaining apply→ship in the goal, or letting the apply skill hand off automatically |
| Treat CodeRabbit's rate-limited "pass" as a real review | (AI self-flagged the decision point) user chose to wait | Encoding "pass can be an ACK — verify no rate-limit" as a hard ship-gate check |

Beyond explicit steering, the AI imposed its own quality bars that a future operator
should demand up front: **read the server contract before migrating**, **separate your
errors from pre-existing ones** before claiming green, and **don't ratchet lint warnings
up** even when the rule is only advisory.

## 6. Skills, tools & memory created — and why they're effective

No new persistent skill or memory was created — the session was pure execution of two
existing skills (`openspec-apply-change`, `ship-change`) plus one subagent:

- **`general-purpose` subagent** — "Add file-index row for `fetch-json.ts`" per the
  Documentation Update Protocol, invoked with the caveman-style rule. Effective because
  it isolates the doc-row write (a `docs/`-adjacent concern) from the main coding context.

If anything deserved capture, it's the **two-helper split pattern**: `fetchJson` (guard
both) vs `fetchJsonResponse` (content-type only, for status-branching). Worth a project
memory so the next fetch-hardening task starts from the correct design instead of
rediscovering that the server returns non-2xx JSON.

## 7. Pitfalls & dead ends

- **Worktree has no `node_modules`.** Tests/tsc/biome had to run via the **parent repo's**
  binaries (`node /Users/robson/.../node_modules/vitest/vitest.mjs --root .`), with
  `HOME=$(mktemp -d)` + a temp localStorage file to isolate the run. `npm test` from the
  worktree doesn't work.
- **Blanket `sed 's/fetchJson<any>/fetchJson/g'` failed** — it would have stripped the
  *typed* `fetchJsonResponse<TestProviderResult>` calls too. The safe move was a targeted
  substitution that only matched `<any>`.
- **Pre-existing failures masquerade as yours.** `pi-image-fit-extension` jimp import
  errors (TS2305/TS2595) and flaky port/timing tests were in the very first tsc run
  before any edit. Confirm by re-running suspects **in isolation** before blaming your diff.
- **CodeRabbit "pass" ≠ reviewed.** When rate-limited, its status check reads "pass" but
  it's an ACK. Read the comment body for a reset window; trigger a full review after.
- **Deleting the worktree kills the Bash cwd.** The `--delete-branch` cleanup step tried to
  check out `develop` (held by the parent worktree) and the Bash tool then couldn't spawn
  (its cwd was gone). Finish local-branch cleanup from the **sandbox shell** / parent repo.
- **`git branch --list` exits 0 even when empty** — a "STILL EXISTS" guard on its exit code
  is a false positive. Confirm cleanly by checking the actual output.

## 8. Reproduce it faster — checklist

**Inputs to have ready:** a written OpenSpec change (`proposal.md` + `tasks.md` + spec
deltas), `gh` authed for the repo, the parent repo's `node_modules` path (worktree has none).

- [ ] `/skill:openspec-apply-change guard-client-fetch-json`
- [ ] TDD the helper: failing `fetch-json.test.ts` → `fetch-json.ts` (`ApiHttpError`, `fetchJson`, `fetchJsonResponse`) → green
- [ ] Grep the server routes; split throw-on-failure vs status-branching before migrating
- [ ] Migrate `res.json()` by intent; leave already-guarded / text helpers untouched
- [ ] Verify: client lib suite + root `tsc --noEmit` + Biome on changed files; isolate pre-existing failures
- [ ] Default helper generic to `any`; strip `<any>` from call sites to avoid warning ratchet
- [ ] `use ship-change skill` → gate, archive+sync specs, PR vs `develop`, CI, CodeRabbit loop, squash-merge, cleanup
- [ ] Clean up worktree/branches from the **parent repo / sandbox shell**, not the deleted worktree

**Final artifacts:** `packages/client/src/lib/fetch-json.ts`,
`packages/client/src/lib/__tests__/fetch-json.test.ts`,
`openspec/specs/client-api-response-validation/spec.md`, migrated `git-api.ts` +
5 other `*-api.ts` modules, PR #198 (squash commit `7e582f4b`).

---

_Generated from session `019f1481` · `pi-agent-dashboard` · 2026-06-29. Source extract: session facts sheet (mktemp)._
