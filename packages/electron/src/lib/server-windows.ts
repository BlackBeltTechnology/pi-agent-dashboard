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
 * See change: add-electron-server-windows (D5–D8, D12, D14).
 */
import type { ProveFn } from "@blackbelt-technology/pi-dashboard-shared/pairing-knock-client.js";
import { decideServerWindowNavigation } from "./link-handling.js";
import {
  type ConnectingState,
  type PairingResult,
  type PairingSession,
  type PairingTarget,
  startPairing,
} from "./pairing-client.js";
import {
  buildCandidates,
  type Candidate,
  type HostRef,
  isPlainHost,
  isValidPort,
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
  clearStorageData(): Promise<void>;
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
  discovery: Pick<ServerDiscovery, "advertsFor" | "raw" | "list">;
  ports: ServerWindowPorts;
  prove: ProveFn;
  log: (line: string) => void;
  now?: () => number;
  /** Test seam: pairing client factory. */
  startPairing?: typeof startPairing;
  /** Pairing poll hooks (tests). */
  pairingHooks?: { now?: () => number; sleep?: (ms: number) => Promise<void>; pollIntervalMs?: number };
}

type OpenFailure = "unreachable" | "identity_mismatch" | "needs_pairing" | "unknown_server" | "invalid";
export type OpenResult = { ok: true; pairing?: true } | { ok: false; reason: OpenFailure };

