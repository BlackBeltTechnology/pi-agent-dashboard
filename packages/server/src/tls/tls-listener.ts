/**
 * Optional native TLS listener: a second `https.Server` that dispatches into the
 * ALREADY-BUILT Fastify instance (one route table, one gate chain, one upgrade
 * switch — two transports), with certificates hot-swapped per SNI name.
 *
 * Isolation: a bind failure or a failed reconcile NEVER reaches the main
 * listener; it is reported in status. A failed bind is retried (1 min doubling,
 * cap 15 min, immediately on reconcile / trigger) so the listener comes up once
 * its address exists (e.g. the tailnet IP after tailscaled starts).
 *
 * Fastify-independent on purpose: `dispatch` is injected, so the listener is
 * testable with a plain `http` handler.
 *
 * See change: add-tailscale-cert-tls (design D1, D7, D8, D9).
 */
import { constants as cryptoConstants } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import https from "node:https";
import path from "node:path";
import type { Duplex } from "node:stream";
import {
  DEFAULT_TLS,
  type TlsConfig,
  type TlsSourceEntry,
} from "@blackbelt-technology/pi-dashboard-shared/config.js";
import type { TlsStatus, TlsStatusBasic } from "@blackbelt-technology/pi-dashboard-shared/tls-status.js";
import type { TunnelEndpoint } from "@blackbelt-technology/pi-dashboard-shared/tunnel-provider.js";
import { CertFiles } from "./cert-files.js";
import { CertManager, type InvalidSourceEntry, type ManagerLogger, type StatusGate } from "./cert-manager.js";
import { TlsCertStore } from "./cert-store.js";
import {
  getCertSourceType,
  registerCertSourceType,
  resolveSourceId,
  validateSourceEntry,
} from "./source-registry.js";
import { acmeSourceType } from "./sources/acme/acme-source.js";
import { tailscaleSourceType } from "./sources/tailscale-cert.js";
import type { CertSource } from "./types.js";

/** Server-level timeouts, one constant for both transports (Fastify applies them identically). */
export const MAIN_KEEP_ALIVE_TIMEOUT_MS = 30_000;
export const MAIN_CONNECTION_TIMEOUT_MS = 10_000;

const BIND_RETRY_BASE_MS = 60_000;
const BIND_RETRY_CAP_MS = 15 * 60_000;

interface TlsDispatch {
  request(req: IncomingMessage, res: ServerResponse): void;
  upgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void;
  clientError(err: Error, socket: Duplex): void;
}

export interface TlsListenerDeps {
  /** `~/.pi/dashboard/tls` */
  dataRoot: string;
  /** Live `tls` block (re-read on every reconcile). */
  getTlsConfig: () => TlsConfig;
  dispatch: TlsDispatch;
  /** Taken immediately BEFORE each bind: the per-transport local-credential proof floor. */
  beforeBind?: (boundAt: number) => void;
  now?: () => number;
  log?: ManagerLogger;
  /** Test seam: replace the 12 h tick wiring / timers' clock. */
  manager?: CertManager;
}

/** Register the built-in source types (tests may pre-register a stub under the same type). */
function ensureBuiltinCertSourceTypes(): void {
  if (!getCertSourceType(tailscaleSourceType.type)) registerCertSourceType(tailscaleSourceType);
  if (!getCertSourceType(acmeSourceType.type)) registerCertSourceType(acmeSourceType);
}

function isLoopbackHost(host: string): boolean {
  const h = host.trim().toLowerCase().replace(/^\[|\]$/g, "");
  return h === "localhost" || h === "::1" || /^127\./.test(h);
}

export class TlsListener {
  private readonly deps: TlsListenerDeps;
  private readonly now: () => number;
  private readonly log: ManagerLogger;
  readonly manager: CertManager;
  readonly store: TlsCertStore;

  private server: https.Server | null = null;
  private boundPort = 0;
  private boundHost = "";
  private bindError: string | undefined;
  private bindRetryMs = BIND_RETRY_BASE_MS;
  private bindTimer?: ReturnType<typeof setTimeout>;
  private ready = false;
  private stopping = false;
  private chain: Promise<unknown> = Promise.resolve();
  private enabled = false;
  private port: number = DEFAULT_TLS.port;
  private host: string = DEFAULT_TLS.host;

  constructor(deps: TlsListenerDeps) {
    ensureBuiltinCertSourceTypes();
    this.deps = deps;
    this.now = deps.now ?? Date.now;
    this.log = deps.log ?? {
      info: (m) => console.log(`[tls] ${m}`),
      warn: (m) => console.warn(`[tls] ${m}`),
    };
    this.store = new TlsCertStore();
    this.manager =
      deps.manager ?? new CertManager({ files: new CertFiles(deps.dataRoot), store: this.store, now: this.now, log: this.log });
  }

