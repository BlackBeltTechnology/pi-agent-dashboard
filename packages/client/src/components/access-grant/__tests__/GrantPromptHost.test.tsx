/**
 * Grant-prompt host (change: add-access-grant-dialog, tasks 7.1-7.3; test-plan
 * rows 10.67, 10.68, 10.69, 10.75). Wires WS frames to the queue, one dialog at
 * a time, answers over the socket, and keeps the capability's lifecycle.
 */
import type {
  BrowserToServerMessage,
  GrantRequestMessage,
  ServerToBrowserMessage,
} from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearGrantChannel, getGrantChannel } from "../../../lib/access-grants/grant-channel.js";
import { GrantPromptStore } from "../../../lib/access-grants/grant-prompt-store.js";
import { GrantPromptHost } from "../GrantPromptHost.js";

type Handler = (msg: ServerToBrowserMessage) => void;

/** One fake browser: its own socket handlers, send spy and prompt store. */
function makeClient() {
  const handlers = new Set<Handler>();
  const sent: BrowserToServerMessage[] = [];
  return {
    store: new GrantPromptStore(),
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

function request(promptId: string, expiresIn = 60_000): GrantRequestMessage {
  return {
    type: "grant_request",
    promptId,
    plane: "filesystem",
    subject: `/repo/${promptId}`,
    expiresAt: Date.now() + expiresIn,
    copy: { mode: "held", verdicts: ["allow-once", "allow-always", "deny"], store: "access-grants.json" },
  };
}

function mount(
  client: ReturnType<typeof makeClient>,
  loadPending: () => Promise<GrantRequestMessage[] | null> = async () => null,
  ws: WebSocket | null = null,
) {
  return render(
    <GrantPromptHost
      onMessage={client.onMessage}
      send={client.send}
      ws={ws}
      store={client.store}
      loadPending={loadPending}
    />,
  );
}

beforeEach(() => clearGrantChannel());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("GrantPromptHost", () => {
  it("renders one prompt at a time, answers over the socket, then shows the next", () => {
    const c = makeClient();
    mount(c);
    c.deliver(request("a"));
    c.deliver(request("b"));
    expect(screen.getAllByTestId("grant-dialog")).toHaveLength(1);
    expect(screen.getByTestId("grant-dialog-subject").textContent).toBe("/repo/a");
    expect(screen.getByTestId("grant-dialog-queued").textContent).toMatch(/1 more/);

    fireEvent.click(screen.getByTestId("grant-allow-once"));
    expect(c.sent).toEqual([
      { type: "grant_response", promptId: "a", plane: "filesystem", subject: "/repo/a", verdict: "allow-once" },
    ]);
    expect(screen.getByTestId("grant-dialog-subject").textContent).toBe("/repo/b");
  });

  // 10.68 (F2) — Escape converges to a deny verdict on the wire.
  it("sends deny when the dialog is dismissed with Escape", () => {
    const c = makeClient();
    mount(c);
    c.deliver(request("a"));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(c.sent).toEqual([
      { type: "grant_response", promptId: "a", plane: "filesystem", subject: "/repo/a", verdict: "deny" },
    ]);
    expect(screen.queryByTestId("grant-dialog")).toBeNull();
  });

  // 7.3 / 10.67 (F1) — first answer wins; the loser's dialog unmounts, no backdrop, no second verdict.
  it("removes the second client's dialog when the first answers, and ignores its late answer", () => {
    const a = makeClient();
    const b = makeClient();
    const viewA = mount(a);
    const viewB = mount(b);
    const req = request("shared");
    a.deliver(req);
    b.deliver(req);
    expect(screen.getAllByTestId("grant-dialog")).toHaveLength(2);

    // Browser A answers; the server tells every other client it is settled.
    fireEvent.click(viewA.baseElement.querySelectorAll('[data-testid="grant-allow-always"]')[0] as HTMLElement);
    expect(a.sent).toHaveLength(1);
    b.deliver({ type: "grant_dismiss", promptId: "shared", plane: "filesystem", subject: "/repo/shared", reason: "settled" });

    expect(screen.queryByTestId("grant-dialog")).toBeNull();
    expect(screen.queryByTestId("grant-dialog-overlay")).toBeNull();
    // B cannot submit: no control left, Escape does nothing, and a late claim is refused.
    fireEvent.keyDown(document, { key: "Escape" });
    expect(b.store.claim("shared")).toBe(false);
    expect(b.sent).toEqual([]);
    viewB.unmount();
  });

  // 10.69 (F3) — held prompt removes itself on expiry without sending anything.
  it("removes a held prompt when it expires, sending no verdict", () => {
    vi.useFakeTimers({ now: 1_000_000 });
    const c = makeClient();
    mount(c);
    c.deliver(request("a", 3_000));
    expect(screen.getByTestId("grant-dialog-waiting").textContent).toMatch(/3s left/);
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(screen.getByTestId("grant-dialog-waiting").textContent).toMatch(/2s left/);
    act(() => {
      vi.advanceTimersByTime(2_500);
    });
    expect(screen.queryByTestId("grant-dialog")).toBeNull();
    expect(c.sent).toEqual([]);
  });

  it("holds the capability from grant_channel and clears it when the socket closes", () => {
    const c = makeClient();
    const view = mount(c, vi.fn(async () => null), FAKE_WS);
    c.deliver({ type: "grant_channel", capability: "cap-1" });
    expect(getGrantChannel()).toBe("cap-1");
    c.deliver({ type: "grant_channel", capability: "cap-2" });
    expect(getGrantChannel()).toBe("cap-2");
    view.rerender(
      <GrantPromptHost onMessage={c.onMessage} send={c.send} ws={null} store={c.store} loadPending={async () => null} />,
    );
    expect(getGrantChannel()).toBeNull();
  });

  // 10.75 (F9) — after a reconnect the queue converges on the server's pending list.
  it("reconciles on reconnect: drops prompts settled meanwhile, re-renders pending ones", async () => {
    const c = makeClient();
    const loadPending = vi.fn(async () => null as GrantRequestMessage[] | null);
    const view = mount(c, loadPending, FAKE_WS);
    c.deliver(request("settled-while-away"));
    expect(screen.getByTestId("grant-dialog-subject").textContent).toBe("/repo/settled-while-away");

    // Socket drops...
    view.rerender(
      <GrantPromptHost onMessage={c.onMessage} send={c.send} ws={null} store={c.store} loadPending={loadPending} />,
    );
    // ...and reconnects; the server now lists only "still-pending".
    loadPending.mockResolvedValueOnce([request("still-pending")]);
    view.rerender(
      <GrantPromptHost
        onMessage={c.onMessage}
        send={c.send}
        ws={{} as WebSocket}
        store={c.store}
        loadPending={loadPending}
      />,
    );
    await waitFor(() => expect(screen.getByTestId("grant-dialog-subject").textContent).toBe("/repo/still-pending"));
    expect(screen.getAllByTestId("grant-dialog")).toHaveLength(1);
    expect(c.sent).toEqual([]);
  });
});
