# inproc-mail.ts — index

`frameMailBlock`/`frameMailBatch`/`mailIdsKey`: one block per mail (core `formatEnvelope` line, unquoted `[agent-teams · mail id <id>]`, body lines quoted `│ `, core 150-line cap + marker, `compareMailIds`); `cmdId` hash of sorted ids. See change: add-agent-teams-in-process.
