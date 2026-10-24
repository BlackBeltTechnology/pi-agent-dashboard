/**
 * One window per paired server, on that server's OWN origin.
 *
 * Responsibilities (all main-process; renderers only send intents):
 *   - registry fp → window, focus-existing, per-server bounds
 *   - open: pick a host whose identity challenge proves the pinned fingerprint
 *     (≤ 5 s, concurrent), exchange the bearer for the device cookie INSIDE the
 *     server's partition (`session.fetch`, `redirect:"manual"`), then load the
 *     server's origin
 *   - window posture: sandbox, no preload, same-origin top-level navigation only
 *     (`will-navigate` + `will-redirect`), `setWindowOpenHandler` deny, permission
 *     allowlist, explicit save dialog, sanitised title
 *   - credential refusal: before-load exchange refused ⇒ needs pairing; while
 *     open, 401/403 only TRIGGERS a rate-limited (5 min) re-run of the exchange
 *   - identity re-verification: 60 s interval, focus (≥ 60 s since the last
 *     focus-driven check), system resume; mismatch ⇒ about:blank + cookie removal
 *   - Forget, and the pairing hand-off (connecting window + pairing client)
 *
 * Electron is reached ONLY through the injected `ServerWindowPorts`, so the
 * whole lifecycle is unit-tested with fakes (`__tests__/server-windows.test.ts`).
 * No bearer or confirmation code is ever logged.
 *
 * See change: add-electron-server-windows (D5–D8, D12, D14), group-servers-by-identity (D8).
 */
import type { NetworkInterfaceInfo } from "node:os";
import type { ProveFn } from "@blackbelt-technology/pi-dashboard-shared/pairing-knock-client.js";
import { classifyProof, type ProveResult } from "@blackbelt-technology/pi-dashboard-shared/server-pinning.js";
import { decideServerWindowNavigation } from "./link-handling.js";
import {
  type ConnectingState,
  type PairingResult,
  type PairingSession,
  type PairingTarget,
  startPairing,
} from "./pairing-client.js";
import { type CodePairingSession, startCodePairing } from "./pairing-code-client.js";
import {
  buildCandidates,
  type Candidate,
  expandRef,
  HOST_SELECTION_DEADLINE_MS,
  type HostRef,
  isPlainHost,
  isValidPort,
  LITERALS_PER_NAME_CAP,
  type LookupFn,
  orderByLocality,
  partitionFor,
  pickVerifiedHost,
  type ServerDiscovery,
  sanitizeDisplayName,
  serverOrigin,
  shortFingerprint,
} from "./server-discovery.js";
import type { KeyringEntryView, ServerKeyring } from "./server-keyring.js";

const REVERIFY_INTERVAL_MS = 60_000;
const FOCUS_REVERIFY_MIN_MS = 60_000;
const RECHECK_MIN_INTERVAL_MS = 5 * 60_000;
const EXCHANGE_TIMEOUT_MS = 10_000;
const EXTERNAL_MIN_INTERVAL_MS = 1000;
const DEVICE_COOKIE = "pi_dash_device";
/**
 * Non-secret "cookie-paired" marker the remote's client reads (`isDevicePaired`) to decide it
 * must mint a WS ticket. The exchange sets the httpOnly cookie from main, so the page never
 * learns it is paired unless we plant the marker. The bearer never enters the page.
 */
const MARK_COOKIE_PAIRED_JS = 'try{localStorage.setItem("pi-dashboard:device-paired","1")}catch{}';

// ── Pure helpers ─────────────────────────────────────────────────────────────

export type ExchangeVerdict = "ok" | "refused" | "transport";

/**
 * Classify the `/api/device-session` exchange. `status === null` ⇒ timeout/transport.
 * `200` ok; `401`, or `403` with `error === "network_not_allowed"` ⇒ refused; else transport.
 */
export function classifyExchange(status: number | null, body: unknown): ExchangeVerdict {
  if (status === 200) return "ok";
  if (status === 401) return "refused";
  if (status === 403 && (body as { error?: unknown } | null)?.error === "network_not_allowed") return "refused";
  return "transport";
}

const ALLOWED_PERMISSIONS: ReadonlySet<string> = new Set(["clipboard-sanitized-write", "notifications", "fullscreen"]);

/** Server windows may write the clipboard, show notifications and go fullscreen — nothing else. */
export function isServerWindowPermissionAllowed(permission: string): boolean {
  return ALLOWED_PERMISSIONS.has(permission);
}

/** `‹label› — ‹page title›`, both sanitised; `suffix` replaces the page title ("not reachable"). */
export function composeTitle(label: string, pageTitle: string | undefined, suffix?: string): string {
  const l = sanitizeDisplayName(label, "dashboard");
  const tail = suffix ?? sanitizeDisplayName(pageTitle, "");
  return tail ? `${l} — ${tail}` : l;
}

// ── Ports (everything Electron-shaped) ───────────────────────────────────────

export interface Bounds {
  x?: number;
  y?: number;
  width: number;
  height: number;
}

// biome-ignore lint/suspicious/noExplicitAny: Electron emitters take arbitrary listener signatures
type Handler = (...args: any[]) => void;

export interface SessionLike {
  fetch(url: string, init: { method: string; headers?: Record<string, string>; redirect?: "manual"; signal?: AbortSignal }): Promise<Response>;
  cookies: { remove(url: string, name: string): Promise<void> };
  clearStorageData(options?: { storages?: string[] }): Promise<void>;
  setPermissionRequestHandler(handler: (wc: unknown, permission: string, cb: (granted: boolean) => void) => void): void;
  setPermissionCheckHandler?(handler: (wc: unknown, permission: string) => boolean): void;
  /** Electron keeps ONE listener per event per session; `null` unsubscribes. */
  webRequest: { onCompleted(filter: { urls: string[] }, listener: ((details: { statusCode: number; url: string }) => void) | null): void };
  on(event: "will-download", handler: (event: unknown, item: { setSaveDialogOptions(opts: Record<string, unknown>): void }) => void): void;
}

