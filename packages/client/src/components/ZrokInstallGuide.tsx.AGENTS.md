# ZrokInstallGuide.tsx — index

Exports `ZrokInstallGuide`. Tunnel setup install guide. `useServerOs` fetches `/api/tunnel-status` for `serverOs`. Renders OS-specific install steps (`DarwinGuide`/`LinuxGuide`/`WindowsGuide`) + shared `EnrollAndVerify` + restart-server section. Links myzrok.io, docs.zrok.io.
