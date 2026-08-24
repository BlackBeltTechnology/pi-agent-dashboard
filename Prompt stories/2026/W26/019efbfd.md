---
session: 019efbfd
week: 2026/W26
type: planning
model: "@fast"
premium: false
premium_reason: ""
upgrade_status: n/a
openspec_changes: [configurable-bind-host, selectable-tool-output-links]
proposal_excerpt: "The dashboard HTTP server binds to `0.0.0.0` unconditionally (`packages/server/src/server.ts` — `fastify.listen({ port, host: \"0.0.0.0\" })`), and the pi gateway WebSocket server binds all interfaces by omitting `host`…"
---

# How we did it: Turning a terse security issue into a validated OpenSpec proposal — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The session opened in **explore mode** — a deliberate "think, don't implement" stance.
The kickoff prompt loaded the `openspec-explore` skill:

> *"Enter explore mode. Think deeply. Visualize freely. Follow the conversation
> wherever it goes… you must NEVER write code or implement features."*

The *real* objective surfaced immediately from the subject matter: GitHub **issue #48**
complains that the dashboard binds `0.0.0.0` ("jiti listen on 0.0.0.0 — it's a bad
solution. Please default to 127.0.0.1"). The user wanted to (a) understand the true
security model, (b) decide whether `127.0.0.1` is a safe default, and (c) if warranted,
capture the thinking as an **OpenSpec change proposal** and update the issue — all
without writing implementation code. Two short steering turns then pushed it from
exploration → drafted proposal → committed and pushed.

## 2. TL;DR playbook

1. **Start in explore mode** — load `openspec-explore` so the model reads/searches but
   never implements. This keeps the output a *proposal*, not a half-baked patch.
2. **Pull the issue via API, not the browser** — `curl -s -o /tmp/issue48.json
   "https://api.github.com/repos/<owner>/<repo>/issues/48"` (the GitHub web page gives a
   login wall to the agent).
3. **Grep the bind surface, not just the one line** — search every listener:
   `grep -rn "listen\|0\.0\.0\.0\|127\.0\.0\.1\|host:\|WebSocketServer" packages/server/src/*.ts`.
   This is what turned a one-line fix into a *three-listener inconsistency* finding.
4. **Map the config/CLI chain** — trace `DashboardConfig` (shared) → `ServerConfig`/
   `buildConfig` (cli.ts) → the `listen()` call, so you know where a new `host` field lives.
5. **Run the coherence check** — `openspec list` + grep the archive for `host/bind/listen`
   to prove no active/archived change collides before scaffolding.
6. **Mirror an existing change's structure** — `cat` a sibling change
   (`selectable-tool-output-links`) for its `.openspec.yaml` + `spec.md` shape instead of
   guessing the conventions.
7. **Write the four artifacts** — `proposal.md`, `design.md`, `tasks.md`,
   `specs/<capability>/spec.md`, then `openspec validate <change>` until clean.
8. **Post the summary to the issue** — `gh issue comment 48 --body-file /tmp/…md`.
9. **Commit surgically** — `git reset HEAD .` then `git add` only your change dir, so
   pre-existing staged files stay untouched; commit referencing #48 and push.

## 3. How the collaboration unfolded

**Phase 1 — Discovery (read the real problem).** The AI resisted the reflex to "fix
127.0.0.1." It fetched issue #48 through the GitHub API (the web UI blocked it), found
the offending `fastify.listen({ port, host: "0.0.0.0" })` at `server.ts:1476`, then read
the surrounding request/upgrade guard. *Why it worked:* it reframed the complaint as
**defense-in-depth**, not "wide open" — there's already a loopback/trusted-CIDR/auth-cookie
guard in front of the socket. That context shaped a proportionate proposal instead of a
panic patch.

**Phase 2 — Surface mapping (widen the blast radius).** Grepping *all* listeners revealed
three with inconsistent binding: HTTP fastify → `0.0.0.0`; pi-gateway WS →
`new WebSocketServer({ port })` with **no host** (also all interfaces); model-proxy →
already `127.0.0.1`. *Decision point:* this finding is what justified a "one host setting,
applied consistently" design rather than a single-line change.

**Phase 3 — Design (settle the questions).** With the config chain mapped
(`DashboardConfig` → `buildConfig` → listeners) and no existing `host` field confirmed,
the AI resolved the user's three questions: constrained 3-way picker (Local / All /
Specific NIC) reusing `/api/network-interfaces`; `127.0.0.1` is a good native default with
a Docker opt-in caveat; restart-required.

**Phase 4 — Generate (steering turn: "draft proposal and update the github issue").**
Ran the OpenSpec coherence check, mirrored a sibling change's file layout, then wrote all
four artifacts + `.openspec.yaml`, validated clean, and posted a summary comment on #48.

**Phase 5 — Ship (steering turn: "commit and push", hours later).** Noticed **pre-existing
staged changes that weren't its own** (`docs/examples/c4-example.md`,
`openspec/groups/groups.json`), reset the index, added only its proposal dir, committed
referencing #48, and pushed to `develop`.

