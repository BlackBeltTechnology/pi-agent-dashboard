/**
 * Host-side live-control state of ONE editor instance (design D3, D4, D5, D6): the method policy, the
 * one-request-in-flight rule with its timeout / late-result bookkeeping, reply validation and size caps, the
 * screenshot pipeline, the `agentPending` unsaved flag and the save records behind `host.state`.
 *
 * `FrameSession` owns one per frame run and wires it to the frame (`post`) and to the unsaved report. Policy
 * lives here, not in the shim, so it is testable without a browser. The security boundary is unchanged
 * (frame isolation, CSP, the save path with authz / conflict / validator checks); the policy fails closed.
 *
 * See change: add-craft-live-control (D3–D6).
 */
import type { CraftControlProfile } from "../shared/app-profiles.js";
import {
  APP_TIMEOUT_MS,
  type ClaimStatus,
  type ControlErrorCode,
  ERROR_MAX_BYTES,
  HOST_METHODS,
  jsonBytes,
  LATE_BUSY_MS,
  REPLY_MAX_BYTES,
  truncateUtf8,
} from "../shared/control-protocol.js";
import { processScreenshot, type ScreenshotDeps } from "./screenshot.js";

/** Outcome of one save message, as `host.state` reports it (design D5). */
export type SaveOutcome = "saved" | "copy" | "sibling" | "conflict" | "cancelled" | "denied" | "downloaded" | "too-large" | "rejected" | "exhausted";

export interface SaveRecord {
  seq: number;
  /** True while a notice or dialog for this save is still open. */
  pending: boolean;
  outcome?: SaveOutcome;
  at: number;
}

/** What `runControl` returns to the registry, which relays it to the server as a `control-result`. */
export type ControlReply =
  | { ok: true; result: unknown; instance: string; saveRequested?: true; saveSeq?: number }
  | { ok: false; code: ControlErrorCode; error: string; instance: string };

/** Capabilities a shim announces on `ready` (reset per frame load). */
export interface FrameCaps {
  shimVersion: number;
  control: boolean;
}

export interface ControlHostDeps {
  /** The app's control profile; `undefined` = the app has no live control. */
  profile: CraftControlProfile | undefined;
  /** Display name for messages. */
  label: string;
  /** Installed web build version when known; a mismatch with `verifiedVersion` means `unsupported`. */
  buildVersion: string | undefined;
  /** Largest raw PNG a screenshot may carry. */
  maxBytes: number;
  /** Per-instance opaque handle (CSPRNG uuid). */
  instanceId: string;
  /** Post a `control` to the frame. */
  postControl(id: number, method: string, params: unknown): void;
  /** The document is showing (`opened` seen, frame alive). */
  isOpen(): boolean;
  /** Current unsaved state and path, for `host.state`. */
  snapshotState(): { path: string; unsaved: boolean | "unknown" };
  /** `agentPending` changed: the session recomputes the reported unsaved state. */
  onPendingChange(): void;
  now?: () => number;
  screenshot?: Partial<ScreenshotDeps>;
}

const MIN_SHIM = 3;
const MAX_RECORDS = 50;

const isPlain = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

type Policy =
  | { ok: true; method: string; params: unknown; readOnly: boolean; save: boolean }
  | { ok: false; code: ControlErrorCode; reason: string };

export class ControlHost {
  readonly instanceId: string;
  private readonly d: ControlHostDeps;
  private caps: FrameCaps | null = null;
  private nextId = 1;
  private inflight: { id: number; method: string; readOnly: boolean; save: boolean; saveSeq: number; settle: (r: ControlReply) => void; timer: ReturnType<typeof setTimeout> } | null = null;
  /** After a timeout: the request that may still answer, and until when the instance stays busy. */
  private late: { id: number; readOnly: boolean; until: number } | null = null;
  private _agentPending = false;
  /** Count of successful non-read-only agent requests (bumped when the result arrives). */
  private agentOkSeq = 0;
  private saveSeq = 0;
  private readonly saves: SaveRecord[] = [];

