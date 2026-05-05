import { useEffect, useRef, useState } from "react";
import type { Signal, Timeframe } from "../api/types";
import { fetchRecentSignals } from "../api/rest";
import { connectSignalsWs, type ManagedWs } from "../api/ws";
import SignalBadge, { isRealtimeCandle, isRealtimeOrPrevCandle } from "./SignalBadge";
import TimeframeSelector from "./TimeframeSelector";

interface Props {
  onSignalClick?: (signal: Signal) => void;
}

interface EnrichedSignal extends Signal {
  _receivedAt: number;
  _isLive: boolean;
}

function enrichSignal(sig: Signal, isLive: boolean): EnrichedSignal {
  return { ...sig, _receivedAt: Date.now(), _isLive: isLive };
}

const ALL_TF = ["1m", "3m", "5m", "15m", "30m", "1h"];
const PER_TF_LIMIT = 80;

/** Keep at most 80 signals per timeframe, deduplicated by ID, sorted newest first */
function capPerTimeframe(signals: EnrichedSignal[]): EnrichedSignal[] {
  const seen = new Set<string>();
  const buckets: Record<string, EnrichedSignal[]> = {};
  for (const tf of ALL_TF) buckets[tf] = [];

  for (const s of signals) {
    if (seen.has(s.id)) continue;
    seen.add(s.id);
    const b = buckets[s.timeframe];
    if (b && b.length < PER_TF_LIMIT) b.push(s);
  }

  const result: EnrichedSignal[] = [];
  for (const tf of ALL_TF) result.push(...buckets[tf]);
  result.sort((a, b) => b.time - a.time);
  return result;
}

export default function SignalFeed({ onSignalClick }: Props) {
  const [signals, setSignals] = useState<EnrichedSignal[]>([]);
  const [filter, setFilter] = useState<Timeframe | "all">("all");
  const wsRef = useRef<ManagedWs | null>(null);

  useEffect(() => {
    wsRef.current = connectSignalsWs((msg: unknown) => {
      const data = msg as { event: string; data: Signal | Signal[] };

      if (data.event === "snapshot" && Array.isArray(data.data)) {
        const snapshotSignals = data.data.map((s) => enrichSignal(s, false));

        // Replace with snapshot (not merge) so deleted signals disappear
        setSignals(() => {
          snapshotSignals.sort((a, b) => b.time - a.time);
          return capPerTimeframe(snapshotSignals);
        });
      } else if (data.event === "signal" && data.data && !Array.isArray(data.data)) {
        const live = enrichSignal(data.data, true);
        setSignals((prev) => {
          if (prev.some((s) => s.id === live.id)) return prev;
          const updated = [live, ...prev];
          updated.sort((a, b) => b.time - a.time);
          return capPerTimeframe(updated);
        });
      }
    });
    return () => {
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, []);

  // Periodically sync with backend to remove deleted signals
  useEffect(() => {
    const iv = setInterval(() => {
      Promise.all(
        ALL_TF.map((tf) => fetchRecentSignals(tf, 400))
      ).then((results) => {
        const all: EnrichedSignal[] = [];
        results.forEach((res) => {
          res.signals.forEach((s) => all.push(enrichSignal(s, false)));
        });
        all.sort((a, b) => b.time - a.time);
        setSignals(capPerTimeframe(all));
      }).catch(() => {});
    }, 30_000);
    return () => clearInterval(iv);
  }, []);

  // Single shared timer for relative time updates (instead of per-badge)
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const iv = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(iv);
  }, []);

  // Per-timeframe: if current bucket has signals → show current only
  // If current bucket is empty → fallback to include previous bucket (no gap on transition)
  const realtime = (() => {
    const hasCurrentBucket = new Set<string>();
    for (const s of signals) {
      if (isRealtimeCandle(s.time, s.timeframe)) {
        hasCurrentBucket.add(s.timeframe);
      }
    }
    return signals.filter((s) =>
      hasCurrentBucket.has(s.timeframe)
        ? isRealtimeCandle(s.time, s.timeframe)
        : isRealtimeOrPrevCandle(s.time, s.timeframe)
    );
  })();
  const filtered = filter === "all"
    ? realtime
    : realtime.filter((s) => s.timeframe === filter);

  return (
    <div className="signal-feed">
      <div className="feed-header">
        <h2>실시간 시그널</h2>
        <span className="feed-count">{filtered.length}개</span>
      </div>
      <TimeframeSelector selected={filter} onChange={setFilter} />
      <div className="feed-list">
        {filtered.length === 0 && (
          <div className="feed-empty">시그널 대기중...</div>
        )}
        {filtered.map((sig) => (
          <SignalBadge key={sig.id} signal={sig} onClick={onSignalClick} tick={tick} />
        ))}
      </div>
    </div>
  );
}
