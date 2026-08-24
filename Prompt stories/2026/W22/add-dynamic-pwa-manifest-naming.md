---
session: 019e6023
week: 2026/W22
type: development
model: "@fast"
premium: true
premium_reason: "heavy steering (10 user prompts)"
upgrade_status: pending
openspec_changes: [add-dynamic-pwa-manifest-naming]
proposal_excerpt: "Today `public/manifest.json` is a static file shipped in the client build. Every dashboard install — laptop, workstation, NAS, zrok tunnel — registers as a PWA with the same `name`/`short_name`. Users who install the…"
---

# How we did it: Dynamic PWA manifest naming — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The session opened in **explore mode** (a thinking-only stance — no code). The very
first *human* content was a design annoyance, then a one-line rename request:

> "I would like to add PWA app name Pi-Dash instead of Pi Dashboard"

But the real objective surfaced through the explore discussion: **every dashboard
install — laptop, workstation, NAS, zrok tunnel — registers as a PWA with the same
static `name`/`short_name`, so the launcher shows three identical `Pi-Dash` icons and
you can't tell which machine is which.** The finished work was not a rename; it was a
**server-generated `/manifest.json`** whose `name`/`short_name` resolve from
`config.dashboardName → Host header → os.hostname() → "Pi-Dash"`, shipped as a full
OpenSpec change (proposal → design → tasks → spec → implementation → docs → archive).

## 2. TL;DR playbook

1. **Explore first, implement never (yet).** Open in `openspec-explore` and let the
   AI sketch the fix space (static rename vs. dynamic route vs. per-install override)
   before committing to a shape.
2. **Approve a shape in one line** ("Your sketch seems reasonable") to move from
   thinking → OpenSpec artifacts.
3. **Scaffold the change**: proposal.md + design.md + tasks.md + `specs/pwa-manifest/spec.md`.
   The `pwa-manifest` capability already existed, so this was a MODIFY, not a new spec.
   `openspec validate <change>` until clean.
4. **Isolate the work**: `git worktree add /tmp/pi-agent-dashboard-develop develop`.
5. **Commit the proposal, then implement** in dependency order: shared config field →
   pure manifest-route helpers + tests → register route *before* fastify-static →
   round-trip config test → Settings UI input.
6. **Verify green**: targeted vitest (`18 unit + 4 round-trip`), then broader suite
   (498 files), then `tsc` typecheck.
7. **Delegate docs to a subagent** (`Explore`) in caveman style — AGENTS.md row,
   file-index-*, faq.md, CHANGELOG — then commit as a separate `docs(pwa):` commit.
8. **Build + restart in dev**, curl the live route with a spoofed `Host` header to
   confirm `"Pi-Dash · <host>"`.
9. **Manual cross-device check** (Android + desktop), tick the manual tasks, then
   **archive** via `openspec-archive-change` (syncs delta spec into main).

## 3. How the collaboration unfolded

**Phase 1 — Explore / frame (prompts 1–2).** The AI mapped the problem as an
ASCII "home screen" mock showing three indistinguishable `Pi Dash` icons and laid out
three "vary" strategies. The human's actual entry was a small rename ("Pi-Dash"), which
the AI executed as a one-line `public/manifest.json` edit while *explicitly flagging*
that the rename alone leaves the multi-machine ambiguity unsolved and that the dynamic
route is the real fix. **Why it worked:** the AI didn't silently over-build; it did the
cheap thing asked, then surfaced the bigger unsolved problem as an option.

**Phase 2 — Capture as OpenSpec (prompts 3–4).** "Your sketch seems reasonable"
promoted the sketch into artifacts. No scaffolding command existed, so the AI created
the four files manually and validated. Decision point captured in the design: `dashboardName`
lives **flat** in config, not under a `pwa: {}` namespace — the AI made the call and
invited pushback rather than blocking.

**Phase 3 — Isolate + implement (prompts 4–5).** A `/tmp` worktree off `develop`
kept the feature branch clean. Implementation went strictly in dependency order
(config → route → server wiring → tests → UI). Pure helpers (host parsing, port strip,
IPv6-safe, name compose) were written **separately from the route handler** so they were
unit-testable without a server.

