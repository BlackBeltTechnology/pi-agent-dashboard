# git-link-builder.ts — index

Parse SSH/HTTPS remote URLs into branch + PR links. Exports `parseRemoteUrl`, `detectPlatform`, `buildGitLinks`, `GitLinks`, `ParsedRemote`. Supports github, gitlab, bitbucket, gitea, codeberg, sourcehut platforms.

`parseRemoteUrl` runs shared `stripRemoteCredentials` FIRST, so URL userinfo can never be captured into a host or a link; userinfo-bearing unparseable remote ⇒ `undefined` ⇒ no links. `ssh://` remotes still build no link. See change: harden-bridge-inbound-and-discovery (D18).
