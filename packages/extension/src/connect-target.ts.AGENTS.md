# connect-target.ts — index

`parseConnectTarget()` / `describeConnectTarget()` — parses the overloaded `/dashboard connect <target>` argument into default/socket/port/url/instance. Shape-only: no fs, no network, so a mistyped path stays a PATH rather than becoming a bogus "no such instance". Resolution is a separate step (task 9.5). See change: add-pi-gateway-transport-identity.
