import { memo } from "react";
import type { Signal } from "../api/types";

function formatTime(ts: number) {
  const d = new Date(ts * 1000);
  return d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function formatDate(ts: number) {
  const d = new Date(ts * 1000);
  return d.toLocaleDateString("ko-KR", { month: "2-digit", day: "2-digit" });
}

function relativeTimeMs(ms: number): string {
  const diffSec = Math.floor((Date.now() - ms) / 1000);
  if (diffSec < 60) return "방금";
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}분 전`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}시간 전`;
  return `${Math.floor(diffSec / 86400)}일 전`;
}

const TF_SECONDS: Record<string, number> = {
  "1m": 60, "3m": 180, "5m": 300, "15m": 900, "30m": 1800, "1h": 3600,
};

export function isRealtimeCandle(signalTime: number, timeframe: string): boolean {
  const period = TF_SECONDS[timeframe] ?? 60;
  const now = Math.floor(Date.now() / 1000);
  const currentBucketStart = Math.floor(now / period) * period;
  const signalBucket = Math.floor(signalTime / period) * period;

  if (timeframe === "1m") {
    return signalBucket >= currentBucketStart - period;
  }
  return signalBucket === currentBucketStart;
}

/** Includes previous bucket too (fallback when current bucket has no signals) */
export function isRealtimeOrPrevCandle(signalTime: number, timeframe: string): boolean {
  const period = TF_SECONDS[timeframe] ?? 60;
  const now = Math.floor(Date.now() / 1000);
  const currentBucketStart = Math.floor(now / period) * period;
  const signalBucket = Math.floor(signalTime / period) * period;
  return signalBucket >= currentBucketStart - period;
}

interface EnrichedSignal extends Signal {
  _receivedAt?: number;
  _isLive?: boolean;
}

interface Props {
  signal: EnrichedSignal;
  onClick?: (signal: Signal) => void;
  compact?: boolean;
  tick?: number; // passed from parent to trigger re-render
}

function SignalBadge({ signal, onClick, compact }: Props) {
  const isBuy = signal.type === "BUY";
  const isRealtime = isRealtimeCandle(signal.time, signal.timeframe);
  const isNew = signal._isLive && isRealtime;
  const isFaded = !isRealtime;

  return (
    <div
      className={`signal-badge ${isBuy ? "buy" : "sell"} ${isFaded ? "faded" : ""}`}
      onClick={() => onClick?.(signal)}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      <div className="signal-badge-header">
        <span className="signal-type">
          {isBuy ? "▲ BUY" : "▼ SELL"}
          {isNew && <span className="signal-new">NEW</span>}
        </span>
        <span className="signal-age">{isRealtime ? "실시간 봉" : relativeTimeMs(signal.time * 1000)}</span>
      </div>
      <div className="signal-badge-body">
        <span className="signal-symbol">{signal.symbol.replace("_", "/")}</span>
        <span className="signal-tf">{signal.timeframe}</span>
        <span className="signal-score">스코어 {signal.score}</span>
        <span className="signal-price">${signal.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })}</span>
      </div>
      {!compact && (
        <div className="signal-badge-footer">
          <span className="signal-time">{formatDate(signal.time)} {formatTime(signal.time)}</span>
          <span className="signal-reason">{signal.reason}</span>
        </div>
      )}
    </div>
  );
}

export default memo(SignalBadge);
