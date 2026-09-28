/**
 * Repo-root `public/sw.js` push + notificationclick handlers, evaluated in a
 * mocked service-worker global.
 * Harness: pure unit style of `prompt-answer-encoder.test.ts`.
 * See change: add-server-push-notifications (test-plan #F6–#F8).
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

const SW_SOURCE = fs.readFileSync(path.resolve(__dirname, "../../../../public/sw.js"), "utf-8");

type Listener = (event: any) => void;

function loadServiceWorker(windows: Array<{ focus: () => Promise<unknown>; navigate: (u: string) => Promise<unknown>; url: string }>) {
  const listeners: Record<string, Listener[]> = {};
  const self = {
    addEventListener: (type: string, fn: Listener) => {
      (listeners[type] ??= []).push(fn);
    },
    registration: { showNotification: vi.fn(async () => undefined) },
    clients: {
      matchAll: vi.fn(async () => windows),
      openWindow: vi.fn(async () => null),
    },
    location: { origin: "https://dash.example" },
  };
  new Function("self", "clients", "fetch", "Response", SW_SOURCE)(self, self.clients, vi.fn(), Response);
  const dispatch = async (type: string, event: any) => {
    const waits: Promise<unknown>[] = [];
    const ev = { ...event, waitUntil: (p: Promise<unknown>) => waits.push(p) };
    for (const fn of listeners[type] ?? []) fn(ev);
    await Promise.all(waits);
  };
  return { self, dispatch };
}

const payload = { type: "session_attention", trigger: "input", title: "proj: waiting for input", body: "m1", url: "/session/abc", sessionId: "abc" };

describe("service worker push handlers", () => {
  it("push → showNotification(title, {body, data:{url, sessionId}}) (test-plan #F6)", async () => {
    const { self, dispatch } = loadServiceWorker([]);
    await dispatch("push", { data: { json: () => payload, text: () => JSON.stringify(payload) } });
    expect(self.registration.showNotification).toHaveBeenCalledTimes(1);
    const [title, opts] = (self.registration.showNotification as any).mock.calls[0];
    expect(title).toBe(payload.title);
    expect(opts).toMatchObject({ body: "m1", data: { url: "/session/abc", sessionId: "abc" } });
  });

  it("push with a non-JSON body still shows a generic notification", async () => {
    const { self, dispatch } = loadServiceWorker([]);
    await dispatch("push", {
      data: {
        json: () => {
          throw new SyntaxError("bad");
        },
        text: () => "hello",
      },
    });
    expect(self.registration.showNotification).toHaveBeenCalledTimes(1);
  });

  it("notificationclick focuses + navigates an open dashboard window (test-plan #F7)", async () => {
    const win = { url: "https://dash.example/", focus: vi.fn(async () => win), navigate: vi.fn(async () => win) };
    const { self, dispatch } = loadServiceWorker([win]);
    const close = vi.fn();
    await dispatch("notificationclick", { notification: { data: { url: "/session/abc", sessionId: "abc" }, close } });
    expect(close).toHaveBeenCalled();
    expect(win.focus).toHaveBeenCalledTimes(1);
    expect(win.navigate).toHaveBeenCalledWith("/session/abc");
    expect(self.clients.openWindow).toHaveBeenCalledTimes(0);
  });

  it("notificationclick with no open window opens one (test-plan #F8)", async () => {
    const { self, dispatch } = loadServiceWorker([]);
    await dispatch("notificationclick", { notification: { data: { url: "/session/abc" }, close: vi.fn() } });
    expect(self.clients.openWindow).toHaveBeenCalledTimes(1);
    expect(self.clients.openWindow).toHaveBeenCalledWith("/session/abc");
  });
});
