# tunnel.ts — index

Tunnel ("Gateway") integration — thin delegation layer over `tunnel-core.ts` + `tunnel-providers/zrok.ts` (byte-identical behaviour). Exports `detectZrokBinary`, `cleanupStaleZrok`, `createTunnel(port,reservedToken,retries)`, `deleteTunnel(port)`, `scavengeOrphanZrokProcesses(port)`, `getTunnelUrl`, `getTunnelStatus`, `loadZrokEnv`, `releaseShare`, `writeZrokPid`/`readZrokPid`/`removeZrokPid`, `_resetBinaryCache`/`_setBinaryAvailable`. See change: add-tunnel-providers.
