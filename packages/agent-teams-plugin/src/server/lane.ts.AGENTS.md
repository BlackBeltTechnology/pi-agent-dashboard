# lane.ts — index

`createLaneHandlers` (`agent-teams/call|hello|busy|idle|ack`, local-origin gate, caller from `meta.sessionId`, own-property payload reads) and `registerLane` (`hubLocalOnly:true`; logs once and returns false when the seam is absent). `hello` payload reads `planToolsActive` (boolean, else invalid). See change: add-agent-teams-templates-hooks. `admit(meta, payload)` passes the payload to `resolveCaller`; a rejected `as` answers its code on call/hello/busy/idle/ack. See change: add-agent-teams-in-process.
