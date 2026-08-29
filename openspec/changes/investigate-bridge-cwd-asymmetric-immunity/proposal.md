# investigate-bridge-cwd-asymmetric-immunity

## Why

Filed from `fix-bridge-mdns-migration-hijack` (its Open Question), per that
change's task 7.1. During the seven-arm cwd matrix that reproduced the bridge
mDNS migration hijack, every cwd except one lost its bridge to the stale
loopback-bound dashboard discovered over mDNS:

| cwd | result |
|---|---|
| `/private/tmp/wedge-repro` (git, no HEAD) | ❌ migrated, 502 |
| `/private/tmp/wedge2` (git + commit) | ❌ migrated, 502 |
| `/private/tmp/w-a`, `/private/tmp/w-b`, `/tmp/w-b` + openspec | ❌ migrated, 502 |
| `~/Project/zz-spawn-test-c` (bare git) | ❌ migrated, 502 |
| `~/Project/pi-chainlint` (real project, fully configured) | ❌ migrated, 502 |
| **`~/Project/pi-agent-dashboard`** (the server's own repo) | ✅ kept its bridge — twice, 2 h apart |

No mechanism for a cwd-dependent discovery decision has ever been identified.
The migration hijack fix removes the symptom behaviourally (an unreachable
candidate is never adopted), so the defect cannot recur through this hole —
but the second factor, whatever it is, is real and unexplained. It may matter
to any future feature that makes the bridge ask the network where its dashboard
is.

## What Changes

- **Investigation only — no behaviour change.** Determine why a session whose
  cwd is the dashboard server's own repository never migrated while six other
  cwds did, on the pre-fix build.
- Candidate hypotheses to test (none confirmed by the original evidence):
  the rendezvous record / pinned-socket resolution succeeding only in that
  repo (env vars set by the server for its own spawns); a dashboard plugin or
  extension loaded only there; different `PI_DASHBOARD_*` env inheritance for
  same-repo spawns; timing (that arm's spawn racing the advertisement
  differently).
- Method: instrument a pre-fix build (`keeperLog.capturePiOutput=true`),
  replay the seven-arm matrix, and diff the endpoint-resolution logs between
  the immune arm and the others.

## Capabilities

### New Capabilities

None expected. Add one only if the investigation surfaces a defect worth
specifying.

## Impact

- **Users:** none directly; this closes the unexplained corner of a fixed bug.
- **Blast radius:** none while investigation-only.

## Discipline Skills

- `systematic-debugging` — the whole change is a phased-evidence investigation
  into an unexplained asymmetry; hypotheses get killed by experiments, not
  guesses.
