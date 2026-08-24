/**
 * Parsing what a user typed after `/dashboard connect` (task 9.5).
 *
 * The argument is deliberately overloaded — a socket path, a port, an instance
 * identity, or `default` — because the user's mental model is "that dashboard
 * over there", not "a ws:// URL". Resolution then runs through the SAME D3
 * ladder as startup, so a hand-typed target and a resolved one cannot disagree.
 *
 * Parsing is separated from resolution: this module decides only what KIND of
 * thing was named. It touches no filesystem and no network, so the ambiguous
 * cases are settled by shape alone and are trivially testable.
 *
 * See change: add-pi-gateway-transport-identity (D11, task 9.5).
 */

import {
  type LocalInstance,
  resolveInstanceRef,
} from "@blackbelt-technology/pi-dashboard-shared/instance-directory.js";

export type ConnectTarget =
  /** `default` / empty — whatever the $HOME rendezvous record names (ladder rung 4). */
  | { kind: "default" }
  /** An explicit unix socket path. */
  | { kind: "socket"; path: string }
  /** A bare port number, dialled on loopback — never on a wildcard address. */
  | { kind: "port"; port: number }
  /** A full ws:// or wss:// endpoint. */
  | { kind: "url"; url: string }
  /** An instance identity, resolved against visible rendezvous records. */
  | { kind: "instance"; id: string }
  | { kind: "invalid"; reason: string };

/** Ports below 1024 are privileged and never a dashboard; 0 is not dialable. */
const MIN_PORT = 1024;
const MAX_PORT = 65_535;

export function parseConnectTarget(raw: string): ConnectTarget {
  const arg = raw.trim();

  if (arg === "" || arg === "default") return { kind: "default" };

  if (arg.startsWith("ws://") || arg.startsWith("wss://") || arg.startsWith("ws+unix:")) {
    return { kind: "url", url: arg };
  }

  // A socket is recognised by SHAPE, not by existence: reporting "no such
  // instance" for a mistyped path would send the user looking in the wrong
  // place entirely.
  if (arg.startsWith("/") || arg.startsWith("./") || arg.startsWith("~/") || arg.endsWith(".sock")) {
    return { kind: "socket", path: arg };
  }

  if (/^\d+$/.test(arg)) {
    const port = Number(arg);
    if (port < MIN_PORT || port > MAX_PORT) {
      return { kind: "invalid", reason: `port ${arg} is out of range (${MIN_PORT}-${MAX_PORT})` };
    }
    return { kind: "port", port };
  }

  // Anything else is taken as an instance identity. Left permissive on purpose:
  // the id format is the server's to define, and pinning a shape here would
  // start rejecting valid ids the day it changes.
  return { kind: "instance", id: arg };
}

/** How a parsed target is rendered back to the user in confirmations and errors. */
export function describeConnectTarget(t: ConnectTarget): string {
  switch (t.kind) {
    case "default":
      return "the default dashboard for this HOME";
    case "socket":
      return `socket ${t.path}`;
    case "port":
      return `127.0.0.1:${t.port}`;
    case "url":
      return t.url;
    case "instance":
      return `instance ${t.id}`;
    case "invalid":
      return `invalid target (${t.reason})`;
  }
}

/**
 * Turn a parsed target into a dialable endpoint (task 9.5).
 *
 * Resolution runs through the same primitives as startup — the rendezvous
 * record for `default`, the config dir for instances — so a hand-typed target
 * and a resolved one can never disagree about where a dashboard lives.
 */
export function resolveConnectTarget(
  target: ConnectTarget,
  deps: {
    defaultEndpoint: () => string | null;
    instances: () => LocalInstance[];
  },
): { ok: true; endpoint: string; instanceId?: string } | { ok: false; reason: string } {
  switch (target.kind) {
    case "invalid":
      return { ok: false, reason: target.reason };

    case "default": {
      const endpoint = deps.defaultEndpoint();
      // Absence means "no local dashboard", never "go look on the network"
      // (D0): a failed resolve must not fall through to discovery.
      return endpoint
        ? { ok: true, endpoint }
        : { ok: false, reason: "no default dashboard is registered under this HOME" };
    }

    case "socket":
      return { ok: true, endpoint: `ws+unix://${target.path}:/` };

    case "port":
      // Loopback, never the configured host: a bare port is a local shorthand.
      return { ok: true, endpoint: `ws://127.0.0.1:${target.port}` };

    case "url":
      return { ok: true, endpoint: target.url };

    case "instance": {
      const found = resolveInstanceRef(target.id, deps.instances());
      return found.ok
        ? { ok: true, endpoint: found.instance.endpoint, instanceId: found.instance.instanceId }
        : { ok: false, reason: found.reason };
    }
  }
}