  constructor(deps: ControlHostDeps) {
    this.d = deps;
    this.instanceId = deps.instanceId;
  }

  private now(): number {
    return (this.d.now ?? Date.now)();
  }

  // --- capabilities (per frame load) ---------------------------------------------------------------

  /** `ready` of a frame load: store what the shim announced; a v1/v2 shim announces nothing. */
  setCaps(msg: { shimVersion?: number; control?: boolean }): void {
    this.caps = { shimVersion: msg.shimVersion ?? 0, control: msg.control === true };
  }

  resetCaps(): void {
    this.caps = null;
  }

  /** Does this instance take control requests? (profile, verified build, shim ≥ 3, shim saw a control entry) */
  get capable(): boolean {
    const p = this.d.profile;
    if (!p || !this.caps) return false;
    if (this.d.buildVersion !== undefined && this.d.buildVersion !== p.verifiedVersion) return false;
    return this.caps.shimVersion >= MIN_SHIM && this.caps.control;
  }

  /** The control-enabled instance of a v3 frame (download confirmation applies only here). */
  get downloadConfirmApplies(): boolean {
    return this.capable;
  }

  /** Claim status for a probe, in the order of the design's rules 2–5 (rule 1, the session, is the registry's). */
  claimStatus(active: boolean, pageVisible: boolean): ClaimStatus {
    if (!this.capable) return "unsupported";
    if (!this.d.isOpen()) return "not-ready";
    if (!active || !pageVisible) return "not-visible";
    return "eligible";
  }

  // --- policy ---------------------------------------------------------------------------------------

  private unsupportedMessage(): string {
    const p = this.d.profile;
    if (!p) return `${this.d.label} has no live control.`;
    return `Live control of ${this.d.label} needs web build ${p.verifiedVersion} with the current shim, and this editor does not offer it. Update ${this.d.label} in Settings → Update, then reopen the file.`;
  }

  /** `engine.execute`: exactly `{command, params?}`, the command allowlisted, save-target params stripped. */
  private policyExecute(params: unknown): Policy {
    const p = this.d.profile as CraftControlProfile;
    if (!isPlain(params) || Object.keys(params).some((k) => k !== "command" && k !== "params") || typeof params.command !== "string")
      return { ok: false, code: "denied", reason: "engine.execute takes exactly {command: string, params?: object}." };
    if (params.params !== undefined && !isPlain(params.params)) return { ok: false, code: "denied", reason: "engine.execute `params` must be an object." };
    if (!p.allowedCommands.includes(params.command))
      return { ok: false, code: "denied", reason: `Command "${params.command}" is not allowed on ${this.d.label}. Call engine.commands to list what is.` };
    const stripped: Record<string, unknown> = {};
    for (const [k, v] of Object.entries((params.params as Record<string, unknown> | undefined) ?? {})) if (!p.saveParamNames.includes(k)) stripped[k] = v;
    const forwarded = params.params === undefined ? { command: params.command } : { command: params.command, params: stripped };
    return { ok: true, method: "engine.execute", params: forwarded, readOnly: p.readOnlyCommands.includes(params.command), save: p.saveCommands.includes(params.command) };
  }

  private policy(method: string, params: unknown): Policy {
    if (!(HOST_METHODS as readonly string[]).includes(method)) return { ok: false, code: "denied", reason: `Method "${method}" is not available. Use one of: ${HOST_METHODS.join(", ")}.` };
    if (method === "engine.execute") return this.policyExecute(params);
    if (params !== undefined && !isPlain(params)) return { ok: false, code: "denied", reason: `${method} takes an object (or nothing) as params.` };
    // Other methods read; none takes caller params except screenshot, whose params the host owns.
    return { ok: true, method, params: method === "ui.screenshot" ? { data: true } : undefined, readOnly: true, save: false };
  }

