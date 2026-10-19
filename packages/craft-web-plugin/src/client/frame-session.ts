/**
 * Host-side protocol session for ONE iframe mount (design D4), kept out of React so each
 * message handler stays small and testable: per-mount nonce binding, message acceptance
 * (frame source + nonce + known type), `ready` → `open` once (transferred), readiness /
 * opened timeouts, save mapping, conservative dirty reporting, blocked / csp /
 * navigate-blocked, and frame loss (second `ready` / second `load`).
 * `CraftFrame` owns one `FrameSession` per run and mirrors its UI callbacks into state.
 * See change: edit-office-in-pane-with-craft-web.
 */
import type {
  FileHandlerProps,
  FileHandlerSaveResult,
  FileHandlerSnapshot,
} from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/slot-props.js";
import { reportCsp } from "./craft-api.js";
import type { CraftWebApp } from "./craft-apps-table.js";
import { downloadToDevice } from "./device-download.js";
import type { Translate } from "./messages.js";
import { baseName, routeSave } from "./save-routing.js";
import type { SaveTarget } from "./save-target-store.js";
import { type HostMessage, parseShimMessage, type ShimMessage, safeNavigateUrl } from "./shim-protocol.js";

export const READY_TIMEOUT_MS = 60_000;
export const OPENED_TIMEOUT_MS = 15_000;
const BLOCKED_NOTICE_MS = 6_000;
/** Per-mount CSP report budget: one POST per directive per window, bounded overall. */
const CSP_WINDOW_MS = 10_000;
const CSP_MAX_REPORTS = 20;

export type Phase = "starting" | "opening" | "open" | "start-failed" | "open-failed" | "reloaded" | "snapshot-error";
export type DirtyState = boolean | "unknown";
export type SaveAsChoice = "copy" | "overwrite" | "cancel";
export interface DownloadOffer {
  name: string;
  bytes: ArrayBuffer;
  mime?: string;
}

/** What the session reports to the component (each maps to one React state setter). */
interface SessionUi {
  setPhase(p: Phase): void;
  setLostEdits(lost: boolean): void;
  setSnapMsg(message: string): void;
  setBlocked(on: boolean): void;
  setNav(nav: { url: string | null } | null): void;
  setSaveAs(prompt: { name: string } | null): void;
  setOffer(offer: DownloadOffer | null): void;
  setSaveError(message: string | null): void;
}

export interface SessionDeps {
  app: CraftWebApp;
  nonce: string;
  frame: HTMLIFrameElement | null;
  fh: () => FileHandlerProps;
  takeSnapshot: () => Promise<FileHandlerSnapshot>;
  saveTarget: () => SaveTarget;
  t: () => Translate;
  ui: SessionUi;
}

type SaveMsg = Extract<ShimMessage, { type: "save" }>;

export class FrameSession {
  private readySeen = false;
  private openPosted = false;
  private opened = false;
  private dropped = false;
  private loads = 0;
  private saving = false;
  /** Last dirty value the app reported (`null` = none yet). */
  private appDirty: boolean | null = null;
  /** True after a copy save until the next successful overwrite: the tab's own file still lacks the edits. */
  private copyPending = false;
  private reported: DirtyState = "unknown";
  private readonly cspLast = new Map<string, number>();
  private cspCount = 0;
  private saveAsResolve: ((c: SaveAsChoice) => void) | null = null;
  private readyTimer: ReturnType<typeof setTimeout> | undefined;
  private openTimer: ReturnType<typeof setTimeout> | undefined;
  private blockedTimer: ReturnType<typeof setTimeout> | undefined;
  private snapP: Promise<FileHandlerSnapshot> | null = null;
  private readonly listener = (e: MessageEvent) => this.onMessage(e);
  private readonly loadListener = () => this.onLoad();

  private readonly d: SessionDeps;

  constructor(deps: SessionDeps) {
    this.d = deps;
  }

