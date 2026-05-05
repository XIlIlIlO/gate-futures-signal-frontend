import { WS_BASE } from "./config";

type MessageHandler = (data: unknown) => void;

/**
 * Managed WebSocket connection with auto-reconnect.
 * Call .close() to permanently stop (no more reconnects).
 */
export interface ManagedWs {
  close(): void;
}

export function connectSignalsWs(onMessage: MessageHandler): ManagedWs {
  let stopped = false;
  let ws: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let pingTimer: ReturnType<typeof setInterval> | null = null;

  function connect() {
    if (stopped) return;

    ws = new WebSocket(`${WS_BASE}/ws/signals`);

    ws.onopen = () => {
      console.log("[WS] signals connected");
      // Keep-alive ping every 30s to prevent Railway/proxy timeouts
      pingTimer = setInterval(() => {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send("ping");
        }
      }, 30_000);
    };

    ws.onmessage = (e) => {
      try {
        onMessage(JSON.parse(e.data));
      } catch { /* ignore */ }
    };

    ws.onclose = () => {
      console.log("[WS] signals closed");
      cleanup();
      if (!stopped) {
        console.log("[WS] signals reconnecting in 3s...");
        reconnectTimer = setTimeout(connect, 3000);
      }
    };

    ws.onerror = () => {
      ws?.close();
    };
  }

  function cleanup() {
    if (pingTimer) {
      clearInterval(pingTimer);
      pingTimer = null;
    }
  }

  connect();

  return {
    close() {
      stopped = true;
      cleanup();
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      if (ws) {
        ws.onclose = null; // prevent reconnect trigger
        ws.close();
        ws = null;
      }
    },
  };
}

export function connectCandlesWs(
  symbol: string,
  timeframe: string,
  onMessage: MessageHandler
): ManagedWs {
  let stopped = false;
  let ws: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let pingTimer: ReturnType<typeof setInterval> | null = null;

  function connect() {
    if (stopped) return;

    ws = new WebSocket(
      `${WS_BASE}/ws/candles?symbol=${encodeURIComponent(symbol)}&timeframe=${timeframe}`
    );

    ws.onopen = () => {
      console.log(`[WS] candles ${symbol} ${timeframe} connected`);
      pingTimer = setInterval(() => {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send("ping");
        }
      }, 30_000);
    };

    ws.onmessage = (e) => {
      try {
        onMessage(JSON.parse(e.data));
      } catch { /* ignore */ }
    };

    ws.onclose = () => {
      console.log(`[WS] candles ${symbol} closed`);
      cleanup();
      if (!stopped) {
        reconnectTimer = setTimeout(connect, 3000);
      }
    };

    ws.onerror = () => {
      ws?.close();
    };
  }

  function cleanup() {
    if (pingTimer) {
      clearInterval(pingTimer);
      pingTimer = null;
    }
  }

  connect();

  return {
    close() {
      stopped = true;
      cleanup();
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      if (ws) {
        ws.onclose = null;
        ws.close();
        ws = null;
      }
    },
  };
}
