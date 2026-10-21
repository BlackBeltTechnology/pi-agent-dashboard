/**
 * Setup recipe against the FakeConsole page model (test-plan #E5–#E8, #R1, #R2,
 * #R4, #R5b + pure helpers + the "never clicks a human checkpoint" invariant).
 * See change: add-gmail-auto-setup.
 */
import { describe, expect, it } from "vitest";
import {
  autopilot,
  makeHarness,
  OWNER,
  PID,
  preset,
  startExisting,
  until,
} from "../../__tests__/setup-harness.js";
import { type SetupRunView, type SetupStepId, WIZARD_STEP_OF } from "../../shared/auto-setup.js";
import { classifyProjectId, PROJECT_ID_RE } from "../../shared/setup.js";
import {
  consoleUrl,
  generateProjectId,
  PATHS,
  parseProjectFacts,
  parseUserType,
  pickClientName,
  REQUIRED_DOMAINS,
  validateLinks,
} from "../setup/steps.js";

const status = (v: SetupRunView, id: SetupStepId) => v.steps.find((s) => s.id === id)?.status;

describe("pure recipe helpers", () => {
  it("generateProjectId: pi-dashboard-<6 [a-z0-9]>, valid under the plugin's project-id rule", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const id = generateProjectId();
      expect(id).toMatch(/^pi-dashboard-[a-z0-9]{6}$/);
      expect(PROJECT_ID_RE.test(id)).toBe(true);
      expect(classifyProjectId(id)).toBe("ok");
      ids.add(id);
    }
    expect(ids.size).toBeGreaterThan(190); // random, not constant
  });

  it("generateProjectId uses the injected random source", () => {
    expect(generateProjectId(() => 0)).toBe("pi-dashboard-aaaaaa");
    expect(generateProjectId(() => 35)).toBe("pi-dashboard-999999");
  });

  it("pickClientName: smallest free suffix", () => {
    expect(pickClientName("OAuth clients")).toBe("pi-dashboard");
    expect(pickClientName("x\npi-dashboard\ny")).toBe("pi-dashboard-2");
    expect(pickClientName("pi-dashboard\npi-dashboard-2")).toBe("pi-dashboard-3");
    // The bare name is free again when only suffixed clients exist; unrelated names are ignored.
    expect(pickClientName("pi-dashboard-2\nmy-pi-dashboard\npi-dashboard-extra")).toBe("pi-dashboard");
    expect(pickClientName("pi-dashboard\npi-dashboard-3")).toBe("pi-dashboard-2");
  });

  it("parseProjectFacts reads the project id and the parent", () => {
    expect(parseProjectFacts("Project ID\nmy-proj-123\nOrganization\nAcme Corp")).toEqual({ projectId: "my-proj-123", org: "Acme Corp" });
    expect(parseProjectFacts("Project ID\nmy-proj-123\nNo organization")).toEqual({ projectId: "my-proj-123", org: null });
    expect(parseProjectFacts("nothing").projectId).toBeUndefined();
  });

  it("parseUserType", () => {
    expect(parseUserType("User type\nExternal")).toBe("external");
    expect(parseUserType("User type: Internal")).toBe("internal");
    expect(parseUserType("Get started")).toBeUndefined();
  });

  it("validateLinks: https + host under the authorized domain only", () => {
    const ok = { homePage: "https://github.com/a", privacyPolicy: "https://docs.github.com/p", authorizedDomain: "GitHub.com" };
    expect(validateLinks(ok)).toMatchObject({ ok: true, links: { authorizedDomain: "github.com" } });
    expect(validateLinks({ ...ok, homePage: "javascript:alert(1)" })).toEqual({ ok: false, error: "invalid_homePage" });
    expect(validateLinks({ ...ok, privacyPolicy: "ftp://github.com/p" })).toEqual({ ok: false, error: "invalid_privacyPolicy" });
    expect(validateLinks({ ...ok, homePage: "https://notgithub.com" })).toEqual({ ok: false, error: "invalid_homePage" });
    expect(validateLinks(null)).toEqual({ ok: false, error: "links_required" });
    expect(validateLinks({ homePage: "https://github.com" })).toEqual({ ok: false, error: "links_required" });
  });

  it("consoleUrl carries authuser, project and hl=en", () => {
    const u = new URL(consoleUrl({ ownerEmail: OWNER, projectId: PID }, PATHS.audience));
    expect(u.origin).toBe("https://console.cloud.google.com");
    expect(u.searchParams.get("authuser")).toBe(OWNER);
    expect(u.searchParams.get("project")).toBe(PID);
    expect(u.searchParams.get("hl")).toBe("en");
    expect(new URL(consoleUrl({ ownerEmail: OWNER, projectId: PID }, PATHS.projectCreate, { noProject: true })).searchParams.has("project")).toBe(false);
  });
});

