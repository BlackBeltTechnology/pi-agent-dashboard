/**
 * RealInvoiceEngine — binds the invoice-bot engine facade imported over the
 * interim `file:` link (`@blackbelt-technology/invoicebot/engine`). The facade
 * already wraps each op in `ibContext.run({ cwd })` (request-scoped state dir)
 * and shares the exact selector logic with the in-session `ib_*` tools, so this
 * adapter is a thin pass-through — the port stays drop-in for the pi tools.
 *
 * ⚠️ TODO(release): the facade resolves only where the sibling repo is present
 * (local dev). In CI / `release-cut` / a git worktree the optionalDependency is
 * absent, so `loadRealEngine()` returns `null` and the plugin binds
 * `FakeInvoiceEngine` (see select.ts). Retire the `file:` link before release
 * (publish or vendor) — this adapter is unchanged by that swap.
 * See change: add-invoicebot-rest-plugin (Decision 0b).
 */
import type {
  EngineLeasedHandle,
  EngineResult,
  EngineWorkSource,
  IngestFile,
  IngestResult,
  InvoiceEngine,
} from "./port.js";

/** The supported facade surface (`@blackbelt-technology/invoicebot/engine`). */
interface InvoiceFacade {
  query(cwd: string, args: { view: string; [k: string]: unknown }): Promise<EngineResult>;
  review(cwd: string, args: { action: string; [k: string]: unknown }): Promise<EngineResult>;
  setup(cwd: string, args: { action: string; [k: string]: unknown }): Promise<EngineResult>;
  rules(cwd: string, args: { action: string; [k: string]: unknown }): Promise<EngineResult>;
  ingest(cwd: string, files: IngestFile[]): Promise<IngestResult>;
  ensureIntakeAutomation(cwd: string): Promise<{ automation: string[] }>;
  /** Present from the engine's work-source adoption onward. */
  queuedWorkSource?(cwd: string): {
    next(n: number): EngineLeasedHandle[];
    ack(leaseToken: string): void;
    nack(leaseToken: string): void;
  };
  /** Targeted lease of ONE queued invoice (fenced in the engine's store). */
  takeQueued?(cwd: string, invoiceId: string): EngineLeasedHandle | null;
  /** One-way, idempotent upgrade of a DEPLOYED intake automation. */
  migrateIntakeAutomation?(cwd: string): Promise<{ migrated: string[]; skipped: string[] }>;
}

export class RealInvoiceEngine implements InvoiceEngine {
  constructor(private readonly facade: InvoiceFacade) {}
  query(cwd: string, args: { view: string; [k: string]: unknown }): Promise<EngineResult> {
    return this.facade.query(cwd, args);
  }
  review(cwd: string, args: { action: string; [k: string]: unknown }): Promise<EngineResult> {
    return this.facade.review(cwd, args);
  }
  setup(cwd: string, args: { action: string; [k: string]: unknown }): Promise<EngineResult> {
    return this.facade.setup(cwd, args);
  }
  rules(cwd: string, args: { action: string; [k: string]: unknown }): Promise<EngineResult> {
    return this.facade.rules(cwd, args);
  }
  ingest(cwd: string, files: IngestFile[]): Promise<IngestResult> {
    return this.facade.ingest(cwd, files);
  }
  ensureAutomation(cwd: string): Promise<{ automation: string[] }> {
    return this.facade.ensureIntakeAutomation(cwd);
  }

  /**
   * The engine's own fenced source, bound to `cwd`. `take` is exposed ONLY when
   * the facade can lease one named invoice — a targeted run then reports
   * `unsupported` rather than being emulated by leasing-and-releasing others,
   * which would make a single-flight guarantee depend on timing.
   *
   * An OLDER engine checkout (no `queuedWorkSource`) yields a source that vends
   * nothing: fan-out then spawns nothing, visibly and safely, instead of the
   * host inventing leases the engine does not know about.
   */
  queuedWorkSource(cwd: string): EngineWorkSource {
    const inner = this.facade.queuedWorkSource?.(cwd);
    const takeQueued = this.facade.takeQueued;
    if (!inner) {
      return { next: () => [], ack: () => {}, nack: () => {} };
    }
    return {
      next: (n) => inner.next(n),
      ack: (t) => inner.ack(t),
      nack: (t) => inner.nack(t),
      ...(takeQueued
        ? { take: (invoiceId: string) => takeQueued.call(this.facade, cwd, invoiceId) }
        : {}),
    };
  }

  migrateIntakeAutomation(cwd: string): Promise<{ migrated: string[]; skipped: string[] }> {
    return (
      this.facade.migrateIntakeAutomation?.(cwd) ??
      Promise.resolve({ migrated: [], skipped: ["engine has no migrator"] })
    );
  }
}

/**
 * Resolve the invoice-bot facade over the `file:` link, or `null` when absent.
 * The import is dynamic + guarded so a missing optionalDependency (CI / worktree
 * / release) degrades to the Fake instead of crashing plugin load.
 */
export async function loadRealEngine(): Promise<RealInvoiceEngine | null> {
  try {
    // Indirected specifier so the bundler/test resolver does not hard-fail on a
    // (legitimately) absent optional dependency at analysis time.
    const spec = "@blackbelt-technology/invoicebot/engine";
    const facade = (await import(/* @vite-ignore */ spec)) as unknown as InvoiceFacade;
    if (typeof facade?.query !== "function") return null;
    return new RealInvoiceEngine(facade);
  } catch {
    return null;
  }
}
