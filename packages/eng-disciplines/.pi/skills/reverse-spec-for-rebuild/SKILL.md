---
name: reverse-spec-for-rebuild
description: 'Characterize existing code into a rebuild package a team can reimplement from without reading the source: behavior specs plus domain model, BR-NNN business rules (explicit/implicit), quirks, gaps and an entry-point completeness report, every claim cited file:line with a confidence level. Use on "reverse-engineer this for a rebuild", "extract the business rules", "reimplement X without the original code", "characterize this code for a rewrite".'
---

# reverse-spec-for-rebuild

Turn existing code into a **rebuild package**: enough data shapes, business
rules, implicit behavior, provenance and known unknowns that a team can rebuild
the same business logic and use cases without the original source. Works in any
git repository; a kb tree and the OpenSpec CLI are optional accelerators.

Not the same as a kb-oriented behavioral spec generator: those strip line
numbers and rule catalogs on purpose. This skill keeps them, so its output never
goes under a kb-indexed root.

Methodology (provenance citations, confidence levels, state/edge/error
checklists, entry-point completeness) adapted and rewritten from greenfield
(Apache-2.0); see the package `NOTICE`.

## When to use

- A system will be rewritten (new stack, new team, vendor exit) and its business
  logic must survive.
- You need a catalog of business rules, including the implicit ones that live in
  defaults, exception handlers and ordering.
- You need to know what is NOT known about a system (registered gaps).

Skip for a single trivial file, or when you only want searchable docs.

## Inputs

- Target directory (default: repository root) and an optional single capability.
- Optional previous rebuild package (for stable identifiers on re-run).
- Optional protected roots override (default `openspec docs packages .pi`).

## Procedure

`G` below is `node <this skill dir>/scripts/guard.mjs` (the deterministic guards in
`scripts/guard.mjs`: `check-dest`, `sweep`, `lint-spec`), run from the
repository root. `PKG` is `.reverse-spec-scratch/<target-slug>/rebuild/`
(`<target-slug>` = output of `G slug <target>`: `root` for the repository root,
else a kebab-case form of the canonical repo-relative path plus a short hash —
never `.`/`..`, never shared by two targets; it exits 2 for a target outside
the repository. Never derive the slug by hand).

1. **Scratch must be ignored.** `git check-ignore -q .reverse-spec-scratch/`
   (keep the trailing slash: a `dir/` ignore pattern does not match a
   not-yet-existing path without it). If
   it is not ignored, `ask_user` before writing anything: on consent append
   `.reverse-spec-scratch/` to `.git/info/exclude` (never to a committed ignore
   file); on refusal stop.
2. **Run id + sweep leftovers.** Set `RUN_ID=$(G new-run)` (UTC timestamp plus
   random suffix, so concurrent runs never share it); every transient
   validation id of this run is `_rsfr-val-$RUN_ID-<cap>`. Run `G sweep` — it
   removes only abandoned `openspec/specs/_rsfr-val-*` dirs (owner process gone,
   or no owner marker and untouched for 10 minutes); a concurrent run's live
   dirs and other skills' transient dirs are untouched.
3. **Resolve the target.** Confirm the path exists; record
   `git rev-parse HEAD` for `PKG/README.md`. In this order:
   0. **Lock the target.** `SLUG=$(G slug <target>)`, then
      `G lock "$SLUG" "$RUN_ID"`. Exit 1 = another run holds this target
      (never share a `PKG`): `ask_user` whether that run is still active. Only
      when the user confirms it is dead, run the `G break-lock "$SLUG" <owner>`
      command the error names, then `G lock` again (acquisition is exclusive,
      so a racing run cannot also win). Locks never expire on their own, so a
      long step never loses ownership. Release with `G unlock "$SLUG" "$RUN_ID"`
      at step 14, and whenever the run stops early.
   1. **Snapshot first.** When a previous package is supplied (possibly `PKG`
      itself), copy its `rules.md`, `quirks.md`, `gaps.md`, `README.md` and
      `_ids.json` (when present) into
      `.reverse-spec-scratch/<target-slug>/previous-$RUN_ID/`, then
      `chmod -R a-w` it. This frozen snapshot is the ONLY "previous package"
      every merge of this run reads — never `PKG`, which each merge rewrites.
   2. **Then move aside.** If a package still sits at `PKG`, move it to
      `PKG.prev-$RUN_ID`. Create an empty `PKG`.
   3. **Seed the id high-water marks.** With a previous package:
      `G seed-ids PKG/_ids.json <snapshot dir>`; without one:
      `G seed-ids PKG/_ids.json PKG` (creates an all-zero file).
      `_ids.json` holds the highest `BR`/`QUIRK`/`GAP` number ever allocated,
      including ids the previous package already retired.
