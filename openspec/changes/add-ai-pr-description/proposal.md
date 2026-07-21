# Add AI-suggested pull-request title + description

## Why

Opening a PR from the dashboard runs `gh pr create` via `POST /api/git/worktree/pr`
(`{ cwd, title?, body? }`), but the operator types the title/body by hand or falls back to
gh's raw defaults. t3code prefills both from the branch's commits on PR create — a small,
high-polish affordance. This is the cheapest win (④) from the t3code feature-adaptation
research (`docs/research/t3code-feature-adaptation.md`).

Verified enabling facts (current code):

- **The PR path already exists.** `POST /api/git/worktree/pr` → `createPullRequest()`
  (`packages/server/src/git-operations.ts:1139`) resolves base/head and runs
  `gh pr create --base <base> --head <branch>` with optional `--title`/`--body`, pushing
  first when needed.
- **The server can already call a model without a live session.** The `model-proxy`
  (`packages/server/src/model-proxy/`, routes `/v1/messages` + `/v1/chat/completions`,
  `auth-gate.ts`) makes completions with the operator's configured provider credentials. PR
  creation is **cwd-scoped, not session-scoped**, so generation must not depend on a running
  bridge — the server-side proxy is the right seam.
- **AI text-drafting is proven prior art in this repo.** `packages/extension/src/commit-draft-agent.ts`
  (`buildSessionContextText`, `runForkSubagentDraft`, wired at `bridge.ts:1109`) already
  AI-drafts **commit messages**. PR title/body is the direct sibling; reuse its prompt shape.

## What Changes

- **Suggest endpoint (server).** Add `POST /api/git/worktree/pr/suggest` accepting `{ cwd }`.
  It resolves base/head (same resolver `createPullRequest` uses), gathers the branch's commit
  log (subjects + short bodies) and `git diff --stat <base>..<head>`, builds a bounded prompt,
  calls a configured model via the `model-proxy`, and returns `{ title, body }`.
- **Bounded, cheap input.** Only commit subjects/bodies + the diffstat (paths + counts) are
  sent — **no file contents**. Commit count and diffstat lines are capped so the request stays
  token-cheap and never ships large/sensitive diffs to the model.
- **Prefill, not auto-submit (client).** The PR dialog gains a "Suggest with AI" action that
  fills the title/body fields with the result. The operator always edits and confirms; the
  actual PR is created by the unchanged `POST /api/git/worktree/pr`.
- **Graceful degradation.** No model configured, a model error, or `gh`/git unavailable ⇒ the
  dialog behaves exactly as today (manual entry / gh defaults); the suggestion is simply
  absent. Never blocks PR creation.

**Out of scope (follow-ups):**
- Summarizing full diff **contents** (v1 = commit log + diffstat only, token-bounded).
- Commit-message generation (already shipped via `commit-draft-agent`).
- Non-GitHub SCM providers (GitLab/Bitbucket/Azure) — the other half of research item ④; the
  suggest endpoint is provider-agnostic (operates on `git log`/`diff`, not `gh`), so it
  composes with a future multi-host SCM change.
- Auto-suggesting on dialog open (v1 = explicit action; cost control).

## Capabilities

### Added Capabilities

- `ai-pr-description`: a server-side endpoint that drafts a pull-request title and body from a
  branch's commit log + diffstat via the model-proxy, surfaced as a prefill action in the PR
  dialog (operator edits + confirms), degrading gracefully when no model is available.

## Impact

- **Additive; PR creation unchanged.** With no model configured or on any failure, the PR
  flow is exactly as today. Suggestion is a pure prefill.
- **Reuses existing machinery:** the PR endpoint + base/head resolver (`git-operations.ts`),
  the `model-proxy` for the completion, and the `commit-draft-agent` prompt pattern.
- **New code:** a suggest route + prompt builder (server); a "Suggest with AI" prefill action
  in the PR dialog (client).
- **Security surface:** the suggest call sends commit subjects/bodies + diffstat (paths +
  line counts) to the operator's configured model — the same data boundary
  `commit-draft-agent` already crosses; **no file bodies**. The endpoint sits behind the
  existing auth gate like other git routes; being a model call (cost), it is user-triggered
  and MAY be lightly rate-limited when the dashboard is remotely exposed.
- **Cost:** one bounded completion per explicit suggestion.

## Discipline Skills

- `security-hardening` — the endpoint sends repo metadata to a model and triggers a
  credential-backed model call; bound exactly what is sent (no file contents), gate the route
  behind existing auth, and consider rate-limiting under remote exposure.
- `observability-instrumentation` — log suggestion requests + failures (model unavailable,
  timeout, gh/git error) so "why did the suggestion not appear" is diagnosable.
