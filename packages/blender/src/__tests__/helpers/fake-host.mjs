// Scripted fake Blender host: a real child process speaking the host IPC (src/host/protocol.ts) over
// `process.send` / `process.on("message")`, so supervisor kill / timeout / crash semantics are real.
//
// Behaviour comes from the JSON file named by FAKE_HOST_CONFIG:
//   {
//     "log": "<path>",                 // append-only JSONL: one line per boot ("boot") and per request ("op"/"sent")
//     "boots": [ { "delayMs": 0, "exitCode": 1, "stderr": "boom", "hang": false } ],   // indexed by boot number (0-based)
//     "steps": [ { "delayMs": 0, "result": {}, "output": "", "outputTruncated": false,
//                  "files": { "good.glb": "text" },          // string content; keys are returned verbatim
//                  "error": { "code": "python-error", "message": "x" },
//                  "exitCode": 1, "stderr": "text" } ]      // indexed by request number across all boots (0-based)
//   }
// Missing entries mean "boot immediately and answer `ok`". The counters are derived from the log file, so
// they survive respawns of the host after a crash / timeout / idle kill.
import * as fs from "node:fs";

const cfgPath = process.env.FAKE_HOST_CONFIG;
const cfg = cfgPath ? JSON.parse(fs.readFileSync(cfgPath, "utf8")) : {};
const log = cfg.log;

function count(type) {
  if (!log || !fs.existsSync(log)) return 0;
  return fs
    .readFileSync(log, "utf8")
    .split("\n")
    .filter((l) => l && JSON.parse(l).type === type).length;
}
function record(entry) {
  if (log) fs.appendFileSync(log, `${JSON.stringify({ ...entry, t: Date.now(), pid: process.pid })}\n`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

process.on("disconnect", () => process.exit(0));

const bootNo = count("boot");
const boot = (cfg.boots ?? [])[bootNo] ?? {};
record({ type: "boot", n: bootNo });

async function start() {
  if (boot.delayMs) await sleep(boot.delayMs);
  if (boot.stderr) process.stderr.write(`${boot.stderr}\n`);
  if (boot.exitCode !== undefined) process.exit(boot.exitCode);
  if (boot.hang) return;
  process.send({ type: "ready", runtimeVersion: "0.0.5" });
}

process.on("message", async (req) => {
  if (req?.type !== "op") return;
  const n = count("op");
  const step = (cfg.steps ?? [])[n] ?? {};
  record({
    type: "op",
    n,
    id: req.id,
    op: req.op,
    args: req.args,
    nonce: req.nonce,
    outputLimit: req.outputLimit,
    files: Object.fromEntries(Object.entries(req.files ?? {}).map(([k, v]) => [k, v.byteLength])),
    hasBlend: req.blend !== undefined,
  });
  if (step.delayMs) await sleep(step.delayMs);
  if (step.stderr) process.stderr.write(`${step.stderr}\n`);
  if (step.exitCode !== undefined) process.exit(step.exitCode);
  const base = { type: "result", id: req.id, output: step.output ?? "", outputTruncated: step.outputTruncated === true };
  if (step.error) {
    process.send({ ...base, ok: false, code: step.error.code, message: step.error.message });
  } else {
    const files = Object.fromEntries(Object.entries(step.files ?? {}).map(([k, v]) => [k, new Uint8Array(Buffer.from(v))]));
    process.send({ ...base, ok: true, result: step.result ?? {}, files });
  }
  record({ type: "sent", n, id: req.id });
});

void start();
