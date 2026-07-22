/**
 * RealInvoiceEngine is a thin pass-through: `query` returns the facade result
 * verbatim, so engine `details` fields (surface `net`/`vat`, row `cost`) reach
 * the client with zero adapter code. This test pins that guarantee against a
 * future reshaping regression. See change: forward-invoice-financials (§2).
 */
import { describe, expect, it } from "vitest";
import { RealInvoiceEngine } from "../engine/real.js";
import type { EngineResult } from "../engine/port.js";

const CWD = "/work/acme";

describe("RealInvoiceEngine — pass-through", () => {
  it("forwards details.summary net/vat and row cost unchanged", async () => {
    const facadeResult: EngineResult = {
      content: [{ type: "text", text: "surface" }],
      details: {
        invoice_id: "a1",
        summary: { currency: "HUF", net: 15000, vat: 4050, gross: 19050 },
        items: [
          { id: "a1", cost: { total: 0.42, currency: "USD" } },
          { id: "b2" },
        ],
      },
    };
    const facade = {
      query: async (_cwd: string, _args: { view: string }) => facadeResult,
      review: async () => facadeResult,
      setup: async () => facadeResult,
      rules: async () => facadeResult,
      ingest: async () => ({ results: [], landed: 0, skipped: 0, rejected: 0 }),
    };
    const engine = new RealInvoiceEngine(facade);

    const r = await engine.query(CWD, { view: "surface", invoice_id: "a1" });

    expect(r).toBe(facadeResult);
    expect((r.details as any).summary).toMatchObject({ net: 15000, vat: 4050 });
    expect((r.details as any).items[0].cost).toEqual({ total: 0.42, currency: "USD" });
    expect((r.details as any).items[1]).not.toHaveProperty("cost");
  });
});
