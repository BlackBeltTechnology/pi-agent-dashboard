---
session: 019e04b4
week: 2026/W19
type: development
model: "@fast"
premium: true
premium_reason: "heavy steering (16 user prompts); large facts sheet (~14457 tok)"
upgrade_status: pending
openspec_changes: [honcho-dashboard-plugin]
proposal_excerpt: "`pi-memory-honcho` (acsezen) ships persistent cross-session memory for pi via Honcho, but every user-facing surface lives behind TUI slash-commands (`/honcho:setup`, `/honcho:doctor`, `/honcho:interview`, …). Dashboar…"
---

# How we did it: shipping the Honcho dashboard plugin — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The kickoff prompt was the standard `/opsx:apply` OpenSpec runner pointed at the
`honcho-dashboard-plugin` change:

> "Implement tasks from an OpenSpec change… Using change: honcho-dashboard-plugin."

The change started at 54/103 tasks. The *real* objective — clarified across 16 steering
turns — was to take `pi-memory-honcho` (a TUI-only memory extension) and surface all of
its controls inside the pi-agent-dashboard as a first-class plugin: a settings panel with
install gate, self-host server lifecycle, LLM model picker, doctor/sync/interview flows,
plus per-session-card badges and action buttons — and to make every one of those pixels
look native next to the existing `jj` badge. The task split into two distinct halves:
**build the feature** (mostly autonomous, spec-driven) and **make it look right**
(entirely human-in-the-loop, screenshot-driven pixel correction).

## 2. TL;DR playbook

1. Run `/opsx:apply honcho-dashboard-plugin`; let it read context files + an existing
   plugin (`demo-plugin`, `jj-plugin`) for client/server patterns before writing code.
2. Build the client in logical batches (API helpers → hooks → main panel → sub-sections
   → per-card slots), running `npx tsc --noEmit -p packages/honcho-plugin/tsconfig.json`
   after each batch.
3. Run tests with a scratch HOME to avoid touching real config:
   `HOME=$(mktemp -d) npx vitest run packages/honcho-plugin`.
4. For install tracking, **don't** poll — listen to the dashboard's existing
   `pi-package-event` window CustomEvents and match on `operationId` from the 202 response.
5. When a runtime symptom appears (blank panel, "no config"), **verify the real API shape
   with `curl`** before editing — the fix is usually a field-name mismatch, not logic.
6. For every visual complaint, **drive the browser skill**: screenshot → measure actual
   px via `getBoundingClientRect` in browser eval → fix → re-measure. Never eyeball.
7. Commit surgically with `git` directly (colocated jj mode) — stage only this change's
   files, leave parallel sessions' files untouched.

## 3. How the collaboration unfolded

**Phase A — Autonomous feature build (prompt 1).** The AI read the specs and an existing
plugin, then generated the entire client surface in batches: `api.ts`, `hooks.ts`,
`HonchoSettings.tsx` and ~12 sub-components, plus server-side status-broadcast wiring
(`setBroadcaster`). It self-verified with `tsc` + vitest after each batch and marked
tasks in `tasks.md`. This moved 54→90 tasks with zero human intervention. *Why it worked:*
the model grounded itself in a sibling plugin's patterns first, so its output matched
house conventions instead of inventing new ones.

**Phase B — Runtime-truth debugging (prompts 2, 4, 6).** Three "it doesn't work" reports
(install not tracked; settings blank though installed; "no config"). Each was root-caused
by inspecting the *actual* API response with `curl`, revealing the real shape
(`{success, data:[{source:"npm:pi-memory-honcho", displayName, …}]}` with **no `name`/`id`
field**) and one genuine core bug: the plugin failed to load with *"Fastify instance is
already listening. Cannot add route!"* because `loadServerEntries` ran **after**
`fastify.listen()`. The fix moved plugin loading before listen. *Decision point:* the user
was running the Electron-bundled dashboard, so a `packages/server` source fix wouldn't take
effect without a rebuild — noted, not silently assumed working.

**Phase C — Pixel-perfect visual polish (prompts 7–13).** Seven consecutive "icons
inconsistent / badge mixing with jj / alignment off" turns. The AI switched from emoji to
`@mdi/react`, then measured everything in-browser and peeled back a stack of CSS bugs:
missing `text-[10px]` inflating button height; a block `<div className="relative">` wrapper
inheriting a 24px line-box; SVG-vs-text baseline offsets between `inline-flex` siblings;
and Tailwind purging `align-middle` because the plugin source sits outside the dashboard's
content-scan (fixed with an inline `verticalAlign:"middle"` style). *Why it worked:* every
fix was validated against real `getBoundingClientRect` numbers, not vibes.

**Phase D — Surgical commits (prompts 14, 16).** Two focused `git` commits, staging only
Honcho files and explicitly listing the 23 files left untouched because they belonged to
other parallel sessions.

## 4. Prompts that worked

- **The goal prompt** (`/opsx:apply honcho-dashboard-plugin`) — effective because it hands
  the model a spec with a task checklist and context-file paths, so it self-directs. Good
  kickoff for any large, well-specced build.
- **"honcho install does not track… visual indication have to be presented"** — a precise
  symptom + desired outcome. Unlocked the whole `usePackageInstall` event-listener design.
