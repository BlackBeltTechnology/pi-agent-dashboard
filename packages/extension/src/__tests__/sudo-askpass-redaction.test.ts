/**
 * D7 C — masking of the operator-entered sudo password: registry seam, the
 * `userBash({always})` composition, every output path, chunk splits, exact
 * occurrence, short values, dedupe against the vault, lifetime and non-leak.
 * See change: add-sudo-credential-prompt (test-plan #S27–#S35, #S73).
 *
 * The bridge-flow rows (#S26, #S33 gate half, #S34, #S35, #S73 cache half) run the real
 * controller (sudo-askpass-harness) against the real vault-redaction, with `bridgeUserBash`
 * mirroring the bridge.ts `user_bash` handler (the source is pinned by a text check).
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mapEventToProtocol } from "../event-forwarder.js";
import type { SudoAskpass } from "../sudo-askpass/index.js";
import { SUDO_HELPER_OK_MAGIC } from "../sudo-askpass/protocol.js";
import { registerSudoPassword, SUDO_MASK_REGISTRY_KEY, sudoMaskState } from "../sudo-askpass/sudo-mask-registry.js";
import { createVaultForwardFilter } from "../vault-forwarder.js";
import { type BashOperationsLike, createVaultRedaction, type VaultRedaction } from "../vault-redaction.js";
import { createHarness, type Harness, pollUntil, SESSION, settle } from "./sudo-askpass-harness.js";

const TOKEN = "[REDACTED:SUDO_PASSWORD]";
const PW = "s3cr3t-Pa55w0rd";
let vaultEntries: Array<{ name: string; value: string }>;
let vaultVersion: number;
const holdVault = (name: string, value: string) => { vaultEntries.push({ name, value }); vaultVersion++; };

/** The exact composition bridge.ts passes as the masker's getState. */
const composed = () => {
  const vault = { version: vaultVersion, entries: vaultEntries };
  const sudo = sudoMaskState();
  return { version: vault.version + sudo.version, entries: [...vault.entries, ...sudo.entries] };
};

let tmp: string;
let logs: string[];
const mk = (localOps?: BashOperationsLike): VaultRedaction =>
  createVaultRedaction({
    getState: composed,
    createLocalBashOperations: () => localOps as BashOperationsLike,
    tmpDir: tmp,
    log: (l) => logs.push(l),
  });

const resetRegistry = () => { delete (process as unknown as Record<symbol, unknown>)[SUDO_MASK_REGISTRY_KEY]; };

beforeEach(() => {
  resetRegistry();
  vaultEntries = []; vaultVersion = 0; logs = [];
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "sudo-red-")));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
  resetRegistry();
});

/** Fake pi local bash operations: feeds `script(onData)` then resolves. */
const fakeOps = (script: (onData: (s: string) => void) => void | Promise<void>): BashOperationsLike => ({
  async exec(_cmd, _cwd, options) {
    await script((s) => options.onData(Buffer.from(s, "utf8")));
    return { exitCode: 0 };
  },
});

/** Run the wrapped operations and return the concatenated bytes seen by pi. */
async function runWrapped(red: VaultRedaction, always: boolean): Promise<{ text: string; chunks: string[] }> {
  const res = await red.userBash({ always });
  if (!res) throw new Error("expected wrapped operations");
  const chunks: string[] = [];
  await res.operations.exec("sudo true", "/", { onData: (d) => chunks.push(d.toString("utf8")) });
  return { text: chunks.join(""), chunks };
}

describe("registry seam (#S32)", () => {
  it("is append-only, idempotent, ignores empty input, and keeps a monotonic version", () => {
    expect(sudoMaskState()).toEqual({ version: 0, entries: [] });
    registerSudoPassword("");
    expect(sudoMaskState().version).toBe(0);
    registerSudoPassword("a");
    registerSudoPassword("a");
    registerSudoPassword("b");
    const s = sudoMaskState();
    expect(s.version).toBe(2);
    expect(s.entries).toEqual([{ name: "SUDO_PASSWORD", value: "a" }, { name: "SUDO_PASSWORD", value: "b" }]);
  });

  it("keeps state on process so a simulated reload (new module instance) still masks and never lowers the version", async () => {
    registerSudoPassword(PW);
    const before = sudoMaskState().version;
    vi.resetModules();
    const fresh = await import("../sudo-askpass/sudo-mask-registry.js");
    expect(fresh.sudoMaskState().version).toBe(before);
    expect(fresh.sudoMaskState().entries).toEqual([{ name: "SUDO_PASSWORD", value: PW }]);
    fresh.registerSudoPassword("second");
    expect(fresh.sudoMaskState().version).toBe(before + 1);
    expect(sudoMaskState().entries.map((e) => e.value)).toEqual([PW, "second"]);
    const res = await mk().toolResult({ content: [{ type: "text", text: `x ${PW} y` }] });
    expect(res?.content).toEqual([{ type: "text", text: `x ${TOKEN} y` }]);
  });
});

