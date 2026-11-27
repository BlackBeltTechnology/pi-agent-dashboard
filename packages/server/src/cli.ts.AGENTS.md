# cli.ts — index

`pi-dashboard` CLI entry. Exports `parseArgs` (subcommand + flags), `buildConfig` (CLI+env+file merge →… → see `cli.ts.AGENTS.md` `buildConfig()` records `hostFlag` alongside the resolved `host`. See change: warn-unreachable-trusted-networks. `classifyArgv` (one scan for the subcommand word; unknown word → exit 2 + `CLI_USAGE`), `cmdApi` (`pi-dashboard api <METHOD> <path>`), `login --local` prints the local-proof bootstrap link. See change: close-container-loopback-impersonation (D4).
