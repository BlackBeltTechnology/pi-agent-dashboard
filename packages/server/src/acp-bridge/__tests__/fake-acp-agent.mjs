// Scripted fake ACP agent for acp-bridge tests (NDJSON JSON-RPC 2.0 over stdio).
//
// Replays the synthetic fixtures in packages/shared/src/acp/__tests__/fixtures/
// deterministically in v1 or v2 mode. Usable two ways:
//   - in-process:  runFakeAgent({ input, output, protocol, knobs })   (unit tests)
//   - as a child:  node fake-acp-agent.mjs [--protocol 1|2] [--knobs '<json>']
//
// Knobs (all optional):
//   delayMs            sleep before each scripted step
//   withhold           method names that never get a response, e.g. ["initialize"]
//   echoUser           "before" | "after" | "none" — when the prompt echo is emitted
//   nonJson            emit a garbage (non-JSON) line at the start of every turn
//   longLine           emit one line of this many bytes at the start of every turn
//   rejectPrompt       answer session/prompt with a JSON-RPC error
//   requestFs          send an fs/read_text_file request + terminal/create + _x/y during a turn
//   hostileSessionId   session/new returns "../../../etc/x" as the session id
//   unknownVariant     emit an unknown `_querymt_hook_notice` update during a turn
//   permission         use the fixture's permissionTurn (request_permission step) instead of the plain turn
//   initializeVersion  override the protocolVersion in the initialize response
// See change: add-acp-session-driver (task 0.2).

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = resolve(here, "../../../../shared/src/acp/__tests__/fixtures");

