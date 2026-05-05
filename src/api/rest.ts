import { API_BASE } from "./config";
import type {
  CandlesResponse,
  SignalsResponse,
  SymbolsResponse,
  StatusResponse,
  Timeframe,
} from "./types";

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) throw new Error(`API ${res.status}: ${res.statusText}`);
  return res.json();
}

export function fetchSymbols(): Promise<SymbolsResponse> {
  return get("/api/symbols");
}

export function fetchStatus(): Promise<StatusResponse> {
  return get("/api/status");
}

const CANDLE_LIMITS: Record<Timeframe, number> = {
  "1m": 2000, "3m": 666, "5m": 400, "15m": 133, "30m": 66, "1h": 33,
};

export function fetchCandles(
  symbol: string,
  timeframe: Timeframe,
  limit?: number
): Promise<CandlesResponse> {
  const l = limit ?? CANDLE_LIMITS[timeframe] ?? 300;
  return get(
    `/api/candles?symbol=${encodeURIComponent(symbol)}&timeframe=${timeframe}&limit=${l}`
  );
}

export function fetchRecentSignals(
  timeframe: string = "all",
  limit = 200
): Promise<SignalsResponse> {
  return get(
    `/api/signals/recent?timeframe=${timeframe}&limit=${limit}`
  );
}

export function fetchSignalsBySymbol(
  symbol: string,
  timeframe: Timeframe,
  limit = 200
): Promise<{ symbol: string; timeframe: string; count: number; signals: import("./types").Signal[] }> {
  return get(
    `/api/signals/by-symbol?symbol=${encodeURIComponent(symbol)}&timeframe=${timeframe}&limit=${limit}`
  );
}
