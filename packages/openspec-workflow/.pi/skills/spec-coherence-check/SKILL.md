---
name: spec-coherence-check
description: >-
  Sweep all active OpenSpec proposals for staleness, conflicts, and obsolescence
  against the current codebase and archived changes. Use when proposals may be
  outdated, when checking cross-proposal conflicts, or before starting a batch
  of implementations. Produces a gap-analysis report, updates a priority queue
  file, and can auto-fix trivial issues or guide conversations for complex ones.
license: MIT
compatibility: Requires openspec CLI and git.
metadata:
  author: robson
  version: "1.0"
---

Analyze active OpenSpec proposals against the current codebase state,
detect staleness / conflicts / obsolescence, and orchestrate updates.

**Input**: Optional `--proposal <name>` for single-proposal mode.
No arguments = full sweep of all active proposals.

---

## Phase 1: Sweep Report

### Step 1 — Gather context

**a) Get all active proposals:**

```bash
openspec list --json
```

If `--proposal <name>` was provided, filter to just that proposal.

**b) List all archived changes:**

```bash
ls openspec/changes/archive/
```

Parse archive directory names to extract dates. Format is `YYYY-MM-DD-<name>`.
Extract the first 10 characters as the date string.

**c) Date each active proposal using this fallback chain:**

1. Git first-commit date:
   ```bash
   git log --follow --diff-filter=A --format='%ai' -- "openspec/changes/<name>/proposal.md" | tail -1
   ```
   Parse the date portion (first 10 chars: `YYYY-MM-DD`).

2. If empty (file is untracked), use filesystem birthtime:
   - macOS: `stat -f "%SB" -t "%Y-%m-%d" "openspec/changes/<name>/proposal.md"`
   - Linux: `stat -c "%W" "openspec/changes/<name>/proposal.md"` (convert epoch to date)

3. If still unknown, use the oldest archive date as a floor estimate.

**d) Read artifacts for each active proposal.**

Read only the files that exist — not all proposals have all artifacts:
- `openspec/changes/<name>/proposal.md` (always exists)
- `openspec/changes/<name>/design.md` (if exists)
- `openspec/changes/<name>/tasks.md` (if exists)
- `openspec/changes/<name>/specs/` directory (if exists)

From each proposal, extract and note:
- **Referenced files**: paths matching `src/...` in Impact and body text
- **Referenced capabilities**: from `### Modified Capabilities` and `### New Capabilities`
- **Assumptions**: statements in Context sections, Non-Goals, and design decisions
- **Files touched**: from `## Impact` section specifically

**e) Read relevant archived changes.**

For each active proposal, identify archives dated **after** its creation date.
For each such archive, read its `proposal.md` and extract:
- `## What Changes` — summary of modifications
- `## Capabilities` — look for `BREAKING` markers, `Modified`, `Removed` entries
- `## Impact` — files and components touched

Keep only archives whose Impact or Capabilities overlap with the proposal
being analyzed (same files or same capabilities).

### Step 2 — File existence detection

For each active proposal, extract all file paths from:
- The `## Impact` section (look for `src/...` patterns and filenames like `FooBar.tsx`)
- The body text of proposal.md and design.md

For each extracted path:

```bash
find src/ -path "*<filename>" -o -name "<filename>" 2>/dev/null
```

If a referenced file does not exist anywhere in the codebase:
- Record issue: severity `stale`, autoFixable `true`
- Description: "Referenced file `<path>` no longer exists"
- Try to find where the functionality moved:
  ```bash
  rg -l "<key-term-from-filename>" src/ --type ts
  ```
  If a likely replacement is found, note it in the issue for auto-fix.

### Step 3 — Archive impact analysis

For each archived change that is dated after the proposal's creation:

Compare the archive's data against the proposal:

1. **File overlap**: Do the archive's Impact files intersect with the proposal's
   Impact files? If yes, the proposal may reference outdated file state.

2. **Capability overlap**: Does the archive modify or remove capabilities that the
   proposal lists under Modified Capabilities? If yes, the proposal's
   assumptions about those capabilities may be invalid.

3. **BREAKING markers**: Does the archive contain `BREAKING` in its Capabilities
   section for capabilities the proposal touches?