  // --- state ----------------------------------------------------------------------------------------

  get agentPending(): boolean {
    return this._agentPending;
  }

  private setPending(v: boolean): void {
    if (this._agentPending === v) return;
    this._agentPending = v;
    this.d.onPendingChange();
  }

  /** Mark of the agent edit counter at the moment a save message arrives (design D6). */
  saveMark(): number {
    return this.agentOkSeq;
  }

  /**
   * An own-file save was acknowledged: the tab's file now has the edits unless an agent request succeeded (or is
   * still running) after the save message arrived.
   */
  ownSaveAcked(markAtSaveMessage: number): void {
    const running = this.inflight !== null && !this.inflight.readOnly;
    if (this.agentOkSeq === markAtSaveMessage && !running) this.setPending(false);
  }

  /** A save message arrived: number it (`pending` until `endSave`). */
  beginSave(): number {
    const seq = ++this.saveSeq;
    this.saves.push({ seq, pending: true, at: this.now() });
    if (this.saves.length > MAX_RECORDS) this.saves.shift();
    return seq;
  }

  endSave(seq: number, outcome: SaveOutcome): void {
    const rec = this.saves.find((s) => s.seq === seq);
    if (rec) {
      rec.pending = false;
      rec.outcome = outcome;
    }
  }

  private hostState(params: unknown): ControlReply {
    const since = isPlain(params) && typeof params.sinceSeq === "number" && Number.isFinite(params.sinceSeq) ? params.sinceSeq : 0;
    const { path, unsaved } = this.d.snapshotState();
    const saves = this.saves.filter((s) => s.seq > since).map((s) => ({ seq: s.seq, pending: s.pending, ...(s.outcome ? { outcome: s.outcome } : {}), at: s.at }));
    return { ok: true, instance: this.instanceId, result: { path, unsaved, saves, noSaveYet: saves.length === 0 } };
  }

  // --- run ------------------------------------------------------------------------------------------

  private fail(code: ControlErrorCode, error: string): ControlReply {
    return { ok: false, code, error: truncateUtf8(error, ERROR_MAX_BYTES), instance: this.instanceId };
  }

  private get busy(): boolean {
    if (this.inflight) return true;
    return this.late !== null && this.now() < this.late.until;
  }

  /** Run one request. `host.state` is answered here and never reaches the frame (exempt from busy / visibility). */
  run(method: string, params: unknown): Promise<ControlReply> {
    if (method === "host.state") return Promise.resolve(this.hostState(params));
    if (!this.d.profile) return Promise.resolve(this.fail("unsupported", this.unsupportedMessage()));
    const pol = this.policy(method, params);
    if (!pol.ok) return Promise.resolve(this.fail(pol.code, pol.reason));
    if (!this.capable) return Promise.resolve(this.fail("unsupported", this.unsupportedMessage()));
    if (!this.d.isOpen()) return Promise.resolve(this.fail("not-ready", "The document is not open in the editor yet."));
    if (this.busy) return Promise.resolve(this.fail("busy", "The editor is still working on a previous request. Wait and retry."));
    return new Promise<ControlReply>((resolve) => {
      const id = this.nextId++;
      const timer = setTimeout(() => this.onTimeout(id), APP_TIMEOUT_MS);
      this.inflight = { id, method: pol.method, readOnly: pol.readOnly, save: pol.save, saveSeq: this.saveSeq, settle: resolve, timer };
      // A non-read-only request marks the tab unsaved when FORWARDED, whatever its result (design D6).
      if (!pol.readOnly) this.setPending(true);
      this.d.postControl(id, pol.method, pol.params);
    });
  }

  private onTimeout(id: number): void {
    const f = this.inflight;
    if (!f || f.id !== id) return;
    this.inflight = null;
    this.late = { id, readOnly: f.readOnly, until: this.now() + LATE_BUSY_MS };
    f.settle(this.fail("timeout", "The editor did not answer within 10 s. The change may still be applied (outcome unknown): inspect the document before retrying."));
  }

