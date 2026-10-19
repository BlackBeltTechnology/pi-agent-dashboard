// Worker-thread entry for `ctx.registerFileValidator` validators. Plain ESM
// (no TS loader needed): loads the plugin's validator module, runs
// `validate(bytes, ext)` and posts the verdict back, transferring the bytes
// home so the host can still write them. Hashes the bytes before and after so
// the host can refuse a validator that mutated them (a validator may only
// reject). See change: add-editor-pane-file-handlers (D4).
import { createHash } from "node:crypto";
import { parentPort } from "node:worker_threads";

const sha1 = (view) => createHash("sha1").update(view).digest("hex");

parentPort.on("message", async (msg) => {
  const { id, moduleUrl, ext, bytes } = msg;
  const view = new Uint8Array(bytes);
  const out = { id, kind: "error", reason: "validator failed", bytes };
  try {
    out.before = sha1(view);
    const mod = await import(moduleUrl);
    if (typeof mod.validate !== "function") throw new Error("validator module has no `validate` export");
    const res = await mod.validate(view, ext);
    out.after = sha1(view);
    if (res && res.ok === true) {
      out.kind = "ok";
      delete out.reason;
    } else {
      out.kind = "rejected";
      out.reason = String((res && res.reason) || "rejected").slice(0, 300);
    }
  } catch (e) {
    out.reason = String((e && e.message) || e).slice(0, 300);
  }
  parentPort.postMessage(out, [bytes]);
});
