/**
 * Shared test helpers for the TLS listener / certificate manager suites:
 * committed fixture PEMs (see `fixtures/gen.sh`), a controllable fake
 * `CertSource`, and a real TLS client probe.
 *
 * See change: add-tailscale-cert-tls.
 */
import fs from "node:fs";
import path from "node:path";
import tls from "node:tls";
import { fileURLToPath } from "node:url";
import type {
  CertSource,
  Gate,
  ObtainedCert,
  SourceDetails,
  SourceReadiness,
} from "../types.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fx = (f: string): string => fs.readFileSync(path.join(here, "fixtures", f), "utf8");

export const CA_PEM = fx("ca.pem");

export type FixtureName =
  | "host.example.ts.net"
  | "wildcard.example.com"
  | "dash.example.com"
  | "a.test"
  | "b.test"
  | "c.test"
  | "x.test"
  | "90d-host.example.ts.net";

export function fixture(name: FixtureName): { certPem: string; keyPem: string } {
  return { certPem: fx(`leaf-${name}.pem`), keyPem: fx(`leaf-${name}-key.pem`) };
}

/** Fixture for a (possibly wildcard) cert name. */
export function fixtureFor(name: string): { certPem: string; keyPem: string } {
  if (name === "*.example.com") return fixture("wildcard.example.com");
  return fixture(name as FixtureName);
}

export interface FakeSourceOptions {
  id?: string;
  type?: string;
  names?: string[] | null;
  gates?: Gate[];
  details?: SourceDetails;
  fingerprint?: (name: string) => string;
  attemptTimeoutMs?: number;
}

/** A `CertSource` whose every behaviour a test can steer; records its calls. */
export class FakeSource implements CertSource {
  readonly id: string;
  readonly type: string;
  namesValue: string[] | null;
  gates: Gate[];
  details?: SourceDetails;
  fingerprint: (name: string) => string;
  readonly attemptTimeoutMs?: number;
  obtainCalls: string[] = [];
  readinessCalls: Array<{ force: boolean }> = [];
  reconciled = 0;
  removed = 0;
  /** Default behaviour: succeed with the fixture for the name. */
  obtainImpl: (name: string, onStage: (s: string) => void) => Promise<ObtainedCert> = async (name) => ({
    ...fixtureFor(name),
    advertise: true,
    kind: "magicdns",
  });

  constructor(opts: FakeSourceOptions = {}) {
    this.id = opts.id ?? "fake";
    this.type = opts.type ?? "fake";
    this.namesValue = opts.names === undefined ? [] : opts.names;
    this.gates = opts.gates ?? [];
    this.details = opts.details;
    this.fingerprint = opts.fingerprint ?? (() => "f1");
    this.attemptTimeoutMs = opts.attemptTimeoutMs;
  }

  async names(): Promise<string[] | null> {
    return this.namesValue;
  }

  configFingerprint(name: string): string {
    return this.fingerprint(name);
  }

  obtain(name: string, onStage: (stage: string) => void): Promise<ObtainedCert> {
    this.obtainCalls.push(name);
    return this.obtainImpl(name, onStage);
  }

  async readiness(opts?: { force?: boolean }): Promise<SourceReadiness> {
    this.readinessCalls.push({ force: opts?.force === true });
    return { gates: this.gates, ...(this.details ? { details: this.details } : {}) };
  }

  async onReconciled(): Promise<void> {
    this.reconciled += 1;
  }

  async onRemoved(): Promise<void> {
    this.removed += 1;
  }
}

export interface Handshake {
  ok: boolean;
  /** Peer certificate subject CN on success. */
  cn?: string;
  error?: string;
}

/** Real TLS connect (trusting the fixture CA) with an explicit SNI name. */
export function handshake(port: number, servername: string | undefined, host = "127.0.0.1"): Promise<Handshake> {
  return new Promise((resolve) => {
    const socket = tls.connect({ host, port, servername, ca: CA_PEM, checkServerIdentity: () => undefined }, () => {
      const cert = socket.getPeerCertificate();
      const cn = typeof cert.subject?.CN === "string" ? cert.subject.CN : undefined;
      socket.end();
      resolve({ ok: true, cn });
    });
    socket.on("error", (e) => {
      socket.destroy();
      resolve({ ok: false, error: e.message });
    });
    socket.setTimeout(5000, () => {
      socket.destroy();
      resolve({ ok: false, error: "timeout" });
    });
  });
}

/** Flush pending microtasks / zero-delay timers. */
export const flush = async (n = 5): Promise<void> => {
  for (let i = 0; i < n; i++) await Promise.resolve();
};

/**
 * Handshake that is EXPECTED to succeed: retries a transient failure (CPU-starved CI worker,
 * ephemeral-port race) a couple of times. Never use it for an expected failure.
 */
export async function handshakeEventually(port: number, servername: string | undefined, attempts = 3): Promise<Handshake> {
  let last: Handshake = { ok: false, error: "not attempted" };
  for (let i = 0; i < attempts; i++) {
    last = await handshake(port, servername);
    if (last.ok) return last;
    await new Promise((r) => setTimeout(r, 100 * (i + 1)));
  }
  return last;
}