describe("full new-mode run over the FakeConsole", () => {
  it("creates project → api → branding → publish → client → capture and ends done", async () => {
    const h = await makeHarness();
    const r = await h.start({ mode: "new", ownerEmail: OWNER });
    const v = await autopilot(h, r.json().runId);
    expect(v.state).toBe("done");
    expect(v.steps.map((s) => s.status)).toEqual(["done", "done", "done", "done", "done", "done"]);
    expect(v.created).toEqual({ projectId: v.projectId, clients: ["pi-dashboard"] });
    expect(h.console.projectId).toBe(v.projectId);
    expect(await h.store.getClient()).toMatchObject({ clientId: h.console.clientId, projectId: v.projectId });
  });

  it("every console navigation selects the owner account, the project and English", async () => {
    const h = await makeHarness();
    const r = await h.start({ mode: "new", ownerEmail: OWNER });
    await autopilot(h, r.json().runId);
    const consoleNavs = h.console.navigations.map((u) => new URL(u)).filter((u) => u.origin === "https://console.cloud.google.com");
    expect(consoleNavs.length).toBeGreaterThan(8);
    for (const u of consoleNavs) {
      expect(u.searchParams.get("authuser")).toBe(OWNER);
      expect(u.searchParams.get("hl")).toBe("en");
      if (u.pathname !== PATHS.projectCreate) expect(u.searchParams.get("project")).toBeTruthy();
    }
  });

  it("never clicks a sign-in, terms, policy, consent or publish confirmation (the human does)", async () => {
    const h = await makeHarness();
    h.console.termsPending = true;
    const r = await h.start({ mode: "new", ownerEmail: OWNER });
    const id = r.json().runId;
    // The terms dialog is a human checkpoint: the run waits, the human accepts.
    const waiting = await until(() => h.view(id), (x) => x.state === "waiting_user");
    expect(waiting.checkpoint).toEqual({ kind: "console_terms" });
    h.console.termsPending = false;
    const v = await autopilot(h, id);
    expect(v.state).toBe("done");
    expect(h.console.clicks.length).toBeGreaterThan(10);
    for (const c of h.console.clicks) {
      expect(c).not.toMatch(/checkbox:|Agree and continue|Confirm|Sign in|Allow|Push to production/i);
    }
    // …and never typed a password.
    expect(h.console.fills.every((f) => !/password/i.test(f.name))).toBe(true);
  });
});

describe("E6 generated project id", () => {
  it("new mode without projectId: view and saved config carry a valid generated id", async () => {
    const h = await makeHarness();
    const r = await h.start({ mode: "new", ownerEmail: OWNER });
    const v = await h.view(r.json().runId);
    expect(v.projectId).toMatch(/^pi-dashboard-[a-z0-9]{6}$/);
    expect(classifyProjectId(v.projectId as string)).toBe("ok");
    await until(() => h.configUpdates, (u) => u.length > 0);
    expect(h.configUpdates[0]).toEqual({ projectId: v.projectId, ownerAccount: OWNER });
  });

  it("a supplied projectId is used as is", async () => {
    const h = await makeHarness();
    const r = await h.start({ mode: "new", ownerEmail: OWNER, projectId: "my-own-project-1" });
    expect((await h.view(r.json().runId)).projectId).toBe("my-own-project-1");
  });
});

describe("E7 client name suffixing", () => {
  const cases: Array<[string[], string]> = [
    [[], "pi-dashboard"],
    [["pi-dashboard"], "pi-dashboard-2"],
    [["pi-dashboard", "pi-dashboard-2"], "pi-dashboard-3"],
  ];
  for (const [existing, expected] of cases) {
    it(`clients ${JSON.stringify(existing)} → ${expected}`, async () => {
      const h = await makeHarness();
      preset(h.console, "publish");
      h.console.clients = [...existing];
      const v = await autopilot(h, await startExisting(h));
      expect(v.state).toBe("done");
      expect(v.created.clients).toEqual([expected]);
      expect(h.console.fills.find((f) => f.name === "Name")?.text).toBe(expected);
      expect(h.console.clients).toEqual([...existing, expected]);
    });
  }
});

