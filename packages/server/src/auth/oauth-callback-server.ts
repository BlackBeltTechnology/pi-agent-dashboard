/**
 * Temporary HTTP callback server for OAuth authorization code flows.
 *
 * Each OAuth provider has a registered redirect URI on a specific localhost port/path.
 * This module spins up a short-lived server on that port to receive the callback,
 * then shuts down after the code is received or a timeout expires.
 */
import http from "node:http";

// ── Types ────────────────────────────────────────────────────────────────────

export interface CallbackServerOptions {
  /** Provider identifier (used to track active servers) */
  providerId: string;
  /** Port to listen on (must match the provider's registered redirect URI) */
  port: number;
  /** Path to handle (must match the provider's registered redirect URI) */
  path: string;
  /** Timeout in ms before auto-closing (default: 5 minutes) */
  timeoutMs?: number;
  /** Called when a valid authorization code is received */
  onCode: (code: string, state: string) => Promise<void>;
}

export interface CallbackServerHandle {
  /** Resolves when the server closes (after callback or timeout) */
  closed: Promise<void>;
  /** Manually close the server */
  close: () => Promise<void>;
}

// ── Active server tracking ───────────────────────────────────────────────────

const activeServers = new Map<string, CallbackServerHandle>();

// ── HTML templates ───────────────────────────────────────────────────────────

function successHtml(): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Authorization Successful</title>
<style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#0f172a;color:#e2e8f0;}
.card{background:#1e293b;padding:40px;border-radius:12px;text-align:center;max-width:400px;}
.ok{color:#22c55e;font-size:48px;margin-bottom:16px;}</style>
</head><body><div class="card"><div class="ok">✓</div><h2>Authorization successful</h2><p>You can close this tab and return to the dashboard.</p></div></body></html>`;
}

function errorHtml(message: string): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Authorization Failed</title>
<style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#0f172a;color:#e2e8f0;}
.card{background:#1e293b;padding:40px;border-radius:12px;text-align:center;max-width:400px;}
.err{color:#ef4444;font-size:48px;margin-bottom:16px;}</style>
</head><body><div class="card"><div class="err">✗</div><h2>Authorization failed</h2><p>${escapeHtml(message)}</p></div></body></html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Start a temporary callback server for an OAuth auth-code flow.
 * Closes any existing server for the same provider before starting.
 */
export async function startCallbackServer(opts: CallbackServerOptions): Promise<CallbackServerHandle> {
  const { providerId, port, path, timeoutMs = 5 * 60 * 1000, onCode } = opts;

  // Close any existing server for this provider
  const existing = activeServers.get(providerId);
  if (existing) {
    await existing.close();
  }

  let timeout: ReturnType<typeof setTimeout> | undefined;
  let resolveClose: () => void;

  const closed = new Promise<void>((resolve) => {
    resolveClose = resolve;
  });

  // Track open sockets so we can destroy them after server.close()
  const sockets = new Set<import("node:net").Socket>();

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || "", `http://localhost:${port}`);

    if (url.pathname !== path) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not Found");
      return;
    }

    // Schedule close after response is fully sent
    const closeAfterSend = (html: string) => {
      res.writeHead(200, { "Content-Type": "text/html", "Connection": "close" });
      res.end(html);
      // Small delay lets the client read the response before we destroy sockets
      res.on("finish", () => setTimeout(closeServer, 50));
    };

    const error = url.searchParams.get("error");
    const errorDesc = url.searchParams.get("error_description");

    if (error) {
      closeAfterSend(errorHtml(errorDesc || error));
      return;
    }

    const code = url.searchParams.get("code") || "";
    const state = url.searchParams.get("state") || "";

    try {
      await onCode(code, state);
      closeAfterSend(successHtml());
    } catch (err: any) {
      closeAfterSend(errorHtml(err.message || "Token exchange failed"));
    }
  });

  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });

  function closeServer() {
    if (timeout) clearTimeout(timeout);
    activeServers.delete(providerId);
    // Stop accepting new connections, then destroy remaining sockets
    server.close(() => resolveClose!());
    for (const socket of sockets) socket.destroy();
  }

  const handle: CallbackServerHandle = {
    closed,
    close: () => {
      return new Promise<void>((resolve) => {
        if (timeout) clearTimeout(timeout);
        activeServers.delete(providerId);
        server.close(() => {
          resolveClose!();
          resolve();
        });
      });
    },
  };

  // Start listening
  await new Promise<void>((resolve, reject) => {
    const onError = (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        reject(new Error(`Port ${port} is in use. Close any running login flow and try again.`));
      } else {
        reject(err);
      }
    };
    server.once("error", onError);
    server.listen(port, "127.0.0.1", () => {
      server.removeListener("error", onError);
      resolve();
    });
  });

  // Auto-close on timeout
  timeout = setTimeout(closeServer, timeoutMs);

  activeServers.set(providerId, handle);
  return handle;
}

/**
 * Close all active callback servers (for cleanup/shutdown).
 */
export async function closeAllCallbackServers(): Promise<void> {
  const handles = Array.from(activeServers.values());
  await Promise.all(handles.map((h) => h.close()));
}