  /** The underlying https server (tests compare its timeouts with Fastify's). */
  get httpsServer(): https.Server | null {
    return this.server;
  }

  /** The port actually bound, or `null`. */
  boundTlsPort(): number | null {
    return this.server ? this.boundPort : null;
  }

  get isBound(): boolean {
    return this.server !== null;
  }

  /** `tls.enabled` as of the last reconcile. */
  get isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Mark the app ready (Fastify `ready()` done, main listener bound) and run the
   * first reconcile. Until then `reconcile()` is a no-op that runs again here —
   * the listener never `emit`s into an unready app.
   */
  async markReady(): Promise<void> {
    this.ready = true;
    await this.reconcile();
  }

  /** Apply the live `tls` config. Awaits only the (re)bind; certificate work is scheduled. Never throws. */
  reconcile(): Promise<void> {
    const run = this.chain.then(() => this.doReconcile());
    this.chain = run.catch(() => undefined);
    return run;
  }

  private async doReconcile(): Promise<void> {
    if (!this.ready || this.stopping) return;
    try {
      const cfg = this.deps.getTlsConfig();
      this.enabled = cfg.enabled === true;
      this.port = cfg.port;
      this.host = cfg.host;
      if (!this.enabled) {
        await this.closeServer();
        this.clearBindTimer();
        this.bindError = undefined;
        this.manager.suspend();
        return;
      }
      const { sources, invalid } = this.buildSources(cfg.sources);
      if (sources.length === 0) {
        await this.closeServer();
        this.clearBindTimer();
        this.bindError = undefined;
        await this.manager.reconcile([], invalid);
        return;
      }
      await this.ensureBound(cfg);
      // Certificates are scheduled in the background: names() / issuance may take minutes.
      this.manager.start();
      void this.manager.reconcile(sources, invalid).catch((err) => {
        this.log.warn(`reconcile failed: ${err instanceof Error ? err.message : String(err)}`);
      });
    } catch (err) {
      this.bindError = err instanceof Error ? err.message : String(err);
      this.log.warn(`reconcile failed: ${this.bindError}`);
    }
  }

  private buildSources(entries: TlsSourceEntry[]): { sources: CertSource[]; invalid: InvalidSourceEntry[] } {
    const sources: CertSource[] = [];
    const invalid: InvalidSourceEntry[] = [];
    const seen = new Set<string>();
    entries.forEach((entry, index) => {
      const id = resolveSourceId(entry) ?? undefined;
      const err = validateSourceEntry(entry, index) ?? (id && seen.has(id) ? `duplicate source id "${id}"` : null);
      if (err || !id) {
        invalid.push({ index, message: err ?? "missing source id", ...(id ? { id } : {}) });
        return;
      }
      seen.add(id);
      const type = getCertSourceType(String(entry.type));
      if (!type) return;
      sources.push(type.create(entry, id, { dataDir: path.join(this.deps.dataRoot, id) }));
    });
    return { sources, invalid };
  }

  // ── binding ──────────────────────────────────────────────────────────

  private clearBindTimer(): void {
    if (this.bindTimer) clearTimeout(this.bindTimer);
    this.bindTimer = undefined;
  }

  private async ensureBound(cfg: TlsConfig): Promise<void> {
    if (this.server && this.boundPort === cfg.port && this.boundHost === cfg.host) return;
    await this.closeServer();
    await this.bind(cfg.host, cfg.port);
  }