describe("E8 audience decision table (parent org?, branding done?)", () => {
  it("(org, not done) → detected internal, org named, both offered", async () => {
    const h = await makeHarness();
    preset(h.console, "api", { org: "Acme Corp" });
    h.console.userType = null;
    const id = await startExisting(h);
    const v = await until(() => h.view(id), (x) => x.state === "waiting_decision");
    expect(v.step).toBe("branding");
    expect(v.decision).toEqual({ kind: "audience", detected: "internal", org: "Acme Corp" });
    expect((await h.post(`/setup/run/${id}/continue`, { audience: "bogus" })).statusCode).toBe(400);
    expect((await h.post(`/setup/run/${id}/continue`, { audience: "internal" })).statusCode).toBe(200);
    const done = await autopilot(h, id);
    expect(done.state).toBe("done");
    expect(h.console.clicks).toContain("radio:Internal");
    expect(done.audience).toBe("internal");
    expect(status(done, "publish")).toBe("skipped"); // Internal apps are not published
  });

  it("(org, not done) → External is also accepted", async () => {
    const h = await makeHarness();
    preset(h.console, "api", { org: "Acme Corp" });
    h.console.userType = null;
    const id = await startExisting(h);
    await until(() => h.view(id), (x) => x.state === "waiting_decision");
    expect((await h.post(`/setup/run/${id}/continue`, { audience: "external" })).statusCode).toBe(200);
    await until(() => h.console.clicks, (c) => c.includes("radio:External"));
  });

  it("(no org, not done) → detected external; Internal refused and the run keeps waiting", async () => {
    const h = await makeHarness();
    preset(h.console, "api");
    h.console.userType = null;
    const id = await startExisting(h);
    const v = await until(() => h.view(id), (x) => x.state === "waiting_decision");
    expect(v.decision).toEqual({ kind: "audience", detected: "external" });
    const r = await h.post(`/setup/run/${id}/continue`, { audience: "internal" });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toBe("audience_not_allowed");
    expect((await h.view(id)).state).toBe("waiting_decision");
    expect((await h.post(`/setup/run/${id}/continue`, { audience: "external" })).statusCode).toBe(200);
    await until(() => h.console.clicks, (c) => c.includes("radio:External"));
  });

  it("(org, already done) → no decision, branding skipped, existing type reported", async () => {
    const h = await makeHarness();
    preset(h.console, "publish", { org: "Acme Corp", audience: "internal" });
    const v = await autopilot(h, await startExisting(h));
    expect(v.state).toBe("done");
    expect(status(v, "branding")).toBe("skipped");
    expect(v.audience).toBe("internal");
    expect(h.console.fills.some((f) => f.name === "App name")).toBe(false); // the form was never touched
  });

  it("(no org, already done) → no decision, branding skipped, existing type reported", async () => {
    const h = await makeHarness();
    preset(h.console, "publish");
    const v = await autopilot(h, await startExisting(h));
    expect(status(v, "branding")).toBe("skipped");
    expect(v.audience).toBe("external");
  });
});

describe("R1 resume: finished steps are skipped", () => {
  it("project and API already there → both skipped; the run continues at branding", async () => {
    const h = await makeHarness();
    preset(h.console, "api");
    h.console.userType = null;
    const id = await startExisting(h);
    const v = await until(() => h.view(id), (x) => x.state === "waiting_decision");
    expect(status(v, "project")).toBe("skipped");
    expect(status(v, "api")).toBe("skipped");
    expect(v.step).toBe("branding");
    // Nothing was created or enabled again.
    expect(h.console.clicks).not.toContain("button:Enable");
    expect(h.console.clicks).not.toContain("button:Create");
    expect(v.created.projectId).toBeUndefined();
  });

  it("API not enabled yet → enabled and verified, project skipped", async () => {
    const h = await makeHarness();
    preset(h.console, "project");
    const v = await autopilot(h, await startExisting(h), { stopAt: (x) => x.state === "waiting_decision" });
    expect(status(v, "project")).toBe("skipped");
    expect(status(v, "api")).toBe("done");
    expect(h.console.apiEnabled).toBe(true);
  });

  it("existing mode with a project the console does not show → handoff unexpected_page at project, nothing created", async () => {
    const h = await makeHarness();
    const v = await autopilot(h, await startExisting(h));
    expect(v.handoff).toMatchObject({ step: "project", wizardStep: 1, reason: "unexpected_page" });
    expect(h.console.clicks).not.toContain("button:Create");
  });
});