  start(): void {
    const { ui, frame } = this.d;
    ui.setBlocked(false);
    ui.setNav(null);
    ui.setSaveAs(null);
    ui.setOffer(null);
    ui.setSaveError(null);
    this.d.fh().setDirty("unknown");
    this.snapP = this.d.takeSnapshot();
    this.snapP.catch(() => {});
    window.addEventListener("message", this.listener);
    frame?.addEventListener("load", this.loadListener);
    this.readyTimer = setTimeout(() => {
      if (!this.readySeen) this.drop("start-failed");
    }, READY_TIMEOUT_MS);
  }

  dispose(): void {
    this.dropped = true;
    clearTimeout(this.readyTimer);
    clearTimeout(this.openTimer);
    clearTimeout(this.blockedTimer);
    this.saveAsResolve?.("cancel");
    window.removeEventListener("message", this.listener);
    this.d.frame?.removeEventListener("load", this.loadListener);
  }

  /** Save-as dialog button → resolves the pending prompt. */
  pickSaveAs(choice: SaveAsChoice): void {
    this.saveAsResolve?.(choice);
  }

  // --- plumbing ---------------------------------------------------------------------------

  private post(m: HostMessage, transfer: Transferable[] = []): void {
    this.d.frame?.contentWindow?.postMessage(m, "*", transfer);
  }

  private reply(ok: boolean, error?: string): void {
    this.post({ type: "save-result", nonce: this.d.nonce, ok, error });
  }

  private report(v: DirtyState): void {
    if (this.reported === v) return;
    this.reported = v;
    this.d.fh().setDirty(v);
  }

  /** Frame lost (navigation / reload / failure): nothing further is ever sent to it. */
  private drop(next: Phase): void {
    if (this.dropped) return;
    this.dropped = true;
    clearTimeout(this.readyTimer);
    clearTimeout(this.openTimer);
    this.saveAsResolve?.("cancel");
    if (next === "reloaded") {
      this.d.ui.setLostEdits(this.reported !== false);
      // The document is gone with the frame: nothing unsaved is held any more.
      this.report(false);
    }
    this.d.ui.setPhase(next);
  }

  // --- inbound ----------------------------------------------------------------------------

  private onLoad(): void {
    this.loads += 1;
    // The first load is the initial document; a second one is a navigation or reload.
    if (this.loads >= 2) this.drop("reloaded");
  }

  private onMessage(e: MessageEvent): void {
    const { frame, nonce } = this.d;
    if (this.dropped || !frame || e.source !== frame.contentWindow) return;
    const m = parseShimMessage(e.data);
    if (!m || m.nonce !== nonce) return;
    this.dispatch(m);
  }

  private dispatch(m: ShimMessage): void {
    switch (m.type) {
      case "ready":
        return this.onReady();
      case "opened":
        return this.onOpened();
      case "dirty":
        return this.onDirty(m.value);
      case "save":
        // Saving is meaningful only once the delivered document is showing.
        if (this.opened) void this.handleSave(m);
        return;
      case "blocked":
        return this.onBlocked();
      case "csp":
        return this.onCsp(m.directive);
      case "navigate-blocked":
        return this.d.ui.setNav({ url: safeNavigateUrl(m.url) });
    }
  }

  private onReady(): void {
    if (this.readySeen) return this.drop("reloaded");
    this.readySeen = true;
    clearTimeout(this.readyTimer);
    this.d.ui.setPhase("opening");
    this.snapP?.then(
      (snap) => this.postOpen(snap),
      (err: unknown) => this.onSnapshotError(err),
    );
  }

  private postOpen(snap: FileHandlerSnapshot): void {
    if (this.dropped || this.openPosted) return;
    this.openPosted = true;
    this.post({ type: "open", nonce: this.d.nonce, name: baseName(this.d.fh().path), bytes: snap.bytes }, [snap.bytes]);
    this.openTimer = setTimeout(() => {
      if (!this.opened) this.drop("open-failed");
    }, OPENED_TIMEOUT_MS);
  }

