/**
 * E10 service registration (local / second local / env-name collision /
 * remote warning / instances.json) and E11 websocket-enablement decision table.
 * Triggered through `pi-obs provision` with an injected `pi-dashboard` CLI.
 * See change: add-obs-studio-plugin (test-plan E10, E11).
 */
import fs from "node:fs";
import path from "node:path";
import { validateDefinition } from "@blackbelt-technology/pi-dashboard-shared/services/schema.js";
import { describe, expect, it } from "vitest";
import { instancesFile } from "../instances.js";
import { websocketConfigFile } from "../paths.js";
import { backupsDir } from "../ws-config.js";
import { baseDeps, type CliCall, recordingCli, runCli, tmpHome, writeServices } from "./cli-harness.js";

const obsApp = (p: string) => p === "/Applications/OBS.app" || p.startsWith("/abs/");

function setup(opts: { services?: unknown[]; running?: boolean[]; ws?: Record<string, unknown>; secretFails?: boolean; stdin?: string; tty?: boolean } = {}) {
  const home = tmpHome();
  if (opts.services) writeServices(home, opts.services);
  const configDir = path.join(home, "Library", "Application Support", "obs-studio");
  if (opts.ws) {
    fs.mkdirSync(path.dirname(websocketConfigFile(configDir)), { recursive: true });
    fs.writeFileSync(websocketConfigFile(configDir), JSON.stringify(opts.ws));
  }
  const state = path.join(home, ".pi", "dashboard", "plugins", "obs-studio");
  const cli = recordingCli((args) => (opts.secretFails && args[1] === "secret" ? { code: 1 } : {}));
  const running = [...(opts.running ?? [])];
  const spawned: string[][] = [];
  const deps = baseDeps(home, {
    cli,
    exists: obsApp,
    findObs: async () => ((running.length ? running.shift() : false) ? [1] : []),
    readStdin: async () => opts.stdin ?? "",
    isTTY: opts.tty ?? false,
    ask: async () => true,
    connect: async () => {
      throw Object.assign(new Error("no obs"), {});
    },
    run: async (file, args) => {
      spawned.push([file, ...args]);
      return { code: 1, stdout: "" };
    },
  });
  return {
    home,
    configDir,
    state,
    cli,
    spawned,
    run: (argv: string[]) => runCli(["provision", "--json", ...argv], deps),
    wsConfig: () => JSON.parse(fs.readFileSync(websocketConfigFile(configDir), "utf8")),
  };
}

const add = (calls: CliCall[]) => calls.find((c) => c.args[0] === "service" && c.args[1] === "add");
const secretSet = (calls: CliCall[]) => calls.find((c) => c.args[1] === "secret");
const allText = (s: ReturnType<typeof setup>, r: Awaited<ReturnType<ReturnType<typeof setup>["run"]>>) =>
  [...r.out, ...r.err, ...s.cli.calls.flatMap((c) => c.args), ...s.spawned.flat()].join("\n");

describe("E10 service registration", () => {
  it("local: attached definition via a 0600 temp file passed to service add --file, deleted afterwards", async () => {
    const s = setup();
    const r = await s.run(["--yes"]);
    expect(r.code).toBe(0);
    const call = add(s.cli.calls);
    expect(call?.inherit).toBe(true);
    expect(call?.file?.mode).toBe(0o600);
    const def = call?.file?.json as Record<string, any>;
    expect(def).toMatchObject({
      id: "obs",
      mode: "attached",
      origin: "user",
      idleStopMinutes: null,
      health: { kind: "ws-first-message", endpoint: "ws" },
      process: { name: "OBS" },
      lifecycle: { start: { darwin: ["/abs/node", "/abs/pi-obs.mjs", "launch"] } },
      secrets: { password: { ref: "store:obs/password" } },
    });
    expect(def.lifecycle.stop).toBeUndefined();
    expect(def.secrets.password.env).toBeUndefined();
    expect(validateDefinition(def, { origin: "user" } as never)).toMatchObject({ ok: true });
    expect(fs.existsSync(call?.args[call.args.indexOf("--file") + 1] as string)).toBe(false);
    expect(JSON.parse(fs.readFileSync(instancesFile(s.state), "utf8")).instances).toEqual(["obs"]);
  });

  it("a second local OBS is refused naming the existing one", async () => {
    const s = setup({ services: [{ id: "obs", mode: "attached", process: { name: "OBS" }, origin: "user" }] });
    const r = await s.run(["--service", "obs2", "--yes"]);
    expect(r.code).toBe(1);
    expect(r.json()).toMatchObject({ ok: false, error: { code: "refused", message: expect.stringContaining("obs") } });
    expect(add(s.cli.calls)).toBeUndefined();
  });

  it("obs_a vs an existing obs-a → refused as an env-name collision, nothing submitted", async () => {
    const s = setup({ services: [{ id: "obs-a", mode: "external", origin: "user" }], stdin: "pw\n" });
    const r = await s.run(["--remote", "ws://10.0.0.9:4455", "--service", "obs_a", "--yes"]);
    expect(r.code).toBe(1);
    expect(r.json()).toMatchObject({ ok: false, error: { code: "refused", message: expect.stringMatching(/obs-a/) } });
    expect(add(s.cli.calls)).toBeUndefined();
  });

  it("--remote ws://10.0.0.5 warns about plain ws:// BEFORE the review; password from stdin", async () => {
    const s = setup({ stdin: "remote-pw\n" });
    const r = await s.run(["--remote", "ws://10.0.0.5:4455", "--service", "obs-studio2", "--yes"]);
    expect(r.code).toBe(0);
    expect(r.err.join("\n")).toMatch(/unencrypted/);
    const def = add(s.cli.calls)?.file?.json as Record<string, any>;
    expect(def).toMatchObject({ id: "obs-studio2", mode: "external", endpoints: { ws: "ws://10.0.0.5:4455" } });
    expect(def.lifecycle).toBeUndefined();
    expect(secretSet(s.cli.calls)).toMatchObject({ args: ["service", "secret", "set", "obs-studio2", "password"], stdin: "remote-pw" });
    expect(allText(s, r)).not.toContain("remote-pw");
  });

  it("loopback remote → no warning", async () => {
    const s = setup({ stdin: "pw\n" });
    const r = await s.run(["--remote", "ws://127.0.0.1:4456", "--yes"]);
    expect(r.code).toBe(0);
    expect(r.err.join("\n")).not.toMatch(/unencrypted/);
  });
});