describe("user_bash composition (#S33, #S34, #S35 — redaction half)", () => {
  it("masks the first-ever !sudo: empty vault, password registered mid-command, echoed afterwards", async () => {
    const red = mk(fakeOps((emit) => {
      emit("[sudo] running\n");
      registerSudoPassword(PW); // accepted mid-command, after user_bash fired
      emit(`echo ${PW}\n`);
    }));
    const { text } = await runWrapped(red, true);
    expect(text).toBe(`[sudo] running\necho ${TOKEN}\n`);
    expect(text).not.toContain(PW);
  });

  it("without always, userBash() is unchanged: undefined while the masker is inactive", async () => {
    const red = mk(fakeOps(() => {}));
    expect(await red.userBash()).toBeUndefined();
    expect(await red.userBash({})).toBeUndefined();
    expect(await red.userBash({ always: false })).toBeUndefined();
    expect(await red.userBash({ always: true })).toBeDefined();
  });

  it("still masks vault values in ! output exactly as before, with or without always", async () => {
    holdVault("GEMINI_API_KEY", "abcdefgh12");
    for (const always of [false, true]) {
      const red = mk(fakeOps((emit) => emit("k=abcdefgh12\n")));
      const { text } = await runWrapped(red, always);
      expect(text).toBe("k=[REDACTED:GEMINI_API_KEY]\n");
    }
  });

  it("fail closed (d): installed but no local operations → undefined (no wrapper to track)", async () => {
    const red = mk(undefined);
    expect(await red.userBash({ always: true })).toBeUndefined();
  });
});

describe("coverage of every output path (#S27)", () => {
  for (const withVault of [false, true]) {
    it(`masks tool_result, message_end, user_bash chunks and event_forward frames (vault ${withVault ? "holding hunter2" : "empty"})`, async () => {
      if (withVault) holdVault("MY_VAULT", "hunter2");
      registerSudoPassword(PW);
      const red = mk(fakeOps((emit) => emit(`out ${PW}${withVault ? " hunter2" : ""}\n`)));
      const spill = path.join(tmp, "pi-bash-0123456789abcdef.log");
      fs.writeFileSync(spill, `before ${PW} after\nlater ${PW}\n`, { mode: 0o600 });
      const extra = withVault ? " hunter2" : "";

      const res = await red.toolResult({
        content: [{ type: "text", text: `c ${PW}${extra}` }],
        details: { truncation: { content: `t ${PW}` }, fullOutputPath: spill },
        structuredContent: { k: PW },
      });
      if (!res) throw new Error("expected a replacement result");
      expect(res.content).toEqual([{ type: "text", text: `c ${TOKEN}${withVault ? " [REDACTED:MY_VAULT]" : ""}` }]);
      expect((res.details as { truncation: { content: string } }).truncation.content).toBe(`t ${TOKEN}`);
      expect(res.structuredContent).toEqual({ k: TOKEN });
      expect(JSON.stringify(res)).not.toContain(PW);
      const file = fs.readFileSync(spill, "utf8");
      expect(file).toBe(`before ${TOKEN} after\nlater ${TOKEN}\n`);
      expect(file).not.toContain(PW);

      const msg = red.messageEnd({ message: { role: "assistant", content: [{ type: "text", text: `m ${PW}${extra}` }] } });
      if (!msg) throw new Error("expected a replacement message");
      const jsonl = JSON.stringify(msg.message); // the line pi would append to the session file
      expect(jsonl).not.toContain(PW);
      expect(jsonl).toContain(TOKEN);
      if (withVault) { expect(jsonl).not.toContain("hunter2"); expect(jsonl).toContain("[REDACTED:MY_VAULT]"); }

      const { text } = await runWrapped(red, true);
      expect(text).toBe(`out ${TOKEN}${withVault ? " [REDACTED:MY_VAULT]" : ""}\n`);

      const filter = createVaultForwardFilter(red.masker);
      const frames = filter.filter(mapEventToProtocol("s1", {
        type: "tool_execution_update", toolCallId: "t1", partialResult: { content: [{ type: "text", text: `f ${PW}` }] },
      }));
      expect(JSON.stringify(frames)).not.toContain(PW);
      expect(JSON.stringify(frames)).toContain(TOKEN);
      expect(logs.join("\n")).not.toContain(PW);
    });
  }
});

