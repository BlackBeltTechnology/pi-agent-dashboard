# Tasks — add-ai-pr-description

## 1. Prompt builder (server)
- [ ] 1.1 `buildPrPrompt(cwd)` — resolve base/head (reuse `createPullRequest`'s resolver),
      gather commit subjects/short bodies + `git diff --stat <base>..<head>`, cap to K commits
      / M diffstat lines, assemble a bounded prompt. → verify: unit test in a temp git repo —
      known commits/diffstat produce a prompt containing them; caps enforced; no file contents.
- [ ] 1.2 Empty range (no commits ahead of base) ⇒ builder returns "nothing to summarize".
      → verify: test on a branch level with base.

## 2. Suggest endpoint (server)
- [ ] 2.1 `POST /api/git/worktree/pr/suggest { cwd }` → build prompt → call model via
      `model-proxy` → return `{ title, body }`. → verify: route test with a mocked proxy
      returns a title+body.
- [ ] 2.2 Gate the route behind the existing auth used by other git routes. → verify: test —
      unauthenticated request rejected on a gated deployment.
- [ ] 2.3 Graceful degradation: no model configured / proxy error / git failure ⇒ respond with
      a no-suggestion result (not a 500 that breaks the dialog). → verify: tests for each
      failure path return a well-formed "unavailable" response.

## 3. PR dialog prefill (client)
- [ ] 3.1 Add a "Suggest with AI" action in the PR dialog that calls the suggest endpoint and
      fills the title/body fields (editable). → verify: component test — clicking fills fields
      from a mocked response.
- [ ] 3.2 The operator edits then submits via the unchanged `POST /api/git/worktree/pr`.
      → verify: component test — submit sends the (possibly edited) title/body.
- [ ] 3.3 Suggestion unavailable/failed ⇒ the action shows a non-blocking notice; manual entry
      still works. → verify: component test — failure leaves the dialog usable.

## 4. Observability
- [ ] 4.1 Log suggestion requests + outcomes (ok / model-unavailable / timeout / git-error).
      → verify: test asserts a log line per outcome.

## 5. Docs
- [ ] 5.1 Delegate a `docs/` note (caveman style): the suggest endpoint, the input boundary
      (commit log + diffstat, no file contents), prefill-not-autosubmit, graceful degradation.
      → verify: note exists; `ctx_index` it.

## 6. End-to-end
- [ ] 6.1 E2E (docker harness): a branch with commits → open PR dialog → "Suggest with AI"
      fills title/body → edit → create. → verify: Playwright spec in `tests/e2e/` (mock or
      stub the model call).