For each overlap found:
- If BREAKING marker present: severity `broken`, autoFixable `false`
  - Description: "Archived change `<archive-name>` has BREAKING changes to
    `<capability>` which this proposal modifies. Specifically: `<detail>`"
- If non-breaking file overlap: severity `stale`, autoFixable `true`
  - Description: "File `<file>` was modified by `<archive-name>` after this
    proposal was created. Impact section may be outdated."

### Step 4 — Concept validity check

For each proposal that has Context, Non-Goals, or Design assumptions sections,
extract key statements and verify them against the current codebase.

**What to check:**

- **"Currently X does Y"** statements — Read the relevant source file to confirm
  X still does Y.
  ```bash
  rg "<key pattern>" src/ --type ts -l
  ```
  Then read the file to verify the claim.

- **Non-Goals that state "not doing Z"** — Check if Z has been implemented:
  ```bash
  rg "<Z-related-pattern>" src/ --type ts -l
  ```
  If Z now exists, the Non-Goal is invalidated.

- **Protocol message references** — Verify messages still exist:
  ```bash
  rg "<message_type>" <protocol-source-files>
  ```

- **Component references** — Verify components still exist:
  ```bash
  find <components-dir>/ -name "<ComponentName>*"
  ```

- **"Bridge does W"** statements — Check bridge still has that behavior:
  ```bash
  rg "<W-pattern>" <source-dir>/ --type ts -l
  ```

For each invalidated statement:
- If it changes the design fundamentally (Non-Goal now implemented, core
  assumption wrong): severity `broken`, autoFixable `false`
  - Description: "Assumption '<quote>' is no longer true because `<evidence>`"
- If it's a minor reference (renamed variable, moved function):
  severity `stale`, autoFixable `true`

### Step 5 — Obsolescence check

For each proposal, check whether the feature it introduces already exists:

1. Search for the New Capability name in existing specs:
   ```bash
   ls openspec/specs/ | grep "<capability-keyword>"
   ```

2. Search for feature-specific keywords from the proposal title:
   ```bash
   rg -l "<feature-keyword>" src/ --type ts
   ```

3. Check if implementation files the proposal plans to create already exist:
   ```bash
   ls -la <planned-new-file-path> 2>/dev/null
   ```

If strong evidence the feature already exists:
- Record issue: severity `obsolete`
- Description: "This feature appears to already be implemented. Evidence:
  `<file>` exists / spec `<name>` already covers this capability"

### Step 6 — Cross-proposal conflict detection

**Skip this step if running in single-proposal mode (`--proposal <name>`).**

Build a file-touch matrix. For each proposal, extract the files from its
Impact section. Then identify all files/capabilities touched by 2+ proposals.

For each overlap:
1. Read both proposals' descriptions of what they change in that file/capability
2. Assess if the changes are:
   - **Additive** (both add new things, no conflict) — severity `low`
   - **Potentially conflicting** (both modify the same area differently) — severity `medium`
   - **Incompatible** (architectural assumptions clash) — severity `high`

3. For medium/high conflicts, suggest a resolution:
   - Which proposal should go first?
   - Does one establish infrastructure the other needs?
   - Can scopes be adjusted to reduce overlap?

Record each conflict with:
- The proposal names involved
- The overlapping area (file or capability)
- Severity assessment
- Suggested resolution

### Step 7 — Priority scoring

For each proposal, calculate a priority score (lower = implement first):

```
Base = 50

SUBTRACT:
  -20  status is "ok" (no issues, ready to implement)
  -15  complexity is "trivial" (1-2 files, isolated)
  -10  no cross-proposal conflicts
  -10  no dependencies on other proposals
  - 5  touches fewer than 5 files

ADD:
  +20  status is "broken" (needs rework before implementable)
  +15  other proposals depend on this one (infrastructure change)
  +10  complexity is "fundamental" (architecture-level)
  + 5  has cross-proposal conflicts
```

**Classify complexity:**
- `trivial`: 1-2 files, isolated fix, no protocol/architecture changes
- `minor`: small feature, well-scoped, < 5 files
- `major`: cross-cutting, multiple components, protocol changes
- `fundamental`: architecture-level, breaking changes

**Dependency override:** If proposal A should be done after proposal B
(because B establishes patterns/infrastructure A needs), then
A.priority MUST be higher (worse) than B.priority regardless of raw scores.