  private onSnapshotError(err: unknown): void {
    if (this.dropped) return;
    this.d.ui.setSnapMsg(err instanceof Error ? err.message : String(err));
    this.drop("snapshot-error");
  }

  private onOpened(): void {
    if (!this.openPosted || this.opened) return;
    this.opened = true;
    clearTimeout(this.openTimer);
    this.d.ui.setPhase("open");
  }

  private onDirty(value: boolean): void {
    // Before the document shows, the title is the bare app name — not a signal about the document.
    if (!this.opened) return;
    this.appDirty = value;
    this.report(value || this.copyPending);
  }

  private onBlocked(): void {
    this.d.ui.setBlocked(true);
    clearTimeout(this.blockedTimer);
    this.blockedTimer = setTimeout(() => !this.dropped && this.d.ui.setBlocked(false), BLOCKED_NOTICE_MS);
  }

  private onCsp(directive: string): void {
    const now = Date.now();
    const last = this.cspLast.get(directive);
    if (this.cspCount >= CSP_MAX_REPORTS || (last !== undefined && now - last < CSP_WINDOW_MS)) return;
    this.cspLast.set(directive, now);
    this.cspCount += 1;
    reportCsp(this.d.app.id, directive.slice(0, 200));
  }

  // --- save mapping -----------------------------------------------------------------------

  private async handleSave(m: SaveMsg): Promise<void> {
    if (this.saving) {
      this.d.ui.setSaveError(this.d.t()("saveBusy"));
      this.reply(false, "busy");
      return;
    }
    this.saving = true;
    try {
      await this.routeAndSave(m);
    } finally {
      this.saving = false;
    }
  }

  private async routeAndSave(m: SaveMsg): Promise<void> {
    const route = routeSave({
      suggestedName: m.suggestedName,
      tabPath: this.d.fh().path,
      byteLength: m.bytes.byteLength,
      maxBytes: this.d.app.maxBytes,
    });
    if (route === "download") {
      downloadToDevice(m.suggestedName, m.bytes, m.mime);
      this.reply(true);
    } else if (route === "too-large") {
      this.d.ui.setOffer({ name: m.suggestedName, bytes: m.bytes, mime: m.mime });
      this.reply(false, "too-large");
    } else if (route === "own") {
      await this.workspaceSave(m.bytes, this.d.saveTarget());
    } else {
      const choice = await this.askSaveAs(m.suggestedName);
      if (choice === "cancel") this.reply(false, "cancelled");
      else await this.workspaceSave(m.bytes, choice);
    }
  }

  private askSaveAs(name: string): Promise<SaveAsChoice> {
    return new Promise((resolve) => {
      this.saveAsResolve = (c) => {
        this.saveAsResolve = null;
        if (!this.dropped) this.d.ui.setSaveAs(null);
        resolve(c);
      };
      this.d.ui.setSaveAs({ name });
    });
  }

  private async workspaceSave(bytes: ArrayBuffer, target: SaveTarget): Promise<void> {
    let res: FileHandlerSaveResult;
    try {
      res = await this.d.fh().save(bytes, { target });
    } catch (err) {
      res = { ok: false, reason: "rejected", message: err instanceof Error ? err.message : String(err) };
    }
    if (this.dropped) return;
    if (res.ok) this.onSaved(target);
    else this.onSaveFailed(res.reason, res.message);
  }

  private onSaved(target: SaveTarget): void {
    this.d.ui.setSaveError(null);
    if (target === "copy") {
      this.copyPending = true;
      this.report(true);
    } else {
      this.copyPending = false;
      if (this.appDirty !== null) this.report(this.appDirty);
    }
    this.reply(true);
  }

  private onSaveFailed(reason: string, message: string): void {
    if (reason !== "cancelled") this.d.ui.setSaveError(this.d.t()("saveFailed", { message }));
    this.reply(false, reason);
  }
}
