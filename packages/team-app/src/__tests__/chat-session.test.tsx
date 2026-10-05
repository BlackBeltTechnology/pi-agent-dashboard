/**
 * F13: reconnect + replay never duplicates the transcript; onSend goes over the
 * socket. Uses the REAL headless `useSessionState` and a fake socket.
 * See change: add-team-plugin.
 */
import type { MinimalSocket } from "@blackbelt-technology/pi-dashboard-app-kit";
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { makeHost } from "./helpers.js";

vi.mock("@blackbelt-technology/pi-dashboard-web/chat-embed", async () => (await import("./chat-mock.js")).chatEmbedMock());

import { useTeamChat } from "../agent/chat-session.js";

class FakeSocket implements MinimalSocket {
  sent: string[] = [];
  onopen: ((ev?: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev?: unknown) => void) | null = null;
  onerror: ((ev?: unknown) => void) | null = null;
  send(d: string) {
    this.sent.push(d);
  }
  close() {
    this.onclose?.();
  }
  open() {
    this.onopen?.();
  }
  push(msg: unknown) {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
}

const userMsg = (n: number) => ({
  seq: n,
  event: { eventType: "message_start", timestamp: n, data: { message: { role: "user", content: [{ type: "text", text: `m${n}` }] } } },
});

describe("F13: reconnect without duplication", () => {
  it("re-subscribes with lastSeq 0 on every open; the re-replay (5 + 1 new) leaves each message once", async () => {
    const sockets: FakeSocket[] = [];
    const host = makeHost();
    const { result } = renderHook(() =>
      useTeamChat(host, "sess-1", () => {
        const s = new FakeSocket();
        sockets.push(s);
        return s;
      }),
    );
    await waitFor(() => expect(sockets.length).toBe(1));
    act(() => sockets[0].open());
    expect(JSON.parse(sockets[0].sent[0])).toEqual({ type: "subscribe", sessionId: "sess-1", lastSeq: 0 });
    act(() => sockets[0].push({ type: "event_replay", sessionId: "sess-1", isLast: true, events: [1, 2, 3, 4, 5].map(userMsg) }));
    const count = () => (result.current.state as { messages: unknown[] }).messages.length;
    await waitFor(() => expect(count()).toBe(5));

    // socket drops; controller reconnects, re-subscribes and the server replays 5 + 1 new
    act(() => sockets[0].onclose?.());
    await waitFor(() => expect(sockets.length).toBe(2), { timeout: 3000 });
    act(() => sockets[1].open());
    expect(JSON.parse(sockets[1].sent[0])).toMatchObject({ type: "subscribe", lastSeq: 0 });
    act(() => sockets[1].push({ type: "event_replay", sessionId: "sess-1", isLast: true, events: [1, 2, 3, 4, 5, 6].map(userMsg) }));
    await waitFor(() => expect(count()).toBe(6));
    const texts = (result.current.state as { messages: Array<{ content?: unknown }> }).messages.map((m) => JSON.stringify(m));
    expect(new Set(texts).size).toBe(6);
  });

  it("sendPrompt / abort go over the same socket; nothing sent without a session", async () => {
    const sockets: FakeSocket[] = [];
    const host = makeHost();
    const { result } = renderHook(() => useTeamChat(host, "s", () => (sockets[sockets.push(new FakeSocket()) - 1])));
    await waitFor(() => expect(sockets.length).toBe(1));
    act(() => sockets[0].open());
    act(() => result.current.sendPrompt("hello"));
    act(() => result.current.abort());
    const types = sockets[0].sent.map((s) => JSON.parse(s).type);
    expect(types).toEqual(["subscribe", "send_prompt", "abort"]);
    expect(JSON.parse(sockets[0].sent[1])).toMatchObject({ sessionId: "s", text: "hello" });

    const idle = renderHook(() => useTeamChat(host, null));
    act(() => idle.result.current.sendPrompt("x"));
    expect(idle.result.current.status).toBe("disconnected");
  });
});
