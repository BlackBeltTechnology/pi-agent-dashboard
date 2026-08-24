---
session: 019e7b82
week: 2026/W22
type: development
model: "@fast"
premium: true
premium_reason: "heavy steering (8 user prompts)"
upgrade_status: pending
openspec_changes: [render-file-previews]
proposal_excerpt: "The dashboard's only first-class preview surface today is markdown. `MarkdownContent` renders chat / READMEs / pi-resources; `MarkdownPreviewView` provides a reusable preview shell. Everything else — PDFs, videos, Asc…"
---

# How we did it: rendering file & URL previews in the dashboard — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The kickoff prompt was a single skill invocation:

```
/skill:openspec-apply-change render-file-previews
```

The real objective, once the spec was read: the dashboard could only preview markdown
first-class. This change adds a general preview surface — PDFs, videos, images, HTML,
AsciiDoc, and YouTube/URL embeds — rendered both **inline** as chat preview cards and in
a full-screen **overlay** route, reachable via a `/view` command. It spans all three
packages (shared types → server raw/render endpoints → client renderers) plus a new
per-session server-side view-message store so previews survive reconnects without leaking
into pi-bound traffic. 58 spec tasks; 54 landed autonomously, 4 manual browser-smoke tasks
deferred. The remaining prompts were pure delivery steering: commit → rebase → CI → merge → clean.

## 2. TL;DR playbook

1. **Start the change with its skill, not a prose brief:** `/skill:openspec-apply-change render-file-previews`. The skill loads proposal + design + spec + tasks and gives the AI a numbered task list to march through.
2. **Let the AI orient before coding.** It read the proposal/specs and immediately flagged two spec-vs-code structural mismatches (`ChatMessage` lives in `client/src/lib/event-reducer.ts`, not `shared/src/types.ts`). Confirm the reconciliation before it writes.
3. **Work section-by-section, marking `tasks.md` as you go** — shared types → server endpoints → client lib → renderers → PreviewCard/overlay → ChatView → CommandInput → App wiring/persistence → docs → verify.
4. **Answer the one architectural `ask_user` decisively** (persistence model): a separate per-session JSON view-message store + a new WS broadcast type, so preview rows never enter `pi.sendUserMessage`.
5. **Run tests per section with an isolated HOME:** `HOME=$(mktemp -d) npx vitest run <file>` — keeps the real `~/.pi` clean and tests deterministic.
6. **Verify the whole thing at the end:** `npm run lint`, full `npx vitest run`, and `npm run build` — confirm pdfjs lands in its own lazy chunk, not the main bundle.
7. **Then just drive delivery in one-word steering turns:** `commit and push` → `rebase develop` → `monitor CI` → (fix upstream breakage or wait) → `merge PR` → `clean`.

## 3. How the collaboration unfolded

**Phase A · Orient & reconcile the spec (02:52–03:02).** The AI read
`proposal.md`, `design.md`, the delta specs, and `tasks.md`, then grepped for `ChatMessage`
and `ViewTarget` across packages. It surfaced — before touching code — that the spec's
assumptions about where types live didn't match reality, and proposed the correction. *Why
it worked:* catching structural spec drift up front prevents a cascade of wrong edits across
58 tasks.

**Phase B · Build bottom-up across the stack (03:02–03:24).** Shared `ViewTarget`
discriminated union → server `/api/file/raw` (binary/Range-aware) + `/api/file/render`
(asciidoctor safe-secure) → client `preview-dispatch` + `extract-urls` → eight renderer
components (`PdfPreview`, `VideoPreview`, `YouTubePreview`, …) → `PreviewCard` + overlay
route → `ChatView` integration → `CommandInput` `/view` interception. Each section shipped
with its own vitest file and got marked complete in `tasks.md`. *Decision point:* the
pdfjs worker — the AI rejected a `public/` copy + postinstall script in favor of Vite's
`?url` import, and rewrote the task to match (simpler, chunk-splittable).

**Phase C · Persistence + bridge safety (03:17–03:24).** Per the `ask_user` answer,
a new `view-message-store.ts` (JSON at `~/.pi/dashboard/view-messages/<sid>.json`), a
`view_messages_update` broadcast, snapshot-on-subscribe, and a defensive bridge filter —
plus a test proving view rows never reach pi-bound traffic.

**Phase D · Docs + verify (03:24–03:37).** The `Explore` subagent couldn't run (role
`@fast` unresolved in that context), so the AI wrote the file-index + faq docs directly in
caveman style and flagged the fallback. Final gate: lint clean, 6891 tests pass (1 unrelated
timing flake), build green with pdfjs isolated in `pdf-*.js` (365 KB) + lazy `PdfPreview` chunk.

