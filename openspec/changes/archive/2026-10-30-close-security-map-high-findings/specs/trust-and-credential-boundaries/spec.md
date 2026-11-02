## MODIFIED Requirements

### Requirement: Dashboard state is never served to an unproven caller
Every route that reads, writes, searches or probes a filesystem path for a client
(`/api/file*`, `/api/session-file`, `/api/pi-resource-file`, `/api/file/write*`,
`/api/grep`, file-mention resolution, open-in-system / reveal, and the live-server
static gates) SHALL
decide on the resolved real path. `<dashboard dir>/local/**` and
`<dashboard dir>/identity.key` SHALL be refused for every caller in every mode,
re-checked against the opened handle. Any other dashboard-dir path SHALL be
refused unless the caller is locally trusted or holds a login session.

The pi-agent credential files SHALL be refused on the same terms as
`<dashboard dir>/local/**`: for every caller, in every mode, at every route and
containment layer (session-cwd anchor including a cwd of `$HOME`, the `~/.pi`
anchor, git-root widening, operator access grants, file-mention resolution, grep
and the writable-markdown allowlist), decided on the resolved real path and
re-checked against the opened handle. The set is, in each agent directory
(`~/.pi/agent`, and the directory named by `PI_CODING_AGENT_DIR` when set):
`auth.json`, `mcp-auth.json`, `providers.json`, `plugin-credentials.json`,
`models.json`, `mcp.json` and `system-one/auth.json`, plus every sibling whose file
name starts with one of those names followed by `.`. The agent directory named by
`PI_CODING_AGENT_DIR` is read from the server process environment only. File names
SHALL be compared exactly on a case-sensitive volume and case-folded only on a
volume that folds case (volume class probed once per directory; a failed probe counts
as folding, so the over-refusing rule applies). Only the entry whose own file name
matches is refused: a file inside a directory whose name merely starts with
`<name>.` (for example `models.json.d/frag.json`) is a different entry and is
admitted. Nothing else under `~/.pi` or the agent directory SHALL be
newly refused: the `~/.pi` anchor stays, so skills, prompts and other agent files
(including `settings.json`) remain readable. The names of the credential files are
not secret, so `GET /api/file/tree` MAY list them; `GET /api/file/exists` for a
credential path is refused like every other credential read (it shares the containment
predicate, so there is no existence oracle). Their content is never served.

The refusal SHALL run on the real path before any in-cwd shortcut, including the
session-file route, and the opened-handle recheck SHALL cover every site that serves
file content: `GET /api/file`, `/api/file/raw`, `/api/file/render`, `/api/file/digest`,
`/api/file/md-read`, `/api/file/sheet`, the EML routes, `GET /api/session-file`,
`GET /api/pi-resource-file`, operator-grant reads and live-server static files. A converter that opens the path
out of process (`/api/file/rendered-pdf`) is decided on the real path before the
call. At the sites that have no refusal shape for this case today, the refusal SHALL
be: HTTP 403 `{"success":false,"error":"path outside working directory"}` for
`/api/file/digest`, `/api/file/md-read`, `/api/file/eml`, `/api/file/eml-attachment` and
`/api/file/rendered-pdf` (the shape `/api/file` and `/api/file/raw` already use), and the
live-server static file's existing not-servable answer, 404
`{"error":"live-server target not found"}`; never a 2xx and never a 500.
`GET /api/pi-resource-file` SHALL apply the same refusal, both tiers, on the
real path after its own location allowlist admits the path.

Search SHALL NOT return a match from a file whose device and inode equal an
always-refused file, whatever name or path it is reached by (a hard link inside the
searched directory included).

`POST /api/file/write-binary` SHALL apply the same refusal to its target on the real
path — for the overwrite and for the content hash it computes and may return — and
SHALL read that hash through the opened-handle recheck. A plugin-registered route that
returns file content SHALL obtain it through the host's guarded read
(`ServerPluginContext.readFileGuarded`, see `dashboard-plugin-loader`), which applies
the same refusal on the real path and the opened-handle recheck, and SHALL refuse the
request when that member is unavailable; it SHALL NOT read the path with plain
filesystem calls.

