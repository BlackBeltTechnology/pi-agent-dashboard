# DOX — packages/flows-plugin

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `README.md` | Package overview. Flow rendering plugin. Owns React components + reducer slices reacting to `flow_*` events from external `pi-flows` pi extension. Extracted from `packages/client/` by change `extract-flows-as-plugin`. Imports: `/reducer` (`isFlowEvent`, `reduceFlowEvent`, `isArchitectEvent`, `reduceArchitectEvent`), `/client` (`FlowDashboard`, `FlowAgentDetail`, `FlowArchitect`, …). Slot claims declared in `pi-dashboard-plugin` manifest. |
| `vitest.config.ts` | Vitest config for flows-plugin package. jsdom env, `src/**/__tests__/**/*.test.{ts,tsx}` include, `pool: "forks"`, `maxWorkers: "50%"`. globalSetup imports `@blackbelt-technology/pi-dashboard-shared/test-support/setup-home.ts`. |
