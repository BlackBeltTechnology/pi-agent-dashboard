---
session: 019e6bc2
week: 2026/W22
type: development
model: "@fast"
premium: true
premium_reason: "heavy steering (8 user prompts)"
upgrade_status: pending
openspec_changes: [ship-browser-skill-and-electron-cdp]
proposal_excerpt: "Two related gaps make automating the dashboard's own Electron shell awkward today:"
---

# How we did it: Ship the universal `browser` skill + Electron CDP debug switch — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The kickoff was deceptively small — *"set worktree base to current develop"* — but the real
objective surfaced two prompts later: **apply the `ship-browser-skill-and-electron-cdp`
OpenSpec change end-to-end**. That change closes two related gaps in automating the
dashboard's own Electron shell: (1) ship a single **universal `browser` skill** (vendored from
`agent-browser` upstream, replacing the repo-local `browser-visual-debug`) that works for both
web and the Electron app, and (2) add an opt-in **Electron CDP debug switch** (`--debug-cdp` /
`npm run dev:cdp`) so an agent can attach to the running dashboard via port 9222 — without ever
enabling remote debugging in the shipped production app. The finished work: 39/39 spec tasks,
archived change, 38 files changed (+4173 / −721), pushed.

## 2. TL;DR playbook

1. **Fix the worktree base first.** The spec lived on `origin/openspec/ship-browser-skill-and-electron-cdp`, *not* on develop. Cherry-pick the spec commit onto the develop-based worktree so you have base + spec: `git cherry-pick <spec-commit>`.
2. **Run `/skill:openspec-apply-change <name>`** and read *all* context files before touching code. Propose a working order (research → code TDD → skill → cleanup → docs → verify → manual gates).
3. **Verify upstream reality before vendoring.** `agent-browser skills get core|electron` — don't assume the repo has static `core`/`electron` files (it ships one discovery stub). Pin tag + commit + CLI version in `UPSTREAM.md`.
4. **Build the Electron CDP switch TDD-first:** write `resolve-cdp-activation.test.ts`, confirm red, then the pure `resolveCdpActivation` helper (injected I/O), then wire into `main.ts` *before* the single-instance lock. Add a `no-remote-debugging-address` repo-lint test.
5. **Vendor the skill:** strip upstream frontmatter, append Pi-Dashboard addenda into `references/web.md` + `references/electron.md`, add auto-detect routing in `SKILL.md` (probe port 9222 + `pgrep "Pi Dashboard"`), wire `pi.skills[]` + `files[]` in `packages/extension/package.json`, add a registration test, confirm `npm pack --dry-run` ships the files.
6. **Delete the old skill + sweep references** (`browser-visual-debug`), delegate `docs/` prose to a subagent, edit README/AGENTS directly.
7. **Run browser gates with `agent-browser`:** launch `npm run dev:cdp`, connect on 9222, capture a real screenshot; verify the production app does NOT expose 9222 and the preflight halts when the CLI is missing.
8. **Archive + sync specs, then commit & push** (excluding local-only `.pi/settings.json`).

## 3. How the collaboration unfolded

**Phase 1 — Orient the worktree (Discovery).** The AI checked `git status`/`log` and found the
worktree already equalled develop; the only diff was an unstaged local `.pi/settings.json`. The
user then corrected the mental model: the spec *is* pushed but on a separate `openspec/...`
branch. The AI located it, saw it was 1 commit ahead, and **cherry-picked the spec commit** onto
the develop base — the cleanest way to get "develop + spec" in one worktree. *Why it worked:* it
resisted rebasing or merging and made a surgical, reversible move.

**Phase 2 — Apply the change (Plan).** `/skill:openspec-apply-change` loaded a 39-task
spec-driven change. The AI read every context file and published an explicit working order
before writing anything.

**Phase 3 — Upstream reality check (the pivotal discovery).** Task 1.3 assumed upstream had
static `core` and `electron` skill files to vendor. The AI fetched the repo and found **one
discovery-stub `SKILL.md`** that delegates to `agent-browser skills get <name>` at runtime. It
**paused and surfaced options** (vendor snapshot vs. runtime pointer vs. hybrid) rather than
guessing. This is the key decision point — the human went off to research upstream docs.

