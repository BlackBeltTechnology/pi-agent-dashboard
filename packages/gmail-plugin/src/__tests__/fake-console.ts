/**
 * `FakeConsole`: a page model of the Google Cloud console behind a fake CDP
 * socket (`WsLike`). Role + accessible-name AX nodes per page, scripted
 * transitions driven by clicks/fills, a creation dialog holding a `GOCSPX-`
 * secret, and injectable faults. It answers the CDP commands `CdpPage` sends and
 * records every command, event, navigation, click and fill so tests can assert
 * ordering (e.g. `Fetch.failRequest` before any `Page.frameNavigated`).
 * See change: add-gmail-auto-setup.
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import type { WsFactory, WsLike } from "../server/setup/cdp-page.js";
import { EXPR } from "../server/setup/cdp-page.js";
import { PATHS } from "../server/setup/steps.js";

export interface AxSpec {
  role: string;
  name: string;
  checked?: boolean;
  onClick?: () => void;
  onFill?: (text: string) => void;
}

export interface PageModel {
  text?: string;
  lang?: string;
  ax?: AxSpec[];
}

export interface LogEntry {
  kind: "cmd" | "event";
  method: string;
  params?: Record<string, unknown>;
  sessionId?: string;
}

const CONSOLE = "https://console.cloud.google.com";
const SIGN_IN_URL = "https://accounts.google.com/signin";

export class FakeConsole {
  // ── world state (tests set these) ──
  projectExists = false;
  projectId = "";
  org: string | null = null;
  apiEnabled = false;
  userType: "internal" | "external" | null = null;
  published = false;
  clients: string[] = [];
  signedIn = true;
  termsPending = false;
  policyChecked = false;
  secret = "GOCSPX-test_Secret-0123456789";
  clientId = "1234-abc.apps.googleusercontent.com";
  dialogOpen = false;
  publishDialogOpen = false;
  /** The option the support-email dropdown offers. */
  ownerEmail = "owner@example.com";

  // ── injectable faults ──
  /** Replace the page for a URL (unknown page, `lang="hu"`, …). */
  override?: (u: URL) => PageModel | undefined;
  /** `Page.navigate` answers a CDP error (deny set / allowed domains). */
  denyNavigation?: (u: URL) => boolean;
  /** A command that never gets an answer (a hung step). */
  hang?: (method: string, u: URL) => boolean;
  /** Runs when a navigation arrives, before it is applied. */
  beforeNavigate?: (u: URL) => void;
  /** The dialog text read fails (forces the JSON fallback). */
  dialogReadThrows = false;
  /** "Download JSON" writes a file (false → nothing downloads). */
  downloadWorks = true;
  /** What "Download JSON" writes (default: a Desktop client JSON for this client). */
  downloadJson?: unknown;
  /** Runs when the policy checkbox is first rendered into an AX answer. */
  onPolicyBoxQueried?: () => void;

  // ── recording ──
  readonly log: LogEntry[] = [];
  readonly clicks: string[] = [];
  readonly navigations: string[] = [];
  readonly fills: Array<{ name: string; text: string }> = [];
  /** `Date.now()` of every keep-alive `Runtime.evaluate("1")`. */
  readonly keepAlives: number[] = [];
  /** Socket closed by the browser side (`serverClose`) or by the client. */
  socketClosed = false;
  url = "about:blank";

  private panel = 0;
  private audienceChoice: "internal" | "external" = "external";
  private appType = "";
  private clientName = "";
  private projectName = "";
  private projectIdEditing = false;
  private fetchArmed = false;
  private pausedNav?: { id: number; requestId: string };
  private seq = 0;
  private readonly nodes = new Map<number, AxSpec>();
  private lastBox?: AxSpec;
  private focused?: AxSpec;
  private downloads = 0;
  private policyQueried = false;
  private listeners: { message?: (d: unknown) => void; close?: () => void; open?: () => void; error?: () => void } = {};

  private readonly downloadsDir: string;

  constructor(downloadsDir = "/nonexistent") {
    this.downloadsDir = downloadsDir;
  }

  // ───────────── test helpers ─────────────

  /** Pre-existing project (existing mode). */
  withProject(id: string, org: string | null = null): this {
    this.projectExists = true;
    this.projectId = id;
    this.org = org;
    return this;
  }

  confirmPublish(): void {
    this.publishDialogOpen = false;
    this.published = true;
  }

  cancelPublish(): void {
    this.publishDialogOpen = false;
  }

  /** The browser side closes the socket (idle sweep, kill switch, window closed). */
  serverClose(): void {
    this.socketClosed = true;
    this.listeners.close?.();
  }

  /** Commands of `method` in order. */
  commands(method: string): LogEntry[] {
    return this.log.filter((e) => e.kind === "cmd" && e.method === method);
  }

  readonly wsFactory: WsFactory = () => this.socket();

  // ───────────── socket ─────────────

  private socket(): WsLike {
    const sock: WsLike = {
      send: (data) => void Promise.resolve().then(() => this.handle(JSON.parse(data))),
      close: () => {
        this.socketClosed = true;
        this.listeners.close?.();
      },
      on: ((event: string, cb: (d?: unknown) => void) => {
        (this.listeners as Record<string, unknown>)[event] = cb;
        if (event === "open") void Promise.resolve().then(() => cb());
        return sock;
      }) as WsLike["on"],
    };
    return sock;
  }

  private emit(msg: Record<string, unknown>): void {
    if (this.socketClosed) return;
    this.listeners.message?.(JSON.stringify(msg));
  }

  private reply(id: number, result: Record<string, unknown> = {}): void {
    this.emit({ id, result });
  }

  private event(method: string, params: Record<string, unknown>): void {
    this.log.push({ kind: "event", method, params });
    this.emit({ method, params, sessionId: "S1" });
  }

  // ───────────── CDP ─────────────

  private handle(msg: { id: number; method: string; params?: Record<string, any>; sessionId?: string }): void {
    const { id, method, params = {} } = msg;
    this.log.push({ kind: "cmd", method, params, sessionId: msg.sessionId });
    let u: URL;
    try {
      u = new URL(this.url);
    } catch {
      u = new URL("about:blank");
    }
    if (this.hang?.(method, u)) return;
    switch (method) {
      case "Target.createTarget":
        return this.reply(id, { targetId: "T1" });
      case "Target.attachToTarget":
        return this.reply(id, { sessionId: "S1" });
      case "Fetch.enable":
        this.fetchArmed = true;
        return this.reply(id);
      case "Fetch.failRequest": {
        if (this.pausedNav && this.pausedNav.requestId === params.requestId) {
          this.reply(this.pausedNav.id, { errorText: "net::ERR_BLOCKED_BY_CLIENT" });
          this.pausedNav = undefined;
        }
        return this.reply(id);
      }
      case "Page.navigate":
        return this.navigate(id, String(params.url));
      case "Runtime.evaluate":
        return this.evaluate(id, String(params.expression));
      case "DOM.getDocument":
        return this.reply(id, { root: { nodeId: 1 } });
      case "Accessibility.queryAXTree":
        return this.queryAx(id, String(params.role), String(params.accessibleName));
      case "DOM.getBoxModel": {
        this.lastBox = this.nodes.get(Number(params.backendNodeId));
        return this.reply(id, { model: { content: [10, 10, 20, 10, 20, 20, 10, 20] } });
      }
      case "Input.dispatchMouseEvent": {
        if (params.type === "mouseReleased" && this.lastBox) {
          const spec = this.lastBox;
          this.clicks.push(`${spec.role}:${spec.name}`);
          spec.onClick?.();
        }
        return this.reply(id);
      }
      case "DOM.resolveNode":
        this.focused = this.nodes.get(Number(params.backendNodeId));
        return this.reply(id, { object: { objectId: `obj-${String(params.backendNodeId)}` } });
      case "Input.insertText": {
        if (this.focused) {
          this.fills.push({ name: this.focused.name, text: String(params.text) });
          this.focused.onFill?.(String(params.text));
        }
        return this.reply(id);
      }
      case "Target.closeTarget":
      case "Page.enable":
      case "DOM.enable":
      case "Accessibility.enable":
      case "DOM.scrollIntoViewIfNeeded":
      case "Runtime.callFunctionOn":
      case "Page.bringToFront":
        return this.reply(id);
      default:
        return this.emit({ id, error: { code: -32601, message: "unknown method" } });
    }
  }

  private navigate(id: number, url: string): void {
    const u = new URL(url);
    this.navigations.push(url);
    if (this.denyNavigation?.(u)) return this.emit({ id, error: { code: -32000, message: "denied" } });
    this.beforeNavigate?.(u);
    if (u.origin === CONSOLE && !this.signedIn) {
      if (this.fetchArmed) {
        const requestId = `req-${++this.seq}`;
        this.pausedNav = { id, requestId };
        this.event("Fetch.requestPaused", { requestId, request: { url: SIGN_IN_URL }, resourceType: "Document" });
        return; // answered on Fetch.failRequest
      }
      this.url = SIGN_IN_URL;
      this.event("Page.frameNavigated", { frame: { url: SIGN_IN_URL } });
      return this.reply(id, { frameId: "F1" });
    }
    this.url = url;
    if (u.pathname === PATHS.brandingCreate) this.panel = 0;
    if (u.pathname === PATHS.projectCreate) this.projectIdEditing = false;
    this.reply(id, { frameId: "F1" });
  }

  private evaluate(id: number, expression: string): void {
    const page = this.page();
    const value = (v: unknown) => this.reply(id, { result: { type: "object", value: v } });
    switch (expression) {
      case EXPR.ping:
        this.keepAlives.push(Date.now());
        return value(1);
      case EXPR.info:
        return value({ href: this.url, lang: page.lang ?? "en", ready: "complete" });
      case EXPR.text:
        return value(page.text ?? "");
      case EXPR.dialogText:
        if (this.dialogReadThrows) return this.reply(id, { exceptionDetails: { text: "boom" } });
        return value(this.dialogOpen ? `OAuth client created\nClient ID\n${this.clientId}\nClient secret\n${this.secret}\n` : "");
      default:
        return this.emit({ id, error: { code: -32000, message: "unexpected expression" } });
    }
  }

  private queryAx(id: number, role: string, name: string): void {
    const spec = (this.page().ax ?? []).find((a) => a.role === role && a.name === name);
    if (!spec) return this.reply(id, { nodes: [] });
    if (spec.role === "checkbox" && !this.policyQueried) {
      this.policyQueried = true;
      this.onPolicyBoxQueried?.();
    }
    const backendDOMNodeId = ++this.seq;
    this.nodes.set(backendDOMNodeId, spec);
    const properties =
      spec.checked === undefined ? [] : [{ name: "checked", value: { type: "tristate", value: spec.checked ? "true" : "false" } }];
    this.reply(id, { nodes: [{ role: { value: role }, name: { value: name }, backendDOMNodeId, properties }] });
  }

  // ───────────── page model ─────────────

  private page(): PageModel {
    let u: URL;
    try {
      u = new URL(this.url);
    } catch {
      u = new URL("about:blank");
    }
    const base = this.override?.(u) ?? this.route(u);
    const ax = [...(base.ax ?? [])];
    if (this.termsPending) ax.push({ role: "button", name: "Agree and continue" });
    if (this.dialogOpen) {
      ax.push(
        { role: "dialog", name: "OAuth client created" },
        {
          role: "button",
          name: "Download JSON",
          onClick: () => {
            if (!this.downloadWorks) return;
            const file = path.join(this.downloadsDir, `client_secret_${++this.downloads}.json`);
            writeFileSync(file, JSON.stringify(this.downloadJson ?? { installed: { client_id: this.clientId, client_secret: this.secret } }));
          },
        },
        { role: "button", name: "OK", onClick: () => void (this.dialogOpen = false) },
      );
    }
    return { ...base, ax };
  }

  private route(u: URL): PageModel {
    switch (u.pathname) {
      case PATHS.projectInfo:
        return this.projectInfoPage(u.searchParams.get("project"));
      case PATHS.projectCreate:
        return this.projectCreatePage();
      case PATHS.apiOverview:
        return {
          text: "Gmail API",
          ax: this.apiEnabled
            ? [{ role: "button", name: "Disable API" }]
            : [{ role: "button", name: "Enable", onClick: () => void (this.apiEnabled = true) }],
        };
      case PATHS.audience:
        return this.audiencePage();
      case PATHS.brandingCreate:
        return this.brandingForm();
      case PATHS.branding:
        return {
          text: "Branding",
          ax: [
            { role: "textbox", name: "Application home page" },
            { role: "textbox", name: "Application privacy policy link" },
            { role: "button", name: "Add domain" },
            { role: "textbox", name: "Authorized domain 1" },
            { role: "button", name: "Save" },
          ],
        };
      case PATHS.clients:
        return { text: `OAuth 2.0 Client IDs\n${this.clients.join("\n")}`, ax: [{ role: "button", name: "Create client" }] };
      case PATHS.clientCreate:
        return this.clientCreatePage();
      default:
        return { text: "", ax: [] };
    }
  }

  private projectInfoPage(param: string | null): PageModel {
    if (!(this.projectExists && param === this.projectId)) return { text: "The project could not be found" };
    const org = this.org ? `Organization\n${this.org}` : "No organization";
    return { text: `Project name\nPi\nProject ID\n${this.projectId}\n${org}` };
  }

  private projectCreatePage(): PageModel {
    return {
      text: "New Project",
      ax: [
        { role: "textbox", name: "Project name", onFill: (t) => void (this.projectName = t) },
        { role: "button", name: "Edit", onClick: () => void (this.projectIdEditing = true) },
        ...(this.projectIdEditing
          ? [{ role: "textbox", name: "Project ID", onFill: (t: string) => void (this.projectId = t) }]
          : []),
        {
          role: "button",
          name: "Create",
          onClick: () => {
            this.projectExists = true;
          },
        },
      ],
    };
  }

  private audiencePage(): PageModel {
    if (!this.userType) return { text: "Google Auth Platform not configured yet", ax: [{ role: "button", name: "Get started" }] };
    return {
      text: `User type\n${this.userType === "internal" ? "Internal" : "External"}\nPublishing status\n${this.published ? "In production" : "Testing"}`,
      ax: [
        ...(this.userType === "external" && !this.published
          ? [{ role: "button", name: "Publish app", onClick: () => void (this.publishDialogOpen = true) }]
          : []),
        ...(this.publishDialogOpen ? [{ role: "dialog", name: "Push to production?" }] : []),
      ],
    };
  }

  private clientCreatePage(): PageModel {
    return {
      text: "Create OAuth client ID",
      ax: [
        { role: "combobox", name: "Application type" },
        { role: "option", name: "Desktop app", onClick: () => void (this.appType = "desktop") },
        { role: "textbox", name: "Name", onFill: (t) => void (this.clientName = t) },
        {
          role: "button",
          name: "Create",
          onClick: () => {
            this.clients.push(this.clientName);
            this.dialogOpen = true;
          },
        },
      ],
    };
  }

  private brandingForm(): PageModel {
    const next: AxSpec = { role: "button", name: "Next", onClick: () => void this.panel++ };
    switch (this.panel) {
      case 0:
        return {
          text: "App Information",
          ax: [
            { role: "textbox", name: "App name" },
            { role: "combobox", name: "User support email" },
            { role: "option", name: this.ownerEmail },
            next,
          ],
        };
      case 1:
        return {
          text: "Audience",
          ax: [
            { role: "radio", name: "Internal", onClick: () => void (this.audienceChoice = "internal") },
            { role: "radio", name: "External", onClick: () => void (this.audienceChoice = "external") },
            next,
          ],
        };
      case 2:
        return { text: "Contact Information", ax: [{ role: "textbox", name: "Email addresses" }, next] };
      default:
        return {
          text: "Finish",
          ax: [
            { role: "checkbox", name: "I agree to the Google API Services: User Data Policy", checked: this.policyChecked },
            { role: "button", name: "Continue" },
            { role: "button", name: "Create", onClick: () => void (this.userType = this.audienceChoice) },
          ],
        };
    }
  }
}
