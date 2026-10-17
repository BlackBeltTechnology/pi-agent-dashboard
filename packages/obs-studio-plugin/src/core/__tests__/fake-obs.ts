/**
 * Fake obs-websocket v5 server (JSON protocol) for L1 tests: Hello/Identify with
 * the real auth challenge, scripted request handlers, frame recording, and
 * delay/withhold fault injection. Package-local test infra (test-plan "New infra").
 * See change: add-obs-studio-plugin.
 */
import { createHash } from "node:crypto";
import type { AddressInfo } from "node:net";
import { WebSocketServer } from "ws";

export type HandlerResult = Record<string, unknown> | { __error: number; comment?: string } | "never";
export type Handler = (data: Record<string, unknown>) => HandlerResult | Promise<HandlerResult>;

export interface FakeObsOptions {
  password?: string;
  /** Accept the TCP connection but never send Hello. */
  withholdHello?: boolean;
  /** Request handlers by request type. `GetVersion` is answered by default. */
  handlers?: Record<string, Handler>;
  /** Override `availableRequests` (default: every handler key + GetVersion). */
  availableRequests?: string[];
  obsVersion?: string;
}

export interface FakeObs {
  url: string;
  port: number;
  /** Every request received after Identify (GetVersion included). */
  frames: Array<{ type: string; data: Record<string, unknown> }>;
  /** Request types received, GetVersion excluded. */
  types(): string[];
  close(): Promise<void>;
}

const b64sha = (s: string) => createHash("sha256").update(s).digest("base64");

export const err = (code: number, comment = "error"): HandlerResult => ({ __error: code, comment });

export async function startFakeObs(opts: FakeObsOptions = {}): Promise<FakeObs> {
  const wss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  await new Promise<void>((r) => wss.once("listening", () => r()));
  const port = (wss.address() as AddressInfo).port;
  const frames: FakeObs["frames"] = [];
  const handlers = opts.handlers ?? {};

  wss.on("connection", (sock) => {
    const salt = "saltsalt";
    const challenge = "challenge123";
    if (!opts.withholdHello) {
      sock.send(
        JSON.stringify({
          op: 0,
          d: {
            obsWebSocketVersion: "5.7.4",
            rpcVersion: 1,
            ...(opts.password !== undefined ? { authentication: { salt, challenge } } : {}),
          },
        }),
      );
    }
    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: fake server protocol handler: one branch per obs-websocket opcode
    sock.on("message", async (buf) => {
      const msg = JSON.parse(String(buf)) as { op: number; d: Record<string, unknown> };
      if (msg.op === 1) {
        if (opts.password !== undefined) {
          const expected = b64sha(b64sha(opts.password + salt) + challenge);
          if (msg.d.authentication !== expected) {
            sock.close(4009, "Authentication failed.");
            return;
          }
        }
        sock.send(JSON.stringify({ op: 2, d: { negotiatedRpcVersion: 1 } }));
        return;
      }
      if (msg.op !== 6) return;
      const { requestType, requestId } = msg.d as { requestType: string; requestId: string };
      const data = (msg.d.requestData ?? {}) as Record<string, unknown>;
      frames.push({ type: requestType, data });
      let result: HandlerResult;
      if (requestType === "GetVersion" && !handlers.GetVersion) {
        result = {
          obsVersion: opts.obsVersion ?? "32.2.2",
          obsWebSocketVersion: "5.7.4",
          availableRequests: opts.availableRequests ?? ["GetVersion", ...Object.keys(handlers)],
        };
      } else if (handlers[requestType]) {
        result = await handlers[requestType](data);
      } else {
        result = err(204, "Your request type is not valid.");
      }
      if (result === "never") return;
      const isErr = typeof result === "object" && "__error" in result;
      sock.send(
        JSON.stringify({
          op: 7,
          d: {
            requestType,
            requestId,
            requestStatus: isErr ? { result: false, code: (result as { __error: number }).__error, comment: (result as { comment?: string }).comment } : { result: true, code: 100 },
            ...(isErr ? {} : { responseData: result }),
          },
        }),
      );
    });
  });

  return {
    url: `ws://127.0.0.1:${port}`,
    port,
    frames,
    types: () => frames.map((f) => f.type).filter((t) => t !== "GetVersion"),
    close: () =>
      new Promise<void>((r) => {
        for (const c of wss.clients) c.terminate();
        wss.close(() => r());
      }),
  };
}
