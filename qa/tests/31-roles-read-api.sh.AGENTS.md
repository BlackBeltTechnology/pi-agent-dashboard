# 31-roles-read-api.sh — index

L2 (#X8 → task 9.1). Starts a dashboard in a throwaway `$HOME` with NO pi session spawned, GETs `/api/roles`, asserts `200` + a non-empty `data` array — proving the roles-plugin server entry mounts the route before listen so the schema is readable session-less (404 if the entry never loaded). Hermetic, ports 18860/19860. Skips when `pi-dashboard` absent. See change: add-roles-read-api.