#### Scenario: local token unreadable from a relayed container
- **WHEN** `requireLocalProof` is unset, any session is running, and a bare loopback request with no proof calls `GET /api/file` for `~/.pi/dashboard/local/token` through that session's `~/.pi` anchor
- **THEN** the server SHALL refuse it and return no file content

#### Scenario: token dir refused even with proof
- **WHEN** a proofed local caller (Electron, CLI) or a signed-in session requests a path inside `~/.pi/dashboard/local/`, or `~/.pi/dashboard/identity.key`
- **THEN** the server SHALL refuse it

#### Scenario: symlink to the state dir is refused
- **WHEN** a session cwd contains a symlink that resolves into `~/.pi/dashboard/local/` and a caller requests it
- **THEN** the server SHALL refuse it, because the decision uses the resolved real path of the opened file

#### Scenario: auth secret unreadable without proof
- **WHEN** `requireLocalProof` is unset and a bare loopback caller without proof, or a paired device, requests `~/.pi/dashboard/config.json`
- **THEN** the server SHALL refuse it

#### Scenario: proofed local editor still opens config.json
- **WHEN** a proofed local caller opens `~/.pi/dashboard/config.json` in the editor pane
- **THEN** the read SHALL be admitted as before

#### Scenario: unproven local caller cannot raise an access prompt
- **WHEN** `requireLocalProof` is unset and a bare loopback request with no proof reads a path outside every containment anchor
- **THEN** the read SHALL be refused without holding the request for an operator access prompt

#### Scenario: grep cannot surface the token
- **WHEN** a bare loopback request with no proof runs `/api/grep` in a session whose cwd contains `.pi/dashboard/local/token`, with or without ripgrep installed
- **THEN** no match or content from that file SHALL be returned

#### Scenario: always-refused file swapped in after the check
- **WHEN** a path is replaced by a symlink to `~/.pi/dashboard/local/token` between the path check and the open
- **THEN** the read SHALL be refused because the opened handle's device and inode match the always-refused file

#### Scenario: provider credentials unreadable at observe tier
- **WHEN** a paired `observe`-tier caller calls `GET /api/file` for `~/.pi/agent/auth.json` through the `~/.pi` anchor of a running session
- **THEN** the server SHALL refuse it and return no file content

#### Scenario: credential file refused even with proof or operate
- **WHEN** a proofed local caller, a signed-in session or an `operate`-tier caller requests `~/.pi/agent/auth.json`, `mcp-auth.json`, `providers.json`, `plugin-credentials.json`, `models.json`, `mcp.json` or `system-one/auth.json`
- **THEN** the server SHALL refuse it

#### Scenario: HOME cwd does not expose credentials
- **WHEN** a session's cwd is `$HOME` and a caller requests `.pi/agent/auth.json` relative to that cwd, or by absolute path
- **THEN** the server SHALL refuse it, because the refusal runs before every anchor

#### Scenario: access grant does not admit a credential file
- **WHEN** an operator grant covers `~/.pi/agent` and a caller requests `~/.pi/agent/auth.json`
- **THEN** the server SHALL refuse it

#### Scenario: relocated agent directory is covered
- **WHEN** `PI_CODING_AGENT_DIR=/srv/pi-agent` is set and a caller requests `/srv/pi-agent/auth.json`
- **THEN** the server SHALL refuse it
- **AND** `~/.pi/agent/auth.json` SHALL still be refused

#### Scenario: quarantine and backup siblings are refused
- **WHEN** a caller requests `~/.pi/agent/auth.json.corrupt-20260101T000000Z`
- **THEN** the server SHALL refuse it

#### Scenario: symlink to a credential file is refused
- **WHEN** a session cwd contains a symlink that resolves to `~/.pi/agent/auth.json` and a caller requests it
- **THEN** the server SHALL refuse it, because the decision uses the resolved real path

#### Scenario: credential file swapped in after the check
- **WHEN** a path is replaced by a symlink or hard link to `~/.pi/agent/auth.json` between the path check and the open
- **THEN** the read SHALL be refused because the opened handle's device and inode match the credential file

