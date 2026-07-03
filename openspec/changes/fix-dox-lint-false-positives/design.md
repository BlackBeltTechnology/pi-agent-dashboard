# Design — fix `kb dox lint` false positives

## Context

`doxLint` (`packages/kb/src/dox.ts`) walks every `AGENTS.md`, parses rows
`| \`<path>\` | <purpose> |`, and classifies each row's path as
existing / orphan / stale. Two assumptions in that pipeline are wrong.

## Decision 1 — resolve row paths against the owning `AGENTS.md` dir

The DOX schema (root `AGENTS.md` Documentation Update Protocol) states: *path
relative to that `AGENTS.md`*. The lint must honor that.

```ts
// dox.ts:263 — before
const abs = isAbsolute(rp) ? rp : resolve(cwd, rp);
// after
const abs = isAbsolute(rp) ? rp : resolve(dirname(af), rp);
```

`af` (the AGENTS.md absolute path) is already in scope in the loop. This single
line removes 991/992 false orphans and the `--fix` data-loss risk.

Edge cases preserved:
- Pointer rows ending `AGENTS.md` still classify as `broken-pointer` when the
  target is absent (relative-to-dir resolution applies equally).
- Absolute row paths are still respected via the `isAbsolute` branch.

## Decision 2 — only parse rows inside a `# DOX —` table

`kb dox init` writes each area file with a `# DOX — <dir>` H1 and the file table
beneath it. Non-DOX tables (Subagent Routing, QA, Docker) live under ordinary
prose headings. Scope the parser: track the current heading while scanning; only
treat `| \`x\` | … |` rows as DOX rows when the nearest preceding heading text
starts with `DOX —` (or the file is a pure DOX file whose H1 is `DOX —`).

```text
for each line:
  if line matches /^#{1,6}\s+DOX —/  -> inDox = true
  else if line matches /^#{1,6}\s/   -> inDox = false   (any other heading)
  else if inDox && row-regex          -> it's a DOX row
```

This keeps the parser deterministic (no LLM), and makes root `AGENTS.md`
(which by protocol MUST NOT hold a per-file index) contribute **zero** DOX rows —
correct, since its tables are routing/QA prose, not a file index.

Apply the same guard in `doxInit` (`dox.ts:134`) so scaffolding and auditing use
one definition of "DOX row".

## The settings question (raised in review)

> "Maybe the mentions parameter have to be on settings."

Considered — **rejected as the primary fix.** A config knob (e.g. an
exclude-globs list, or an opt-in "strict tables" flag) would let a project
suppress the false positives, but:

- It treats the symptom (noise) not the cause (wrong resolution + wrong scope).
- Both defects are unambiguous correctness bugs with one right answer; there is
  no project-specific policy to configure.
- A setting adds surface area and a foot-gun (someone excludes a real dir).

**Recommendation:** fix the two bugs structurally; add **no** new setting.

If a genuine future need appears (e.g. vendored trees a project wants the lint to
skip), the right lever already exists — `DEFAULT_EXCLUDE` / the KB config
`exclude` globs (`packages/kb/src/config.ts`) — reuse that, don't add a
lint-specific setting. Noted as a non-blocking follow-up, not part of this change.

## Verification

- Unit: fixture tree with a sub-dir `AGENTS.md` holding a valid basename row →
  0 orphans (regression for Defect A).
- Unit: a file whose H2 prose table has a backtick path cell → not parsed as a
  DOX row (regression for Defect B).
- Integration: `kb dox lint` on this repo → orphan count collapses to the handful
  of genuinely-deleted rows; `--fix` no longer removes valid rows.
