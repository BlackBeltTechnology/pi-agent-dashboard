## Why

`/api/file/raw` serves `.svg` inline (`packages/server/src/routes/file-routes.ts:1196-1201`) under a report-only default dashboard CSP (`packages/server/src/auth/csp.ts:6-10`). Opened directly in a browser tab, a script-bearing SVG from the workspace runs with the dashboard's origin. `extend-craft-web-to-all-apps` added a script filter for SVGs that craft-web frames WRITE (D7), but any other way an SVG reaches the workspace (the agent, git, a download) is unfiltered. Raised as task 6.2 of that change.

## What Changes

- Serve `.svg` from `/api/file/raw` with `Content-Security-Policy: sandbox` (and `script-src 'none'`), so a directly opened SVG cannot run script or reach the dashboard origin, while `<img>` previews keep working.
- Consider `Content-Disposition: attachment` for direct navigations only if `sandbox` proves insufficient in a supported browser.

## Capabilities

### Modified Capabilities

- The file-serving capability that owns `/api/file/raw` responses.

## Impact

`packages/server/src/routes/file-routes.ts` + tests. No client change expected (previews use `<img>`).

## Discipline Skills

- `security-hardening` — response headers on untrusted workspace content.
