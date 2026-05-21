import { ensureHealthyBackend, getWsBase } from "./config";

type MessageHandler = (data: unknown) => void;

/**
 * Managed WebSocket connection with auto-reconnect + failover.
 * After 2 consecutive failures, runs a health check that may switch
 * the active backend, then reconnects against the (possibly new) base.
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
  let consecutiveFailures = 0;

  async function connect() {
    if (stopped) return;

    if (consecutiveFailures >= 2) {
      await ensureHealthyBackend();
    }

    ws = new WebSocket(`${getWsBase()}/ws/signals`);

    ws.onopen = () => {
      console.log("[WS] signals connected");
      consecutiveFailures = 0;
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
      consecutiveFailures += 1;
      if (!stopped) {
        const delay = consecutiveFailures >= 2 ? 1500 : 3000;
        if (consecutiveFailures >= 2) {
          console.log("[WS] signals — checking backend health before reconnect");
        }
        reconnectTimer = setTimeout(connect, delay);
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

export function connectCandlesWs(
  symbol: string,
  timeframe: string,
  onMessage: MessageHandler
): ManagedWs {
  let stopped = false;
  let ws: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let pingTimer: ReturnType<typeof setInterval> | null = null;
  let consecutiveFailures = 0;

  async function connect() {
    if (stopped) return;

    if (consecutiveFailures >= 2) {
      await ensureHealthyBackend();
    }

    ws = new WebSocket(
      `${getWsBase()}/ws/candles?symbol=${encodeURIComponent(symbol)}&timeframe=${timeframe}`
    );

    ws.onopen = () => {
      console.log(`[WS] candles ${symbol} ${timeframe} connected`);
      consecutiveFailures = 0;
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
      consecutiveFailures += 1;
      if (!stopped) {
        const delay = consecutiveFailures >= 2 ? 1500 : 3000;
        reconnectTimer = setTimeout(connect, delay);
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
