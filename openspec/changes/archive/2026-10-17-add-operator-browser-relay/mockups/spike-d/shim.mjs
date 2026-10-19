// mac-home side (stand-in for an Electron-main loopback relay shim).
// 127.0.0.1:18777/ws/browser-ext/<guid> (what the STOCK extension accepts) → MacBook bridge.
import { createRequire } from "node:module";
import { pipe } from "./pipe.mjs";
const { WebSocketServer, WebSocket } = createRequire(import.meta.url)("/Users/robson/Project/pi-agent-dashboard/node_modules/ws");
const SECRET = process.env.SPIKE_SECRET, UP = "ws://192.168.16.204:18778", EXT = "chrome-extension://mmlmfjhmonkocbjadbfplnigmagldckm";
const log = (m) => console.log(new Date().toISOString().slice(11, 23), "[shim]", m);
const wss = new WebSocketServer({ port: 18777, host: "127.0.0.1", verifyClient: ({ req }) => {
  const ok = req.headers.origin === EXT; if (!ok) log(`refused origin=${req.headers.origin}`); return ok; } });
wss.on("connection", (down, req) => {
  const m = /^\/ws\/browser-ext\/([A-Za-z0-9_-]+)$/.exec(req.url ?? ""); if (!m) return down.close(1008, "bad path");
  log("extension connected on loopback, opening tunnel");
  pipe(down, new WebSocket(`${UP}/${m[1]}`, { headers: { "x-spike-secret": SECRET } }), "ext", log);
});
log("listening 127.0.0.1:18777");
