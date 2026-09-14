/**
 * Worker-thread entry for the default adapter port. Runs the SYNCHRONOUS
 * `pi-mcp-adapter/config` loaders off the server's event loop, so a stalled
 * load (hung mount, slow `imports` resolution) cannot block the dashboard.
 *
 * The adapter module URL is passed absolutely via workerData, so resolution
 * does not depend on this file's own node_modules location.
 */
import { parentPort, workerData } from "node:worker_threads";

const mod = await import(workerData.adapterUrl);

parentPort.on("message", (msg) => {
  const { id, method, args } = msg;
  try {
    const result = mod[method](...args);
    parentPort.postMessage({ id, result });
  } catch (e) {
    parentPort.postMessage({ id, error: { message: e?.message ?? String(e) } });
  }
});
