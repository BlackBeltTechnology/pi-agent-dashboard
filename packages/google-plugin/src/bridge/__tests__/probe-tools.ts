/**
 * Synthetic per-product tools (`probe_<product>_read` GET /ping, `probe_<product>_write` POST /touch) so the
 * shared runtime can be exercised for EVERY product without that product's real tools. See change: add-google-connect.
 */
import type { Product } from "../../shared/products.js";
import { clip } from "../preview.js";
import type { ProductTools } from "../runtime.js";

/** The seven product tool families (Gmail keeps its own plugin). */
export const PRODUCTS_7 = ["calendar", "drive", "docs", "sheets", "slides", "tasks", "contacts"] as const satisfies readonly Product[];

const probeTools = (product: Product): ProductTools => ({
  product,
  create: (rt) => [
    rt.define({
      name: `probe_${product}_read`,
      label: "probe read",
      description: "test probe",
      properties: {},
      level: "read",
      parse: () => ({}),
      run: async (_a, call) => ({ json: await call.api.request("GET", "/ping") }),
    }),
    rt.define<{ text: string }>({
      name: `probe_${product}_write`,
      label: "probe write",
      description: "test probe",
      properties: { text: { type: "string" } },
      level: "write",
      write: true,
      parse: (p) => ({ text: typeof p.text === "string" ? p.text : "hello" }),
      summary: (a) => [`Text: ${clip(a.text)}`, "Field: x"],
      run: async (a, call) => ({ json: await call.api.request("POST", "/touch", { body: { text: a.text } }) }),
    }),
  ],
});

export const allProbes = (): ProductTools[] => PRODUCTS_7.map(probeTools);