- **"Honcho has no config [image]" / "settings screen shows [image]"** — attaching the
  screenshot let the AI reproduce and root-cause instead of guessing.
- **"use browser and fix"** — the single highest-leverage steer: it authorized the AI to
  measure and iterate autonomously, ending the back-and-forth on visual bugs.

Rewrite of a weak prompt: instead of *"icon sizes inconsistent"* (given three times), a
stronger one-shot is *"the honcho card icons don't match the jj badge — use the browser to
measure both with getBoundingClientRect and make them identical."*

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Assume the install POST succeeded with no UI feedback | "does not track… visual indication have to be presented" | Wire `usePackageInstall` to `pi-package-event` from the start |
| Match installed packages on `p.name`/`p.id` | "honcho is installed but settings shows [gate]" | `curl /api/packages/installed` first; match on `source` |
| Trust source edits took effect | Server still broken after fix | Confirm dev vs Electron-bundled mode (`/api/health` `mode`) before claiming fixed |
| Use emoji + eyeball icon sizes | "icon sizes inconsistent" ×3, "use browser and fix" | Use `@mdi/react`; measure px in-browser, never eyeball |
| Style the badge as a plain `<span>` merging with siblings | "honcho is mixing with jj" | Copy the sibling badge's exact class vocabulary (pill: `inline-flex px-1.5 rounded`) |
| Rely on Tailwind `align-middle` class | Alignment still off — class was purged | Inline `verticalAlign:"middle"` for source outside the content scan |
| Commit everything staged | "commit staged files related to THIS change" | Stage explicitly; enumerate untouched parallel-session files |

## 6. Skills, tools & memory created — and why they're effective

No skills or memories were created this session. Two subagents were delegated:
- **`Explore`** — "Investigate package install tracking": isolated the read-only hunt for
  how the dashboard reports install progress, keeping that search out of main context.
- **`general-purpose`** — added the honcho-plugin row to the docs file-index in caveman
  style, honoring the repo's "docs writes go through a subagent" protocol.

*Recommended skill to create:* a **`pixel-align-dashboard-icon`** procedure capturing the
browser-measure→fix→re-measure loop and the three recurring CSS traps (missing
`text-[10px]`, block-wrapper line-box inflation, `inline-flex` SVG-baseline offset, purged
Tailwind classes on out-of-scan plugin source). Seven steering turns here were one
repeatable procedure.

## 7. Pitfalls & dead ends

- **`curl -X POST /api/restart` returned nothing / didn't restart** → fall back to
  `pi-dashboard restart` then `pi-dashboard start --dev`; verify with `pi-dashboard status`.
- **Plugin silently absent** → check `/api/plugins` for `{loaded:false, error:"Fastify …
  already listening"}`; the real fix is ordering `loadServerEntries` before `fastify.listen()`.
- **Source fix "doesn't work"** → you may be on the Electron-bundled build; check
  `/api/health` `mode` is `dev` not `production`.
- **`npm test` failed** (18 failed cmds overall) → scope to the package with a scratch HOME:
  `HOME=$(mktemp -d) npx vitest run packages/honcho-plugin`.
- **Tailwind `align-middle` not shipping** → plugin source is outside the dashboard's
  content scan, so unused classes are purged; use an inline style.
- **`mdiBrain` looks smaller than `mdiSync` at same `size`** → MDI glyphs aren't
  viewbox-normalized; the *real* consistency fix was `text-[10px]` + wrapper line-box, not
  per-icon size compensation (that overshot).

## 8. Reproduce it faster — checklist

**Inputs to have ready:** the OpenSpec change name, a running dashboard (know whether it's
dev or Electron-bundled), `pi-memory-honcho` installed, browser skill available.

- [ ] `/opsx:apply honcho-dashboard-plugin`; let it read a sibling plugin for patterns.
- [ ] Build client in batches; `tsc --noEmit` per batch; `HOME=$(mktemp -d) npx vitest run` the package.
- [ ] Install tracking via `pi-package-event` listener + `operationId`, not polling.
- [ ] For every runtime symptom, `curl` the real API shape before editing.
- [ ] For plugin-not-loading, check `/api/plugins`; ensure `loadServerEntries` precedes `listen()`.
- [ ] For every visual bug, screenshot → `getBoundingClientRect` in browser eval → fix → re-measure.
- [ ] Match the sibling badge's exact classes; inline `verticalAlign:"middle"` for purge-safe alignment.
- [ ] Commit surgically with `git`; stage only this change's files; list untouched parallel-session files.

**Artifacts produced:** the full `packages/honcho-plugin/` client + server + tests + README,
`openspec/changes/honcho-dashboard-plugin/` (proposal/tasks), a `pi-memory-honcho` entry in
`packages/shared/src/recommended-extensions.ts`, a `manifest-discoverability.test.ts`, and
the core fix in `packages/server/src/server.ts` (loader before listen). Commits
`2d42e006` (feat, 61 files) and `56318b55` (5 files). 93/103 tasks done; remainder deferred
(Docker/E2E/npm-publish infra).

---

_Generated from session `019e04b4-9a96-707f-b7f0-11c3e7979146` · `/Users/robson/Project/pi-agent-dashboard` · 2026-05-09. Source extract: `/tmp/facts-honcho-16634.md`._
