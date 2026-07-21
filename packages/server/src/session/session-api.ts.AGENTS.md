# session-api.ts — index

REST wrappers for session control. Exports `registerSessionApi(fastify, deps)`. Routes: `/api/session/:id/{prompt,abort,shutdown,rename,hide,unhide,resume,flow-control,model,thinking-level,attach-proposal,detach-proposal}` and `/api/session/spawn`. Tags user-resume intent; handles fork-empty-session degrade.
