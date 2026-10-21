/**
 * The setup recipe: six steps, each `check` → (`act` → `verify`). Pure recipe
 * logic over the `StepEnv` capability surface the run provides, so every page
 * operation is attempt-scoped, interruptible and never logged.
 *
 * ALL console-specific strings (paths, role + accessible names, page-text
 * patterns) live in the ONE constants block below. They are English role+name
 * selectors from the design table and public knowledge of the Cloud console;
 * adjust them there when the console changes (manual verification: task 7.2).
 * Any page that does not show what a step expects is a handoff
 * `unexpected_page` — never a guess. The recipe never types a password and never
 * clicks sign-in, consent, terms, User Data Policy or publish confirmation.
 * See change: add-gmail-auto-setup.
 */
import { randomInt } from "node:crypto";
import {
  type Audience,
  type CheckpointKind,
  DEFAULT_PUBLISH_LINKS,
  type PublishLinks,
  type SetupContinueRequest,
  type SetupDecision,
  type SetupStepId,
} from "../../shared/auto-setup.js";
import type { AxNode, PageInfo } from "./cdp-page.js";
import { NavigationError } from "./cdp-page.js";
import { SetupHandoff } from "./errors.js";

// ───────────────────────── constants block (adjust here) ─────────────────────────

const CONSOLE_ORIGIN = "https://console.cloud.google.com";
export const SIGN_IN_ORIGIN = "https://accounts.google.com";
/** Domains the dedicated browser must allow; named in the `domain_blocked` hand-off. */
export const REQUIRED_DOMAINS = ["console.cloud.google.com", "accounts.google.com"] as const;

const CLIENT_NAME = "pi-dashboard";

export const PATHS = {
  projectInfo: "/iam-admin/settings",
  projectCreate: "/projectcreate",
  apiOverview: "/apis/api/gmail.googleapis.com/overview",
  audience: "/auth/audience",
  brandingCreate: "/auth/overview/create",
  branding: "/auth/branding",
  clients: "/auth/clients",
  clientCreate: "/auth/clients/create",
} as const;

export interface Sel {
  role: string;
  name: string;
}

export const SEL = {
  // project
  projectName: { role: "textbox", name: "Project name" },
  projectIdEdit: { role: "button", name: "Edit" },
  projectIdField: { role: "textbox", name: "Project ID" },
  create: { role: "button", name: "Create" },
  // api
  disableApi: { role: "button", name: "Disable API" },
  enableApi: { role: "button", name: "Enable" },
  // branding
  getStarted: { role: "button", name: "Get started" },
  appName: { role: "textbox", name: "App name" },
  supportEmail: { role: "combobox", name: "User support email" },
  next: { role: "button", name: "Next" },
  audienceInternal: { role: "radio", name: "Internal" },
  audienceExternal: { role: "radio", name: "External" },
  contactEmail: { role: "textbox", name: "Email addresses" },
  policyCheckbox: { role: "checkbox", name: "I agree to the Google API Services: User Data Policy" },
  continue: { role: "button", name: "Continue" },
  // publish
  homePage: { role: "textbox", name: "Application home page" },
  privacyPolicy: { role: "textbox", name: "Application privacy policy link" },
  addDomain: { role: "button", name: "Add domain" },
  authorizedDomain: { role: "textbox", name: "Authorized domain 1" },
  save: { role: "button", name: "Save" },
  publishApp: { role: "button", name: "Publish app" },
  publishDialog: { role: "dialog", name: "Push to production?" },
  // client
  createClient: { role: "button", name: "Create client" },
  appType: { role: "combobox", name: "Application type" },
  desktopApp: { role: "option", name: "Desktop app" },
  clientName: { role: "textbox", name: "Name" },
  clientCreatedDialog: { role: "dialog", name: "OAuth client created" },
  downloadJson: { role: "button", name: "Download JSON" },
  dialogClose: { role: "button", name: "OK" },
  // checkpoints
  termsAgree: { role: "button", name: "Agree and continue" },
} as const satisfies Record<string, Sel>;

/** Page-text patterns (read in-process; the text is never logged). */
const TEXT = {
  projectId: /Project ID\s*[:\n]?\s*([a-z][a-z0-9-]{3,}[a-z0-9])/,
  noOrganization: /No organization/i,
  organization: /Organization\s*[:\n]\s*([^\n]+)/,
  userType: /User type\s*[:\n]?\s*(Internal|External)/,
  inProduction: /In production/,
  clientNameLine: /^pi-dashboard(?:-(\d+))?[ \t]*$/gm,
} as const;

// ───────────────────────── timing ─────────────────────────

