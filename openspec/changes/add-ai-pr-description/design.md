# Design — AI-suggested PR title + description

## Origin

Cheapest-win candidate ④ from `docs/research/t3code-feature-adaptation.md`. t3code suggests
PR titles/descriptions from commits on PR create. This change adds the same as a prefill on
the dashboard's existing PR flow.

## Grounding

| Fact | Where | Use |
|---|---|---|
| PR create endpoint `{cwd,title?,body?}` → `gh pr create` | `git-operations.ts:1139` `createPullRequest`; spec `worktree-lifecycle` | Prefill targets its `title`/`body`; base/head resolver reused |
| Server-side model calls with operator creds | `packages/server/src/model-proxy/` (`/v1/messages`, `/v1/chat/completions`, `auth-gate.ts`) | Runs the suggestion completion without a live session |
| AI commit-message drafting already ships | `packages/extension/src/commit-draft-agent.ts` (`buildSessionContextText`, `runForkSubagentDraft`) | Prompt-shape prior art for PR text |
| Coherence | no active/archived AI-PR-text change | Net-new, no duplication |

## Design decisions

### D1 — Generate server-side via model-proxy (not the bridge draft agent)
PR creation is **cwd-scoped**, triggered from worktree/PR UI that may have **no live session**.
`commit-draft-agent` runs inside the bridge (a running pi session), so it cannot be the
primary path. The server `model-proxy` already makes operator-credentialed completions with no
session dependency — it is the correct seam. (The bridge draft agent stays the model for the
prompt shape, not the execution path.)

### D2 — Input = commit log + diffstat only, token-bounded; no file contents
The prompt carries commit subjects/short bodies + `git diff --stat <base>..<head>` (paths +
counts). File **contents** are deliberately excluded: keeps the request cheap, avoids shipping
large or sensitive diffs to a third-party model, and matches what a human skims to write a PR.
Commit count and diffstat lines are capped (e.g. last K commits, first M stat lines) so tokens
stay bounded on big branches.

### D3 — Prefill, never auto-submit
The suggestion only fills the dialog's title/body fields. The operator edits and confirms; the
PR is created by the unchanged `POST /api/git/worktree/pr`. No behavior change to submission.

### D4 — Graceful degradation is mandatory
No configured model, a proxy error/timeout, or a git/gh failure ⇒ the dialog works exactly as
today with the suggestion absent. Suggestion failure MUST never block or delay PR creation.

### D5 — Model selection reuses configuration, no hardcoded provider
Use the operator's configured model-proxy default or a designated role (e.g. a fast/writing
role) — never a hardcoded provider/key. If nothing is configured, the feature is simply
unavailable (D4).

### D6 — Endpoint gated + cost-bounded
The suggest route sits behind the same auth gate as other git routes. Because it triggers a
credential-backed model call, it is user-initiated (explicit action, not on every dialog open)
and MAY be lightly rate-limited when the dashboard is tunnel-exposed.

## Open questions

1. **Explicit button vs auto-suggest on dialog open.** v1: explicit "Suggest with AI" (bounds
   cost, predictable). Auto-on-open is a later toggle.
2. **Which model/role.** Reuse an existing role binding; confirm which default reads cleanly
   from current config without new settings surface.
3. **Body format.** Plain markdown summary vs a template (Summary / Changes / Testing). Lean
   plain summary v1; template is a follow-up.

## Alternatives considered

- **Bridge `commit-draft-agent` for PR text.** Rejected as primary: session-bound, but PR
  create is cwd-scoped and may run with no session. Reused as prompt-shape reference only (D1).
- **Send full diff contents to the model.** Rejected: token cost + leaking large/sensitive
  diffs; diffstat + commit log is enough for a good title/body (D2).
- **Auto-submit the generated PR.** Rejected: PR text needs a human edit pass; prefill keeps
  the operator in control (D3).