  private bind(host: string, port: number): Promise<void> {
    this.clearBindTimer();
    // No session resumption: a resumed session skips SNICallback, so a pruned or
    // replaced name would keep being served to a returning client. Full handshakes
    // always run SNICallback (the TLS cost is negligible for this listener).
    const server = https.createServer({
      SNICallback: this.store.sniCallback,
      secureOptions: cryptoConstants.SSL_OP_NO_TICKET,
    });
    // Node semantics relied on: `newSession` with a bare `cb()` stores nothing, and
    // `resumeSession` answering no session forces a full handshake. Re-check on a Node upgrade
    // (the E6 resumed-session test fails first if the contract changes).
    server.on("newSession", (_id, _data, cb) => cb());
    server.on("resumeSession", (_id, cb) => cb(null, undefined));
    // Parity with the main listener (Fastify applies keepAliveTimeout + setTimeout(connectionTimeout),
    // and sets requestTimeout = 0; Node's https default is 300 s).
    server.keepAliveTimeout = MAIN_KEEP_ALIVE_TIMEOUT_MS;
    server.setTimeout(MAIN_CONNECTION_TIMEOUT_MS);
    server.requestTimeout = 0;
    server.on("request", (req, res) => this.deps.dispatch.request(req, res));
    server.on("upgrade", (req, socket, head) => this.deps.dispatch.upgrade(req, socket, head));
    server.on("clientError", (err, socket) => this.deps.dispatch.clientError(err, socket));
    // Handshake failures (no certificate for the SNI name, plaintext on the TLS port) are expected noise.
    server.on("tlsClientError", () => undefined);

    return new Promise<void>((resolve) => {
      const onError = (err: NodeJS.ErrnoException): void => {
        server.close();
        this.bindError = `${err.code ?? "ERROR"}: ${err.message}`;
        this.log.warn(`bind failed host=${host} port=${port}: ${this.bindError}`);
        this.scheduleBindRetry(err.code);
        resolve();
      };
      server.once("error", onError);
      // The proof floor is taken immediately BEFORE the bind (same contract as the main listener).
      this.deps.beforeBind?.(this.now());
      server.listen({ port, host }, () => {
        server.off("error", onError);
        server.on("error", (e) => this.log.warn(`listener error: ${e.message}`));
        this.server = server;
        this.boundPort = (server.address() as { port: number } | null)?.port ?? port;
        this.boundHost = host;
        this.bindError = undefined;
        this.bindRetryMs = BIND_RETRY_BASE_MS;
        this.log.info(`listening host=${host} port=${this.boundPort}`);
        resolve();
      });
    });
  }

  private scheduleBindRetry(code: string | undefined): void {
    if (code !== "EADDRNOTAVAIL" && code !== "EADDRINUSE") return;
    this.clearBindTimer();
    const delay = this.bindRetryMs;
    this.bindRetryMs = Math.min(this.bindRetryMs * 2, BIND_RETRY_CAP_MS);
    this.bindTimer = setTimeout(() => {
      this.bindTimer = undefined;
      void this.reconcile().catch((err: unknown) =>
        this.log.warn(`bind retry failed: ${err instanceof Error ? err.message : String(err)}`),
      );
    }, delay);
    this.bindTimer.unref?.();
  }

  private async closeServer(): Promise<void> {
    const server = this.server;
    this.server = null;
    this.boundPort = 0;
    this.boundHost = "";
    if (!server) return;
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    });
  }

  /** Close the listener and every open connection (shutdown). Certificates stay on disk. */
  async stop(): Promise<void> {
    this.stopping = true;
    this.clearBindTimer();
    this.manager.suspend();
    await this.closeServer();
  }

  /**
   * Operator "issue now": retry a failed bind immediately, then hand the
   * request to the manager (which re-checks gates and bypasses backoff).
   */
  async trigger(sourceId: string, name?: string): Promise<void> {
    if (this.enabled && !this.server) await this.reconcile();
    await this.manager.trigger(sourceId, name);
  }

  /** Re-read one source's readiness now (forced) so status reflects a credentials save. `false` = unknown source. */
  async refreshReadiness(sourceId: string): Promise<boolean> {
    return this.manager.refreshReadiness(sourceId);
  }

  // ── read side ────────────────────────────────────────────────────────

  /** Exact certificate names — only while enabled AND bound, so disabling or a bind failure restores today's admission. */
  tlsListenerNames(): string[] {
    return this.enabled && this.server ? this.manager.heldExactNames() : [];
  }

  /** `https://<name>[:<port>]` for each advertisable certificate; nothing while unbound or loopback-bound. */
  tlsListenerUrls(): TunnelEndpoint[] {
    if (!this.enabled || !this.server || isLoopbackHost(this.boundHost)) return [];
    return this.manager.advertisable().map(({ name, kind }) => ({
      kind,
      url: this.boundPort === 443 ? `https://${name}` : `https://${name}:${this.boundPort}`,
      tls: true,
    }));
  }

  status(detailed: boolean): TlsStatus {
    const base: TlsStatusBasic = { enabled: this.enabled, bound: this.server !== null };
    if (!detailed || !this.enabled) return base;
    const m = this.manager.status();
    const gates: StatusGate[] = [...m.gates];
    if (isLoopbackHost(this.server ? this.boundHost : this.host)) {
      gates.push({
        id: "bind-reachable",
        ok: false,
        hint: "The HTTPS listener only accepts connections from this computer. Set the listen address (tls.host) to the Tailscale address.",
      });
    }
    return {
      ...base,
      port: this.server ? this.boundPort : this.port,
      host: this.server ? this.boundHost : this.host,
      ...(this.bindError ? { bindError: this.bindError.slice(0, 500) } : {}),
      gates,
      sources: m.sources,
      certs: m.certs,
    };
  }
}
