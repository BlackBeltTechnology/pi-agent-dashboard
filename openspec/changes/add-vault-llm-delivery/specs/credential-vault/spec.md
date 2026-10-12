## MODIFIED Requirements

### Requirement: Per-project grants, default deny
The vault SHALL deliver a binding to a session only when a grant names that binding for the session's project key. A project with no grant SHALL receive nothing. A grant names one subject: a project key, or another subject type that a vault capability defines; only project-key grants deliver to sessions. A grant MAY name an account other than the binding's default, of the same provider and kind; that account is then used for that project.

The project key SHALL be one of the following:

- **Repository key.** The `origin` remote URL of the session's working directory, normalised as follows:
  - SSH (`git@host:owner/repo`, `ssh://user@host/owner/repo`) and HTTPS forms of the same repository SHALL be equal.
  - Userinfo and host case SHALL be ignored, as SHALL the default ports 22 (ssh), 443 (https) and 80 (http).
  - Non-default ports and path case SHALL be kept.
  - A trailing `.git` SHALL be ignored.
- **Directory key.** Used when no remote can be read. It is the pair (device id, resolved real path of the working directory). A grant to this key SHALL match that exact directory only.
  - For a session on a paired device, the device id SHALL be its authenticated pairing id.
  - For a session on the hub, the device id SHALL be `hub`.

A `file://` or local-path origin SHALL yield no repository key.

The project key SHALL be resolved from the session's own working directory whenever a session starts, including a new, resumed, forked or reloaded session in the same pi process. It SHALL NOT be derived from the directory the pi process was launched in. The key SHALL NOT change while that session runs. Commands that change directory SHALL keep the session's values.

Env bindings SHALL deliver only `key` accounts. `llm` bindings SHALL deliver the account kinds their delivery mode allows (see `vault-llm-credentials`, LLM bindings). A grant or default that points at an account the binding cannot deliver SHALL deliver nothing.

Grants SHALL be documented as least-privilege scoping, not as an authentication boundary.

#### Scenario: Unlisted project receives nothing
- **WHEN** a session starts in a project that has no grant
- **THEN** no vault value is delivered to it

#### Scenario: Per-project account choice
- **WHEN** binding `GEMINI_API_KEY` has default account "personal"
- **AND** the grant for project `github.com/acme/app` names account "work"
- **THEN** a session in that project receives the value of "work"
- **AND** a session in a project granted without an account receives the value of "personal"

#### Scenario: SSH and HTTPS clones share a grant
- **WHEN** a grant names `GEMINI_API_KEY` for `https://github.com/acme/app.git`, and a confirmed checkout's origin is `ssh://git@github.com/acme/app`
- **THEN** a session in that checkout is eligible for `GEMINI_API_KEY`

#### Scenario: Repository without a remote is keyed per device
- **WHEN** a grant names a binding for (device A, `/work/scratch`), and a session starts in `/work/scratch` on device B
- **THEN** the session on device B receives nothing

#### Scenario: Subdirectory does not inherit a directory grant
- **WHEN** a grant names a binding for (device A, `/work/scratch`), and a session on device A starts in `/work/scratch/sub`, which has no git remote
- **THEN** the session receives nothing

#### Scenario: Resumed session in another project is re-scoped
- **WHEN** a pi process launched in project A holds a session with `GEMINI_API_KEY` delivered
- **AND** the user resumes a session whose working directory is in project B, which has no grant
- **THEN** the resumed session's next shell command does not see `GEMINI_API_KEY`

#### Scenario: Git failure falls back to the directory key
- **WHEN** reading the origin remote fails for a session's working directory
- **THEN** the project key is the directory key, and only bindings granted to that key are delivered

#### Scenario: OAuth account delivered through an LLM binding only
- **WHEN** a project's grants include env binding `ANTHROPIC_OAUTH_TOKEN` whose default is an `oauth` account, and LLM binding `anthropic-work` with delivery `lease` whose default is the same account
- **THEN** `ANTHROPIC_OAUTH_TOKEN` delivers nothing, and `anthropic-work` is delivered as a lease
