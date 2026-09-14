import { parentPort } from "node:worker_threads";
parentPort.on("message", (msg) => {
  parentPort.postMessage({ id: msg.id, result: { mcpServers: {} } });
});
