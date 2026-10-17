/**
 * Operator consent per (server, Chrome profile).
 *
 * - Server key = the WS target origin + that target's `/api/health` `instanceId`
 *   (fetched by main). A re-paired / reinstalled server (new `instanceId`) asks
 *   again. Keys are hashed so the file carries no ambiguity.
 * - `browser-host-consent.json` (0600, atomic). An unreadable file is renamed
 *   `browser-host-consent.corrupt-<ts>.json` and treated as empty.
 * - `requestConsent` shows ONE native dialog (Allow once / Always allow / Deny).
 *   Default and Escape are Deny; an unanswered dialog auto-denies after 55 s
 *   (the server waits 60 s); an external abort (cancel / navigation) closes it
 *   and resolves `cancelled` without storing anything. The dialog is an
 *   injected port (`signal` closes it) so this module imports no electron
 *   runtime — unit-tested in `__tests__/consent.test.ts`.
 * - "Browser relay → Revoke all" (`buildBrowserRelayMenuItem`) clears stored
 *   consents for FUTURE connects only; live instances are never closed.
 *
 * See change: add-operator-browser-relay (D4, D7).
 */
import { createHash } from "node:crypto";
import path from "node:path";
import { sanitizeDisplayName } from "@blackbelt-technology/pi-dashboard-shared/display-name.js";
import type { BrowserHostConsentRow } from "@blackbelt-technology/pi-dashboard-shared/browser-host-ipc.js";
import type { MenuItemConstructorOptions } from "electron";
import { type FsPort, nodeFsPort, readVersionedJson, writeJsonAtomic } from "./store.js";

const FILE = "browser-host-consent.json";
const VERSION = 1;
const MAX_CONSENTS = 512;
/** Main's dialog auto-denies at 55 s; the server's `connect_result` window is 60 s. */
export const CONSENT_DIALOG_TIMEOUT_MS = 55_000;

export interface ServerKey {
  origin: string;
  instanceId: string;
}

interface DiskEntry {
  serverOrigin: string;
  profileDirectory: string;
  grantedAt: number;
}

interface DiskFile {
  version: number;
  consents: Record<string, DiskEntry>;
}

export interface ConsentStore {
  has(server: ServerKey, profileDirectory: string): boolean;
  grant(server: ServerKey, profileDirectory: string): void;
  list(): BrowserHostConsentRow[];
  revoke(key: string): boolean;
  /** Returns how many consents were removed. */
  revokeAll(): number;
}

export interface ConsentStoreOptions {
  dir: string;
  fs?: FsPort;
  log?: (line: string) => void;
  now?: () => number;
}

const keyOf = (s: ServerKey, profileDirectory: string): string =>
  createHash("sha256").update(`${s.origin}\n${s.instanceId}\n${profileDirectory}`).digest("hex").slice(0, 32);

export function createConsentStore(opts: ConsentStoreOptions): ConsentStore {
  const fsp = opts.fs ?? nodeFsPort;
  const log = opts.log ?? (() => {});
  const now = opts.now ?? Date.now;
  const file = path.join(opts.dir, FILE);
  const consents = new Map<string, DiskEntry>();

  const disk = readVersionedJson<DiskFile>({ fsp, file, asideStem: "browser-host-consent", now, log }, VERSION);
  for (const [key, e] of Object.entries(disk?.consents ?? {})) {
    if (e && typeof e.serverOrigin === "string" && typeof e.profileDirectory === "string" && Number.isFinite(e.grantedAt)) consents.set(key, e);
  }

  const save = (): void => {
    const body: DiskFile = { version: VERSION, consents: Object.fromEntries(consents) };
    try {
      writeJsonAtomic(fsp, file, body, now);
    } catch (e) {
      log(`[browser-host] consent write failed: ${(e as Error).message}`); // in-memory state stays authoritative this run
    }
  };

  return {
    has: (server, profileDirectory) => consents.has(keyOf(server, profileDirectory)),
    grant(server, profileDirectory) {
      consents.set(keyOf(server, profileDirectory), { serverOrigin: server.origin, profileDirectory, grantedAt: now() });
      while (consents.size > MAX_CONSENTS) consents.delete(consents.keys().next().value as string); // oldest first
      save();
    },
    list: () => Array.from(consents, ([key, e]) => ({ key, serverOrigin: e.serverOrigin, profileDirectory: e.profileDirectory, grantedAt: e.grantedAt })),
    revoke(key) {
      if (!consents.delete(key)) return false;
      save();
      return true;
    },
    revokeAll() {
      const n = consents.size;
      if (n === 0) return 0;
      consents.clear();
      save();
      return n;
    },
  };
}