  /** A `control-result` of the frame (already past the session's source + nonce check). */
  onFrameResult(m: { id: number; ok: unknown; result?: unknown; error?: unknown; code?: unknown }): void {
    const f = this.inflight;
    if (f && f.id === m.id) {
      clearTimeout(f.timer);
      this.inflight = null;
      void this.finish(f, m);
      return;
    }
    if (this.late && this.late.id === m.id) {
      const l = this.late;
      this.late = null;
      // The command did run after all: edits exist whatever the caller was told.
      if (m.ok === true && !l.readOnly) {
        this.agentOkSeq++;
        this.setPending(true);
      }
    }
  }

  private async finish(f: NonNullable<ControlHost["inflight"]>, m: { ok: unknown; result?: unknown; error?: unknown; code?: unknown }): Promise<void> {
    f.settle(await this.reply(f, m));
  }

  /** `ok:false` of the frame: a shim `unsupported` becomes the update hint, `not-ready` stays, everything else is the app's error. */
  private frameFailure(m: { error?: unknown; code?: unknown }): ControlReply {
    if (m.code === "unsupported") return this.fail("unsupported", this.unsupportedMessage());
    const code: ControlErrorCode = m.code === "not-ready" ? "not-ready" : "app_error";
    return this.fail(code, typeof m.error === "string" ? m.error : "The app reported an error.");
  }

  /** Method-specific shaping of a good result (screenshot → JPEG, commands → allowlist), or a failure reply. */
  private async shape(method: string, result: unknown): Promise<{ result: unknown } | ControlReply> {
    if (method === "ui.screenshot") {
      const shot = await processScreenshot(result, { maxRawBytes: this.d.maxBytes, ...this.d.screenshot });
      if (shot.ok) return { result: shot.result };
      return this.fail(shot.kind === "too-large" ? "reply_too_large" : "app_error", shot.message);
    }
    return { result: method === "engine.commands" ? this.filterCommands(result) : result };
  }

  private async reply(f: NonNullable<ControlHost["inflight"]>, m: { ok: unknown; result?: unknown; error?: unknown; code?: unknown }): Promise<ControlReply> {
    if (typeof m.ok !== "boolean") return this.fail("app_error", "The editor's reply was malformed.");
    if (!m.ok) return this.frameFailure(m);
    if (jsonBytes(m.result) === null) return this.fail("app_error", "The editor's reply was malformed.");
    const shaped = await this.shape(f.method, m.result);
    if (!("result" in shaped)) return shaped;
    const bytes = jsonBytes(shaped.result);
    if (bytes === null) return this.fail("app_error", "The editor's reply was malformed.");
    if (bytes > REPLY_MAX_BYTES) return this.fail("reply_too_large", `The reply is larger than ${REPLY_MAX_BYTES / 1024} KiB. Ask for less.`);
    if (!f.readOnly) this.agentOkSeq++;
    return { ok: true, instance: this.instanceId, result: shaped.result, ...(f.save ? { saveRequested: true as const, saveSeq: f.saveSeq } : {}) };
  }

  /** `engine.commands` lists only what this host would forward (the full table of an app is far over the reply cap). */
  private filterCommands(result: unknown): unknown {
    const allowed = new Set(this.d.profile?.allowedCommands ?? []);
    if (!Array.isArray(result)) return result;
    return result.filter((c) => isPlain(c) && typeof c.id === "string" && allowed.has(c.id)).map((c) => ({ id: c.id, label: c.label, params: c.params, enabled: c.enabled }));
  }

  dispose(): void {
    if (this.inflight) {
      clearTimeout(this.inflight.timer);
      const f = this.inflight;
      this.inflight = null;
      f.settle(this.fail("not-open", "The editor closed while the request was running."));
    }
  }
}