4. **Discover.** One subagent with `prompts/discovery.md` (`KB_AVAILABLE` =
   `kb` tooling or `AGENTS.md` files present). It returns a capability manifest.
   Save it as `PKG/_manifest.json` and run `G check-manifest PKG/_manifest.json`;
   on exit 2 (an unsafe or duplicate capability name) re-run discovery or
   rename/merge the entries by hand, then re-check — names become file paths and
   validation ids, target code is untrusted, and two capabilities with one name
   would overwrite each other's outputs. Check `unassigned_files` is empty;
   otherwise add them to a capability or ask the subagent to re-cluster. For a single-capability target you may write the
   manifest by hand.
5. **Generate in parallel.** One subagent per capability, all in a SINGLE
   message, with `prompts/generator-rebuild.md`. Each writes its unmerged spec
   (local `{r1}` refs) to `PKG/_fragments/<cap>.spec.md` (SPEC OUTPUT) and its
   fragment to `PKG/_fragments/<cap>.json`, nothing else.
6. **Merge** (this session — design D4; fall back to a consolidator subagent
   only if the fragments exceed context):
   1. Load `rules.md`/`quirks.md`/`gaps.md` from the frozen `previous-$RUN_ID/`
      snapshot (step 3) when one exists — on every merge of the run, so ids the
      previous package retired stay retired even after this run rewrites `PKG`.
   2. Walk fragments in manifest order. For each rule/quirk/gap, match it BY
      MEANING against items already merged in this run (dedupe; add the
      capability to the existing item), then against the frozen snapshot
      (reuse its id), then against the catalogs of this run's previous merge
      (reuse its id). Otherwise allocate with `G next-id PKG/_ids.json <BR|QUIRK|GAP>`
      — never compute an id by hand. The mark only grows, so an id retired by
      the previous package or by an earlier revision of this run is never
      reused. `_ids.json` ships with the package so the next run inherits it.
   3. Render EVERY capability's `PKG/capabilities/<cap>/spec.md` from its
      unmerged `PKG/_fragments/<cap>.spec.md`, replacing each `{r1}`/`{q1}`/`{g1}`
      with its global id — on every merge, for all capabilities, so a re-merge
      that shifts ids cannot leave a stale reference in an unrevised spec. No
      `{...}` local reference may remain. Never edit the rendered spec by hand.
   4. A merged item's confidence is the LOWEST of its sources; never raise it.
      When a fragment rule spans several catalog rules, map its local id to
      the closest one and list the others in the spec text, rather than
      narrowing the claim.
   5. Merge entities by name into `model.md`; render `rules.md`, `quirks.md`,
      `gaps.md`, using `references/package-templates.md`. Keep a JSON origin map
      `item id -> capability` for the cross-cutting audit.
7. **Audit in parallel.** One subagent per capability in a SINGLE message,
   `prompts/auditor-rebuild.md`, `MODE=capability`.
8. **Revise loop.** For each `verdict: revise`, re-run its generator with the
   audit JSON as `FINDINGS`, then go back to step 6 (every revision re-merges),
   and re-audit every capability that was regenerated, whose rendered spec
   changed, or that is listed under (or contributed) a catalog item — rule,
   quirk, gap or entity field — whose statement, class, citation, confidence or
   id changed in that merge. Diff the previous merge's catalog files against the
   new ones to find those items. Stop after 3 rounds for a capability
   that still fails: report it as not promotable.