interface WebContentsLike {
  session: SessionLike;
  on(event: string, handler: Handler): void;
  setWindowOpenHandler(handler: (details: { url: string }) => { action: "deny" }): void;
  loadURL(url: string): Promise<void>;
  getURL(): string;
  executeJavaScript(code: string): Promise<unknown>;
}

export interface ServerWindowLike {
  webContents: WebContentsLike;
  on(event: string, handler: Handler): void;
  isDestroyed(): boolean;
  isMinimized(): boolean;
  restore(): void;
  focus(): void;
  close(): void;
  setTitle(title: string): void;
  getBounds(): Bounds;
}

export interface ServerWindowOptions {
  title: string;
  width: number;
  height: number;
  x?: number;
  y?: number;
  webPreferences: {
    partition: string;
    sandbox: true;
    contextIsolation: true;
    nodeIntegration: false;
    webviewTag: false;
  };
}

export interface ConnectingHandle {
  push(state: ConnectingState): void;
  focus(): void;
  close(): void;
  isOpen(): boolean;
}

type NeedsPairingChoice = "pair-again" | "forget" | "close";

export interface ServerWindowPorts {
  createWindow(options: ServerWindowOptions): ServerWindowLike;
  sessionFor(partition: string): SessionLike;
  openExternal(url: string): void;
  /** One main-owned dialog offered when credentials are refused. */
  askNeedsPairing(label: string): Promise<NeedsPairingChoice>;
  /** Plain information to the user (unreachable, mismatch, forget message). */
  notify(title: string, message: string): void;
  openConnectingWindow(initial: ConnectingState): ConnectingHandle;
  bounds: { get(fp: string): Bounds | undefined; set(fp: string, b: Bounds): void; remove(fp: string): void };
  onResume(cb: () => void): () => void;
  deviceName(): string;
}

export interface ServerWindowsDeps {
  keyring: ServerKeyring;
  discovery: Pick<ServerDiscovery, "advertsFor" | "raw" | "list"> & Partial<Pick<ServerDiscovery, "localFp">>;
  ports: ServerWindowPorts;
  /** Resolve an `http` hostname to address literals (proof and use are bound to one literal). Absent ⇒ names are used as they are. */
  lookup?: LookupFn;
  /** This machine's interfaces (`os.networkInterfaces`) — locality ordering of candidates. */
  interfaces?: () => NodeJS.Dict<NetworkInterfaceInfo[]>;
  prove: ProveFn;
  log: (line: string) => void;
  now?: () => number;
  /** Test seam: pairing client factory. */
  startPairing?: typeof startPairing;
  /** Test seam: in-app code-redeem factory. */
  startCodePairing?: typeof startCodePairing;
  /** Pairing poll hooks (tests). */
  pairingHooks?: { now?: () => number; sleep?: (ms: number) => Promise<void>; pollIntervalMs?: number };
}

type OpenFailure = "unreachable" | "identity_mismatch" | "needs_pairing" | "unknown_server" | "invalid";
export type OpenResult = { ok: true; pairing?: true } | { ok: false; reason: OpenFailure };

/**
 * What one identity challenge showed (`classifyProof` plus transport): `self` = this machine's own
 * dashboard (a wrong address, never an alarm); `foreign` = any other identity (strict handling);
 * `unverified` = a non-pin proof while the own fingerprint is still unknown (retry, like a transport failure).
 */
type Probe =
  | { kind: "ok" }
  | { kind: "self"; proven: string }
  | { kind: "foreign"; proven?: string }
  | { kind: "unverified" }
  | { kind: "unreachable" };

/** A `foreign` proof seen during a selection (origin + the short-form source of the report). */
interface ForeignProof {
  origin: string;
  proven?: string;
}

/** Window state: `live` (verified page), `parked` (blank, timers running, recoverable), `blanked` (mismatch reported, timers stopped). */
type WindowState = "live" | "parked" | "blanked";

interface OpenWindow {
  fp: string;
  win: ServerWindowLike;
  origin: string;
  host: HostRef;
  label: string;
  pageTitle: string;
  unreachable: boolean;
  lastFocusCheckAt: number;
  lastRecheckAt: number | null;
  rechecking: boolean;
  unpaired: boolean;
  state: WindowState;
  /** A re-selection is running (re-verification triggers do not overlap). */
  reselecting: boolean;
  /** The partition's cookies were removed since the window stopped being verified (a failed removal is retried before anything loads). */
  cookiesCleared: boolean;
  /** Unsubscribe the session's `/api/*` listener (idempotent). */
  detachApi: (() => void) | null;
  /** Last time an off-origin URL was handed to the system browser (rate limit). */
  lastExternalAt: number;
  interval: ReturnType<typeof setInterval> | null;
  offResume: (() => void) | null;
}

