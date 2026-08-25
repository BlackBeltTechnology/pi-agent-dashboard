# dashboard-plugin-loader Specification

## ADDED Requirements

### Requirement: `ServerPluginContext` exposes the in-process model runtime

`ServerPluginContext` SHALL expose an optional `modelRuntime` accessor so a plugin `server` entry
can run model completions through the same in-process seam the dashboard uses internally, without
a loopback HTTP hop to the model proxy:

```ts
modelRuntime?: {
  getModelRegistry(): Promise<LlmModelRegistry | null>;
  streamSimple: LlmStreamFn;
};
```

It SHALL resolve credentials via the shared OAuth/api_key-aware registry (auth.json +
providers.json), identical to the seam `server.ts` passes to core routes today. When the model
proxy is unavailable the accessor SHALL be absent (or resolve null), and the plugin SHALL degrade
gracefully (the same "backend unavailable" path core uses).

#### Scenario: Server-entry plugin runs a completion in-process

- **WHEN** a plugin `server` entry calls `ctx.modelRuntime.getModelRegistry()` then
  `ctx.modelRuntime.streamSimple({ model, messages, … })`
- **THEN** the completion SHALL stream through the dashboard's in-process runtime with
  server-resolved credentials
- **AND** it SHALL NOT require the plugin to call `/v1/chat/completions` over the network

#### Scenario: Model runtime unavailable

- **WHEN** the model proxy/registry is not resolvable
- **THEN** `ctx.modelRuntime` SHALL be absent (or `getModelRegistry()` resolves null)
- **AND** the plugin SHALL surface a degraded/unconfigured state rather than throwing at load
