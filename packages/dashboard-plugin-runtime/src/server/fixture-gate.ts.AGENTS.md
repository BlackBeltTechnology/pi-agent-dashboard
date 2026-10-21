# fixture-gate.ts — index

`FIXTURE_PLUGINS_ENV` (`PI_DASHBOARD_FIXTURE_PLUGINS`), `fixturePluginsEnabled(env?)` (exactly `"1"`), `fixtureEntryAllowed(manifest,env?)`. Gates `fixture: true` server/bridge entries (loader, server bridge auto-registration) and keeps fixture clients in a production vite build. Set only by the docker test harness. See change: expose-plugin-credential-and-oauth-seams.
