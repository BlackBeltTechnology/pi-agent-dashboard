## REMOVED Requirements

### Requirement: FlowInfo type definition

**Reason**: Core no longer carries a flow list. The flow entry shape is owned by the flows plugin (see `flows-catalog`).
**Migration**: Use the flows plugin's catalog entry type; nothing in core references `FlowInfo`.

### Requirement: Extension-to-server flows_list message

**Reason**: The bridge extension no longer queries or sends the flow list; the flows plugin's bridge publishes a catalog event through declared event forwarding (see `flows-catalog`).
**Migration**: Consumers read the flows plugin catalog. Older bridges that still send `flows_list` are ignored by the server.

### Requirement: Server-to-browser flows_list message

**Reason**: The server no longer forwards a flow list; the catalog event rides the generic session event stream and replay (see `flows-catalog`).
**Migration**: Browser code reads the catalog from the flows plugin.

### Requirement: Bridge queries flows via flow:list-flows event

**Reason**: Only the flows plugin's bridge queries pi-flows (see `flows-catalog`).
**Migration**: None for users; the query moved into the plugin.
