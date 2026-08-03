---
session: 019f29b8
week: 2026/W27
type: development
model: "@fast"
premium: true
premium_reason: "created 0 skill(s) / 1 memory(ies); large facts sheet (~18601 tok)"
upgrade_status: pending
openspec_changes: [improve-content-editor, fix-dox-lint-false-positives]
proposal_excerpt: "The internal editor pane (`add-internal-monaco-editor-pane`, archived 2026-06-30; extended by `split-editor-workspace`, archived 2026-07-03) shipped read-only v1 with a thin viewer registry (`monaco | image | pdf | ma…"
---

# How we did it: Improve the content editor pane — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The session opened against an already-drafted OpenSpec change, `improve-content-editor`, with a deliberately minimal first prompt: **"Is there anything to clarify?"** The real objective was to implement that entire change — an 8-phase upgrade to the dashboard's internal Monaco editor pane: fix 7 defects (theme-follow, hidden-dir tree rendering, tree↔tab sync, broken PDF `<object>`, markdown read-only), converge the editor viewers onto the shared `preview/*` renderers, add a brand-new **live-server-preview** capability (loopback reverse proxy + SSRF guard + sandboxed iframe), and land report-only CSP hardening — then ship it end-to-end through CI and CodeRabbit. The operator's model of collaboration: *don't pick silently on open design questions; surface them, get a decision, then execute TDD phase-by-phase and drive it all the way to a merged PR.*

## 2. TL;DR playbook

1. Start in a git worktree already carrying the OpenSpec change; open the change's `proposal.md` / `design.md` / `tasks.md` and read them before touching code.
2. Instead of guessing on flagged open questions, batch them to the human with `ask_user` (CSP rollout scope, viewer convergence, image-viewer pan/zoom tradeoff). Get explicit calls, restate the settled plan, then proceed.
3. Work the phases in `tasks.md` order, smallest/highest-value first. Per task: **write the failing test, confirm red for the right reason, apply the minimal fix, confirm green.**
4. After each phase: `tsc --noEmit` on touched packages, run the touched test scope, check off tasks, update the nearest directory `AGENTS.md` rows.
5. For any cross-package type/runtime change in a worktree, **install deps in the worktree first** (`npm ci`) — an empty `node_modules` silently resolves package-name imports to the *main* repo's stale source.
6. For the security-critical phase (live-server), put the SSRF validator in `shared/` so client and server enforce the *same* rule; proxy on the main origin; iframe with `sandbox="allow-scripts"` and **no** `allow-same-origin`.
7. Validate the real runtime, not just unit tests: boot the server locally on a spare port with a temp `HOME` and read `server.log` to catch startup errors (e.g. double plugin registration). Gate CSP behind a Docker e2e using system Chrome (`PW_CHANNEL=chrome`) when the Playwright chromium download is flaky.
8. Ship with `ship-change`: archive + sync specs, commit, push, open PR against `develop`, watch CI, poll CodeRabbit, triage every thread, apply the valid fixes, loop until CI green + zero actionable threads, squash-merge, remove the worktree.

## 3. How the collaboration unfolded

**Phase A — Clarify before code (Discovery).** The AI read the OpenSpec artifacts and, rather than starting, surfaced three genuine decision points: CSP rollout scope (keep in this change vs. split out), `file-and-url-preview` convergence (retire the `ViewerKind` enum vs. keep the adapter), and overall scope/risk. The human resolved them via `ask_user` (11 interactive turns across the session). *Why it worked:* the design had explicitly-marked "Open Questions"; answering them up front prevented a large rework mid-flight.

**Phase B — Defect fixes, TDD, phase by phase (Generate).** Phases 1–5 each followed red→green: theme-follow (swap isolated `useTheme()` → shared `useThemeContext()` so the recolor effect fires); tree correctness (new `GET /api/file/tree` single `readdir(withFileTypes)` replaces a names+dirs merge that hid `.git`/`.pi`; new `file-icon.ts` per-kind icons); tree↔tab sync (`openFile`/`setActive` expand ancestor dirs + scroll active row; persisted labelled "Files" toggle); `preview/*` adoption (registry delegates to `PdfPreview`/`HtmlPreview`/`Video`/`Audio`/`Image`/`Mermaid`; `file-kind` gains `html|mermaid|audio|video`); markdown Preview/Edit toggle with optimistic-concurrency save (409 → `ChangedOnDiskBanner`). *Decision point:* the image viewer — the AI flagged that swapping the full pan/zoom `ImageViewer` for the 40vh-capped inline `ImagePreview` would lose capability; the human chose "share both places," so a `variant` prop was added instead of a lossy swap.