export interface ServerWindows {
  open(fp: string, opts?: { notify?: boolean }): Promise<OpenResult>;
  /** Open by host + port (main window request): must match a discovered server or a keyring host. */
  openByHostPort(host: string, port: number): Promise<OpenResult>;
  /** Connect a discovered server by list key (paired ⇒ open, else pair). */
  connectDiscovered(key: string): Promise<OpenResult>;
  /** Manually entered URL (remote-connect window only): scheme/host/port are used, path dropped. */
  connectManual(url: string): Promise<OpenResult>;
  /** Re-run pairing for a keyring entry. */
  pairAgain(fp: string): Promise<OpenResult>;
  /** "Pair with code" (main window): open the Connecting window in code mode for a pinned fingerprint. */
  pairWithCode(fp: string): Promise<OpenResult>;
  /** Connecting-window intent: the pasted pairing text (never logged). */
  submitCode(text: string): void;
  forget(fp: string): Promise<{ ok: boolean; message: string }>;
  /** Connecting-window intents. */
  sendRequest(deviceName: string): void;
  stopWaiting(): void;
  retryPairing(): void;
  connectingState(): ConnectingState | null;
  isOpen(fp: string): boolean;
  closeAll(): void;
}

export function createServerWindows(deps: ServerWindowsDeps): ServerWindows {
  const { keyring, discovery, ports, log } = deps;
  const now = deps.now ?? Date.now;
  const registry = new Map<string, OpenWindow>();
  const downloadWired = new WeakSet<SessionLike>();
  /** Run `p` in the background; a rejection is logged (message only), never an unhandled rejection. */
  const background = (p: Promise<unknown>, what: string): void => {
    p.catch((e: unknown) => log(`[server-windows] ${what} failed: ${e instanceof Error ? e.message : String(e)}`));
  };
  const pairingFactory = deps.startPairing ?? startPairing;
  const codePairingFactory = deps.startCodePairing ?? startCodePairing;

  // pairing state (one connecting window at a time; a knock session OR a code session)
  let connecting: ConnectingHandle | null = null;
  let session: PairingSession | null = null;
  let codeSession: CodePairingSession | null = null;
  /** Re-runs the current pairing (the Connecting window's "Pair again"). */
  let retry: (() => void) | null = null;
  let lastState: ConnectingState | null = null;

  const hostText = (r: HostRef) => `${r.host}:${r.port}`;

  /** The advert's other literals as pairing alternatives: plain hosts, locality order, ≤ 8, never the primary. */
  function alternativesOf(primary: HostRef, addresses: string[]): HostRef[] {
    const hosts = orderByLocality(addresses.filter((h) => isPlainHost(h) && h !== primary.host), deps.interfaces?.() ?? {});
    return hosts.slice(0, LITERALS_PER_NAME_CAP).map((host) => ({ scheme: "http" as const, host, port: primary.port }));
  }

  // ── host selection + probes ────────────────────────────────────────────────

  const localFp = (): string | "none" | undefined => (deps.discovery.localFp ? deps.discovery.localFp() : "none");
  const shortOr = (fp: string | undefined): string => (fp ? shortFingerprint(fp) : "invalid-signature");

  /** One identity challenge at `origin`, classified against the pin and this machine's own fingerprint. */
  async function probe(origin: string, pinFp: string): Promise<Probe> {
    const r: ProveResult = await deps.prove(origin).catch((): ProveResult => ({ refused: "challenge failed" }));
    if ("refused" in r && r.identityFailure !== true) return { kind: "unreachable" };
    switch (classifyProof(r, { pin: pinFp, localFp: localFp() })) {
      case "ok":
        return { kind: "ok" };
      case "self":
        return { kind: "self", proven: "proven" in r ? r.proven : "" };
      case "foreign":
        return { kind: "foreign", ...("proven" in r ? { proven: r.proven } : {}) };
      default:
        return { kind: "unverified" };
    }
  }

  /** Plain, valid http refs of one advert: its host name, then its addresses. */
  function advertRefs(adv: { host: string; port: number; addresses?: string[] }): HostRef[] {
    if (!isValidPort(adv.port)) return [];
    // mDNS is unauthenticated: a host that is not a plain name/address could rewrite the URL authority.
    return [adv.host, ...(adv.addresses ?? [])].filter(isPlainHost).map((host) => ({ scheme: "http" as const, host, port: adv.port }));
  }

  /** Order refs by `orderByLocality` of their hosts (stable; nothing dropped). */
  function orderRefs(refs: HostRef[]): HostRef[] {
    const order = orderByLocality(
      refs.map((r) => r.host),
      deps.interfaces?.() ?? {},
    );
    return refs.map((r, i) => ({ r, i, k: order.indexOf(r.host) })).sort((x, y) => x.k - y.k || x.i - y.i).map((x) => x.r);
  }

  /**
   * Candidates for a selection: stored refs, then discovered refs (locality never filters them), every
   * `http` hostname resolved to ≤ 8 address literals — each literal is proven separately, so the origin
   * that is used is the origin that proved the pin.
   */
  async function selectionCandidates(entry: KeyringEntryView): Promise<Candidate[]> {
    const expandOrdered = async (ref: HostRef): Promise<HostRef[]> => {
      const out = await expandRef(ref, deps.lookup);
      return out.length > 1 ? orderRefs(out) : out;
    };
    const stored = (await Promise.all(entry.lastHosts.map(expandOrdered))).flat();
    const discovered = (await Promise.all(discovery.advertsFor(entry.fingerprint).flatMap(advertRefs).map(expandOrdered))).flat();
    return buildCandidates(stored, orderRefs(discovered));
  }

  type PickResult = { host: Candidate; foreign: ForeignProof[] } | { failure: "unreachable" | "identity_mismatch"; foreign: ForeignProof[] };

  async function pickHost(entry: KeyringEntryView): Promise<PickResult> {
    const started = now();
    const candidates = await selectionCandidates(entry);
    const foreign: ForeignProof[] = [];
    const picked = await pickVerifiedHost(
      candidates,
      async (origin) => {
        const p = await probe(origin, entry.fingerprint);
        if (p.kind === "self") log(`[server-windows] candidate skipped host=${origin} fp=${shortOr(p.proven)} reason=self`);
        if (p.kind === "foreign") {
          foreign.push({ origin, ...(p.proven ? { proven: p.proven } : {}) });
          log(`[server-windows] foreign proof host=${origin} fp=${shortOr(p.proven)}`);
        }
        return p.kind === "ok";
      },
      Math.max(0, HOST_SELECTION_DEADLINE_MS - (now() - started)),
    );
    if (picked) return { host: picked, foreign };
    return { failure: foreign.length > 0 ? "identity_mismatch" : "unreachable", foreign };
  }

  // ── credential exchange ────────────────────────────────────────────────────

  async function exchange(ses: SessionLike, origin: string, bearer: string): Promise<ExchangeVerdict> {
    try {
      const res = await ses.fetch(`${origin}/api/device-session`, {
        method: "POST",
        redirect: "manual",
        headers: { Authorization: `Bearer ${bearer}` },
        signal: AbortSignal.timeout(EXCHANGE_TIMEOUT_MS),
      });
      let body: unknown;
      if (res.status === 403) body = await res.json().catch(() => undefined);
      return classifyExchange(res.status, body);
    } catch {
      return "transport";
    }
  }

  /** Credential refused: drop the bearer + cookie (state change only; no dialog). */
  async function unpair(fp: string, origin: string, ses: SessionLike, why: string): Promise<void> {
    log(`[server-windows] credential refused fp=${shortFingerprint(fp)} host=${origin} (${why})`);
    keyring.markNeedsPairing(fp);
    await ses.cookies.remove(`${origin}/api/`, DEVICE_COOKIE).catch(() => {});
  }

  /** The one main-owned dialog after a refusal: Pair again / Forget / Close. */
  async function offerRepair(fp: string, label: string): Promise<OpenResult | undefined> {
    const choice = await ports.askNeedsPairing(label);
    if (choice === "pair-again") return pairAgain(fp);
    if (choice === "forget") await forget(fp);
    return undefined;
  }

  // ── open ───────────────────────────────────────────────────────────────────

  /** Focus (restoring if minimized) an already-open window; true when there was one. */
  function focusExisting(fp: string): boolean {
    const existing = registry.get(fp);
    if (!existing || existing.win.isDestroyed()) return false;
    if (existing.state !== "live") {
      // A parked or blanked window shows no verified page: reopening must re-verify from scratch.
      existing.win.close();
      return false;
    }
    if (existing.win.isMinimized()) existing.win.restore();
    existing.win.focus();
    return true;
  }

  async function open(fp: string, opts: { notify?: boolean } = {}): Promise<OpenResult> {
    if (focusExisting(fp)) return { ok: true };
    const entry = keyring.get(fp);
    if (!entry) return { ok: false, reason: "unknown_server" };
    const bearer = keyring.bearerFor(fp);
    // D14: no usable credential ⇒ pairing instead of failing.
    if (entry.needsPairing || !bearer) return pairAgain(fp);

    const picked = await pickHost(entry);
    if ("failure" in picked) {
      const m = picked.foreign[0];
      if (m) {
        log(
          `[server-windows] identity mismatch at open fp=${shortFingerprint(entry.fingerprint)} expected=${shortFingerprint(entry.fingerprint)} proven=${shortOr(m.proven)} host=${m.origin}`,
        );
      }
      return failOpen(
        entry,
        picked.failure,
        picked.failure === "identity_mismatch"
          ? `The address answered with a different identity than the one pinned for ${entry.label}. Nothing was sent.`
          : `${entry.label} is unreachable, or answered with a different identity.`,
        opts,
      );
    }
    return loadVerified(entry, bearer, picked.host, opts);
  }

  function failOpen(entry: KeyringEntryView, reason: OpenFailure, message: string, opts: { notify?: boolean }): OpenResult {
    if (opts.notify) ports.notify(entry.label, message);
    return { ok: false, reason };
  }

  /** The host proved the pinned identity: exchange the bearer in the partition, then load its origin. */
  async function loadVerified(entry: KeyringEntryView, bearer: string, host: Candidate, opts: { notify?: boolean }): Promise<OpenResult> {
    const fp = entry.fingerprint;
    const origin = serverOrigin(host.ref);
    // The proving literal becomes the most recent host (a discovered address, or a literal a stored name resolved to).
    if (host.source === "discovered") keyring.heal(fp, { ...host.ref, source: "mdns" });
    else if (!entry.lastHosts.some((h) => h.scheme === host.ref.scheme && h.host === host.ref.host && h.port === host.ref.port)) {
      keyring.heal(fp, { ...host.ref, source: "saved" });
    }

    const partition = partitionFor(fp, entry.remembered);
    const ses = ports.sessionFor(partition);
    const verdict = await exchange(ses, origin, bearer);
    if (verdict === "refused") {
      await unpair(fp, origin, ses, "exchange refused at open");
      background(offerRepair(fp, entry.label), "re-pair offer");
      return { ok: false, reason: "needs_pairing" };
    }
    if (verdict === "transport") {
      return failOpen(entry, "unreachable", `${entry.label} is unreachable right now (the credential exchange failed). Nothing was changed.`, opts);
    }
    // Forgotten while the exchange was in flight: undo what it planted and load nothing.
    if (!keyring.has(fp)) {
      await ses.cookies.remove(`${origin}/api/`, DEVICE_COOKIE).catch(() => {});
      return { ok: false, reason: "unknown_server" };
    }
    // A concurrent open may have created the window while we were awaiting.
    if (focusExisting(fp)) return { ok: true };
    createWindow(entry, host.ref, origin, ses, partition);
    return { ok: true };
  }

  function createWindow(entry: KeyringEntryView, ref: HostRef, origin: string, ses: SessionLike, partition: string): void {
    const fp = entry.fingerprint;
    const saved = ports.bounds.get(fp);
    const win = ports.createWindow({
      title: composeTitle(entry.label, undefined),
      width: saved?.width ?? 1280,
      height: saved?.height ?? 800,
      ...(saved?.x !== undefined && saved?.y !== undefined ? { x: saved.x, y: saved.y } : {}),
      webPreferences: { partition, sandbox: true, contextIsolation: true, nodeIntegration: false, webviewTag: false },
    });
    const ow: OpenWindow = {
      fp,
      win,
      origin,
      host: ref,
      label: entry.label,
      pageTitle: "",
      unreachable: false,
      lastFocusCheckAt: now(),
      lastRecheckAt: null,
      rechecking: false,
      unpaired: false,
      state: "live",
      reselecting: false,
      cookiesCleared: false,
      detachApi: null,
      lastExternalAt: Number.NEGATIVE_INFINITY,
      interval: null,
      offResume: null,
    };
    registry.set(fp, ow);
    const wc = win.webContents;

    // Navigation: same-origin only; everything cancelled goes through the external allowlist.
    // A page can ask for external URLs without a gesture: hand at most one per second to the OS.
    const openExternalLimited = (href: string): void => {
      if (now() - ow.lastExternalAt < EXTERNAL_MIN_INTERVAL_MS) return;
      ow.lastExternalAt = now();
      ports.openExternal(href);
    };
    const guard = (event: { preventDefault(): void; url?: string; isMainFrame?: boolean }, url: string | undefined): void => {
      if (event.isMainFrame === false || !url) return;
      const decision = decideServerWindowNavigation(origin, url);
      if (decision === "allow") return;
      event.preventDefault();
      if (decision === "external") openExternalLimited(new URL(url).href);
    };
    wc.on("will-navigate", (event: { preventDefault(): void; url?: string; isMainFrame?: boolean }, url?: string) =>
      guard(event, event.url ?? url),
    );
    wc.on("will-redirect", (event: { preventDefault(): void; url?: string; isMainFrame?: boolean }, url?: string) =>
      guard(event, event.url ?? url),
    );
    wc.setWindowOpenHandler(({ url }) => {
      if (decideServerWindowNavigation(origin, url) !== "drop") {
        try {
          openExternalLimited(new URL(url).href);
        } catch {
          /* unparseable — dropped */
        }
      }
      return { action: "deny" };
    });

    // Cookie-paired marker: only on the server's own origin (old clients pick it up on reconnect).
    wc.on("dom-ready", () => {
      if (ow.win.isDestroyed() || registry.get(fp) !== ow) return;
      let pageOrigin: string;
      try {
        pageOrigin = new URL(wc.getURL()).origin;
      } catch {
        return;
      }
      if (pageOrigin !== origin) return;
      wc.executeJavaScript(MARK_COOKIE_PAIRED_JS).catch(() => {});
    });

    // Title: the page title is untrusted text.
    wc.on("page-title-updated", (event: { preventDefault(): void }, title: string) => {
      event.preventDefault();
      ow.pageTitle = title;
      applyTitle(ow);
    });

    // Permissions + downloads (per-partition session).
    ses.setPermissionRequestHandler((_wc, permission, cb) => cb(isServerWindowPermissionAllowed(permission)));
    ses.setPermissionCheckHandler?.((_wc, permission) => isServerWindowPermissionAllowed(permission));
    if (!downloadWired.has(ses)) {
      // The session outlives its windows: wire the save-dialog title once, from the live label.
      downloadWired.add(ses);
      ses.on("will-download", (_e, item) => {
        const live = keyring.get(fp)?.label ?? entry.label;
        item.setSaveDialogOptions({ title: `Save file from ${sanitizeDisplayName(live, "dashboard")}` });
      });
    }

    // Runtime credential re-check: 401/403 only TRIGGERS the exchange (D7).
    const apiFilter = { urls: [`${origin}/api/*`] };
    ses.webRequest.onCompleted(apiFilter, (details) => {
      if (ow.win.isDestroyed() || registry.get(fp) !== ow) return; // a closed window never re-checks
      if (details.statusCode === 401 || details.statusCode === 403) background(recheck(ow, ses), "credential re-check");
    });
    // The session outlives its windows: the listener must go with its window (one listener per session).
    ow.detachApi = () => ses.webRequest.onCompleted(apiFilter, null);

    // Identity re-verification (D12).
    ow.interval = setInterval(() => background(reverify(ow), "re-verification"), REVERIFY_INTERVAL_MS);
    win.on("focus", () => {
      if (now() - ow.lastFocusCheckAt >= FOCUS_REVERIFY_MIN_MS) {
        ow.lastFocusCheckAt = now();
        background(reverify(ow), "re-verification");
      }
    });
    ow.offResume = ports.onResume(() => background(reverify(ow), "re-verification"));

    win.on("close", () => {
      if (!keyring.has(fp)) return; // forgotten: never write its bounds back
      try {
        ports.bounds.set(fp, win.getBounds());
      } catch {
        /* window already gone */
      }
    });
    win.on("closed", () => detach(ow));

    wc.loadURL(`${origin}/`).catch(() => {});
  }

  /** Stop a window's re-verification triggers. */
  function stopTimers(ow: OpenWindow): void {
    if (ow.interval) clearInterval(ow.interval);
    ow.interval = null;
    ow.offResume?.();
    ow.offResume = null;
  }

  /** Stop a window's timers and unsubscribe its session listener; idempotent, never touches a newer window. */
  function detach(ow: OpenWindow): void {
    stopTimers(ow);
    if (registry.get(ow.fp) === ow) {
      registry.delete(ow.fp);
      ow.detachApi?.();
    }
  }

  function applyTitle(ow: OpenWindow): void {
    if (ow.win.isDestroyed()) return;
    ow.win.setTitle(composeTitle(ow.label, ow.pageTitle, ow.unreachable ? "not reachable" : undefined));
  }

  /** True when this 401/403 may trigger an exchange re-run (rate limit, one at a time, window still live). */
  function takeRecheckSlot(ow: OpenWindow): boolean {
    if (ow.rechecking || ow.unpaired || ow.reselecting || ow.state !== "live") return false;
    if (ow.lastRecheckAt !== null && now() - ow.lastRecheckAt < RECHECK_MIN_INTERVAL_MS) return false;
    ow.lastRecheckAt = now();
    ow.rechecking = true;
    return true;
  }

  async function recheck(ow: OpenWindow, ses: SessionLike): Promise<void> {
    if (!takeRecheckSlot(ow)) return;
    try {
      const bearer = keyring.bearerFor(ow.fp);
      if (!bearer) return;
      // The stored credential only goes to an address that still proves the pinned identity.
      const p = await probe(ow.origin, ow.fp);
      if (ow.win.isDestroyed() || ow.state !== "live") return;
      if (p.kind === "self" || p.kind === "foreign") return reselect(ow, p);
      if (p.kind !== "ok") return;
      // "ok": a tier refusal — change nothing (no reload). "transport": try again after the window.
      if ((await exchange(ses, ow.origin, bearer)) !== "refused") return;
      ow.unpaired = true;
      await unpair(ow.fp, ow.origin, ses, "exchange refused while open");
      background(offerRepair(ow.fp, ow.label), "re-pair offer");
    } finally {
      ow.rechecking = false;
    }
  }

  /** Flag (or clear) the "not reachable" title suffix. */
  function setUnreachable(ow: OpenWindow, unreachable: boolean): void {
    if (ow.unreachable === unreachable) return;
    ow.unreachable = unreachable;
    applyTitle(ow);
  }

  /** Remove every cookie of the partition (it holds only this server's); awaited. False (logged) on failure. */
  async function clearCookies(ow: OpenWindow): Promise<boolean> {
    try {
      await ow.win.webContents.session.clearStorageData({ storages: ["cookies"] });
      ow.cookiesCleared = true;
      return true;
    } catch (e) {
      log(`[server-windows] cookie removal failed fp=${shortFingerprint(ow.fp)}: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    }
  }

  /** A `foreign` proof and no proving host: blank, drop the cookies, report once, stop the timers. */
  async function blankAfterMismatch(ow: OpenWindow, proven: string | undefined): Promise<void> {
    if (ow.state === "blanked") return;
    // One report, then silence: a persistent impostor must not re-prompt every minute.
    ow.state = "blanked";
    stopTimers(ow);
    ow.detachApi?.(); // it stays registered: a reopen replaces it
    log(
      `[server-windows] identity mismatch while open fp=${shortFingerprint(ow.fp)} expected=${shortFingerprint(ow.fp)} proven=${shortOr(proven)} host=${hostText(ow.host)}`,
    );
    await ow.win.webContents.loadURL("about:blank").catch(() => {});
    if (!ow.cookiesCleared) await clearCookies(ow);
    ports.notify(ow.label, `The address of ${ow.label} now answers with a different identity. The window was blanked and its credential removed.`);
  }

  /** Close `ow` and open the entry again at the literal that just proved the pin (no re-resolution). */
  async function replaceWindow(ow: OpenWindow, host: Candidate): Promise<void> {
    const entry = keyring.get(ow.fp);
    const bearer = keyring.bearerFor(ow.fp);
    if (!entry || !bearer) return;
    log(`[server-windows] host moved fp=${shortFingerprint(ow.fp)} from=${ow.origin} to=${serverOrigin(host.ref)}`);
    detach(ow);
    if (!ow.win.isDestroyed()) ow.win.close();
    await loadVerified(entry, bearer, host, { notify: true });
  }

  /** Re-run host selection for a window whose host stopped proving the pin; act on the outcome (D4 step 3). */
  async function selectAndAct(ow: OpenWindow, seen: ForeignProof[]): Promise<void> {
    const entry = keyring.get(ow.fp);
    if (!entry) return;
    const picked = await pickHost(entry);
    if (ow.win.isDestroyed() || registry.get(ow.fp) !== ow || ow.state === "blanked") return;
    const foreign = [...seen, ...picked.foreign];
    if ("host" in picked) return moveOrStay(ow, picked.host, foreign);
    if (foreign.length > 0) return blankAfterMismatch(ow, foreign[0]!.proven);
    // Only this machine (or nothing) answered: stay (blank when parked), say so, retry at the next trigger.
    setUnreachable(ow, true);
  }

  /** A host proved the pin: keep a live window already there, otherwise replace the window. */
  async function moveOrStay(ow: OpenWindow, host: Candidate, foreign: ForeignProof[]): Promise<void> {
    if (serverOrigin(host.ref) === ow.origin && ow.state === "live") return setUnreachable(ow, false);
    if (foreign.length > 0) log(`[server-windows] host moved past a foreign proof fp=${shortFingerprint(ow.fp)} host=${foreign[0]!.origin}`);
    await replaceWindow(ow, host);
  }

  /** Log a non-pin proof at the window's own origin; the `foreign` ones are what a mismatch report rests on. */
  function noteNonOk(ow: OpenWindow, p: { kind: "self"; proven: string } | { kind: "foreign"; proven?: string }): ForeignProof[] {
    if (p.kind === "self") {
      log(`[server-windows] candidate skipped host=${ow.origin} fp=${shortOr(p.proven)} reason=self`);
      return [];
    }
    log(`[server-windows] foreign proof host=${ow.origin} fp=${shortOr(p.proven)}`);
    return [{ origin: ow.origin, ...(p.proven ? { proven: p.proven } : {}) }];
  }

  /** Content of an unproven origin must not stay on screen, and its cookies must not outlive it. False ⇒ load nothing this cycle. */
  async function parkAndClear(ow: OpenWindow): Promise<boolean> {
    ow.state = "parked";
    await ow.win.webContents.loadURL("about:blank").catch(() => {});
    return !ow.win.isDestroyed() && (await clearCookies(ow));
  }

  /** The one transition behind both re-verification paths (D4): `p` is the non-ok result at the window's origin. */
  async function reselect(ow: OpenWindow, p: Exclude<Probe, { kind: "ok" }>): Promise<void> {
    if (ow.reselecting || ow.state === "blanked") return;
    ow.reselecting = true;
    try {
      let seen: ForeignProof[] = [];
      if (p.kind === "self" || p.kind === "foreign") {
        seen = noteNonOk(ow, p);
        if (!(await parkAndClear(ow))) return; // stay parked; the next trigger retries
      } else {
        // Transport failure (or an unverifiable proof): keep the page, flag the title.
        setUnreachable(ow, true);
      }
      await selectAndAct(ow, seen);
    } finally {
      ow.reselecting = false;
    }
  }

  async function reverify(ow: OpenWindow): Promise<void> {
    if (ow.win.isDestroyed() || ow.state === "blanked" || ow.reselecting) return;
    if (ow.state === "parked") {
      // Nothing is loaded: retry a failed cookie removal first, then look for a host that proves the pin.
      ow.reselecting = true;
      try {
        if (!ow.cookiesCleared && !(await clearCookies(ow))) return;
        await selectAndAct(ow, []);
      } finally {
        ow.reselecting = false;
      }
      return;
    }
    const p = await probe(ow.origin, ow.fp);
    if (ow.win.isDestroyed() || ow.state !== "live") return;
    if (p.kind === "ok") return setUnreachable(ow, false);
    await reselect(ow, p);
  }

  // ── pairing hand-off ───────────────────────────────────────────────────────

  function pushState(state: ConnectingState): void {
    lastState = state;
    if (connecting?.isOpen()) connecting.push(state);
  }

  /** Supersede whatever pairing is active and show `initial` in the (re)used Connecting window. */
  function beginPairing(initial: ConnectingState): void {
    session?.stop();
    codeSession?.stop();
    session = null;
    codeSession = null;
    lastState = initial;
    if (connecting?.isOpen()) {
      connecting.focus();
      connecting.push(initial);
    } else {
      connecting = ports.openConnectingWindow(initial);
    }
  }

  /** On approval: close the Connecting window and open the server's window. */
  function watchPairing(isCurrent: () => boolean, done: Promise<PairingResult>): void {
    done
      .then((res: PairingResult) => {
        if (!isCurrent()) return; // superseded
        if (res.status === "approved") {
          connecting?.close();
          connecting = null;
          background(open(res.fingerprint, { notify: true }), "open after pairing");
        }
      })
      .catch((e: unknown) => log(`[server-windows] pairing ended abnormally: ${e instanceof Error ? e.message : String(e)}`));
  }

  function startPairingFor(target: PairingTarget): OpenResult {
    retry = () => void startPairingFor(target);
    beginPairing({
      label: target.label,
      host: hostText(target.ref),
      unencrypted: target.ref.scheme === "http",
      phase: "proving",
      deviceName: target.deviceName,
    });
    const s = pairingFactory(target, {
      prove: deps.prove,
      keyring,
      log,
      onState: pushState,
      localFp,
      ...(deps.lookup ? { lookup: deps.lookup } : {}),
      ...(deps.pairingHooks ?? {}),
    });
    session = s;
    watchPairing(() => session === s, s.done);
    return { ok: true, pairing: true };
  }

  /** "Pair with code": the Connecting window asks for the pasted text; main does the rest. */
  function startCodePairingFor(fp: string): OpenResult {
    const label = codeLabel(fp);
    retry = () => void startCodePairingFor(fp);
    const deviceName = ports.deviceName();
    beginPairing({ mode: "code", label, host: "pairing code", unencrypted: false, phase: "code", deviceName });
    const s = codePairingFactory(
      { fingerprint: fp, label, deviceName },
      { prove: deps.prove, keyring, log, onState: pushState, ...(deps.pairingHooks ?? {}) },
    );
    codeSession = s;
    watchPairing(() => codeSession === s, s.done);
    return { ok: true, pairing: true };
  }

  /** Sanitised label for a fingerprint the page named: keyring label, else the discovered name, else the short fingerprint. */
  function codeLabel(fp: string): string {
    const fallback = `server ${shortFingerprint(fp)}`;
    const known = keyring.get(fp)?.label ?? discovery.list().find((d) => d.fingerprint === fp)?.name;
    return sanitizeDisplayName(known, fallback);
  }

  function pairWithCode(fp: string): Promise<OpenResult> {
    return Promise.resolve(startCodePairingFor(fp));
  }

  function pairAgain(fp: string): Promise<OpenResult> {
    const entry = keyring.get(fp);
    if (!entry) return Promise.resolve({ ok: false, reason: "unknown_server" });
    const advert = discovery.advertsFor(fp)[0];
    // A fresh advert for the pinned identity beats a stored host the server may have moved away from.
    const ref = advert ? ({ scheme: "http", host: advert.host, port: advert.port } as HostRef) : entry.lastHosts[0];
    if (!ref) return Promise.resolve({ ok: false, reason: "unreachable" });
    return Promise.resolve(
      startPairingFor({
        label: entry.label,
        ref,
        ...(advert ? { alternatives: alternativesOf(ref, advert.addresses ?? []) } : {}),
        pinnedFp: fp,
        ...(advert ? { source: "mdns" as const } : {}),
        ...(advert?.fingerprint ? { advertFp: advert.fingerprint } : {}),
        deviceName: ports.deviceName(),
      }),
    );
  }

  async function connectDiscovered(key: string): Promise<OpenResult> {
    const entry = discovery.list().find((d) => d.key === key);
    if (!entry) return { ok: false, reason: "unknown_server" };
    if (entry.fingerprint && keyring.has(entry.fingerprint) && !keyring.get(entry.fingerprint)?.needsPairing) {
      return open(entry.fingerprint, { notify: true });
    }
    const primary: HostRef = { scheme: "http", host: entry.host, port: entry.port };
    return startPairingFor({
      label: entry.name,
      ref: primary,
      alternatives: alternativesOf(primary, entry.addresses),
      source: "mdns",
      ...(entry.fingerprint && keyring.has(entry.fingerprint) ? { pinnedFp: entry.fingerprint } : {}),
      ...(entry.fingerprint ? { advertFp: entry.fingerprint } : {}),
      deviceName: ports.deviceName(),
    });
  }

  async function connectManual(raw: string): Promise<OpenResult> {
    const ref = parseManualUrl(raw);
    if (!ref) return { ok: false, reason: "invalid" };
    const known = keyring.findByHost(ref.host, ref.port);
    if (known && !known.needsPairing) return open(known.fingerprint, { notify: true });
    return startPairingFor({
      label: sanitizeDisplayName(ref.host, ref.host),
      ref,
      source: "saved",
      ...(known ? { pinnedFp: known.fingerprint } : {}),
      deviceName: ports.deviceName(),
    });
  }

  async function openByHostPort(host: string, port: number): Promise<OpenResult> {
    // Known hosts only: a renderer can never aim the app at an arbitrary address.
    const kr = keyring.findByHost(host, port);
    if (kr) return open(kr.fingerprint, { notify: true });
    const d = discovery.list().find((e) => e.port === port && (e.host === host || e.addresses.includes(host)));
    if (!d) return { ok: false, reason: "unknown_server" };
    return connectDiscovered(d.key);
  }

  // ── forget ─────────────────────────────────────────────────────────────────

  async function forget(fp: string): Promise<{ ok: boolean; message: string }> {
    const entry = keyring.get(fp);
    if (!entry) return { ok: false, message: "That server is not paired." };
    // Remove first: the window's `close` handler then sees a forgotten fp and does not re-save its bounds.
    keyring.remove(fp);
    ports.bounds.remove(fp);
    const ow = registry.get(fp);
    if (ow && !ow.win.isDestroyed()) ow.win.close();
    // Both variants: the persistent partition and the in-memory one.
    await Promise.allSettled([
      ports.sessionFor(partitionFor(fp, true)).clearStorageData(),
      ports.sessionFor(partitionFor(fp, false)).clearStorageData(),
    ]);
    log(`[server-windows] forgot fp=${shortFingerprint(fp)}`);
    return {
      ok: true,
      message: `${entry.label} was forgotten on this computer. This device stays listed on ${entry.label} until its operator revokes it there.`,
    };
  }

  return {
    open,
    openByHostPort,
    connectDiscovered,
    connectManual,
    pairAgain,
    pairWithCode,
    submitCode: (text) => codeSession?.submitCode(text),
    forget,
    sendRequest: (name) => session?.send(name),
    stopWaiting: () => {
      session?.stop();
      codeSession?.stop();
    },
    retryPairing() {
      retry?.();
    },
    connectingState: () => lastState,
    isOpen: (fp) => {
      const ow = registry.get(fp);
      return !!ow && !ow.win.isDestroyed();
    },
    closeAll() {
      session?.stop();
      codeSession?.stop();
      for (const ow of registry.values()) {
        if (!ow.win.isDestroyed()) ow.win.close();
      }
    },
  };
}

/**
 * Parse a manually entered dashboard URL: `http`/`https` only, host not loopback;
 * only scheme + host + port are used (the path/query are dropped).
 */
export function parseManualUrl(raw: unknown): HostRef | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 2048) return null;
  const text = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw.trim()) ? raw.trim() : `http://${raw.trim()}`;
  let u: URL;
  try {
    u = new URL(text);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (!host || host.length > 253) return null;
  if (isLoopbackHost(host)) return null;
  const port = u.port ? Number(u.port) : u.protocol === "https:" ? 443 : 80;
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  return { scheme: u.protocol === "https:" ? "https" : "http", host, port };
}

/** localhost, 127.0.0.0/8, ::1, ::ffff:127.x, 0.0.0.0. */
export function isLoopbackHost(host: string): boolean {
  // `localhost.` / `127.0.0.1.` (rooted names) resolve to loopback too.
  const h = host.toLowerCase().replace(/\.+$/, "");
  if (h === "localhost" || h.endsWith(".localhost") || h === "::1" || h === "::" || h === "0.0.0.0") return true;
  if (/^127\.\d+\.\d+\.\d+$/.test(h)) return true;
  return /^::ffff:(7f[0-9a-f]{2}:[0-9a-f]{1,4}|127\.\d+\.\d+\.\d+)$/.test(h);
}
