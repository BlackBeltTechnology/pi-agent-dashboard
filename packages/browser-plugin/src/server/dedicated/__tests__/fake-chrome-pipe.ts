/**
 * `FakeChromePipe` — a scripted browser-level CDP endpoint standing in for a
 * `DedicatedChrome` pipe (change: add-dedicated-agent-browser, test-plan #E7–#E13
 * #F1–#F5 #I1). It implements the `PipeLike` surface (`send` / `onMessage` /
 * `onExit` / `touch`) and models just enough of Chrome's browser target:
 * targets, flattened sessions, `Target.setDiscoverTargets`, browser-level
 * `Target.setAutoAttach` (with `waitForDebuggerOnStart` pausing new targets),
 * `Target.createTarget` / `attachToTarget` / `detachFromTarget` / `closeTarget`
 * and a handful of Playwright-handshake page commands.
 *
 * Like Chrome, events caused by a command are emitted BEFORE its reply.
 * Delivery to listeners is asynchronous (microtask) so reentrancy behaves like a
 * real pipe; `await pipe.flush()` drains it.
 *
 * Reusable: the later integration wave imports this too. Exported helpers:
 * `addTarget`, `navigate`, `closeTarget`, `emit`, `emitSession`, `attachChild`,
 * `sessionOf`, `commands`, `exit`.
 */
import type { ChromeExitInfo } from "../chrome-process.js";
import type { PipeLike } from "../pipe-call.js";

export interface FakeTargetInfo {
  targetId: string;
  type: string;
  title: string;
  url: string;
  attached: boolean;
  canAccessOpener: boolean;
  browserContextId?: string;
  openerId?: string;
  parentFrameId?: string;
}

export interface WireCommand {
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
  sessionId?: string;
}

export interface AddTargetOptions {
  targetId?: string;
  type?: string;
  url?: string;
  title?: string;
  openerId?: string;
  parentFrameId?: string;
  browserContextId?: string;
}

const FRAME = (id: string, url: string, loaderId: string) => ({
  id,
  loaderId,
  url,
  domainAndRegistry: "",
  securityOrigin: "",
  mimeType: "text/html",
  secureContextType: "Secure",
  crossOriginIsolatedContextType: "NotIsolated",
  gatedAPIFeatures: [],
});

export class FakeChromePipe implements PipeLike {
  /** Every command written, parsed (`JSON` round-tripped like the wire). */
  readonly written: WireCommand[] = [];
  readonly targets = new Map<string, { info: FakeTargetInfo; loaderId: string }>();
  readonly sessionTarget = new Map<string, string>();
  /** Sessions currently paused by `waitForDebuggerOnStart`. */
  readonly waiting = new Set<string>();
  /** Sessions the client resumed (`Runtime.runIfWaitingForDebugger`). */
  readonly resumed = new Set<string>();
  /** Sessions with a running screencast. */
  readonly screencasting = new Set<string>();
  autoAttach = { on: false, wait: false };
  discover = false;
  touched = 0;
  /** Replace a reply: return `undefined` for the default, `{ error }` for a CDP error. */
  respond?: (cmd: WireCommand) => unknown;

  private msgListeners = new Set<(msg: unknown) => void>();
  private exitListeners = new Set<(info: ChromeExitInfo) => void>();
  private outbox: unknown[] = [];
  private draining = false;
  private targetSeq = 0;
  private sessionSeq = 0;
  private contextSeq = 0;
  private exited = false;

  constructor() {
    this.addTarget({ targetId: "BLANK0", url: "about:blank" });
  }

  // ── PipeLike ──
  send(msg: object): void {
    if (this.exited) throw new Error("pipe closed");
    const cmd = JSON.parse(JSON.stringify(msg)) as WireCommand;
    this.written.push(cmd);
    this.handle(cmd);
  }

  onMessage(cb: (msg: unknown) => void): () => void {
    this.msgListeners.add(cb);
    return () => this.msgListeners.delete(cb);
  }

  onExit(cb: (info: ChromeExitInfo) => void): () => void {
    this.exitListeners.add(cb);
    return () => this.exitListeners.delete(cb);
  }

