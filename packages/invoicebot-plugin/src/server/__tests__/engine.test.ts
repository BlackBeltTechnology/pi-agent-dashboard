/**
 * FakeInvoiceEngine returns the documented `details` shapes for every selector
 * (api-contract §6–§9), and sets `flow` for exactly the five flow-triggering
 * ops. Routes import only the port, so these shapes are the client contract.
 * See change: add-invoicebot-rest-plugin (§3.5).
 */
import { describe, expect, it } from "vitest";
import { FakeInvoiceEngine } from "../engine/fake.js";
import type { InvoiceEngine } from "../engine/port.js";

const CWD = "/work/acme";
const engine: InvoiceEngine = new FakeInvoiceEngine();

describe("FakeInvoiceEngine — query views", () => {
  it("pending → { items: PendingItem[] }", async () => {
    const r = await engine.query(CWD, { view: "pending" });
    expect(Array.isArray((r.details as any).items)).toBe(true);
    expect((r.details as any).items[0]).toHaveProperty("id");
    expect(r.flow).toBeUndefined();
  });

  it("list (grouped) → { total, groups }", async () => {
    const r = await engine.query(CWD, { view: "list" });
    expect(r.details).toHaveProperty("total");
    expect(r.details).toHaveProperty("groups");
  });

  it("list (state filter) → { state, items }", async () => {
    const r = await engine.query(CWD, { view: "list", state: "pending_approval" });
    expect((r.details as any).state).toBe("pending_approval");
    expect((r.details as any).items.every((i: any) => i.state === "pending_approval")).toBe(true);
  });

  it("list (all) → flat { items }", async () => {
    const r = await engine.query(CWD, { view: "list", state: "all" });
    expect(Array.isArray((r.details as any).items)).toBe(true);
    expect(r.details).not.toHaveProperty("groups");
  });

  it("search → { ids }", async () => {
    const r = await engine.query(CWD, { view: "search", query: "INV-2024-001" });
    expect(Array.isArray((r.details as any).ids)).toBe(true);
  });

  it("search without query → ok:false", async () => {
    const r = await engine.query(CWD, { view: "search" });
    expect(r.details.ok).toBe(false);
  });

  it("surface → ApprovalSurface (invoice_id echoed)", async () => {
    const r = await engine.query(CWD, { view: "surface", invoice_id: "z9" });
    expect((r.details as any).invoice_id).toBe("z9");
    expect((r.details as any).summary).toHaveProperty("invoiceNumber");
    expect((r.details as any).actions).toEqual(["approve", "reject"]);
  });

  it("surface summary exposes net and vat", async () => {
    const r = await engine.query(CWD, { view: "surface", invoice_id: "a1b2c3d4" });
    expect((r.details as any).summary).toMatchObject({ net: 15000, vat: 4050 });
  });

  it("surface summary carries a zero-VAT case", async () => {
    const r = await engine.query(CWD, { view: "surface", invoice_id: "e5f6a7b8" });
    expect((r.details as any).summary.vat).toBe(0);
    expect((r.details as any).summary.net).toBe(42000);
  });

  it("list exposes cost on the fixtured row and omits it on the other", async () => {
    const grouped = await engine.query(CWD, { view: "list" });
    const withCost = (grouped.details as any).groups.pending_approval.items[0];
    const noCost = (grouped.details as any).groups.partner_pending.items[0];
    expect(withCost.cost).toEqual({ total: 0.42, currency: "USD" });
    expect(noCost).not.toHaveProperty("cost");

    const flat = await engine.query(CWD, { view: "list", state: "all" });
    const items = (flat.details as any).items;
    expect(items[0].cost).toEqual({ total: 0.42, currency: "USD" });
    expect(items[1]).not.toHaveProperty("cost");
  });

  it("status → SetupStatus w/ cadence", async () => {
    const r = await engine.query(CWD, { view: "status" });
    expect(r.details).toHaveProperty("setup_complete");
    expect((r.details as any).cadence).toHaveProperty("process");
  });

  it("finance → { settled, outstanding, totals }", async () => {
    const r = await engine.query(CWD, { view: "finance" });
    expect((r.details as any).totals).toHaveProperty("outstanding");
  });

  it("rules → { effective, all }", async () => {
    const r = await engine.query(CWD, { view: "rules" });
    expect(Array.isArray((r.details as any).effective)).toBe(true);
  });

  it("diagram → { mermaid }", async () => {
    const r = await engine.query(CWD, { view: "diagram" });
    expect(typeof (r.details as any).mermaid).toBe("string");
  });

  it("unknown view → ok:false", async () => {
    const r = await engine.query(CWD, { view: "nope" });
    expect(r.details.ok).toBe(false);
  });
});

