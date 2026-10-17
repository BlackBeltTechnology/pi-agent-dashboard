# Test Plan — mirror-dashboard-trust-to-pi

Stage: design   Generated: 2026-10-17

Hard gate passed: latency budget (p95 < 20 ms, 1,000 entries, 20-deep cwd), snapshot bound (no cap, warn > 5,000), reason-code vocabulary — all folded into `specs/pi-trust-mirror/spec.md`.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | pi-trust-mirror › durable sources | decision-table | L1 | automated | fixture stores: pin `/U/me/Documents`; `sources.pinned` ∈ {true,false}; choice ∈ {unset,true,false} | registry list + `filterMirrorEntries` | counted iff (source on ∧ choice≠false) ∨ choice=true; ignored rows carry `source-off` |
| E2 | pi-trust-mirror › durable sources | decision-table | L1 | automated | `accessGrants` source off; one persisted grant on a project root with choice `true`, one with no choice | filter | first counted, second ignored `source-off` |
| E3 | pi-trust-mirror › durable sources (current hook hash) | state-transition | L1 | automated | worktree-init entry recorded for hash H1; current hook hashes to H2 | filter | entry ignored with `hook-changed`; after recording H2 it counts |
| E4 | pi-trust-mirror › durable sources (server-lifetime excluded) | EP | L1 | automated | session-scoped worktree trust for `/r`; YOLO active with root `/w`; session access grant on `/g` | registry list | no counted entry for `/r`, `/w`, `/g`; snapshot contains none of those paths |
| E5 | pi-trust-mirror › access grant project root | state-transition | L1 | automated | persisted grant on `/r` with `.git`; snapshot written; then `.git` removed | bridge decision in `/r/app` | first decision yes; after removal undecided `not-project-root` |
| E6 | pi-trust-mirror › forbidden folders (exact) | BVA | L1 | automated | pins: `/Users`, `$HOME`, `/`, `/usr`, `$HOME/Documents` | filter | first four ignored `forbidden-folder`; `$HOME/Documents` counted |
| E7 | pi-trust-mirror › forbidden folders (subtree) | EP | L1 | automated | pins: `/private/tmp`, `/tmp/clone` (macOS realpath → `/private/tmp/clone`), `~/Downloads/x`, `~/.ssh/k`, `~/.aws/p`, `~/.cache/c` | filter | all ignored `forbidden-folder`; `forbiddenGrantSubjects()` output byte-identical before/after (grant rules untouched) |
| E8 | pi-trust-mirror › key function | golden | L1 | automated | inputs: `~/p`, symlink `/l → /U/me/w`, missing leaf `/U/me/nope/x`, NBSP name, case-variant `/U/ME/w` | `piTrustKey` vs installed pi `ProjectTrustStore` key (`getEntry` path) | identical string for every input; NBSP not normalised; relative input throws |
| E9 | pi-trust-mirror › decision order | decision-table | L1 | automated | rows: (recorded `/r:false`, pinned) · (`/a:false`,`/a/b:true`, query `/a/b/c`) · (none, pinned, ask) · (none, pinned, never) · (none, pinned, mirror disabled) · (no trust-requiring resources) | `decidePiTrust` | untrusted src `/r` · trusted src `/a/b` · trusted `pinned folder` · trusted `pinned folder` · equals pi resolution · trusted `implicit` |
| E10 | pi-trust-mirror › same folder identity | state-transition | L1 | automated | tmp folder pinned (snapshot records dev/ino/birthtime) | (a) unchanged; (b) delete + re-create same path; (c) entry without birthtime | (a) yes; (b) undecided `identity-mismatch`; (c) compares dev+ino only → yes |
| E11 | pi-trust-mirror › bridge session classes | decision-table | L1 | automated | {dashboard-spawned headless, dashboard-spawned interactive, non-spawned headless, non-spawned interactive} × `coverInteractive` {false,true}; cwd pinned | handler | only dashboard-spawned headless yes when false (others undecided `not-covered-session`); all yes when true |
| E12 | bridge-extension › canonical activation compare | EP | L1 | automated | activationCwd `/link/repo` (symlink → `/U/me/repo`), eventCwd `/U/me/repo`, dashboard-spawned headless, nothing recorded | handler | yes (activation rule) |
| E13 | bridge-extension › activation rule deny | BVA | L1 | automated | dashboard-spawned headless, activationCwd = eventCwd = `/private/tmp/clone` | handler | undecided; log line contains `forbidden-folder` |
| E14 | bridge-extension › recorded refusal | EP | L1 | automated | activation cwd `/r`, `trust.json` `{"/r": false}` | handler | undecided; log contains `recorded-entry` |
| E15 | pi-trust-mirror › lockless trust.json rules | EP | L1 | automated | trust.json variants: BOM + `{"/r":true}`; `{"/r":null}`; `{"/r":"yes"}`; torn `{"/r":tr`; absent | handler for `/r/app` with `/r` pinned | BOM → recorded (undecided `recorded-entry`); null → absent (yes via pin); "yes"/torn → undecided `store-unreadable`; absent → yes via pin |
| E16 | pi-trust-mirror + spawn-correlation › spawn token scrub | state-transition | L1 | automated | env `PI_DASHBOARD_SPAWN_TOKEN` ∈ {`t1`, `""`}; dashboard reachable / unreachable; `/reload` before first register; both register paths | bridge activation, then registers | env unset right after activation with `dashboardSpawned` captured first (true for `t1`, false for `""`); exactly one register carries `t1`, also after the reload; nested child env lacks the token |
| E17 | cross-scope-resource-disable › pre-selection | decision-table | L1 | automated | pinned cwd, nothing recorded, default `ask` | `POST /api/resources/toggle` local | 403 `trustRequired` with `preselected:"trust"`, source `pinned folder`, lasting-effect note; `<cwd>/.pi/settings.json` mtime unchanged; trust.json unchanged |
| E18 | cross-scope-resource-disable › refusal + never | decision-table | L1 | automated | rows: pinned + default `never` · exact `{"/r":false}` pinned · `{"/a":false}` + pinned `/a/b` | toggle | prompt (not refuse) · refused, no prompt · prompt without pre-selection |
| E19 | pi-trust-mirror › snapshot content | EP | L1 | automated | durable pin + session worktree trust | snapshot write | file mode 0600; entries only durable; no session path string in file bytes; generation strictly increases per change |
| E20 | pi-trust-mirror › snapshot size warning | BVA | L1 | automated | 5,000 then 5,001 counted entries | snapshot rewrite | no warning at 5,000; one warning log at 5,001 |
| E21 | pi-trust-mirror › settings defaults | EP | L1 | automated | config.json without `piTrustMirror`; with partial `{enabled:false}` | config parse | defaults `enabled:true, coverInteractive:false, sources.accessGrants:false`, others true; partial merges |
| E22 | pi-trust-mirror › per-entry choice lifecycle | state-transition | L1 | automated | pin via dialog with choice `false`; then folder moved to another workspace; pre-existing pin without choice | registry + Access data | choice kept after move; pre-existing marked "by default" |
| E23 | mcp-client-config › collisions unchanged | EP | L1 | automated | folder dashboard-trusted only, its `.pi/mcp.json` defines `docs` | global write of `docs` | no collision reported (pi-only predicate); same write with pi-trusted folder still collides |
| E24 | mcp-client-config › agent dir | EP | L1 | automated | `PI_CODING_AGENT_DIR=/x/agent` with `trust.json` `{"/r":true}` there; default dir empty | `host.isProjectTrusted("/r")` | true with source `/r` |
| E25 | mcp-client-config › dashboard-only live state | EP | L1 | automated | folder trusted only via pin; `pi mcp list` stub reports project servers absent; source accessor present / absent | effective view | project servers active, live `not checked by pi`, note that `pi mcp list` reports them not loaded; source field present / omitted |
| E26 | pi-trust-mirror › worktree key translation | EP | L1 | automated | worktree-init entry keyed `path.resolve('/l/repo')` where `/l` symlinks to `/U/me` | registry | entry keyed `/U/me/repo`; covers sessions in `/U/me/repo/x` |
| E27 | pi-trust-mirror › never writes trust.json | invariant | L1 | automated | trust.json fixture bytes B | 50 bridge decisions + 50 host predicate calls over mixed folders | trust.json bytes still B; mtime unchanged |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | pi-trust-mirror › bridge budget | tail-latency | L1 | automated | snapshot 1,000 entries; cwd 20 levels deep (covered by entry at depth 3); warm fs | handler decision p95 < 20 ms | 200 iterations |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | pi-trust-mirror › dialogs | decision-table | L1 | automated | default settings | open worktree-init dialog, pin dialog, Add Folder dialog, access-grant prompt | checkbox checked, checked, checked, unchecked; each shows text naming extensions + MCP servers incl. later additions |
| F2 | pi-trust-mirror › Access page | EP | L1 | automated | pinned `/U/me/Documents`; grant on `/private/tmp`; worktree entry `hook-changed`; agent dir `/x/agent` | render Access section | effective list row (folder, `pinned folder`, covers subfolders); ignored rows with codes `forbidden-folder`, `hook-changed` + label; precedence, coverInteractive and `--no-approve`/`--no-extensions` disclosures; agent dir `/x/agent` shown |
| F3 | mcp-client-folder-section › banner states | EP | L1 | automated | view.trustedBy ∈ {pi `/U/me/Project`, dashboard `pinned folder /U/me/Documents`, none}; coverInteractive false | render FolderMcpPage | three distinct texts; dashboard state mentions dashboard sessions only; none state links Settings → Access; no "not trusted" notice in the first two |
| F4 | cross-scope-resource-disable › prompt UI | state-transition | L1 | automated | trustRequired payload with `preselected:"trust"` | render ResourceTrustDialog; press Esc; reopen and confirm | trust option initially selected; lasting-effect text visible; Esc → no request sent; confirm → one `/api/resources/trust` call |
| F5 | pi-trust-mirror + bridge-extension (end to end) | state-transition | L3 | automated | harness folder with `.pi/mcp.json` (stdio echo server), pinned, trust.json empty | spawn headless session in it | session tool list contains the folder MCP server's tool; folder MCP page shows "trusted by the dashboard — pinned folder" |
| F6 | pi-trust-mirror › revocation (end to end) | state-transition | L3 | automated | state after F5 | unpin folder; spawn a new headless session | new session's tool list lacks the folder server; Access effective list no longer lists the folder |
| M1 | pi-trust-mirror › Access page wording | visual/subjective | — | manual-only | Settings → Access with several sources | operator reads the effective list and disclosures | [judgment: wording understandable; precedence + scope clear at desktop and mobile width] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | pi-trust-mirror › snapshot without server | fault-injection (abort) | L1 | automated | server process absent; snapshot lists pinned `/r` | dashboard-spawned headless handler in `/r` | yes; no network call attempted |
| X2 | pi-trust-mirror › snapshot missing/corrupt | fault-injection (abort) | L1 | automated | snapshot absent; snapshot `{"generation":` truncated | handler | undecided; no throw escapes |
| X3 | pi-trust-mirror › rollback while down | fault-injection | L1 | automated | server down; config.json `piTrustMirror.enabled:false`; snapshot lists `/r` | handler in `/r` (not activation cwd) | undecided |
| X4 | pi-trust-mirror › hook edited while down | fault-injection | L1 | automated | server down; repo hook edited after snapshot | handler in repo | undecided `hook-changed` |
| X5 | pi-trust-mirror › revocation write failure | fault-injection (abort) | L1 | automated | snapshot writer throws EACCES | unpin `/r` | unpin returns error; preferences still list `/r`; snapshot unchanged |
| X6 | pi-trust-mirror › grant choice write failure | fault-injection (abort) | L1 | automated | choices writer throws ENOSPC | pin `/r` with choice `false` | pin fails with error; `/r` not pinned; snapshot unchanged |
| X7 | pi-trust-mirror › unreadable choices | fault-injection | L1 | automated | `pi-trust-overrides.json` contains `{` | registry + Access data | pinned entries not counted; reason `choice-unreadable` |
| X8 | pi-trust-mirror › worktree revoke write failure | fault-injection (abort) | L1 | automated | worktree-init store write throws | revoke trust for `/r` hash H | revoke reports failure (no swallowed warn); snapshot already without `/r` |
| X9 | pi-trust-mirror › boot rebuild | fault-injection (crash) | L1 | automated | preferences contain pin `/r`; snapshot from before the pin (missing `/r`) | server boot | snapshot rebuilt and lists `/r`; generation > previous |
| X10 | mcp-client-config › unbuildable predicate | fault-injection (abort) | L1 | automated | pi core resolution throws at boot | `loadHostProjectTrust` | exactly one log line; predicate returns false |
| X11 | pi-trust-mirror › stat failure | fault-injection | L1 | automated | ancestor folder of cwd made unreadable (chmod 000) | handler | undecided `identity-mismatch`; no throw escapes |

---

## Coverage summary

- Requirements covered: 13/13 (pi-trust-mirror 8, bridge-extension 1, mcp-client-config 1, mcp-client-folder-section 1, cross-scope-resource-disable 1, spawn-correlation 1)
- Scenarios by class: edge 27 · perf 1 · frontend 7 · error 11
- Scenarios by level: L1 43 · L2 0 · L3 2 · manual 1
- Scenarios by disposition: automated 45 · manual-only 1

## New infra needed

- none (L3 reuses the docker harness flow of `tests/e2e/project-trust-headless-spawn.spec.ts` and `tests/e2e/mcp-client-project-override.spec.ts`)
