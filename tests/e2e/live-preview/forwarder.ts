import http from "node:http";
import net from "node:net";

/**
 * Port forwarders standing in for `ssh -L` / a reverse proxy, for the live-preview specs.
 *
 * - `startTcpForwarder`: a raw byte pipe (what `ssh -L` does): the dashboard sees a loopback peer and NO headers.
 * - `startHeaderForwarder`: an HTTP proxy that ADDS headers (e.g. `X-Forwarded-For`) — a reverse proxy in front.
 *   (HTTP/1.1 only; WebSocket upgrades are not relayed — specs using it send plain requests.)
 */
export interface Forwarder {
  /** Listening port. */
  port: number;
  close(): Promise<void>;
}

const listen = (server: net.Server, host: string, port: number): Promise<number> =>
  new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve((server.address() as net.AddressInfo).port));
  });

export async function startTcpForwarder(opts: { listenHost?: string; listenPort?: number; targetPort: number; targetHost?: string }): Promise<Forwarder> {
  const sockets = new Set<net.Socket>();
  const server = net.createServer((client) => {
    const upstream = net.connect(opts.targetPort, opts.targetHost ?? "127.0.0.1");
    for (const s of [client, upstream]) {
      sockets.add(s);
      s.on("close", () => sockets.delete(s));
      s.on("error", () => s.destroy());
    }
    client.pipe(upstream);
    upstream.pipe(client);
  });
  const port = await listen(server, opts.listenHost ?? "127.0.0.1", opts.listenPort ?? 0);
  return {
    port,
    close: () =>
      new Promise((resolve) => {
        for (const s of sockets) s.destroy();
        server.close(() => resolve());
      }),
  };
}

export async function startHeaderForwarder(opts: { listenHost?: string; targetPort: number; addHeaders: Record<string, string> }): Promise<Forwarder> {
  const server = http.createServer((req, res) => {
    const up = http.request({ host: "127.0.0.1", port: opts.targetPort, method: req.method, path: req.url, headers: { ...req.headers, ...opts.addHeaders } }, (r) => {
      res.writeHead(r.statusCode ?? 502, r.headers);
      r.pipe(res);
    });
    up.on("error", () => {
      res.writeHead(502).end();
    });
    req.pipe(up);
  });
  const port = await listen(server, opts.listenHost ?? "127.0.0.1", 0);
  return {
    port,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