#### Scenario: mention resolution does not resolve a credential file
- **WHEN** a file mention `~/.pi/agent/auth.json` is resolved for a session
- **THEN** the resolver SHALL return no match

#### Scenario: grep cannot surface or read credential content
- **WHEN** `/api/grep` runs in a session whose cwd is `$HOME`, with or without ripgrep installed, for a string that occurs in `~/.pi/agent/auth.json`
- **THEN** no match from that file SHALL be returned
- **AND** the JS fallback scan SHALL NOT read that file

#### Scenario: session-file in-cwd shortcut does not bypass the refusal
- **GIVEN** a running session whose cwd is `$HOME`
- **WHEN** an `observe`-tier caller requests `GET /api/session-file` with `path` `.pi/agent/auth.json`
- **THEN** the server SHALL respond 403 and return no file content
- **AND** the same request for `.pi/dashboard/local/token` SHALL respond 403

#### Scenario: pi-resource-file refuses provider credentials
- **WHEN** an `observe`-tier caller calls `GET /api/pi-resource-file` with `path` `~/.pi/agent/auth.json`
- **THEN** the server SHALL respond 403 and return no file content

#### Scenario: pi-resource-file through a HOME cwd cannot read dashboard state
- **GIVEN** a session whose cwd is `$HOME`, so `<cwd>/.pi/` is an admitted resource location
- **WHEN** an unproven caller requests `GET /api/pi-resource-file` for `~/.pi/dashboard/config.json`
- **THEN** the server SHALL refuse it
- **AND** the same request for `~/.pi/dashboard/local/token` SHALL be refused for every caller

#### Scenario: pi-resource-file decides on the real path of a symlink
- **WHEN** a symlink under a `node_modules/` directory resolves to `~/.pi/agent/auth.json` and a caller requests it through `GET /api/pi-resource-file`
- **THEN** the server SHALL refuse it, because the decision uses the resolved real path

#### Scenario: pi-resource-file still serves resource files
- **WHEN** a caller requests `GET /api/pi-resource-file` for `~/.pi/agent/skills/<name>/SKILL.md`
- **THEN** the file SHALL be served exactly as before this change

#### Scenario: grep drops a hard link to a credential file
- **GIVEN** a file inside the session cwd that is a hard link to `~/.pi/agent/auth.json`
- **WHEN** `/api/grep` runs in that session, with or without ripgrep installed, for a string that occurs in the credential file
- **THEN** no match from the hard-linked file SHALL be returned
- **AND** matches from ordinary files SHALL still be returned

#### Scenario: a file named like a models fragment is refused as a sibling
- **WHEN** a caller requests `~/.pi/agent/models.json.d`
- **THEN** the server SHALL refuse it, because its name starts with `models.json.`

#### Scenario: children of a directory named like a credential sibling are admitted
- **GIVEN** `~/.pi/agent/models.json.d/frag.json` and `~/.pi/agent/auth.json.bak/x.txt` exist
- **WHEN** a caller reads either file
- **THEN** the credential refusal SHALL NOT apply to it by name, because only the entry whose own name starts with `<name>.` is refused
- **AND** a request that resolves to a credential file's inode SHALL still be refused

#### Scenario: session-file refuses a swapped-in credential file
- **WHEN** a path inside the session cwd is replaced by a symlink or hard link to `~/.pi/agent/auth.json` between the check and the open
- **THEN** `GET /api/session-file` SHALL refuse the read because the opened handle matches the credential file

#### Scenario: grant reads are rechecked after open
- **GIVEN** an operator grant admits a directory
- **WHEN** a path inside it is swapped for a link to `~/.pi/agent/auth.json` after the containment check and read through any grant-admitted byte-serving site
- **THEN** the read SHALL be refused because the opened handle matches the credential file

#### Scenario: digest, markdown read, EML and live-server static recheck the handle
- **WHEN** a path is swapped for a link to `~/.pi/agent/auth.json` after the check and requested through `GET /api/file/digest`, `GET /api/file/md-read`, `GET /api/file/eml`, `GET /api/file/eml-attachment` or a live-server static file
- **THEN** each file route SHALL answer 403 `{"success":false,"error":"path outside working directory"}` and the live-server static file SHALL answer 404 `{"error":"live-server target not found"}`
- **AND** none SHALL return content or a digest of it

