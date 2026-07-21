#!/usr/bin/env node
/**
 * Forward root npm scripts into a workspace script while preserving
 * user-supplied CLI args after `npm run <script> -- ...`.
 *
 * Root script example:
 *   npm run dev -- --port 3000
 *
 * Desired workspace invocation:
 *   npm --workspace=@blackbelt-technology/pi-dashboard-web run dev -- --port 3000
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const CLIENT_WORKSPACE = "@blackbelt-technology/pi-dashboard-web";

export function buildWorkspaceRunInvocation({
  workspace,
  scriptName,
  forwardedArgs = [],
  nodeExecPath = process.execPath,
  npmExecPath = process.env.npm_execpath,
}) {
  if (!workspace) throw new Error("workspace is required");
  if (!scriptName) throw new Error("scriptName is required");

  const commandArgs = [
    `--workspace=${workspace}`,
    "run",
    scriptName,
    ...(forwardedArgs.length > 0 ? ["--", ...forwardedArgs] : []),
  ];

  if (npmExecPath) {
    return {
      command: nodeExecPath,
      args: [npmExecPath, ...commandArgs],
    };
  }

  return {
    command: process.platform === "win32" ? "npm.cmd" : "npm",
    args: commandArgs,
  };
}

export async function runWorkspaceScript(scriptName, forwardedArgs = []) {
  const { command, args } = buildWorkspaceRunInvocation({
    workspace: CLIENT_WORKSPACE,
    scriptName,
    forwardedArgs,
  });

  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      env: process.env,
    });

    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`workspace script terminated by signal ${signal}`));
        return;
      }
      if ((code ?? 1) !== 0) {
        reject(new Error(`workspace script exited with code ${code ?? 1}`));
        return;
      }
      resolve();
    });
  });
}

async function main(argv) {
  const [scriptName, ...forwardedArgs] = argv;
  if (!scriptName) {
    process.stderr.write("usage: node scripts/run-workspace-script.mjs <script> [args...]\n");
    process.exit(2);
  }

  try {
    await runWorkspaceScript(scriptName, forwardedArgs);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}

const isEntrypoint = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntrypoint) {
  await main(process.argv.slice(2));
}