**Obsolete override:** If status is "obsolete", set priority = 999.

**Empty override:** If a change directory has no proposal.md or only an
empty directory, set status = "empty" and priority = 999.

Sort proposals by priority (ascending). This is the suggested
implementation order.

### Step 8 — Generate sweep report

Display the report to the user in this format:

```markdown
## Coherence Sweep Report — <YYYY-MM-DD>

### Summary
| Proposal | Status | Issues | Complexity | Priority | Created |
|----------|--------|--------|------------|----------|---------|
| name     | ✅/⚠️/🔴/💀/📭 | N   | trivial/minor/major/fundamental | N | YYYY-MM-DD |

Status legend: ✅ OK  ⚠️ STALE  🔴 BROKEN  💀 OBSOLETE  📭 EMPTY

### Cross-Proposal Conflicts
| File/Area | Proposals | Severity | Suggested Resolution |
|-----------|-----------|----------|---------------------|

### Suggested Implementation Order
1. **name** (priority N) — reason
2. **name** (priority N) — reason
...

### Detailed Issues

(Show only for proposals with issues — skip ✅ OK proposals)

#### <proposal-name> (<status emoji>)
1. **[STALE]** Description
   - Caused by: <archive-name or codebase change>
   - Auto-fixable: yes
   - Fix: update `<old>` → `<new>` in `<artifact>`
2. **[BROKEN]** Description
   - Caused by: <archive-name>
   - Auto-fixable: no
   - Recommendation: <specific action>
```

For large sweeps (10+ proposals), show the summary table first, then
detailed issues only for flagged proposals. Do not expand ✅ OK proposals.

### Step 9 — Write proposal queue file

Write the analysis results to `.pi/proposal-queue.json`.

**If the file already exists**, read it first:
```bash
cat .pi/proposal-queue.json
```
Extract any `notes` fields from existing proposal entries. These are
user-added annotations that MUST be preserved in the updated file.

**Write the JSON file** following the schema in
[references/proposal-queue-schema.md](references/proposal-queue-schema.md).

Include:
- `lastChecked`: current ISO-8601 timestamp
- `lastSweepSummary`: e.g., "3 broken, 2 stale, 9 ok, 0 obsolete"
- `proposals`: array with full analysis per proposal
- `conflicts`: array of cross-proposal conflicts

After writing, announce:
> "Wrote `.pi/proposal-queue.json` with N proposals, M conflicts."

---

## Phase 2: Individual Triage

After displaying the sweep report, use the **AskUserQuestion tool** to ask:

> "Which proposals do you want to address? Pick from the flagged ones
> (e.g., 'terminal-emulator, session-tree-navigation'), say 'all' to
> process all flagged proposals in priority order, or 'none' to stop here."

If the user says "none", stop. The sweep report and JSON file are the output.

For each selected proposal, proceed based on its status:

### STALE proposals — auto-fix

For each issue with `autoFixable: true`:

1. **Show the proposed fix** before applying:
   ```
   In `<artifact>`:
   - Old: `<old text>`
   + New: `<new text>`
   ```

2. **Apply the fix** — edit the artifact file with the text replacement.

3. **Validate** after all fixes for this proposal:
   ```bash
   openspec validate <name>
   ```

4. If all issues were auto-fixable and now fixed, update the proposal's
   status to "ok" in `.pi/proposal-queue.json`.

### BROKEN proposals — guided conversation

For each issue with `autoFixable: false`:

1. **Present the conflict clearly:**

   ```markdown
   ## Issue: <short title>

   **In your proposal:** "<quote from the proposal artifact>"
   **In reality:** "<what actually exists or changed in the codebase>"
   **Caused by:** <archived change name or codebase evolution>

   ### Options
   A) <option that simplifies the proposal to match current reality>
   B) <option that preserves the original intent with adjustments>
   C) Defer — needs deeper investigation before deciding
   D) Mark as obsolete — this aspect is no longer needed
   ```

2. **Use AskUserQuestion tool** to get the user's decision (A/B/C/D or
   custom response).