export interface Timing {
  /** Poll interval for page and checkpoint waits. */
  pollMs: number;
  /** How long a step waits for an expected marker before `unexpected_page`. */
  markerWaitMs: number;
  /** How long `verify` polls for the result. */
  verifyWaitMs: number;
  /** Per-step limit; human waits are excluded. */
  stepLimitMs: number;
  /** Per-checkpoint limit. */
  checkpointLimitMs: number;
  /** Keep-alive command interval (the browser plugin's idle sweep is 5 min). */
  keepAliveMs: number;
  /** Polls the publish dialog may be gone before it counts as cancelled. */
  publishGracePolls: number;
}

export const DEFAULT_TIMING: Timing = {
  pollMs: 1000,
  markerWaitMs: 10_000,
  verifyWaitMs: 40_000,
  stepLimitMs: 60_000,
  checkpointLimitMs: 15 * 60_000,
  keepAliveMs: 30_000,
  publishGracePolls: 5,
};

// ───────────────────────── env contract ─────────────────────────

export interface StepFacts {
  /** Parent organization of the project: name, `null` for none, undefined = not read yet. */
  org?: string | null;
  audience?: Audience;
}

/** What the run provides to a step attempt. Every method refuses once the attempt is stale. */
export interface StepEnv {
  readonly mode: "new" | "existing";
  readonly projectId: string;
  readonly ownerEmail: string;
  readonly timing: Timing;
  readonly facts: StepFacts;
  readonly created: { projectId?: string; clients: string[] };
  navigate(url: string): Promise<void>;
  info(): Promise<PageInfo>;
  text(): Promise<string>;
  dialogText(): Promise<string>;
  find(sel: Sel): Promise<AxNode | undefined>;
  click(sel: Sel): Promise<void>;
  fill(sel: Sel, text: string): Promise<void>;
  bringToFront(): Promise<void>;
  /** Poll `probe` every `pollMs` until truthy or `ms` elapsed (probe errors count as "not yet"). */
  waitFor<T>(probe: () => Promise<T | false | undefined | null>, ms: number): Promise<T | undefined>;
  /** Wait for `sel`; absent after `markerWaitMs` → handoff `unexpected_page`. */
  need(sel: Sel): Promise<AxNode>;
  /** Pause for the human until `until()` is true (15 min limit → handoff `timeout`). */
  checkpoint(kind: CheckpointKind, until: () => Promise<boolean>, opts?: { front?: boolean }): Promise<void>;
  /** Pause for a decision; the run validates the answer before resolving. */
  decide(decision: SetupDecision): Promise<SetupContinueRequest>;
  saveLinks(links: PublishLinks): Promise<void>;
  downloadsDir(): Promise<string>;
  storeClient(json: unknown): Promise<{ ok: true; clientId: string } | { ok: false; error: string }>;
}

export interface StepDef {
  id: SetupStepId;
  /** True → step already done (reported `skipped`). */
  check(env: StepEnv): Promise<boolean>;
  act(env: StepEnv): Promise<void>;
  /** False → handoff `unexpected_page`. */
  verify(env: StepEnv): Promise<boolean>;
}

// ───────────────────────── pure helpers ─────────────────────────

/** `pi-dashboard-<6 random [a-z0-9]>` — passes the plugin's single project-id rule. */
export function generateProjectId(rand: (n: number) => number = randomInt): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  let id = "";
  for (let i = 0; i < 6; i++) id += alphabet[rand(alphabet.length)];
  return `pi-dashboard-${id}`;
}

/** `pi-dashboard`, or `pi-dashboard-<n>` for the smallest free `n ≥ 2` (the bare name is n = 1). */
export function pickClientName(pageText: string): string {
  const used = new Set<number>();
  for (const m of pageText.matchAll(TEXT.clientNameLine)) used.add(m[1] ? Number(m[1]) : 1);
  let n = 1;
  while (used.has(n)) n++;
  return n === 1 ? CLIENT_NAME : `${CLIENT_NAME}-${n}`;
}

export function parseProjectFacts(text: string): { projectId?: string; org: string | null } {
  const projectId = TEXT.projectId.exec(text)?.[1];
  const org = TEXT.noOrganization.test(text) ? null : (TEXT.organization.exec(text)?.[1]?.trim() ?? null);
  return { projectId, org };
}

export function parseUserType(text: string): Audience | undefined {
  const m = TEXT.userType.exec(text)?.[1];
  return m === "Internal" ? "internal" : m === "External" ? "external" : undefined;
}

const DOMAIN_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