describe("R2 handoff reasons", () => {
  it("unknown page at api → unexpected_page @ api / wizard 1", async () => {
    const h = await makeHarness();
    preset(h.console, "project");
    h.console.override = (u) => (u.pathname === PATHS.apiOverview ? { text: "Something unexpected", ax: [] } : undefined);
    const v = await autopilot(h, await startExisting(h));
    expect(v.state).toBe("handoff");
    expect(v.handoff).toEqual({ step: "api", wizardStep: 1, reason: "unexpected_page" });
    expect(status(v, "api")).toBe("handoff");
    expect(status(v, "project")).toBe("skipped");
  });

  it('lang="hu" at branding → locale @ branding / wizard 2', async () => {
    const h = await makeHarness();
    preset(h.console, "api");
    h.console.userType = null;
    h.console.override = (u) => (u.pathname === PATHS.audience ? { lang: "hu", text: "Üdv", ax: [] } : undefined);
    const v = await autopilot(h, await startExisting(h));
    expect(v.handoff).toEqual({ step: "branding", wizardStep: 2, reason: "locale" });
  });

  it("navigation denied by the deny set at project → domain_blocked @ project / 1, naming both domains", async () => {
    const h = await makeHarness();
    h.console.denyNavigation = (u) => u.origin === "https://console.cloud.google.com";
    const v = await autopilot(h, await startExisting(h));
    expect(v.handoff).toMatchObject({ step: "project", wizardStep: 1, reason: "domain_blocked" });
    expect(v.handoff?.domains).toEqual(["console.cloud.google.com", "accounts.google.com"]);
    expect([...REQUIRED_DOMAINS]).toEqual(v.handoff?.domains);
  });

  it("a failed verify (project creation never shows up) → unexpected_page @ project", async () => {
    const h = await makeHarness({ timing: { verifyWaitMs: 40 } });
    // "Create" is clicked but the project never appears in the console.
    h.console.override = (u) =>
      u.pathname === PATHS.projectCreate
        ? { text: "New Project", ax: [{ role: "textbox", name: "Project name" }, { role: "button", name: "Edit" }, { role: "textbox", name: "Project ID" }, { role: "button", name: "Create" }] }
        : undefined;
    const r = await h.start({ mode: "new", ownerEmail: OWNER });
    const v = await autopilot(h, r.json().runId);
    expect(v.handoff).toMatchObject({ step: "project", wizardStep: 1, reason: "unexpected_page" });
    expect(v.created.projectId).toBe(v.projectId); // the attempt is on record so a hand-off can name it
  });
});

describe("E5 wizardStep map: a hand-off at each step id", () => {
  async function handoffAt(step: SetupStepId): Promise<SetupRunView> {
    const h = await makeHarness();
    switch (step) {
      case "project":
        h.console.denyNavigation = () => true;
        break;
      case "api":
        preset(h.console, "project");
        h.console.override = (u) => (u.pathname === PATHS.apiOverview ? { text: "?", ax: [] } : undefined);
        break;
      case "branding":
        preset(h.console, "api");
        h.console.userType = null;
        h.console.override = (u) => (u.pathname === PATHS.audience ? { lang: "de", text: "x", ax: [] } : undefined);
        break;
      case "publish":
        preset(h.console, "branding");
        break;
      case "client":
        preset(h.console, "publish");
        h.console.override = (u) => (u.pathname === PATHS.clients ? { text: "?", ax: [] } : undefined);
        break;
      case "capture":
        preset(h.console, "publish");
        h.console.dialogReadThrows = true;
        h.console.downloadWorks = false;
        break;
    }
    return autopilot(h, await startExisting(h), { publish: "cancel" });
  }

  const expected: Array<[SetupStepId, 1 | 2 | 3 | 4]> = [
    ["project", 1],
    ["api", 1],
    ["branding", 2],
    ["publish", 3],
    ["client", 4],
    ["capture", 4],
  ];
  for (const [step, wizard] of expected) {
    it(`handoff at ${step} → wizardStep ${wizard}`, async () => {
      const v = await handoffAt(step);
      expect(v.state).toBe("handoff");
      expect(v.step).toBe(step);
      expect(v.handoff?.step).toBe(step);
      expect(v.handoff?.wizardStep).toBe(wizard);
      expect(WIZARD_STEP_OF[step]).toBe(wizard);
      expect(status(v, step)).toBe("handoff");
    });
  }
});

