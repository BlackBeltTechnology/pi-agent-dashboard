## MODIFIED Requirements

### Requirement: One decision order serves every consumer

The folder decision SHALL be, as in pi ≥ 1.5.0: pi's nearest recorded entry for the cwd or an ancestor (true or false), read from the trust store of the pi agent directory in use and matched to trust-file keys as pi matches them (pi's `pathsEqual` on every platform: both paths are resolved, so a non-normalised key such as `/r/`, `/a//r` or `/a/./r` names `/r` or `/a/r`, and on Windows they are also compared case-insensitively), decides first, whether or not the cwd has trust-requiring project resources; otherwise a cwd with no trust-requiring project resources is implicitly trusted, with neither dashboard trust nor `defaultProjectTrust` consulted; otherwise, when `piTrustMirror.enabled` is true, dashboard trust covering the cwd decides trusted — taking precedence over `defaultProjectTrust`, including `"never"`; otherwise `defaultProjectTrust` decides. Server-side consumers SHALL evaluate dashboard trust over the durable and the live entries, with no folder proof (they observe the server's own folders); a bridge SHALL evaluate it over the snapshot and the live trust query. The bridge's session gate (`coverInteractive`, activation-cwd rule) applies after this folder decision and only in the bridge; server-side consumers do not apply it. Every decision SHALL carry its source: the recorded pi entry path, "implicit", the dashboard source kind with its entry, or the default. A trust store that cannot be read SHALL make the decision untrusted with no source, on every path, including a cwd with no trust-requiring project resources. Implicit trust SHALL be determined with pi's own function for trust-requiring resources, not a reimplementation. A session's command-line `--approve`/`--no-approve` is applied by pi before any of this, and `--no-extensions` keeps the bridge from deciding at all; both are outside the folder decision and SHALL be disclosed wherever dashboard trust is shown. Nothing in this decision SHALL write pi's trust store. The guarantee that a recorded pi entry wins holds at the moment the bridge reads the store and when no other extension answers `project_trust` before the bridge, because pi applies the first yes/no among extension handlers.

#### Scenario: Recorded pi refusal wins
- **WHEN** `trust.json` records `/r: false`, `/r` has `.pi/settings.json`, and `/r` is pinned
- **THEN** `/r` SHALL be untrusted

#### Scenario: Nearer recorded trust beats a farther refusal
- **WHEN** `trust.json` records `/a: false` and `/a/b: true`, and `/a/b/c` has `.pi/settings.json`
- **THEN** `/a/b/c` SHALL be trusted with source `/a/b`, whatever dashboard trust says

#### Scenario: No-approve flag wins in the session
- **WHEN** a session started with `--no-approve` is in a pinned folder
- **THEN** the folder's project resources SHALL NOT load in that session

#### Scenario: Dashboard trust fills the gap
- **WHEN** `trust.json` records nothing for `/r`, `/r` has `.pi/mcp.json`, `defaultProjectTrust` is `ask`, and `/r` is pinned
- **THEN** `/r` SHALL be trusted with source "pinned folder"

#### Scenario: Dashboard trust overrides a global never
- **WHEN** `defaultProjectTrust` is `never`, nothing is recorded for `/r`, `/r` has `.pi/mcp.json`, and `/r` is pinned
- **THEN** `/r` SHALL be trusted with source "pinned folder"

#### Scenario: Mirror disabled restores today's behaviour
- **WHEN** `piTrustMirror.enabled` is false and `/r` is pinned with nothing recorded in `trust.json`
- **THEN** the folder decision SHALL equal pi's own resolution, and the bridge SHALL keep only its activation-cwd per-run rule (including that rule's recorded-entry and forbidden-folder conditions, which the switch does not revert)

#### Scenario: Deciding never writes trust.json
- **WHEN** any session resolves trust through dashboard trust
- **THEN** `~/.pi/agent/trust.json` SHALL be unchanged by that resolution

#### Scenario: Server consumer sees live trust
- **WHEN** nothing is recorded for `/r`, `/r` has `.pi/mcp.json`, and `/r` is trusted "until dashboard restarts" only
- **THEN** the server-side folder decision for `/r` SHALL be trusted with source "worktree-init (until dashboard restarts)"