/** Each link `https:` with its host equal to / under the authorized domain (design D7). Returns the first problem. */
export function validateLinks(links: unknown): { ok: true; links: PublishLinks } | { ok: false; error: string } {
  if (!links || typeof links !== "object") return { ok: false, error: "links_required" };
  const l = links as Record<string, unknown>;
  if (typeof l.homePage !== "string" || typeof l.privacyPolicy !== "string" || typeof l.authorizedDomain !== "string") {
    return { ok: false, error: "links_required" };
  }
  const domain = l.authorizedDomain.trim().toLowerCase();
  if (!DOMAIN_RE.test(domain)) return { ok: false, error: "invalid_authorized_domain" };
  for (const key of ["homePage", "privacyPolicy"] as const) {
    let u: URL;
    try {
      u = new URL((l[key] as string).trim());
    } catch {
      return { ok: false, error: `invalid_${key}` };
    }
    const host = u.hostname.toLowerCase();
    if (u.protocol !== "https:" || (host !== domain && !host.endsWith(`.${domain}`))) {
      return { ok: false, error: `invalid_${key}` };
    }
  }
  return {
    ok: true,
    links: { homePage: l.homePage.trim(), privacyPolicy: l.privacyPolicy.trim(), authorizedDomain: domain },
  };
}

/** `/path` → console URL carrying `authuser`, `project` (unless suppressed) and `hl=en`. */
export function consoleUrl(env: Pick<StepEnv, "ownerEmail" | "projectId">, path: string, opts?: { noProject?: boolean }): string {
  const q = new URLSearchParams({ authuser: env.ownerEmail });
  if (!opts?.noProject) q.set("project", env.projectId);
  q.set("hl", "en");
  return `${CONSOLE_ORIGIN}${path}?${q.toString()}`;
}

// ───────────────────────── shared page actions ─────────────────────────

/**
 * Navigate, wait for load, enforce English and the console-terms checkpoint.
 * A denied navigation is `domain_blocked` — unless the redirect guard stopped
 * it, which is a sign-in.
 */
async function loadConsole(env: StepEnv, path: string, opts?: { noProject?: boolean }): Promise<void> {
  try {
    await env.navigate(consoleUrl(env, path, opts));
  } catch (err) {
    if (err instanceof NavigationError) throw new SetupHandoff("domain_blocked");
    throw err;
  }
  const info = await env.waitFor(async () => {
    const i = await env.info();
    return i.ready === "complete" ? i : undefined;
  }, env.timing.markerWaitMs);
  if (!info) throw new SetupHandoff("unexpected_page");
  if (info.lang && !/^en(-|$)/i.test(info.lang)) throw new SetupHandoff("locale");
  if (await env.find(SEL.termsAgree)) await termsCheckpoint(env);
}

async function termsCheckpoint(env: StepEnv): Promise<void> {
  await env.checkpoint("console_terms", async () => !(await env.find(SEL.termsAgree)));
}

/** Fill a labelled textbox. */
async function typeInto(env: StepEnv, sel: Sel, text: string): Promise<void> {
  await env.need(sel);
  await env.fill(sel, text);
}

// ───────────────────────── steps ─────────────────────────

async function readProject(env: StepEnv, waitMs: number): Promise<boolean> {
  await loadConsole(env, PATHS.projectInfo);
  const found = await env.waitFor(async () => {
    const f = parseProjectFacts(await env.text());
    return f.projectId ? f : undefined;
  }, waitMs);
  if (found?.projectId !== env.projectId) return false;
  env.facts.org = found.org;
  return true;
}

const projectStep: StepDef = {
  id: "project",
  async check(env) {
    const done = await readProject(env, env.timing.markerWaitMs);
    // An existing project the console does not show is not something to create.
    if (!done && env.mode === "existing") throw new SetupHandoff("unexpected_page");
    return done;
  },
  async act(env) {
    await loadConsole(env, PATHS.projectCreate, { noProject: true });
    await typeInto(env, SEL.projectName, CLIENT_NAME);
    await env.click(SEL.projectIdEdit);
    await typeInto(env, SEL.projectIdField, env.projectId);
    await env.click(SEL.create);
    env.created.projectId = env.projectId;
  },
  verify: (env) => pollVerify(env, () => readProject(env, env.timing.pollMs)),
};

/** Poll `probe` for `verifyWaitMs`. */
async function pollVerify(env: StepEnv, probe: () => Promise<boolean>): Promise<boolean> {
  return Boolean(await env.waitFor(async () => (await probe()) || undefined, env.timing.verifyWaitMs));
}

const apiStep: StepDef = {
  id: "api",
  async check(env) {
    await loadConsole(env, PATHS.apiOverview);
    const state = await env.waitFor(async () => {
      if (await env.find(SEL.disableApi)) return "done" as const;
      if (await env.find(SEL.enableApi)) return "todo" as const;
      return undefined;
    }, env.timing.markerWaitMs);
    if (!state) throw new SetupHandoff("unexpected_page");
    return state === "done";
  },
  async act(env) {
    await env.click(SEL.enableApi);
  },
  verify: (env) =>
    pollVerify(env, async () => {
      await loadConsole(env, PATHS.apiOverview);
      return Boolean(await env.find(SEL.disableApi));
    }),
};

