import { mdiClose } from "@mdi/js";
import { Icon } from "@mdi/react";
import { AttachAddon } from "@xterm/addon-attach";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import React, { useCallback, useEffect, useRef } from "react";
import "@xterm/xterm/css/xterm.css";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { appendWsTicket, getApiBearer, mintWsTicket } from "../../lib/pairing/device-auth.js";

function getTerminalTheme(): Record<string, string> {
  const style = getComputedStyle(document.documentElement);
  const get = (name: string) => style.getPropertyValue(name).trim();
  return {
    background: get("--bg-primary") || "#0a0a0a",
    foreground: get("--text-primary") || "#e5e5e5",
    cursor: get("--text-primary") || "#e5e5e5",
    cursorAccent: get("--bg-primary") || "#0a0a0a",
    selectionBackground: get("--bg-surface") || "#2a2a2a",
    selectionForeground: get("--text-primary") || "#e5e5e5",
  };
}

interface Props {
  terminalId: string;
  visible: boolean;
  onTitle?: (terminalId: string, title: string) => void;
  onClose?: (terminalId: string) => void;
  terminalName?: string;
  /**
   * Fixed pixel height for inline (chat-stream) use. When set, the root takes
   * an explicit height instead of `flex-1` (which assumes a flex-column
   * parent and caused the half-height bug — see fix-terminal-half-height-dual-mount).
   * Omit for the content-area TerminalsView fill behavior.
   * See change: add-inline-terminal-card.
   */
  heightPx?: number;
}

export function TerminalView({ terminalId, visible, onTitle, onClose, terminalName, heightPx }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const attachRef = useRef<AttachAddon | null>(null);

  // Initialize terminal and WebSocket
  useEffect(() => {
    if (!containerRef.current) return;

    const terminal = new Terminal({
      scrollback: 10000,
      fontSize: 13,
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Menlo, Monaco, monospace",
      theme: getTerminalTheme(),
      // No cursor blink — avoids a recurring per-second repaint while a terminal
      // tab is open and idle. Matches InlineTerminalCard. See change:
      // throttle-idle-ui-animations.
      cursorBlink: false,
      allowProposedApi: true,
    });

    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);

    terminal.open(containerRef.current);

    // Connect WebSocket. While identity is enforced the host requires a
    // principal-bearing single-use ticket for the terminal scope too (18.13), so
    // an in-memory bearer ⇒ mint one first. No bearer (inert / cookie / loopback)
    // ⇒ connect synchronously, exactly as before.
    const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsPort = window.location.port ? `:${window.location.port}` : "";
    const wsUrl = `${wsProtocol}//${window.location.hostname}${wsPort}/ws/terminal/${terminalId}`;
    let cancelled = false;
    let ws = null as WebSocket | null;

    const connect = (url: string) => {
      if (cancelled) return;
      const sock = new WebSocket(url);
      ws = sock;
      sock.binaryType = "arraybuffer";

      sock.addEventListener("open", () => {
        const attachAddon = new AttachAddon(sock);
        terminal.loadAddon(attachAddon);
        attachRef.current = attachAddon;

        // Initial fit after connection
        try {
          fitAddon.fit();
          // Send initial resize
          const dims = { type: "resize", cols: terminal.cols, rows: terminal.rows };
          sock.send(JSON.stringify(dims));
        } catch {}
      });

      sock.addEventListener("close", () => {
        terminal.write("\r\n\x1b[90m[Terminal disconnected]\x1b[0m\r\n");
      });
      wsRef.current = sock;
    };

    if (getApiBearer()) {
      void mintWsTicket("terminal").then((ticket) => connect(ticket ? appendWsTicket(wsUrl, ticket) : wsUrl));
    } else {
      connect(wsUrl);
    }

    // Title change listener
    terminal.onTitleChange((title) => {
      onTitle?.(terminalId, title);
    });

    termRef.current = terminal;
    fitRef.current = fitAddon;

    return () => {
      cancelled = true;
      attachRef.current?.dispose();
      ws?.close();
      terminal.dispose();
      termRef.current = null;
      fitRef.current = null;
      wsRef.current = null;
      attachRef.current = null;
    };
  }, [terminalId]); // Only re-create on ID change

  // Resize handling
  useEffect(() => {
    if (!visible || !containerRef.current) return;

    const fit = () => {
      try {
        fitRef.current?.fit();
        const term = termRef.current;
        const ws = wsRef.current;
        if (term && ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
        }
      } catch {}
    };

    // Fit on visibility change
    requestAnimationFrame(fit);

    const observer = new ResizeObserver(() => {
      requestAnimationFrame(fit);
    });
    observer.observe(containerRef.current);

    return () => observer.disconnect();
  }, [visible]);

  // Theme sync
  useEffect(() => {
    const observer = new MutationObserver(() => {
      if (termRef.current) {
        termRef.current.options.theme = getTerminalTheme();
      }
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => observer.disconnect();
  }, []);

  // Focus terminal when visible
  useEffect(() => {
    if (visible) {
      requestAnimationFrame(() => termRef.current?.focus());
    }
  }, [visible]);

  const handleClose = useCallback(() => {
    onClose?.(terminalId);
  }, [terminalId, onClose]);

  const bounded = typeof heightPx === "number";
  return (
    <div
      style={{ display: visible ? "flex" : "none", ...(bounded ? { height: heightPx } : {}) }}
      className={bounded ? "flex flex-col" : "flex-1 flex flex-col min-h-0"}
    >
      {/* Minimal terminal header */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-[var(--border-primary)] bg-[var(--bg-secondary)]">
        <div className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
          <span className="text-cyan-500 font-mono text-xs">&gt;_</span>
          <span className="truncate">{terminalName || terminalId}</span>
        </div>
        <button
          onClick={handleClose}
          className="text-[var(--text-tertiary)] hover:text-red-400 transition-colors px-1"
          title={i18nT("terminal.closeTerminalSigterm", undefined, "Close terminal (SIGTERM)")}
        >
          <Icon path={mdiClose} size={0.6} />
        </button>
      </div>
      {/* xterm.js container */}
      <div
        ref={containerRef}
        className="flex-1 min-h-0"
        style={{ padding: "4px" }}
      />
    </div>
  );
}
