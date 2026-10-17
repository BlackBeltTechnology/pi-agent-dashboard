/**
 * mcp-client-plugin · SERVER entry.
 *
 * Builds the `mcp-client.config` service over pi's built-in MCP config with
 * the real filesystem IO, the host's known-folder set, the host's pi
 * project-trust rule (`host.isProjectTrusted`; absent → every project is
 * untrusted) and the default `pi mcp list` runner. Provides it BEFORE any
 * route is registered, then mounts the REST surface.
 *
 * See change: migrate-mcp-to-pi-builtin; earlier: extract-mcp-client-plugin (task 4.1).
 */

import type { ServerPluginContext } from "@blackbelt-technology/dashboard-plugin-runtime/server";
import type { IndeterminateInfo } from "@blackbelt-technology/pi-dashboard-shared/cwd-guard.js";
import { createRealConfigIO } from "../core/config-io.js";
import { createMcpClientConfigService } from "../core/service.js";
import type { ProjectTrustSource } from "../core/types.js";
import { createPiMcpListRunner } from "./pi-runner.js";
import { mountMcpClientRoutes } from "./routes.js";

const SERVICE_KEY = "mcp-client.config";
const HOST_KNOWN_FOLDERS = "host.knownFolderCwds";
const HOST_PROJECT_TRUST = "host.isProjectTrusted";
const HOST_PROJECT_TRUST_SOURCE = "host.projectTrustSource";
const HOST_COVER_INTERACTIVE = "host.piTrustCoverInteractive";
const HOST_CWD_ADMISSION_LOG = "host.cwdAdmissionOnIndeterminate";

async function registerPlugin(ctx: ServerPluginContext): Promise<void> {
  ctx.logger.info("mcp-client server entry activated");
  const hostKnown = ctx.consume<() => string[]>(HOST_KNOWN_FOLDERS);
  const knownCwds = (): string[] => (hostKnown ? hostKnown() : []);
  const hostTrust = ctx.consume<(cwd: string) => boolean>(HOST_PROJECT_TRUST);
  if (!hostTrust) {
    ctx.logger.warn(`mcp-client: host service '${HOST_PROJECT_TRUST}' is unavailable — every project's .pi/mcp.json is shown as untrusted`);
  }
  // Optional additive disclosure: who decided the trust, and whether dashboard
  // trust also covers interactive pi. See change: mirror-dashboard-trust-to-pi.
  const trustSource = ctx.consume<(cwd: string) => ProjectTrustSource | undefined>(HOST_PROJECT_TRUST_SOURCE);
  const coverInteractive = ctx.consume<() => boolean>(HOST_COVER_INTERACTIVE);
  const runtime = createMcpClientConfigService({
    configIO: createRealConfigIO(),
    knownCwds,
    ...(hostTrust ? { isProjectTrusted: (cwd: string) => hostTrust(cwd) } : {}),
    ...(trustSource ? { projectTrustSource: (cwd: string) => trustSource(cwd) } : {}),
    ...(coverInteractive ? { coverInteractive: () => coverInteractive() } : {}),
    runner: createPiMcpListRunner(),
  });

  // Provide the service before routes so a dependent plugin registering later
  // observes it during its own registration.
  ctx.provide(SERVICE_KEY, runtime);

  // Raise the access dialog on a user-initiated write for an unknown folder, and
  // log undecidable admissions through the host's throttled sink. Both optional:
  // a host without them keeps the plain 403 / no log.
  // See change: harden-plugin-cwd-admission.
  const onIndeterminate = ctx.consume<(info: IndeterminateInfo) => void>(HOST_CWD_ADMISSION_LOG);
  mountMcpClientRoutes(ctx.fastify, {
    runtime,
    knownCwds,
    networkGuard: ctx.networkGuard,
    holdCwdDenial: ctx.holdCwdDenial,
    admitOptions: onIndeterminate ? { onIndeterminate } : undefined,
  });
}

export default registerPlugin;
