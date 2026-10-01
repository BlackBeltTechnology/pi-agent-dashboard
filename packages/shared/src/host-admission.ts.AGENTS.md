# host-admission.ts — index

Browser-safe host-admission primitives shared by the server gate and the Settings editor. `HOST_HEADER_RE` (raw Host parse), `BARE_HOSTNAME_RE` + `isValidBareHostname` (allowedHosts entry — no scheme/port/path, alnum/hyphen labels), `parseHostname` (port/IPv6-brackets/trailing-dot/case normalisation; unbracketed IPv6 returned lower-cased for `net.isIP`), `hostnameFromUrl` (skip-on-unparseable), `HostGateMode`, and the `HostGateResponse`/`HostGateAdmittedRow`/`HostGateRecentEntry` wire types. See change: add-host-allowlist-admission.
