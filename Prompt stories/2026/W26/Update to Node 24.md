---
session: 019f07e7
week: 2026/W26
type: planning
model: "@fast"
premium: true
premium_reason: "heavy steering (6 user prompts)"
upgrade_status: pending
openspec_changes: [default-node-24-keep-22-floor]
proposal_excerpt: "The Docker all-in-one base image and the standalone-install test script both default to `node:22-bookworm-slim`. Node 22 is fine, but the project already runs Node 24 (and 25) green in CI smoke and uses Node 24 for th…"
---

# How we did it: Update to Node 24 — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The session opened in **explore mode** (`openspec-explore` skill) with an intentionally
loose framing: *"Update to Node 24."* No scope, no file list, no acceptance bar — a
thinking-partner prompt, not an implementation order. The real objective, which the
steering turns sharpened, was: **decide whether the project's default runtime can move
from Node 22 to Node 24 without breaking anything, prove the native-module risk is
retired, and capture the decision as a validated OpenSpec proposal — with zero code
changes.** The deliverable was a proposal directory, not a diff.

## 2. TL;DR playbook

1. Enter explore mode (`openspec-explore`) — this *forbids* implementation and keeps the
   AI in decide-and-document mode. Good, because a runtime bump is a decision first.
2. Ask the AI to **ground the claim in the codebase before reasoning**: where is Node 22
   actually pinned, and what already allows 24? (It found 24 was *already* partly adopted.)
3. Steer straight at the real risk: **"Grep native modules."** This narrows a vague "ABI
   breakage" fear to the one runtime module that gates a host-Node bump: `node-pty`.
4. Let it prove the ABI question concretely — inspect `node-pty`'s prebuild layout to show
   the binary is **N-API / ABI-stable** (one `prebuilds/<plat>-<arch>/pty.node`, no Node
   version token) → Node 24 loads the identical binary, no recompile.
5. Ask for a **"sketch"** (minimal, non-applied diff) so you see the exact lines before
   committing to a proposal. Keeps explore mode honest.
6. Say **"create a proposal"** — the AI runs the coherence check, scaffolds the OpenSpec
   dir manually (CLI `change new` was unavailable), writes proposal/design/tasks + a
   MODIFIED docker-packaging delta, and validates with `openspec validate --strict`.
7. Say **"commit"** — and insist the commit stays **surgical**: revert unrelated
   auto-regenerated `groups.json` churn, add only the proposal directory.

## 3. How the collaboration unfolded

**Discovery (ground the claim).** The AI's first move was not to answer but to map where
Node 22 lives. It produced a layer table showing `engines.node` already allows `>=22 <26`,
CI smoke already tests 24/25, `publish.yml` already runs Node 24, and only two places
default to 22: `docker/Dockerfile` (the all-in-one base) and the standalone-install test
script. *Why it worked:* it reframed "upgrade to 24" as "raise two defaults; 24 is already
live elsewhere" — shrinking the change before designing it.

