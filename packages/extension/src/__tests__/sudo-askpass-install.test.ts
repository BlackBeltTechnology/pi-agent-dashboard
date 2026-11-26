/**
 * Install / withdraw of the askpass wrapper (D9, D10): predicate, event-driven
 * install off `dashboard_identity`, old server, absolute interpreter, mkdtemp
 * isolation, abort paths, sun_path limit, operator override, flapping, tampering.
 * See change: add-sudo-credential-prompt (test-plan #S3-#S10, #S75, #S77).
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SUDO_CREDENTIAL_FEATURE } from "@blackbelt-technology/pi-dashboard-shared/sudo-credential.js";
import { sunPathLimit } from "../sudo-askpass/install.js";
import { createHarness, pollUntil, settle, type Harness } from "./sudo-askpass-harness.js";

const harnesses: Harness[] = [];
const make = (opts: Parameters<typeof createHarness>[0] = {}): Harness => {
  const h = createHarness(opts);
  harnesses.push(h);
  return h;
};
afterEach(() => {
  vi.useRealTimers();
  for (const h of harnesses.splice(0)) h.dispose();
});

const askpassDirs = (h: Harness): string[] => fs.readdirSync(h.tmp).filter((n) => n.startsWith("pi-askpass-"));

function runWrapper(wrapper: string, env: NodeJS.ProcessEnv): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(wrapper, ["[sudo] password: "], { env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", () => resolve({ code: 127, stdout, stderr }));
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

describe("install predicate (#S3)", () => {
  const bools = [true, false];
  const rows: Array<[boolean, boolean, boolean, boolean]> = [];
  for (const enabled of bools) for (const win32 of bools) for (const feature of bools) for (const preset of bools) rows.push([enabled, win32, feature, preset]);

  it.each(rows)("enabled=%s win32=%s feature=%s operatorPreset=%s", async (enabled, win32, feature, preset) => {
    const env: NodeJS.ProcessEnv = preset ? { SUDO_ASKPASS: "/opt/mine" } : {};
    const h = make({ env, cfg: { enabled }, platform: win32 ? "win32" : "darwin" });
    await h.install(feature ? [SUDO_CREDENTIAL_FEATURE] : ["something-else"]);
    if (enabled && !win32 && feature && !preset) {
      expect(env.SUDO_ASKPASS).toBe(h.ctl.wrapperPath());
      expect(askpassDirs(h)).toHaveLength(1);
      expect(fs.existsSync(h.ctl.socketPath() as string)).toBe(true);
    } else {
      expect(env.SUDO_ASKPASS).toBe(preset ? "/opt/mine" : undefined);
      expect(askpassDirs(h)).toHaveLength(0);
      expect(h.ctl.featureInstalled()).toBe(false);
    }
  });

  it("installs with mode 0700 dir and 0700 wrapper", async () => {
    const h = make();
    await h.install();
    const wrapper = h.ctl.wrapperPath() as string;
    expect(fs.statSync(path.dirname(wrapper)).mode & 0o777).toBe(0o700);
    expect(fs.statSync(wrapper).mode & 0o777).toBe(0o700);
  });
});

describe("event-driven install (#S4, #S5)", () => {
  it("installs on identity, withdraws on an identity without the feature, never touches a foreign value", async () => {
    const h = make();
    expect(h.env.SUDO_ASKPASS).toBeUndefined(); // (1) session_start alone installs nothing
    expect(askpassDirs(h)).toHaveLength(0);

    await h.install(); // (2)
    const wrapper = h.ctl.wrapperPath() as string;
    expect(h.env.SUDO_ASKPASS).toBe(wrapper);

    h.startTool("A", "sudo a"); // a cached entry and a pending prompt exist when the server downgrades
    const first = h.ask("p", 1);
    await pollUntil(() => h.requests().length === 1);
    h.respond(h.requests()[0].callId, "pw");
    await first;
    const buf = h.ctl.debug.cacheBuffer() as Buffer;
    const pending = h.ask("p", 1); // retry of the same pid: cache dropped, prompt pending
    await pollUntil(() => h.requests().length === 2);
    await h.install([]); // (3) downgrade
    expect(await pending).toEqual({ ok: false });
    expect(h.env.SUDO_ASKPASS).toBeUndefined();
    expect(askpassDirs(h)).toHaveLength(0);
    expect([...buf].every((b) => b === 0)).toBe(true);

    await h.install(); // (4)
    h.env.SUDO_ASKPASS = "/x";
    await h.install([]);
    expect(h.env.SUDO_ASKPASS).toBe("/x");
    expect(askpassDirs(h)).toHaveLength(0);
  });

  it("an old server that never sends an identity leaves everything alone", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const h = make();
    h.ctl.onOpen();
    vi.advanceTimersByTime(10 * 60_000);
    expect(h.env.SUDO_ASKPASS).toBeUndefined();
    expect(askpassDirs(h)).toHaveLength(0);
    expect(h.requests()).toEqual([]);
  });
});

describe("absolute interpreter (#S6)", () => {
  it("never runs a PATH node nor NODE_OPTIONS preloads; the helper still reaches the bridge", async () => {
    const h = make();
    await h.install();
    const evil = fs.mkdtempSync(path.join(h.tmp, "evil-"));
    const ran = path.join(evil, "ran");
    const pre = path.join(evil, "pre-ran");
    fs.writeFileSync(path.join(evil, "node"), `#!/bin/sh\ntouch ${ran}\n`, { mode: 0o755 });
    fs.writeFileSync(path.join(evil, "pre.js"), `require("fs").writeFileSync(${JSON.stringify(pre)}, "x");\n`);
    const wrapper = h.ctl.wrapperPath() as string;
    expect(fs.readFileSync(wrapper, "utf8")).toContain(`exec '${process.execPath}'`);
    expect(fs.readFileSync(wrapper, "utf8")).not.toMatch(/env\s+node/);

    h.startTool("A", "sudo true");
    const run = runWrapper(wrapper, { PATH: evil, NODE_OPTIONS: `--require ${path.join(evil, "pre.js")}` });
    await pollUntil(() => h.requests().length === 1, "helper request");
    h.respond(h.requests()[0].callId, "s3cret");
    const out = await run;
    expect(out).toMatchObject({ code: 0, stdout: "s3cret\n", stderr: "" });
    expect(fs.existsSync(ran)).toBe(false);
    expect(fs.existsSync(pre)).toBe(false);
  });
});

describe("mkdtemp isolation (#S7)", () => {
  it("two bridges in one tmp dir get distinct private dirs; B's shutdown leaves A intact", async () => {
    const shared = fs.mkdtempSync(path.join(os.tmpdir(), "sudo-shared-"));
    const a = make({ deps: { tmpdir: shared } });
    const b = make({ deps: { tmpdir: shared } });
    await a.install();
    await b.install();
    const dirA = path.dirname(a.ctl.wrapperPath() as string);
    const dirB = path.dirname(b.ctl.wrapperPath() as string);
    expect(dirA).not.toBe(dirB);
    expect(fs.statSync(dirA).mode & 0o777).toBe(0o700);
    expect(fs.statSync(a.ctl.wrapperPath() as string).mode & 0o007).toBe(0); // not world-accessible

    a.startTool("A", "sudo a");
    b.startTool("B", "sudo b");
    const reply = a.ask("p", 1);
    await pollUntil(() => a.requests().length === 1);
    expect(b.requests()).toHaveLength(0); // A's helper reaches bridge A only
    a.respond(a.requests()[0].callId, "pw");
    expect(await reply).toEqual({ ok: true, password: "pw" });

    b.ctl.shutdown();
    expect(fs.existsSync(dirB)).toBe(false);
    expect(fs.existsSync(dirA)).toBe(true);
    expect(a.env.SUDO_ASKPASS).toBe(a.ctl.wrapperPath());
    fs.rmSync(shared, { recursive: true, force: true });
  });
});

describe("abort paths: no pre-existing socket, owner/mode recheck (#S8)", () => {
  const abortCase = async (prepare: (base: string) => Promise<string>): Promise<void> => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "sudo-abort-"));
    const h = make({ deps: { mkdtemp: () => prepare(base) } });
    await h.install();
    expect(h.env.SUDO_ASKPASS).toBeUndefined();
    expect(h.ctl.featureInstalled()).toBe(false);
    expect(h.logs).toHaveLength(1);
    expect(h.logs[0]).toMatch(/^\[sudo-askpass\] install aborted: [a-z-]+$/);
    fs.rmSync(base, { recursive: true, force: true });
  };

  it("(a) a socket file already at the would-be path", () =>
    abortCase(async (base) => {
      const dir = fs.mkdtempSync(path.join(base, "d-"));
      fs.writeFileSync(path.join(dir, "s"), "");
      return dir;
    }));

  it("(b) the directory is a symlink", () =>
    abortCase(async (base) => {
      const real = fs.mkdtempSync(path.join(base, "real-"));
      const link = path.join(base, "link");
      fs.symlinkSync(real, link);
      return link;
    }));

  it("(c) the directory was chmod 0755 after mkdtemp", () =>
    abortCase(async (base) => {
      const dir = fs.mkdtempSync(path.join(base, "d-"));
      fs.chmodSync(dir, 0o755);
      return dir;
    }));
});

describe("sun_path limit (#S9)", () => {
  /** A tmpdir whose resulting socket path (`<tmp>/pi-askpass-XXXXXX/s`) is exactly `len` chars. */
  const tmpForSocketLen = (root: string, len: number): string => {
    const dirLen = len - 20; // "/pi-askpass-" (12) + 6 random + "/s" (2)
    const pad = dirLen - root.length - 1;
    const dir = path.join(root, "d".repeat(pad));
    fs.mkdirSync(dir);
    return dir;
  };

  it("pins the limits", () => {
    expect(sunPathLimit("darwin")).toBe(104);
    expect(sunPathLimit("linux")).toBe(108);
  });

  const onHost = os.platform();
  const cases: Array<["darwin" | "linux", number, boolean]> = [
    ["darwin", 103, true],
    ["darwin", 104, false],
    ["darwin", 105, false],
    ["linux", 107, true],
    ["linux", 108, false],
    ["linux", 109, false],
  ];
  // An "installs" row can only be exercised where the host kernel accepts a path that long.
  it.each(cases.filter(([p, , ok]) => !ok || p === (onHost === "darwin" ? "darwin" : "linux")))(
    "%s: socket path of %i chars installs=%s",
    async (platform, len, shouldInstall) => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "sd-"));
      const h = make({ platform, deps: { tmpdir: tmpForSocketLen(root, len) } });
      await h.install();
      expect(h.ctl.featureInstalled()).toBe(shouldInstall);
      if (shouldInstall) expect((h.ctl.socketPath() as string).length).toBe(len);
      else expect(h.env.SUDO_ASKPASS).toBeUndefined();
      fs.rmSync(root, { recursive: true, force: true });
    },
  );
});