#### Scenario: listing the credential file names is not a disclosure
- **WHEN** a caller lists `~/.pi/agent` through `GET /api/file/tree`
- **THEN** the listing MAY include `auth.json` by name, and no content SHALL be returned
- **WHEN** a caller probes `GET /api/file/exists` for `~/.pi/agent/auth.json`
- **THEN** the route SHALL refuse it exactly like a content read, so the probe is not an existence oracle

#### Scenario: markdown write cannot target a credential sibling
- **WHEN** a caller asks the writable-markdown route to write `~/.pi/agent/auth.json.md`
- **THEN** the write SHALL be refused

#### Scenario: case-sensitive volume keeps distinct names
- **GIVEN** a case-sensitive volume holding both `auth.json` and `Auth.json` in the agent directory
- **WHEN** a caller requests `Auth.json`
- **THEN** the credential refusal SHALL NOT apply to it by name
- **AND** a request that resolves to the `auth.json` inode SHALL still be refused

#### Scenario: case-insensitive volume folds names
- **GIVEN** a case-insensitive volume
- **WHEN** a caller requests `~/.pi/agent/AUTH.JSON`
- **THEN** the server SHALL refuse it

#### Scenario: volume probe failure counts as folding
- **GIVEN** the volume-class probe of an agent directory fails
- **WHEN** a caller requests `~/.pi/agent/Auth.json`
- **THEN** the server SHALL refuse it, and the probe SHALL be made once per directory and cached

#### Scenario: write-binary refuses a hard link to a credential file
- **GIVEN** a file `x.docx` inside the admitted cwd that is a hard link to `~/.pi/agent/auth.json` and an enabled edit claim listing `.docx`
- **WHEN** a caller posts `/api/file/write-binary` with `mode=overwrite` for `x.docx` and an `expectSha1` that does not match
- **THEN** the server SHALL respond 403 `"target is not a writable handler file in scope"`
- **AND** no SHA-1 of the credential file SHALL appear in any response, and the file SHALL be unchanged

#### Scenario: write-binary refuses a credential target under a claimed extension
- **GIVEN** an enabled edit claim that lists `.json` and a cwd of `$HOME`
- **WHEN** a caller posts `/api/file/write-binary` for `.pi/agent/auth.json` in either mode
- **THEN** the server SHALL refuse it with 403 and write nothing

#### Scenario: write-binary still saves an ordinary handler file
- **WHEN** a caller saves a claimed file inside the cwd that is not a state or credential file
- **THEN** the save SHALL behave exactly as before this change

#### Scenario: flows plugin file route refuses a symlink to a credential file
- **GIVEN** a live session whose bridge reports a flow source `<cwd>/x.md` that is a symlink to `~/.pi/agent/auth.json`
- **WHEN** an `observe`-tier caller requests `GET /api/plugins/flows/file` for that session and path
- **THEN** the server SHALL respond 403 `"not a flow file of this session"` and return no file content

#### Scenario: flows plugin file route still serves a reported flow file
- **WHEN** an `observe`-tier caller requests a reported flow YAML or agent markdown file that is an ordinary file
- **THEN** its content SHALL be returned exactly as before this change

#### Scenario: automation plugin routes refuse a symlinked prompt or result file
- **GIVEN** `<cwd>/.pi/automation/<name>/prompt.md` (or a run's `result.md`) is a symlink to `~/.pi/agent/auth.json`
- **WHEN** a caller requests `GET /api/plugins/automation/definition` (or `/result`)
- **THEN** no credential bytes SHALL be returned and the route SHALL take its existing failed-read branch

#### Scenario: plugin route fails closed without the host seam
- **WHEN** a plugin file route runs on a host whose plugin context has no guarded read
- **THEN** it SHALL refuse the request and SHALL NOT fall back to reading the path directly

#### Scenario: other agent files stay readable
- **WHEN** a caller inside the `~/.pi` anchor requests `~/.pi/agent/skills/<name>/SKILL.md` or `~/.pi/agent/settings.json`
- **THEN** the read SHALL be admitted exactly as before this change
