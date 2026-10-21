/**
 * Setup run engine (design D3–D5, D8, D9): one live run per dashboard, held in
 * memory. A run connects the dedicated browser (private + ephemeral), drives the
 * six-step recipe over CDP, pauses on human checkpoints and decisions, and ends
 * `done`, `handoff` or `cancelled`. The run view is secret-free by construction:
 * it never carries the client secret or the browser instance id.
 * See change: add-gmail-auto-setup.
 */
import { randomUUID } from "node:crypto";
import {
  type Audience,
  type BrowserRefusalReason,
  type CheckpointKind,
  type HandoffReason,
  SETUP_STEP_IDS,
  type SetupContinueRequest,
  type SetupDecision,
  type SetupRunRequest,
  type SetupRunState,
  type SetupRunView,
  type SetupStepId,
  type SetupStepStatus,
  WIZARD_STEP_OF,
} from "../../shared/auto-setup.js";
import type { AccountStore } from "../accounts.js";
import { storeClient } from "../store-client.js";
import type { DedicatedBrowserService } from "./browser-service.js";
import { captureClient } from "./capture.js";
import { type AxNode, CdpConnection, CdpError, CdpPage, defaultWsFactory, NavigationError, type PageInfo, type WsFactory } from "./cdp-page.js";
import { RunAborted, SetupControl, SetupHandoff, SignInRequired } from "./errors.js";
import { maskSecrets } from "./mask.js";
import {
  buildSteps,
  DEFAULT_TIMING,
  generateProjectId,
  REQUIRED_DOMAINS,
  SEL,
  type Sel,
  SIGN_IN_ORIGIN,
  type StepDef,
  type StepEnv,
  type StepFacts,
  type Timing,
  validateLinks,
} from "./steps.js";

export interface RunDeps {
  /** Looked up per run (and per signed-in action): the browser plugin may load later. */
  getService(): DedicatedBrowserService | undefined;
  store: AccountStore;
  logger: { info(m: string): void; warn(m: string): void };
  /** Persist the run's inputs to the plugin config (`projectId`, `ownerAccount`). */
  saveSetup(partial: { projectId: string; ownerAccount: string }): Promise<void>;
  timing?: Partial<Timing>;
  wsFactory?: WsFactory;
  newId?: () => string;
}

export type ContinueResult = { ok: true } | { ok: false; status: 400 | 409; error: string };

type PendingDecision = { decision: SetupDecision; resolve(a: SetupContinueRequest): void };

const badRequest = (error: string): ContinueResult => ({ ok: false, status: 400, error });

/** Poll a checkpoint predicate; a transient CDP error counts as "not done yet". */
async function untilTolerantOfCdp(until: () => Promise<boolean>): Promise<boolean> {
  try {
    return await until();
  } catch (err) {
    if (err instanceof CdpError) return false;
    throw err;
  }
}

/** Validate a human answer against the pending decision; resolves it on success (400 keeps the run waiting). */
function answerDecision(pd: PendingDecision, body: SetupContinueRequest): ContinueResult {
  const { decision } = pd;
  if (decision.kind === "audience") {
    const audience: Audience | undefined = body.audience === "internal" || body.audience === "external" ? body.audience : undefined;
    if (!audience) return badRequest("invalid_audience");
    if (audience === "internal" && decision.detected !== "internal") return badRequest("audience_not_allowed");
    pd.resolve({ audience });
    return { ok: true };
  }
  if (body.confirmLinks !== true) return badRequest("confirm_required");
  const v = validateLinks(body.links ?? decision.links);
  if (!v.ok) return badRequest(v.error);
  pd.resolve({ links: v.links, confirmLinks: true });
  return { ok: true };
}

const BROWSER_REFUSALS: readonly string[] = [
  "disabled",
  "unloaded",
  "no-chrome",
  "no-display",
  "owned-by-other-server",
  "profile-in-use",
  "launch-failed",
] satisfies BrowserRefusalReason[];

function refusalReason(reason: string, fallback: HandoffReason): HandoffReason {
  return BROWSER_REFUSALS.includes(reason) ? (reason as BrowserRefusalReason) : fallback;
}