function loadFixture(protocol) {
  return JSON.parse(readFileSync(resolve(FIXTURE_DIR, `querymt-v${protocol}.json`), "utf8"));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * @param {{ input: NodeJS.ReadableStream, output: NodeJS.WritableStream, protocol?: 1|2, knobs?: Record<string, unknown>, fixture?: any }} opts
 * @returns {{ done: Promise<void>, received: Array<Record<string, unknown>> }}
 */
export function runFakeAgent({ input, output, protocol = 1, knobs = {}, fixture }) {
  const fx = fixture ?? loadFixture(protocol);
  const received = [];
  const pendingResponses = new Map();
  let nextRequestId = 1000;
  let promptCounter = 0;
  let cancelled = false;
  let buf = "";

  const send = (obj) => output.write(`${JSON.stringify(obj)}\n`);
  const sendUpdate = (sessionId, update) =>
    send({ jsonrpc: "2.0", method: "session/update", params: { sessionId, update } });
  const request = (method, params) =>
    new Promise((res) => {
      const id = nextRequestId++;
      pendingResponses.set(id, res);
      send({ jsonrpc: "2.0", id, method, params });
    });
  const withheld = (method) => Array.isArray(knobs.withhold) && knobs.withhold.includes(method);
  const delay = () => (knobs.delayMs ? sleep(knobs.delayMs) : Promise.resolve());

  const sessionId = knobs.hostileSessionId ? "../../../etc/x" : fx.sessionNew.sessionId;

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: scripted test double — each branch is one independent fault-injection knob.
  async function runTurn(promptParams, promptRpcId) {
    cancelled = false;
    promptCounter += 1;
    const turnNo = promptCounter;
    const promptText = (promptParams?.prompt ?? []).map((b) => b.text ?? "").join("");
    const echo = (knobs.echoUser ?? "after") !== "none";
    const echoUpdate =
      protocol === 2
        ? { sessionUpdate: "user_message", messageId: knobs.acceptedMessageId ?? `u-accepted-${turnNo}`, content: [{ type: "text", text: promptText }] }
        : { sessionUpdate: "user_message_chunk", content: { type: "text", text: promptText } };

    if (knobs.rejectPrompt) {
      send({ jsonrpc: "2.0", id: promptRpcId, error: { code: -32000, message: "prompt rejected by fake agent" } });
      return;
    }
    // v2: accept first (messageId), then stream; v1: respond when the turn is over.
    if (protocol === 2) {
      if (echo && knobs.echoUser === "before") sendUpdate(sessionId, echoUpdate);
      send({ jsonrpc: "2.0", id: promptRpcId, result: { messageId: knobs.acceptedMessageId ?? `u-accepted-${turnNo}` } });
    } else if (echo && knobs.echoUser === "before") sendUpdate(sessionId, echoUpdate);

    if (knobs.nonJson) output.write("this is not json\n");
    if (knobs.longLine) output.write(`${"x".repeat(Number(knobs.longLine))}\n`);
    if (knobs.requestFs) {
      send({ jsonrpc: "2.0", id: nextRequestId++, method: "fs/read_text_file", params: { sessionId, path: "/etc/hosts" } });
      send({ jsonrpc: "2.0", id: nextRequestId++, method: "terminal/create", params: { sessionId, command: "ls" } });
      send({ jsonrpc: "2.0", id: nextRequestId++, method: "_x/y", params: {} });
      send({ jsonrpc: "2.0", method: "_x/n", params: {} });
    }
    if (knobs.unknownVariant) sendUpdate(sessionId, { sessionUpdate: "_querymt_hook_notice", x: 1 });

    const steps = knobs.permission ? fx.permissionTurn : fx.turn;
    let echoed = knobs.echoUser === "before" || knobs.echoUser === "none";
    let stopReason = fx.result?.stopReason ?? "end_turn";
    for (const step of steps) {
      if (cancelled) {
        stopReason = "cancelled";
        break;
      }
      await delay();
      if (step.update) {
        if (protocol === 1 && !echoed && echo) {
          sendUpdate(sessionId, echoUpdate);
          echoed = true;
        }
        sendUpdate(sessionId, step.update);
      } else if (step.permission) {
        const resp = await request("session/request_permission", { sessionId, ...step.permission });
        const outcome = resp?.result?.outcome;
        if (outcome?.outcome === "cancelled") cancelled = true;
      }
    }
    if (cancelled) stopReason = "cancelled";
    if (protocol === 2) sendUpdate(sessionId, { sessionUpdate: "state_update", state: "idle", stopReason });
    else send({ jsonrpc: "2.0", id: promptRpcId, result: { stopReason } });
  }

  function handle(msg) {
    received.push(msg);
    // Responses to our own requests (permission, …).
    if (msg.id !== undefined && msg.method === undefined) {
      pendingResponses.get(msg.id)?.(msg);
      pendingResponses.delete(msg.id);
      return;
    }
    if (withheld(msg.method)) return;
    switch (msg.method) {
      case "initialize":
        send({ jsonrpc: "2.0", id: msg.id, result: { ...fx.initialize, protocolVersion: knobs.initializeVersion ?? fx.initialize.protocolVersion } });
        break;
      case "session/new":
        send({ jsonrpc: "2.0", id: msg.id, result: { ...fx.sessionNew, sessionId } });
        break;
      case "session/prompt":
        runTurn(msg.params, msg.id).catch(() => {});
        break;
      case "session/cancel":
        cancelled = true;
        break;
      case "session/set_config_option": {
        const { configId, value } = msg.params ?? {};
        send({ jsonrpc: "2.0", id: msg.id, result: { configOptions: [] } });
        sendUpdate(sessionId, {
          sessionUpdate: "config_option_update",
          configOptions: (fx.sessionNew.configOptions ?? []).map((o) => (o.configId === configId ? { ...o, currentValue: value } : o)),
        });
        break;
      }
      default:
        if (msg.id !== undefined) send({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: `Method not found: ${msg.method}` } });
    }
  }

  const done = new Promise((resolveDone) => {
    input.on("data", (chunk) => {
      buf += chunk.toString("utf8");
      let nl = buf.indexOf("\n");
      while (nl >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        nl = buf.indexOf("\n");
        if (!line) continue;
        try {
          handle(JSON.parse(line));
        } catch {
          /* ignore malformed input */
        }
      }
    });
    input.on("end", resolveDone);
    input.on("close", resolveDone);
  });
  return { done, received };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const get = (name) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const protocol = get("--protocol") === "2" ? 2 : 1;
  const knobs = get("--knobs") ? JSON.parse(get("--knobs")) : {};
  const { done } = runFakeAgent({ input: process.stdin, output: process.stdout, protocol, knobs });
  done.then(() => process.exit(0)).catch(() => process.exit(1));
}
