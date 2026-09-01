/**
 * InvoiceEngine port — the ONLY surface the routes depend on.
 *
 * The four methods mirror the four `ib_*` selectors. Each takes the request
 * `cwd` (the workspace key — the engine resolves it to a state dir behind this
 * port) plus the tool args (`view` for query; `action` for review/setup/rules).
 * The return is the raw tool result (`content` + `details`, verified against the
 * invoice-bot engine source), OPTIONALLY carrying a captured `flow` spec for the
 * five flow-triggering ops — the port does the DB side effect and hands the flow
 * to the plugin to dispatch (there is no in-process session bus).
 *
 * Two bindings implement it: `RealInvoiceEngine` (facade over the invoice-bot
 * `file:` link) and `FakeInvoiceEngine` (fixtures for CI / worktrees). Swapping
 * the binding (fake↔real, or file-link→published/vendored) requires NO route
 * change. See change: add-invoicebot-rest-plugin (Decision 0).
 */

/** A pi-flows flow to run (the five flow-triggering ops emit this in-session). */
export interface FlowRunSpec {
  flowName: string;
  task?: string;
  inputs?: Record<string, unknown>;
}

/** The raw `ib_*` tool result, plus any captured flow the plugin must dispatch. */
export interface EngineResult {
  content: { type: "text"; text: string }[];
  details: Record<string, unknown> & { ok?: boolean };
  /** Present only for the five flow-triggering ops (see routes.ts). */
  flow?: FlowRunSpec;
}

/**
 * One leased queued invoice, handed to exactly one spawned child.
 *
 * Mirrors the engine's `LeasedHandle` (and the automation plugin's generic one)
 * structurally. `idempotencyKey` is the INVOICE's own identity, never the lease
 * token, so a redelivery after a lease expiry is recognisably the same work.
 * See change: relocate-fanout-to-work-source.
 */
export interface EngineLeasedHandle {
  item: string;
  leaseToken: string;
  idempotencyKey: string;
}

/**
 * The engine's fenced queued-invoice work source for ONE workspace.
 *
 * The ENGINE owns the leases (an `invoice_leases` table claimed under
 * `BEGIN IMMEDIATE` with a UNIQUE invoice id), so the host never becomes a
 * second lease authority: claims are cross-process safe and survive a restart,
 * and an expired lease is reclaimed by the engine rather than by us.
 *
 * `next`/`take` may resolve synchronously or asynchronously (the real engine is
 * synchronous SQLite; a fixture binding is not necessarily). `take` is OPTIONAL:
 * a binding whose engine cannot lease ONE named invoice omits it, and a targeted
 * run then reports `unsupported` instead of falling back to something racy.
 * See change: relocate-fanout-to-work-source.
 */
export interface EngineWorkSource {
  /** Lease up to `n` DISTINCT available queued invoices. */
  next(n: number): EngineLeasedHandle[] | Promise<EngineLeasedHandle[]>;
  /** Lease the ONE named invoice, or null when it is already leased / gone. */
  take?(invoiceId: string): EngineLeasedHandle | null | Promise<EngineLeasedHandle | null>;
  /** Drop the invoice permanently — fenced on the token being current. */
  ack(leaseToken: string): void;
  /** Return the invoice to the pool — fenced likewise. */
  nack(leaseToken: string): void;
}

/** One uploaded file forwarded to `ingest` — raw bytes keyed by client filename. */
export interface IngestFile {
  filename: string;
  bytes: Buffer;
}

/** Per-file ingest outcome: type/size/dedup verdict for one uploaded file. */
export interface IngestOutcome {
  filename: string;
  hash: string;
  status: "landed" | "skipped" | "rejected";
  reason?: string;
}

/** Aggregate ingest result: per-file outcomes plus summary counts. */
export interface IngestResult {
  results: IngestOutcome[];
  landed: number;
  skipped: number;
  rejected: number;
}

export interface InvoiceEngine {
  /** `ib_query` — read-only views. Never mutates, never a flow. */
  query(cwd: string, args: { view: string; [k: string]: unknown }): Promise<EngineResult>;
  /** `ib_review` — operational writes; approve/repair/submit/partner-confirm carry `flow`. */
  review(cwd: string, args: { action: string; [k: string]: unknown }): Promise<EngineResult>;
  /** `ib_setup` — editor config. Pure (no flow). */
  setup(cwd: string, args: { action: string; [k: string]: unknown }): Promise<EngineResult>;
  /** `ib_rules` — rule authoring; `request` carries `flow` (add-rule), rest pure. */
  rules(cwd: string, args: { action: string; [k: string]: unknown }): Promise<EngineResult>;
  /**
   * Ingest raw invoice bytes into the drop folder keyed by `cwd`. First-class
   * (not a selector): binary does not fit the `{ selector, ...args }` envelope.
   * Returns a per-file outcome + aggregate counts; dispatches no flow.
   */
  ingest(cwd: string, files: IngestFile[]): Promise<IngestResult>;
  /**
   * Ensure the disabled `invoicebot-intake` drain automation exists for `cwd`.
   * Idempotent + non-fatal; writes no flow, emits no events. Returns the
   * absolute paths written (or the `"<name> (exists)"` marker). Called on first
   * touch of a workspace so an upload-only workspace has a drain to enable.
   * See change: ensure-intake-automation.
   */
  ensureAutomation(cwd: string): Promise<{ automation: string[] }>;
  /**
   * The workspace's fenced queued-invoice work source (see
   * {@link EngineWorkSource}). Registered host-side under the id the engine's
   * emitted automation names in `on.source`, so a `schedule.batch` fire leases
   * DISTINCT queued invoices BEFORE spawning and hands each child its own.
   *
   * OPTIONAL on the port: unlike the four selector methods, this is not a route
   * surface, so a narrow test double may omit it. Both shipped bindings (Real
   * and Fake) implement it; when it is absent, fan-out vends nothing rather than
   * the host inventing leases.
   * See change: relocate-fanout-to-work-source.
   */
  queuedWorkSource?(cwd: string): EngineWorkSource;
  /**
   * Upgrade this workspace's DEPLOYED intake automation to the work-source
   * contract. One-way and idempotent; an already-migrated, unrecognised or
   * absent file is left byte-for-byte untouched. The ENGINE owns the emitted
   * YAML shape, so it owns this rewrite — the host only owns WHEN it runs (the
   * engine never reads a deployed automation at fire time; the host does).
   * OPTIONAL on the port for the same reason as `queuedWorkSource`.
   * See change: relocate-fanout-to-work-source (D-YAML).
   */
  migrateIntakeAutomation?(cwd: string): Promise<{ migrated: string[]; skipped: string[] }>;
}

/** A tag every binding sets so plugin load can log which engine is active. */
export interface BoundEngine {
  engine: InvoiceEngine;
  binding: "real" | "fake";
}
