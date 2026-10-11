/**
 * Read a bridge-side source file for the source-text guard tests.
 *
 * `initBridge`'s closure state lives on a `BridgeInstance`, so moved code writes
 * `inst.coalescer.flush()` where the old closure code wrote `coalescer.flush()`.
 * Guards pin the closure-variable name, not the access path, so the `inst.`
 * prefix is stripped before they scan. Paths are relative to `packages/extension/src`.
 *
 * See change: test-trust-audit (design D3).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SRC = resolve(import.meta.dirname, "..", "..");

export type BridgeSourceFile =
  | "bridge.ts"
  | "bridge-handlers/lifecycle.ts"
  | "bridge-handlers/dispatch.ts"
  | "bridge-handlers/forwarders.ts"
  | "bridge-handlers/ui-prompt-patch.ts"
  | "bridge-handlers/instance.ts";

/** Source text with the `inst.` access-path prefix removed. */
export function readBridgeSource(file: BridgeSourceFile): string {
  return readFileSync(resolve(SRC, file), "utf8").replace(/\binst\./g, "");
}
