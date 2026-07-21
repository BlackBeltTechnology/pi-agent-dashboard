# event-forwarder.ts — index

Map pi event objects to `event_forward` protocol messages. Exports `mapEventToProtocol`. `extractSerializable` strips functions / AbortSignals / `{aborted}`-shaped objects so forwarding stays JSON-safe.
