# openspec-tasks-api.ts — index

Pure fetch wrappers for `/api/openspec/tasks` endpoints. Exports `OpenSpecTask`, `TasksPayload`, `LineMismatchError` (typed 409), `fetchTasks(cwd, change, signal?)`, `toggleTask(cwd, change, id, done, line)`. Typed errors let UI map 409 line-mismatch to refetch + banner without string-matching.
