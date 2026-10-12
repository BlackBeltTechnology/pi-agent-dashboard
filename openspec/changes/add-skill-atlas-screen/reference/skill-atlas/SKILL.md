---
name: skill-atlas
description: "Regenerate the Skill Atlas — one self-contained HTML page cataloguing every pi skill on this machine (provenance, plain-English summary, verbatim SKILL.md) plus an interactive link graph with link-type filters — using a deterministic bundled CLI. Same skill files + same summaries = byte-identical page. Use on \"refresh the skill atlas\", \"rebuild the skills html\", \"update the skill graph\", \"which skills changed / have no summary\", or after installing or updating skills."
---

# Skill Atlas

Everything mechanical is done by `scripts/atlas.mjs` (Node ≥ 18, zero dependencies). Never
hand-edit the generated `index.html` / `skills.json`, and never re-implement scanning,
linking or rendering in the session — that is what keeps the output reproducible.

The one judgment step is writing or reviewing summaries in `summaries.json` — and only for
skills that are new, changed, or explicitly requested. Everything else is left untouched.

```bash
A=~/.pi/agent/skills/skill-atlas/scripts/atlas.mjs
node $A build     # scan + merge + render -> <dir>/index.html, prints sha256 + summary gaps
node $A check     # missing / stale / redo / drifted / invalid summaries (exit 1 if work)
node $A todo      # per gap: description, current summary, body excerpt or body DIFF
node $A stamp id… # mark reviewed: hashes + body snapshot (--all for every entry)
node $A redo id…  # force a rewrite of these summaries even though nothing changed
node $A verify    # builds twice in-process and compares with the file on disk
node $A projects [--suggest]  # pi reference projects (first = primary) + candidates
node ~/.pi/agent/skills/skill-atlas/scripts/selftest.mjs   # 40 checks in a temp dir
```

Data dir: `--dir <path>`, else `$SKILL_ATLAS_DIR`, else `~/AssistantProject/tools/skill-atlas`.
It holds `summaries.json` (authored), `.stamps/<id>.md` (body snapshots from the last review), optional `atlas.config.json` (`{"roots":[{p,origin,label}]}`
to change which folders are scanned), and the generated `skills.json` + `index.html`.

**Which copy is described.** A skill often exists in several places (npm install, dashboard
source, several projects). pi's own resolver (SDK `DefaultResourceLoader`, extensions disabled)
is asked once per project in `"projects"` (`atlas.config.json`; default `["~/AssistantProject"]`,
`[]` disables it). The **first project is the primary**; the shown + summarized copy is:
1. the one pi loads in the primary project, else 2. the one loaded in the most projects,
else 3. scan-root order (installed before source). Reordering non-primary projects never
changes a skill the primary loads. Every card lists **Loaded in** per project and flags
projects that run a different text; skills checked into a project's `.pi/skills/` are
"Yours", grouped as *Project: name*. `node $A projects --suggest` lists the configured
projects and proposes dashboard-pinned folders to add.

## Procedure

1. User asked to rewrite specific summaries? `node $A redo <ids>` first.
2. `node $A check`. Nothing under "needs work" and no minor drift → skip to step 6.
3. `node $A todo` and act per bucket (details in [references/summaries.md](references/summaries.md)):
   - **MISSING / STALE / REDO** → write or rewrite the entry from the printed material.
   - **DRIFTED / MINOR DRIFT** → read the printed body diff against the current summary.
     Change only what the diff contradicts or adds; if nothing, leave the entry as is.
     Minor drift is reviewed too — a 12-line rename once made a summary wrong.
   Do not open the SKILL.md files separately unless the excerpt is cut off before the point.
   More than ~15 gaps: batch them across subagents returning the exact schema, then merge.
4. `node $A stamp <ids you wrote or reviewed>` — stamping is the claim "this entry matches
   the current SKILL.md". Never stamp an id you did not read.
5. `node $A check` until it exits 0.
6. `node $A build`, then `node $A verify` (must print `deterministic: yes` and `up to date`).
7. Open `<dir>/index.html` (macOS: `open`; in the dashboard also `canvas` with a cwd-relative
   path). `#graph` opens the graph view, `#g-<id>` selects a skill in it.

## What the page contains

- **Cards view**: one card per skill grouped by category; filters for search, provenance tier
  (Yours / In-house / 3rd-party / Tool-generated) and category.
- **Graph view**: SVG force layout with deterministic seeding. Link types from the scanner:
  `references` (A's SKILL.md names B — directed), `bundle` (same package, 2–14 skills),
  `shares-tool` (same distinctive tool, ≤ 6 skills). Each type has its own checkbox; options
  to hide unlinked skills, cluster by category, focus on a skill's 1- or 2-hop neighbourhood.

## Pitfalls

- A changed `index.html` hash with no skill changes means the template or summaries changed;
  `build` prints `scan fingerprint` separately so you can tell which input moved.
- Timestamps are off by default (they break reproducibility). `SOURCE_DATE_EPOCH=<unix secs>`
  adds a fixed "built" date.
- Template edits go to `assets/template.html` in this skill. `build.mjs` escapes every `<` in
  the payload and uses a replacer function — keep both, skill bodies contain `</script>` and `$&`.
- The scanner's own SKILL.md is part of the scan: editing this skill changes the fingerprint
  and shows up as drift on its own summary — review and stamp it like any other.
- Write summaries for the **shown** copy only. A newer dashboard-source copy is not what pi
  runs until it is installed; when that changes, the shown text changes and drift flags it.
- Changing the primary project, pi's settings or an install can switch the shown copy. Drift
  then says **"shown copy switched from <path>"** and always blocks. Each summary remembers
  its last 8 reviewed body versions (`reviewed`), so switching back to a text already
  reviewed flags nothing. Adding projects adds skills — expect new "missing" entries.
- Switching the primary changes *what the atlas means*: summaries describe the primary's
  copies. Keep the primary stable; add other projects for coverage, not as primary.
- `.stamps/` must travel with `summaries.json`. Without a snapshot, drift is still detected
  (via `bodyHash`) but reported as major with no diff, so the whole body must be re-read.

## Verification

- `node …/scripts/selftest.mjs` prints `0 failed` (run after any change to scripts/ or assets/).
- `node $A check` exits 0.
- `node $A verify` prints `deterministic: yes` and `index.html is up to date`.
- Page opens with no console errors; the Graph tab shows nodes and the link-type counts.
