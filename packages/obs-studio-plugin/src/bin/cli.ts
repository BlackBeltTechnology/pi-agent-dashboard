/**
 * `pi-obs` CLI over `src/core` (design D2, D11). `main(argv, deps)` is pure
 * over injected deps so every verb is unit-testable without OBS.
 *
 * Offline verbs (no OBS connection, no secret): `doctor` (without `--live`),
 * `install`, `provision`, `launch`, `stop`, `preset list`.
 * Live verbs (the skill runs them as `pi-dashboard service exec <id> -- pi-obs
 * <verb> --service <id>`): `status`, `scene list|switch|create`, `devices list`,
 * `input bind`, `vcam`, `record`, `stream target`, `text set`, `filter add`,
 * `screenshot`, `preset apply`, `call`, `serve --stdio`, `doctor --live`.
 * Every live verb first sweeps leftover probe inputs.
 *
 * Exit codes: 0 success, 2 usage, 1 any other failure. `--json` prints the
 * result (or `{ok:false,error}`) as one JSON line; the exit code still reflects
 * failure. The password is never printed and never accepted as an argument.
 * See change: add-obs-studio-plugin.
 */
import fs from "node:fs";
import path from "node:path";
import type { Readable, Writable } from "node:stream";
import { type ConnectOptions, connectObs, type ObsConn, type ObsTarget, resolveTarget } from "../core/connection.js";
import { createDashboardCli, type DashboardCli } from "../core/dashboard-cli.js";
import { detectObs, type Installation, launchArgv, type RunFn } from "../core/detect.js";
import { bindInput, type DeviceKind, type DisplayLister, listCameras, listDevices, sweepProbes } from "../core/devices.js";
import { doctor } from "../core/doctor.js";
import { exitCodeOf, ObsError } from "../core/errors.js";
import { describePlan, installPortable, type PortableDeps, planInstall } from "../core/install.js";
import { launch, resetRecovery } from "../core/launch.js";
import { type HostEnv, obsConfigDir, portableRoot, stateDir } from "../core/paths.js";
import { assertSecretTransport, type GuardedObs, guard } from "../core/policy.js";
import { applyPreset, PRESET_NAMES } from "../core/presets.js";
import { LOCAL_ID, localDefinition, remoteDefinition, remoteId, submitDefinition } from "../core/provision.js";
import { serve } from "../core/serve.js";
import { readServiceDefinitions } from "../core/service-defs.js";
import { stopObs } from "../core/stop.js";
import * as verbs from "../core/verbs.js";
import { enableWebsocket, readWsConfig, UI_INSTRUCTION } from "../core/ws-config.js";

export interface CliDeps {
  host: HostEnv;
  out: (s: string) => void;
  err: (s: string) => void;
  readStdin: () => Promise<string>;
  isTTY: boolean;
  /** Ask a yes/no question on the terminal (only when `isTTY`). */
  ask?: (question: string) => Promise<boolean>;
  stdin?: Readable;
  stdout?: Writable;
  connect?: (target: ObsTarget, opts: ConnectOptions) => Promise<ObsConn>;
  cli?: DashboardCli;
  /** `~/.pi/dashboard` (services.json lives here). */
  dashboardDir?: string;
  findObs: () => Promise<number[]>;
  spawnDetached: (argv: string[], cwd?: string) => Promise<void>;
  run: RunFn;
  isAlive: (pid: number) => boolean;
  forceKill: (pid: number) => Promise<void>;
  exposure: (port: number) => Promise<"loopback" | "all-interfaces" | "unknown">;
  listDisplays: DisplayLister;
  has: (cmd: string) => boolean;
  fetchJson?: PortableDeps["fetchJson"];
  fetchBytes?: PortableDeps["fetchBytes"];
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  nodePath: string;
  entryPath: string;
  exists?: (p: string) => boolean;
}

interface Flags {
  json: boolean;
  yes: boolean;
  live: boolean;
  keyStdin: boolean;
  allowInsecureRemote: boolean;
  update: boolean;
  resetRecovery: boolean;
  force: boolean;
  portable: boolean;
  stdio: boolean;
  passwordArg: boolean;
  service?: string;
  url?: string;
  stateDir?: string;
  kind?: string;
  device?: string;
  display?: string;
  jsonFile?: string;
  out?: string;
  remote?: string;
  width?: number;
  positional: string[];
}

const VALUE_FLAGS = new Set(["--service", "--url", "--state-dir", "--kind", "--device", "--display", "--json-file", "--out", "--remote", "--width"]);

