## ADDED Requirements

### Requirement: Guard is always active in bridged sessions
The dashboard bridge extension SHALL install a credential guard in every pi session it runs in. The guard SHALL have no configuration and no switch to turn it off. It is best-effort protection against accidental disclosure, not a sandbox.

#### Scenario: Guard active with default settings
- **WHEN** a pi session runs with the dashboard bridge and no guard-related setting
- **THEN** a `read` of `~/.pi/agent/plugin-credentials.json` is blocked

### Requirement: Guard is independent of the path gate and the containment guard
The guard SHALL decide each tool call before the interactive agent path gate prompts. A path-gate grant, a YOLO session, a gate prompt answer, or the gate being disabled SHALL NOT turn a guard block into an allow. The guard is a separate capability from `path-containment-guard`. That guard's rule against analysing shell command text applies only to that guard and is not changed by this one.

#### Scenario: Path gate disabled
- **GIVEN** the interactive path gate is disabled
- **WHEN** the agent calls `read` on `~/.pi/agent/plugin-credentials.json`
- **THEN** the call is blocked by the credential guard

#### Scenario: Grant does not override
- **GIVEN** the path-grant store grants `~/.pi/dashboard`
- **WHEN** the agent calls `read` on `~/.pi/dashboard/vault.json`
- **THEN** the call is blocked and no gate prompt is shown

### Requirement: Protected credential paths
The protected paths SHALL be:
- `<home>/.pi/agent/plugin-credentials.json`;
- `<PI_CODING_AGENT_DIR>/plugin-credentials.json` when that variable is set;
- `<home>/.pi/dashboard/vault.json`;
- the file named by `PI_DASHBOARD_DATA_KEY_FILE` when that variable is set in the pi process;
- every sibling whose name starts with one of those file names followed by `.`.

#### Scenario: Corrupt backup sibling protected
- **WHEN** the agent reads `~/.pi/dashboard/vault.json.corrupt-20260101T000000Z`
- **THEN** the call is blocked

### Requirement: Path tools are blocked on protected credential paths
The guard SHALL block `read`, `edit`, `write`, `ls`, `find` and `grep` when the canonical target is a protected path. It SHALL also block `grep` when the target is a directory that directly contains a protected file. For `grep`, `find` and `ls`, a missing or empty `path` SHALL be treated as the session's working directory, as pi does, and decided like any other target. Targets SHALL be resolved with the interactive path gate's resolver and canonicaliser, which follows symlinks.

#### Scenario: Read of the plugin credential file blocked
- **WHEN** the agent calls `read` with path `~/.pi/agent/plugin-credentials.json`
- **THEN** the call does not execute and its result carries reason prefix `credential_guard`

#### Scenario: Symlink to the vault blocked
- **WHEN** `/w/repo/link` is a symlink to `~/.pi/dashboard/vault.json` and the agent reads `/w/repo/link`
- **THEN** the call is blocked

#### Scenario: Grep over the agent directory blocked
- **WHEN** the agent calls `grep` with path `~/.pi/agent`
- **THEN** the call is blocked

#### Scenario: Grep without a path from the dashboard directory blocked
- **GIVEN** the session's working directory is `~/.pi/dashboard`
- **WHEN** the agent calls `grep` with a pattern and no `path`
- **THEN** the call is blocked

#### Scenario: Unrelated read allowed
- **WHEN** the agent reads `~/.pi/agent/settings.json`
- **THEN** the credential guard does not block the call

### Requirement: Text rules scan only command-bearing and path-like fields
The guard's text rules SHALL apply to every tool call, built-in, extension or MCP, but SHALL scan only string values, at any depth, held under a field named `command`, `script`, `code`, `args`, `url`, `path`, `file`, `filePath`, `cwd`, `pattern` or `glob` (including strings in an array under such a field). String values under any other field name SHALL NOT be scanned.

#### Scenario: Non-command field of an extension tool not scanned
- **WHEN** an extension tool is called with a field `description` holding `~/.pi/dashboard/vault.json` and no scanned field naming a protected path
- **THEN** the credential guard does not block the call

### Requirement: Write and edit content is not scanned
For `write` and `edit`, the text rules SHALL NOT scan the content fields `content`, `newText`, `oldText` or the text of `edits[]` entries. Their targets are covered by the path rule.

#### Scenario: Edit of documentation quoting the vault path allowed
- **WHEN** the agent calls `edit` on `docs/credential-vault.md` with a `newText` containing `~/.pi/dashboard/vault.json`
- **THEN** the credential guard does not block the call

### Requirement: Tool input naming credential files is blocked
The guard SHALL block a tool call when a scanned string value of its input contains, case-insensitively, a path-like reference to a protected path: `.pi/agent/plugin-credentials.json` or `.pi/dashboard/vault.json` (either separator, sibling suffixes included), or the full path of another protected path. A bare file name SHALL NOT match.

#### Scenario: cat of the vault blocked
- **WHEN** the agent runs `bash` with `cat ~/.pi/dashboard/vault.json`
- **THEN** the call is blocked

#### Scenario: Ordinary command allowed
- **WHEN** the agent runs `bash` with `ls ~/.pi/agent`
- **THEN** the credential guard does not block the call

#### Scenario: Bare file name in a repository search allowed
- **WHEN** the agent runs `bash` with `rg plugin-credentials.json docs/`
- **THEN** the credential guard does not block the call

#### Scenario: Extension tool path blocked
- **WHEN** the agent calls an MCP tool `ctx_execute_file` with `path` `/home/u/.pi/dashboard/vault.json`
- **THEN** the call is blocked

#### Scenario: Glob naming a protected absolute path blocked
- **WHEN** the agent calls `grep` with `path` `/w/repo` and `glob` `/home/u/.pi/agent/plugin-credentials.json`
- **THEN** the call is blocked

### Requirement: Tool input invoking the data key or decrypt is blocked
The guard SHALL block a tool call when a scanned string value of its input matches, case-insensitively:
- `pi-dashboard-credential-key` together with a keychain command (`find-generic-password`, `delete-generic-password`, `secret-tool`, `Get-StoredCredential`, `CredentialManager`, `cmdkey`);
- `security` then whitespace then `dump-keychain`;
- `credentials` then whitespace then `decrypt`.

Indirection and encoded strings are not detected; the guard is bypassable.

#### Scenario: macOS keychain read of the data key blocked
- **WHEN** the agent runs `bash` with `security find-generic-password -s pi-dashboard-credential-key -w`
- **THEN** the call is blocked

#### Scenario: Linux keychain lookup blocked
- **WHEN** the agent runs `bash` with `secret-tool lookup service pi-dashboard-credential-key account data-key-v1`
- **THEN** the call is blocked

#### Scenario: Decrypt command blocked
- **WHEN** the agent runs `bash` with `pi-dashboard  credentials   decrypt --yes`
- **THEN** the call is blocked

### Requirement: Guard decisions fail closed and log without content
A blocked call SHALL return `block: true` with a reason that starts with `credential_guard`. The guard SHALL log one line per block, naming the tool and the matched rule but not the command text or any file content. An error inside the guard SHALL block only the call being evaluated and SHALL be logged.

#### Scenario: Internal error blocks the call
- **WHEN** path canonicalisation throws while the guard evaluates a `read`
- **THEN** that `read` is blocked and a `[credential-guard] error` line is logged

#### Scenario: Log line carries no command text
- **WHEN** the guard blocks `bash` with `cat ~/.pi/dashboard/vault.json | base64`
- **THEN** the log line names `bash` and the matched rule and does not contain `base64`
