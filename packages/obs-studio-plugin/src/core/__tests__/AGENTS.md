# DOX — packages/obs-studio-plugin/src/core/__tests__

Never talk to real OBS: `fake-obs.ts` (obs-websocket v5 over `ws`) + `obs-model.ts` (stateful collection). See change: add-obs-studio-plugin.

| File | Purpose |
|------|---------|
| `cli-harness.ts` | `runCli`, `baseDeps`, `recordingCli`, temp home, `writeServices`. |
| `connection.test.ts` | E1 resolution decision table, X1 closed port / auth-failed / Hello withheld / unanswered request. |
| `fake-obs.ts` | Fake server: Hello/Identify with real auth challenge, scripted handlers, frame log, `withholdHello`. |
| `install-doctor-stop.test.ts` | E12 install (plan, no brew, no digest, zip-slip/symlink), E13 doctor log fixtures, E14 stop. |
| `launch.test.ts` | E8 strike table, E9 races + retention + darwin argv. |
| `obs-model.ts` | Scenes/inputs/filters/outputs model; 601 on taken names. |
| `policy.test.ts` | E1 via `status`, E2 `call` denials, E3 crash deny (call + serve), E4 gating + stream key. |
| `presets-devices.test.ts` | E5 repeat/preserve, E6 partial/plugin-missing, E7 devices. |
| `provision.test.ts` | E10 registration, E11 ws-enablement table. |
| `serve.test.ts` | idle/EOF exit, out-of-order answers, probe sweep. |