const HELP = `usage: pi-obs <verb> [args] [--json] [--service <id>]
offline: doctor [--live] · install [--portable] [--yes] · provision [--remote ws://host:port] [--service <id>] [--update] [--yes]
         launch [--reset-recovery] · stop [--service <id>] [--yes] [--force] · preset list
live:    status · scene list|switch <name>|create <name> · devices list [--kind camera|audio|display]
         input bind <input> --device <id>|--display <uuid> · vcam on|off · record on|off
         stream target <url> --key-stdin [--allow-insecure-remote] · text set <input> <text>
         filter add <input> bgremoval · screenshot <source> --out <file> · preset apply <name>
         call <Request> (--json-file <f> | JSON on stdin) · serve --stdio
Live verbs run as: pi-dashboard service exec <id> -- pi-obs <verb> --service <id>`;

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: flat flag table; each case is one assignment, splitting would scatter one table
function parseFlags(args: string[]): Flags {
  const f: Flags = { json: false, yes: false, live: false, keyStdin: false, allowInsecureRemote: false, update: false, resetRecovery: false, force: false, portable: false, stdio: false, passwordArg: false, positional: [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--password" || a.startsWith("--password=")) {
      f.passwordArg = true;
      if (a === "--password") i++;
      continue;
    }
    const eq = a.indexOf("=");
    const name = a.startsWith("--") && eq > 0 ? a.slice(0, eq) : a;
    if (VALUE_FLAGS.has(name)) {
      const v = eq > 0 && a.startsWith("--") ? a.slice(eq + 1) : args[++i];
      if (v === undefined) throw new ObsError("usage", `${name} needs a value`);
      const key = name.slice(2).replace(/-([a-z])/g, (_, c: string) => c.toUpperCase()) as keyof Flags;
      if (key === "width") f.width = Number(v);
      else (f as unknown as Record<string, unknown>)[key] = v;
      continue;
    }
    switch (a) {
      case "--json": f.json = true; break;
      case "--yes": case "-y": f.yes = true; break;
      case "--live": f.live = true; break;
      case "--key-stdin": f.keyStdin = true; break;
      case "--allow-insecure-remote": f.allowInsecureRemote = true; break;
      case "--update": f.update = true; break;
      case "--reset-recovery": f.resetRecovery = true; break;
      case "--force": f.force = true; break;
      case "--portable": f.portable = true; break;
      case "--stdio": f.stdio = true; break;
      default:
        if (a.startsWith("--")) throw new ObsError("usage", `unknown flag ${a}`);
        f.positional.push(a);
    }
  }
  return f;
}

