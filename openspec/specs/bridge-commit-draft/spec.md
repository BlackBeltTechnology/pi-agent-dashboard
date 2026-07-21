# bridge-commit-draft Specification

## Purpose

Draft a Conventional Commits message for a session's uncommitted changes without polluting the visible conversation. The bridge gathers the staged diff for the chosen files plus a compact summary of the live session context, seeds a throwaway in-process fork-subagent, prompts it once for a commit message, captures the assistant text, and disposes the subagent. A fallback ladder degrades from a context-seeded draft to a diff-only draft to a deterministic stub so the request always resolves with a usable message.

## Requirements

### Requirement: Commit-draft request handling

The bridge SHALL handle a `git_commit_draft` request that names a working directory and a list of files, and SHALL respond with a `git_commit_draft_result` carrying the drafted message and the source rung that produced it.

The bridge SHALL never throw for this request and SHALL always resolve with a usable message.

#### Scenario: Well-formed request returns a draft result

- WHEN a `git_commit_draft` message arrives with a `requestId`, `cwd`, and a `files` array
- THEN the bridge resolves the working directory from the message `cwd`, falling back to the caller's cwd and then the process cwd
- AND it returns a `git_commit_draft_result` echoing the `sessionId` and `requestId`
- AND the result carries a `message` string and a `source` of `fork-subagent`, `diff-only`, or `stub`

#### Scenario: Malformed files payload degrades safely

- WHEN the `files` field is not an array of strings
- THEN the bridge coerces it to an empty list, keeping only string entries
- AND the draft proceeds without throwing, falling to the deterministic stub

### Requirement: Staged diff gathering

The system SHALL build the diff fed to the model by running `git diff HEAD -- <path>` for each chosen file and joining the per-file diffs.

The system SHALL cap the diff at a byte budget (default 24000 bytes), appending a truncation marker when the diff exceeds the budget, and SHALL treat a diff-gathering failure as an empty diff.

#### Scenario: Diff assembled per chosen file

- WHEN the draft runs for a set of files
- THEN each file's diff is produced from `git diff HEAD -- <file>` and the per-file diffs are joined
- AND a file whose diff command errors or is empty contributes an empty string rather than aborting the draft

#### Scenario: Oversized diff truncated

- WHEN the assembled diff exceeds the byte budget
- THEN the diff is clipped to the budget and a `[diff truncated at <n> bytes]` marker is appended before it is sent to the model

#### Scenario: Diff gathering throws

- WHEN building the diff raises an error
- THEN the diff is treated as an empty string and the ladder continues

### Requirement: Ephemeral in-process fork-subagent

The system SHALL run exactly one agent turn on an ephemeral in-memory `AgentSession` created on the live session's model with no tools, SHALL capture only the assistant text from the event stream, and SHALL always dispose the subagent. The visible conversation SHALL never be appended to.

#### Scenario: Draft captured off the event stream

- WHEN a subagent draft runs
- THEN a throwaway `SessionManager.inMemory` `AgentSession` is created on the live session's model with an empty tool set and the resolved cwd
- AND the runner subscribes to the session and accumulates only `message_update` events whose `assistantMessageEvent` is a `text_delta`
- AND after the single `prompt` completes the captured text is trimmed and returned
- AND the subscription is unsubscribed and the session disposed in every outcome

#### Scenario: No model available

- WHEN the live session exposes no model
- THEN the runner throws before creating a subagent, triggering a lower ladder rung

#### Scenario: Empty assistant output

- WHEN the captured assistant text is empty after trimming
- THEN the runner throws `empty-draft`, triggering a lower ladder rung

#### Scenario: Hung turn abandoned

- WHEN the agent turn does not complete within the timeout (default 30000 ms)
- THEN the turn is abandoned via a timeout rejection and the subagent is disposed

### Requirement: Session-context extraction

The system SHALL derive the fork-subagent's context seed from the live session's built context, flattening each message to a `role: text` line, and SHALL return no context when the session context is unavailable or empty so the draft drops to the diff-only rung.

#### Scenario: Context flattened to bounded text

- WHEN the session context contains messages
- THEN each message is rendered as `<role>: <text>`, string and array content are both flattened to text, and the joined block is returned
- AND when the joined block exceeds the character budget (default 8000) it is trimmed to the trailing budget

#### Scenario: Context unavailable

- WHEN the session context is missing, has no messages, or produces no text
- THEN the extractor returns no context, forcing the diff-only rung

### Requirement: Fallback ladder

The system SHALL attempt the draft in a fixed order — context-seeded fork-subagent, then diff-only one-shot, then deterministic stub — advancing to the next rung on any failure, timeout, or empty result, and SHALL tag the result with the rung that succeeded.

#### Scenario: Context-seeded rung succeeds

- WHEN session context is available and the fork-subagent returns a non-empty message
- THEN the result is returned with source `fork-subagent`

#### Scenario: Falls to diff-only

- WHEN context is unavailable or the context-seeded turn fails, and the diff-only turn returns a non-empty message
- THEN the result is returned with source `diff-only`

#### Scenario: Falls to stub

- WHEN no agent runner is provided, or both agent rungs fail or return empty
- THEN a deterministic stub message derived from the file list is returned with source `stub`

#### Scenario: Stub message shape

- WHEN the stub is produced
- THEN an empty file list yields `chore: update files`, a single file yields `chore: update <file>`, and multiple files yield `chore: update <n> files` followed by a blank line and a bulleted file list

### Requirement: Conventional-commit prompt and sanitization

The system SHALL seed the subagent with an instruction to output only a single Conventional Commits message (a `type(scope): subject` line of at most 72 characters, optional blank line and body, no code fences or preamble) followed by the session context and the fenced diff, and SHALL strip surrounding code fences from the returned text.

#### Scenario: Seed composition

- WHEN a subagent rung runs
- THEN the seed contains the Conventional Commits instruction, and for the context rung a `## Session context` block, and a `## Diff` block wrapping the diff in a ```diff fence
- AND the diff-only rung omits the session-context block

#### Scenario: Fenced output cleaned

- WHEN the model wraps its message in a leading ```lang fence and trailing fence
- THEN the fences are removed and the message is trimmed before it is returned