#### Scenario: Recorded refusal applies to a folder without project resources
- **WHEN** `trust.json` records `/r: false` and `/r` has no trust-requiring project resources
- **THEN** `/r` SHALL be untrusted with source `/r`
- **AND** a dashboard trust entry covering `/r` SHALL NOT change that

#### Scenario: Windows recorded refusal saved with different casing still wins
- **WHEN** on Windows `trust.json` records `C:\Work\Repo: false`, the folder has `.pi/settings.json` and is pinned, and the bridge's key for the session cwd is `c:\work\repo`
- **THEN** the folder decision SHALL be untrusted with source `C:\Work\Repo`
- **AND** the bridge SHALL return undecided at `project_trust` and log the reason code `recorded-entry`

#### Scenario: Non-normalised recorded refusal still wins
- **WHEN** `trust.json` records `/r/: false` (a trailing separator), `/r` has `.pi/settings.json`, and `/r` is pinned
- **THEN** `/r` SHALL be untrusted with source `/r/`
- **AND** the bridge SHALL return undecided at `project_trust` and log the reason code `recorded-entry`

#### Scenario: Nothing recorded and no project resources is implicit
- **WHEN** `trust.json` records nothing for `/r` or any ancestor, `/r` has no trust-requiring project resources, and `defaultProjectTrust` is `never`
- **THEN** `/r` SHALL be trusted with source "implicit"

#### Scenario: Held trust lock fails closed within a bound
- **WHEN** pi's trust lock file is held for the whole call and the server decides `/r`, which has no trust-requiring project resources
- **THEN** `/r` SHALL be untrusted with no source
- **AND** each server-side decision SHALL return within 250 ms

### Requirement: Remote bridges get trust only when pi's trust-requiring resources match

For a paired-device requester a covered answer SHALL carry a fresh salt and a salted digest, bound to the cwd key, of the content of every resource pi's trust gate protects for that cwd (`.pi` configuration resources, ancestor `.agents/skills` except the user's own, identified as pi identifies it: compared with pi's `pathsEqual`, so a cwd and home that differ only in casing on Windows still exclude the user's own directory). The bridge SHALL recompute it and trust only on equality of two computed digests. An empty set, a symlink, code referenced from outside the set, or over 1,000 files / 16 MiB fails closed: `identity-weak`.

#### Scenario: NFS-shared folder at the same path
- **WHEN** a remote bridge's `/work/x` is the server's `/work/x` shared over NFS, `/work/x` is covered, and its trust-requiring resources are byte-identical on both sides
- **THEN** the bridge SHALL decide trusted for that run

#### Scenario: Same top level, different MCP config
- **WHEN** a remote bridge's `/work/x` is an mtime-preserving copy of the server's covered `/work/x` except for `.pi/mcp.json`
- **THEN** the digests SHALL differ and the bridge SHALL return undecided with `identity-mismatch`

#### Scenario: Resource set too large
- **WHEN** the cwd's trust-requiring resources hold 1,500 files
- **THEN** the bridge SHALL return undecided with `identity-weak`

#### Scenario: Symlinked extensions fail closed
- **WHEN** the cwd's `.pi/extensions` contains a symlink
- **THEN** the bridge SHALL return undecided with `identity-weak`

#### Scenario: Settings reference a package
- **WHEN** the cwd's `.pi/settings.json` lists an npm package or an extension path outside the hashed set
- **THEN** the bridge SHALL return undecided with `identity-weak`

#### Scenario: Digest of a typical tree stays within budget
- **WHEN** the cwd's trust-requiring resources hold 200 files totalling 2 MiB on local disk
- **THEN** computing the digest SHALL take p95 below 200 ms on each side

#### Scenario: Salt is fresh per answer
- **WHEN** the same remote bridge queries the same covered folder twice
- **THEN** the two answers SHALL carry different salts

#### Scenario: Remote answer omits the source
- **WHEN** a paired device receives a covered answer
- **THEN** the answer SHALL NOT name the source kind or the covering folder's recorded identity