3. **Apply the decision:**
   - **A or B**: Edit the relevant artifact (proposal.md, design.md, or
     specs/) to reflect the decision. Show the changes before applying.
   - **C**: Add a note to the proposal's `notes` field in the JSON:
     "Deferred: <issue description> — needs investigation"
   - **D**: Mark this specific issue as resolved, but if ALL issues for
     the proposal are marked D, suggest archiving the whole proposal.

4. **If the decision changes scope significantly**, offer:
   > "This changes the proposal fundamentally. Want me to regenerate
   > design.md and tasks.md? (This would use openspec-ff-change to
   > recreate downstream artifacts.)"

5. **Validate** after all changes:
   ```bash
   openspec validate <name> --strict
   ```

6. **Update** `.pi/proposal-queue.json` with resolved issues and new status.

### OBSOLETE proposals — suggest archival

1. Present the evidence:
   ```markdown
   ## Proposal `<name>` appears obsolete

   **Evidence:** <why it's obsolete — feature exists at `<file>`,
   capability `<name>` already covers this, etc.>

   Archive this proposal?
   ```

2. Use **AskUserQuestion tool** to confirm.

3. If confirmed:
   ```bash
   openspec archive <name> --skip-specs --yes
   ```
   Remove the entry from `.pi/proposal-queue.json`.

4. If rejected: change status from "obsolete" to "ok" or "stale" as
   appropriate, add a note explaining why it's still relevant.

### CONFLICT resolution — cross-proposal

When processing a proposal that has entries in the `conflicts` array:

1. **Show both proposals** for the conflicting area:
   ```markdown
   ## Conflict: <file/area>

   **Proposal A (`<name>`):** <what it plans to do>
   **Proposal B (`<name>`):** <what it plans to do>

   **Suggested resolution:** <from the conflicts array>
   ```

2. Use **AskUserQuestion tool**: "Accept this ordering? Or adjust scopes?"

3. **Update both entries** in `.pi/proposal-queue.json`:
   - Set `dependsOn` if an ordering was agreed
   - Adjust priorities to respect the ordering
   - Add notes about the resolution

---

## Gotchas

- **Untracked proposals**: Some proposals may not be committed to git yet.
  The dating fallback chain handles this — filesystem birthtime is the
  second option. If stat also fails, use the oldest archive date.

- **Empty changes**: Some changes (like `electron-embedding`) may have an
  empty directory or only a directory with no proposal.md. Mark these as
  status "empty" with priority 999 and skip all detection steps.

- **Partial artifacts**: Some proposals have only `proposal.md` without
  design.md or tasks.md. Run detection only against the artifacts that
  exist. Don't flag missing optional artifacts as issues.

- **Archive date parsing**: Archive directories use `YYYY-MM-DD-<name>`
  format. Always parse the first 10 characters as the date. Some names
  may contain extra hyphens — only the first 10 chars matter.

- **False positives**: When uncertain whether an issue is real, prefer
  the lower severity: STALE over BROKEN, BROKEN over OBSOLETE. Every
  issue MUST cite specific evidence (file path, archive name, code
  snippet). Never flag something without evidence.

- **Large sweeps**: With 10+ proposals, context pressure is real. Process
  proposals sequentially — gather context for one, analyze it, move to
  the next. Don't try to hold all proposals in memory at once. The
  summary table and JSON file accumulate results incrementally.

- **Cross-platform stat**: macOS uses `stat -f "%SB"`, Linux uses
  `stat -c "%W"`. Try macOS first, fall back to Linux syntax.

---

## Guardrails

- **Never modify artifacts without showing the change first** — even
  auto-fixes MUST be displayed before applying.
- **Never auto-fix BROKEN issues** — these always require human judgment
  via guided conversation. Only STALE issues with autoFixable: true
  can be auto-fixed.
- **Never archive without confirmation** — always ask before archiving
  proposals marked obsolete.
- **Always run `openspec validate` after any artifact modification.**
- **Preserve user notes** — when updating `.pi/proposal-queue.json`,
  read the existing file first and carry over any `notes` fields.
- **Ground all claims in evidence** — every issue must reference a
  specific file, archived change, or code snippet. Never speculate
  about what might be wrong. If you can't find evidence, don't flag it.
- **Respect single-proposal mode** — if `--proposal <name>` was given,
  do not analyze other proposals or run cross-proposal conflict detection.