describe("R4 sign-in redirect guard", () => {
  it("a redirect to accounts.google.com is failed before it renders; sign-in happens in a hidden tab; the console reloads only after it", async () => {
    let flipped = false;
    const h = await makeHarness({
      browser: {
        tabOrigin: (call) => {
          if (call < 3) return "https://accounts.google.com";
          h.console.signedIn = true;
          h.console.navigations.push("<<hidden tab left accounts.google.com>>");
          return "https://console.cloud.google.com";
        },
      },
    });
    preset(h.console, "publish");
    h.console.beforeNavigate = (u) => {
      if (u.pathname === PATHS.clientCreate && !flipped) {
        flipped = true;
        h.console.signedIn = false; // session expired during the client step
      }
    };
    const v = await autopilot(h, await startExisting(h));
    expect(v.state).toBe("done");
    expect(status(v, "client")).toBe("done");

    const log = h.console.log;
    const paused = log.findIndex((e) => e.kind === "event" && e.method === "Fetch.requestPaused");
    const failed = log.findIndex((e) => e.kind === "cmd" && e.method === "Fetch.failRequest");
    expect(paused).toBeGreaterThanOrEqual(0);
    expect(failed).toBeGreaterThan(paused);
    // The run's tab never rendered the accounts page.
    expect(log.some((e) => e.kind === "event" && e.method === "Page.frameNavigated")).toBe(false);
    expect(h.console.url).not.toContain("accounts.google.com");

    const navs = h.console.navigations;
    const blocked = navs.findIndex((u) => u.includes(PATHS.clientCreate));
    expect(navs[blocked + 1]).toBe("about:blank"); // run tab parked
    const left = navs.indexOf("<<hidden tab left accounts.google.com>>");
    expect(left).toBeGreaterThan(blocked + 1);
    expect(navs.slice(blocked + 2, left).filter((u) => u.startsWith("https://console"))).toEqual([]); // no reload before sign-in finished
    expect(navs.slice(left).some((u) => u.includes(PATHS.clientCreate))).toBe(true);

    // Sign-in opened in a hidden tab of the run's instance, with login_hint, and focused.
    const { open, focus } = h.browser.calls;
    expect(open).toHaveLength(1);
    expect(open[0]?.instanceId).toBe("inst-1");
    const url = new URL(open[0]?.url as string);
    expect(url.origin).toBe("https://accounts.google.com");
    expect(url.searchParams.get("login_hint")).toBe(OWNER);
    expect(focus).toEqual(["tab-1"]);
  });

  it("the user's 'I've signed in' (continue) ends the sign-in checkpoint", async () => {
    const h = await makeHarness({ browser: { tabOrigin: () => "https://accounts.google.com" } });
    preset(h.console, "publish");
    h.console.signedIn = false;
    const id = await startExisting(h);
    const v = await until(() => h.view(id), (x) => x.state === "waiting_user");
    expect(v.checkpoint).toEqual({ kind: "sign_in" });
    h.console.signedIn = true;
    expect((await h.post(`/setup/run/${id}/continue`)).statusCode).toBe(200);
    const done = await autopilot(h, id);
    expect(done.state).toBe("done");
  });

  it("sign-in page refused to open (domain not allowed) → handoff domain_blocked", async () => {
    const h = await makeHarness();
    preset(h.console, "publish");
    h.console.signedIn = false;
    h.browser.service.open = async () => ({ ok: false, status: 403, reason: "url-denied" });
    const v = await autopilot(h, await startExisting(h));
    expect(v.handoff).toMatchObject({ reason: "domain_blocked" });
  });
});

describe("R5b publish dialog cancelled", () => {
  it("External app: the user cancels 'Push to production?' → handoff publish_cancelled @ publish / 3", async () => {
    const h = await makeHarness();
    preset(h.console, "branding");
    const v = await autopilot(h, await startExisting(h), { publish: "cancel" });
    expect(v.handoff).toEqual({ step: "publish", wizardStep: 3, reason: "publish_cancelled" });
    expect(h.console.published).toBe(false);
    expect(h.console.clicks).toContain("button:Publish app"); // the run opened the dialog…
    expect(h.console.clicks.every((c) => !/Confirm|Push to production/.test(c))).toBe(true); // …but never confirmed
  });

  it("the human confirms → publish step done and verified as In production", async () => {
    const h = await makeHarness();
    preset(h.console, "branding");
    const v = await autopilot(h, await startExisting(h));
    expect(v.state).toBe("done");
    expect(status(v, "publish")).toBe("done");
    expect(h.console.published).toBe(true);
  });
});
