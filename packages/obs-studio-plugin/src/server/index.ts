/**
 * OBS Studio plugin server entry (design D1, D4, D7). Wires the bridge manager
 * (`service exec` → `pi-obs serve --stdio` children), the 5 s-cached service
 * state reader (`pi-dashboard service status --json`), the panel routes and the
 * standalone page. The OBS password never enters this process. Bridges are
 * disposed on shutdown (stdin EOF first). See change: add-obs-studio-plugin.
 */
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ServerPluginContext } from "@blackbelt-technology/dashboard-plugin-runtime/server";
import { spawn } from "@blackbelt-technology/pi-dashboard-shared/platform/exec.js";
import { createDashboardCli } from "../core/dashboard-cli.js";
import { readInstances } from "../core/instances.js";
import { readLaunchState } from "../core/launch.js";
import { stateDir } from "../core/paths.js";
import { findDefinition } from "../core/service-defs.js";
import { BridgeManager } from "./bridge.js";
import { dashboardCliArgv } from "./dashboard-cli-argv.js";
import { mountObsRoutes } from "./routes.js";
import { createStateReader } from "./service-state.js";
import { mountStandalone } from "./standalone.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const PI_OBS_ENTRY = path.resolve(here, "..", "..", "bin", "pi-obs.mjs");

export default async function registerPlugin(ctx: ServerPluginContext): Promise<void> {
  const home = os.homedir();
  const dashboardDir = path.join(home, ".pi", "dashboard");
  const state = stateDir({ home, platform: process.platform as "darwin", env: process.env });
  let cliArgv: string[];
  try {
    cliArgv = dashboardCliArgv();
  } catch (e) {
    ctx.logger.warn(`[obs-studio] ${(e as Error).message}; plugin inactive`);
    return;
  }
  const cli = createDashboardCli(process.env, cliArgv);
  const bridges = new BridgeManager({
    cliArgv,
    nodePath: process.execPath,
    piObsEntry: PI_OBS_ENTRY,
    spawn: (argv) => spawn(argv[0], argv.slice(1), { stdio: ["pipe", "pipe", "pipe"], shell: false }),
    log: (m) => ctx.logger.info(m),
  });
  const definition = (id: string) => {
    const def = findDefinition(dashboardDir, id);
    return def ? { mode: def.mode, ws: def.endpoints?.ws } : undefined;
  };
  await mountObsRoutes(ctx.fastify, {
    bridges,
    states: createStateReader(cli),
    instances: () => readInstances(state, (id) => findDefinition(dashboardDir, id) !== undefined),
    definition,
    recoverySuspended: (id) => {
      if (definition(id)?.mode !== "attached") return false;
      const ls = readLaunchState(state);
      return ls.state.suspended || ls.corrupt;
    },
    hasOperateAuthority: ctx.identity?.hasOperateAuthority ? (req) => ctx.identity?.hasOperateAuthority?.(req) === true : undefined,
    networkGuard: ctx.networkGuard,
    logger: ctx.logger,
  });
  await mountStandalone(ctx.fastify, ctx.networkGuard);
  ctx.onShutdown(() => {
    void bridges.disposeAll();
  });
}
