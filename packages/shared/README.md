# Pi Dashboard Shared

Protocol definitions, shared types, and utilities used by every Pi Dashboard
package — the bridge extension, the server, the web client, and plugins.

## Install

```bash
npm install @blackbelt-technology/pi-dashboard-shared
```

Subpath exports mirror the source layout:

```ts
import type { SessionEvent } from "@blackbelt-technology/pi-dashboard-shared/events";
import type { PluginManifest } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/manifest-types";
```

Also publishes `test-support/setup-home.ts`, the vitest `globalSetup` that isolates
`HOME` per test run — plugin authors can reuse it directly.

## License

MIT — part of [pi-agent-dashboard](https://github.com/BlackBeltTechnology/pi-agent-dashboard).