  touch(): void {
    this.touched += 1;
  }

  // ── Test API ──
  /** Commands written, optionally only `method`. */
  commands(method?: string): WireCommand[] {
    return method ? this.written.filter((c) => c.method === method) : this.written;
  }

  /** Drain the async outbox. */
  async flush(times = 6): Promise<void> {
    for (let i = 0; i < times; i++) await new Promise((r) => setImmediate(r));
  }

  /** A new target appears (user opened a tab, a popup…): discovery + auto-attach events fire. */
  addTarget(opts: AddTargetOptions = {}): string {
    const targetId = opts.targetId ?? `T${++this.targetSeq}`;
    const info: FakeTargetInfo = {
      targetId,
      type: opts.type ?? "page",
      title: opts.title ?? "",
      url: opts.url ?? "about:blank",
      attached: false,
      canAccessOpener: false,
      browserContextId: opts.browserContextId ?? "ctx-default",
      ...(opts.openerId ? { openerId: opts.openerId } : {}),
      ...(opts.parentFrameId ? { parentFrameId: opts.parentFrameId } : {}),
    };
    this.targets.set(targetId, { info, loaderId: "L0" });
    if (this.discover) this.emit({ method: "Target.targetCreated", params: { targetInfo: { ...info } } });
    if (this.autoAttach.on) this.attach(targetId, this.autoAttach.wait);
    return targetId;
  }

  /** The target navigated: `targetInfoChanged` when discovery is on. */
  navigate(targetId: string, url: string): void {
    const t = this.targets.get(targetId);
    if (!t) throw new Error(`no target ${targetId}`);
    t.info.url = url;
    if (this.discover) this.emit({ method: "Target.targetInfoChanged", params: { targetInfo: { ...t.info } } });
  }

  closeTarget(targetId: string): void {
    for (const [sid, tid] of [...this.sessionTarget]) {
      if (tid !== targetId) continue;
      this.sessionTarget.delete(sid);
      this.waiting.delete(sid);
      this.emit({ method: "Target.detachedFromTarget", params: { sessionId: sid, targetId } });
    }
    this.targets.delete(targetId);
    if (this.discover) this.emit({ method: "Target.targetDestroyed", params: { targetId } });
  }

  /** A raw browser-level event from Chrome. */
  emit(msg: object): void {
    this.outbox.push(msg);
    if (this.draining) return;
    this.draining = true;
    queueMicrotask(() => {
      this.draining = false;
      const batch = this.outbox;
      this.outbox = [];
      for (const m of batch) for (const l of [...this.msgListeners]) l(JSON.parse(JSON.stringify(m)));
    });
  }

  /** A raw event on a session. */
  emitSession(sessionId: string, method: string, params: object = {}): void {
    this.emit({ sessionId, method, params });
  }

  /** A child target (iframe/worker) attaches under `parentSessionId`. */
  attachChild(parentSessionId: string, info: Partial<FakeTargetInfo> & { targetId: string }, waitingForDebugger = false): string {
    const sessionId = `S${++this.sessionSeq}`;
    this.sessionTarget.set(sessionId, info.targetId);
    if (waitingForDebugger) this.waiting.add(sessionId);
    this.emit({
      sessionId: parentSessionId,
      method: "Target.attachedToTarget",
      params: {
        sessionId,
        waitingForDebugger,
        targetInfo: { type: "iframe", title: "", url: "https://frame.test/", attached: true, canAccessOpener: false, ...info },
      },
    });
    return sessionId;
  }

  /** The (first) session attached to a target, if any. */
  sessionOf(targetId: string): string | undefined {
    for (const [sid, tid] of this.sessionTarget) if (tid === targetId) return sid;
    return undefined;
  }

  /** Chrome exits (pipe EOF + process exit). */
  exit(info: Partial<ChromeExitInfo> = {}): void {
    this.exited = true;
    const full: ChromeExitInfo = { code: 0, signal: null, expected: false, reason: "exit", ...info };
    for (const l of [...this.exitListeners]) l(full);
  }