describe("chunk split (#S28)", () => {
  const body = (p: string) => `x${p}y`;
  it("never emits a fragment of the password for a split at every offset, and masks exactly once", async () => {
    expect(PW.length).toBe(15);
    registerSudoPassword(PW);
    const full = body(PW);
    for (let k = 1; k < PW.length; k++) {
      const cut = 1 + k; // inside the password
      const red = mk(fakeOps((emit) => { emit(full.slice(0, cut)); emit(full.slice(cut)); }));
      const { text, chunks } = await runWrapped(red, true);
      expect(text, `split ${k}`).toBe(`x${TOKEN}y`);
      expect(text.split(TOKEN)).toHaveLength(2);
      for (const c of chunks) expect(c.includes(PW)).toBe(false);
      // no chunk ends with a partial prefix of the password
      for (let n = 1; n < PW.length; n++) expect(chunks.join("|").includes(`${PW.slice(0, n)}|`)).toBe(false);
    }
  });

  it("masks a password ending exactly at the final tail (flush on exit)", async () => {
    registerSudoPassword(PW);
    const red = mk(fakeOps((emit) => { emit("x"); emit(PW); }));
    const { text } = await runWrapped(red, true);
    expect(text).toBe(`x${TOKEN}`);
  });

  it("masks a password ending at the tail when only a prefix is held at the end of the stream", async () => {
    registerSudoPassword(PW);
    const red = mk(fakeOps((emit) => { emit(`x${PW.slice(0, 7)}`); emit(PW.slice(7)); }));
    expect((await runWrapped(red, true)).text).toBe(`x${TOKEN}`);
  });
});

describe("exact occurrence (#S29)", () => {
  const passwords = [
    "a.b*c+(d)[e]\\$^/?",
    "pässwörd✓😀",
    `p${"z".repeat(255)}`,
  ];
  for (const pw of passwords) {
    it(`redacts verbatim ${JSON.stringify(pw.slice(0, 12))}… (length ${pw.length}); prefix, base64 and reversed are NOT redacted`, async () => {
      registerSudoPassword(pw);
      const red = mk();
      const run = async (t: string) => (await red.toolResult({ content: [{ type: "text", text: t }] }))?.content as Array<{ text: string }> | undefined;

      expect((await run(`echo ${pw}!`))?.[0].text).toBe(`echo ${TOKEN}!`);

      const prefix = [...pw].slice(0, Math.max(1, [...pw].length - 3)).join("");
      expect(await run(`echo ${prefix}`)).toBeUndefined();

      const b64 = Buffer.from(pw, "utf8").toString("base64");
      expect(await run(`echo ${b64}`)).toBeUndefined();

      const reversed = [...pw].reverse().join("");
      if (reversed !== pw) expect(await run(`echo ${reversed}`)).toBeUndefined();
    });
  }
});

describe("short passwords (#S30)", () => {
  it("replaces every occurrence of a, ab, abc and garbles unrelated output as documented", async () => {
    const cases: Array<[string, string]> = [
      ["a", `b${TOKEN}n${TOKEN}n${TOKEN} ${TOKEN}bc`],
      ["ab", `banana ${TOKEN}c`],
      ["abc", `banana ${TOKEN}`],
    ];
    for (const [pw, expected] of cases) {
      resetRegistry();
      registerSudoPassword(pw);
      const res = await mk().toolResult({ content: [{ type: "text", text: "banana abc" }] });
      expect((res?.content as Array<{ text: string }>)[0].text, pw).toBe(expected);
    }
  });

  it("applies no minimum length: a 1-char value is registered and masks", () => {
    registerSudoPassword("a");
    expect(sudoMaskState().version).toBe(1);
  });
});

