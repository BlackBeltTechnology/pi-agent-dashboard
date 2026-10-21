/**
 * Provisioning host (change: add-access-provisioning, task 3.2; test-plan rows
 * F1 client half, F5 reconcile). One dialog at a time, answers over the socket,
 * first-answer-wins dismissal, reconnect reconcile from the server list.
 */
import type {
  BrowserToServerMessage,
  ProvisionRequestMessage,
  ServerToBrowserMessage,
} from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearGrantChannel, setGrantChannel } from "../../../lib/access-grants/grant-channel.js";
import { ProvisionPromptStore } from "../../../lib/access-grants/provision-prompt-store.js";
import { ProvisionPromptHost } from "../ProvisionPromptHost.js";

type Handler = (msg: ServerToBrowserMessage) => void;

function makeClient() {
  const handlers = new Set<Handler>();
  const sent: BrowserToServerMessage[] = [];
  return {
    store: new ProvisionPromptStore(),
    sent,
    send: vi.fn((m: BrowserToServerMessage) => {
      sent.push(m);
    }),
    onMessage: (h: Handler) => {
      handlers.add(h);
      return () => handlers.delete(h);
    },
    deliver: (msg: ServerToBrowserMessage) => act(() => handlers.forEach((h) => h(msg))),
  };
}

const FAKE_WS = {} as WebSocket;

function request(requestId: string, root = `/w/${requestId}`): ProvisionRequestMessage {
  return {
    type: "provision_request",
    requestId,
    projectRoot: root,
    lines: [{ lineId: "l1", path: `${root}/lib`, why: "x", classification: "grantable" }],
    remote: [],
    expiresAt: Date.now() + 60_000,
  };
}

function mount(
  c: ReturnType<typeof makeClient>,
  loadPending: () => Promise<ProvisionRequestMessage[] | null> = async () => null,
  ws: WebSocket | null = null,
) {
  return render(
    <ProvisionPromptHost onMessage={c.onMessage} send={c.send} ws={ws} store={c.store} loadPending={loadPending} />,
  );
}

beforeEach(() => {
  clearGrantChannel();
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ data: {} }) })));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("ProvisionPromptHost", () => {
  it("renders one request at a time and sends provision_response for the answer", () => {
    const c = makeClient();
    mount(c);
    c.deliver(request("a"));
    c.deliver(request("b"));
    expect(screen.getAllByTestId("provision-dialog")).toHaveLength(1);
    expect(screen.getByTestId("provision-root").textContent).toBe("/w/a");
    expect(screen.getByTestId("provision-queued").textContent).toContain("1");

    fireEvent.click(screen.getByLabelText("Approve /w/a/lib"));
    fireEvent.click(screen.getByTestId("provision-approve"));
    expect(c.sent).toEqual([
      { type: "provision_response", requestId: "a", lines: [{ lineId: "l1", verdict: "approve" }] },
    ]);
    // Next request takes over.
    expect(screen.getByTestId("provision-root").textContent).toBe("/w/b");
  });

  it("dismissal rejects every line and sends it once", () => {
    const c = makeClient();
    mount(c);
    c.deliver(request("a"));
    fireEvent.click(screen.getByTestId("provision-reject-all"));
    expect(c.sent).toEqual([
      { type: "provision_response", requestId: "a", lines: [{ lineId: "l1", verdict: "reject" }] },
    ]);
    expect(screen.queryByTestId("provision-dialog")).toBeNull();
  });

  it("provision_dismiss closes the dialog without sending; a late local answer is never sent", () => {
    const c = makeClient();
    mount(c);
    c.deliver(request("a"));
    c.deliver({ type: "provision_dismiss", requestId: "a", reason: "settled" });
    expect(screen.queryByTestId("provision-dialog")).toBeNull();
    expect(c.sent).toEqual([]);
    expect(c.store.claim("a")).toBe(false);
  });

  it("drops an expired request on the tick", () => {
    vi.useFakeTimers();
    const c = makeClient();
    mount(c);
    c.deliver({ ...request("a"), expiresAt: Date.now() + 2_000 });
    expect(screen.getByTestId("provision-dialog")).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(screen.queryByTestId("provision-dialog")).toBeNull();
  });

  describe("reconnect reconcile (F5)", () => {
    it("re-opens a still-pending request from the server list", async () => {
      setGrantChannel("cap-1");
      const c = makeClient();
      mount(c, async () => [request("a")], FAKE_WS);
      await screen.findByTestId("provision-dialog");
      expect(screen.getByTestId("provision-root").textContent).toBe("/w/a");
    });

    it("removes a queued request that ended while disconnected", async () => {
      setGrantChannel("cap-1");
      const c = makeClient();
      c.store.apply(request("gone"));
      mount(c, async () => [], FAKE_WS);
      await waitFor(() => expect(screen.queryByTestId("provision-dialog")).toBeNull());
    });

    it("does not reconcile without a capability (the server never sent this browser the dialog)", async () => {
      const load = vi.fn(async () => [request("a")]);
      const c = makeClient();
      mount(c, load, FAKE_WS);
      await act(async () => {});
      expect(load).not.toHaveBeenCalled();
      expect(screen.queryByTestId("provision-dialog")).toBeNull();
    });

    it("keeps the queue when the list is unavailable", async () => {
      setGrantChannel("cap-1");
      const c = makeClient();
      c.store.apply(request("a"));
      mount(c, async () => null, FAKE_WS);
      await act(async () => {});
      expect(screen.getByTestId("provision-dialog")).toBeTruthy();
    });
  });
});
