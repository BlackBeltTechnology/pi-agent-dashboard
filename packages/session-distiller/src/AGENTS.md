# DOX — packages/session-distiller/src

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `cluster.ts` | Cross-session cluster + recurrence gate. `mergeIntoStore`, `promote`, `loadStore`/`saveStore`. Promote when distinct sessionIds >= N (default 3). `candidates.json` store. |
| `distill.ts` | Distill artifact + confidence decay. `distill`, `computeConfidence`, `CONFIDENCE_FLOOR`. Provenance `{sessionIds, model, date, confidence}`. Decay by age/model-change; workarounds decay fastest. |
| `jsonl-reader.ts` | Standalone JSONL reader. `parseSessionText`, `readSession`, `sessionHeader`. Skips+counts malformed lines. |
| `main.ts` | Orchestrator. `run()`, `main()` CLI. Pipeline harvest→segment→extract→cluster→promote→distill→route. Dry-run default; `--apply` persists watermark+store. |
| `route.ts` | Dedup + route + dry-run plan. `buildRoutePlan`, `sinkFor`, `summarizePlan`. procedure→skill_manage; fault/correction→memory(failure); decision→memory(project); doc→docs. Rule correction flags +AGENTS.md patch. |
| `segment.ts` | Segment trajectory into task episodes. `segment`, `isCorrection`. Boundaries: fresh user task, name change, time gap. Correction lexicon excluded from boundaries. |
| `signals.ts` | Five signal detectors + verification gate. `detectFaults`/`detectDecisions`/`detectCorrections`/`detectProcedures`/`detectDocumentation`, `extractSignals`. Drops unverified non-doc candidates. |
| `trajectory.ts` | Normalize events to trajectory. `buildTrajectory`, `pairToolCalls`. Pairs `toolCall.id` to `toolResult.toolCallId`. |
| `types.ts` | Shared types. `RawEvent`, `Trajectory`, `Turn`, `ToolPair`, `Episode`, `Candidate` union (fault/decision/correction/procedure/documentation). |
| `watermark.ts` | Watermark + session listing. `readWatermark`/`writeWatermark`, `listNewerSessions`, `timestampFromName`, `sessionDirName`, `cwdHash`. State under `~/.pi/agent/distill-session-knowledge/<cwd-hash>/`. |
