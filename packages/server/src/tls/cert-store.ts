/**
 * In-memory SNI map: held name → `tls.SecureContext`. Deterministic and
 * fail-closed: exact name first, then a single-label wildcard (`*.parent`,
 * RFC 6125), else the handshake fails. Swapping an entry is atomic; existing
 * connections keep their context.
 *
 * See change: add-tailscale-cert-tls (design D2).
 */
import tls from "node:tls";

export interface StoreEntry {
  name: string;
  sourceId: string;
  ctx: tls.SecureContext;
  notBefore: number;
  notAfter: number;
  advertise: boolean;
  kind: "magicdns" | "domain";
}

export class TlsCertStore {
  private readonly entries = new Map<string, StoreEntry>();

  set(entry: StoreEntry): void {
    this.entries.set(entry.name, entry);
  }

  delete(name: string): void {
    this.entries.delete(name);
  }

  get(name: string): StoreEntry | undefined {
    return this.entries.get(name);
  }

  all(): StoreEntry[] {
    return [...this.entries.values()];
  }

  /** Exact (non-wildcard) names — what host admission may admit. */
  exactNames(): string[] {
    return [...this.entries.keys()].filter((n) => !n.startsWith("*."));
  }

  /** Exact → single-label wildcard → `null`. */
  resolve(servername: string): StoreEntry | null {
    const name = servername.trim().toLowerCase().replace(/\.$/, "");
    if (!name) return null;
    const exact = this.entries.get(name);
    if (exact) return exact;
    const dot = name.indexOf(".");
    if (dot > 0) {
      const wild = this.entries.get(`*${name.slice(dot)}`);
      if (wild) return wild;
    }
    return null;
  }

  /** `https.createServer({ SNICallback })`. An error aborts the handshake (no fallback certificate). */
  readonly sniCallback = (servername: string, cb: (err: Error | null, ctx?: tls.SecureContext) => void): void => {
    const hit = this.resolve(servername);
    if (!hit) return cb(new Error("no certificate for requested name"));
    cb(null, hit.ctx);
  };

  static createContext(certPem: string, keyPem: string): tls.SecureContext {
    return tls.createSecureContext({ cert: certPem, key: keyPem });
  }
}