**Phase C — The security-heavy phase (live-server-preview).** The AI put `validateLiveTarget()` (loopback-only, rejects cloud-metadata/private/public hosts) in `shared/` so the client pre-validates with the exact rule the server enforces. It built the manager (allowlist registry, persisted), a reverse proxy on the main origin (survives the single-port zrok tunnel) with WS upgrade for HMR, and a `LiveServerViewer` iframe with `sandbox="allow-scripts"` and **no** `allow-same-origin` (opaque origin: scripts run but can't read the dashboard token or hit `/api/*`).

**Phase D — Runtime & CSP validation (Verify).** Unit tests were green but the Docker container's server exited 1. The AI booted the worktree server locally with a temp `HOME`, read `server.log`, and found `@fastify/reply-from` registered twice (editor-proxy + live-server-proxy) → dropped the duplicate. CSP shipped report-only, scoped to skip `/editor/` and `/live/` prefixes, verified by a Docker e2e run against system Chrome after the Playwright chromium download kept timing out.

**Phase E — Ship (Land).** On "Use ship-change," the AI ran the full pipeline: fixed a `MODIFIED`→`ADDED` spec-delta mismatch during archive, opened PR #225, and looped **4 rounds** of CI + CodeRabbit — applying valid findings (SSRF re-validation of persisted targets, symlinked-dir stat, WS timeout, literal-`\n` AGENTS.md regressions) — until green with zero actionable threads, then squash-merged and removed the worktree.

## 4. Prompts that worked

- **The goal prompt — "Is there anything to clarify?"** Deceptively strong *because* the change was already well-specified: it invited the AI to surface open design questions before writing code, which is exactly what a large, risky change needs. A future operator with a drafted OpenSpec change can reuse this verbatim. If starting from scratch, strengthen to: *"Implement OpenSpec change X phase-by-phase in tasks.md order, TDD each task, and ask me about any open design question before you start."*
- **High-leverage follow-ups:** the terse `ask_user` answers ("both resolved," "share both places," "keep report-only default") each unblocked an entire phase in one word. **"Use ship-change"** — three words that triggered the full archive→PR→CI→CodeRabbit→merge pipeline.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Want to start coding on a spec with unresolved "Open Questions" | Answering CSP-scope + convergence questions up front | Resolve every design open-question in the proposal *before* apply |
| Consider a lossy swap (`ImageViewer` → 40vh `ImagePreview`) because a task said "delete if superseded" | "share both places" | Add a `variant` prop rather than delete capability when two call sites differ |
| Push CSP toward enforce-mode (high blast radius) | "keep report-only default" | Default new security headers to report-only; defer the enforce flip to its own change |
| Trust worktree `tsc` signal with empty `node_modules` | Recognizing stale cross-package resolution | `npm ci` in the worktree before any cross-package type-check |
| Treat 2 failing tests as regressions | Confirm on clean base via `git stash` | Baseline flaky/pre-existing tests before blaming your diff |

## 6. Skills, tools & memory created — and why they're effective

- **Memory saved (project · tool-quirk):** *"a fresh git worktree under `.worktrees/` ships an EMPTY `node_modules`, so package-name imports resolve to the MAIN repo's `packages/` — both `tsc` and the dev runtime read stale source until you `npm ci` in the worktree."* Effective because it removes an hour-long red herring (the AI chased "stale shared declarations" before diagnosing it) and applies to *every* cross-package change in a worktree. Invoke the fix (`npm ci` in the worktree) the moment cross-package types look wrong there.
- **No skill was created, but two are worth extracting:** (1) a **worktree runtime-smoke** procedure — boot the server on a spare port with a temp `HOME` and read `server.log` to catch startup errors unit tests miss (this is how the double `reply-from` registration was found); (2) a **CSP-e2e-with-system-Chrome** recipe (`PW_CHANNEL=chrome`) for when the Playwright chromium download is unreliable. The existing `ship-change` skill already carried the merge pipeline and did the heavy lifting.

## 7. Pitfalls & dead ends

- **Double Fastify plugin registration:** `@fastify/reply-from` registered by both editor-proxy and live-server-proxy → `decorator 'from' has already been added`, server exits 1 (invisible to vitest + `tsc`). If a container exits 1 but tests pass, boot locally and read `server.log`.
- **Empty worktree `node_modules`:** `tsc` reads the main repo's stale `packages/shared` → phantom type errors. Run `npm ci` in the worktree first.
- **Playwright chromium download timed out repeatedly** in this environment. Fallback: `PW_CHANNEL=chrome` against system Google Chrome.
- **Docker harness first-build vs. Playwright's 180s health window:** the container was still `npm install && npm run build`-ing when the health check expired. Pre-build+boot the image once (cached), then attach Playwright in `USE_RUNNING` mode.
- **Literal `\n` in `AGENTS.md` edits:** a `\n` in edit `newText` landed literal, merging two rows — CodeRabbit caught 6. Use real newlines in `AGENTS.md` row inserts.
- **OpenSpec archive `MODIFIED` mismatch:** a new requirement was tagged `MODIFIED` (header not in base spec). Move net-new requirements to `ADDED`; only tag `MODIFIED` when the header exists in the base spec.
- **Worktree removed out from under the shell:** after `git worktree remove`, the Bash tool re-entered the deleted cwd and couldn't start. Recreate a placeholder dir to run cleanup, then delete it last.

## 8. Reproduce it faster — checklist

- [ ] Have ready: the OpenSpec change in a git worktree, `gh` authed, Docker available, system Chrome installed.
- [ ] Read `proposal.md` / `design.md` / `tasks.md`; `ask_user`-batch every open design question before coding.
- [ ] `npm ci` **in the worktree** before any cross-package `tsc`.
- [ ] Per task, TDD red→green; after each phase run `tsc --noEmit` + touched test scope, check off tasks, update nearest `AGENTS.md` (real newlines).
- [ ] Put shared security validators in `shared/`; iframe untrusted content with `sandbox="allow-scripts"` and no `allow-same-origin`; default new CSP to report-only.
- [ ] Runtime-smoke the server locally (spare port + temp `HOME`, read `server.log`) before trusting the container; CSP e2e via `PW_CHANNEL=chrome` against a pre-built harness image.
- [ ] `ship-change`: archive+sync (fix `MODIFIED`→`ADDED`), PR vs `develop`, loop CI+CodeRabbit until green + zero actionable threads, squash-merge, remove worktree.
- **Final artifacts:** PR #225 (squash-merged `2c9832454` onto `develop`), archived change `2026-07-03-improve-content-editor`, plus riders `fix-dox-lint-false-positives`.

---

_Generated from session `019f29b8-086d-75df-88a9-bdad4804b3aa` · `/Users/robson/Project/pi-agent-dashboard` · 2026-07-03. Source extract: `/tmp/facts-editor.md`._
