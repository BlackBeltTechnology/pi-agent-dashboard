# dashboard-slash.spec.ts — index

Browser E2E: spawn session → `/dashboard:server-health` asserts bash card + "ran locally" footer + `ok=true`; `!echo` asserts no footer. Exercises slash-exec pipeline + cwd-independent registry resolution in the Docker harness. See change: add-dashboard-slash-commands.