describe("dedupe against the vault (#S31)", () => {
  it("the vault name wins, with a single replacement and no SUDO_PASSWORD double-label", async () => {
    holdVault("MY_VAULT", "hunter2");
    registerSudoPassword("hunter2");
    const res = await mk().toolResult({ content: [{ type: "text", text: "echo hunter2" }] });
    expect(res?.content).toEqual([{ type: "text", text: "echo [REDACTED:MY_VAULT]" }]);
    const { text } = await runWrapped(mk(fakeOps((e) => e("echo hunter2"))), true);
    expect(text).toBe("echo [REDACTED:MY_VAULT]");
    expect(text).not.toContain("SUDO_PASSWORD");
  });
});

describe("lifetime / composition (#S32)", () => {
  it("composed version is vault+sudo, bumps when either changes, and each bump rebuilds the masker", async () => {
    const red = mk();
    expect(composed().version).toBe(0);
    registerSudoPassword("one-value");
    expect(composed().version).toBe(1);
    expect((await red.toolResult({ content: [{ type: "text", text: "one-value" }] }))?.content).toEqual([{ type: "text", text: TOKEN }]);
    holdVault("V", "vault-value");
    expect(composed().version).toBe(2);
    expect((await red.toolResult({ content: [{ type: "text", text: "vault-value one-value" }] }))?.content).toEqual([{ type: "text", text: `[REDACTED:V] ${TOKEN}` }]);
    registerSudoPassword("two-value");
    expect(composed().version).toBe(3);
    expect((await red.toolResult({ content: [{ type: "text", text: "two-value" }] }))?.content).toEqual([{ type: "text", text: TOKEN }]);
  });

  it("exposes no removal path, so expiry / Forget / shutdown / disabling cannot unmask", async () => {
    const mod = await import("../sudo-askpass/sudo-mask-registry.js");
    expect(Object.keys(mod).filter((k) => /unregister|remove|clear|reset|forget/i.test(k))).toEqual([]);
    registerSudoPassword(PW);
    const v = sudoMaskState().version;
    // nothing a lifecycle event can call lowers the version or drops the value
    expect(sudoMaskState().version).toBe(v);
    expect((await mk().toolResult({ content: [{ type: "text", text: PW }] }))?.content).toEqual([{ type: "text", text: TOKEN }]);
  });

  it("bridge.ts composes vault + sudo state and does not rely on new masker methods", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "../bridge.ts"), "utf8");
    expect(src).toContain('from "./sudo-askpass/sudo-mask-registry.js"');
    expect(src).toMatch(/version:\s*vault\.version\s*\+\s*sudo\.version/);
    expect(src).toMatch(/entries:\s*\[\.\.\.vault\.entries,\s*\.\.\.sudo\.entries\]/);
  });

  it("leaves vault-masker.ts and vault-delivery.ts untouched relative to origin/develop", () => {
    const root = path.resolve(__dirname, "../../../..");
    try {
      execFileSync("git", ["rev-parse", "--verify", "--quiet", "origin/develop"], { cwd: root, stdio: "ignore" });
    } catch {
      return; // no develop ref available (e.g. shallow checkout): nothing to compare against
    }
    const diff = execFileSync("git", ["diff", "origin/develop", "--", "packages/extension/src/vault-masker.ts", "packages/extension/src/vault-delivery.ts"], { cwd: root, encoding: "utf8" });
    expect(diff).toBe("");
  });
});

describe("non-leak to the LLM / transcript (#S73 — masking half)", () => {
  it("a bash call echoing the password leaks it nowhere: model result, JSONL, spill, message_end, forward frame, logs", async () => {
    registerSudoPassword(PW);
    const red = mk(fakeOps((emit) => emit(`$PW=${PW}\n`)));
    const spill = path.join(tmp, "pi-bash-canary0123456789.log");
    fs.writeFileSync(spill, `full output ${PW}\n`, { mode: 0o600 });

    const result = await red.toolResult({ content: [{ type: "text", text: `$PW=${PW}` }], details: { fullOutputPath: spill } });
    const message = red.messageEnd({ message: { role: "assistant", content: [{ type: "toolCall", id: "c1", name: "bash", arguments: { command: `echo "${PW}"` } }] } });
    const stream = (await runWrapped(red, true)).text;
    const frames = createVaultForwardFilter(red.masker).filter(mapEventToProtocol("s1", {
      type: "tool_execution_end", toolCallId: "c1", result: { content: [{ type: "text", text: PW }] },
    }));
    const surfaces = [JSON.stringify(result), JSON.stringify(message), stream, fs.readFileSync(spill, "utf8"), JSON.stringify(frames), logs.join("\n")];
    for (const s of surfaces) expect(s).not.toContain(PW);
    // the output the model sees differs from the unmasked one only by the masked token
    expect(stream).toBe(`$PW=${TOKEN}\n`);
  });
});

