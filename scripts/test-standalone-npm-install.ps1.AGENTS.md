# test-standalone-npm-install.ps1 — index

Windows port of standalone-npm-install smoke. Packs workspaces, installs into isolated temp HOME, spawns pi-dashboard.cmd, polls /api/health (60s), asserts web UI reachable. -Port -Keep flags. Locks three Windows spawn bugs (jiti file:/// wrap, npm.cmd shell:true, node.exe prefix).