## 4. Prompts that worked

- **The goal prompt (explore-mode skill load).** Effective because it fixed the *stance*
  up front: "think, don't implement." The model produced a proposal and design artifacts
  instead of editing `server.ts`. Reuse this whenever you want analysis + an OpenSpec
  change, not code.
- **High-leverage follow-up: `"draft proposal and update the github issue"`.** Seven words
  that unlocked the entire generate phase — coherence check, four artifacts, validation,
  and the issue comment. It worked because the discovery phase had already produced a
  shared mental model, so "draft it" had unambiguous scope.
- **High-leverage follow-up: `"commit and push"`.** Trusted the AI to figure out *what* to
  commit — and the AI correctly narrowed to only its own files.

*Stronger rewrite of the goal for next time:* "Explore mode. Investigate issue #48 (bind
host). Map **every** listener's bind, explain the current security model, then draft an
OpenSpec proposal + design + tasks + spec and comment on the issue. Don't write
implementation code."

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Stay in pure-thinking explore mode | "draft proposal and update the github issue" | State the deliverable in the kickoff: "explore, THEN produce the OpenSpec change + issue comment" |
| Leave everything staged at commit time | "commit and push" (AI then self-corrected) | Ask for a surgical commit explicitly: "commit ONLY the change dir; leave other staged files" |
| Treat the fix as a one-line `0.0.0.0`→`127.0.0.1` swap | (self-caught via full grep) | Instruct "map every listener" so the three-listener inconsistency surfaces without luck |

The most valuable *self*-correction: at commit time the AI detected foreign staged files
(`c4-example.md`, `groups.json`) and refused to sweep them into the commit — exactly the
guardrail a human would want.

## 6. Skills, tools & memory created — and why they're effective

No new skill or memory was created this session — the work rode entirely on the existing
`openspec-explore` skill plus the OpenSpec CLI (`openspec list/validate`) and `gh`.

**Skill that *should* exist (recommend creating):** an `issue-to-openspec-proposal`
procedure capturing the exact repeatable chain: fetch issue via API → grep **all** bind/
listen sites → map config/CLI chain → coherence-check the archive → mirror a sibling
change's structure → write 4 artifacts → `openspec validate` → `gh issue comment` → surgical
commit referencing the issue. It removes the two things that took judgement here (widening
from one line to all listeners; committing only your own files) and makes them mechanical.

## 7. Pitfalls & dead ends

- **GitHub web page = login wall for the agent.** The direct issue URL fetch was useless;
  use `curl https://api.github.com/repos/<owner>/<repo>/issues/<n>` (JSON) instead. *(2
  bash failures in the session traced to this and to the first API attempt.)*
- **`openspec change new <name>` didn't scaffold as expected** — the AI fell back to
  `openspec --help` / inspecting a sibling change to learn the real file layout, then wrote
  the artifacts by hand. If the generator misbehaves, copy an existing change's
  `.openspec.yaml` + `spec.md` shape.
- **Foreign staged files.** Don't `git commit -a` or `git add .` in this repo — there were
  unrelated pre-staged files. `git reset HEAD .` then add only your change dir.
- **The dependabot warning on push is pre-existing** and unrelated to a docs-only change —
  don't chase it.

## 8. Reproduce it faster — checklist

**Inputs to have ready:** the issue number (#48); `gh` authenticated against the repo;
repo `owner/name` for the API URL; a sibling OpenSpec change to mirror.

**Checklist:**
- [ ] Load `openspec-explore`; state the deliverable is an OpenSpec change + issue comment.
- [ ] `curl` the issue JSON from the GitHub API (not the web URL).
- [ ] `grep` **every** listener for `listen / 0.0.0.0 / 127.0.0.1 / host: / WebSocketServer`.
- [ ] Trace `DashboardConfig → buildConfig → listen()`; confirm no existing `host` field.
- [ ] `openspec list` + archive grep → coherence check passes.
- [ ] `cat` a sibling change's `.openspec.yaml` + `spec.md` for conventions.
- [ ] Write `proposal.md`, `design.md`, `tasks.md`, `specs/<cap>/spec.md`; `openspec validate` clean.
- [ ] `gh issue comment <n> --body-file /tmp/…md`.
- [ ] `git reset HEAD .` → `git add <change-dir>` → commit referencing the issue → push.

**Final artifacts produced:**
- `openspec/changes/configurable-bind-host/{.openspec.yaml,proposal.md,design.md,tasks.md}`
- `openspec/changes/configurable-bind-host/specs/server-bind-host/spec.md`
- Comment on GitHub issue #48; commit `7609fcb4..ec56615a` pushed to `develop`.

---

_Generated from session `019efbfd-610c-7b66-859d-a6d580236ec0` · `pi-agent-dashboard` · 2026-06-25. Source extract: session facts sheet (configurable-bind-host)._
