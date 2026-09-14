/**
 * Lazy adapter-version diagnostic for the `/mcp` endpoint.
 *
 * The version probe lives in the `mcp-client` plugin's core
 * (`adapter-verdict.ts`). This plugin consumes the `mcp-client.config` service
 * lazily — NOT at registration — so a missing service yields `unknown` rather
 * than blocking plugin load, and the below-floor warning is emitted once on the
 * first `/mcp` request, when it is actually relevant.
 *
 * See change: extract-mcp-client-plugin (task 6.1).
 */
import {
  ADAPTER_VERSION_FLOOR,
  type AdapterVerdict,
  type McpClientConfigService,
} from "@blackbelt-technology/pi-dashboard-mcp-client-plugin/core";

type VerdictSource = Pick<McpClientConfigService, "adapterVerdict">;

/** The consumed service's verdict, or `unknown` when the service is absent. */
export function adapterVerdictOf(service: VerdictSource | undefined): AdapterVerdict {
  return service?.adapterVerdict() ?? { kind: "unknown", floor: ADAPTER_VERSION_FLOOR };
}

export interface AdapterWarnLog {
  warn(msg: string): void;
}

/**
 * Build a callback that warns at most once about a non-`ok` adapter verdict.
 * Pure until invoked — calling this at registration emits nothing, so the
 * warning lands on the first `/mcp` request instead of at boot.
 */
export function createAdapterWarnOnce(
  log: AdapterWarnLog,
  consume: () => VerdictSource | undefined,
): () => void {
  let warned = false;
  return () => {
    if (warned) return;
    warned = true;
    const verdict = adapterVerdictOf(consume());
    if (verdict.kind === "ok") return;
    log.warn(`mcp-server: ${verdict.message ?? `pi-mcp-adapter verdict: ${verdict.kind}`}`);
  };
}
