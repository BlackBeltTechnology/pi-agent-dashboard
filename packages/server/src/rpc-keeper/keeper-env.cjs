"use strict";

/**
 * Build the environment for a pi launch from the rpc keeper.
 *
 * - `PI_DASHBOARD_SPAWNED=1` is set on EVERY (re)launch so source labelling
 *   survives respawn via the bridge's capture-once boolean.
 * - Keeper-internal `PI_KEEPER_PI_ARGS` / `PI_KEEPER_PI_CMD` are always
 *   stripped so they never leak into pi's env.
 * - `PI_DASHBOARD_SPAWN_TOKEN` is single-use: included only for the FIRST pi
 *   launch of the keeper. Every subsequent respawn scrubs it so the consumed
 *   token is never re-reported. See change: fix-spawn-token-env-leak.
 *
 * @param {NodeJS.ProcessEnv} baseEnv source env (typically `process.env`)
 * @param {boolean} isFirstLaunch true for the keeper's first pi launch
 * @returns {NodeJS.ProcessEnv} a fresh env object for `child_process.spawn`
 */
function buildPiEnv(baseEnv, isFirstLaunch) {
  const env = Object.assign({}, baseEnv, { PI_DASHBOARD_SPAWNED: "1" });
  delete env.PI_KEEPER_PI_ARGS;
  delete env.PI_KEEPER_PI_CMD;
  if (!isFirstLaunch) {
    delete env.PI_DASHBOARD_SPAWN_TOKEN;
  }
  return env;
}

module.exports = { buildPiEnv };
