# dispatch.ts — index

`createDispatcher`: per eligible member claim the lowest-id owned pending unblocked task, else lowest-id unowned (`autoDispatch`, team override first), then a waking `task_assigned` mail with the full task (`details {taskId, preOwned}`). `run(team)` only for `active` teams.