const STEPS = buildSteps(captureClient);

const TERMINAL: readonly SetupRunState[] = ["done", "handoff", "cancelled"];

interface Deferred<T> {
  promise: Promise<T>;
  resolve(v: T): void;
  reject(e: unknown): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  promise.catch(() => undefined); // losers of a race must not be unhandled
  return { promise, resolve, reject };
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** The dedicated browser's CDP endpoint is always the dashboard's own loopback socket. */
function isLoopbackCdpUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === "ws:" && (u.hostname === "127.0.0.1" || u.hostname === "localhost" || u.hostname === "[::1]");
  } catch {
    return false;
  }
}

/** Reject when `fn` does not settle in `ms` (a Chrome that never answers must not wedge the single run slot). */
async function withTimeout(ms: number, fn: () => Promise<void>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      fn(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new SetupHandoff("browser_closed", "project")), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** A pausable step limit: human waits do not count against the 60 s. */
class StepClock {
  readonly expired = deferred<never>();
  private remaining: number;
  private startedAt = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private stopped = false;
  constructor(ms: number) {
    this.remaining = ms;
    this.resume();
  }
  pause(): void {
    if (this.timer === undefined) return;
    clearTimeout(this.timer);
    this.timer = undefined;
    this.remaining -= Date.now() - this.startedAt;
  }
  resume(): void {
    if (this.stopped || this.timer !== undefined) return;
    this.startedAt = Date.now();
    this.timer = setTimeout(() => this.expired.reject(new SetupHandoff("timeout")), Math.max(0, this.remaining));
  }
  stop(): void {
    this.stopped = true;
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }
}

/** One pass of a step; replaced after a sign-in interruption. */
interface Attempt {
  dead: boolean;
  clock: StepClock;
  interrupt: Deferred<never>;
}

export interface RunInput {
  mode: SetupRunRequest["mode"];
  projectId: string;
  ownerEmail: string;
}

export class SetupRun {
  readonly id: string;
  readonly input: RunInput;
  readonly timing: Timing;
  /** Resolves when the run has fully ended and released the browser (tests, cancel). */
  settled: Promise<void> = Promise.resolve();

  // — state surfaced in the view —
  state: SetupRunState = "starting";
  private step: SetupStepId = "project";
  private readonly statuses = new Map<SetupStepId, SetupStepStatus>(SETUP_STEP_IDS.map((id) => [id, "pending"]));
  private checkpoint?: CheckpointKind;
  private decision?: SetupDecision;
  private busyHolder?: string;
  private handoff?: SetupRunView["handoff"];
  readonly created: { projectId?: string; clients: string[] } = { clients: [] };
  clientId?: string;
  readonly facts: StepFacts = {};

  // — internals shared with the step environment —
  /** @internal */ ended = false;
  /** @internal */ page?: CdpPage;
  /** @internal */ service?: DedicatedBrowserService;
  /** @internal */ signInPending = false;
  /** @internal */ readonly deps: RunDeps;
  private conn?: CdpConnection;
  private instanceId?: string;
  private closing = false;
  private cleanupP?: Promise<void>;
  private readonly abort = deferred<never>();
  private abortErr?: SetupControl;
  private attempt?: Attempt;
  private inHumanWait = false;
  private signInContinue = false;
  private pendingDecision?: PendingDecision;
  private takeoverRequested = deferred<void>();
  private keepAlive?: ReturnType<typeof setInterval>;
  private stepStart = Date.now();

  constructor(deps: RunDeps, input: RunInput) {
    this.deps = deps;
    this.input = input;
    this.id = (deps.newId ?? randomUUID)();
    this.timing = { ...DEFAULT_TIMING, ...deps.timing };
  }

  get terminal(): boolean {
    return TERMINAL.includes(this.state);
  }

  start(): void {
    this.settled = this.main();
  }

  view(): SetupRunView {
    const v: SetupRunView = {
      runId: this.id,
      state: this.state,
      step: this.step,
      steps: SETUP_STEP_IDS.map((id) => ({ id, status: this.statuses.get(id) ?? "pending" })),
      projectId: this.input.projectId,
      created: { ...(this.created.projectId ? { projectId: this.created.projectId } : {}), clients: [...this.created.clients] },
      ownerEmail: this.input.ownerEmail,
    };
    if (this.checkpoint) v.checkpoint = { kind: this.checkpoint };
    if (this.decision) v.decision = this.decision;
    if (this.state === "busy") v.busy = { holder: this.busyHolder };
    if (this.handoff) v.handoff = this.handoff;
    if (this.clientId) v.clientId = this.clientId;
    if (this.facts.audience) v.audience = this.facts.audience;
    return v;
  }

  /** Answer a decision or acknowledge the sign-in checkpoint. 400 keeps the run waiting. */
  continue(body: SetupContinueRequest): ContinueResult {
    const pd = this.pendingDecision;
    if (this.state === "waiting_decision" && pd) return answerDecision(pd, body);
    if (this.state === "waiting_user" && this.checkpoint === "sign_in") {
      this.signInContinue = true;
      return { ok: true };
    }
    return { ok: false, status: 409, error: "not_waiting" };
  }

  /** Confirmed takeover of a busy dedicated profile. */
  takeover(): ContinueResult {
    if (this.state !== "busy") return { ok: false, status: 409, error: "not_busy" };
    this.takeoverRequested.resolve();
    return { ok: true };
  }

  async cancel(): Promise<void> {
    if (this.ended) return;
    this.ended = true;
    this.state = "cancelled";
    this.checkpoint = undefined;
    this.decision = undefined;
    this.deps.logger.info("[gmail] setup run cancelled");
    this.abortWith(new RunAborted());
    await this.cleanup();
  }

  // ───────────────────────── main flow ─────────────────────────

  private async main(): Promise<void> {
    try {
      await this.deps.saveSetup({ projectId: this.input.projectId, ownerAccount: this.input.ownerEmail }).catch(() => undefined);
      await this.connectBrowser();
      this.state = "running";
      for (const def of STEPS) await this.runStep(def);
      this.ended = true;
      this.state = "done";
      this.deps.logger.info("[gmail] setup run done");
    } catch (err) {
      this.fail(err);
    } finally {
      await this.cleanup();
    }
  }

  private fail(err: unknown): void {
    if (this.state === "cancelled") return;
    const cause = this.abortErr instanceof SetupHandoff ? this.abortErr : err;
    if (cause instanceof RunAborted) return;
    let reason: HandoffReason = "unexpected_page";
    let step = this.step;
    if (cause instanceof SetupHandoff) {
      reason = cause.reason;
      step = cause.step ?? this.step;
    } else {
      // Class name only: a message could carry page content.
      this.deps.logger.warn(maskSecrets(`[gmail] setup run error: ${cause instanceof Error ? cause.name : "unknown"}`));
    }
    this.ended = true;
    this.step = step;
    this.statuses.set(step, "handoff");
    this.handoff = {
      step,
      wizardStep: WIZARD_STEP_OF[step],
      reason,
      ...(reason === "domain_blocked" ? { domains: [...REQUIRED_DOMAINS] } : {}),
    };
    this.checkpoint = undefined;
    this.decision = undefined;
    this.state = "handoff";
    this.logStep(step, `handoff:${reason}`);
  }

  private logStep(id: SetupStepId, outcome: string): void {
    this.deps.logger.info(maskSecrets(`[gmail] setup step ${id} ${outcome} ${Date.now() - this.stepStart}ms`));
  }

  private abortWith(err: SetupControl): void {
    this.abortErr ??= err;
    this.abort.reject(err);
  }

  private async connectBrowser(): Promise<void> {
    const service = this.deps.getService();
    if (!service) throw new SetupHandoff("unloaded", "project");
    this.service = service;
    let res = await service.connect({ client: "gmail-setup", private: true, ephemeral: true });
    if (!res.ok && res.reason === "busy") {
      // The holder's instance id stays server-side; the view only names the holder.
      this.busyHolder = res.holder;
      this.state = "busy";
      await Promise.race([this.takeoverRequested.promise, this.abort.promise]);
      this.state = "starting";
      res = await service.connect({ client: "gmail-setup", takeover: true, private: true, ephemeral: true });
    }
    if (this.ended) {
      if (res.ok) await service.disconnect(res.instanceId).catch(() => undefined);
      throw new RunAborted();
    }
    if (!res.ok) throw new SetupHandoff(refusalReason(res.reason, "launch-failed"), "project");
    this.instanceId = res.instanceId;
    try {
      if (!isLoopbackCdpUrl(res.cdpUrl)) throw new SetupHandoff("launch-failed", "project");
      await withTimeout(this.timing.stepLimitMs, async () => {
        this.conn = await CdpConnection.connect(res.cdpUrl, this.deps.wsFactory ?? defaultWsFactory);
        this.conn.onClose(() => {
          if (!this.closing && !this.ended) this.abortWith(new SetupHandoff("browser_closed"));
        });
        this.page = await CdpPage.open(this.conn, { onSignInBlocked: () => this.onSignInBlocked() });
      });
    } catch (err) {
      if (err instanceof SetupControl) throw err;
      throw new SetupHandoff("browser_closed", "project");
    }
    // The browser plugin's idle sweep must never close a run that is waiting on a human.
    this.keepAlive = setInterval(() => void this.page?.ping().catch(() => undefined), this.timing.keepAliveMs);
    this.keepAlive.unref?.();
  }

  private onSignInBlocked(): void {
    this.signInPending = true;
    if (!this.inHumanWait && this.attempt) this.attempt.interrupt.reject(new SignInRequired());
  }

  private async runStep(def: StepDef): Promise<void> {
    this.step = def.id;
    this.statuses.set(def.id, "running");
    this.stepStart = Date.now();
    for (;;) {
      if (this.abortErr) throw this.abortErr;
      if (this.signInPending) await Promise.race([this.signInCheckpoint(), this.abort.promise]);
      const attempt: Attempt = { dead: false, clock: new StepClock(this.timing.stepLimitMs), interrupt: deferred<never>() };
      this.attempt = attempt;
      try {
        const outcome = await Promise.race([
          this.execute(def, new AttemptEnv(this, attempt)),
          attempt.clock.expired.promise,
          attempt.interrupt.promise,
          this.abort.promise,
        ]);
        this.statuses.set(def.id, outcome);
        this.logStep(def.id, outcome);
        return;
      } catch (err) {
        if (err instanceof SignInRequired) continue; // loop top runs the checkpoint, then the step restarts
        throw err;
      } finally {
        attempt.dead = true;
        attempt.clock.stop();
      }
    }
  }

  private async execute(def: StepDef, env: StepEnv): Promise<"done" | "skipped"> {
    if (await def.check(env)) return "skipped";
    await def.act(env);
    if (!(await def.verify(env))) throw new SetupHandoff("unexpected_page");
    return "done";
  }

  // ───────────────────────── human waits ─────────────────────────

  /** @internal Run `fn` with the step clock paused and sign-in interrupts deferred. */
  async humanWait(attempt: Attempt, fn: () => Promise<void>): Promise<void> {
    attempt.clock.pause();
    this.inHumanWait = true;
    try {
      await fn();
    } finally {
      this.inHumanWait = false;
      attempt.clock.resume();
    }
    if (this.signInPending) throw new SignInRequired();
  }

  /** @internal */
  async runCheckpoint(
    attempt: Attempt,
    kind: CheckpointKind,
    until: () => Promise<boolean>,
    opts?: { front?: boolean },
  ): Promise<void> {
    await this.humanWait(attempt, async () => {
      this.state = "waiting_user";
      this.checkpoint = kind;
      try {
        if (opts?.front) await this.page?.bringToFront().catch(() => undefined);
        await this.pollCheckpoint(attempt, until);
      } finally {
        this.checkpoint = undefined;
        if (!this.ended) this.state = "running";
      }
    });
  }

  /** Poll `until` every `pollMs` until true; times out into a handoff, aborts when the attempt/run dies. */
  private async pollCheckpoint(attempt: Attempt, until: () => Promise<boolean>): Promise<void> {
    const deadline = Date.now() + this.timing.checkpointLimitMs;
    for (;;) {
      if (await untilTolerantOfCdp(until)) return;
      if (Date.now() >= deadline) throw new SetupHandoff("timeout");
      await sleep(this.timing.pollMs);
      if (attempt.dead || this.ended) throw new RunAborted();
    }
  }

  /** @internal */
  async runDecision(attempt: Attempt, decision: SetupDecision): Promise<SetupContinueRequest> {
    let answer: SetupContinueRequest = {};
    await this.humanWait(attempt, async () => {
      this.state = "waiting_decision";
      this.decision = decision;
      try {
        answer = await new Promise<SetupContinueRequest>((resolve) => {
          this.pendingDecision = { decision, resolve };
        });
      } finally {
        this.pendingDecision = undefined;
        this.decision = undefined;
        if (!this.ended) this.state = "running";
      }
    });
    return answer;
  }

  /**
   * Sign-in checkpoint (design D5): the run's own tab goes to `about:blank`; the
   * Google sign-in page opens in a hidden tab of the run's ephemeral context.
   * The run tab stays blank until that tab's origin leaves accounts.google.com
   * or the user confirms, so no tab the run can read ever renders a password form.
   */
  private async signInCheckpoint(): Promise<void> {
    const service = this.service;
    const page = this.page;
    if (!service || !page || !this.instanceId) throw new SetupHandoff("browser_closed");
    this.inHumanWait = true;
    this.state = "waiting_user";
    this.checkpoint = "sign_in";
    try {
      await page.navigate("about:blank").catch(() => undefined);
      const q = new URLSearchParams({
        service: "cloudconsole",
        continue: "https://console.cloud.google.com/",
        login_hint: this.input.ownerEmail,
        hl: "en",
      });
      const opened = await service.open({ url: `${SIGN_IN_ORIGIN}/ServiceLogin?${q.toString()}`, instanceId: this.instanceId });
      if (!opened.ok) throw new SetupHandoff(refusalReason(opened.reason, "domain_blocked"));
      await service.focus(opened.tabId).catch(() => undefined);
      const deadline = Date.now() + this.timing.checkpointLimitMs;
      for (;;) {
        if (this.ended) throw new RunAborted();
        if (this.signInContinue) return;
        if ((await service.tabOrigin(opened.tabId)) !== SIGN_IN_ORIGIN) return;
        if (Date.now() >= deadline) throw new SetupHandoff("timeout");
        await sleep(this.timing.pollMs);
      }
    } finally {
      this.signInPending = false;
      this.signInContinue = false;
      this.inHumanWait = false;
      this.checkpoint = undefined;
      if (!this.ended) this.state = "running";
    }
  }

  // ───────────────────────── teardown ─────────────────────────

  private cleanup(): Promise<void> {
    this.cleanupP ??= (async () => {
      if (this.keepAlive) clearInterval(this.keepAlive);
      this.closing = true;
      this.conn?.close();
      // Only an instance this run connected; a busy holder's instance is never ours to close.
      if (this.instanceId) await this.service?.disconnect(this.instanceId).catch(() => undefined);
    })();
    return this.cleanupP;
  }
}

/** The capability surface a step attempt sees; stale once its attempt is replaced or the run ended. */
class AttemptEnv implements StepEnv {
  private readonly run: SetupRun;
  private readonly attempt: Attempt;

  constructor(run: SetupRun, attempt: Attempt) {
    this.run = run;
    this.attempt = attempt;
  }

  get mode() {
    return this.run.input.mode;
  }
  get projectId() {
    return this.run.input.projectId;
  }
  get ownerEmail() {
    return this.run.input.ownerEmail;
  }
  get timing() {
    return this.run.timing;
  }
  get facts() {
    return this.run.facts;
  }
  get created() {
    return this.run.created;
  }

  private live(): CdpPage {
    if (this.attempt.dead || this.run.ended || !this.run.page) throw new RunAborted();
    return this.run.page;
  }

  async navigate(url: string): Promise<void> {
    try {
      await this.live().navigate(url);
    } catch (err) {
      // A navigation the redirect guard failed is a sign-in, not a refusal.
      if (err instanceof NavigationError && this.run.signInPending) throw new SignInRequired();
      throw err;
    }
  }
  info(): Promise<PageInfo> {
    return this.live().info();
  }
  text(): Promise<string> {
    return this.live().text();
  }
  dialogText(): Promise<string> {
    return this.live().dialogText();
  }
  find(sel: Sel): Promise<AxNode | undefined> {
    return this.live().queryAXTree(sel.role, sel.name);
  }
  async click(sel: Sel): Promise<void> {
    const node = await this.need(sel);
    await this.live().clickNode(node);
  }
  async fill(sel: Sel, text: string): Promise<void> {
    const node = await this.need(sel);
    await this.live().fill(node, text);
  }
  bringToFront(): Promise<void> {
    return this.live().bringToFront();
  }

  async waitFor<T>(probe: () => Promise<T | false | undefined | null>, ms: number): Promise<T | undefined> {
    const end = Date.now() + ms;
    for (;;) {
      this.live();
      try {
        const v = await probe();
        if (v) return v;
      } catch (err) {
        if (!(err instanceof CdpError)) throw err;
      }
      if (Date.now() >= end) return undefined;
      await sleep(this.timing.pollMs);
    }
  }

  async need(sel: Sel): Promise<AxNode> {
    let termsHandled = false;
    for (;;) {
      const node = await this.waitFor(() => this.find(sel), this.timing.markerWaitMs);
      if (node) return node;
      // The terms dialog can render after load: wait for the user, then look again once.
      if (!termsHandled && (await this.find(SEL.termsAgree))) {
        termsHandled = true;
        await this.checkpoint("console_terms", async () => !(await this.find(SEL.termsAgree)));
        continue;
      }
      throw new SetupHandoff("unexpected_page");
    }
  }

  checkpoint(kind: CheckpointKind, until: () => Promise<boolean>, opts?: { front?: boolean }): Promise<void> {
    this.live();
    return this.run.runCheckpoint(this.attempt, kind, until, opts);
  }

  decide(decision: SetupDecision): Promise<SetupContinueRequest> {
    this.live();
    return this.run.runDecision(this.attempt, decision);
  }

  async saveLinks(links: Parameters<StepEnv["saveLinks"]>[0]): Promise<void> {
    this.live();
    await this.run.deps.store.setSetupRecord({ links });
  }

  async downloadsDir(): Promise<string> {
    this.live();
    const status = await this.run.service?.status();
    if (!status) throw new CdpError("status");
    return status.downloadsDir;
  }

  async storeClient(json: unknown): Promise<{ ok: true; clientId: string } | { ok: false; error: string }> {
    this.live();
    const r = await storeClient(this.run.deps.store, json, this.run.deps.logger);
    if (!r.ok) return { ok: false, error: r.error };
    this.run.clientId = r.client.clientId;
    return { ok: true, clientId: r.client.clientId };
  }
}

/** Holds the runs of this dashboard process: one live, the last few kept for polling. */
export class SetupRunManager {
  private readonly runs = new Map<string, SetupRun>();
  private readonly deps: RunDeps;

  constructor(deps: RunDeps) {
    this.deps = deps;
  }

  get live(): SetupRun | undefined {
    return [...this.runs.values()].find((r) => !r.terminal);
  }

  get(id: string): SetupRun | undefined {
    return this.runs.get(id);
  }

  /** `undefined` → a run is already live. */
  start(req: { mode: RunInput["mode"]; projectId?: string; ownerEmail: string }): SetupRun | undefined {
    if (this.live) return undefined;
    const run = new SetupRun(this.deps, {
      mode: req.mode,
      projectId: req.projectId ?? generateProjectId(),
      ownerEmail: req.ownerEmail,
    });
    this.runs.set(run.id, run);
    for (const [id, r] of this.runs) {
      if (this.runs.size <= 5) break;
      if (r.terminal) this.runs.delete(id);
    }
    run.start();
    return run;
  }
}
