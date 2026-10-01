#!/usr/bin/env node
/**
 * Fake managed engine for supervisor tests (task 1.4). Listens on 127.0.0.1.
 * Port: `--port <n>` (Von shape) or `LAYA_PORT` (Laya shape).
 * Behaviour via env:
 *   FAKE_MODELS=200|404   GET /v1/models status (default 200)
 *   FAKE_HEALTHY=0        never answer health (models 503, systemone 503)
 *   FAKE_TRAP_TERM=1      ignore SIGTERM (only SIGKILL stops it)
 * See change: add-system-one-registry.
 */
import { createServer } from "node:http";

const argv = process.argv.slice(2);
const i = argv.indexOf("--port");
const port = Number(i >= 0 ? argv[i + 1] : process.env.LAYA_PORT);
const healthy = process.env.FAKE_HEALTHY !== "0";
const modelsStatus = Number(process.env.FAKE_MODELS ?? 200);

if (process.env.FAKE_TRAP_TERM === "1") process.on("SIGTERM", () => console.log("trapped SIGTERM"));

const server = createServer((req, res) => {
  const send = (status, body) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  if (!healthy) return send(503, { error: "warming up" });
  if (req.method === "GET" && req.url === "/v1/models") return send(modelsStatus, { data: [{ id: "fake" }] });
  if (req.method === "POST" && req.url === "/v1/systemone") {
    let raw = "";
    req.on("data", (c) => {
      raw += c;
    });
    req.on("end", () => {
      const body = JSON.parse(raw || "{}");
      const answers = {};
      for (const [id, q] of Object.entries(body.questions ?? {})) {
        if (q.type === "noul") answers[id] = { noul: 0.9 };
        else if (q.type === "choice") {
          const k = Object.keys(q.criteria)[0];
          answers[id] = { choice: k, probabilities: { [k]: 1 }, confidence: 1 };
        } else answers[id] = { score: 0, probabilities: q.criteria.map((_, j) => (j === 0 ? 1 : 0)), confidence: 1 };
      }
      send(200, { model: body.model || "fake", answers });
    });
    return;
  }
  send(404, { error: "not found" });
});

server.listen(port, "127.0.0.1", () => console.log(`fake engine on ${port}`));
