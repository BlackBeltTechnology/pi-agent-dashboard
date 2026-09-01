/**
 * FakeInvoiceEngine — fixture binding for CI / `release-cut` / git worktrees,
 * where the invoice-bot `file:` sibling is absent. Returns the SAME
 * `{ content, details }` shapes the real `ib_*` tools return (pinned to the
 * engine source + api-contract.md §6–§9), and sets `flow` for the five
 * flow-triggering ops so the routes exercise the real dispatch seam even under
 * the Fake. Static fixtures — `cwd` is accepted and ignored (isolation is a Real
 * concern; route-level cwd-forwarding is covered by a recording stub in tests).
 *
 * See change: add-invoicebot-rest-plugin (Decision 0, risk "Fake drift").
 */
import { createHash } from "node:crypto";
import { createInMemoryQueuedInvoiceSource } from "../queued-invoice-work-source.js";
import type { EngineResult, EngineWorkSource, FlowRunSpec, IngestFile, IngestResult, InvoiceEngine } from "./port.js";

/** Shared per-file cap (bytes) — the boundary and the engine enforce the same 20 MB. */
const INGEST_MAX_BYTES = 20 * 1024 * 1024;
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const INV_A = "a1b2c3d4"; // pending_approval
const INV_B = "e5f6a7b8"; // partner_pending

function ok(text: string, details: Record<string, unknown>): EngineResult {
  return { content: [{ type: "text", text }], details };
}
function withFlow(res: EngineResult, flow: FlowRunSpec): EngineResult {
  return { ...res, flow };
}

const SURFACE_A = {
  invoice_id: INV_A,
  reference: "AP-2024-0007",
  state: "pending_approval",
  awaiting: true,
  summary: {
    supplier: "Acme Kft.",
    invoiceNumber: "INV-2024-001",
    issueDate: "2024-05-01",
    dueDate: "2024-05-15",
    currency: "HUF",
    net: 15000,
    vat: 4050,
    gross: 19050,
    lineCount: 3,
  },
  original: { blob_handle: `blobs/${INV_A}_invoice.pdf`, path: undefined, available: false },
  actions: ["approve", "reject"] as const,
  decisions: [],
};

// Zero-VAT surface fixture (returned for INV_B) — covers the client's vat: 0 branch.
const SURFACE_B = {
  invoice_id: INV_B,
  reference: "AP-2024-0008",
  state: "partner_pending",
  awaiting: true,
  summary: {
    supplier: "New Vendor Zrt.",
    invoiceNumber: "INV-2024-002",
    issueDate: "2024-05-02",
    dueDate: "2024-05-16",
    currency: "HUF",
    net: 42000,
    vat: 0,
    gross: 42000,
    lineCount: 1,
  },
  original: { blob_handle: `blobs/${INV_B}_invoice.pdf`, path: undefined, available: false },
  actions: ["approve", "reject"] as const,
  decisions: [],
};

// ROW_A carries per-invoice processing cost; ROW_B omits it (not-recorded case).
const ROW_A = { id: INV_A, state: "pending_approval", supplier: "Acme Kft.", partner: "acme", gross: 19050, settlement: null, cost: { total: 0.42, currency: "USD" } };
const ROW_B = { id: INV_B, state: "partner_pending", supplier: "New Vendor Zrt.", partner: "new-vendor", gross: 42000, settlement: null };

