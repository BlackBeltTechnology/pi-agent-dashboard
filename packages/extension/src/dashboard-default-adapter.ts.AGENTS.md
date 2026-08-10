# dashboard-default-adapter.ts — index

Built-in last-resort `PromptAdapter` (priority `9999`). Exports `DashboardDefaultAdapter`. Renders every prompt as `generic-dialog` component inline; any plugin adapter at default priority beats it. Registered unconditionally; works without pi-flows.