function human(v: unknown): string {
  return typeof v === "string" ? v : JSON.stringify(v, null, 2);
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: one linear parse → dispatch → print path with a single error branch
export async function main(argv: string[], d: CliDeps): Promise<number> {
  let f: Flags;
  try {
    f = parseFlags(argv);
  } catch (e) {
    d.err(`${(e as Error).message}\n${HELP}`);
    return 2;
  }
  const [verb, ...rest] = f.positional;
  if (!verb || verb === "help" || verb === "--help") {
    (verb ? d.out : d.err)(HELP);
    return verb ? 0 : 2;
  }
  try {
    const result = await dispatch(verb, rest, f, d);
    if (f.json) d.out(JSON.stringify({ ok: true, ...(result && typeof result === "object" && !Array.isArray(result) ? result : { result }) }));
    else if (result !== undefined) d.out(human(result));
    return 0;
  } catch (e) {
    const code = e instanceof ObsError ? e.code : "failed";
    const message = (e as Error).message;
    if (f.json) d.out(JSON.stringify({ ok: false, error: { code, message, ...(e instanceof ObsError && e.detail ? { detail: e.detail } : {}) } }));
    d.err(`${code}: ${message}${code === "usage" ? `\n${HELP}` : ""}`);
    return exitCodeOf(e);
  }
}

function need(v: string | undefined, what: string): string {
  if (!v) throw new ObsError("usage", `missing ${what}`);
  return v;
}

function onOff(v: string | undefined): boolean {
  if (v === "on") return true;
  if (v === "off") return false;
  throw new ObsError("usage", "expected on or off");
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: flat verb switch; each case is one verb sharing the setup closures above it
async function dispatch(verb: string, rest: string[], f: Flags, d: CliDeps): Promise<unknown> {
  const host = d.host;
  const state = stateDir(host, f.stateDir);
  const dashboardDir = d.dashboardDir ?? path.join(host.home, ".pi", "dashboard");
  const defs = () => readServiceDefinitions(dashboardDir);
  const cli = d.cli ?? createDashboardCli(host.env);
  const exists = d.exists ?? ((p: string) => fs.existsSync(p));
  const warn = (line: string) => d.err(`warning: ${line}`);
  const confirm = async (q: string): Promise<boolean> => {
    if (f.yes) return true;
    if (!d.isTTY || !d.ask) return false;
    return d.ask(`${q} [y/N] `);
  };
  const detect = () => detectObs({ host, state, exists, readFile: (p) => fs.readFileSync(p, "utf8"), run: d.run });
  const configDirFor = (inst?: Installation) =>
    obsConfigDir(host, { portable: inst?.variant === "portable" ? portableRoot(state) : undefined, flatpak: inst?.variant === "flatpak" });

  // Live verbs: resolve the target first (a --password is refused before anything else).
  const openLive = async (opts: { via?: "verb" | "call" | "serve" } = {}): Promise<GuardedObs> => {
    const target = resolveTarget({ service: f.service, url: f.url, passwordArg: f.passwordArg }, host.env, defs());
    const conn = await (d.connect ?? connectObs)(target, { log: d.err });
    const obs = guard(conn, { via: opts.via ?? "verb", allowInsecureRemote: f.allowInsecureRemote });
    await sweepProbes(obs).catch((e) => d.err(`[pi-obs] probe sweep failed: ${(e as Error).message}`));
    return obs;
  };
  const live = async <T>(fn: (obs: GuardedObs) => Promise<T>, via?: "verb" | "call"): Promise<T> => {
    const obs = await openLive({ via });
    try {
      return await fn(obs);
    } finally {
      await obs.conn.close();
    }
  };
  if (f.passwordArg) resolveTarget({ passwordArg: true }, {}, []);
  const deviceDeps = { platform: host.platform, listDisplays: d.listDisplays };

  switch (verb) {
    case "status":
      return live((obs) => verbs.status(obs));

    case "scene": {
      const [sub, name] = rest;
      if (sub === "list") return live((obs) => verbs.sceneList(obs));
      if (sub === "switch") return live((obs) => verbs.sceneSwitch(obs, need(name, "scene name")));
      if (sub === "create") return live((obs) => verbs.sceneCreate(obs, need(name, "scene name")));
      throw new ObsError("usage", "scene list|switch <name>|create <name>");
    }

    case "devices": {
      if (rest[0] !== "list") throw new ObsError("usage", "devices list [--kind camera|audio|display]");
      const kinds: DeviceKind[] = f.kind ? [f.kind as DeviceKind] : ["camera", "audio", "display"];
      if (kinds.some((k) => !["camera", "audio", "display"].includes(k))) throw new ObsError("usage", "--kind camera|audio|display");
      return live(async (obs) => ({ devices: await Promise.all(kinds.map((k) => listDevices(obs, k, deviceDeps))) }));
    }

    case "input": {
      if (rest[0] !== "bind") throw new ObsError("usage", "input bind <input> --device <id>|--display <uuid>");
      const input = need(rest[1], "input name");
      return live((obs) => bindInput(obs, input, { device: f.device, display: f.display }, deviceDeps));
    }

    case "vcam":
      return live((obs) => verbs.vcam(obs, onOff(rest[0])));
    case "record":
      return live((obs) => verbs.record(obs, onOff(rest[0])));

    case "stream": {
      if (rest[0] !== "target") throw new ObsError("usage", "stream target <url> --key-stdin");
      const server = need(rest[1], "stream server url");
      if (!f.keyStdin) throw new ObsError("usage", "the stream key is read from stdin only: pass --key-stdin");
      const target = resolveTarget({ service: f.service, url: f.url, passwordArg: f.passwordArg }, host.env, defs());
      // Refuse BEFORE connecting: the key must never cross plain ws:// to a remote host.
      assertSecretTransport(target.url, "SetStreamServiceSettings", f.allowInsecureRemote);
      const key = (await d.readStdin()).replace(/\r?\n$/, "");
      if (!key) throw new ObsError("usage", "empty stream key on stdin");
      return live((obs) => verbs.streamTarget(obs, server, key));
    }

    case "text": {
      if (rest[0] !== "set") throw new ObsError("usage", "text set <input> <text>");
      return live((obs) => verbs.textSet(obs, need(rest[1], "input name"), rest.slice(2).join(" ")));
    }

    case "filter": {
      if (rest[0] !== "add" || rest[2] !== "bgremoval") throw new ObsError("usage", "filter add <input> bgremoval");
      return live((obs) => verbs.filterAddBgremoval(obs, need(rest[1], "input name")));
    }

    case "screenshot": {
      const source = need(rest[0], "source name");
      const out = need(f.out, "--out <file>");
      const r = await live((obs) => verbs.screenshot(obs, source, { format: out.endsWith(".png") ? "png" : "jpg", width: f.width }));
      const b64 = r.imageData.replace(/^data:[^;]+;base64,/, "");
      fs.writeFileSync(out, Buffer.from(b64, "base64"));
      return { source, out, bytes: Buffer.byteLength(b64, "base64") };
    }

    case "preset": {
      if (rest[0] === "list") return { presets: PRESET_NAMES };
      if (rest[0] !== "apply") throw new ObsError("usage", "preset list|apply <name>");
      const name = need(rest[1], "preset name");
      return live(async (obs) => ({
        preset: name,
        items: await applyPreset(obs, name, { platform: host.platform, listCameras: () => listCameras(obs, host.platform), listDisplays: d.listDisplays }),
      }));
    }

    case "call": {
      const type = need(rest[0], "request type");
      if (rest.length > 1) throw new ObsError("usage", "request JSON is read from stdin or --json-file, never from an argument");
      const raw = f.jsonFile ? fs.readFileSync(f.jsonFile, "utf8") : await d.readStdin();
      let data: Record<string, unknown> | undefined;
      if (raw.trim()) {
        try {
          data = JSON.parse(raw) as Record<string, unknown>;
        } catch {
          throw new ObsError("usage", "request JSON on stdin / --json-file is not valid JSON");
        }
      }
      return live((obs) => obs.request(type, data), "call");
    }

    case "serve": {
      if (!f.stdio) throw new ObsError("usage", "serve --stdio");
      if (!d.stdin || !d.stdout) throw new ObsError("failed", "serve needs process stdio");
      await serve({ input: d.stdin, output: d.stdout, connect: () => openLive({ via: "serve" }), log: d.err });
      return undefined;
    }

    case "doctor": {
      const inst = await detect();
      const configDir = configDirFor(inst);
      const id = f.service ?? LOCAL_ID;
      const report = await doctor({ platform: host.platform, configDir, state, install: inst, def: defs().find((x) => x.id === id), exists, exposure: d.exposure });
      if (!f.live) return report;
      const liveReport = await live(async (obs) => {
        const swept = await sweepProbes(obs);
        const { inputs = [] } = await obs.request<{ inputs?: Array<{ inputName: string }> }>("GetInputList", { inputKind: "screen_capture" });
        return { authenticated: true, obsVersion: obs.conn.obsVersion, screenCaptureInputs: inputs.map((i) => i.inputName), probesRemoved: swept };
      }).catch((e) => ({ authenticated: false, error: { code: e instanceof ObsError ? e.code : "failed", message: (e as Error).message } }));
      return { ...report, live: liveReport };
    }

    case "launch": {
      if (f.resetRecovery) await resetRecovery(state);
      const inst = await detect();
      if (!inst.found) throw new ObsError("not-found", "OBS Studio is not installed; run `pi-obs install`");
      const { argv, cwd } = launchArgv(inst, host.platform);
      return launch({
        state,
        configDir: configDirFor(inst),
        now: d.now,
        findObs: d.findObs,
        spawnObs: () => d.spawnDetached(argv, cwd),
        log: d.err,
      });
    }

    case "stop":
      return stopObs({
        serviceId: f.service ?? LOCAL_ID,
        defs: defs(),
        platform: host.platform,
        confirm,
        findObs: d.findObs,
        run: d.run,
        isAlive: d.isAlive,
        forceKill: d.forceKill,
        cli,
        now: d.now,
        sleep: d.sleep,
        warn,
        force: f.force,
        stopOutputs: () => live((obs) => verbs.stopOutputs(obs, { sleep: d.sleep })),
      });

    case "install": {
      const inst = await detect();
      if (inst.found && !f.portable) return { installed: true, install: inst, note: "OBS is already installed; nothing to do (run pi-obs provision)" };
      const plan = planInstall(host.platform, d.has, { portable: f.portable, state });
      d.err(describePlan(plan));
      if (plan.kind === "manual") throw new ObsError("not-found", plan.instruction);
      if (!(await confirm("Proceed with this install?"))) throw new ObsError("refused", "install not confirmed (non-interactive runs need --yes after the user agreed)");
      if (plan.kind === "portable") {
        if (!d.fetchJson || !d.fetchBytes) throw new ObsError("failed", "no network client");
        return installPortable({ state, fetchJson: d.fetchJson, fetchBytes: d.fetchBytes });
      }
      const r = await d.run(plan.argv[0], plan.argv.slice(1));
      if (r.code !== 0) throw new ObsError("failed", `${plan.argv[0]} exited ${r.code}`);
      return { installed: true, command: plan.argv.join(" "), next: host.platform === "darwin" ? "allow the OBS camera system extension when macOS asks, then restart apps that list cameras" : undefined };
    }

    case "provision":
      return provisionVerb(f, d, { state, defs, cli, confirm, warn, detect, configDirFor });

    default:
      throw new ObsError("usage", `unknown verb ${verb}`);
  }
}

interface ProvisionCtx {
  state: string;
  defs: () => ReturnType<typeof readServiceDefinitions>;
  cli: DashboardCli;
  confirm: (q: string) => Promise<boolean>;
  warn: (line: string) => void;
  detect: () => Promise<Installation>;
  configDirFor: (inst?: Installation) => string;
}

async function verifyConnect(d: CliDeps, url: string, password: string): Promise<"verified" | "auth-failed" | "pending"> {
  try {
    const conn = await (d.connect ?? connectObs)({ url, password, source: "service" }, {});
    await conn.close();
    return "verified";
  } catch (e) {
    return e instanceof ObsError && e.code === "auth-failed" ? "auth-failed" : "pending";
  }
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: sequential provisioning flow; each websocket outcome returns its own result
async function provisionVerb(f: Flags, d: CliDeps, c: ProvisionCtx): Promise<unknown> {
  const submit = { cli: c.cli, defs: c.defs(), state: c.state, warn: c.warn, yes: f.yes, update: f.update };
  if (f.remote) {
    let url: URL;
    try {
      url = new URL(f.remote);
    } catch {
      throw new ObsError("usage", "--remote needs ws://host:port");
    }
    if (url.protocol !== "ws:" && url.protocol !== "wss:") throw new ObsError("usage", "--remote needs a ws:// or wss:// URL");
    const id = f.service ?? remoteId(f.remote);
    const password = (await d.readStdin()).replace(/\r?\n$/, "");
    if (!password) throw new ObsError("usage", "the remote OBS password is read from stdin");
    await submitDefinition(remoteDefinition(id, f.remote), submit);
    const set = await c.cli.run(["service", "secret", "set", id, "password"], { stdin: password });
    if (set.code !== 0) throw new ObsError("failed", `storing the password for ${id} failed; the service exists without a secret (retry: pi-dashboard service secret set ${id} password)`);
    return { id, mode: "external", verify: await verifyConnect(d, f.remote, password) };
  }

  const inst = await c.detect();
  if (!inst.found) throw new ObsError("not-found", "OBS Studio is not installed; run `pi-obs install` first");
  if (inst.supported === false) throw new ObsError("refused", `unsupported-version: OBS ${inst.version} is older than 28`);
  const configDir = c.configDirFor(inst);
  const id = f.service ?? LOCAL_ID;
  const port = (() => {
    const p = readWsConfig(configDir).config.server_port;
    return typeof p === "number" ? p : 4455;
  })();
  await submitDefinition(localDefinition({ id, platform: d.host.platform, port, nodePath: d.nodePath, entryPath: d.entryPath }), submit);
  const ws = await enableWebsocket({
    configDir,
    state: c.state,
    serviceId: id,
    findObs: d.findObs,
    sleep: d.sleep,
    consent: c.confirm,
    cli: c.cli,
    now: d.now,
    warn: c.warn,
  });
  if (ws.action === "instructed") {
    c.warn(UI_INSTRUCTION);
    return { id, mode: "attached", websocket: "ui-instruction" };
  }
  if (ws.action === "declined") return { id, mode: "attached", websocket: "import-declined", next: "run pi-obs provision again to import, or stop OBS to let pi-obs write a new password" };
  if (ws.action === "failed") throw new ObsError("failed", `obs-websocket setup failed: ${ws.reason}${ws.restored ? " (config restored)" : ""}`);
  const running = (await d.findObs()).length > 0;
  const verify = running ? await verifyConnect(d, `ws://127.0.0.1:${ws.port}`, ws.password) : "pending";
  return {
    id,
    mode: "attached",
    websocket: ws.action,
    ...(ws.action === "imported" && ws.short ? { shortPassword: true } : {}),
    verify,
    ...(verify === "pending" ? { next: `start OBS with: pi-dashboard service start ${id}; then pi-obs doctor --live` } : {}),
  };
}
