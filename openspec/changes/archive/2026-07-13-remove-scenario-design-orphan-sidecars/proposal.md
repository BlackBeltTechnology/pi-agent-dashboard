## Why

The merged change `elevate-scenario-design-to-eng-disciplines` (PR #310) moved
`scenario-design` into `packages/eng-disciplines/` and wrote **full inline DOX
rows** for its 3 files into `packages/eng-disciplines/AGENTS.md`. But it also
left the 3 old per-file sidecars on disk:

- `.pi/skills/scenario-design/SKILL.md.AGENTS.md`
- `.pi/skills/scenario-design/references/technique-cheatsheet.md.AGENTS.md`
- `.pi/skills/scenario-design/references/test-plan-schema.md.AGENTS.md`

These sidecars are now **orphans**: no `AGENTS.md` row points to them (`→ see`
pointers absent — the rows are inline), yet they still (a) duplicate the inline
detail in the `agents` doc-type kb index, and (b) ship in the published npm
tarball via `files[".pi/skills/"]`. All 8 sibling skills in eng-disciplines have
no sidecars — scenario-design is the lone inconsistency, carried over from the
pre-move root-tree split.

## What Changes

- **Delete** the 3 orphan `*.AGENTS.md` sidecars under
  `packages/eng-disciplines/.pi/skills/scenario-design/`. Their content already
  lives inline in `packages/eng-disciplines/AGENTS.md`; no row references them.
- **No capability change**, no behaviour change, no source touched. Pure
  doc-tree hygiene aligning scenario-design with its 8 sibling skills.
- **Non-goals**: no edits to the inline DOX rows (already complete on develop);
  no version bump (owned by `release-cut`); no change to the skill body.

## Impact

- **Removed**: 3 sidecar files (~2 KB) from `packages/eng-disciplines/`.
- **Published tarball** slims by 3 redundant files on the next `release-cut`.
- **kb index** loses the duplicate `agents` doc-type entries (inline rows remain
  searchable).
- No runtime, dashboard-server, or Electron impact (dev-only skill package).
