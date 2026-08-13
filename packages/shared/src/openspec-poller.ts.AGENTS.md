# openspec-poller.ts — index

Aggregates `openspec list`+`status` into `OpenSpecData`. `pollOpenSpec(cwd)` sync (bridge), `pollOpenSpecAsync(cwd)` async (server, parallel status via `runAsync`). `buildOpenSpecData(list, status, designProbe?, specsProbe?)` applies design/specs promote-only overrides + re-derives `isComplete`. `deriveArtifactStatus(changeDir, listEntry, probes)` replaces per-change spawn. `runOpenSpecList`/`runOpenSpecStatus`, `createFsProbeFactory`/`createFsSpecsProbeFactory`.