// ---------------------------------------------------------------------------
// Bridge flow: real controller + real vault-redaction
// ---------------------------------------------------------------------------

/** Mirrors the bridge.ts `user_bash` handler exactly (pinned against the source below). */
async function bridgeUserBash(ctl: SudoAskpass, red: VaultRedaction) {
  const installed = ctl.featureInstalled();
  const result = await red.userBash({ always: installed });
  if (!installed || !result) return result;
  return { operations: ctl.trackUserBash(result.operations) };
}

/** Run operations returned by the handler (or the raw ones when it yields nothing). */
async function runOps(ops: BashOperationsLike, command = "sudo true"): Promise<string> {
  const chunks: string[] = [];
  await ops.exec(command, "/", { onData: (d) => chunks.push(d.toString("utf8")) });
  return chunks.join("");
}

const harnesses: Harness[] = [];
/** A harness whose accepted passwords land in the REAL registry (as in bridge.ts), with a call-order log. */
function bridgeHarness(cfg: { cacheMinutes?: number } = { cacheMinutes: 5 }, events: string[] = []): Harness {
  const h = createHarness({ cfg, deps: { registerPassword: (v) => { events.push("register"); registerSudoPassword(v); } } });
  harnesses.push(h);
  return h;
}
afterEach(() => {
  for (const h of harnesses.splice(0)) h.dispose();
  vi.restoreAllMocks();
});

describe("gate opens at user_bash start and closes at its end (#S33 gate half)", () => {
  it("first-ever !sudo, empty vault: request served mid-command, echo masked, next helper request refused", async () => {
    const h = bridgeHarness();
    await h.install();
    expect(h.ctl.featureInstalled()).toBe(true);
    expect(sudoMaskState().entries).toEqual([]);

    let helperReply: { ok: boolean; password?: string } | undefined;
    const red = mk(fakeOps(async (emit) => {
      emit("[sudo] password for u: \n");
      const asked = h.ask();
      await pollUntil(() => h.requests().length === 1, "helper request while the command runs");
      expect(h.requests()[0].commands).toEqual(["sudo true"]);
      h.respond(h.requests()[0].callId, PW);
      helperReply = await asked;
      emit(`echo ${PW}\n`);
    }));
    const res = await bridgeUserBash(h.ctl, red);
    expect(res).toBeDefined();
    const text = await runOps(res!.operations);

    expect(helperReply).toEqual({ ok: true, password: PW });
    expect(text).toBe(`[sudo] password for u: \necho ${TOKEN}\n`);
    expect(text).not.toContain(PW);
    // command ended: the gate is closed again
    await expect(h.ask("[sudo] password for u: ", 9999)).resolves.toEqual({ ok: false });
    expect(h.requests()).toHaveLength(1);
  });

  it("closes the gate also when the command throws", async () => {
    const h = bridgeHarness();
    await h.install();
    const red = mk(fakeOps(() => { throw new Error("boom"); }));
    const res = await bridgeUserBash(h.ctl, red);
    await expect(runOps(res!.operations)).rejects.toThrow("boom");
    await expect(h.ask()).resolves.toEqual({ ok: false });
    expect(h.requests()).toHaveLength(0);
  });
});

