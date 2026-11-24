/**
 * Secret capture (test-plan #R8–#R11, task 2.6): dialog DOM path, JSON fallback
 * with guaranteed deletion, both failing, and storing as an organisation client (added, or updated when the
 * Google client id is already known). See change: add-gmail-auto-setup; moved by add-google-connect.
 */
import { existsSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { OWN_BB } from "../../__tests__/fakes.js";
import { autopilot, makeHarness, preset, startExisting, until } from "../../__tests__/setup-harness.js";
import { acctKey } from "../store.js";
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
    expect(await h.store.listClients()).toEqual([
      expect.objectContaining({
        label: "pi-dashboard-abc123",
        type: "installed",
        clientId: h.console.clientId,
        clientSecret: SECRET,
        projectId: "pi-dashboard-abc123",
        ownerAccount: "owner@example.com",
      }),
    ]);
    expect(h.console.clicks).not.toContain("button:Download JSON");
    // Logs, run view, state and route responses carry no secret.
    noSecret([...h.logger.lines, JSON.stringify(v), JSON.stringify(await h.state()), JSON.stringify(await h.view(id))].join("\n"));
    expect(h.logger.lines).toContain("[google] client added type=installed");
  });

  it("an existing client with the same Google client id is updated (label kept), a different one is added alongside", async () => {
    const h = await captureHarness({ client: true });
    const v = await autopilot(h, await startExisting(h));
    expect(v.state).toBe("done");
    const all = await h.store.listClients();
    expect(all.map((c) => c.label).sort()).toEqual(["BB", "pi-dashboard-abc123"]);
    expect((await h.store.getClient("bb"))?.clientSecret).toBe(OWN_BB.clientSecret);

    const h2 = await captureHarness();
    const first = await autopilot(h2, await startExisting(h2));
    expect(first.state).toBe("done");
    // Same Google client id seen again (same dialog): update in place, no second client.
    const [stored] = await h2.store.listClients();
    h2.console.secret = "GOCSPX-rotatedSecret_9Z8y7X6w";
    const again = await autopilot(h2, await startExisting(h2));
    expect(again.state).toBe("done");
    const after = await h2.store.listClients();
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ id: stored?.id, label: "pi-dashboard-abc123", clientSecret: "GOCSPX-rotatedSecret_9Z8y7X6w" });
    expect(h2.logger.lines).toContain("[google] client updated type=installed");
  });
})

