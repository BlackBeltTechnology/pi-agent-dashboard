---
session: 019dedab
week: 2026/W18
type: documentation
model: "@fast"
premium: true
premium_reason: "heavy steering (13 user prompts)"
upgrade_status: pending
---

# How we did it: Slim AGENTS.md so it stops eating every-turn context — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The session opened with a blunt diagnostic question — `"What is eating conext?"` — a
worry that too many tokens were being consumed on every agent turn. The *real*
objective, once the follow-ups landed, was concrete and structural: **shrink the
auto-loaded `AGENTS.md` back to a lean architectural backbone, move the accreted
per-file change-history into on-demand `docs/file-index-*` splits, and add a
Documentation Update Protocol so future agents stop re-bloating it** — then compress
the docs corpus toward caveman/telegraphic style and land the change on `develop`.

## 2. TL;DR playbook

1. **Measure first.** `wc -c AGENTS.md docs/file-index.md` and rank the fat rows:
   `awk '{if (length>800) print length, NR}' AGENTS.md | sort -rn`. Name the worst
   offender (here: one 4.7 KB `publish.yml` row).
2. **Diagnose the mechanism, not just the size.** The file bloated because every
   archived change *appended* a `See change: …` paragraph to a row instead of moving
   it to `docs/file-index.md`. Say that out loud — it's the root cause.
3. **Delegate the bulk row-trim to a subagent** with a hard numeric bar: "every row
   ≤ 200 chars, migrate the detail to `docs/file-index.md`, lose zero info."
4. **Split the monolith by area.** Turn `docs/file-index.md` into a thin routing
   index pointing to `file-index-{client,server,shared,electron,extension,plugins,
   skills-misc}.md`. Verify the data-row count is preserved exactly.
5. **Codify the rule.** Add a `## Documentation Update Protocol` + a routing table to
   `AGENTS.md` whose first line is *"Default assumption: your update does NOT belong
   in AGENTS.md."* — with the *why* inline so agents obey it.
6. **Caveman-compress the docs** — but measure the ceiling honestly (see §7); do the
   worst-offender rows yourself rather than trusting a sampling subagent.
7. **Commit as one isolated change** (docs/ + AGENTS.md only), then land it — but
   check `jj`/`git` topology before pushing.

## 3. How the collaboration unfolded

**Phase A — Discovery & root-cause (`wc`, `awk`, `grep`).** The AI first estimated the
context budget, then *proved* it with byte counts: `AGENTS.md` was 107 KB (~27k
tokens), nearly as big as the `docs/file-index.md` it was supposed to delegate to. It
ranked rows by length and pinpointed the append-on-archive anti-pattern. **Why it
worked:** it refused to hand-wave "the file is big" and instead surfaced the exact
rows and the exact mechanism creating them.

**Phase B — Bulk trim via subagent.** With ~35 rows over 800 chars, the AI spawned a
`general-purpose` subagent to shorten every row to ≤ 200 chars and migrate detail into
`docs/file-index.md`. Result: **107 KB → 37.7 KB (~17k tokens freed every turn)**, all
detail preserved on-demand.

**Phase C — Split & codify.** It split the 140 KB `file-index.md` into 7 per-area
files behind a 1.8 KB routing index (344 data rows preserved exactly), then wrote the
Documentation Update Protocol + a "where does this update go?" routing table into
`AGENTS.md`. **Decision point:** the human explicitly demanded *"do not update
AGENTS.md, keep little, put the documents to correct place and index"* — turning the
protocol from optional into the enforced default.

**Phase D — Caveman compression (with an honest ceiling).** The human asked whether
docs could be compressed "without loosing info." The AI showed a real 45%-shorter row,
then swept the corpus — but reported honestly that a sampling subagent under-delivered
(0.27% reduction) and that the true ceiling is ~5–10% because identifiers/paths/code
dominate and can't shrink. It did a manual targeted pass on the worst rows (25–35%
each).

**Phase E — Commit & the push saga.** One clean commit (15 files, +1186/−899, docs
only). Then the landing fought back: the repo is `jj`-managed (noticed late),
`develop` had advanced, a conflict in `AGENTS.md` needed resolving in caveman style,
and finally `git`/`ssh` broke with `No user exists for uid 501` (macOS
`opendirectoryd`/NSS failure). The AI correctly diagnosed this as an **environment**
problem, not a repo problem, and handed the operator a fresh-terminal fix + a
fetch→rebase→push one-liner.

## 4. Prompts that worked

- **The goal prompt** — `"What is eating conext?"` was vague but effective *because it
  triggered measurement*. A stronger kickoff: *"Profile what's loaded into my context
  every turn and tell me the biggest reducible offender, with byte counts."*
- **High-leverage steering** — *"As I know already splitted. Why this large than?"*
  forced the AI past the surface answer into the append-on-archive root cause.
