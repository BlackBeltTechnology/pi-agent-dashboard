// Socket guard preload (`NODE_OPTIONS=--require <this file>`): inherited by the MCP server and the
// Blender host child (and their worker threads). It wraps the primitives a network listener or an
// outbound connection must go through and appends one JSON line per call to the file named by
// BLENDER_WASM_GUARD_LOG — so a test can assert the log is empty ("no listener, no outbound").
//
// Wrapped: net.Server.prototype.listen, net.Socket.prototype.connect, dgram.createSocket,
// globalThis.WebSocket. Each wrapper logs and then delegates, so a deliberate call still works in the
// self-test. See change: add-blender-wasm-mcp (task 4.4, design D9).
"use strict";
const fs = require("node:fs");
const net = require("node:net");
const dgram = require("node:dgram");

const logFile = process.env.BLENDER_WASM_GUARD_LOG;

function log(kind, detail) {
  if (!logFile) return;
  try {
    fs.appendFileSync(logFile, `${JSON.stringify({ pid: process.pid, kind, detail: String(detail ?? "") })}\n`);
  } catch {
    /* never break the guarded process */
  }
}

const origListen = net.Server.prototype.listen;
net.Server.prototype.listen = function listen(...args) {
  log("listen", JSON.stringify(args.filter((a) => typeof a !== "function")));
  return origListen.apply(this, args);
};

// tsx (the checkout launcher path) talks to its parent over a unix pipe `<tmpdir>/tsx-<uid>/<pid>.pipe`
// (Windows: `\\.\pipe\...tsx-<pid>`). That is dev-tooling IPC, not user networking, and it does not exist
// in a published `dist/` install. Only that exact shape is ignored; every other TCP/unix connect is logged.
const TSX_PIPE = /[\\/]tsx-[^\\/]+[\\/]\d+\.pipe$|^[\\/]{2}[.?][\\/]pipe[\\/]tsx-/;
function isToolingPipe(args) {
  const first = Array.isArray(args[0]) ? args[0][0] : args[0];
  const p = first && typeof first === "object" ? first.path : typeof first === "string" && Number.isNaN(Number(first)) ? first : undefined;
  return typeof p === "string" && TSX_PIPE.test(p);
}

const origConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function connect(...args) {
  // IPC channels created by child_process are pipes/handles, not `connect()` calls on a Socket; a TCP
  // or UNIX socket connect from user code always passes through here.
  if (!isToolingPipe(args)) log("connect", JSON.stringify(args.filter((a) => typeof a !== "function")));
  return origConnect.apply(this, args);
};

const origCreateSocket = dgram.createSocket;
dgram.createSocket = function createSocket(...args) {
  log("dgram", JSON.stringify(args.filter((a) => typeof a !== "function")));
  return origCreateSocket.apply(this, args);
};

if (typeof globalThis.WebSocket === "function") {
  const Orig = globalThis.WebSocket;
  globalThis.WebSocket = new Proxy(Orig, {
    construct(target, args, newTarget) {
      log("websocket", args[0]);
      return Reflect.construct(target, args, newTarget);
    },
  });
}
