// CI spike probe (encrypt-credentials-at-rest, @napi-rs/keyring delivery).
//   node probe.cjs <label>                     round-trip set/get/delete, main thread + worker
//   node probe.cjs <label> set|get|del <svc> <acct> [value]   single op (for OS-tool inspection / ACL)
//   PROBE_OPTS='{"linux":{"store":"secret-service"}}' passes an EntryOptions bag.
// Prints exactly one `RESULT <label> <json>` line. Errors carry the deepest cause-chain message.
const { Worker, isMainThread, parentPort, workerData } = require("node:worker_threads");

function rootCause(err) {
  const msgs = [];
  const walk = (x, d) => {
    if (!x || d > 6) return;
    if (Array.isArray(x)) return x.forEach((y) => walk(y, d));
    msgs.push(String(x.message || x).replace(/\s+/g, " "));
    walk(x.cause, d + 1);
  };
  walk(err && err.cause, 0);
  const hit = msgs.find((m) => /dlopen|map segment|code signature|LoadLibrary|not a valid Win32|%1|ERR_DLOPEN|\.node/i.test(m) && !/Cannot find module/.test(m));
  return (hit || msgs[msgs.length - 1] || "").slice(0, 260);
}

function op(kind, svc, acct, value) {
  const t0 = process.hrtime.bigint();
  const ms = () => Math.round(Number(process.hrtime.bigint() - t0) / 1e5) / 10;
  try {
    const { Entry } = require("@napi-rs/keyring");
    const opts = process.env.PROBE_OPTS ? JSON.parse(process.env.PROBE_OPTS) : undefined;
    const e = new Entry(svc, acct, opts);
    if (kind === "set") { e.setPassword(value); return { ok: true, ms: ms() }; }
    if (kind === "get") { const v = e.getPassword(); return { ok: v != null, value: v == null ? null : v.length + " chars", ms: ms() }; }
    if (kind === "del") { e.deletePassword(); return { ok: true, ms: ms() }; }
    e.setPassword("spike-value");
    const got = e.getPassword();
    e.deletePassword();
    return { ok: got === "spike-value", ms: ms() };
  } catch (err) {
    return { err: String(err && err.message).split("\n")[0].slice(0, 120), root: rootCause(err), ms: ms() };
  }
}

if (isMainThread) {
  const [label = "probe", kind = "rt", svc = `pi-dash-keyring-spike-${process.pid}`, acct = "k", value = "spike-value"] = process.argv.slice(2);
  const head = { node: process.version, arch: process.arch, napi: process.versions.napi };
  const main = op(kind, svc, acct, value);
  if (kind !== "rt") {
    console.log(`RESULT ${label} ${JSON.stringify({ ...head, main })}`);
  } else {
    const w = new Worker(__filename, { workerData: { svc: svc + "-w", acct } });
    const t = setTimeout(() => { console.log(`RESULT ${label} ${JSON.stringify({ ...head, main, worker: "TIMEOUT(20s)" })}`); process.exit(0); }, 20000);
    w.on("message", (m) => { clearTimeout(t); console.log(`RESULT ${label} ${JSON.stringify({ ...head, main, worker: m })}`); });
    w.on("error", (e) => { clearTimeout(t); console.log(`RESULT ${label} ${JSON.stringify({ ...head, main, worker: "ERROR " + e.message })}`); });
  }
} else {
  parentPort.postMessage(op("rt", workerData.svc, workerData.acct));
}