const brandingStep: StepDef = {
  id: "branding",
  async check(env) {
    await loadConsole(env, PATHS.audience);
    const state = await env.waitFor(async () => {
      const type = parseUserType(await env.text());
      if (type) return { type };
      if (await env.find(SEL.getStarted)) return { type: undefined };
      return undefined;
    }, env.timing.markerWaitMs);
    if (!state) throw new SetupHandoff("unexpected_page");
    if (state.type) env.facts.audience = state.type;
    return state.type !== undefined;
  },
  async act(env) {
    const detected: Audience = env.facts.org ? "internal" : "external";
    const answer = await env.decide({ kind: "audience", detected, ...(env.facts.org ? { org: env.facts.org } : {}) });
    const audience: Audience = answer.audience === "internal" ? "internal" : "external";
    await loadConsole(env, PATHS.brandingCreate);
    // 4-step form: app information → audience → contact → finish.
    await typeInto(env, SEL.appName, CLIENT_NAME);
    await env.click(SEL.supportEmail);
    await env.click({ role: "option", name: env.ownerEmail });
    await env.click(SEL.next);
    await env.click(audience === "internal" ? SEL.audienceInternal : SEL.audienceExternal);
    await env.click(SEL.next);
    await typeInto(env, SEL.contactEmail, env.ownerEmail);
    await env.click(SEL.next);
    // The User Data Policy box is the user's own click; the run only waits for it.
    await env.need(SEL.policyCheckbox);
    await env.checkpoint("policy", async () => (await env.find(SEL.policyCheckbox))?.checked === true, { front: true });
    await env.click(SEL.continue);
    await env.click(SEL.create);
    env.facts.audience = audience;
  },
  verify: (env) =>
    pollVerify(env, async () => {
      await loadConsole(env, PATHS.audience);
      return parseUserType(await env.text()) === env.facts.audience;
    }),
};

async function inProduction(env: StepEnv): Promise<boolean> {
  return TEXT.inProduction.test(await env.text());
}

const publishStep: StepDef = {
  id: "publish",
  async check(env) {
    // Internal apps are not published.
    if (env.facts.audience === "internal") return true;
    await loadConsole(env, PATHS.audience);
    const state = await env.waitFor(async () => {
      if (await inProduction(env)) return "done" as const;
      if (await env.find(SEL.publishApp)) return "todo" as const;
      return undefined;
    }, env.timing.markerWaitMs);
    if (!state) throw new SetupHandoff("unexpected_page");
    return state === "done";
  },
  async act(env) {
    const answer = await env.decide({ kind: "links", links: { ...DEFAULT_PUBLISH_LINKS } });
    const links = answer.links ?? DEFAULT_PUBLISH_LINKS;
    await env.saveLinks(links);
    await loadConsole(env, PATHS.branding);
    await typeInto(env, SEL.homePage, links.homePage);
    await typeInto(env, SEL.privacyPolicy, links.privacyPolicy);
    await env.click(SEL.addDomain);
    await typeInto(env, SEL.authorizedDomain, links.authorizedDomain);
    await env.click(SEL.save);
    await loadConsole(env, PATHS.audience);
    await env.click(SEL.publishApp);
    // "Push to production?" is the user's confirmation; a cancelled dialog ends the run.
    await env.need(SEL.publishDialog);
    let gone = 0;
    await env.checkpoint("publish", async () => {
      if (await inProduction(env)) return true;
      if (await env.find(SEL.publishDialog)) {
        gone = 0;
        return false;
      }
      if (++gone >= env.timing.publishGracePolls) throw new SetupHandoff("publish_cancelled");
      return false;
    });
  },
  verify: (env) =>
    pollVerify(env, async () => {
      await loadConsole(env, PATHS.audience);
      return inProduction(env);
    }),
};

const clientStep: StepDef = {
  id: "client",
  // An earlier client's secret is unrecoverable: never "done".
  check: async () => false,
  async act(env) {
    await loadConsole(env, PATHS.clients);
    await env.need(SEL.createClient);
    const name = pickClientName(await env.text());
    await loadConsole(env, PATHS.clientCreate);
    await env.click(SEL.appType);
    await env.click(SEL.desktopApp);
    await typeInto(env, SEL.clientName, name);
    await env.click(SEL.create);
    env.created.clients.push(name);
  },
  verify: (env) =>
    pollVerify(env, async () => Boolean(await env.find(SEL.clientCreatedDialog))),
};

/** `capture` (fs + store) is injected by the run, so this module has no import cycle with `capture.ts`. */
export function buildSteps(capture: (env: StepEnv) => Promise<void>): readonly StepDef[] {
  const captureStep: StepDef = {
    id: "capture",
    check: async () => false,
    act: capture,
    // `capture` throws unless the client was stored.
    verify: async () => true,
  };
  return [projectStep, apiStep, brandingStep, publishStep, clientStep, captureStep];
}