**Phase 4 — Verify (prompt 6, "yes").** Targeted tests first (fast feedback), then the
whole suite, then typecheck. Tests were run once into `/tmp/pi-test.log` and re-inspected
by `grep`/`tail` — never rerun to see errors (the vitest run was long; the AI `sleep 60`
polled the log).

**Phase 5 — Docs via subagent (still prompt 6).** Per project protocol, the four
`docs/` updates were delegated to an `Explore` subagent in caveman style; the main agent
committed the returned rows as an isolated `docs(pwa):` commit.

**Phase 6 — Deploy + live verify (prompts 7–8).** `npm run build` +
`curl -X POST /api/restart` in dev, then a spoofed-`Host` curl proved
`"Pi-Dash · laptop.local"` end-to-end.

**Phase 7 — Cross-device + archive (prompts 9–10).** "In android and desktop seems
fine" let the AI tick the manual verification tasks (leaving iOS Safari + explicit
override annotated as deferred/N/A, not missed). "archive" ran `openspec-archive-change`,
syncing the delta spec into `openspec/specs/pwa-manifest/spec.md` and moving the change
to `openspec/changes/archive/2026-05-25-…`.

## 4. Prompts that worked

- **The goal prompt** — here the goal arrived *inside* explore mode as a rename, and
  the AI reframed it. A stronger kickoff a future operator should use:
  > "In explore mode: every dashboard install shows the same `Pi-Dash` PWA label so I
  > can't tell machines apart. Sketch options for making the manifest name vary per
  > install, then we'll pick one and open an OpenSpec change."
- **High-leverage follow-ups** (short prompts that unlocked whole phases):
  - "Your sketch seems reasonable" → explore → artifacts.
  - "create a worktree in tmp from develop" → clean isolation before any code.
  - "commit proposal and implement" → committed the thinking, then built.
  - "yes" → ran the full verify + docs-subagent phase.
  - "build and redeploy in dev mode" → live end-to-end proof.
  - "In android and destop seems fine" → ticked manual tasks.
  - "archive" → clean OpenSpec close-out.

The pattern: **the human supplied direction in ≤6 words per turn; the AI supplied the
plan, the risk flags, and the verification.** That division of labor is the reproducible
core.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Treat the ask as a literal one-line rename | Implicitly accept the rename but keep the bigger fix in view via "Your sketch seems reasonable" | State the *real* objective (per-install distinctness) in the goal prompt, not just the symptom |
| Want to implement inside explore mode | (Explore skill self-guards: "remind them to exit explore first") | Keep explore for shape; only leave it for the pre-approved one-line edit |
| Work directly on the current branch | "create a worktree in tmp from develop" | Add "isolate in a `/tmp` worktree off develop" to the standard change kickoff |
| Leave docs as a same-commit afterthought | Project protocol forced a subagent + caveman style + separate commit | Delegate all `docs/` writes to a subagent by default; never inline `docs/` edits |
| Consider the change "done" after code | "build and redeploy in dev mode" then a live curl | Always end with a live `Host`-spoofed curl before calling it verified |
| Risk over-checking tasks it hadn't done | AI self-corrected: "I forgot to tick them"; iOS + explicit-override left as deferred/N/A | Annotate deferred tasks explicitly in tasks.md rather than silently checking or dropping |

Quality bars the human imposed implicitly by trusting the AI: **green tests + typecheck
before commit**, **docs in caveman style**, **live proof before archive**.

## 6. Skills, tools & memory created — and why they're effective

No new skill or memory was created — this session *consumed* existing project machinery
rather than producing reusable assets. The reusable levers were:

- **`openspec-explore`** — the thinking stance that produced the fix-space sketch. Invoke
  when the ask is a symptom and the right shape isn't obvious.
- **`openspec-archive-change`** — one command to move the change to `archive/<date>-…`
  and sync the delta spec into the main capability spec. Invoke after manual verification.
- **`Explore` subagent for docs** — isolates the caveman-style doc rewrite (AGENTS.md
  row, file-index-*, faq.md, CHANGELOG) so the main agent stays on code. Invoke whenever
  a landed change needs `docs/` prose.