describe("operator override / nested pi (#S10)", () => {
  it("leaves a preset SUDO_ASKPASS alone and stays inactive", async () => {
    const h = make({ env: { SUDO_ASKPASS: "/home/u/askpass" } });
    await h.install();
    h.startTool("A", "sudo a");
    expect(h.env.SUDO_ASKPASS).toBe("/home/u/askpass");
    expect(askpassDirs(h)).toHaveLength(0);
    expect(h.frames).toEqual([]);
    expect(h.ctl.debug.cacheBuffer()).toBeUndefined();
  });
});

describe("identity flapping (#S77)", () => {
  it("a second identical identity is a no-op; an identity lacking the feature while pending dismisses", async () => {
    const h = make();
    await h.install();
    const wrapper = h.ctl.wrapperPath();
    await h.install();
    expect(h.ctl.wrapperPath()).toBe(wrapper);
    expect(askpassDirs(h)).toHaveLength(1);

    h.startTool("A", "sudo a");
    const pending = h.ask("p", 1);
    await pollUntil(() => h.requests().length === 1);
    await h.install(); // reconnect with a second identity while pending: still the same install, prompt intact
    expect(h.ctl.debug.pendingCallId()).toBe(h.requests()[0].callId);
    await h.install([]);
    expect(await pending).toEqual({ ok: false });
    expect(h.frames.some((f) => f.type === "sudo_credential_dismiss")).toBe(true);
  });
});

describe("hostile tampering (#S75)", () => {
  it("rm -rf of the install dir: the helper fails fast, shutdown tolerates the missing dir", async () => {
    const h = make();
    await h.install();
    h.startTool("A", "sudo a");
    const wrapper = h.ctl.wrapperPath() as string;
    fs.rmSync(path.dirname(wrapper), { recursive: true, force: true });
    const t0 = Date.now();
    expect((await runWrapper(wrapper, {})).code).not.toBe(0);
    expect(await h.ask("p", 1)).toEqual({ ok: false });
    expect(Date.now() - t0).toBeLessThan(2000);
    await settle();
    expect(() => h.ctl.shutdown()).not.toThrow();
    expect(h.env.SUDO_ASKPASS).toBeUndefined();
  });
});
