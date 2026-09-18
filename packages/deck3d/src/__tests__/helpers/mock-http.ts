/**
 * In-test HTTP server (9b.5). Routes are replaced wholesale via `set`.
 */
import { createServer, type Server } from "node:http";

export interface MockRoute {
  status?: number;
  body: Buffer | string;
  contentType?: string;
  delayMs?: number;
}

export interface MockServer {
  url: string;
  set: (route: MockRoute | (() => MockRoute)) => void;
  close: () => Promise<void>;
}

export async function startMockServer(initial: MockRoute = { body: "" }): Promise<MockServer> {
  let handler: () => MockRoute = () => initial;
  const server: Server = createServer((_req, res) => {
    const route = handler();
    const send = (): void => {
      res.statusCode = route.status ?? 200;
      if (route.contentType) res.setHeader("content-type", route.contentType);
      res.end(route.body);
    };
    if (route.delayMs) setTimeout(send, route.delayMs);
    else send();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return {
    url: `http://127.0.0.1:${port}`,
    set: (route) => {
      handler = typeof route === "function" ? route : () => route;
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/** A GLB-shaped body of exactly `size` bytes (header magic + padding). */
export function glbOfSize(size: number): Buffer {
  const buf = Buffer.alloc(size);
  buf.write("glTF", 0, "latin1");
  return buf;
}
