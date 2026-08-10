# Proposal Queue Schema

File location: `.pi/proposal-queue.json`

This file is written by the `spec-coherence-check` skill and designed
to be consumed by future automation skills (e.g., `openspec-auto-pipeline`).

## Schema

```json
{
  "lastChecked": "ISO-8601 timestamp of last sweep",
  "lastSweepSummary": "human-readable summary string",
  "proposals": [
    {
      "name": "string — proposal directory name",
      "status": "ok | stale | broken | obsolete | empty",
      "priority": "number — lower = implement first",
      "complexity": "trivial | minor | major | fundamental",
      "createdAt": "YYYY-MM-DD",
      "checkedAt": "ISO-8601 timestamp",
      "issues": [
        {
          "severity": "stale | broken | obsolete",
          "description": "string — what is wrong",
          "artifact": "string — which artifact file is affected",
          "causedBy": "string — archive name or codebase change",
          "autoFixable": "boolean"
        }
      ],
      "dependsOn": ["string — proposal names this should follow"],
      "blockedBy": ["string — hard dependencies (must be done before)"],
      "conflictsWith": ["string — proposals touching same area"],
      "touchesFiles": ["string — file paths from Impact section"],
      "touchesCapabilities": ["string — capability names from Capabilities section"],
      "notes": "string — optional manual notes (preserved across updates)"
    }
  ],
  "conflicts": [
    {
      "proposals": ["string — two or more proposal names"],
      "area": "string — file or capability that overlaps",
      "severity": "low | medium | high",
      "resolution": "string — suggested ordering or scope adjustment"
    }
  ]
}
```

## Field Details

### proposals[].status

| Value | Meaning |
|-------|---------|
| `ok` | Ready to implement as-is. No issues detected. |
| `stale` | Minor references outdated. All issues are auto-fixable. |
| `broken` | Design assumptions invalidated. Needs human judgment. |
| `obsolete` | Feature already exists or problem solved differently. |
| `empty` | Change directory exists but has no meaningful artifacts. |

### proposals[].priority

Lower number = implement sooner. Typical range is 5–999.

- Score 999 = bottom of queue (obsolete or empty proposals)
- Dependency constraints always override raw scores: if A depends on B,
  then A.priority > B.priority regardless of calculated score
- Users can influence ordering via the `notes` field (future automation
  can read notes for manual overrides)

### proposals[].complexity

| Value | Criteria |
|-------|----------|
| `trivial` | 1–2 files, isolated fix, no protocol/architecture changes |
| `minor` | Small feature, well-scoped, fewer than 5 files |
| `major` | Cross-cutting, multiple components, protocol changes |
| `fundamental` | Architecture-level change, breaking changes |

### proposals[].issues[]

Each issue represents one detected problem. The `autoFixable` field
determines the triage path:

- `autoFixable: true` → STALE auto-fix flow (show change, apply, validate)
- `autoFixable: false` → BROKEN guided conversation (present options, ask user)

The `causedBy` field references either an archive directory name
(e.g., `2026-03-27-server-side-directory-services`) or a general
codebase change description.

### proposals[].dependsOn vs blockedBy

| Field | Meaning |
|-------|---------|
| `dependsOn` | Soft ordering preference. "Should be done after these." |
| `blockedBy` | Hard constraint. "Cannot be implemented until these are done." |

Both arrays contain proposal names (not archive names).

### proposals[].notes

Free-text field for manual annotations. The coherence-check skill
preserves this field across re-runs. Users can write anything here —
implementation notes, reasons to defer, manual priority overrides, etc.

### conflicts[].severity

| Value | Meaning |
|-------|---------|
| `low` | Both proposals add to the same file but in different areas |
| `medium` | Both proposals modify the same component/API differently |
| `high` | Both proposals make incompatible architectural assumptions |

### conflicts[].resolution

A human-readable suggestion for resolving the conflict, typically one of:
- Implementation ordering ("Implement X before Y because...")
- Scope adjustment ("Narrow X to exclude area Z, which Y covers")
- Merge suggestion ("These proposals could be combined into one")
