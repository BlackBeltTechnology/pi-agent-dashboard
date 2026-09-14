# mcp-client-folder-mobile.spec.ts — index

L3 mobile presentation of the folder MCP page (change: extract-mcp-client-plugin, tasks 8.1/8.4). Pins `/fixtures/kb-sample`, routes `/api/mcp-client/{effective,schema}` (a folder-layer `own` entry => an override chip), then at 390px asserts the chip is display-only, the editor sheet offers "Remove override", the inherited hint renders, every control is >=44x44, and a 403 renders only the not-allowed state with no retry.
