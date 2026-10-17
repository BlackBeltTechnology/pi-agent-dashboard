/**
 * Shared fakes for the browser-host tests: a reversible `CryptoPort`, a fake
 * extension (Playwright extension stand-in) and a temp-dir helper.
 * See change: add-operator-browser-relay.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { WebSocket } from "ws";
import type { CryptoPort } from "../../server-keyring.js";

/** Reversible fake "encryption" so file bytes never contain the plaintext. */
export function fakeCrypto(over: Partial<CryptoPort> = {}): CryptoPort {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (s) => Buffer.from(`ENC:${Buffer.from(s).reverse().toString("hex")}`),
    decryptString: (b) => {
      const t = b.toString();
      if (!t.startsWith("ENC:")) throw new Error("bad blob");
      return Buffer.from(Buffer.from(t.slice(4), "hex").reverse()).toString();
    },
    ...over,
  };
}

export const noCrypto = (): CryptoPort => fakeCrypto({ isEncryptionAvailable: () => false });

export function tempDir(): { dir: string; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "browser-host-"));
  return { dir, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

export const EXT_ORIGIN = "chrome-extension://mmlmfjhmonkocbjadbfplnigmagldckm";

/** The Playwright extension stand-in: dials the shim with the pinned Origin. */
export class FakeExtension {
  ws!: WebSocket;
  readonly received: string[] = [];
  closed: Promise<number>;
  private resolveClosed!: (code: number) => void;

  constructor() {
    this.closed = new Promise((r) => {
      this.resolveClosed = r;
    });
  }

  /** `origin: null` dials with no Origin header. Resolves on open; rejects with the HTTP status on a refused upgrade. */
  connect(port: number, linkId: string, origin: string | null = EXT_ORIGIN): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(`ws://127.0.0.1:${port}/ws/browser-ext/${linkId}`, origin === null ? {} : { origin });
      this.ws.on("message", (d) => this.received.push(d.toString()));
      this.ws.on("close", (code) => this.resolveClosed(code));
      this.ws.on("open", () => resolve());
      this.ws.on("unexpected-response", (_req, res) => {
        res.resume();
        reject(new Error(`status ${res.statusCode}`));
      });
      this.ws.on("error", (e) => reject(e));
    });
  }

  /** `chrome.debugger.onEvent` wire message for a CDP event on a tab. */
  static debuggerEvent(tabId: number, method: string, params: unknown, sessionId?: string): string {
    return JSON.stringify({ method: "chrome.debugger.onEvent", params: [{ tabId, ...(sessionId ? { sessionId } : {}) }, method, params] });
  }
}

export const until = async (cond: () => boolean, ms = 2000): Promise<void> => {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error("until: timeout");
    await new Promise((r) => setTimeout(r, 5));
  }
};