export class FakeInvoiceEngine implements InvoiceEngine {
  async query(_cwd: string, args: { view: string; [k: string]: unknown }): Promise<EngineResult> {
    switch (args.view) {
      case "pending":
        return ok("2 pending", {
          items: [
            { id: INV_A, state: "pending_approval", reason: "awaiting approver", partner: "acme", gross: 19050, reference: "AP-2024-0007" },
            { id: INV_B, state: "partner_pending", reason: "unknown supplier", partner: "new-vendor", gross: 42000, reference: undefined },
          ],
        });
      case "list": {
        const state = args.state as string | undefined;
        if (state && state !== "all") {
          const items = [ROW_A, ROW_B].filter((r) => r.state === state);
          return ok(`${items.length} invoice(s) in state "${state}"`, { state, items });
        }
        if (state === "all") return ok("2 invoice(s)", { items: [ROW_A, ROW_B] });
        return ok("2 invoice(s) — pending_approval: 1, partner_pending: 1", {
          total: 2,
          groups: {
            pending_approval: { count: 1, items: [ROW_A] },
            partner_pending: { count: 1, items: [ROW_B] },
          },
        });
      }
      case "search": {
        const q = String(args.query ?? "");
        if (!q) return { content: [{ type: "text", text: "⛔ missing required: query" }], details: { ok: false } };
        const ids = [INV_A, INV_B].filter((id) => id.includes(q) || q.includes("INV-2024-001"));
        return ok(`${ids.length} hit(s)`, { ids });
      }
      case "surface":
      case "approval": {
        if (!args.invoice_id) return { content: [{ type: "text", text: "⛔ missing required: invoice_id" }], details: { ok: false } };
        if (args.invoice_id === INV_B) return ok(`approval surface ${SURFACE_B.reference} (awaiting)`, { ...SURFACE_B, invoice_id: args.invoice_id });
        return ok(`approval surface ${SURFACE_A.reference} (awaiting)`, { ...SURFACE_A, invoice_id: args.invoice_id });
      }
      case "explain": {
        if (!args.invoice_id) return { content: [{ type: "text", text: "⛔ missing required: invoice_id" }], details: { ok: false } };
        return ok("Emberi jóváhagyásra vár.", { found: true, text: "Emberi jóváhagyásra vár.", outcome: "needs_human" });
      }
      case "status":
        return ok("ready (2 awaiting a human)", {
          intake_ready: true,
          handoff_configured: true,
          setup_complete: true,
          missing: [],
          pending: 2,
          intake_paused: false,
          cadence: { process: "*/2 * * * *", pull: "*/5 * * * *" },
        });
      case "finance":
        return ok("settled 0 / outstanding 61050", {
          settled: [],
          outstanding: [ROW_A, ROW_B],
          totals: { settled: 0, outstanding: 61050 },
        });
      case "rules":
        return ok("1 active rule(s)", {
          effective: [{ id: "r1", seq: 10, description: "known<20k", status: "active" }],
          all: [{ id: "r1", seq: 10, description: "known<20k", status: "active" }],
        });
      case "diagram":
        return ok("ruleset diagram", { mermaid: "flowchart TD\n  A[received] --> B{known & <20k?}\n  B -->|yes| C[auto_approve]\n  B -->|no| D[human]" });
      default:
        return { content: [{ type: "text", text: `⛔ unknown view: "${args.view}"` }], details: { ok: false } };
    }
  }

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: fixture mirrors the ib_review selector switch 1:1 (a faithful shape mirror is the point).
  async review(_cwd: string, args: { action: string; [k: string]: unknown }): Promise<EngineResult> {
    switch (args.action) {
      case "approve": {
        if (!args.invoice_id) return this.miss("invoice_id");
        const res = ok(`approved by ${(args.approved_by as string) || "human"} + resumed`, { chain: { status: "approved" }, decisions: [{ actor: (args.approved_by as string) || "human", at: new Date().toISOString(), outcome: "approved" }] });
        return withFlow(res, { flowName: "invoicebot:process", task: `source://${args.invoice_id}` });
      }
      case "reject": {
        if (!args.invoice_id) return this.miss("invoice_id");
        return ok(`rejected — held for review`, { chain: { status: "rejected" }, decisions: [{ actor: (args.approved_by as string) || "human", at: new Date().toISOString(), outcome: "rejected" }] });
      }
      case "repair": {
        if (!args.invoice_id || !args.patch) return this.miss("invoice_id, patch");
        const res = ok(`repair recorded for ${args.invoice_id}`, { invoice_id: args.invoice_id, patch: args.patch });
        return withFlow(res, { flowName: "invoicebot:process", inputs: { invoice_id: String(args.invoice_id) } });
      }
      case "partner": {
        switch (args.op) {
          case "confirm": {
            if (!args.invoice_id) return this.miss("invoice_id");
            const res = ok("partner confirmed; processing resumed", { partner_id: "new-vendor" });
            return withFlow(res, { flowName: "invoicebot:process", task: `source://${args.invoice_id}` });
          }
          case "block":
            if (!args.partner_id || !args.by) return this.miss("partner_id, by");
            return ok(`🚫 partner ${args.partner_id} blocked.`, { partner: { partner_id: args.partner_id, blocked: true } });
          case "role":
            if (!args.partner_id || !args.role) return this.miss("partner_id, role");
            return ok("role updated", { partner: { partner_id: args.partner_id, role: args.role } });
          default:
            return { content: [{ type: "text", text: "⛔ partner needs op: confirm | block | role" }], details: { ok: false } };
        }
      }
      case "note":
        if (!args.target_kind || !args.target_id || !args.author || !args.text) return this.miss("target_kind, target_id, author, text");
        return ok("note added", { note: { kind: args.target_kind, id: args.target_id, author: args.author, text: args.text, at: new Date().toISOString() } });
      case "cash":
        if (!args.invoice_id || args.amount === undefined) return this.miss("invoice_id, amount");
        return ok("cash payment recorded", { invoice_id: args.invoice_id, amount: args.amount });
      case "reconcile":
        if (!args.invoice_id || !args.transaction_id || args.amount === undefined) return this.miss("invoice_id, transaction_id, amount");
        return ok("match confirmed", { settlement: { status: "settled" } });
      case "assign":
        if (!args.invoice_id || !args.colleague) return this.miss("invoice_id, colleague");
        return ok(`assigned to ${args.colleague}`, {});
      case "submit": {
        const task = (args.ref as string) || (args.invoice_id ? `source://${args.invoice_id}` : "");
        if (!task) return { content: [{ type: "text", text: "⛔ submit needs ref or invoice_id" }], details: { ok: false } };
        return withFlow(ok(`processing started for ${task}`, { task }), { flowName: "invoicebot:process", task });
      }
      case "handoff": {
        if (!args.target_id) return this.miss("target_id");
        const status = args.confirm ? "sent" : "prepared";
        return ok(`${status}: 1 invoice(s)${status === "prepared" ? " — confirm to deliver" : ""}`, { status, count: 1 });
      }
      default:
        return { content: [{ type: "text", text: `⛔ unknown action: "${args.action}"` }], details: { ok: false } };
    }
  }

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: fixture mirrors the ib_setup selector switch 1:1 (a faithful shape mirror is the point).
  async setup(_cwd: string, args: { action: string; [k: string]: unknown }): Promise<EngineResult> {
    switch (args.action) {
      case "connector": {
        if (!args.id || !args.kind) return this.miss("id, kind");
        return ok(`connector ${args.id} saved`, { connector: { id: args.id, kind: args.kind, direction: "inbound", enabled: true, status: "active", config: (args.config as object) ?? {} }, automation: [] });
      }
      case "authorize":
        if (!args.id || !args.refresh_token) return this.miss("id, refresh_token");
        return ok(`connector ${args.id} authorized`, { connector: { id: args.id, status: "active" } });
      case "cadence":
        if (!args.which || !args.cron) return this.miss("which, cron");
        return ok(`cadence updated (${args.which}): ${args.cron}`, { which: args.which, cron: args.cron });
      case "handoff_target":
        if (!args.id || !args.format || !args.destination) return this.miss("id, format, destination");
        return ok(`target ${args.id} saved`, { target: { id: args.id, format: args.format, destination: args.destination } });
      case "config":
        if (!args.name) return this.miss("name");
        return ok(`applied ${args.name}`, { applied: true, diff: {} });
      case "intake": {
        switch (args.op) {
          case "pause":
            return ok("intake paused", { intake_paused: true });
          case "resume":
            return ok("intake resumed", { intake_paused: false });
          case "poll":
            return ok("polled: 0 dropped, 0 duplicate(s), 0 error(s)", { found: 0, landed: 0, skipped: 0, errors: 0 });
          default:
            return { content: [{ type: "text", text: "⛔ intake needs op: pause | resume | poll" }], details: { ok: false } };
        }
      }
      default:
        return { content: [{ type: "text", text: `⛔ unknown action: "${args.action}"` }], details: { ok: false } };
    }
  }

