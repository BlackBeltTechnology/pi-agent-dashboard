# transport-diagnostics.ts — index

`createTransportDiagnostics()` — bounded buffer (32, oldest dropped) that turns the endpoint decision + every re-target refusal into `bridge_diagnostic` messages once a sessionId exists, so 10.1/10.2 survive the default `capturePiOutput:false`. Throwing `send` never strands the rest. See change: add-pi-gateway-transport-identity (tasks 10.1/10.2/10.5).
