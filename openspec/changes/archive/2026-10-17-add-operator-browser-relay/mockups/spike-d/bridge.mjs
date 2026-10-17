// MacBook side (stand-in for the server end of Electron's authed operator WS).
// LAN :18778/<guid>  →  ws://127.0.0.1:8000/ws/browser-ext/<guid> with the pinned extension Origin.
import { createRequire } from "node:module";
import { pipe } from "./pipe.mjs";
const { WebSocketServer, WebSocket } = createRequire(import.meta.url)("/Users/robson/Project/pi-agent-dashboard/node_modules/ws");
const SECRET = process.env.SPIKE_SECRET, PEER = "192.168.16.220", EXT = "chrome-extension://mmlmfjhmonkocbjadbfplnigmagldckm";
const log = (m) => console.log(new Date().toISOString().slice(11, 23), "[bridge]", m);
const wss = new WebSocketServer({ port: 18778, host: "0.0.0.0", verifyClient: ({ req }) => {
  const peer = req.socket.remoteAddress?.replace("::ffff:", ""), ok = peer === PEER && req.headers["x-spike-secret"] === SECRET;
  if (!ok) log(`refused peer=${peer}`); return ok; } });
wss.on("connection", (down, req) => {
  const guid = req.url.replace(/^\//, ""); if (!/^[A-Za-z0-9_-]{16,}$/.test(guid)) return down.close(1008, "bad guid");
  log(`tunnel in from ${PEER}, dialing dashboard ext scope`);
  const up = new WebSocket(`ws://127.0.0.1:8000/ws/browser-ext/${guid}`, { headers: { Origin: EXT } });
  up.on("unexpected-response", (_q, res) => log(`dashboard refused upgrade HTTP ${res.statusCode}`));
  pipe(down, up, "ext", log);
});
log("listening 0.0.0.0:18778");