describe("user_bash handler unchanged when the feature is not installed (#S34)", () => {
  const notInstalled: Array<[string, (h: Harness) => Promise<void>]> = [
    ["no identity received", async () => {}],
    ["identity without the sudo-credential feature", (h) => h.install([])],
  ];

  for (const [label, prepare] of notInstalled) {
    it(`${label}: masker inactive → undefined, exactly as the baseline`, async () => {
      const h = bridgeHarness();
      await prepare(h);
      expect(h.ctl.featureInstalled()).toBe(false);
      const red = mk(fakeOps(() => {}));
      expect(await bridgeUserBash(h.ctl, red)).toBeUndefined();
      expect(await red.userBash()).toBeUndefined();
    });

    it(`${label}: masker active → vault masking identical to baseline, command untracked`, async () => {
      const h = bridgeHarness();
      await prepare(h);
      holdVault("GEMINI_API_KEY", "abcdefgh12");
      const script = (emit: (s: string) => void) => emit("k=abcdefgh12\n");
      const handled = await bridgeUserBash(h.ctl, mk(fakeOps(script)));
      const baseline = await mk(fakeOps(script)).userBash();
      expect(handled).toBeDefined();
      expect(await runOps(handled!.operations)).toBe(await runOps(baseline!.operations));
      expect(await runOps(handled!.operations)).toBe("k=[REDACTED:GEMINI_API_KEY]\n");
      expect(h.ctl.socketPath()).toBeUndefined(); // nothing installed → no helper endpoint to be tracked for
    });
  }

  it("installed, masker inactive → always wrapped (and tracked); installed + vault → still masked", async () => {
    const h = bridgeHarness();
    await h.install();
    expect(await bridgeUserBash(h.ctl, mk(fakeOps(() => {})))).toBeDefined();
    holdVault("GEMINI_API_KEY", "abcdefgh12");
    const res = await bridgeUserBash(h.ctl, mk(fakeOps((emit) => emit("k=abcdefgh12\n"))));
    expect(await runOps(res!.operations)).toBe("k=[REDACTED:GEMINI_API_KEY]\n");
  });

  it("bridge.ts user_bash handler wires always/tracking exactly as mirrored here", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "../bridge.ts"), "utf8");
    expect(src).toMatch(/const installed = sudoAskpass\.featureInstalled\(\);/);
    expect(src).toMatch(/vaultRedaction\.userBash\(\{ always: installed \}\)/);
    expect(src).toMatch(/if \(!installed \|\| !result\) return result as any;/);
    expect(src).toMatch(/sudoAskpass\.trackUserBash\(result\.operations\)/);
  });
});

describe("user_bash fail-closed paths (#S35)", () => {
  it("(d) installed but no local operations: handler returns undefined, nothing tracked, helper refused", async () => {
    const h = bridgeHarness();
    await h.install();
    const red = mk(undefined);
    expect(await bridgeUserBash(h.ctl, red)).toBeUndefined();
    // pi then runs the command natively with no tracker: a helper request is refused (exit 1 path)
    await expect(h.ask()).resolves.toEqual({ ok: false });
    expect(h.requests()).toHaveLength(0);
  });

  it("(f) a ! command started before install stays untracked: echo unmasked (documented), gate closed unless another call is in flight", async () => {
    const h = bridgeHarness();
    // user_bash fired before the identity arrived: feature not installed, masker inactive → raw operations
    const early = await bridgeUserBash(h.ctl, mk(fakeOps(() => {})));
    expect(early).toBeUndefined();
    const rawOps = fakeOps((emit) => emit(`echo ${PW}\n`));
    expect(await runOps(rawOps)).toBe(`echo ${PW}\n`); // documented residual: unmasked

    await h.install(); // install lands while that command is still running
    await expect(h.ask()).resolves.toEqual({ ok: false }); // gate closed: no tracked call
    expect(h.requests()).toHaveLength(0);

    // another tracked call opens the gate; the untracked command is not listed
    h.startTool("c1", "sudo apt update");
    const asked = h.ask("[sudo] password for u: ", 7001);
    await pollUntil(() => h.requests().length === 1, "request for the tracked call");
    expect(h.requests()[0].commands).toEqual(["sudo apt update"]);
    h.respond(h.requests()[0].callId, PW);
    await expect(asked).resolves.toEqual({ ok: true, password: PW });
    h.endTool("c1");
    await expect(h.ask("[sudo] password for u: ", 7002)).resolves.toEqual({ ok: false });
  });
});

