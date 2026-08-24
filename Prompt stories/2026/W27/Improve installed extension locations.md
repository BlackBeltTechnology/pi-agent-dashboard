---
session: 019f2a52
week: 2026/W27
type: planning
model: "@fast"
premium: true
premium_reason: "heavy steering (8 user prompts)"
upgrade_status: pending
openspec_changes: [flag-package-source-overrides, external-dashboard-plugins]
proposal_excerpt: "Many recommended pi extensions are declared as npm packages (`RECOMMENDED_EXTENSIONS[].source = \"npm:<name>\"`) but are actually installed on a developer's machine from a **local checkout** (`/home/dev/pi-web-access`)…"
---

# How we did it: Flag installed-extension source overrides — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The session opened in **explore mode** (the `openspec-explore` skill), a "think, don't
implement" stance. The real objective, once the exploration crystallized: some recommended
pi extensions are *declared* as npm packages (`source = "npm:<name>"`) but are actually
*installed* from a local or git checkout (e.g. `/home/dev/pi-web-access`). The dashboard's
package/version UI renders these with a lone `local` badge and — dangerously — leaves the
**Update** button enabled, which would clobber a developer's working checkout. The ask
became: **detect and clearly flag these "source override" rows, and suppress their Update
control** — captured as a validated OpenSpec change proposal, not implemented code.

## 2. TL;DR playbook

1. Enter explore mode (`openspec-explore`) and tell the AI to **ground in the real source
   first** — read `parseSourceKey`, `classifySource`, `sourcesMatch`, `PackageRow.tsx`,
   `InstalledPackage` — before theorizing about what's needed.
2. Let it surface the landscape (what already exists vs. the real gap: presentation +
   update-safety, not detection). Pick a direction with a **single-letter reply** ("D" =
   the honest full fix).
3. Say **"write proposal and make mockups."** It scaffolds the OpenSpec change
   (`proposal.md`, `design.md`, `tasks.md`, `specs/<capability>/spec.md`) and a before/after
   `mockups/index.html` using the **real `index.css` theme tokens**.
4. Review the mockup live (`serve_mockup` + `browser`/`score_mockup`), then **"stop mockup
   server, seems good."**
5. Before handoff, ask **"is there anything to clarify?"** → triggers the
   `doubt-driven-review` skill, which spawns a **fresh-context adversarial reviewer** on the
   artifact-only.
6. Fold the review findings back into all four artifacts, re-run `openspec validate
   <change> --strict`.
7. **"commit"** — stage only the change dir, use a **commit-message file** (not `-m`) to
   dodge apostrophe-quoting failures.

## 3. How the collaboration unfolded

**Phase 1 — Discovery (ground before theorize).** The AI ran `rg`/`kb_search`/`cat` across
`packages/shared`, `packages/client`, `packages/server` to map the actual machinery:
`InstalledPackage.source` → `classifySource()` (npm/git/local/global badge) →
`matchRecommendedEntry()`/`sourcesMatch()` (links a local checkout back to its canonical npm
identity). *Why it worked:* it discovered detection was **already mostly built** — the gap
was presentation + update-safety. This reframed the whole change from "add detection" to
"derive one boolean and gate on it."

**Phase 2 — Design decision.** The AI laid out options; the human replied **"D"** (the full
honest fix). The AI crystallized the core derived concept: `isSourceOverride = isRecommended
&& classifySource(source) !== "npm"` — no new server field required.

