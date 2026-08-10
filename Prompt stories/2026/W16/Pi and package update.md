---
session: 0d1d9972
week: 2026/W16
type: development
model: "@fast"
premium: true
premium_reason: "heavy steering (14 user prompts)"
upgrade_status: pending
openspec_changes: [pi-core-version-checker]
proposal_excerpt: "Pi's `DefaultPackageManager` manages extensions, skills, prompts, and themes listed in `settings.json packages[]`. However, **core pi ecosystem CLI packages** — `@mariozechner/pi-coding-agent` (pi itself), `@blackbelt…"
---

# How we did it: Pi ecosystem version checker & self-updater — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The operator opened in explore mode:

> `/skill:openspec-explore` — "Add the possibility to update pi modules (pi-mono). In
> settings be an pi version checker and be able to update when new version is released"

The *real* objective, once the early steering turns pinned it down: give the dashboard a
**pi ecosystem version manager** — detect the installed versions of core pi CLI packages
(pi itself, dashboard, model-proxy, and other `pi-*` packages) across **both** install
paths (global npm and the Electron-managed `~/.pi-dashboard/node_modules`), compare each
against the npm registry, surface a **header badge + Settings section**, one-click update
them, and **auto-reload** affected sessions. Crucially, this is scoped to *core CLI
packages that pi's own `DefaultPackageManager` does NOT manage* — extensions/skills/
prompts/themes were already covered.

## 2. TL;DR playbook

1. Kick off in **`/skill:openspec-explore`** — don't jump to code. Let the AI map "what
   exists vs. what's needed" first.
2. Answer the scoping questions concretely: *all install paths, all scopes, both update +
   check, auto-reload, handle both scenarios.*
3. Force a **reuse audit** before design: "there is a recommended-extensions system — does
   it overlap?" This is what narrowed the scope from "rebuild everything" to "core CLI
   packages only."
4. Fast-forward the artifacts: **`/opsx:ff`** → proposal + design + tasks (+ specs). Result
   was 37 tasks / 6 groups.
5. Insert a **verification gate before implementing**: "check the current package manager
   handles install/update/version-checking correctly." Confirmed the existing layer works
   → avoided re-inventing it.
6. **`/opsx:apply`** in task groups: server checker → routes/shared types → client hook →
   Settings section → header badge → docs. Run **focused vitest per file**, never the full
   suite.
7. **`/opsx:verify`** requirement-by-requirement, then **`/opsx:archive`** (sync delta
   specs to main), **commit**, **build & deploy** (`npm run build` → `POST /api/restart` →
   `npm run reload`).
8. Manually hit the live endpoint to prove real-world behavior before declaring done.

## 3. How the collaboration unfolded

**Phase 1 — Discovery (explore mode).** The AI grepped the existing package system,
inspected pi's `DefaultPackageManager` type defs, found pi installed globally
(`@mariozechner/pi-coding-agent@0.67.1`), and produced a Mermaid map of the gap: no
mechanism to check pi's own version or update pi itself. *Why it worked:* it separated
"what pi already manages" (plugins) from "what nobody manages" (the core CLIs).

**Phase 2 — Reuse audit (the pivotal steer).** The human interrupted design with "there is
recommended-extensions developed recently — recheck it effects that proposal." The AI
re-mapped already-built vs. needed and found **significant overlap** — `fetchPackageMeta()`,
the `PackageManagerWrapper` busy-lock, `package_operation_*` WS messages, the
`usePackageOperations` hook pattern were all reusable. This collapsed the scope to *core CLI
packages only*, with heavy reuse instead of rebuild.

**Phase 3 — Design/artifacts (`/opsx:ff`).** proposal.md (problem, scope boundaries, reuse
map), design.md (architecture diagrams, data model, error handling), tasks.md (37 tasks / 6
groups), plus two ADDED delta specs (`pi-core-version-check`, `pi-core-version-ui`). Noted
the pre-existing `dependency-auto-update` spec was Electron-only; this extends it to the web
dashboard.