**Risk narrowing ("Grep native modules").** The single steering word collapsed a generic
ABI worry into a concrete inventory: only `node-pty` is a *runtime* native dep that rides
the host Node (sharp lives inside Electron's own bundled Node ~20, decoupled). Everything
else with `.node`/`binding.gyp` is dev/build tooling, prebuilt per-platform.

**Proof (the ABI smoking gun).** The AI inspected `node-pty 1.2.0-beta.13`: it depends on
`node-addon-api` (N-API), ships `prebuilds/<platform>-<arch>/pty.node` with **no Node
version token**, and its loader does zero version matching. Conclusion: Node 24 loads the
same `linux-x64/pty.node` Node 22 loads — the bump is a binary no-op, no node-gyp/python/
g++ needed in the image. This is the decision-maker.

**Sketch (decision point).** The human asked for a "sketch," not edits. The AI produced a
precise, non-applied diff: `docker/Dockerfile` `node:22-bookworm-slim → node:24-bookworm-slim`
(keep `-bookworm-` glibc, *not* alpine — glibc is pinned specifically for node-pty's
prebuild) plus the test-script default. It also noted `@types/node` is transitive-only, so
there's nothing top-level to bump — trimming the diff further.

**Generate + verify.** On "create a proposal," the AI ran the coherence check against
existing/archived changes (the archived `2026-06-21-docker-packaging` Decision 2 pins glibc
for node-pty → the proposal stays coherent by keeping `-bookworm-`), scaffolded the dir
manually, wrote the four artifacts, and passed `openspec validate --strict`.

**Commit (surgical).** On "commit," the AI caught that `openspec/groups/groups.json` had
been auto-regenerated with unrelated reordering/removals, reverted it, and committed only
the proposal directory (`bc71d7fe`, 4 files, no code touched).

## 4. Prompts that worked

- **Goal prompt — `openspec-explore` + "Update to Node 24."** Effective because the explore
  stance guarantees the AI *decides and documents* rather than jumping to edits. For a
  runtime bump where risk analysis is the real work, this is the right kickoff. A stronger
  variant states the intended output up front: *"Explore whether we can default to Node 24;
  end with an OpenSpec proposal if it's safe, no code."*
- **`Grep native modules`** — highest-leverage follow-up in the session. Three words that
  redirected the AI from hand-wavy ABI fear to a concrete, provable inventory.
- **`sketch`** — forced a see-the-exact-lines checkpoint before committing to a proposal,
  preserving explore-mode discipline.
- **`create a proposal` / `commit`** — short unlock prompts that let the AI run its full
  scaffold-validate and surgical-commit routines. Effective because the groundwork (grounding,
  risk proof, sketch) was already done, so these needed no elaboration.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Reason about ABI risk generically | "Grep native modules" | State "prove the native-module risk concretely — inventory runtime native deps first" in the goal |
| Be ready to draft the proposal early | "sketch" (show the exact diff, don't apply) | Ask for a non-applied diff sketch before any proposal in explore mode |
| Treat the change as a full upgrade | (implicit via grounding) | Frame it as "raise two defaults; keep 22 as floor" — non-breaking scope |
| Commit whatever `git status` showed | insist the commit stay surgical | Say "commit only the proposal dir; revert unrelated auto-regenerated files" |

## 6. Skills, tools & memory created — and why they're effective

No new skill or memory was created — this was a one-shot exploration. The **`openspec-explore`**
skill did the heavy lifting: its no-implementation stance is exactly why the session stayed a
clean decision-capture instead of drifting into edits.

**Skill worth creating:** a *runtime-version-bump proposal* playbook — "grounding table →
native-module inventory → N-API prebuild ABI proof → non-applied sketch → coherence check →
scaffold + `openspec validate --strict` → surgical commit." The sequence is reusable for any
future Node/Electron/base-image bump and the N-API prebuild reasoning is the transferable core.

## 7. Pitfalls & dead ends

- **`openspec change new` was not valid** in this CLI version → the AI scaffolded the change
  directory manually in the standard OpenSpec layout. If the CLI subcommand fails, hand-create
  `openspec/changes/<name>/{proposal,design,tasks}.md` + `specs/<cap>/spec.md`.
- **`openspec/groups/groups.json` auto-regenerates** on openspec CLI calls, carrying unrelated
  reordering/removals of *other* changes. If it shows up dirty, `git checkout --` it and commit
  only your change dir — the CLI regroups cleanly later.
- **Don't switch to Alpine when bumping the base image.** glibc (`-bookworm-`) is pinned
  specifically for node-pty's prebuild (archived docker-packaging Decision 2). Alpine/musl is a
  separate axis — out of scope for a version bump.
- **A MODIFIED OpenSpec delta needs ≥1 scenario** or `validate --strict` fails — the new
  "Base image runs Node 24" requirement carries its own scenario.

## 8. Reproduce it faster — checklist

**Inputs to have ready:** repo at `develop`, `openspec` CLI, the archived docker-packaging
change for coherence context.

1. Enter `openspec-explore`; state the goal + intended proposal output, no code.
2. Ground: table of where the version is pinned and what already allows the new one.
3. Inventory *runtime* native deps (`node-pty`, sharp-in-Electron); ignore dev/build tooling.
4. Prove ABI safety: inspect the prebuild layout — N-API + no version token = binary no-op.
5. Produce a non-applied **sketch** (exact diff lines); confirm glibc stays.
6. Coherence check vs existing/archived changes.
7. Scaffold `openspec/changes/<name>/` (manually if CLI subcommand fails); write the four
   artifacts incl. a MODIFIED delta with a scenario.
8. `openspec validate <name> --strict`.
9. `git checkout -- openspec/groups/groups.json`; `git add openspec/changes/<name>/`; commit.

**Artifacts produced:**
- `openspec/changes/default-node-24-keep-22-floor/proposal.md`
- `openspec/changes/default-node-24-keep-22-floor/design.md`
- `openspec/changes/default-node-24-keep-22-floor/tasks.md`
- `openspec/changes/default-node-24-keep-22-floor/specs/docker-packaging/spec.md`
- commit `bc71d7fe` on `develop` (proposal only, no code)

---

_Generated from session `019f07e7-6575-767e-86d5-7d05dce6546f` · `/Users/robson/Project/pi-agent-dashboard` · 2026-06-27. Source extract: `/tmp/session_facts.vji6hm.md`._
