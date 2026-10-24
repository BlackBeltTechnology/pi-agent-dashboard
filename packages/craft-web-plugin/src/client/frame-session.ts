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
import { DOWNLOAD_CONFIRM_MS } from "../shared/control-protocol.js";
import { ControlHost, type SaveOutcome } from "./control-host.js";
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
function nativeClaimFor(app: CraftWebApp, ext: string): CraftWebApp | undefined {
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
  /** Live control: an export the agent triggered without user input asks before it downloads (D4). */
  setDownloadConfirm?(prompt: { name: string } | null): void;
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
  /** Per-instance opaque handle of live control (CSPRNG uuid). */
  instanceId?: string;
  /** Installed web build version when known (a mismatch with the control profile's `verifiedVersion` → unsupported). */
  buildVersion?: string;
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
  /** Live agent control of this instance (policy, busy, replies, unsaved flag, save records). */
  readonly control: ControlHost;
  private downloadResolve: ((allow: boolean) => void) | null = null;

  constructor(deps: SessionDeps) {
    this.d = deps;
    this.control = new ControlHost({
      profile: deps.app.profile.control,
      label: deps.app.label,
      buildVersion: deps.buildVersion,
      maxBytes: deps.app.maxBytes,
      instanceId: deps.instanceId ?? "",
      postControl: (id, method, params) => this.post({ type: "control", nonce: deps.nonce, id, method, params }),
      isOpen: () => this.opened && !this.dropped,
      snapshotState: () => ({ path: this.d.fh().path, unsaved: this.reported }),
      onPendingChange: () => this.recompute(),
    });
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
    this.downloadResolve?.(false);
    this.control.dispose();
    window.removeEventListener("message", this.listener);
    this.d.frame?.removeEventListener("load", this.loadListener);
  }

  /** Save-as dialog button → resolves the pending prompt. */
  pickSaveAs(choice: SaveAsChoice): void {
    this.saveAsResolve?.(choice);
  }

  /** Download confirmation button (Allow / Block) → resolves the pending prompt. */
  pickDownload(allow: boolean): void {
    this.downloadResolve?.(allow);
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

  /**
   * Unsaved state = the app's own dirty report, a copy save the tab's file still lacks, or an agent edit
   * (`agentPending`, which a shim `dirty:false` cannot clear). Nothing is reported until one of them speaks.
   */
  private recompute(): void {
    if (this.dropped) return;
    const held = this.copyPending || this.control.agentPending;
    if (this.appDirty === null && !held) return;
    this.report((this.appDirty ?? false) || held);
  }

  /** Frame lost (navigation / reload / failure): nothing further is ever sent to it. */
  private drop(next: Phase): void {
    if (this.dropped) return;
    this.dropped = true;
    clearTimeout(this.readyTimer);
    clearTimeout(this.openTimer);
    this.saveAsResolve?.("cancel");
    this.siblingResolve?.("cancel");
    this.downloadResolve?.(false);
    this.control.resetCaps();
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
        return this.onReady(m);
      case "control-result":
        return this.control.onFrameResult(m);
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

  private onReady(m: Extract<ShimMessage, { type: "ready" }>): void {
    if (this.readySeen) return this.drop("reloaded");
    this.readySeen = true;
    this.control.setCaps(m);
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
    this.recompute();
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
    // Every save message is numbered (live control reads the outcome back through `host.state`, design D5).
    const seq = this.control.beginSave();
    if (this.saving) {
      this.d.ui.setSaveError(this.d.t()("saveBusy"));
      this.reply(false, "busy");
      this.control.endSave(seq, "rejected");
      return;
    }
    this.saving = true;
    let outcome: SaveOutcome = "rejected";
    try {
      outcome = await this.routeAndSave(m, this.control.saveMark());
    } finally {
      this.saving = false;
      this.control.endSave(seq, outcome);
    }
  }

  private async routeAndSave(m: SaveMsg, mark: number): Promise<SaveOutcome> {
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
      // An export nobody asked for (the agent's, or a late one) must not download silently (design D4).
      if (this.control.downloadConfirmApplies && typeof m.msSinceInput === "number" && m.msSinceInput > DOWNLOAD_CONFIRM_MS && !(await this.confirmDownload(m.suggestedName))) {
        this.reply(false, "blocked");
        return "denied";
      }
      downloadToDevice(m.suggestedName, m.bytes, m.mime);
      this.reply(true);
      return "downloaded";
    }
    if (route === "too-large") {
      this.d.ui.setOffer({ name: m.suggestedName, bytes: m.bytes, mime: m.mime });
      this.reply(false, "too-large");
      return "too-large";
    }
    if (route === "sibling") return this.siblingSave(m);
    if (route === "own") return this.workspaceSave(m.bytes, remembered ?? this.d.saveTarget(), mark);
    const choice = await this.askSaveAs(m.suggestedName);
    if (choice === "cancel") {
      this.reply(false, "cancelled");
      return "cancelled";
    }
    // D10: an answer is remembered for later saves under the SAME suggested name only.
    if (this.d.app.profile.saveName === "inner-title") this.rememberedSaveAs.set(saveNameKey(m.suggestedName), choice);
    return this.workspaceSave(m.bytes, choice, mark);
  }

  /** The agent-triggered download asks first: Allow / Block. A dropped frame counts as Block. */
  private confirmDownload(name: string): Promise<boolean> {
    return new Promise((resolve) => {
      this.downloadResolve = (allow) => {
        this.downloadResolve = null;
        if (!this.dropped) this.d.ui.setDownloadConfirm?.(null);
        resolve(allow);
      };
      this.d.ui.setDownloadConfirm?.({ name });
    });
  }

  /**
   * Native-format sibling (D6): the app saved its own format. Create `<stem><ext>` next to the tab's file
   * (never overwrites), optionally open it in the native claim; or download; or cancel. The tab's own file
   * still lacks the edits, so the tab stays dirty.
   */
  private async siblingSave(m: SaveMsg): Promise<SaveOutcome> {
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
    if (choice === "cancel") {
      this.reply(false, "cancelled");
      return "cancelled";
    }
    if (choice === "download") {
      downloadToDevice(m.suggestedName, m.bytes, m.mime);
      this.reply(true);
      return "downloaded";
    }
    let res: FileHandlerSaveResult;
    try {
      res = await this.d.fh().save(m.bytes, { target: "sibling", ext });
    } catch (err) {
      res = { ok: false, reason: "rejected", message: err instanceof Error ? err.message : String(err) };
    }
    if (this.dropped) return "rejected";
    if (!res.ok) {
      if (res.reason === "conflict-unresolved") {
        const stem = name.slice(0, name.length - ext.length);
        this.d.ui.setExhausted({ name, first: `${stem}-2${ext}`, last: `${stem}-99${ext}`, offer: { name, bytes: m.bytes, mime: m.mime } });
        this.reply(false, "conflict");
        return "exhausted";
      }
      this.onSaveFailed(res.reason, res.message, ext);
      return failureOutcome(res.reason);
    }
    this.d.ui.setSaveError(null);
    this.copyPending = true;
    this.recompute();
    this.reply(true);
    if (choice === "create-open" && native) this.d.fh().openFile?.(res.path, native.claimId);
    return "sibling";
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

  private async workspaceSave(bytes: ArrayBuffer, target: SaveTarget, mark: number): Promise<SaveOutcome> {
    let res: FileHandlerSaveResult;
    try {
      res = await this.d.fh().save(bytes, { target });
    } catch (err) {
      res = { ok: false, reason: "rejected", message: err instanceof Error ? err.message : String(err) };
    }
    if (this.dropped) return "rejected";
    // Core may turn an overwrite into a copy (first-overwrite notice, conflict dialog): the written
    // path decides. A copy is `<stem>.<suffix>.<ext>`, never the tab's own base name.
    if (res.ok) {
      const own = target === "overwrite" && baseName(res.path) === baseName(this.d.fh().path);
      this.onSaved(own, mark);
      return own ? "saved" : "copy";
    }
    this.onSaveFailed(res.reason, res.message);
    return failureOutcome(res.reason);
  }

  private onSaved(own: boolean, mark: number): void {
    this.d.ui.setSaveError(null);
    if (!own) {
      this.copyPending = true;
    } else {
      this.copyPending = false;
      // The tab's file now holds the edits, unless an agent edit landed after this save message (D6).
      this.control.ownSaveAcked(mark);
    }
    this.recompute();
    this.reply(true, undefined, own);
  }

  /** `ext` = the format that was written (a sibling's native extension), default the tab's own. */
  private onSaveFailed(reason: string, message: string, ext = splitName(this.d.fh().path).ext): void {
    if (reason !== "cancelled") this.d.ui.setSaveError(this.d.t()("saveFailed", { message }));
    if (reason === "rejected") reportTelemetry(this.d.app.id, { kind: "reject", ext });
    this.reply(false, reason);
  }
}

/** `host.state` outcome of a failed workspace save. */
function failureOutcome(reason: string): SaveOutcome {
  if (reason === "conflict-unresolved") return "conflict";
  if (reason === "cancelled") return "cancelled";
  if (reason === "too-large") return "too-large";
  return "rejected";
}