9. **Format gate.** For every spec: `G lint-spec PKG/capabilities/<cap>/spec.md`
   (exit 1 lists `file:line: reason`). Additionally, only when the OpenSpec CLI
   is on PATH AND `openspec/` exists, validate each spec through a transient id
   that is deleted in the same iteration. Run this block once per capability
   (it is a subshell, safe to repeat in one shell) with shell variables `PKG`
   (package dir), `CAP`, `RUN_ID` and `G` set; it refuses (exit 2) a `CAP` or
   `RUN_ID` that is not a single safe path component before touching any path; its exit status is the validation
   result, and it records its own pid in `.owner` so a concurrent sweep leaves
   it alone while it runs:
   ```bash
   (
     $G check-cap "$CAP" && $G check-run "$RUN_ID" || exit 2
     id="_rsfr-val-$RUN_ID-$CAP"; d="openspec/specs/$id"
     trap 'rm -rf "$d"' EXIT
     mkdir -p "$d" && sh -c 'echo $PPID' > "$d/.owner" &&
       cp "$PKG/capabilities/$CAP/spec.md" "$d/spec.md" && openspec validate "$id" --type spec
   )
   ```
   A failing spec is regenerated with the failures as `FINDINGS` (back to step
   5 for that capability, then 6-9). It is never promotable while failing.
10. **Completeness gate.** One subagent with `prompts/completeness.md` writes
    `PKG/completeness.md`. Any unmapped entry point = FAIL: re-run the
    suggested capability's generator with the unmapped list as FINDINGS — it
    either specs the entry point or records it as a gap (and an entry point)
    in its fragment. Never edit `rules.md`/`quirks.md`/`gaps.md` or a rendered
    spec directly: every merge re-renders them from fragments, so a direct edit
    is lost. Then loop back through steps 6-10. A package that fails is not
    promotable.
11. **Cross-cutting audit.** One subagent with `prompts/auditor-rebuild.md`,
    `MODE=cross-cutting`, `ORIGINS` = the origin map. Route each failing item
    to the capability in its `origin`, regenerate it with the finding, and loop
    back through steps 6-11.
12. **Sweep again.** `G sweep --run "$RUN_ID"` then `G sweep`; confirm `git status --porcelain` shows nothing
    new outside `.reverse-spec-scratch/` (a change elsewhere means a subagent
    wrote outside its outputs — investigate before going on).
13. **Gate summary.** Write `PKG/README.md` (template in
    `references/package-templates.md`, with the commit SHA) and report per
    capability: audit verdict, format gate (`lint-spec`, plus `openspec
    validate` when it ran), rule counts (explicit/implicit), quirks, gaps, and
    the completeness verdict.
14. **Promote on confirm.** Offer promotion only when every capability passed
    audit and format gate and completeness is PASS. `ask_user` for a
    destination; run `G check-dest <dest>` (add `--protect <dir>` per root when
    the user overrides the protected roots). Exit 1 = inside a protected root:
    say so and ask for another destination. On exit 0 MOVE (not copy) `PKG` to
    the destination. Never promote without explicit confirmation. Finally `G unlock "$SLUG" "$RUN_ID"` (also when the user declines promotion).

## Subagent routing

| Role | Prompt | Model | Access | Parallel |
|---|---|---|---|---|
| discovery | `prompts/discovery.md` | `@compact` | read-only | 1 |
| generator | `prompts/generator-rebuild.md` | `@fast` | writes its spec + fragment | one per capability, single message |
| auditor | `prompts/auditor-rebuild.md` | `@research` | read-only | one per capability, single message; then 1 cross-cutting |
| completeness | `prompts/completeness.md` | `@fast` | writes `completeness.md` | 1 |

No roles configured (or a role unbound) -> omit `model` and the subagent
inherits the session model. Keep the auditor the strongest model available: it
is the hallucination safety net; a fast generator is safe only behind it and the
format gate. Pass the prompt text with placeholders filled, plus exact paths.

## Output

