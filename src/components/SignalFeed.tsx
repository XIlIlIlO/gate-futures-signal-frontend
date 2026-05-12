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
  /** ms timestamp set ONLY on genuine NEW events (added / type flip).
   * Used by SignalBadge to time-fade the NEW badge. 0 = never marked new. */
  _receivedAt: number;
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

/**
 * Upsert by id:
 *   - If id not in prev → prepend (truly new).
 *   - If id in prev and `moveToTop` → remove old, prepend (treated as new event).
 *   - If id in prev and !moveToTop → replace in place (preserve position).
 * Then re-sort by time desc and cap.
 */
function upsertSignal(
  prev: EnrichedSignal[],
  next: EnrichedSignal,
  moveToTop: boolean,
): EnrichedSignal[] {
  const idx = prev.findIndex((s) => s.id === next.id);
  let out: EnrichedSignal[];
  if (idx >= 0) {
    if (moveToTop) {
      out = [next, ...prev.slice(0, idx), ...prev.slice(idx + 1)];
    } else {
      out = prev.slice();
      out[idx] = next;
    }
  } else {
    out = [next, ...prev];
  }
  out.sort((a, b) => b.time - a.time);
  return capPerTimeframe(out);
}

function removeSignal(prev: EnrichedSignal[], id: string): EnrichedSignal[] {
  return prev.filter((s) => s.id !== id);
}

export default function SignalFeed({ onSignalClick }: Props) {
  const [signals, setSignals] = useState<EnrichedSignal[]>([]);
  const [filter, setFilter] = useState<Timeframe | "all">("all");
  const wsRef = useRef<ManagedWs | null>(null);

  useEffect(() => {
    wsRef.current = connectSignalsWs((msg: unknown) => {
      const data = msg as {
        event: string;
        data?: Signal | Signal[];
        id?: string;
        status?: "added" | "updated";
      };

      if (data.event === "snapshot" && Array.isArray(data.data)) {
        // Initial snapshot: nothing is "new" — set _receivedAt=0 so NEW won't trigger.
        const snapshotSignals = data.data.map((s) => ({
          ...s,
          _receivedAt: 0,
        } as EnrichedSignal));
        setSignals(() => {
          snapshotSignals.sort((a, b) => b.time - a.time);
          return capPerTimeframe(snapshotSignals);
        });
      } else if (
        data.event === "signal_upsert" &&
        data.data &&
        !Array.isArray(data.data)
      ) {
        const incoming = data.data as Signal;
        const isAdded = data.status === "added";
        setSignals((prev) => {
          const existing = prev.find((s) => s.id === incoming.id);
          const isFlip = !!existing && existing.type !== incoming.type;
          // NEW only for genuine new appearance OR type flip (BUY↔SELL).
          // Pure score/price updates preserve previous _receivedAt and position.
          const isNew = isAdded || isFlip;
          const enriched: EnrichedSignal = {
            ...incoming,
            _receivedAt: isNew ? Date.now() : (existing?._receivedAt ?? 0),
          };
          return upsertSignal(prev, enriched, isNew);
        });
      } else if (data.event === "signal_remove" && typeof data.id === "string") {
        const rid = data.id;
        setSignals((prev) => removeSignal(prev, rid));
      }
    });
    return () => {
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, []);

  // Periodically sync with backend (every 30s).
  // Preserves _receivedAt for signals we already track (so NEW timing stays
  // tied to the original WS event, not the sync moment). Signals new to us
  // from REST (rare — only on WS-missed events) get _receivedAt=0 so they
  // don't suddenly flash as NEW.
  useEffect(() => {
    const iv = setInterval(() => {
      Promise.all(
        ALL_TF.map((tf) => fetchRecentSignals(tf, 400))
      ).then((results) => {
        const incoming: Signal[] = [];
        results.forEach((res) => {
          res.signals.forEach((s) => incoming.push(s));
        });
        incoming.sort((a, b) => b.time - a.time);
        setSignals((prev) => {
          const prevMap = new Map(prev.map((s) => [s.id, s]));
          const merged: EnrichedSignal[] = incoming.map((s) => {
            const existing = prevMap.get(s.id);
            return {
              ...s,
              _receivedAt: existing?._receivedAt ?? 0,
            };
          });
          return capPerTimeframe(merged);
        });
      }).catch(() => {});
    }, 30_000);
    return () => clearInterval(iv);
  }, []);

  // Shared timer that drives:
  //   1) Relative time text refresh
  //   2) NEW badge expiration check (10s after _receivedAt)
  // Fired every 2s so NEW disappears within ±2s of its 10s window.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const iv = setInterval(() => setTick((t) => t + 1), 2_000);
    return () => clearInterval(iv);
  }, []);

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
