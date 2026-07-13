# Prototype renders — session → markdown (Architecture B)

Generated in explore mode to visualize the `design.md` document schema against
**real** distiller output over this project's 262 sessions.

- **Frontmatter + provenance = real.** Signature, `seen` count, confidence, model,
  and `sessionIds` are taken verbatim from a live `session-distiller` dry-run
  (`--n 1 --json`, 7,603 clusters). E.g. the edit-fault below genuinely recurs in
  45 sessions; the real error string `"Could not find the exact text"` was pulled
  from source session `f522b9fe`.
- **Prose sections = what the `@fast` synthesis step (Decision D5) produces.** Today's
  distiller `body` is a one-liner (`[fault] fault:edit:could-not-find-the-exact
  (seen in 45 sessions)`) — near-useless for retrieval. The model's job is to render
  the cluster + its evidence into the fixed `Symptom/Root cause/Fix/Verification`
  heading schema. That is the value B adds over Architecture A's raw FTS5 rows.
- **Paths scrubbed** (`/Users/<u>/…` → `<repo>/…`) per the design's mandatory scrub gate.

These files are illustrative artifacts, not the feature. They show *how it looks* and
prove the heading schema gives high-weight retrieval anchors (kb ranks `headingPath`
10× over `body`).
