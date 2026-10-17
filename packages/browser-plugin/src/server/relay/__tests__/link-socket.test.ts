/**
 * LinkSocket — a `RelaySocket` over the operator carrier (change:
 * add-operator-browser-relay, task 7.2 / D5). Test-plan #E21, #E22 (data
 * shape), #P2 and #X8 (congestion).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CARRIER_CONGESTED_BYTES, CARRIER_CONGESTED_MS, LINK_MAX_DATA, LinkSocket } from "../link-socket.js";
import { FakeSocket } from "./fake-socket.js";

const MiB = 1024 * 1024;

function makeLink(carrier = new FakeSocket(), linkId = "l".repeat(32)) {
  const link = new LinkSocket({ linkId, carrier });
  const messages: string[] = [];
  const closes: Array<{ code: number; reason: string }> = [];
  link.on("message", ((d: string) => messages.push(d)) as never);
  link.on("close", ((code: number, reason: string) => closes.push({ code, reason })) as never);
  return { link, carrier, messages, closes };
}

describe("LinkSocket", () => {
  afterEach(() => vi.useRealTimers());

  it("send → browser_host_relay_data {linkId, data} on the carrier only", () => {
    const { link, carrier } = makeLink();
    link.send('{"id":1}');
    expect(carrier.json()).toEqual([{ type: "browser_host_relay_data", linkId: "l".repeat(32), data: '{"id":1}' }]);
  });

  it("close → browser_host_relay_close {linkId, code, reason}, emits close once, readyState 3", () => {
    const { link, carrier, closes } = makeLink();
    link.close(1000, "bye");
    link.close(1000, "again");
    expect(carrier.json()).toEqual([
      { type: "browser_host_relay_close", linkId: "l".repeat(32), code: 1000, reason: "bye" },
    ]);
    expect(closes).toEqual([{ code: 1000, reason: "bye" }]);
    expect(link.readyState).toBe(3);
  });

  it("bufferedAmount mirrors the carrier", () => {
    const { link, carrier } = makeLink();
    carrier.bufferedAmount = 1234;
    expect(link.bufferedAmount).toBe(1234);
  });

  it("readyState follows the carrier (closed carrier → not open)", () => {
    const { link, carrier } = makeLink();
    expect(link.readyState).toBe(1);
    carrier.readyState = 3;
    expect(link.readyState).not.toBe(1);
  });

  it("feed delivers inbound data as one message; 16 MiB passes, 16 MiB + 1 closes 1009 (E21)", () => {
    const { link, messages, closes, carrier } = makeLink();
    link.feed("x".repeat(LINK_MAX_DATA));
    expect(messages).toHaveLength(1);
    expect(closes).toHaveLength(0);
    link.feed("x".repeat(LINK_MAX_DATA + 1));
    expect(messages).toHaveLength(1);
    expect(closes[0].code).toBe(1009);
    expect(carrier.json().at(-1)).toMatchObject({ type: "browser_host_relay_close", code: 1009 });
  });

  it("remoteClose (ext_close) emits close without echoing relay_close", () => {
    const { link, carrier, closes } = makeLink();
    link.remoteClose(1006);
    expect(closes).toEqual([{ code: 1006, reason: "" }]);
    expect(carrier.sent).toHaveLength(0);
  });

  it("carrier close closes the link (no relay_close sent to a dead carrier)", () => {
    const { link, carrier, closes } = makeLink();
    carrier.close(1006, "gone");
    expect(closes).toHaveLength(1);
    expect(link.readyState).not.toBe(1);
  });

  describe("congestion (P2, X8)", () => {
    beforeEach(() => vi.useFakeTimers());

    it("carrier > 32 MiB for 10 s closes 1013 carrier-congested — not at 9.9 s", () => {
      const carrier = new FakeSocket();
      carrier.bufferedAmount = 33 * MiB;
      const { closes } = makeLink(carrier);
      vi.advanceTimersByTime(CARRIER_CONGESTED_MS - 100);
      expect(closes).toHaveLength(0);
      vi.advanceTimersByTime(100);
      expect(closes).toEqual([{ code: 1013, reason: "carrier-congested" }]);
      // exactly the 1013 relay_close went out
      expect(carrier.json().at(-1)).toMatchObject({ code: 1013, reason: "carrier-congested" });
    });

    it("every link on a congested carrier closes", () => {
      const carrier = new FakeSocket();
      carrier.bufferedAmount = 33 * MiB;
      const a = makeLink(carrier, "a".repeat(32));
      const b = makeLink(carrier, "b".repeat(32));
      vi.advanceTimersByTime(CARRIER_CONGESTED_MS + 1000);
      expect(a.closes[0].code).toBe(1013);
      expect(b.closes[0].code).toBe(1013);
    });

    it("a dip below the threshold resets the window", () => {
      const carrier = new FakeSocket();
      carrier.bufferedAmount = 33 * MiB;
      const { closes } = makeLink(carrier);
      vi.advanceTimersByTime(8000);
      carrier.bufferedAmount = 1 * MiB;
      vi.advanceTimersByTime(1000);
      carrier.bufferedAmount = 33 * MiB;
      vi.advanceTimersByTime(CARRIER_CONGESTED_MS - 1000);
      expect(closes).toHaveLength(0);
      vi.advanceTimersByTime(1500);
      expect(closes).toHaveLength(1);
    });

    it("exactly at the threshold is not congested (strictly above)", () => {
      const carrier = new FakeSocket();
      carrier.bufferedAmount = CARRIER_CONGESTED_BYTES;
      const { closes } = makeLink(carrier);
      vi.advanceTimersByTime(CARRIER_CONGESTED_MS * 2);
      expect(closes).toHaveLength(0);
    });

    it("a closed link stops polling (no timer left)", () => {
      const { link } = makeLink();
      link.close(1000, "x");
      expect(vi.getTimerCount()).toBe(0);
    });
  });
});
