/**
 * PromptBus — Unified prompt routing infrastructure.
 *
 * Routes prompt requests to registered adapters (TUI, dashboard, custom).
 * Enforces first-response-wins semantics and cross-adapter dismissal.
 * Replaces the ui-proxy race pattern and emitPromptAndAwait event system.
 */

// ── Interfaces ──────────────────────────────────────────────────────

export interface PromptComponent {
  /** Component type identifier — maps to a React component on the client */
  type: string;
  /** Serializable props for the component */
  props: Record<string, unknown>;
}

export interface PromptClaim {
  /** Optional custom dashboard UI component. If omitted, adapter handles externally (e.g. TUI). */
  component?: PromptComponent;
  /** Where to render the component on the dashboard client */
  placement?: "widget-bar" | "inline" | "overlay";
}

export interface PromptRequest {
  id: string;
  pipeline: string;
  type: "select" | "input" | "confirm" | "editor" | "multiselect";
  question: string;
  options?: string[];
  defaultValue?: string;
  metadata?: Record<string, unknown>;
}

export interface PromptResponse {
  id: string;
  answer?: string;
  cancelled?: boolean;
  source: string;
}

export interface PromptAdapter {
  name: string;
  /**
   * Routing priority. Lower numbers run first. Default 1000.
   * `DashboardDefaultAdapter` uses 9999 so any plugin adapter with the
   * default priority (1000) or lower beats it automatically.
   *
   * See change: route-flow-asks-to-upper-slot.
   */
  priority?: number;
  /**
   * Called when a new prompt arrives.
   * Return a PromptClaim to participate, or null/undefined to skip.
   */
  onRequest(prompt: PromptRequest): PromptClaim | null | undefined | void;
  /** Called when any adapter answered — dismiss your UI if active. */
  onResponse(response: PromptResponse): void;
  /** Called on cancel/timeout — clean up your UI. */
  onCancel(id: string): void;
}

// ── Internal types ──────────────────────────────────────────────────

interface PendingPrompt {
  request: PromptRequest;
  resolve: (response: PromptResponse) => void;
  timer: ReturnType<typeof setTimeout>;
  claims: Array<{ adapter: PromptAdapter; claim: PromptClaim }>;
  /** Resolved component sent to dashboard at request time (for reconnect replay) */
  resolvedComponent: PromptComponent | undefined;
  /** Resolved placement sent to dashboard at request time (for reconnect replay) */
  resolvedPlacement: string | undefined;
}

export interface PromptBusOptions {
  /** Default timeout in milliseconds (default: 5 minutes) */
  timeoutMs?: number;
  /** Called when a prompt_request should be sent to the dashboard */
  onDashboardRequest?: (prompt: PromptRequest, component: PromptComponent, placement: string) => void;
  /** Called when a prompt_dismiss should be sent to the dashboard */
  onDashboardDismiss?: (id: string) => void;
  /** Called when a prompt_cancel should be sent to the dashboard */
  onDashboardCancel?: (id: string) => void;
}

// ── PromptBus ───────────────────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

export class PromptBus {
  private adapters: PromptAdapter[] = [];
  private pending = new Map<string, PendingPrompt>();
  private options: PromptBusOptions;

  constructor(options: PromptBusOptions = {}) {
    this.options = options;
  }

  /**
   * Register an adapter. Returns an unsubscribe function.
   * Re-registering with the same name replaces the previous adapter.
   *
   * Adapters are kept sorted by `priority` (default 1000, lower first).
   * `Array.prototype.sort` is stable in V8 ≥ ES2019 so equal priorities
   * preserve insertion order. See change: route-flow-asks-to-upper-slot.
   */
  registerAdapter(adapter: PromptAdapter): () => void {
    // Replace existing adapter with same name
    this.adapters = this.adapters.filter(a => a.name !== adapter.name);
    this.adapters.push(adapter);
    this.adapters.sort(
      (a, b) => (a.priority ?? 1000) - (b.priority ?? 1000),
    );

    return () => {
      this.adapters = this.adapters.filter(a => a !== adapter);
    };
  }

