/**
 * Secret capture (test-plan #R8–#R11, task 2.6): dialog DOM path, JSON fallback
 * with guaranteed deletion, both failing, and the shared `client_in_use` rule.
 * See change: add-gmail-auto-setup.
 */
import { existsSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CLIENT } from "../../__tests__/fakes.js";
import { autopilot, makeHarness, preset, startExisting } from "../../__tests__/setup-harness.js";
import { acctKey } from "../accounts.js";
import { parseClientDialog } from "../setup/capture.js";
import { PATHS } from "../setup/steps.js";

const SECRET = "GOCSPX-captureSecret_0A1b2C3d";

async function captureHarness(o: Parameters<typeof makeHarness>[0] = {}) {
  const h = await makeHarness(o);
  preset(h.console, "publish");
  h.console.secret = SECRET;
  return h;
}

const noSecret = (text: string) => expect(text).not.toMatch(/GOCSPX-(?!\*\*\*)/);

describe("parseClientDialog", () => {
  it("reads id + secret from the dialog text", () => {
    expect(parseClientDialog(`Client ID\n1-a.apps.googleusercontent.com\nClient secret\n${SECRET}`)).toEqual({
      clientId: "1-a.apps.googleusercontent.com",
      clientSecret: SECRET,
    });
  });
  it("needs both", () => {
    expect(parseClientDialog("Client ID\n1-a.apps.googleusercontent.com")).toBeUndefined();
    expect(parseClientDialog(`secret ${SECRET}`)).toBeUndefined();
    expect(parseClientDialog("")).toBeUndefined();
  });
});

describe("R8 dialog path", () => {
  it("stores id, secret and project id; nothing leaks; no download was needed", async () => {
    const h = await captureHarness();
    const id = await startExisting(h);
    const v = await autopilot(h, id);
    expect(v.state).toBe("done");
    expect(v.clientId).toBe(h.console.clientId);
    expect(await h.store.getClient()).toEqual({ clientId: h.console.clientId, clientSecret: SECRET, projectId: "pi-dashboard-abc123" });
    expect(h.console.clicks).not.toContain("button:Download JSON");
    // Logs, run view, state and route responses carry no secret.
    noSecret([...h.logger.lines, JSON.stringify(v), JSON.stringify(await h.state()), JSON.stringify(await h.view(id))].join("\n"));
    expect(h.logger.lines).toContain("[gmail] oauth client configured");
  });

  it("the same store function as PUT /client: a stored client is replaced when no account is connected", async () => {
    const h = await captureHarness({ client: true });
    expect((await h.store.getClient())?.clientId).toBe(CLIENT.clientId);
    const v = await autopilot(h, await startExisting(h));
    expect(v.state).toBe("done");
    expect((await h.store.getClient())?.clientSecret).toBe(SECRET);
  });
});

describe("R9 JSON fallback", () => {
  it("(a) dialog read throws → stored from the downloaded JSON, file deleted", async () => {
    const h = await captureHarness();
    h.console.dialogReadThrows = true;
    const v = await autopilot(h, await startExisting(h));
    expect(v.state).toBe("done");
    expect(h.console.clicks).toContain("button:Download JSON");
    expect(await h.store.getClient()).toMatchObject({ clientId: h.console.clientId, clientSecret: SECRET, projectId: "pi-dashboard-abc123" });
    expect(readdirSync(h.downloadsDir)).toEqual([]);
    noSecret(h.logger.lines.join("\n") + JSON.stringify(v));
  });

  it("(b) the store throws after the read → the file is still deleted and nothing leaks", async () => {
    const h = await captureHarness();
    h.console.dialogReadThrows = true;
    h.store.setClient = async () => {
      throw new Error(`disk full while writing ${SECRET}`);
    };
    const v = await autopilot(h, await startExisting(h));
    expect(v.handoff).toEqual({ step: "capture", wizardStep: 4, reason: "secret_capture_failed" });
    expect(readdirSync(h.downloadsDir)).toEqual([]);
    const all = [...h.logger.lines, JSON.stringify(v)].join("\n");
    noSecret(all);
    expect(all).not.toContain("disk full");
  });

  it("only files the click produced are removed; an older client_secret_*.json is left alone", async () => {
    const h = await captureHarness();
    h.console.dialogReadThrows = true;
    const old = path.join(h.downloadsDir, "client_secret_old.json");
    writeFileSync(old, "{}");
    const v = await autopilot(h, await startExisting(h));
    expect(v.state).toBe("done");
    expect(existsSync(old)).toBe(true);
    expect(readdirSync(h.downloadsDir)).toEqual(["client_secret_old.json"]);
  });

  it("a downloaded file that is not a Desktop client JSON → deleted, secret_capture_failed", async () => {
    const h = await captureHarness();
    h.console.dialogReadThrows = true;
    h.console.downloadJson = { web: { client_id: "x", client_secret: SECRET } };
    const v = await autopilot(h, await startExisting(h));
    expect(v.handoff).toMatchObject({ step: "capture", reason: "secret_capture_failed" });
    expect(readdirSync(h.downloadsDir)).toEqual([]);
    expect(await h.store.getClient()).toBeUndefined();
  });
});

describe("R10 both reads fail", () => {
  it("closes the dialog, hands off secret_capture_failed @ capture / 4, names the created client", async () => {
    const h = await captureHarness();
    h.console.dialogReadThrows = true;
    h.console.downloadWorks = false;
    const v = await autopilot(h, await startExisting(h));
    expect(v.handoff).toEqual({ step: "capture", wizardStep: 4, reason: "secret_capture_failed" });
    expect(h.console.dialogOpen).toBe(false);
    expect(h.console.clicks.at(-1)).toBe("button:OK");
    expect(v.created.clients).toEqual(["pi-dashboard"]);
    expect(await h.store.getClient()).toBeUndefined();
    expect(readdirSync(h.downloadsDir)).toEqual([]);
    expect(h.browser.calls.disconnect).toEqual(["inst-1"]);
  });
});

describe("R11 client_in_use", () => {
  it("an account added before capture stores → handoff client_in_use @ capture / 4", async () => {
    const h = await captureHarness({ client: true });
    h.console.beforeNavigate = (u) => {
      if (u.pathname === PATHS.clientCreate) {
        h.creds.data.set(acctKey("s1"), {
          sub: "s1", email: "a@x.com", tier: "readonly", scopes: [], refresh: "r", access: "a", expires: 1, status: "ok", addedAt: 1,
        });
      }
    };
    const v = await autopilot(h, await startExisting(h));
    expect(v.handoff).toEqual({ step: "capture", wizardStep: 4, reason: "client_in_use" });
    expect(v.created.clients).toEqual(["pi-dashboard"]);
    // The working client is untouched.
    expect(await h.store.getClient()).toEqual({ ...CLIENT });
  });
});
