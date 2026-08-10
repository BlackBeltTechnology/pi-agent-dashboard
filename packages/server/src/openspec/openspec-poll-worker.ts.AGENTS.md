# openspec-poll-worker.ts — index

Pure `deriveAndSerialize(req): {cwd, data, serialized, stampMtimes, racyNames}` + `parentPort` bootstrap. Worker computes pre + post call mtimes; reuses cached artifacts on `gateEnabled && cached.mtimeMs === preCallMtime`; runs `deriveArtifactStatus`; re-stats for TOCTOU and marks racy on mismatch; calls `buildOpenSpecData`; applies optional `groupId` join inline (`joinGroupIdsToOpenSpecData` shape); `JSON.stringify`s data in-worker so main loop never stringifies large payload. See change: offload-openspec-poll-to-worker.