  async rules(_cwd: string, args: { action: string; [k: string]: unknown }): Promise<EngineResult> {
    switch (args.action) {
      case "request": {
        if (!args.description || !args.id || args.seq === undefined) return this.miss("description, id, seq");
        const task = JSON.stringify({ description: args.description, id: args.id, seq: args.seq, consent: !!args.consent });
        return withFlow(ok(`▶ invoicebot:add-rule started for "${args.id}".`, { flowName: "invoicebot:add-rule", task }), { flowName: "invoicebot:add-rule", task });
      }
      case "approve":
        if (!args.id) return this.miss("id");
        return ok(`✅ approved ${args.id} — now live.`, { approved: true });
      case "reject":
        if (!args.id) return this.miss("id");
        return ok(`✖ rejected ${args.id} — nothing changed.`, { rejected: true });
      case "move":
        if (!args.id || args.seq === undefined) return this.miss("id, seq");
        return ok(`moved ${args.id} → seq ${args.seq}`, {});
      case "archive":
        if (!args.id) return this.miss("id");
        return ok(`archived ${args.id}`, {});
      default:
        return { content: [{ type: "text", text: `⛔ unknown action: "${args.action}"` }], details: { ok: false } };
    }
  }

  // Deterministic ingest simulation: magic-byte type gate + size cap + content-
  // hash dedup (seen-set scoped to this instance). `cwd` accepted and ignored.
  private readonly seen = new Set<string>();
  /** cwd → its in-memory queued-invoice source (leases must be stable per cwd). */
  private readonly queuedSources = new Map<string, EngineWorkSource>();
  async ingest(_cwd: string, files: IngestFile[]): Promise<IngestResult> {
    const results = files.map((f) => this.classify(f));
    return {
      results,
      landed: results.filter((o) => o.status === "landed").length,
      skipped: results.filter((o) => o.status === "skipped").length,
      rejected: results.filter((o) => o.status === "rejected").length,
    };
  }