  /**
   * Submit a prompt. Returns a promise that resolves when any adapter answers.
   */
  request(options: Omit<PromptRequest, "id">): Promise<PromptResponse> {
    const id = crypto.randomUUID();
    const request: PromptRequest = { id, ...options };

    return new Promise<PromptResponse>((resolve) => {
      const timeoutMs = this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      // timeoutMs <= 0 means infinite — never fire a cancellation timer.
      const timer = timeoutMs > 0
        ? setTimeout(() => { this.cancel(id); }, timeoutMs)
        : (null as unknown as ReturnType<typeof setTimeout>);

      // Distribute to all adapters and collect claims
      const claims: PendingPrompt["claims"] = [];
      for (const adapter of this.adapters) {
        try {
          const claim = adapter.onRequest(request);
          if (claim) {
            claims.push({ adapter, claim });
          }
        } catch {
          // Adapter error — skip it
        }
      }

      // Resolve dashboard rendering: first adapter with a component wins
      const componentClaim = claims.find(c => c.claim.component);
      let resolvedComponent: PromptComponent | undefined;
      let resolvedPlacement: string | undefined;
      if (componentClaim) {
        resolvedComponent = componentClaim.claim.component!;
        resolvedPlacement = componentClaim.claim.placement ?? "inline";
      } else if (this.options.onDashboardRequest) {
        resolvedComponent = {
          type: "generic-dialog",
          props: {
            question: request.question,
            type: request.type,
            options: request.options,
            defaultValue: request.defaultValue,
          },
        };
        resolvedPlacement = "inline";
      }

      // Store pending state (with resolved component for reconnect replay)
      this.pending.set(id, { request, resolve, timer, claims, resolvedComponent, resolvedPlacement });

      // Send to dashboard
      if (resolvedComponent && this.options.onDashboardRequest) {
        this.options.onDashboardRequest(request, resolvedComponent, resolvedPlacement!);
      }
    });
  }

  /**
   * An adapter calls this to answer a prompt. First response wins.
   */
  respond(response: PromptResponse): void {
    const entry = this.pending.get(response.id);
    if (!entry) return; // Already resolved or unknown

    this.pending.delete(response.id);
    clearTimeout(entry.timer);

    // Notify ALL adapters so they can dismiss their UI
    for (const adapter of this.adapters) {
      try {
        adapter.onResponse(response);
      } catch {
        // Adapter error — continue
      }
    }

    // Send dismiss to dashboard if a non-dashboard source answered
    if (this.options.onDashboardDismiss) {
      this.options.onDashboardDismiss(response.id);
    }

    entry.resolve(response);
  }

  /**
   * Cancel a pending prompt (e.g. on timeout or abort).
   */
  cancel(id: string): void {
    const entry = this.pending.get(id);
    if (!entry) return;

    this.pending.delete(id);
    clearTimeout(entry.timer);

    // Notify adapters
    for (const adapter of this.adapters) {
      try {
        adapter.onCancel(id);
      } catch {
        // Adapter error — continue
      }
    }

    // Notify dashboard
    if (this.options.onDashboardCancel) {
      this.options.onDashboardCancel(id);
    }

    entry.resolve({ id, cancelled: true, source: "__bus__" });
  }

  /** Get pending requests with their resolved dashboard components (for reconnect replay). */
  getPendingRequests(): Array<{ request: PromptRequest; component: PromptComponent; placement: string }> {
    const result: Array<{ request: PromptRequest; component: PromptComponent; placement: string }> = [];
    for (const entry of this.pending.values()) {
      if (entry.resolvedComponent && entry.resolvedPlacement) {
        result.push({
          request: entry.request,
          component: entry.resolvedComponent,
          placement: entry.resolvedPlacement,
        });
      }
    }
    return result;
  }

  /** Get the number of pending prompts (for testing/diagnostics). */
  get pendingCount(): number {
    return this.pending.size;
  }

  /** Get registered adapter names (for testing/diagnostics). */
  get adapterNames(): string[] {
    return this.adapters.map(a => a.name);
  }
}