  // ── Chrome model ──
  private attach(targetId: string, waiting: boolean): string {
    const t = this.targets.get(targetId);
    if (!t) throw new Error(`no target ${targetId}`);
    const sessionId = `S${++this.sessionSeq}`;
    this.sessionTarget.set(sessionId, targetId);
    if (waiting) this.waiting.add(sessionId);
    t.info.attached = true;
    this.emit({
      method: "Target.attachedToTarget",
      params: { sessionId, targetInfo: { ...t.info, attached: true }, waitingForDebugger: waiting },
    });
    return sessionId;
  }

  private reply(cmd: WireCommand, result: unknown): void {
    this.emit({ id: cmd.id, ...(cmd.sessionId ? { sessionId: cmd.sessionId } : {}), result });
  }

  private fail(cmd: WireCommand, message: string, code = -32000): void {
    this.emit({ id: cmd.id, ...(cmd.sessionId ? { sessionId: cmd.sessionId } : {}), error: { code, message } });
  }

  private handle(cmd: WireCommand): void {
    const override = this.respond?.(cmd);
    if (override !== undefined) {
      const e = (override as { error?: { code?: number; message?: string } }).error;
      if (e) this.fail(cmd, e.message ?? "error", e.code ?? -32000);
      else this.reply(cmd, override);
      return;
    }
    const p = cmd.params ?? {};
    const method = cmd.method ?? "";
    if (cmd.sessionId && !this.sessionTarget.has(cmd.sessionId)) {
      this.fail(cmd, "Session with given id not found.", -32001);
      return;
    }
    switch (method) {
      case "Browser.getVersion":
        this.reply(cmd, {
          protocolVersion: "1.3",
          product: "Chrome/139.0.0.0",
          revision: "@fake",
          userAgent: "Mozilla/5.0 Chrome/139.0.0.0",
          jsVersion: "13.9",
        });
        return;
      case "Target.setDiscoverTargets": {
        this.discover = p.discover === true;
        if (this.discover) {
          for (const t of this.targets.values()) this.emit({ method: "Target.targetCreated", params: { targetInfo: { ...t.info } } });
        }
        this.reply(cmd, {});
        return;
      }
      case "Target.setAutoAttach": {
        if (cmd.sessionId) {
          this.reply(cmd, {});
          return;
        }
        const was = this.autoAttach.on;
        this.autoAttach = { on: p.autoAttach === true, wait: p.waitForDebuggerOnStart === true };
        if (this.autoAttach.on && !was) {
          for (const [tid] of this.targets) {
            if (![...this.sessionTarget.values()].includes(tid)) this.attach(tid, false);
          }
        }
        if (!this.autoAttach.on) {
          for (const [sid, tid] of [...this.sessionTarget]) {
            if (this.waiting.delete(sid)) this.resumed.add(sid); // detaching a paused target resumes it
            this.sessionTarget.delete(sid);
            this.emit({ method: "Target.detachedFromTarget", params: { sessionId: sid, targetId: tid } });
          }
        }
        this.reply(cmd, {});
        return;
      }
      case "Target.createTarget": {
        const targetId = this.addTarget({
          url: typeof p.url === "string" ? p.url : "about:blank",
          browserContextId: typeof p.browserContextId === "string" ? p.browserContextId : undefined,
        });
        this.reply(cmd, { targetId });
        return;
      }
      case "Target.attachToTarget": {
        const targetId = String(p.targetId);
        if (!this.targets.has(targetId)) return this.fail(cmd, "No target with given id found");
        const sessionId = this.attach(targetId, false);
        this.reply(cmd, { sessionId });
        return;
      }
      case "Target.detachFromTarget": {
        const sid = String(p.sessionId);
        const tid = this.sessionTarget.get(sid);
        if (tid === undefined) return this.fail(cmd, "Session with given id not found.", -32001);
        this.sessionTarget.delete(sid);
        this.waiting.delete(sid);
        this.screencasting.delete(sid);
        this.emit({ method: "Target.detachedFromTarget", params: { sessionId: sid, targetId: tid } });
        this.reply(cmd, {});
        return;
      }
      case "Target.closeTarget": {
        const targetId = String(p.targetId);
        if (!this.targets.has(targetId)) return this.fail(cmd, "No target with given id found");
        this.closeTarget(targetId);
        this.reply(cmd, { success: true });
        return;
      }
      case "Target.getTargets":
        this.reply(cmd, { targetInfos: [...this.targets.values()].map((t) => ({ ...t.info })) });
        return;
      case "Target.getTargetInfo": {
        const t = this.targets.get(String(p.targetId ?? this.sessionTarget.get(cmd.sessionId ?? "") ?? ""));
        if (t) this.reply(cmd, { targetInfo: { ...t.info } });
        else this.reply(cmd, { targetInfo: { targetId: "browser", type: "browser", title: "", url: "", attached: true, canAccessOpener: false } });
        return;
      }
      case "Target.getBrowserContexts":
        this.reply(cmd, { browserContextIds: [] });
        return;
      case "Target.createBrowserContext":
        this.reply(cmd, { browserContextId: `ctx-${++this.contextSeq}` });
        return;
      case "Target.disposeBrowserContext":
        this.reply(cmd, {});
        return;
      case "Runtime.runIfWaitingForDebugger":
        if (cmd.sessionId && this.waiting.delete(cmd.sessionId)) this.resumed.add(cmd.sessionId);
        this.reply(cmd, {});
        return;
      case "Page.startScreencast":
        if (cmd.sessionId) this.screencasting.add(cmd.sessionId);
        this.reply(cmd, {});
        return;
      case "Page.stopScreencast":
        if (cmd.sessionId) this.screencasting.delete(cmd.sessionId);
        this.reply(cmd, {});
        return;
      default:
        break;
    }
    this.handleSessionCommand(cmd, method, p);
  }

