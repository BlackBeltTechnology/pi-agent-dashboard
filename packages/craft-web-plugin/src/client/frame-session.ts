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
import { type OpenOutcome, reportCsp, reportTelemetry } from "./craft-api.js";
import { CRAFT_WEB_APPS, type CraftWebApp } from "./craft-apps-table.js";
import { downloadToDevice } from "./device-download.js";
import type { Translate } from "./messages.js";
import { baseName, routeSave, saveNameKey, siblingName, splitName } from "./save-routing.js";
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
/** Native-format sibling dialog (D6/D11). */
export type SiblingChoice = "create-open" | "create" | "download" | "cancel";
export interface SiblingPrompt {
  /** Native extension the app saved (`.psd`). */
  ext: string;
  /** Target file name next to the tab's file (`photo.psd`). */
  name: string;
  /** "Create and open" is offered (native claim available + host can open files). */
  canOpen: boolean;
}
/** Every sibling name was taken (core 409). */
export interface SiblingExhausted {
  name: string;
  first: string;
  last: string;
  offer: DownloadOffer;
}

/** The app's claim that EDITS `ext` in place (the native claim of a sibling extension). */
export function nativeClaimFor(app: CraftWebApp, ext: string): CraftWebApp | undefined {
  return Object.values(CRAFT_WEB_APPS).find((c) => c.id === app.id && c.mode === "edit" && c.extensions.includes(ext));
}
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
  setSibling(prompt: SiblingPrompt | null): void;
  setExhausted(info: SiblingExhausted | null): void;
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
  /** Open outcome already reported (one per mount). */
  private outcomeSent = false;
  /** Last dirty value the app reported (`null` = none yet). */
  private appDirty: boolean | null = null;
  /** True after a copy save until the next successful overwrite: the tab's own file still lacks the edits. */
  private copyPending = false;
  private reported: DirtyState = "unknown";
  private readonly cspLast = new Map<string, number>();
  private cspCount = 0;
  private saveAsResolve: ((c: SaveAsChoice) => void) | null = null;
  private siblingResolve: ((c: SiblingChoice) => void) | null = null;
  /** `inner-title` apps (D10): the Save As answer per suggested name, for this instance. */
  private readonly rememberedSaveAs = new Map<string, Exclude<SaveAsChoice, "cancel">>();
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
    ui.setSibling(null);
    ui.setExhausted(null);
    ui.setOffer(null);
    ui.setSaveError(null);
    this.d.fh().setDirty("unknown");
    this.snapP = this.d.takeSnapshot();
    this.snapP.catch(() => {});
    window.addEventListener("message", this.listener);
    frame?.addEventListener("load", this.loadListener);
    this.readyTimer = setTimeout(() => {
      if (!this.readySeen) {
        this.reportOutcome("start-failed");
        this.drop("start-failed");
      }
    }, READY_TIMEOUT_MS);
  }

  dispose(): void {
    this.dropped = true;
    clearTimeout(this.readyTimer);
    clearTimeout(this.openTimer);
    clearTimeout(this.blockedTimer);
    this.saveAsResolve?.("cancel");
    this.siblingResolve?.("cancel");
    window.removeEventListener("message", this.listener);
    this.d.frame?.removeEventListener("load", this.loadListener);
  }

  /** Save-as dialog button → resolves the pending prompt. */
  pickSaveAs(choice: SaveAsChoice): void {
    this.saveAsResolve?.(choice);
  }

  /** Sibling dialog button → resolves the pending prompt. */
  pickSibling(choice: SiblingChoice): void {
    this.siblingResolve?.(choice);
  }

  // --- plumbing ---------------------------------------------------------------------------

  private post(m: HostMessage, transfer: Transferable[] = []): void {
    this.d.frame?.contentWindow?.postMessage(m, "*", transfer);
  }

  private reply(ok: boolean, error?: string, own?: boolean): void {
    this.post({ type: "save-result", nonce: this.d.nonce, ok, error, ...(own ? { own: true } : {}) });
  }

  /** View-only claim (design D4): dirty never reported, saves never reach the workspace. */
  private get preview(): boolean {
    return this.d.app.mode === "preview";
  }

  private reportOutcome(outcome: OpenOutcome): void {
    if (this.outcomeSent) return;
    this.outcomeSent = true;
    reportTelemetry(this.d.app.id, { kind: "open", outcome });
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
    this.siblingResolve?.("cancel");
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
        return this.onOpened(m.confirmed !== false);
      case "start-failed":
        return this.onStartFailed();
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
      if (this.opened) return;
      this.reportOutcome("timeout");
      this.drop("open-failed");
    }, OPENED_TIMEOUT_MS);
  }

  private onSnapshotError(err: unknown): void {
    if (this.dropped) return;
    this.d.ui.setSnapMsg(err instanceof Error ? err.message : String(err));
    this.drop("snapshot-error");
  }

  /**
   * `confirmed:false` (no-title fallback) is telemetry only: the unconfirmed-open check lives in the claim's
   * first-overwrite notice, so core asks ONE question before the first overwrite (D4). A v1 `opened` without
   * `confirmed` counts as confirmed.
   */
  private onOpened(confirmed: boolean): void {
    if (!this.openPosted || this.opened) return;
    this.opened = true;
    clearTimeout(this.openTimer);
    this.reportOutcome(confirmed ? "title" : "fallback");
    this.d.ui.setPhase("open");
    if (this.preview) this.report(false);
  }

  /** The app trapped / panicked before opening: "could not start" + Retry; the open is never resent. */
  private onStartFailed(): void {
    if (this.opened) return;
    this.reportOutcome("start-failed");
    this.drop("start-failed");
  }

  private onDirty(value: boolean): void {
    // Before the document shows, the title is the bare app name — not a signal about the document.
    // A view-only instance holds nothing to save, whatever the app reports.
    if (!this.opened || this.preview) return;
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
      siblingExtensions: this.d.app.siblingExtensions,
      saveName: this.d.app.profile.saveName,
      remembered: new Set(this.rememberedSaveAs.keys()),
      preview: this.preview,
    });
    const remembered = this.rememberedSaveAs.get(saveNameKey(m.suggestedName));
    if (route === "download") {
      downloadToDevice(m.suggestedName, m.bytes, m.mime);
      this.reply(true);
    } else if (route === "too-large") {
      this.d.ui.setOffer({ name: m.suggestedName, bytes: m.bytes, mime: m.mime });
      this.reply(false, "too-large");
    } else if (route === "sibling") {
      await this.siblingSave(m);
    } else if (route === "own") {
      await this.workspaceSave(m.bytes, remembered ?? this.d.saveTarget());
    } else {
      const choice = await this.askSaveAs(m.suggestedName);
      if (choice === "cancel") return this.reply(false, "cancelled");
      // D10: an answer is remembered for later saves under the SAME suggested name only.
      if (this.d.app.profile.saveName === "inner-title") this.rememberedSaveAs.set(saveNameKey(m.suggestedName), choice);
      await this.workspaceSave(m.bytes, choice);
    }
  }

  /**
   * Native-format sibling (D6): the app saved its own format. Create `<stem><ext>` next to the tab's file
   * (never overwrites), optionally open it in the native claim; or download; or cancel. The tab's own file
   * still lacks the edits, so the tab stays dirty.
   */
  private async siblingSave(m: SaveMsg): Promise<void> {
    const ext = splitName(m.suggestedName).ext;
    const tabPath = this.d.fh().path;
    const name = siblingName(tabPath, ext);
    const native = nativeClaimFor(this.d.app, ext);
    const canOpen = !!native && typeof this.d.fh().openFile === "function";
    const choice = await new Promise<SiblingChoice>((resolve) => {
      this.siblingResolve = (c) => {
        this.siblingResolve = null;
        if (!this.dropped) this.d.ui.setSibling(null);
        resolve(c);
      };
      this.d.ui.setSibling({ ext, name, canOpen });
    });
    if (choice === "cancel") return this.reply(false, "cancelled");
    if (choice === "download") {
      downloadToDevice(m.suggestedName, m.bytes, m.mime);
      return this.reply(true);
    }
    let res: FileHandlerSaveResult;
    try {
      res = await this.d.fh().save(m.bytes, { target: "sibling", ext });
    } catch (err) {
      res = { ok: false, reason: "rejected", message: err instanceof Error ? err.message : String(err) };
    }
    if (this.dropped) return;
    if (!res.ok) {
      if (res.reason === "conflict-unresolved") {
        const stem = name.slice(0, name.length - ext.length);
        this.d.ui.setExhausted({ name, first: `${stem}-2${ext}`, last: `${stem}-99${ext}`, offer: { name, bytes: m.bytes, mime: m.mime } });
        return this.reply(false, "conflict");
      }
      return this.onSaveFailed(res.reason, res.message);
    }
    this.d.ui.setSaveError(null);
    this.copyPending = true;
    this.report(true);
    this.reply(true);
    if (choice === "create-open" && native) this.d.fh().openFile?.(res.path, native.claimId);
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
    // Core may turn an overwrite into a copy (first-overwrite notice, conflict dialog): the written
    // path decides. A copy is `<stem>.<suffix>.<ext>`, never the tab's own base name.
    if (res.ok) this.onSaved(target === "overwrite" && baseName(res.path) === baseName(this.d.fh().path));
    else this.onSaveFailed(res.reason, res.message);
  }

  private onSaved(own: boolean): void {
    this.d.ui.setSaveError(null);
    if (!own) {
      this.copyPending = true;
      this.report(true);
    } else {
      this.copyPending = false;
      if (this.appDirty !== null) this.report(this.appDirty);
    }
    this.reply(true, undefined, own);
  }

  private onSaveFailed(reason: string, message: string): void {
    if (reason !== "cancelled") this.d.ui.setSaveError(this.d.t()("saveFailed", { message }));
    if (reason === "rejected") reportTelemetry(this.d.app.id, { kind: "reject", ext: splitName(this.d.fh().path).ext });
    this.reply(false, reason);
  }
}
