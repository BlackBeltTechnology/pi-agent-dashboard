// Failure variant: `createSlotRegistry` is NOT on the public host surface (it is a shell internal), so the host
// shim has no such export and the browser rejects this module at link time (SyntaxError on import).
import { createSlotRegistry } from "@blackbelt-technology/dashboard-plugin-runtime";

export const registry = createSlotRegistry();
export function VariantPanel() {
  return <div data-testid="variant-missing-export">unreachable: module fails to link</div>;
}