// ── Dialog ───────────────────────────────────────────────────────────────────

export interface DialogOptions {
  message: string;
  detail?: string;
  buttons: string[];
  defaultId: number;
  cancelId: number;
}

export interface DialogPort {
  /** Resolve with the clicked button index (`cancelId` on Escape/close). Aborting `signal` closes it as if cancelled. */
  show(opts: DialogOptions, signal: AbortSignal): Promise<number>;
}

export type ConsentDecision = "allow" | "denied" | "cancelled";

export interface ConsentRequest {
  store: ConsentStore;
  dialog: DialogPort;
  serverKey: ServerKey;
  /** Display only (the server's own host:port as it sent it). */
  serverLabel: string;
  profileDirectory: string;
  profileLabel: string;
  /** External cancel (cancelConnect, renderer navigation, destroy). */
  signal?: AbortSignal;
}

const ALLOW_ONCE = 0;
const ALWAYS_ALLOW = 1;
const DENY = 2;

export async function requestConsent(req: ConsentRequest): Promise<ConsentDecision> {
  if (req.signal?.aborted) return "cancelled";
  if (req.store.has(req.serverKey, req.profileDirectory)) return "allow";

  const controller = new AbortController();
  const onExternalAbort = (): void => controller.abort();
  req.signal?.addEventListener("abort", onExternalAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), CONSENT_DIALOG_TIMEOUT_MS);
  try {
    // The identity shown is the VERIFIED target origin main fetched itself; the
    // server-supplied label is secondary detail only (it can claim anything).
    let originHost = req.serverKey.origin;
    try {
      originHost = new URL(req.serverKey.origin).host;
    } catch {
      /* keep the raw origin */
    }
    const server = sanitizeDisplayName(originHost, "a dashboard server");
    const reportedAs = sanitizeDisplayName(req.serverLabel, "");
    const profile = sanitizeDisplayName(req.profileLabel, req.profileDirectory);
    let response: number;
    try {
      response = await req.dialog.show(
        {
          message: `${server} wants an agent to control Chrome profile ${profile} on this computer.`,
          detail: `${reportedAs ? `The server reports itself as "${reportedAs}". ` : ""}The agent will be able to read and operate the tabs you share from that profile. Chrome will still ask you to allow the connection unless you saved a token.`,
          buttons: ["Allow once", "Always allow", "Deny"],
          defaultId: DENY,
          cancelId: DENY,
        },
        controller.signal,
      );
    } catch {
      response = DENY;
    }
    if (req.signal?.aborted) return "cancelled";
    if (controller.signal.aborted) return "denied"; // 55 s auto-deny, whatever the closed dialog reported
    if (response === ALWAYS_ALLOW) {
      req.store.grant(req.serverKey, req.profileDirectory);
      return "allow";
    }
    return response === ALLOW_ONCE ? "allow" : "denied";
  } finally {
    clearTimeout(timer);
    req.signal?.removeEventListener("abort", onExternalAbort);
  }
}

// ── App menu ─────────────────────────────────────────────────────────────────

let revokeAllHook: (() => void) | null = null;

/** Installed by the Electron wiring once the host exists; `null` clears. */
export function setRevokeAllHook(hook: (() => void) | null): void {
  revokeAllHook = hook;
}

/** "Browser relay → Revoke all": removes stored consents for future connects; never closes live instances. */
export function buildBrowserRelayMenuItem(): MenuItemConstructorOptions {
  return {
    label: "Browser relay",
    submenu: [{ label: "Revoke all", click: () => revokeAllHook?.() }],
  };
}
