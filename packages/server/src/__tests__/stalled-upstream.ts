/**
 * Stalled-upstream test fixture (test-plan P1 / task 4.6): a TCP server that
 * ACCEPTS the connection and never responds — no read, no write, no close.
 *
 * Deliberately DISTINCT from the refused-connection fixture used by
 * `provider-probe.test.ts` (a mocked `fetch` that throws ECONNREFUSED): a
 * refusal fails the probe in microseconds, while a stall holds the socket open
 * until the probe's abort ceiling. Only a real listener exercises the stall
 * path through the real network stack, which is what the "PATCH does not wait
 * on the probe" guarantee (P1 < 300 ms p95) has to survive.
 *
 * Lives beside the probe tests; imported by the single-provider PATCH suites.
 * Not named `*.test.ts`, so vitest does not collect it.
 */
import net from "node:net";

export interface StalledUpstream {
  port: number;
  /** A baseUrl pointing at the stalled listener. */
  url: string;
  /** Sockets currently held open (0 once all probes have aborted). */
  heldSockets(): number;
  /** Destroy every held socket and close the listener; releases pending probes. */
  close(): Promise<void>;
}

export async function startStalledUpstream(): Promise<StalledUpstream> {
  const sockets = new Set<net.Socket>();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    // Never read, never write: the accepted connection just sits there.
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as net.AddressInfo;
  return {
    port: address.port,
    url: `http://127.0.0.1:${address.port}/v1`,
    heldSockets: () => sockets.size,
    close: () =>
      new Promise<void>((resolve) => {
        for (const s of sockets) s.destroy();
        server.close(() => resolve());
      }),
  };
}
