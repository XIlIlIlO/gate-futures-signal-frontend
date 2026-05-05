export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  contract_volume: number;
}

export interface Signal {
  id: string;
  symbol: string;
  timeframe: string;
  time: number;
  price: number;
  type: "BUY" | "SELL";
  score: number;
  reason: string;
  marker_position: "aboveBar" | "belowBar";
  marker_shape: "arrowUp" | "arrowDown";
}

export interface CandlesResponse {
  market: string;
  symbol: string;
  timeframe: string;
  candles: Candle[];
  signals: Signal[];
}

export interface SignalsResponse {
  count: number;
  signals: Signal[];
}

export interface SymbolsResponse {
  market: string;
  settle: string;
  count: number;
  symbols: string[];
}

export interface StatusResponse {
  ok: boolean;
  market: string;
  symbols_loaded: number;
  timeframes: string[];
  recent_signals: number;
  scanner_running: boolean;
  current_phase: string;
  last_scan_started_at: number | null;
  last_scan_finished_at: number | null;
}

export type Timeframe = "1m" | "3m" | "5m" | "15m" | "30m" | "1h";