describe("D7 C ordering: register(P) before the socket write and before the cache set (#S26)", () => {
  /** Records the order of register / cache set / helper-socket write for one accepted answer. */
  async function acceptOnce(cacheMinutes: number, h = (events: string[]) => bridgeHarness({ cacheMinutes }, events)) {
    const events: string[] = [];
    const origWrite = net.Socket.prototype.write;
    vi.spyOn(net.Socket.prototype, "write").mockImplementation(function (this: net.Socket, ...args: unknown[]) {
      const first = args[0];
      if (Buffer.isBuffer(first) && first.subarray(0, SUDO_HELPER_OK_MAGIC.length).equals(SUDO_HELPER_OK_MAGIC)) events.push("write");
      return (origWrite as (...a: unknown[]) => boolean).apply(this, args);
    } as never);
    const harness = h(events);
    await harness.install();
    harness.startTool("c1", "sudo true");
    const asked = harness.ask();
    await pollUntil(() => harness.requests().length === 1, "request");
    const before = harness.cacheFrames().length;
    harness.respond(harness.requests()[0].callId, PW);
    await asked;
    // cache set → cache frame; fold it into the order log by position among frames
    if (harness.cacheFrames().length > before) events.splice(events.indexOf("write"), 0, "cache");
    return { events, harness };
  }

  it("cacheMinutes > 0: register is first; both cache and write follow", async () => {
    const { events } = await acceptOnce(5);
    expect(events[0]).toBe("register");
    expect(events).toContain("cache");
    expect(events).toContain("write");
    expect(events.indexOf("register")).toBeLessThan(events.indexOf("cache"));
    expect(events.indexOf("register")).toBeLessThan(events.indexOf("write"));
  });

  it("registry already holds P when the password reaches the helper socket and when the cache is set (state at call time)", async () => {
    const snapshots: Record<string, string[]> = {};
    const origWrite = net.Socket.prototype.write;
    vi.spyOn(net.Socket.prototype, "write").mockImplementation(function (this: net.Socket, ...args: unknown[]) {
      const first = args[0];
      if (Buffer.isBuffer(first) && first.subarray(0, SUDO_HELPER_OK_MAGIC.length).equals(SUDO_HELPER_OK_MAGIC)) {
        snapshots.write = sudoMaskState().entries.map((e) => e.value);
      }
      return (origWrite as (...a: unknown[]) => boolean).apply(this, args);
    } as never);
    const h = createHarness({
      cfg: { cacheMinutes: 5 },
      deps: {
        registerPassword: registerSudoPassword,
        send: (m) => {
          if ((m as { type: string }).type === "sudo_credential_cache" && (m as { expiresAt: number | null }).expiresAt !== null) {
            snapshots.cache = sudoMaskState().entries.map((e) => e.value);
          }
          sent.push(m as Record<string, any>);
          return true;
        },
      },
    });
    harnesses.push(h);
    const sent: Array<Record<string, any>> = [];
    await h.install();
    h.startTool("c1", "sudo true");
    const asked = h.ask();
    await pollUntil(() => sent.some((f) => f.type === "sudo_credential_request"), "request");
    h.respond(sent.find((f) => f.type === "sudo_credential_request")!.callId, PW);
    await asked;
    expect(snapshots.cache).toEqual([PW]);
    expect(snapshots.write).toEqual([PW]);
  });

  it("cacheMinutes = 0: still registered before the write, and no cache is ever set", async () => {
    const { events, harness } = await acceptOnce(0);
    expect(events).toEqual(["register", "write"]);
    expect(harness.cacheFrames().filter((f) => f.expiresAt !== null)).toEqual([]);
    expect(sudoMaskState().entries.map((e) => e.value)).toEqual([PW]);
  });

  it("a wrong password stays registered: sudo's retry asks again and both values are masked", async () => {
    const h = bridgeHarness({ cacheMinutes: 5 });
    await h.install();
    h.startTool("c1", "sudo true");
    const first = h.ask("[sudo] password for u: ", 5150);
    await pollUntil(() => h.requests().length === 1, "first request");
    h.respond(h.requests()[0].callId, "wrong-guess-1");
    await first; // sudo rejects it …
    const second = h.ask("[sudo] password for u: ", 5150); // … and asks again (same pid, invocation 2)
    await pollUntil(() => h.requests().length === 2, "second request");
    h.respond(h.requests()[1].callId, PW);
    await second;
    expect(sudoMaskState().entries.map((e) => e.value)).toEqual(["wrong-guess-1", PW]);
    const masked = await mk().toolResult({ content: [{ type: "text", text: `wrong-guess-1 / ${PW}` }] });
    expect(masked?.content).toEqual([{ type: "text", text: `${TOKEN} / ${TOKEN}` }]);
  });

  it("late, stray, wrong-session and replayed answers are never registered", async () => {
    const h = bridgeHarness({ cacheMinutes: 5 });
    await h.install();
    h.startTool("c1", "sudo true");
    h.respond("no-such-call", "stray-before"); // nothing pending
    const asked = h.ask();
    await pollUntil(() => h.requests().length === 1, "request");
    const callId = h.requests()[0].callId;
    h.respond("00".repeat(16), "wrong-call-id"); // pending, wrong callId
    h.respond(callId, "wrong-session", "other-session"); // right callId, other session
    h.cancel(callId, "unanswerable"); // dismissed …
    h.respond(callId, "late-after-cancel"); // … then a late answer
    await expect(asked).resolves.toEqual({ ok: false });
    await settle();
    expect(sudoMaskState().entries).toEqual([]);
    expect(h.registered).toEqual([]);

    // accepted once, replayed afterwards: registered exactly once
    const again = h.ask("[sudo] password for u: ", 6001);
    await pollUntil(() => h.requests().length === 2, "second request");
    const id2 = h.requests()[1].callId;
    h.respond(id2, PW);
    await again;
    h.respond(id2, "replayed");
    await settle();
    expect(sudoMaskState().entries.map((e) => e.value)).toEqual([PW]);
  });
});

