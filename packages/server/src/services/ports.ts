/**
 * Free loopback port allocation (D5): bind `127.0.0.1:0`, read the port,
 * close. There is a small close→bind race; a bind failure in the child
 * surfaces as a `failed` start retried with backoff.
 * See change: add-service-registry-core.
 */
import net from "node:net";

export type PortAllocator = () => Promise<number>;

export const allocateLoopbackPort: PortAllocator = () =>
  new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      srv.close(() => (port > 0 ? resolve(port) : reject(new Error("no port allocated"))));
    });
  });

/** `<protocol>://127.0.0.1:<port>` for an endpoint protocol (default http). */
export function loopbackEndpoint(protocol: string | undefined, port: number): string {
  return `${protocol ?? "http"}://127.0.0.1:${port}`;
}
