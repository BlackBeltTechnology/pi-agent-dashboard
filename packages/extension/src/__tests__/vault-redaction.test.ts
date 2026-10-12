/**
 * Redaction handlers: tool_result (deep + spill file), streaming hold-back,
 * message_end, user_bash (UTF-8 safe), rotation, and the masking overhead bound.
 * See change: add-credential-vault (test-plan E23-E27, P1).
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMasker } from "../vault-masker.js";
import { type BashOperationsLike, createVaultRedaction } from "../vault-redaction.js";

const T = (name: string) => `[REDACTED:${name}]`;
let entries: Array<{ name: string; value: string }>;
let version: number;
const state = () => ({ version, entries });
const hold = (name: string, value: string) => { entries.push({ name, value }); version++; };

let tmp: string;
const mk = (localOps?: BashOperationsLike) =>
  createVaultRedaction({ getState: state, createLocalBashOperations: () => localOps as BashOperationsLike, tmpDir: tmp });

beforeEach(() => {
  entries = []; version = 0;
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "vault-red-")));
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe("tool_result (E23)", () => {
  it("masks content, details.truncation.content, structuredContent and the full-output file", async () => {
    hold("GEMINI_API_KEY", "abcdefgh12");
    const spill = path.join(tmp, "pi-bash-0123456789abcdef.log");
    fs.writeFileSync(spill, "before abcdefgh12 after\nsecond abcdefgh12\n", { mode: 0o600 });
    const res = await mk().toolResult({
      content: [{ type: "text", text: "key=abcdefgh12" }],
      details: { truncation: { content: "tail abcdefgh12" }, fullOutputPath: spill },
      structuredContent: { x: "abcdefgh12" },
    });
    if (!res) throw new Error("expected a replacement result");
    expect(JSON.stringify(res)).not.toContain("abcdefgh12");
    expect(res.content).toEqual([{ type: "text", text: `key=${T("GEMINI_API_KEY")}` }]);
    expect((res.details as { truncation: { content: string } }).truncation.content).toBe(`tail ${T("GEMINI_API_KEY")}`);
    expect(res.structuredContent).toEqual({ x: T("GEMINI_API_KEY") });
    const file = fs.readFileSync(spill, "utf8");
    expect(file).not.toContain("abcdefgh12");
    expect(file).toBe(`before ${T("GEMINI_API_KEY")} after\nsecond ${T("GEMINI_API_KEY")}\n`);
    expect(fs.statSync(spill).mode & 0o777).toBe(0o600);
    expect(fs.readdirSync(tmp).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });

  it("rewrites a spill file larger than one chunk without splitting a value at the boundary", async () => {
    hold("K_KEY", "abcdefgh12");
    const spill = path.join(tmp, "pi-bash-big.log");
    const pad = "x".repeat(1024 * 1024 - 4);
    fs.writeFileSync(spill, `${pad}abcdefgh12${pad}`);
    await mk().toolResult({ content: [], details: { fullOutputPath: spill } });
    const out = fs.readFileSync(spill, "latin1");
    expect(out).not.toContain("abcdefgh12");
    expect(out).toContain(T("K_KEY"));
    expect(out.length).toBe(pad.length * 2 + T("K_KEY").length);
  });

  it("leaves a file that is not a pi spill file alone", async () => {
    hold("K_KEY", "abcdefgh12");
    const other = path.join(tmp, "notes.txt");
    fs.writeFileSync(other, "abcdefgh12");
    await mk().toolResult({ content: [], details: { fullOutputPath: other } });
    expect(fs.readFileSync(other, "utf8")).toBe("abcdefgh12");
    const outside = path.join(os.homedir(), "pi-evil.log");
    fs.mkdirSync(path.dirname(outside), { recursive: true });
    fs.writeFileSync(outside, "abcdefgh12");
    await mk().toolResult({ content: [], details: { fullOutputPath: outside } });
    expect(fs.readFileSync(outside, "utf8")).toBe("abcdefgh12");
    fs.rmSync(outside);
  });

  it("is a no-op while nothing is held, and when nothing matches", async () => {
    expect(await mk().toolResult({ content: [{ type: "text", text: "abcdefgh12" }] })).toBeUndefined();
    hold("K_KEY", "abcdefgh12");
    expect(await mk().toolResult({ content: [{ type: "text", text: "nothing here" }] })).toBeUndefined();
  });

  it("does not mutate the original result", async () => {
    hold("K_KEY", "abcdefgh12");
    const event = { content: [{ type: "text", text: "abcdefgh12" }], details: { a: ["abcdefgh12"] } };
    const before = structuredClone(event);
    await mk().toolResult(event);
    expect(event).toEqual(before);
  });
});

describe("streaming hold-back (E24)", () => {
  const V = "abcdefghijklmnopqrst"; // L = 20
  it("never emits a prefix of the value at a snapshot end, and loses no characters", () => {
    hold("K_KEY", V);
    const m = createMasker(state);
    const full = `out ${V} done`;
    const emitted: string[] = [];
    for (const upTo of [5 + 1, 5 + 10, 5 + 19, full.length]) {
      const snap = full.slice(0, upTo);
      const isEnd = upTo === full.length;
      emitted.push(isEnd ? m.mask(snap) : m.maskAndHold(snap).emit);
    }
    for (const e of emitted.slice(0, -1)) {
      for (let k = 1; k < V.length; k++) expect(e.endsWith(V.slice(0, k))).toBe(false);
      expect(e).not.toContain(V);
    }
    expect(emitted.at(-1)).toBe(`out ${T("K_KEY")} done`);
  });

  it("maskAndHold of a delta stream re-attaches the held tail to the next chunk", () => {
    hold("K_KEY", V);
    const m = createMasker(state);
    let carry = ""; let out = "";
    for (const chunk of [`out ${V.slice(0, 1)}`, V.slice(1, 10), V.slice(10, 19), `${V.slice(19)} done`]) {
      const r = m.maskAndHold(carry + chunk);
      carry = r.held; out += r.emit;
    }
    out += m.mask(carry);
    expect(out).toBe(`out ${T("K_KEY")} done`);
  });

  it("does not hold a tail that cannot be the start of a value", () => {
    hold("K_KEY", V);
    expect(createMasker(state).maskAndHold("plain text")).toEqual({ emit: "plain text", held: "" });
  });

  it("does not cut through a complete match", () => {
    hold("K_KEY", "abab1234"); hold("L_KEY", "ab");
    const m = createMasker(state);
    expect(m.mask("xx abab1234 yy")).toBe(`xx ${T("K_KEY")} yy`);
  });
});

describe("message_end (E25)", () => {
  it("masks assistant text and tool-call arguments and keeps role and usage", () => {
    hold("GEMINI_API_KEY", "abcdefgh12");
    const message = {
      role: "assistant", usage: { input: 3, output: 4 },
      content: [{ type: "text", text: "use abcdefgh12" }, { type: "toolCall", id: "t1", name: "bash", arguments: { command: "echo abcdefgh12" } }],
    };
    const res = mk().messageEnd({ message }) as { message: typeof message };
    expect(res.message.role).toBe("assistant");
    expect(res.message.usage).toEqual({ input: 3, output: 4 });
    expect(res.message.content[0]).toEqual({ type: "text", text: `use ${T("GEMINI_API_KEY")}` });
    expect((res.message.content[1] as { arguments: { command: string } }).arguments.command).toBe(`echo ${T("GEMINI_API_KEY")}`);
    expect(JSON.stringify(message)).toContain("abcdefgh12"); // original untouched
  });
  it("masks a secret in a field that is merely CALLED `type` or `role`, but keeps the real discriminators", () => {
    hold("K_KEY", "abcdefgh12");
    const res = mk().messageEnd({
      message: { role: "assistant", content: [{ type: "toolCall", id: "t", name: "x", arguments: { type: "abcdefgh12", role: "abcdefgh12" } }] },
    }) as { message: { role: string; content: Array<{ type: string; arguments: { type: string; role: string } }> } };
    expect(res.message.role).toBe("assistant");
    expect(res.message.content[0].type).toBe("toolCall");
    expect(res.message.content[0].arguments).toEqual({ type: T("K_KEY"), role: T("K_KEY") });
  });
  it("returns nothing when there is nothing to mask", () => {
    hold("K_KEY", "abcdefgh12");
    expect(mk().messageEnd({ message: { role: "assistant", content: [{ type: "text", text: "hi" }] } })).toBeUndefined();
  });
});

describe("user_bash (E26)", () => {
  it("masks streamed chunks that split the value and a 4-byte character, and flushes the tail on exit", async () => {
    hold("K_KEY", "abcdefgh12");
    const emoji = Buffer.from("😀", "utf8"); // 4 bytes
    const chunks = [
      Buffer.from("start abcd"), Buffer.from("efgh12 "), emoji.subarray(0, 2), emoji.subarray(2), Buffer.from(" end abcd"),
    ];
    const local: BashOperationsLike = {
      exec: async (_c, _d, o) => { for (const c of chunks) o.onData(c); return { exitCode: 0 }; },
    };
    const got: Buffer[] = [];
    const ops = (await mk(local).userBash())!.operations;
    const res = await ops.exec("echo", "/", { onData: (b) => got.push(b) });
    expect(res).toEqual({ exitCode: 0 });
    const text = Buffer.concat(got).toString("utf8");
    expect(text).toBe(`start ${T("K_KEY")} 😀 end abcd`);
    expect(text).not.toContain("�");
  });
  it("uses the default operations while nothing is held", async () => {
    expect(await mk().userBash()).toBeUndefined();
  });
});

describe("rotation (E27)", () => {
  it("a rotated-away value stays masked", () => {
    hold("K_KEY", "old12345678");
    const r = mk();
    hold("K_KEY", "new12345678");
    expect(r.masker.mask("printed old12345678 and new12345678")).toBe(`printed ${T("K_KEY")} and ${T("K_KEY")}`);
  });
});

describe("masking overhead (P1)", () => {
  it("p95 <= 5 ms per 64 KiB event with 20 held values", () => {
    for (let i = 0; i < 20; i++) hold(`K${i}_KEY`, `v${i}-`.padEnd(8 + ((i * 7) % 57), String.fromCharCode(97 + (i % 26))));
    const m = createMasker(state);
    const rng = (() => { let s = 42; return () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296; })();
    const mkPayload = () => {
      const chars = Array.from({ length: 64 * 1024 }, () => String.fromCharCode(97 + Math.floor(rng() * 26)));
      let text = chars.join("");
      for (let n = 0; n < 3; n++) {
        const v = entries[Math.floor(rng() * entries.length)].value;
        const at = Math.floor(rng() * (text.length - v.length));
        text = text.slice(0, at) + v + text.slice(at + v.length);
      }
      return { content: [{ type: "text", text }] };
    };
    const payloads = Array.from({ length: 1100 }, mkPayload);
    for (let i = 0; i < 100; i++) m.maskDeep(payloads[i], { hold: true });
    const times: number[] = [];
    for (let i = 100; i < 1100; i++) {
      const t0 = performance.now();
      m.maskDeep(payloads[i], { hold: true });
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    const p95 = times[Math.floor(times.length * 0.95)];
    expect(p95).toBeLessThanOrEqual(5);
  });
});