**Phase 4 — Electron detection design (steering #3).** While paused, the user asked whether the
session could "detect it's running on Electron and select electron." The AI corrected the
premise (**the pi session is a Node/CLI process, never *inside* Electron**) and reframed the
answerable question: *is a Pi Dashboard Electron app running locally to automate?* — detectable
via `lsof -ti :9222` + `pgrep "Pi Dashboard"`. The user chose **C: full auto-detect**, baked into
`SKILL.md` Step 0b.

**Phase 5 — Build (Generate, TDD).** §2 CDP switch: `resolveCdpActivation` pure helper + 18
tests (210→218 passing), wired into `main.ts`, plus a `no-remote-debugging-address` lint that
immediately caught the AI's own comment (fixed by rephrasing). §3 skill: vendored `web.md`
(2789 lines) + `electron.md` (351 lines), `UPSTREAM.md` provenance, registration test, `npm pack`
verification. §4 deleted `browser-visual-debug` and swept references.

**Phase 6 — Verify with real browser gates (steering #4: "use browser and test gates").** The
AI discovered the worktree had no local `node_modules/electron`, installed it, launched
`npm run dev:cdp`, connected `agent-browser` on 9222, and captured a **real 40 KB PNG** from the
dev app. It also proved the **production app does NOT listen on 9222** and the preflight halts on
missing CLI. All four gates dogfooded through the very skill being shipped.

**Phase 7 — Archive & ship.** `/skill:openspec-archive-change` synced 4 delta specs (2 ADDED
merges, 1 new spec, 1 REMOVED), archived the change, then commit & push excluding local-only
`.pi/settings.json`.

## 4. Prompts that worked

- **Goal prompt — weak as written:** *"set worktree base to current develop."* It buried the real
  intent. **Stronger:** *"This worktree should be develop + the `ship-browser-skill-and-electron-cdp`
  spec (which is on `origin/openspec/…`, not develop). Set that up, then apply the change."* — states
  base, the off-branch spec location, and the end goal in one shot.
- **High-leverage correction:** *"There is ship-browser-skill-and-electron-cdp spec which is not
  presented in worktree but it is pushed to develop."* — one sentence that unblocked the whole setup
  by pointing at the missing artifacts.
- **High-leverage reframe:** *"IS it able to detect the session is running on electron and on that
  case select the electron?"* — a naive-sounding question that forced the AI to correct a false premise
  and produce the auto-detect design.
- **High-leverage scope command:** *"use browser and test gates"* — three words that turned "manual
  gates, paused" into a fully dogfooded verification with a real screenshot.
- **Terminal drivers:** *"ok"*, *"commit and push"* — short confirmations once the plan was trusted.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Assume the worktree base was complete (only saw an unstaged settings diff) | "the spec is pushed but not in the worktree" | State up front where off-branch spec artifacts live (`origin/openspec/<name>`) |
| Treat manual gates as out-of-scope and pause | "use browser and test gates" | Add "dogfood the shipped skill for verification" to the apply plan by default |
| Risk conflating "pi session" with "Electron runtime" | "can it detect it's running on electron?" → AI reframed | Note in the skill that pi is a CLI/Node process; detection = probing the *app*, not `process` |
| Vendor from assumed upstream file layout | (self-caught) paused when `core`/`electron` files didn't exist | Verify `agent-browser skills get <name>` output before writing a vendoring task |

The quality bars the human imposed implicitly: prove the production app does **not** open 9222,
capture a **real** screenshot (not a claim), and pin exact upstream provenance.

## 6. Skills, tools & memory created — and why they're effective

- **`packages/extension/.pi/skills/browser/` (universal `browser` skill).** Replaces
  `browser-visual-debug` with one skill that routes web vs. Electron automatically (port-9222 +
  process probe). Vendored from `agent-browser` (Apache-2.0) with `UPSTREAM.md` pinning tag
  v0.27.0 / commit `c830d1b6` / CLI 0.27.0. *Effective because* it ships in the extension tarball
  (verified via `npm pack`), so every session gets it, and provenance makes future re-syncs
  mechanical. Invoke it whenever you automate a web page **or** the dashboard's Electron shell.
- **`resolveCdpActivation` helper + `dev:cdp` script.** Pure, I/O-injected decision function gated
  by an explicit flag; `--debug-cdp` binds DevTools to `127.0.0.1:9222` loopback only, and a
  `no-remote-debugging-address` repo-lint test forbids the dangerous form. *Effective because* CDP
  is now opt-in dev-only with a test that fails if anyone reintroduces remote debugging.
- **`debug-dashboard/references/ui-debug.md`.** New reference wiring the browser skill into the
  dashboard debug flow.
- **Subagents:** two `Explore` agents (file-index docs update; sync 4 delta specs) — used per the
  repo's doc/apply protocols instead of the main agent editing `docs/` directly.

## 7. Pitfalls & dead ends

- **Spec on the wrong branch.** If a worktree "on develop" is missing the change dir, check
  `origin/openspec/<name>` and cherry-pick the spec commit — don't rebuild artifacts by hand.
- **Upstream has no static skill files.** `agent-browser` ships a discovery stub; the real content
  comes from `agent-browser skills get core|electron`. Capture that output; don't scrape a repo path.
- **Worktree lacks `node_modules/electron`.** `npm run dev:cdp` can't launch until you install
  electron in the worktree (`npm i` / install electron) — the parent repo's modules aren't inherited.
- **Self-inflicted lint failure.** The `no-remote-debugging-address` lint flagged the AI's own
  explanatory comment in `main.ts`; rephrase comments to avoid the forbidden literal.
- **Pre-existing test noise.** 3 electron test files / 5 tests and `browse-endpoint.test.ts` fail on
  develop independently (env/`node_modules`-in-cwd). Confirm they fail before your change so you don't
  chase them; verify your new tests pass in isolation with `HOME=$(mktemp -d) npx vitest run <file>`.
- **Don't commit `.pi/settings.json`.** It's a local-machine path tweak — exclude it from the push.

## 8. Reproduce it faster — checklist

**Inputs to have ready:** the OpenSpec change name, its `origin/openspec/<name>` branch, a locally
installed `agent-browser` CLI (v0.27.0+), and electron installable in the worktree.

- [ ] Worktree = develop; cherry-pick the spec commit from `origin/openspec/<name>`.
- [ ] `/skill:openspec-apply-change <name>`; read all context; publish a working order.
- [ ] `agent-browser skills get core|electron` → vendor into `references/web.md` + `references/electron.md`; write `UPSTREAM.md` with tag/commit/CLI.
- [ ] TDD the CDP switch: `resolve-cdp-activation.test.ts` (red) → helper → wire `main.ts` before single-instance lock → `no-remote-debugging-address` lint → `dev:cdp` script.
- [ ] `SKILL.md` auto-detect (probe :9222 + `pgrep "Pi Dashboard"`); wire `pi.skills[]`/`files[]`; registration test; `npm pack --dry-run`.
- [ ] Delete `browser-visual-debug`; sweep references; delegate `docs/` to a subagent.
- [ ] Browser gates via `agent-browser`: `dev:cdp` up → connect :9222 → real screenshot; prod app has no :9222; preflight halts sans CLI.
- [ ] `/skill:openspec-archive-change <name>` (syncs 4 delta specs) → commit & push (exclude `.pi/settings.json`).

**Final artifacts:** `packages/extension/.pi/skills/browser/{SKILL.md,UPSTREAM.md,references/*}`,
`packages/electron/src/lib/resolve-cdp-activation.ts` (+test), `packages/shared/src/__tests__/no-remote-debugging-address.test.ts`,
`packages/extension/src/__tests__/browser-skill-registered.test.ts`,
`.pi/skills/debug-dashboard/references/ui-debug.md`, updated `main.ts` / `README.md` / `AGENTS.md`.

---

_Generated from session `019e6bc2-2ed2-7732-b1a0-1bc7a7955dc8` · `/Users/robson/Project/pi-agent-dashboard` · 2026-05-28. Source extract: deterministic facts sheet._