**Phase E · Delivery grind (11:40–12:47).** Commit/push, then **two rebase rounds**: the
first hit a `package-lock.json` conflict (regenerated) and exposed CI red from an *unrelated*
`image-fit-extension` package that had landed on develop; the AI proved the failure was
inherited (develop's own HEAD was red with identical errors) rather than fix out-of-scope
code. Waited for develop's fix (#66), rebased clean, CI went green, merged PR #65 (squash),
removed the worktree and branch.

## 4. Prompts that worked

- **The goal prompt — `/skill:openspec-apply-change render-file-previews`.** A single skill
  invocation beats a paragraph of requirements: it loads the full artifact set and a
  verifiable task list. Ideal kickoff for any spec-driven change.
- **`rebase develop`** (used twice) — a two-word high-leverage turn. The AI handled
  lock-file regeneration, conflict resolution, and force-push each time without further
  instruction.
- **`monitor CI`** — unlocked a full triage: the AI compared the PR run against develop's
  own HEAD run and correctly attributed the red to inherited breakage.
- **`es` / `merge PR` / `clean`** — terminal one-word steers. They worked only because the
  earlier phases had established unambiguous context (which PR, which branch, which worktree).

Weak-prompt rewrite: instead of the bare `es` confirmation, prefer an explicit
`yes, open the separate fix PR against develop` so intent survives out of context.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Trust the spec's claim about where `ChatMessage`/types live | (AI self-caught) reconcile before coding | State "verify type/file locations against the real tree before editing" in the proposal |
| Consider patching adjacent broken code (`image-fit-extension` lint) to get CI green | Let it stay out-of-scope; wait for the upstream fix | Cite the "surgical changes" rule up front so it never proposes touching unrelated packages |
| Sit idle after each delivery step | Feed one-word steers (`commit and push`, `rebase develop`, `merge PR`, `clean`) | Pre-authorize the whole delivery chain: "commit, push, open PR, monitor CI, merge on green, clean up" |
| Reach for a `public/`+postinstall pdfjs worker copy | (AI self-corrected) use Vite `?url` import | Note "prefer Vite `?url` for bundled worker assets" in the design |

Quality bars the human implicitly enforced: CI must be **green from this change's own diff**
(not masked by inherited red), and cleanup is not optional (worktree + local branch removed).

## 6. Skills, tools & memory created — and why they're effective

No new skill or memory was created — this session *consumed* the `openspec-apply-change`
skill rather than producing one. That skill is the reusable asset: it turns a spec bundle
into a numbered, checkbox-tracked implementation run and is the right entry point for any
`openspec/changes/<name>/` work.

Recommended crystallization: the **rebase-through-inherited-CI-red** pattern (prove develop's
HEAD is already red with identical errors → don't fix out-of-scope code → wait for upstream
fix → rebase clean) is repeatable and non-obvious. It belongs in a short skill or memory so a
future run doesn't waste a cycle deciding whether to patch someone else's package.

## 7. Pitfalls & dead ends

- **`Explore` subagent failed to spawn (role `@fast` unresolved in that worktree context).**
  If a doc-delegation subagent won't start, don't block — write the docs inline in caveman
  style and flag the fallback in the summary.
- **`package-lock.json` conflict on rebase.** Don't hand-merge it. Take develop's version,
  then `npm install --package-lock-only` to regenerate cleanly, then force-push.
- **CI red that isn't yours.** Before touching anything, run the same job on develop's HEAD.
  If it's red with identical errors, the failure is inherited — wait for the upstream fix and
  rebase; do not patch the unrelated package in this PR.
- **`gh` errored on merge** trying to switch the local checkout to develop *after* the merge
  succeeded. The merge itself was fine — verify the merge commit on the remote before assuming
  failure.
- **One vitest flake** (`run-bootstrap.test.ts > throttles progress events`) is a timing test
  unrelated to preview work — don't chase it as a regression.

## 8. Reproduce it faster — checklist

**Inputs to have ready:** an OpenSpec change folder (`openspec/changes/render-file-previews/`
with proposal/design/specs/tasks), a clean worktree on a feature branch, and a green develop
to rebase onto.

1. `/skill:openspec-apply-change <change-name>` — load the task list.
2. Let the AI orient and **reconcile spec vs. real file locations** before it edits.
3. Answer the persistence `ask_user` up front: separate per-session JSON store + WS broadcast,
   never through `pi.sendUserMessage`.
4. Build bottom-up (shared → server → client), one section per commit-worthy unit, marking
   `tasks.md`; test each with `HOME=$(mktemp -d) npx vitest run <file>`.
5. Prefer Vite `?url` for the pdfjs worker; confirm it lands in a lazy chunk, not main.
6. Final gate: `npm run lint` + full `npx vitest run` + `npm run build`.
7. Delivery chain (pre-authorize it): commit & push → `rebase develop` (regenerate lock file
   on conflict) → monitor CI (attribute any red vs. develop's HEAD) → merge PR on green →
   remove worktree + local branch.

**Final artifacts:** ~35 files across `packages/shared`, `packages/server`
(`lib/mime-types.ts`, `view-message-store.ts`, `/api/file/raw` + `/render`),
`packages/client` (`lib/preview-dispatch.ts`, `lib/extract-urls.ts`, 8 `components/preview/*`,
`PreviewCard.tsx`, `PreviewOverlayView.tsx`), plus docs; merged as squash `2ea34b2d` on
`develop` via PR #65.

---

_Generated from session `019e7b82-1ead-77cc-b1a4-07beb6856e88` · `pi-agent-dashboard` · 2026-05-31. Source extract: `sessfacts.XXXXXX.vuzqVcLvwx.md`._
