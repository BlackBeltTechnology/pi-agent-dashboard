---
kb:
  signal: fault
  signature: fault:edit:could-not-find-the-exact
  seen: 45
  sessionIds: [f522b9fe, da7d08cf, 415048c7, cea82e71]   # +41 more (truncated)
  cwd: <repo>
  model: claude-opus-4-6
  confidence: 0.958
  verified: true
  firstSeen: 2026-04-04
  lastSeen: 2026-07-13
  tags: [edit-tool, oldText, exact-match, whitespace, stale-read]
---
# Edit fails: "Could not find the exact text" (oldText mismatch)

## Symptom
`edit` returns `Could not find the exact text` and writes nothing. Recurs across 45
sessions — the single most common edit failure in this project.

## Root cause
`edit` matches `oldText` byte-for-byte against the file on disk. It misses when:
- `oldText` was copied from memory of an **earlier** read; the file changed since (a
  prior edit, a format-on-save, or another session wrote it) → the snapshot is stale.
- Invisible drift: trailing whitespace, tabs-vs-spaces, or CRLF/LF differ from what
  was pasted.
- The span is **not unique** — the intended match differs from the first occurrence.

## Fix
- Re-`read` the exact lines immediately before editing; copy `oldText` from that fresh
  read, never from earlier context.
- Keep `oldText` minimal but unique — extend with an adjacent unique token rather than
  padding with large unchanged blocks.
- Batch multiple edits to one file in a single `edit` call; each `oldText` matches the
  ORIGINAL file, so do not chain edits that depend on a prior edit's result.
- On repeated failure, `grep -n` the anchor to confirm it exists and how many times.

## Verification
`edit` returns success; a follow-up `read` of the target lines shows the new text.

## Provenance
sessions f522b9fe, da7d08cf, 415048c7, cea82e71 (+41 more); seen 45×;
distilled by claude-opus-4-6 on 2026-07-13; confidence 0.958.
