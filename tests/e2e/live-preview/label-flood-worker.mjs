// Child process of `label-probe-flood.resolver.spec.ts` (row #P17): the label flood generator, kept OUT of the test
// process so its event loop (which times /api/health and the event stream) is not the thing being loaded.
// Usage: node label-flood-worker.mjs <port> <ratePerSec> <seconds>   → prints one JSON line `{sent,r403,other,seconds}` at the end.
import net from "node:net";

const [port, rate, seconds] = process.argv.slice(2).map(Number);
const ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";
const randomLabel = () => {
  let s = "";
  for (let i = 0; i < 26; i++) s += ALPHABET[Math.floor(Math.random() * 32)];
  return s;
};
const SOCKETS = 16;
const MAX_IN_FLIGHT = 400;
const stats = { sent: 0, r403: 0, other: 0, seconds: 0 };
const started = Date.now();
const socks = Array.from({ length: SOCKETS }, () => ({ s: null, inFlight: 0, tail: "" }));
const open = (slot) => {
  const s = net.connect(port, "127.0.0.1");
  s.setNoDelay(true);
  slot.s = s;
  slot.inFlight = 0;
  slot.tail = "";
  s.on("data", (buf) => {
    const text = slot.tail + buf.toString("latin1");
    for (const m of text.matchAll(/HTTP\/1\.1 (\d{3})/g)) {
      if (m[1] === "403") stats.r403++;
      else stats.other++;
      slot.inFlight = Math.max(0, slot.inFlight - 1);
    }
    slot.tail = text.slice(-11);
  });
  s.on("error", () => s.destroy());
  s.on("close", () => {
    if (slot.s === s) slot.s = null;
  });
};
let next = 0;
const timer = setInterval(() => {
  const due = Math.floor(((Date.now() - started) * rate) / 1000) - stats.sent;
  for (let i = 0; i < due; i++) {
    const slot = socks[next++ % SOCKETS];
    if (!slot.s) open(slot);
    if (slot.inFlight >= MAX_IN_FLIGHT || !slot.s.writable) continue;
    slot.s.write(`GET /api/health HTTP/1.1\r\nHost: ${randomLabel()}.localhost:${port}\r\nAccept: */*\r\n\r\n`);
    slot.inFlight++;
    stats.sent++;
  }
}, 5);
setTimeout(() => {
  clearInterval(timer);
  setTimeout(() => {
    stats.seconds = (Date.now() - started) / 1000;
    for (const slot of socks) slot.s?.destroy();
    console.log(JSON.stringify(stats));
    process.exit(0);
  }, 1000);
}, seconds * 1000);