- **The enforcement prompt** — *"do not update agents.md, keep little, put the
  documents to correct place and index"* is the single highest-leverage line: it
  converted a one-off cleanup into a durable protocol. Reuse this pattern: *"don't just
  fix it, encode the rule so it can't regress."*
- **Scope-check prompt** — *"Is it possible to convert inside docs/ to caveman
  language? Without loosing info?"* correctly gated a risky compression on a
  no-info-loss constraint.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Answer the size question at a high level | *"Why this large than?"* | Demand byte counts + the worst row *before* proposing fixes |
| Treat the trim as a one-off edit | *"modify agents.md to tell when documentation is updated… and update indexes"* | State up front: encode a Documentation Update Protocol, don't just clean once |
| Risk re-bloating AGENTS.md | *"do not update agents.md, keep little"* | Make ≤ 200-char rows + "detail goes to splits" the enforced default |
| Trust a subagent's "already terse" self-report | Spot-check, find a 4.5 KB row, call the 0.27% result out | Give subagents a numeric bar (≥ X% on rows > N chars) and verify, don't accept sampling |
| Use plain `git commit` in a `jj` repo | Noticed too late; jj auto-imported | Check `jj st`/reflog first; use the jj workflow for jj repos |

## 6. Skills, tools & memory created — and why they're effective

No skill or memory was persisted this session — which is itself the lesson. The
durable asset created was **in-repo**: the `## Documentation Update Protocol` + routing
table now living in `AGENTS.md`, plus the 7-way `docs/file-index-*` split behind a thin
index. That *is* the reproducible mechanism — it makes "where does this doc detail go?"
answerable without a human every time.

**Recommended skill to create:** a `trim-context-file` / `slim-agents-md` project skill
capturing exactly this loop — measure (`wc`/`awk` ranking) → identify accretion
mechanism → subagent bulk-trim to a char cap → split monolith by area preserving row
count → write an enforcing protocol → measure the honest compression ceiling. It would
remove the re-discovery cost the next time AGENTS.md (or any auto-loaded doc) balloons.

## 7. Pitfalls & dead ends

- **Sampling subagent under-delivered (0.27% vs the ~25% asked).** It read a few terse
  rows, generalized "already caveman," and skipped the fat ones. *If you hit this:* give
  an explicit "find every row > 500 chars, compress each, target ≥ 25% on those rows, do
  not skip files based on sampling" instruction and verify with `awk length` after.
- **Caveman compression has a hard ~5–10% ceiling here.** Identifiers, paths, and code
  fragments are ~60% of every long row and don't shrink. *Don't* promise 30–50% on this
  corpus — that figure is for prose, not identifier-dense reference tables.
- **`jj` repo detected late.** Plain `git commit` worked only because jj auto-imports;
  check topology first (`jj st`, reflog shows `export from jj`).
- **`develop` advanced twice mid-work → stale-info push rejection.** Land with
  `jj git fetch && jj rebase -r <change> -d develop@origin && jj bookmark set develop -r
  <change> && jj git push --bookmark develop`.
- **`git: No user exists for uid 501` / `whoami` returns `501`.** macOS
  `opendirectoryd`/NSS was broken in the shell — *not* a repo problem. Fix: open a fresh
  Terminal (spawns through launchd, re-establishes user context), or `sudo killall
  opendirectoryd`, then retry the push.

## 8. Reproduce it faster — checklist

- [ ] `wc -c AGENTS.md docs/file-index*.md` — baseline the auto-loaded footprint.
- [ ] `awk '{if (length>800) print length, NR}' AGENTS.md | sort -rn` — rank fat rows.
- [ ] Name the accretion mechanism (append-on-archive) out loud before fixing.
- [ ] Subagent trim: every row ≤ 200 chars, migrate detail to `docs/file-index.md`,
      zero info loss; verify with `awk length` after.
- [ ] Split `file-index.md` by area behind a thin routing index; assert data-row count
      is preserved (`grep -c '^| '`).
- [ ] Add `## Documentation Update Protocol` + routing table to `AGENTS.md`, lead with
      *"your update does NOT belong in AGENTS.md."*
- [ ] Caveman pass on the worst rows only; report the honest total % (expect 5–10%).
- [ ] Commit docs-only in one change; check `jj` topology before pushing.
- [ ] Push via jj; on stale-info do fetch→rebase→set bookmark→push; on `uid 501` open a
      fresh terminal.

**Key inputs:** repo with an oversized auto-loaded `AGENTS.md`; `jj`+`git`; a working
macOS user/SSH environment. **Artifacts produced:** trimmed `AGENTS.md` (~38 KB),
`docs/file-index-{client,server,shared,electron,extension,plugins,skills-misc}.md`,
updated `docs/architecture.md`, and one isolated docs commit on `develop`.

---

_Generated from session `019dedab-3519-757e-89b8-845e30098c79` · `/Users/robson/Project/pi-agent-dashboard` · 2026-05-03. Source extract: `/tmp/facts-8OK4dRwu`._
