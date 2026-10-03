## REMOVED Requirements

### Requirement: The dashboard SHALL run against the factory pi-ai module generation only

**Reason**: The server no longer loads pi-ai modules itself; it uses pi's `ModelRuntime`, which owns module shape.

**Migration**: See `model-proxy-credential-routing` "The server SHALL use a single model runtime".

### Requirement: Derived factory-runtime subpaths SHALL be validated, never assumed

**Reason**: No pi-ai subpath is derived by the dashboard any more.

**Migration**: None; the runtime resolves its own modules.

### Requirement: Streaming SHALL preserve the transcript while credentials stay caller-resolved

**Reason**: Transcript normalization and credential resolution are performed by `ModelRuntime.streamSimple`.

**Migration**: See `model-proxy` "Proxy completions SHALL behave identically across runtime generations".

### Requirement: OAuth capability SHALL be probed and degrade diagnosably

**Reason**: OAuth comes from the runtime's provider definitions; there is no dashboard OAuth loader to probe.

**Migration**: See `model-proxy-credential-routing` "OAuth refresh SHALL survive relocation of the runtime's OAuth entry point" (modified).