describe("E11 websocket enablement", () => {
  it("running + disabled → UI instruction, no write", async () => {
    const s = setup({ running: [true, true, true], ws: { server_enabled: false, server_port: 4455 } });
    const r = await s.run(["--yes"]);
    expect(r.code).toBe(0);
    expect(r.json()).toMatchObject({ websocket: "ui-instruction" });
    expect(r.err.join("\n")).toMatch(/Tools → WebSocket Server Settings/);
    expect(s.wsConfig()).toEqual({ server_enabled: false, server_port: 4455 });
    expect(secretSet(s.cli.calls)).toBeUndefined();
  });

  it("stopped + disabled → 0600 backup → write → verify → secret set on stdin; password nowhere else", async () => {
    const s = setup({ ws: { server_enabled: false, server_port: 4455, alerts_enabled: true } });
    const r = await s.run(["--yes"]);
    expect(r.code).toBe(0);
    const cfg = s.wsConfig();
    expect(cfg).toMatchObject({ server_enabled: true, auth_required: true, alerts_enabled: true });
    expect(cfg.server_password).toHaveLength(24);
    const backups = fs.readdirSync(backupsDir(s.state));
    expect(backups).toHaveLength(1);
    expect(fs.statSync(path.join(backupsDir(s.state), backups[0])).mode & 0o777).toBe(0o600);
    expect(secretSet(s.cli.calls)).toMatchObject({ args: ["service", "secret", "set", "obs", "password"], stdin: cfg.server_password });
    expect(allText(s, r)).not.toContain(cfg.server_password);
  });

  it("keeps at most 3 backups", async () => {
    const s = setup({ ws: { server_enabled: false } });
    fs.mkdirSync(backupsDir(s.state), { recursive: true });
    for (const t of [1, 2, 3]) fs.writeFileSync(path.join(backupsDir(s.state), `config-${t}.json`), "{}");
    await s.run(["--yes"]);
    expect(fs.readdirSync(backupsDir(s.state))).toHaveLength(3);
  });

  it("secret-set failure → backup restored, failure exit", async () => {
    const s = setup({ ws: { server_enabled: false, server_port: 4455 }, secretFails: true });
    const r = await s.run(["--yes"]);
    expect(r.code).toBe(1);
    expect(r.json()).toMatchObject({ ok: false, error: { message: expect.stringMatching(/restored/) } });
    expect(s.wsConfig()).toEqual({ server_enabled: false, server_port: 4455 });
  });

  it("OBS reappears before the write → no write", async () => {
    // findObs: enablement entry (stopped) → pre-settle (stopped) → post-settle re-check (running)
    const s = setup({ ws: { server_enabled: false }, running: [false, false, true] });
    const r = await s.run(["--yes"]);
    expect(r.json()).toMatchObject({ websocket: "ui-instruction" });
    expect(s.wsConfig()).toEqual({ server_enabled: false });
  });

  it("enabled with a 6-char password + consent → stored, short warning, rotation offered", async () => {
    const s = setup({ ws: { server_enabled: true, auth_required: true, server_password: "abc123", server_port: 4455 }, running: [true, true, true, true], tty: true });
    const asked: string[] = [];
    const r = await runCli(["provision", "--json"], {
      ...baseDeps(s.home, {
        cli: s.cli,
        exists: obsApp,
        findObs: async () => [1],
        isTTY: true,
        ask: async (q) => {
          asked.push(q);
          return !/Rotate/.test(q);
        },
        connect: async () => {
          throw new Error("x");
        },
      }),
    });
    expect(r.code).toBe(0);
    expect(r.json()).toMatchObject({ websocket: "imported", shortPassword: true });
    expect(r.err.join("\n")).toMatch(/shorter than 8/);
    expect(asked.some((q) => /Rotate/.test(q))).toBe(true);
    expect(secretSet(s.cli.calls)).toMatchObject({ stdin: "abc123" });
    expect([...r.out, ...r.err].join("\n")).not.toContain("abc123");
  });
});
