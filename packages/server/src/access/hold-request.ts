/**
 * Suspend an HTTP request while its denial awaits a verdict (design D7, task 6.3).
 *
 * Transport, in the shape of `git-routes.ts` `/api/git/worktree/init`: capture the
 * socket's timeout, disable it for the hold, and restore it once the response
 * flushes, so a keep-alive socket never carries an infinite timeout into the next
 * request. The hold ceiling is the registry TTL (120 s), not a second timer here.
 *
 * Client abort is detected on the RESPONSE: `reply.raw` `close` while
 * `!writableFinished`. D7 names `request.raw.once("close")`, but on current Node
 * an `IncomingMessage` emits `close` as soon as its body has been consumed, which
 * Fastify does before the handler runs. Measured on Node v24: on an ordinary
 * request `request.raw` closed BEFORE the handler returned, with the response
 * unfinished, so the literal D7 listener would have aborted every held request at
 * once. `reply.raw` `close` fires with `writableFinished === true` on a normal
 * finish and `false` on a client abort, which is the distinction needed.
 *
 * See change: add-access-grant-dialog.
 */
import type { FastifyReply, FastifyRequest } from "fastify";
import type { Hold, Resolution } from "./grant-coordinator.js";

/** Wait out a hold, keeping the connection alive and releasing it on abort. */
export async function awaitHold(
  request: Pick<FastifyRequest, "raw">,
  reply: Pick<FastifyReply, "raw">,
  hold: Hold,
): Promise<Resolution> {
  if (!hold.held) return hold.result;

  const socket = request.raw.socket;
  const prevTimeout = typeof socket?.timeout === "number" ? socket.timeout : undefined;
  socket?.setTimeout?.(0);
  if (typeof prevTimeout === "number") {
    reply.raw.once("finish", () => {
      if (socket && !socket.destroyed) socket.setTimeout(prevTimeout);
    });
  }

  const onClose = (): void => {
    if (!reply.raw.writableFinished) hold.abort();
  };
  reply.raw.once("close", onClose);
  try {
    return await hold.result;
  } finally {
    reply.raw.removeListener("close", onClose);
  }
}
