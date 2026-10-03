import type { Config } from "./config";
import { HTTP_STATUS, OrderError } from "./errors";
import { approveOrder, cancelOrder, createOrder, getOrder, shipOrder, submitOrder } from "./orders";
import { totalFor } from "./pricing";

export interface Request {
  params: Record<string, string>;
  body: unknown;
}

export interface Response {
  status: number;
  body: unknown;
}

type Handler = (req: Request, config: Config) => unknown;

// Framework-free route table: [method, path, handler].
export const ROUTES: [string, string, Handler][] = [
  ["POST", "/orders", (req) => createOrder(req.body as never)],
  ["GET", "/orders/:id", (req) => ({ ...getOrder(req.params.id), total: totalFor(getOrder(req.params.id)) })],
  ["POST", "/orders/:id/submit", (req, config) => submitOrder(req.params.id, config)],
  ["POST", "/orders/:id/approve", (req) => approveOrder(req.params.id)],
  ["POST", "/orders/:id/ship", (req) => shipOrder(req.params.id)],
  ["POST", "/orders/:id/cancel", (req) => cancelOrder(req.params.id)],
];

export function handle(handler: Handler, req: Request, config: Config): Response {
  try {
    return { status: 200, body: handler(req, config) };
  } catch (err) {
    if (err instanceof OrderError) return { status: HTTP_STATUS[err.code], body: { code: err.code, message: err.message } };
    return { status: 500, body: { code: "INTERNAL", message: "internal error" } };
  }
}