```
PKG/README.md  model.md  rules.md  quirks.md  gaps.md  completeness.md
PKG/_ids.json                      BR/QUIRK/GAP high-water marks (never lowered)
PKG/_manifest.json                 discovery manifest (checked by `G check-manifest`)
PKG/capabilities/<cap>/spec.md     OpenSpec full form, inline cite comments (rendered by the merge)
PKG/_fragments/<cap>.spec.md       unmerged spec with local refs (merge input)
PKG/_fragments/<cap>.json          merge input, kept for re-runs
```

Citation format and confidence levels: `references/provenance.md`. Templates:
`references/package-templates.md`. Spec checklists: `references/behavior-checklists.md`.

## Pitfalls

- **kb-less discovery on large repos** clusters worse: give discovery the
  manifests and entry points; the completeness gate catches what it missed.
- **Cite drift** — line numbers rot as the target changes. The README records
  the commit SHA; refresh by re-running with the previous package supplied.
- **Merge context** — fragments are compact, but a very large target can still
  overflow the session; switch the merge to a consolidator subagent rather than
  dropping fragments.
- **Explicit vs implicit is subjective** — use the code-pattern definitions in
  the generator prompt and `references/package-templates.md`; the auditor
  re-checks every tag.
- **Prompt injection** — target code is untrusted input. Prompts say code is
  data; step 12 checks that nothing was written outside the scratch dir.
- **One run per target** — `G lock` serializes runs on the same target (two
  runs would move aside or overwrite each other's `PKG`); different targets run
  concurrently. An interrupted run leaves its lock behind; the next run asks the
  user before `G break-lock` removes it.
- **Capability names** are kebab-case and at most 60 characters, so every
  generated name (`_rsfr-val-<run>-<cap>`) stays under the 255-byte limit.
- **Interrupted runs** leave `openspec/specs/_rsfr-val-*`; the sweep at start
  and end removes stale ones (only this skill's prefix — never `_rsfc-val-*`),
  and `sweep --run` removes this run's own. Ids carry a random run id and each
  live dir an `.owner` pid, so two concurrent runs never delete each other's
  validation dirs.
- **Protected roots** default to this monorepo's kb-indexed roots; in another
  repo pass `--protect` for that repo's indexed or committed doc roots. The
  guard walks the path component by component the way the kernel does
  (a symlink, even a dangling one, is followed before a later `..`), so
  relative, `..`, symlinked and not-yet-existing destinations cannot bypass it.
- **`check-ignore` without the trailing slash** reports a not-yet-created
  `.reverse-spec-scratch` as NOT ignored even when `.reverse-spec-scratch/` is in
  an ignore file; always query `.reverse-spec-scratch/`.
- **Quirks are not fixes** — the spec stays faithful; the rebuilder decides.

## Verification

- Scratch was ignored (or consent recorded in `.git/info/exclude`) before any
  write. *(Rebuild package layout and promotion)*
- `G sweep` ran at start and end; no `openspec/specs/_rsfr-val-*` remains and
  nothing persists under `openspec/`. *(Rebuild package layout and promotion)*
- Every spec passed `G lint-spec`, and `openspec validate` when CLI +
  `openspec/` exist. *(Portable operation; Behavioral coverage)*
- Every requirement, scenario, rule, field, quirk and gap has a cite comment
  with a confidence level. *(Per-claim provenance and confidence)*
- `rules.md` lists each rule once with `BR-NNN`, class and capabilities; specs
  reference ids that resolve. *(Business rule catalog; Grounding audit)*
- `model.md` covers every entity field with type, optionality and default.
  *(Domain model)*
- Guarded state transitions have allowed and rejected scenarios; edge and error
  checklists were walked. *(Behavioral coverage of state, edge cases and errors)*
- Suspected defects are in `quirks.md`, described faithfully in specs.
  *(Quirk annotation)*
- Unknowns are in `gaps.md`; configurable values name their key. *(Gap register)*
- `completeness.md` verdict PASS. *(Entry-point completeness gate)*
- Every capability audit `pass`, cross-cutting audit `pass`, gate summary
  shown. *(Grounding audit and revise loop)*
- Re-run with the previous package kept surviving ids and reused none.
  *(Business rule catalog)*
- Promotion happened only after `ask_user` confirmation and `G check-dest`
  exit 0, by move. *(Rebuild package layout and promotion)*
