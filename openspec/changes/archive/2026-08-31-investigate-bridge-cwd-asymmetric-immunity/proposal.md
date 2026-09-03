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
| `/private/tmp/w-a`, `/private/tmp/w-b` (only w-b has `openspec/`) | ❌ migrated, 502 |
| `~/Project/zz-spawn-test-c` (bare git) | ❌ migrated, 502 |
| `~/Project/pi-chainlint` (real project) | ❌ migrated, 502 |
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
- Candidate hypotheses to test (none confirmed by the original evidence;
  ranked and refined in `design.md` D5): dual extension load unique to that
  repo (H-dual-load); per-arm resolution-code vintage from working-tree
  drift across the matrix window (H-resolution-path); a cwd-local config
  surface altering discovery (H-config); spawn timing racing the
  advertisement (H-timing).
- Method: forensics on surviving artifacts first; then, only as needed,
  instrument a pre-fix build (`keeperLog.capturePiOutput=true`), replay the
  seven-arm matrix in isolation, and diff the endpoint-resolution logs
  between the immune arm and the others.

## Capabilities

### New Capabilities

None — `.openspec.yaml` sets `skip_specs: true`. If the investigation
surfaces a defect worth specifying, it is filed as its own separate change;
no spec delta lands here.

## Impact

- **Users:** none directly; this closes the unexplained corner of a fixed bug.
- **Blast radius:** nothing lands from this change. The replay method
  itself carries a demonstrated hazard — the parent's E2E replay leaked test
  arms onto the live dashboard on all three attempts — contained by
  mandatory isolation with abort-on-leak (design D4).

## Discipline Skills

- `systematic-debugging` — the whole change is a phased-evidence investigation
  into an unexplained asymmetry; hypotheses get killed by experiments, not
  guesses.
- `node-inspect-debugger` — replay arms expose opaque runtime state (WS
  endpoint resolution inside the extension); breakpoint inspection applies if
  stdout probes prove insufficient.
