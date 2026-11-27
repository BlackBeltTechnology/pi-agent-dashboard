# bridge-identity-log.ts — index

`appendIdentityLog(report, env?)`: one JSON line per server identity failure in `~/.pi/dashboard/local/bridge-identity.log` (`0600`, rotated to `.1` past 256 KiB, best-effort, never throws). The off-channel record a squatter cannot suppress. See change: loopback-credential-proof (D8).