describe("non-leak through the bridge flow, cache hit and miss (#S73)", () => {
  it("canary P is absent from every model/transcript/log surface; a cache hit is invisible to the model", async () => {
    const h = bridgeHarness({ cacheMinutes: 5 });
    await h.install();
    const red = mk(fakeOps(() => {}));
    const spill = path.join(tmp, "pi-bash-canary0123456789.log");

    // miss: first sudo call asks the operator; the command's output echoes the typed password
    h.startTool("c1", "sudo -A true");
    const miss = h.ask("[sudo] password for u: ", 8001);
    await pollUntil(() => h.requests().length === 1, "request");
    h.respond(h.requests()[0].callId, PW);
    const missReply = await miss;
    expect(missReply).toEqual({ ok: true, password: PW });
    // hit: a second sudo process in the same session is served from the cache, no new prompt
    h.startTool("c2", "sudo -A true");
    const hit = await h.ask("[sudo] password for u: ", 8002);
    expect(hit).toEqual({ ok: true, password: PW });
    expect(h.requests()).toHaveLength(1);

    const model = async (id: string, output: string) => {
      fs.writeFileSync(spill, `full output ${output}\n`, { mode: 0o600 });
      const result = await red.toolResult({ content: [{ type: "text", text: output }], details: { fullOutputPath: spill } });
      const message = red.messageEnd({ message: { role: "assistant", content: [{ type: "toolCall", id, name: "bash", arguments: { command: `PW='${PW}'; echo "$PW"` } }] } });
      const frames = createVaultForwardFilter(red.masker).filter(mapEventToProtocol(SESSION, {
        type: "tool_execution_end", toolCallId: id, result: { content: [{ type: "text", text: output }] },
      }));
      const jsonl = JSON.stringify({ type: "message", message: { role: "toolResult", toolCallId: id, content: result?.content ?? [] } });
      return { result, message, frames, jsonl, spilled: fs.readFileSync(spill, "utf8") };
    };

    const missOut = await model("c1", `sudo: password ${PW} accepted`);
    h.endTool("c1");
    const hitOut = await model("c2", `sudo: password ${PW} accepted`);
    h.endTool("c2");
    // a later command expanding the variable
    const later = await model("c3", `PW=${PW}`);

    const str = (v: unknown): string => JSON.stringify(v ?? null);
    const surfaces = [missOut, hitOut, later].flatMap((o) => [str(o.result), str(o.message), str(o.frames), o.jsonl, o.spilled]);
    surfaces.push(str(h.frames), h.logs.join("\n"), logs.join("\n"));
    for (const s of surfaces) expect(s).not.toContain(PW);

    expect(JSON.stringify(later.result)).toContain(TOKEN);
    // the hit is indistinguishable from the miss on every model-visible surface
    expect(hitOut.result).toEqual(missOut.result);
    expect(hitOut.jsonl.replace('"c2"', '"c1"')).toBe(missOut.jsonl); // identical but for the call id
    expect(hitOut.spilled).toBe(missOut.spilled);
  });
});