**Phase 3 — Proposal + mockup.** On "write proposal and make mockups", it scaffolded the
OpenSpec change manually (the `openspec change new` subcommand doesn't exist — see Pitfalls)
and built a before/after mockup pinned to the **real dark-theme tokens** from `index.css`,
self-scoring it on contrast/responsive/hierarchy/anti-slop.

**Phase 4 — Recovery.** After "stop mockup server", the untracked change directory **vanished**
(wiped because untracked). The AI detected it, recreated the full artifact set from its own
context, and re-validated `--strict`.

**Phase 5 — Adversarial review (the load-bearing phase).** "Is there anything to clarify?"
loaded `doubt-driven-review`, which spawned a fresh-context `Explore` reviewer given only the
ARTIFACT + CONTRACT (not the AI's own claim). It found a **real CRITICAL bug**:
`classifySource("git:…")` buckets as `"global"` while `sourcesMatch` treats it as recommended,
so gating off the *bucket* would leave Update **enabled on exactly the git checkout the change
exists to protect**. Fix: gate strictly off the `isSourceOverride` **boolean**, and patch
`classifySource` to bucket `git:` as `git`.

**Phase 6 — Fold + commit.** All findings folded into the four artifacts, re-validated, then
committed (`99815df78` on `develop`, 6 files, 486 insertions).

## 4. Prompts that worked

- **Goal kickoff (`openspec-explore`)** — Entering explore mode forced a "ground first,
  implement never" stance. Effective because it stopped the AI from writing speculative code
  and made it map the real types before designing.
- **"D"** — a one-character decision reply. High-leverage: the AI had already laid out
  labeled options, so a single letter unlocked the full design without re-explaining.
- **"write proposal and make mockups."** — combined two deliverables in one short prompt;
  the AI knew the OpenSpec artifact set + theme-token mockup convention.
- **"Is there anything to clarify? There is a skill to analyze plans (as I know)"** — the
  single highest-value prompt: it invoked `doubt-driven-review` and caught the CRITICAL
  git-prefix bug *before* implementation. Rewrite for reuse: **"Run `doubt-driven-review` on
  this proposal before handoff."**
- **"fix" / "commit"** — terse terminal prompts that worked only because the prior turn had
  already enumerated exactly what would be fixed/committed.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Theorize before reading source | (goal implicitly) explore-mode stance | State "ground in real types first" in the kickoff |
| Consider handoff "done" after the proposal | "Is there anything to clarify?" | Make `doubt-driven-review` a mandatory pre-handoff step |
| Leave artifacts untracked (they got wiped) | had to recreate the whole dir | `git add` the change dir immediately after scaffolding |
| Use `openspec change new` (nonexistent) | (self-corrected) | Use `openspec new change <name>` or scaffold files manually |
| Gate the Update button off the source *bucket* | the adversarial review caught it | Gate off the derived **boolean**, never the classifier bucket |

## 6. Skills, tools & memory created — and why they're effective

No new skill/memory was *created*, but two existing skills carried the session:

- **`openspec-explore`** — enforces a think-only stance so exploration produces a *proposal*,
  not premature code. Invoke it whenever the shape of a change is still fuzzy.
- **`doubt-driven-review`** — the MVP of this session. It spawns a **fresh-context** reviewer
  fed only the artifact + contract (never the author's self-justifying claim), which is why
  it found a CRITICAL flaw an inline re-read would have rationalized away. **Invoke it on
  every proposal before handoff to `implement`.**

*Recommended memory to save:* "`classifySource` buckets `git:`-prefix sources as `global`,
diverging from `sourcesMatch` (which links them to npm) — gate update-safety off the derived
`isSourceOverride` boolean, never the classifier bucket." This is a real footgun worth a
project memory.

## 7. Pitfalls & dead ends

- **`openspec change new` is not a subcommand.** Use `openspec new change <name>`, or scaffold
  the artifact files manually following an existing change's layout.
- **Untracked change dirs get wiped.** The whole `openspec/changes/<name>/` directory vanished
  once because it was never staged. `git add` immediately after creating it.
- **Playwright browser not installed** for `score_mockup` → fell back to the `browser` tool to
  capture/verify the mockup. Keep the `browser` fallback in mind.
- **`git commit -m` broke on an apostrophe** in the message. Write the message to a file
  (`/tmp/commit-msg.txt`) and `git commit -F` instead.
- **Bucket-based gating is a trap.** The `git:` prefix falls through `classifySource` to
  `"global"`; gate on the derived boolean, not the bucket string.

## 8. Reproduce it faster — checklist

- [ ] Enter `openspec-explore`; instruct: **read the real types first** (`parseSourceKey`,
      `classifySource`, `sourcesMatch`, `PackageRow.tsx`, `InstalledPackage`).
- [ ] Confirm the gap (here: presentation + update-safety, detection already exists).
- [ ] Pick the direction (terse reply is fine once options are labeled).
- [ ] "write proposal and make mockups" → scaffold via `openspec new change`, mockup with
      **real `index.css` theme tokens**.
- [ ] **`git add openspec/changes/<name>/` immediately** (avoid the wipe).
- [ ] Run **`doubt-driven-review`** on the proposal — fresh-context adversarial reviewer.
- [ ] Fold findings; `openspec validate <name> --strict`.
- [ ] Commit with `git commit -F /tmp/commit-msg.txt`, staging only the change dir.

**Key inputs:** access to `packages/{shared,client,server}` source; the `openspec` CLI; the
`openspec-explore` + `doubt-driven-review` skills; `serve_mockup`/`browser` for mockup review.

**Artifacts produced:** `openspec/changes/flag-package-source-overrides/{proposal,design,tasks}.md`,
`specs/pi-core-version-ui/spec.md`, `mockups/index.html` — committed as `99815df78` on `develop`.

---

_Generated from session `019f2a52` · `pi-agent-dashboard` · 2026-07-04. Source extract: deterministic facts sheet (stdout)._
