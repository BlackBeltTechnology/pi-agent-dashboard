/**
 * Ported from the gmail plugin's route tests when `POST /accounts` moved here (design D10): parallel adds (E8),
 * secret-free sign-in logs (E29) and the failed-sign-in log lines (X1–X5): one warn per failure, a fixed code,
 * never anything from the input. See change: add-google-connect.
 */
import { PluginFlowStartError, type PluginLoginInteraction } from "@blackbelt-technology/dashboard-plugin-runtime/server";
import { describe, expect, it, vi } from "vitest";
import { account, LOCAL, makeHarness } from "../../__tests__/fakes.js";
import { SCOPE } from "../../shared/products.js";
import { acctKey } from "../store.js";

const cal = [SCOPE.calendarReadonly];
const fail = (lines: string[]) => lines.filter((l) => l.startsWith("[google] signin"));
const accepted = async (h: ReturnType<typeof makeHarness>) => {
  await h.connect.acceptDisclosure();
  return h;
};
const idle = (): PluginLoginInteraction => ({ signal: new AbortController().signal, prompt: vi.fn(() => new Promise<string>(() => {})), notify: () => {} }) as never;

describe("E8 — parallel adds", () => {
  it("two add flows get distinct keys and both persist", async () => {
    const h = await accepted(makeHarness({ google: { scope: cal } }));
    await h.connect.startConnect({ products: { calendar: "read" }, browser: "local" });
    await h.connect.startConnect({ products: { calendar: "read" }, browser: "local" });
    expect(h.started.map((s) => s.key)).toEqual(["add-uuid1", "add-uuid2"]);
    h.reply.sub = "s1";
    await h.runFlow(0);
    h.reply.sub = "s2";
    h.reply.email = "b@x.com";
    await h.runFlow(1);
    expect((await h.store.list()).map((a) => a.sub).sort()).toEqual(["s1", "s2"]);
  });
});

describe("E29 — sign-in and revoke logs are secret-free", () => {
  it("never logs tokens, client secrets, codes or emails", async () => {
    const h = await accepted(makeHarness({ initial: { [acctKey("s2")]: account("s2", "b@x.com") as never }, google: { scope: cal, email: "me@x.com" } }));
    await h.connect.startConnect({ products: { calendar: "read" }, email: "me@x.com", browser: "local" });
    await h.runFlow();
    await h.connect.disconnect("s2", { revoke: true });
    const all = [...h.logger.lines, ...h.logger.warns].join("\n");
    for (const bad of ["ACCESS", "REFRESH", "SECRET", "CODE", LOCAL.clientSecret, "me@x.com", "b@x.com", "id_token"]) expect(all).not.toContain(bad);
    expect(fail(h.logger.lines)).toEqual(["[google] signin client=builtin path=local products=calendar result=ok"]);
  });
});

describe("X1–X5 — failed sign-ins are logged once, input-free", () => {
  it("X1: a Google error redirect logs one warn and keeps the flow's error code", async () => {
    const h = await accepted(makeHarness());
    await h.connect.startConnect({ products: { calendar: "read" }, browser: "local" });
    await expect(h.runFlow(0, { deliver: "paste", pasteText: (s) => `http://127.0.0.1:5555/?error=access_denied&state=${s}` })).rejects.toMatchObject({ code: "access_denied" });
    expect(fail(h.logger.warns)).toEqual(["[google] signin client=builtin path=local products=calendar result=access_denied"]);
  });

  it("X2: persist failures log one warn each (account_mismatch, scope_missing)", async () => {
    // a consent flow for s1 whose Google page signs in as somebody else
    const h = await accepted(makeHarness({ initial: { [acctKey("s1")]: account("s1", "a@x.com", { scopes: [SCOPE.gmailReadonly] }) as never }, google: { sub: "other", email: "o@x.com", scope: [...cal, SCOPE.gmailReadonly] } }));
    await h.connect.changeProducts("s1", { calendar: { level: "read" } }, "local");
    await expect(h.runFlow()).rejects.toMatchObject({ code: "account_mismatch" });
    expect(fail(h.logger.warns)).toHaveLength(1);
    expect(fail(h.logger.warns)[0]).toMatch(/result=account_mismatch$/);

    const none = await accepted(makeHarness({ google: { scope: [] } }));
    await none.connect.startConnect({ products: { calendar: "read" }, browser: "local" });
    await expect(none.runFlow()).rejects.toMatchObject({ code: "scope_missing" });
    expect(fail(none.logger.warns)).toEqual(["[google] signin client=builtin path=local products=calendar result=scope_missing"]);
  });

  it("X3: a login failing before its first event is logged exactly once (login AND start both see the failure)", async () => {
    const h = await accepted(makeHarness());
    h.oauth.startFlow.mockImplementation(async (o) => {
      await (o.loginFlow as { login(i: PluginLoginInteraction): Promise<unknown> }).login({ ...idle(), notify: () => { throw new Error("boom"); } }).catch(() => {
        throw new PluginFlowStartError("login_failed", "login failed");
      });
      return { flowId: "never" };
    });
    const r = await h.connect.startConnect({ products: { calendar: "read" }, browser: "local" });
    expect(r).toMatchObject({ ok: false, status: 502, error: "login_failed" });
    expect(fail(h.logger.warns)).toHaveLength(1);
  });

  it.each([
    [{ code: "evil_123" }],
    [{ code: "ya29.token" }],
    [{ code: 42 }],
    [new Error("boom")],
    [Object.assign(new Error("redirect https://x?code=abc for a@x.com SECRET-local"), { code: "https://x?code=abc" })],
  ])("X4: %j → the log carries the generic code and nothing from the input; the answer is a fixed code", async (err) => {
    const h = await accepted(makeHarness());
    h.oauth.startFlow.mockImplementation(async () => Promise.reject(err));
    const r = await h.connect.startConnect({ products: { calendar: "read" }, browser: "local" });
    expect(r).toMatchObject({ ok: false, status: 502 });
    expect((r as { error: string }).error).toMatch(/^[a-z_]{1,64}$/);
    expect((r as { error: string }).error).not.toBe("evil_123");
    const lines = fail(h.logger.warns);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toBe("[google] signin client=builtin path=local products=calendar result=sign_in_failed");
    const all = h.logger.lines.join("\n");
    for (const bad of ["ya29", "code=abc", "https://", "@", "SECRET", "evil", "boom"]) expect(all).not.toContain(bad);
  });

  it("X5: a start timeout logs one warn and answers 502 start_timeout", async () => {
    const h = await accepted(makeHarness());
    h.oauth.startFlow.mockImplementation(async () => {
      throw new PluginFlowStartError("start_timeout", "timed out");
    });
    const r = await h.connect.startConnect({ products: { calendar: "read" }, browser: "local" });
    expect(r).toMatchObject({ ok: false, status: 502, error: "start_timeout" });
    expect(fail(h.logger.warns)).toEqual(["[google] signin client=builtin path=local products=calendar result=start_timeout"]);
  });
});
