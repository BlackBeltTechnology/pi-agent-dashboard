#!/usr/bin/env node
/**
 * Fake `code-server` for editor-keeper integration tests.
 *
 * Parses --bind-addr 127.0.0.1:<port>, binds a TCP listener so the keeper's
 * status probe sees an open port, then idles until killed.
 */
"use strict";
const net = require("net");

const args = process.argv.slice(2);
const idx = args.indexOf("--bind-addr");
const bind = idx >= 0 ? args[idx + 1] : "127.0.0.1:0";
const port = Number.parseInt((bind.split(":")[1] ?? "0"), 10);

const server = net.createServer((sock) => sock.end());
server.listen(port, "127.0.0.1", () => {
  // signal readiness via stdout (captured by the keeper's log fd)
  process.stdout.write(`mock-code-server listening on 127.0.0.1:${port}\n`);
});

process.on("SIGTERM", () => { server.close(() => process.exit(0)); });
process.on("SIGINT", () => { server.close(() => process.exit(0)); });

// Keep the process alive on a long timer so it doesn't exit when stdin closes.
setInterval(() => { /* idle */ }, 60_000);