  // No-op: the Fake owns no filesystem. Keeps the faux gate + engine-less
  // CI/worktree green while the routes exercise the ensure seam.
  async ensureAutomation(_cwd: string): Promise<{ automation: string[] }> {
    return { automation: [] };
  }

  /**
   * An IN-MEMORY stand-in for the engine's fenced lease store, one per cwd.
   *
   * The Fake binds wherever the `file:` sibling is absent (CI, worktrees,
   * release-cut), so without this fan-out would silently vend nothing under the
   * Fake — and an E2E run would then look like a pass while processing zero
   * invoices. Queued ids come from this binding's own `list` view, so the
   * fixtures drive it. Leases are process-local: NOT cross-process fenced and
   * NOT restart-durable, unlike the real engine's SQLite claims.
   * See change: relocate-fanout-to-work-source.
   */
  queuedWorkSource(cwd: string): EngineWorkSource {
    const hit = this.queuedSources.get(cwd);
    if (hit) return hit;
    const src = createInMemoryQueuedInvoiceSource({
      listQueued: async () => {
        const res = await this.query(cwd, { view: "list", state: "queued" });
        const items = (res.details as { items?: Array<{ id?: unknown }> }).items;
        if (!Array.isArray(items)) return [];
        return items.map((i) => i.id).filter((id): id is string => typeof id === "string" && id.length > 0);
      },
    });
    this.queuedSources.set(cwd, src);
    return src;
  }

  /**
   * The Fake stands in for the engine, so it performs the engine's job: rewrite
   * a DEPLOYED intake automation to the SAME target shape the engine emits (the
   * host-side implementation in `automation-migrate.ts`). Without this, a
   * Fake-bound deployment would keep a legacy automation forever and its drain
   * would arm without fanning out.
   */
  async migrateIntakeAutomation(cwd: string): Promise<{ migrated: string[]; skipped: string[] }> {
    const { migrateIntakeAutomation } = await import("../automation-migrate.js");
    const res = migrateIntakeAutomation(cwd);
    return res.migrated ? { migrated: [res.path], skipped: [] } : { migrated: [], skipped: [`${res.path} (${res.reason})`] };
  }

  private classify(file: IngestFile): { filename: string; hash: string; status: "landed" | "skipped" | "rejected"; reason?: string } {
    const hash = createHash("sha256").update(file.bytes).digest("hex").slice(0, 16);
    const base = { filename: file.filename, hash };
    if (file.bytes.length > INGEST_MAX_BYTES) return { ...base, status: "rejected", reason: "too large" };
    const isPdf = file.bytes.subarray(0, 5).toString("latin1") === "%PDF-";
    const isPng = file.bytes.subarray(0, 8).equals(PNG_MAGIC);
    if (!isPdf && !isPng) return { ...base, status: "rejected", reason: "unsupported type" };
    if (this.seen.has(hash)) return { ...base, status: "skipped", reason: "duplicate" };
    this.seen.add(hash);
    return { ...base, status: "landed" };
  }

  private miss(keys: string): EngineResult {
    return { content: [{ type: "text", text: `⛔ missing required: ${keys}` }], details: { ok: false } };
  }
}
