import { describe, expect, it } from "vitest";
import { encodeFrame, NulFrameDecoder } from "../pipe-framing.js";

describe("pipe framing (NUL-delimited JSON)", () => {
  it("encodes one NUL-terminated JSON frame", () => {
    const buf = encodeFrame({ id: 1, method: "Browser.getVersion" });
    expect(buf.at(-1)).toBe(0);
    expect(JSON.parse(buf.subarray(0, -1).toString("utf8"))).toEqual({ id: 1, method: "Browser.getVersion" });
  });

  it("splits several frames merged in one chunk", () => {
    const d = new NulFrameDecoder();
    const chunk = Buffer.concat([encodeFrame({ a: 1 }), encodeFrame({ b: 2 }), encodeFrame({ c: 3 })]);
    expect(d.push(chunk).map((f) => JSON.parse(f))).toEqual([{ a: 1 }, { b: 2 }, { c: 3 }]);
  });

  it("joins a frame split across chunks, at any byte boundary", () => {
    const whole = encodeFrame({ text: "héllo wörld ✓ 日本語" });
    for (let cut = 1; cut < whole.length; cut++) {
      const d = new NulFrameDecoder();
      const out = [...d.push(whole.subarray(0, cut)), ...d.push(whole.subarray(cut))];
      expect(out.map((f) => JSON.parse(f))).toEqual([{ text: "héllo wörld ✓ 日本語" }]);
    }
  });

  it("handles byte-by-byte delivery and a trailing partial frame", () => {
    const d = new NulFrameDecoder();
    const bytes = Buffer.concat([encodeFrame({ n: 1 }), encodeFrame({ n: 2 }).subarray(0, 4)]);
    const out: string[] = [];
    for (const b of bytes) out.push(...d.push(Buffer.from([b])));
    expect(out.map((f) => JSON.parse(f))).toEqual([{ n: 1 }]);
    expect(d.push(encodeFrame({ n: 2 }).subarray(4)).map((f) => JSON.parse(f))).toEqual([{ n: 2 }]);
  });

  it("ignores empty frames and accepts string chunks; reset drops a partial frame", () => {
    const d = new NulFrameDecoder();
    expect(d.push("\0\0{\"x\":1}\0")).toEqual(['{"x":1}']);
    d.push('{"par');
    d.reset();
    expect(d.push('{"y":2}\0')).toEqual(['{"y":2}']);
  });
});
