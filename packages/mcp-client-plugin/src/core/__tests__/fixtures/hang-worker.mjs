// A worker that never answers — simulates a stalled synchronous adapter load.
import { parentPort } from "node:worker_threads";
parentPort.on("message", () => {
  /* deliberately never respond */
});