**Recommendation:** the sequence here (explore → OpenSpec artifacts → /tmp worktree →
dependency-ordered impl → verify → docs-subagent → live curl → archive) is repeatable
enough to warrant a **project skill** — e.g. `land-small-openspec-change` — capturing the
worktree + verify + docs-delegation + archive spine.

## 7. Pitfalls & dead ends

- **No OpenSpec scaffolding command.** `openspec change new` produced nothing usable
  (`openspec --help` / `openspec change --help` were probed). → Create the four artifact
  files manually under `openspec/changes/<name>/` and `openspec validate <name>`.
- **Long vitest run, tempting to rerun.** The suite (498 files) took minutes. Two grep
  invocations failed on an empty/partial log. → Pipe **once** to `/tmp/pi-test.log`, then
  `sleep`/`tail`/`grep` the same file — never rerun to see errors (project rule).
- **Route ordering matters.** A dynamic `/manifest.json` only wins if registered
  **before** `@fastify/static`, else the static file shadows it. → Register the manifest
  route ahead of the static handler in `server.ts`.
- **Existing PWA installs don't auto-rename.** iOS Safari freezes the name at install;
  Chrome/Edge/Android refresh within ~a day. → Document the uninstall/re-add caveat in
  `faq.md` (this session did) and leave iOS verification as an annotated deferral.
- **Spec validator strictness.** Archiving needed `## Purpose` + `## Requirements`
  headers added to satisfy `openspec validate --type spec`. → Expect header fix-ups at
  archive time.

## 8. Reproduce it faster — checklist

**Inputs to have ready:** a running dev dashboard (`pi-dashboard --dev`), the
`pwa-manifest` capability already present in `openspec/specs/`, write access to
`develop`.

- [ ] Open `openspec-explore`; state the *distinctness* objective; get a fix-space sketch.
- [ ] Approve one shape; create `proposal.md` + `design.md` + `tasks.md` +
      `specs/pwa-manifest/spec.md` (MODIFY); `openspec validate <change>` clean.
- [ ] `git worktree add /tmp/pi-agent-dashboard-develop develop`; commit the proposal.
- [ ] Implement in order: `packages/shared/src/config.ts` (`dashboardName?`) →
      `packages/server/src/routes/manifest-route.ts` (pure helpers + registrar) →
      register **before** fastify-static in `server.ts` → config round-trip test →
      `SettingsPanel.tsx` input.
- [ ] Targeted vitest → full suite (pipe once to `/tmp/pi-test.log`) → `tsc` typecheck.
- [ ] Delegate `docs/` (AGENTS.md, file-index-server/shared, faq.md, CHANGELOG) to an
      `Explore` subagent, caveman style; commit as separate `docs(pwa):`.
- [ ] `npm run build && curl -X POST http://localhost:8000/api/restart`; verify:
      `curl -s -H 'Host: foo.local:8000' http://localhost:8000/manifest.json | jq '.name,.short_name'`
      → `"Pi-Dash · foo.local"` / `"foo.local"`.
- [ ] Manual: install PWA from two origins, confirm distinct labels; tick manual tasks
      (annotate iOS / explicit-override deferrals).
- [ ] `openspec-archive-change` → syncs delta into `openspec/specs/pwa-manifest/spec.md`,
      moves change to `openspec/changes/archive/<date>-add-dynamic-pwa-manifest-naming/`.

**Final artifacts produced:**
`packages/server/src/routes/manifest-route.ts` (+ `__tests__/manifest-route.test.ts`),
edits to `packages/shared/src/config.ts`, `packages/server/src/server.ts`,
`packages/client/src/components/SettingsPanel.tsx`, `public/manifest.json`,
`openspec/specs/pwa-manifest/spec.md`, and the archived change under
`openspec/changes/archive/2026-05-25-add-dynamic-pwa-manifest-naming/`.

---

_Generated from session `019e6023-3ea4-73c9-a076-eb3be67bbb76` · `pi-agent-dashboard` · 2026-05-25. Source extract: `/tmp/facts-1784851145N.md`._