**Phase 4 — Pre-implementation audit.** "Check that current package manager handling
installation/update/version-checking correctly." The AI verified each layer against pi's
real source + tests + the **live running server** (curl'd `/api/packages/installed`), proved
`check-updates` returned `[]` because installed == registry — i.e. the existing flow was
correct, not broken.

**Phase 5 — Implementation (`/opsx:apply`).** Built in groups, focused vitest per file:
server `pi-core-checker.ts` (discover global + managed, 5-min cache) → `pi-core-updater.ts`
(npm update with progress streaming, shared busy-lock, session reload) → routes → shared
types → client `usePiCoreVersions` hook (30-min poll + WS refetch) → `PiCoreVersionsSection`
→ `PiUpdateBadge` in the header. Server tests grew 19→38; client 14.

**Phase 6 — Verify → archive → deploy.** `/opsx:verify` traced 11/11 requirements and 32/32
scenarios to code; fixed a design-doc drift (typed WS messages) and broadened a
permission-error regex (`EACCES|EPERM|EROFS`). Archived + synced specs, committed, then
**build & deploy**: `npm run build` → `POST /api/restart` → `npm run reload`. Live endpoint
discovered 8 real pi packages and correctly flagged one update.

**Phase 7 — The tail bug.** Final steer: "the update badge state is not updated after
updating a package." Root cause: server broadcast `pi_core_update_progress` but **never**
`pi_core_update_complete`, so the badge's separate hook instance kept a stale count until
the 30-min poll. Fix: add an `onUpdateComplete` callback wired to
`broadcastToAll({ type: "pi_core_update_complete" })`, plus a test, rebuild, redeploy.

## 4. Prompts that worked

- **The goal prompt** (`/skill:openspec-explore` + one sentence): effective because it
  entered *explore* mode instead of demanding code — the AI mapped the terrain first.
  Stronger version: name the two install paths and the "core CLI, not plugins" scope in the
  opening sentence to skip a round-trip.
- **"There is recommended-extensions developed recently. Recheck it effects that
  proposal."** — the single highest-leverage prompt. It forced a reuse audit that halved the
  scope. Bake this in: *always ask "what already exists that overlaps?" before design.*
- **"Check that current package manager handling installation/update/version-checking
  correctly."** — a verification gate that confirmed the foundation before building on it.
- **"the update badge state is not updated after update a package"** — a precise,
  observable bug report (state + trigger + symptom) that let the AI go straight to the
  missing WS broadcast.
- **Terse unlocks** — "yes", "fix", "commit changes", "build and deplo" — worked because the
  surrounding openspec workflow had already established context.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Scope broadly (build a whole new version system) | "recheck recommended-extensions effects that proposal" | Open with an explicit reuse-audit instruction |
| Consider only one install path | "check pi install, global install AND dashboard node_modules too" · "handle both scenario" | State *all* install paths + scopes in the goal prompt |
| Proceed to build without validating the base | "check current package manager handles install/update/version-check correctly" | Add a pre-implementation "verify the foundation" gate |
| Run the **full** test suite (which killed the session) | "the full test killed the session, ignore it" | Always run **focused vitest per file**, never the whole suite mid-implementation |
| Assume the sync POST response is enough to refresh UI | "the badge state is not updated after update" | Ensure every async op broadcasts a *completion* WS event, not just progress |

## 6. Skills, tools & memory created — and why they're effective

No new skill or memory was created this session — the work rode entirely on the existing
**OpenSpec workflow skills** (`openspec-explore` → `opsx:ff` → `opsx:apply` → `opsx:verify`
→ `opsx:archive`) and the repo's build/deploy triad.

**Skill worth creating:** a *"pi ecosystem package audit"* note capturing the two install
paths (global npm vs. `~/.pi-dashboard/node_modules`), the `looksLikePiEcosystem` heuristic,
and the reuse targets (`fetchPackageMeta`, `PackageManagerWrapper` busy-lock,
`package_operation_*` WS pattern). It would remove the ~15 exploratory greps this session
spent rediscovering them.

**Reusable pattern that proved effective:** *badge + Settings section as two independent
`usePiCoreVersions` hook instances* — but this is exactly what caused the tail bug. The
lesson: independent hook instances MUST both listen for a completion WS event; a synchronous
POST response only refreshes the caller.

## 7. Pitfalls & dead ends

- **Full test suite killed the session.** Mid-implementation, run only the touched files:
  `npx vitest run packages/server/src/__tests__/<file>.test.ts`. Never the whole suite.
- **`openspec change new pi-core-version-checker` failed** — fall back to `mkdir -p
  openspec/changes/<name>` + manual scaffold when the CLI subcommand isn't available; check
  `openspec change --help` first.
- **Comment parser choked on the `@*/pi-*` glob pattern** in the discovery heuristic — needed
  an escaping fix in `pi-core-checker.ts`.
- **Aliased package returns `latestVersion: null`** (`@blackbelt-technology/pi-dashboard` not
  on public npm) — handle gracefully, don't treat null-latest as an error.
- **Progress-without-completion WS bug** — broadcasting only `*_progress` leaves any listener
  that doesn't also read the POST response with stale state. Always emit `*_complete`.
- **`tsbuildinfo` files** are untracked build artifacts — exclude them from the commit.

## 8. Reproduce it faster — checklist

**Inputs to have ready:** a running dashboard server (`localhost:8000`), pi installed
globally (`npm list -g @mariozechner/pi-coding-agent`), npm registry access.

1. `/skill:openspec-explore` — state up front: both install paths (global + managed), all
   scopes, check + update, auto-reload, **core CLI packages only (not plugins)**.
2. Force a reuse audit vs. the recommended-extensions / package-management systems.
3. `/opsx:ff <name>` → proposal + design + tasks + delta specs.
4. Verify the existing package-manager layer works (curl the live endpoint) before building.
5. `/opsx:apply` in groups; **focused vitest per file** only.
6. `/opsx:verify` (requirement→code trace) → `/opsx:archive` (sync specs) → commit.
7. Deploy: `npm run build` → `curl -X POST localhost:8000/api/restart` → `npm run reload`.
8. Confirm every async op broadcasts a `*_complete` WS event so all hook instances refetch.

**Final artifacts produced:**
- `openspec/changes/archive/2026-04-19-pi-core-version-checker/` (proposal, design, tasks, 2 specs)
- `packages/server/src/pi-core-checker.ts`, `pi-core-updater.ts`, `routes/pi-core-routes.ts` (+ tests)
- `packages/client/src/hooks/usePiCoreVersions.ts`, `components/PiCoreVersionsSection.tsx`, `components/PiUpdateBadge.tsx` (+ tests)
- Edits to `rest-api.ts`, `browser-protocol.ts`, `package-manager-wrapper.ts`, `server.ts`, `useMessageHandler.ts`, `SettingsPanel.tsx`, `App.tsx`, `AGENTS.md`, `docs/architecture.md`
- Commits `cf3ab84` (feature) and `e368d27` (badge-refresh fix) on `develop`

---

_Generated from session `0d1d9972` · `/Users/robson/Project/pi-agent-dashboard` · 2026-04-19. Source extract: session facts sheet (mktemp)._
