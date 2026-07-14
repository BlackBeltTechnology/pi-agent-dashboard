# session-commit-action Specification

## Purpose
TBD - created by archiving change add-session-uncommitted-indicator-and-commit. Update Purpose after archive.
## Requirements
### Requirement: Commit a chosen subset of changed files from the card

The commit dialog SHALL let the user select which changed files to stage and commit, with a subject+body message, and SHALL commit only the selected files. The commit SHALL be constructed with argv/`execFile` and the message passed via stdin — never interpolated into a shell command.

#### Scenario: Commit only the selected files
- WHEN the user checks 3 of 5 changed files and commits
- THEN only those 3 files are staged and committed
- AND the 2 unchecked files remain uncommitted (the pill decrements accordingly)

#### Scenario: Commit is gated on valid input
- WHEN no file is selected OR the subject line is empty
- THEN the Commit button is disabled

#### Scenario: Message content cannot execute a shell
- WHEN the commit message contains shell metacharacters (quotes, newlines, `$()`)
- THEN the message is committed verbatim and no shell command is executed

#### Scenario: Commit failure is surfaced
- WHEN the commit fails (nothing staged, pre-commit hook rejects, not a repo, no identity)
- THEN the dialog shows the error code and the working tree is unchanged

### Requirement: Grouped same-cwd sessions commit at the folder level

For two or more non-worktree sessions sharing a cwd, the commit action SHALL be offered at the folder level (from `GroupGitInfo`), not per card, because the sessions share one working tree. The commit dialog SHALL operate on the shared cwd and stage only the selected files from that one tree.

#### Scenario: Commit is a folder-level action for grouped sessions
- WHEN two or more non-worktree sessions share a cwd
- THEN the Commit action appears in the folder header, not on the individual cards
- AND opening it targets the shared cwd

#### Scenario: Shared working tree commits once
- WHEN the shared tree contains changes produced by more than one session
- THEN the file picker lists all changed files in that tree
- AND committing the selected subset produces a single commit affecting only those files
- AND the resulting count updates for every session sharing that cwd

### Requirement: AI-drafted commit message via in-session fork-subagent

The dialog SHALL offer an AI-draft action that generates a conventional-commit message from the session's own context using an ephemeral in-process fork-subagent, WITHOUT appending any turn to the visible conversation. The drafted message SHALL be editable before commit, and the feature SHALL degrade gracefully when the model is unavailable.

#### Scenario: Draft from session context without polluting the conversation
- WHEN the user clicks AI draft
- THEN the bridge seeds an ephemeral in-memory AgentSession with the live session's context plus the staged diff, prompts once, returns the message, and disposes the subagent
- AND the visible conversation receives no new turn

#### Scenario: Drafted message is editable
- WHEN a draft is returned
- THEN it fills the editable subject and body fields
- AND the user can edit or re-draft before committing

#### Scenario: Draft degrades gracefully
- WHEN the fork-subagent path is unavailable or times out
- THEN the system falls back (compressed inheritContext → diff-only one-shot → manual entry with the AI-draft button disabled) and the dialog never hangs