describe("R9 JSON fallback", () => {
  it("(a) dialog read throws → stored from the downloaded JSON, file deleted", async () => {
    const h = await captureHarness();
    h.console.dialogReadThrows = true;
    const v = await autopilot(h, await startExisting(h));
    expect(v.state).toBe("done");
    expect(h.console.clicks).toContain("button:Download JSON");
    expect(await h.store.listClients()).toEqual([
      expect.objectContaining({ clientId: h.console.clientId, clientSecret: SECRET, projectId: "pi-dashboard-abc123" }),
    ]);
    expect(readdirSync(h.downloadsDir)).toEqual([]);
    noSecret(h.logger.lines.join("\n") + JSON.stringify(v));
  });

  it("(b) the store throws after the read → the file is still deleted and nothing leaks", async () => {
    const h = await captureHarness();
    h.console.dialogReadThrows = true;
    h.store.upsertClient = async () => {
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
    expect(await h.store.listClients()).toEqual([]);
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
    expect(await h.store.listClients()).toEqual([]);
    expect(readdirSync(h.downloadsDir)).toEqual([]);
    expect(h.browser.calls.disconnect).toEqual(["inst-1"]);
  });
});

describe("a client in use no longer blocks a run", () => {
  it("an account added to an existing client while the run creates a new one → new client alongside, no hand-off", async () => {
    const h = await captureHarness({ client: true });
    h.console.beforeNavigate = (u) => {
      if (u.pathname === PATHS.clientCreate) {
        h.creds.data.set(acctKey("s1"), {
          sub: "s1", email: "a@x.com", client: "own:bb",
          grant: { clientId: OWN_BB.clientId, refresh: "r", access: "a", expires: 1, scopes: [], status: "ok", grantedAt: 1 },
          products: {}, addedAt: 1,
        });
      }
    };
    const v = await autopilot(h, await startExisting(h));
    expect(v.state).toBe("done");
    expect(v.handoff).toBeUndefined();
    expect((await h.store.listClients()).map((c) => c.label).sort()).toEqual(["BB", "pi-dashboard-abc123"]);
    // The working client and its account are untouched.
    expect((await h.store.getClient("bb"))?.clientSecret).toBe(OWN_BB.clientSecret);
    expect(await h.store.get("s1")).toBeDefined();
  });
});

describe("B156–B163 secret capture without exposure", () => {
  const CANARY = "GOCSPX-canary123";

  it("B156: the captured secret reaches no log, run view, state or HTTP response (any GOCSPX- token is masked)", async () => {
    const h = await captureHarness();
    h.console.secret = CANARY;
    const id = await startExisting(h);
    const v = await autopilot(h, id);
    expect(v.state).toBe("done");
    expect((await h.store.listClients())[0]?.clientSecret).toBe(CANARY); // it IS stored, just never shown
    const seen = [
      ...h.logger.lines,
      JSON.stringify(v),
      JSON.stringify(await h.view(id)),
      JSON.stringify(await h.state()),
      JSON.stringify((await h.del(`/setup/run/${id}`)).json()),
    ].join("\n");
    expect(seen).not.toContain(CANARY);
    noSecret(seen);
  });

  it("B158: the run's browser instance is private (no relay tab listing, no viewer) for the whole run, and only opens tabs in its own context", async () => {
    const h = await captureHarness();
    await autopilot(h, await startExisting(h));
    expect(h.browser.calls.connect).toHaveLength(1);
    expect(h.browser.calls.connect[0]).toMatchObject({ private: true });
    for (const o of h.browser.calls.open) expect(o.instanceId).toBe("inst-1");
  });

  for (const outcome of ["success", "failure", "cancel"] as const) {
    it(`B159: the throwaway context is requested and discarded on ${outcome}`, async () => {
      const h = await captureHarness();
      if (outcome === "failure") {
        h.console.dialogReadThrows = true;
        h.console.downloadWorks = false;
      }
      const id = await startExisting(h);
      if (outcome === "cancel") {
        await until(() => h.view(id), (x) => x.step === "capture" || x.state !== "running");
        await h.del(`/setup/run/${id}`);
      } else {
        await autopilot(h, id);
      }
      expect(h.browser.calls.connect[0]).toMatchObject({ ephemeral: true, private: true });
      await until(() => h.browser.calls.disconnect, (d) => d.length > 0);
      expect(h.browser.calls.disconnect).toEqual(["inst-1"]);
    });
  }

  it("B160: no client_secret_*.json of this run remains when the read fails and the JSON is stored, when the JSON is unusable, or when storing throws", async () => {
    const left = (h: Awaited<ReturnType<typeof captureHarness>>) => readdirSync(h.downloadsDir).filter((f) => f.startsWith("client_secret_"));
    const ok = await captureHarness();
    ok.console.dialogReadThrows = true;
    expect((await autopilot(ok, await startExisting(ok))).state).toBe("done");
    expect(left(ok)).toEqual([]);

    const unusable = await captureHarness();
    unusable.console.dialogReadThrows = true;
    unusable.console.downloadJson = "not a client object";
    expect((await autopilot(unusable, await startExisting(unusable))).handoff).toMatchObject({ reason: "secret_capture_failed" });
    expect(left(unusable)).toEqual([]);

    const throws = await captureHarness();
    throws.console.dialogReadThrows = true;
    throws.store.upsertClient = async () => {
      throw new Error("boom");
    };
    expect((await autopilot(throws, await startExisting(throws))).handoff).toMatchObject({ reason: "secret_capture_failed" });
    expect(left(throws)).toEqual([]);
  });

  it("B161: dialog read and JSON download both fail → dialog closed, handoff capture/4 secret_capture_failed, the created client is named for the manual wizard", async () => {
    const h = await captureHarness();
    h.console.dialogReadThrows = true;
    h.console.downloadWorks = false;
    const v = await autopilot(h, await startExisting(h));
    expect(v.handoff).toEqual({ step: "capture", wizardStep: 4, reason: "secret_capture_failed" });
    expect(h.console.dialogOpen).toBe(false);
    expect(v.created.clients).toEqual(["pi-dashboard"]);
  });

  it("B162: a captured Desktop client is stored like an upload (org client labelled with the project id, projectId, ownerAccount); unusable JSON is rejected → handoff", async () => {
    const good = await captureHarness();
    good.console.dialogReadThrows = true;
    await autopilot(good, await startExisting(good));
    expect(await good.store.listClients()).toEqual([
      expect.objectContaining({ type: "installed", label: "pi-dashboard-abc123", projectId: "pi-dashboard-abc123", ownerAccount: "owner@example.com", clientSecret: SECRET }),
    ]);

    for (const json of [
      { web: { client_id: "x.apps.googleusercontent.com", client_secret: SECRET, redirect_uris: ["https://elsewhere.example/cb"] } }, // Web type: the wizard only creates Desktop clients
      { installed: { client_secret: SECRET } }, // missing client_id
      { installed: { client_id: "not-a-google-client-id", client_secret: SECRET } }, // fails the upload route's id rule
    ]) {
      const h = await captureHarness();
      h.console.dialogReadThrows = true;
      h.console.downloadJson = json;
      const v = await autopilot(h, await startExisting(h));
      expect([JSON.stringify(json).slice(0, 30), v.handoff]).toEqual([JSON.stringify(json).slice(0, 30), { step: "capture", wizardStep: 4, reason: "secret_capture_failed" }]);
      expect(await h.store.listClients()).toEqual([]);
    }
  });

  it("B163: a captured client id equal to an existing own client updates it in place — not duplicated; accounts on it keep working", async () => {
    const h = await captureHarness({ client: true });
    h.console.clientId = OWN_BB.clientId;
    h.creds.data.set(acctKey("s1"), {
      sub: "s1", email: "a@x.com", client: "own:bb",
      grant: { clientId: OWN_BB.clientId, refresh: "r", access: "a", expires: 1, scopes: [], status: "ok", grantedAt: 1 },
      products: {}, addedAt: 1,
    });
    const v = await autopilot(h, await startExisting(h));
    expect(v.state).toBe("done");
    const all = await h.store.listClients();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ id: "bb", clientId: OWN_BB.clientId, clientSecret: SECRET });
    expect(await h.store.get("s1")).toMatchObject({ client: "own:bb", grant: { clientId: OWN_BB.clientId } });
  });
});