/** Why a re-verification/host probe did not accept. */
type Probe = { kind: "ok" } | { kind: "mismatch"; proven?: string } | { kind: "unreachable" };

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
  /** Identity mismatch proven: window blanked, timers stopped; a reopen replaces it. */
  blanked: boolean;
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

  // pairing state (one connecting window at a time)
  let connecting: ConnectingHandle | null = null;
  let session: PairingSession | null = null;
  let lastTarget: PairingTarget | null = null;
  let lastState: ConnectingState | null = null;

  const hostText = (r: HostRef) => `${r.host}:${r.port}`;

  // ── host selection + probes ────────────────────────────────────────────────

  async function probe(origin: string, pinFp: string): Promise<Probe> {
    const r = await deps.prove(origin).catch(() => ({ refused: "challenge failed" }) as const);
    if ("proven" in r) return r.proven === pinFp ? { kind: "ok" } : { kind: "mismatch", proven: r.proven };
    if ("identityFailure" in r && r.identityFailure) return { kind: "mismatch" };
    return { kind: "unreachable" };
  }

  function discoveredRefs(fp: string): HostRef[] {
    const refs: HostRef[] = [];
    for (const adv of discovery.advertsFor(fp)) {
      if (!isValidPort(adv.port)) continue;
      // mDNS is unauthenticated: a host that is not a plain name/address could rewrite the URL authority.
      for (const host of [adv.host, ...(adv.addresses ?? [])]) {
        if (isPlainHost(host)) refs.push({ scheme: "http", host, port: adv.port });
      }
    }
    return refs;
  }

  async function pickHost(entry: KeyringEntryView): Promise<{ host: Candidate } | { failure: "unreachable" | "identity_mismatch" }> {
    const candidates = buildCandidates(entry.lastHosts, discoveredRefs(entry.fingerprint));
    const mismatches: Array<{ origin: string; proven?: string }> = [];
    const picked = await pickVerifiedHost(candidates, async (origin) => {
      const p = await probe(origin, entry.fingerprint);
      if (p.kind === "mismatch") mismatches.push({ origin, ...(p.proven ? { proven: p.proven } : {}) });
      return p.kind === "ok";
    });
    if (picked) return { host: picked };
    if (mismatches.length > 0) {
      const m = mismatches[0]!;
      log(
        `[server-windows] identity mismatch at open fp=${shortFingerprint(entry.fingerprint)} expected=${shortFingerprint(entry.fingerprint)} proven=${m.proven ? shortFingerprint(m.proven) : "invalid-signature"} host=${m.origin}`,
      );
      return { failure: "identity_mismatch" };
    }
    return { failure: "unreachable" };
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
    if (existing.blanked) {
      // A blanked window proved an identity mismatch: reopening must re-verify from scratch.
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
    if (host.source === "discovered") keyring.heal(fp, host.ref);

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
      blanked: false,
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
    win.on("closed", () => {
      if (ow.interval) clearInterval(ow.interval);
      ow.offResume?.();
      // The partition session outlives the window: drop its request listener so it cannot fire later.
      if (registry.get(fp) === ow) {
        registry.delete(fp);
        ses.webRequest.onCompleted(apiFilter, null);
      }
    });

    wc.loadURL(`${origin}/`).catch(() => {});
  }

  function applyTitle(ow: OpenWindow): void {
    if (ow.win.isDestroyed()) return;
    ow.win.setTitle(composeTitle(ow.label, ow.pageTitle, ow.unreachable ? "not reachable" : undefined));
  }

  /** True when this 401/403 may trigger an exchange re-run (rate limit, one at a time, window still live). */
  function takeRecheckSlot(ow: OpenWindow): boolean {
    if (ow.rechecking || ow.unpaired || ow.blanked) return false;
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
      if (ow.win.isDestroyed() || ow.blanked) return;
      if (p.kind === "mismatch") return blankAfterMismatch(ow, p.proven);
      if (p.kind === "unreachable") return;
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

  /** Proven mismatch: the host no longer belongs to the pinned identity — blank, drop the cookie, report. */
  async function blankAfterMismatch(ow: OpenWindow, proven: string | undefined): Promise<void> {
    if (ow.blanked) return;
    // One report, then silence: a persistent impostor must not re-prompt every minute.
    ow.blanked = true;
    if (ow.interval) clearInterval(ow.interval);
    ow.interval = null;
    ow.offResume?.();
    ow.offResume = null;
    log(
      `[server-windows] identity mismatch while open fp=${shortFingerprint(ow.fp)} expected=${shortFingerprint(ow.fp)} proven=${proven ? shortFingerprint(proven) : "invalid-signature"} host=${hostText(ow.host)}`,
    );
    await ow.win.webContents.loadURL("about:blank").catch(() => {});
    await ow.win.webContents.session.cookies.remove(`${ow.origin}/api/`, DEVICE_COOKIE).catch(() => {});
    ports.notify(ow.label, `The address of ${ow.label} now answers with a different identity. The window was blanked and its credential removed.`);
  }

  async function reverify(ow: OpenWindow): Promise<void> {
    if (ow.win.isDestroyed() || ow.blanked) return;
    const p = await probe(ow.origin, ow.fp);
    if (ow.win.isDestroyed() || ow.blanked) return;
    // A rebooting server or a roaming laptop is not an attack: keep the page, flag the title.
    if (p.kind !== "mismatch") return setUnreachable(ow, p.kind === "unreachable");
    await blankAfterMismatch(ow, p.proven);
  }

  // ── pairing hand-off ───────────────────────────────────────────────────────

  function pushState(state: ConnectingState): void {
    lastState = state;
    if (connecting?.isOpen()) connecting.push(state);
  }

  function startPairingFor(target: PairingTarget): OpenResult {
    session?.stop();
    lastTarget = target;
    const initial: ConnectingState = {
      label: target.label,
      host: hostText(target.ref),
      unencrypted: target.ref.scheme === "http",
      phase: "proving",
      deviceName: target.deviceName,
    };
    lastState = initial;
    if (connecting?.isOpen()) {
      connecting.focus();
      connecting.push(initial);
    } else {
      connecting = ports.openConnectingWindow(initial);
    }
    const s = pairingFactory(target, {
      prove: deps.prove,
      keyring,
      log,
      onState: pushState,
      ...(deps.pairingHooks ?? {}),
    });
    session = s;
    s.done
      .then((res: PairingResult) => {
        if (session !== s) return; // superseded
        if (res.status === "approved") {
          connecting?.close();
          connecting = null;
          background(open(res.fingerprint, { notify: true }), "open after pairing");
        }
      })
      .catch((e: unknown) => log(`[server-windows] pairing ended abnormally: ${e instanceof Error ? e.message : String(e)}`));
    return { ok: true, pairing: true };
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
        pinnedFp: fp,
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
    return startPairingFor({
      label: entry.name,
      ref: { scheme: "http", host: entry.host, port: entry.port },
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
    forget,
    sendRequest: (name) => session?.send(name),
    stopWaiting: () => session?.stop(),
    retryPairing() {
      if (lastTarget) startPairingFor(lastTarget);
    },
    connectingState: () => lastState,
    isOpen: (fp) => {
      const ow = registry.get(fp);
      return !!ow && !ow.win.isDestroyed();
    },
    closeAll() {
      session?.stop();
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