describe("FakeInvoiceEngine — flow-triggering vs pure ops", () => {
  it("approve carries flow invoicebot:process (task)", async () => {
    const r = await engine.review(CWD, { action: "approve", invoice_id: "a1b2" });
    expect(r.flow).toEqual({ flowName: "invoicebot:process", task: "source://a1b2" });
  });

  it("repair carries flow invoicebot:process (inputs)", async () => {
    const r = await engine.review(CWD, { action: "repair", invoice_id: "a1b2", patch: { currency: "HUF" } });
    expect(r.flow).toEqual({ flowName: "invoicebot:process", inputs: { invoice_id: "a1b2" } });
  });

  it("partner confirm carries flow", async () => {
    const r = await engine.review(CWD, { action: "partner", op: "confirm", invoice_id: "a1b2" });
    expect(r.flow?.flowName).toBe("invoicebot:process");
  });

  it("submit carries flow", async () => {
    const r = await engine.review(CWD, { action: "submit", ref: "/tmp/x.pdf" });
    expect(r.flow).toEqual({ flowName: "invoicebot:process", task: "/tmp/x.pdf" });
  });

  it("rules request carries flow invoicebot:add-rule", async () => {
    const r = await engine.rules(CWD, { action: "request", id: "r2", seq: 20, description: "x" });
    expect(r.flow?.flowName).toBe("invoicebot:add-rule");
  });

  it("note is pure (no flow)", async () => {
    const r = await engine.review(CWD, { action: "note", target_kind: "invoice", target_id: "x", author: "a", text: "t" });
    expect(r.flow).toBeUndefined();
    expect((r.details as any).note).toBeTruthy();
  });

  it("handoff prepare vs deliver (no flow)", async () => {
    const prep = await engine.review(CWD, { action: "handoff", target_id: "book1" });
    expect((prep.details as any).status).toBe("prepared");
    const sent = await engine.review(CWD, { action: "handoff", target_id: "book1", confirm: true });
    expect((sent.details as any).status).toBe("sent");
    expect(sent.flow).toBeUndefined();
  });

  it("setup connector is pure", async () => {
    const r = await engine.setup(CWD, { action: "connector", id: "drop", kind: "folder", config: { path: "/x" } });
    expect(r.flow).toBeUndefined();
    expect((r.details as any).connector.id).toBe("drop");
  });

  it("rules approve/reject/move/archive are pure", async () => {
    for (const a of [
      { action: "approve", id: "r2" },
      { action: "reject", id: "r2" },
      { action: "move", id: "r2", seq: 5 },
      { action: "archive", id: "r2" },
    ]) {
      const r = await engine.rules(CWD, a);
      expect(r.flow).toBeUndefined();
    }
  });
});

describe("FakeInvoiceEngine — ingest", () => {
  const PDF = Buffer.from("%PDF-1.4\nhello", "utf8");
  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
  const TXT = Buffer.from("just some text, not an invoice", "utf8");

  it("classifies by magic bytes: PDF + PNG land, unsupported rejected", async () => {
    const fake = new FakeInvoiceEngine();
    const r = await fake.ingest(CWD, [
      { filename: "a.pdf", bytes: PDF },
      { filename: "b.png", bytes: PNG },
      { filename: "c.txt", bytes: TXT },
    ]);
    expect(r.results.map((o) => o.status)).toEqual(["landed", "landed", "rejected"]);
    expect(r.results[2].reason).toMatch(/unsupported/i);
    expect(r.results.map((o) => o.filename)).toEqual(["a.pdf", "b.png", "c.txt"]);
    expect(r.results.every((o) => typeof o.hash === "string")).toBe(true);
    expect(r).toMatchObject({ landed: 2, skipped: 0, rejected: 1 });
  });

  it("repeat bytes are skipped(duplicate) within one instance", async () => {
    const fake = new FakeInvoiceEngine();
    const r = await fake.ingest(CWD, [
      { filename: "first.pdf", bytes: PDF },
      { filename: "again.pdf", bytes: PDF },
    ]);
    expect(r.results[0].status).toBe("landed");
    expect(r.results[1].status).toBe("skipped");
    expect(r.results[1].reason).toMatch(/duplicate/i);
    expect(r.results[0].hash).toBe(r.results[1].hash);
    expect(r).toMatchObject({ landed: 1, skipped: 1, rejected: 0 });
  });

  it("oversize bytes are rejected(too large)", async () => {
    const fake = new FakeInvoiceEngine();
    const huge = Buffer.concat([Buffer.from("%PDF-"), Buffer.alloc(20 * 1024 * 1024 + 1)]);
    const r = await fake.ingest(CWD, [{ filename: "big.pdf", bytes: huge }]);
    expect(r.results[0].status).toBe("rejected");
    expect(r.results[0].reason).toMatch(/too large/i);
    expect(r).toMatchObject({ landed: 0, skipped: 0, rejected: 1 });
  });
});