  /** Page/Runtime answers Playwright's page init needs (mirrors the relay's scripted extension). */
  private handleSessionCommand(cmd: WireCommand, method: string, p: Record<string, unknown>): void {
    const sid = cmd.sessionId;
    const targetId = sid ? this.sessionTarget.get(sid) : undefined;
    const t = targetId ? this.targets.get(targetId) : undefined;
    switch (method) {
      case "Page.getFrameTree":
        if (t) this.reply(cmd, { frameTree: { frame: FRAME(t.info.targetId, t.info.url, t.loaderId), childFrames: [] } });
        else this.reply(cmd, {});
        return;
      case "Page.navigate": {
        if (!t || !sid) return this.reply(cmd, {});
        const url = String(p.url);
        t.info.url = url;
        const loaderId = `L${Date.now()}${Math.floor(Math.random() * 1e6)}`;
        t.loaderId = loaderId;
        this.reply(cmd, { frameId: t.info.targetId, loaderId });
        this.emitSession(sid, "Page.frameNavigated", { frame: FRAME(t.info.targetId, url, loaderId) });
        for (const name of ["init", "commit", "DOMContentLoaded", "load"]) {
          this.emitSession(sid, "Page.lifecycleEvent", { frameId: t.info.targetId, loaderId, name, timestamp: 2 });
        }
        this.emitSession(sid, "Page.loadEventFired", { timestamp: 2 });
        if (this.discover) this.emit({ method: "Target.targetInfoChanged", params: { targetInfo: { ...t.info } } });
        return;
      }
      case "Runtime.enable":
        this.reply(cmd, {});
        if (sid && t) {
          this.emitSession(sid, "Runtime.executionContextCreated", {
            context: { id: 1, origin: "", name: "", uniqueId: `ctx-${sid}`, auxData: { isDefault: true, type: "default", frameId: t.info.targetId } },
          });
        }
        return;
      case "Runtime.evaluate":
        this.reply(cmd, { result: { type: "string", value: t?.info.url ?? "" } });
        return;
      case "Page.addScriptToEvaluateOnNewDocument":
        this.reply(cmd, { identifier: "1" });
        return;
      case "Page.createIsolatedWorld":
        this.reply(cmd, { executionContextId: 2 });
        return;
      default:
        this.reply(cmd, {});
    }
  }
}
