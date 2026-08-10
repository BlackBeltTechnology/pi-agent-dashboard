# changelog-remote.ts — index

Fetch upstream CHANGELOG.md from GitHub raw for release notes newer than local tarball. Exports `deriveChangelogRawUrl`, `fetchRemoteChangelog`, `RemoteChangelogResult`, `FetchRemoteChangelogOptions`. ETag/`If-None-Match` 304 support, 10 s timeout, `PI_OFFLINE` skip, `null` on any hard failure so caller falls back to local. Accepts `repository` string / `{url,directory}` object forms.
