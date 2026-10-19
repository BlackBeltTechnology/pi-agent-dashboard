/**
 * Shared harness of the craft-web server tests: temp dirs, a Trunk-shaped fixture build, a recording
 * logger and a fake `ServerPluginContext` whose `serveApp` is the REAL `mountApp`.
 * See change: edit-office-in-pane-with-craft-web.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearAppMountRegistry, mountApp, type ServerPluginContext } from "@blackbelt-technology/dashboard-plugin-runtime/server";
import Fastify, { type FastifyInstance } from "fastify";
import { type Mock, vi } from "vitest";
import type { CraftWebConfig } from "../config.js";

const dirs: string[] = [];

export function tmp(prefix = "craft-web-"): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  dirs.push(d);
  return d;
}

export function cleanupTmp(): void {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
}

export const TRUNK_BOOTSTRAP =
  "import init, * as bindings from './wordcraft-1a2b3c.js';\nconst wasm = await init({ module_or_path: './wordcraft-1a2b3c_bg.wasm' });\nwindow.wasmBindings = bindings;\ndispatchEvent(new CustomEvent(\"TrunkApplicationStarted\", {detail: {wasm}}));\n";

const TRUNK_INDEX = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>WordCraft</title>
<link rel="modulepreload" href="./wordcraft-1a2b3c.js" crossorigin="anonymous" integrity="sha384-x"/>
<link rel="preload" href="./wordcraft-1a2b3c_bg.wasm" as="fetch" type="application/wasm" crossorigin="anonymous" integrity="sha384-y"/>
<style>html{margin:0}</style></head><body><canvas id="the_canvas_id"></canvas>
<script type="module">${TRUNK_BOOTSTRAP}</script></body></html>`;

/** A Trunk-shaped build directory (inline module bootstrap, js, wasm, a stray `.br`). */
export function writeTrunkBuild(dir: string, o: { br?: boolean } = {}): string {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "index.html"), TRUNK_INDEX);
  fs.writeFileSync(path.join(dir, "wordcraft-1a2b3c.js"), "export default async function init(){return {}}\n");
  fs.writeFileSync(path.join(dir, "wordcraft-1a2b3c_bg.wasm"), Buffer.alloc(4096, 7));
  fs.writeFileSync(path.join(dir, "icon.png"), Buffer.alloc(64, 1));
  if (o.br) fs.writeFileSync(path.join(dir, "wordcraft-1a2b3c_bg.wasm.br"), "br");
  return dir;
}

/** A shim file declaring `SHIM_VERSION = <n>` (the shape `shim.ts` reads). */
export function writeShim(dir: string, version = 1): string {
  const file = path.join(dir, "craft-shim.js");
  fs.writeFileSync(file, `/* test shim */\nconst SHIM_VERSION = ${version};\n(function(){window.__shim=${version};})();\n`);
  return file;
}

type LogFn = (msg: string, ...args: unknown[]) => void;

export interface RecordingLogger {
  info: Mock<LogFn>;
  warn: Mock<LogFn>;
  error: Mock<LogFn>;
}

export const recordingLogger = (): RecordingLogger => ({ info: vi.fn<LogFn>(), warn: vi.fn<LogFn>(), error: vi.fn<LogFn>() });

export interface FakeHost {
  ctx: ServerPluginContext;
  fastify: FastifyInstance;
  logger: RecordingLogger;
  dataDir: string;
  packageRoot: string;
  config: CraftWebConfig;
  registerFileValidator: ReturnType<typeof vi.fn>;
  serveApp: ReturnType<typeof vi.fn>;
}

/** Fake ctx around a real Fastify; `mount:false` models a plugin enabled live (mount not registered). */
export function makeHost(o: { config?: CraftWebConfig; mount?: boolean; dataDir?: string } = {}): FakeHost {
  clearAppMountRegistry();
  const fastify = Fastify();
  const logger = recordingLogger();
  const dataDir = o.dataDir ?? tmp("craft-web-data-");
  const packageRoot = tmp("craft-web-pkg-");
  const config: CraftWebConfig = o.config ?? {};
  const registerFileValidator = vi.fn();
  const serveApp = vi.fn((opts: Parameters<ServerPluginContext["serveApp"]>[0]) => {
    if (o.mount === false) return;
    mountApp({ fastify, pluginId: "craft-web", packageRoot, dataDir, logger }, opts);
  });
  const ctx = {
    fastify,
    logger,
    dataDir,
    serveApp,
    registerFileValidator,
    getPluginConfig: () => config,
  } as unknown as ServerPluginContext;
  return { ctx, fastify, logger, dataDir, packageRoot, config, registerFileValidator, serveApp };
}
