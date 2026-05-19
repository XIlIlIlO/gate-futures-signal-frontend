import { useEffect, useMemo, useRef, useState } from "react";
import type {
  MarketCapRankItem,
  MetricRankItem,
  Signal,
  SortMode,
  Target,
  Timeframe,
} from "../api/types";
import {
  fetchMarketCapRanking,
  fetchRecentSignals,
} from "../api/rest";
import { connectSignalsWs, type ManagedWs } from "../api/ws";
import SignalBadge, { isRealtimeCandle, isRealtimeOrPrevCandle } from "./SignalBadge";
import TimeframeSelector from "./TimeframeSelector";

interface Props {
  onJump: (symbol: string, timeframe: Timeframe) => void;
  target: Target;
  sortMode: SortMode;
  onTargetChange: (t: Target) => void;
  onSortModeChange: (m: SortMode) => void;
}

interface EnrichedSignal extends Signal {
  /** ms timestamp set ONLY on genuine NEW events (added / type flip). */
  _receivedAt: number;
  /** ms timestamp used for list ordering. */
  _sortAt: number;
}

interface RankingsState {
  market_cap: MarketCapRankItem[];
  volatility: Partial<Record<Timeframe, MetricRankItem[]>>;
  turnover: Partial<Record<Timeframe, MetricRankItem[]>>;
}

const ALL_TF: Timeframe[] = ["1m", "3m", "5m", "15m", "30m", "1h"];
const PER_TF_LIMIT = 1000;
const CMC_REFRESH_MS = 60 * 60 * 1000; // 1h

const TARGET_LABEL: Record<Target, string> = {
  all: "전체",
  market_cap: "시총100",
  volatility: "변동성100",
  turnover: "거래대금100",
};

// ── Signal list helpers (latest mode) ────────────────────────────────

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
  result.sort((a, b) => b._sortAt - a._sortAt);
  return result;
}

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
  out.sort((a, b) => b._sortAt - a._sortAt);
  return capPerTimeframe(out);
}

function removeSignal(prev: EnrichedSignal[], id: string): EnrichedSignal[] {
  return prev.filter((s) => s.id !== id);
}

function fromHistorical(s: Signal): EnrichedSignal {
  return { ...s, _receivedAt: 0, _sortAt: s.time * 1000 };
}

// ── Component ───────────────────────────────────────────────────────

export default function SignalFeed({
  onJump,
  target,
  sortMode,
  onTargetChange,
  onSortModeChange,
}: Props) {
  const [signals, setSignals] = useState<EnrichedSignal[]>([]);
  const [filter, setFilter] = useState<Timeframe | "all">("all");
  const [rankings, setRankings] = useState<RankingsState>({
    market_cap: [],
    volatility: {},
    turnover: {},
  });
  const wsRef = useRef<ManagedWs | null>(null);

  // ALL은 (target=전체 AND 최신순)일 때만 유효. 그 외에 filter가 ALL이면 1m으로 자동 전환.
  const allEnabled = target === "all" && sortMode === "latest";
  useEffect(() => {
    if (!allEnabled && filter === "all") setFilter("1m");
  }, [allEnabled, filter]);

  // ── WS connection ──
  useEffect(() => {
    wsRef.current = connectSignalsWs((msg: unknown) => {
      const data = msg as {
        event: string;
        data?: Signal | Signal[];
        id?: string;
        status?: "added" | "updated";
        rankings?: {
          market_cap?: MarketCapRankItem[];
          volatility?: Partial<Record<Timeframe, MetricRankItem[]>>;
          turnover?: Partial<Record<Timeframe, MetricRankItem[]>>;
        };
        kind?: "volatility" | "turnover";
        timeframe?: string;
        items?: MetricRankItem[];
      };

      if (data.event === "snapshot" && Array.isArray(data.data)) {
        const snap = data.data.map(fromHistorical);
        setSignals(() => {
          snap.sort((a, b) => b._sortAt - a._sortAt);
          return capPerTimeframe(snap);
        });
        if (data.rankings) {
          setRankings((prev) => ({
            market_cap: prev.market_cap, // mcap은 REST로만 채움
            volatility: { ...prev.volatility, ...(data.rankings!.volatility ?? {}) },
            turnover: { ...prev.turnover, ...(data.rankings!.turnover ?? {}) },
          }));
        }
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
          const isNew = isAdded || isFlip;
          const now = Date.now();
          const enriched: EnrichedSignal = {
            ...incoming,
            _receivedAt: isNew ? now : (existing?._receivedAt ?? 0),
            _sortAt: isNew ? now : (existing?._sortAt ?? incoming.time * 1000),
          };
          return upsertSignal(prev, enriched, isNew);
        });
      } else if (data.event === "signal_remove" && typeof data.id === "string") {
        const rid = data.id;
        setSignals((prev) => removeSignal(prev, rid));
      } else if (
        data.event === "ranking_update" &&
        (data.kind === "volatility" || data.kind === "turnover") &&
        typeof data.timeframe === "string" &&
        Array.isArray(data.items)
      ) {
        const kind = data.kind;
        const tf = data.timeframe as Timeframe;
        const items = data.items;
        setRankings((prev) => ({
          ...prev,
          [kind]: { ...prev[kind], [tf]: items },
        }));
      }
    });
    return () => {
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, []);

  // ── REST sync (30s) ──
  useEffect(() => {
    const iv = setInterval(() => {
      Promise.all(ALL_TF.map((tf) => fetchRecentSignals(tf, 400)))
        .then((results) => {
          const incoming: Signal[] = [];
          results.forEach((res) => res.signals.forEach((s) => incoming.push(s)));
          setSignals((prev) => {
            const prevMap = new Map(prev.map((s) => [s.id, s]));
            const merged: EnrichedSignal[] = incoming.map((s) => {
              const existing = prevMap.get(s.id);
              if (existing) {
                return {
                  ...s,
                  _receivedAt: existing._receivedAt,
                  _sortAt: existing._sortAt,
                };
              }
              return fromHistorical(s);
            });
            merged.sort((a, b) => b._sortAt - a._sortAt);
            return capPerTimeframe(merged);
          });
        })
        .catch(() => {});
    }, 30_000);
    return () => clearInterval(iv);
  }, []);

  // ── Market-cap ranking (REST, 1h) ──
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      fetchMarketCapRanking(100)
        .then((res) => {
          if (cancelled) return;
          setRankings((prev) => ({ ...prev, market_cap: res.items }));
        })
        .catch(() => {});
    };
    load();
    const iv = setInterval(load, CMC_REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, []);

  // 매 2s 틱 (NEW 배지 만료 + relative time 갱신)
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const iv = setInterval(() => setTick((t) => t + 1), 2_000);
    return () => clearInterval(iv);
  }, []);

  // ── 대상 심볼 집합 (latest 모드 필터링용) ──
  const targetSymbols = useMemo<Set<string> | null>(() => {
    if (target === "all") return null;
    if (target === "market_cap") {
      const s = new Set<string>();
      for (const r of rankings.market_cap) {
        if (r.gate_listed && r.gate_symbol) s.add(r.gate_symbol);
      }
      return s;
    }
    const table = target === "volatility" ? rankings.volatility : rankings.turnover;
    if (filter === "all") {
      const s = new Set<string>();
      for (const tf of ALL_TF) {
        for (const r of table[tf] ?? []) s.add(r.symbol);
      }
      return s;
    }
    const s = new Set<string>();
    for (const r of table[filter] ?? []) s.add(r.symbol);
    return s;
  }, [target, filter, rankings]);

  // ── 최신순 필터링된 시그널 ──
  const realtime = useMemo(() => {
    const hasCurrentBucket = new Set<string>();
    for (const s of signals) {
      if (isRealtimeCandle(s.time, s.timeframe)) hasCurrentBucket.add(s.timeframe);
    }
    return signals.filter((s) =>
      hasCurrentBucket.has(s.timeframe)
        ? isRealtimeCandle(s.time, s.timeframe)
        : isRealtimeOrPrevCandle(s.time, s.timeframe)
    );
  }, [signals]);

  const filtered = useMemo(() => {
    let list = realtime;
    if (targetSymbols) list = list.filter((s) => targetSymbols.has(s.symbol));
    if (filter !== "all") list = list.filter((s) => s.timeframe === filter);
    return list;
  }, [realtime, targetSymbols, filter]);

  // ── 순위순용 (symbol, tf) → signal 룩업 ──
  const signalLookup = useMemo(() => {
    const m = new Map<string, EnrichedSignal>();
    for (const s of realtime) m.set(`${s.symbol}|${s.timeframe}`, s);
    return m;
  }, [realtime]);

  // ── 순위 룩업 — 최신순에서도 시그널 앞에 순위 prefix를 붙이기 위함 ──
  // mcap key: symbol / vol·turnover key: `${symbol}|${tf}`
  const rankLookup = useMemo(() => {
    const m = new Map<string, number>();
    if (target === "market_cap") {
      for (const r of rankings.market_cap) {
        if (r.gate_symbol) m.set(r.gate_symbol, r.rank);
      }
    } else if (target === "volatility" || target === "turnover") {
      const table = target === "volatility" ? rankings.volatility : rankings.turnover;
      for (const tf of ALL_TF) {
        for (const r of table[tf] ?? []) {
          m.set(`${r.symbol}|${tf}`, r.rank);
        }
      }
    }
    return m;
  }, [target, rankings]);

  function getRank(symbol: string, timeframe: string): number | undefined {
    if (target === "all") return undefined;
    if (target === "market_cap") return rankLookup.get(symbol);
    return rankLookup.get(`${symbol}|${timeframe}`);
  }

  function getRankValue(symbol: string, timeframe: string): number | null {
    if (target === "market_cap") {
      return rankings.market_cap.find((r) => r.gate_symbol === symbol)?.market_cap ?? null;
    }
    if (target === "volatility") {
      return rankings.volatility[timeframe as Timeframe]?.find((r) => r.symbol === symbol)?.value ?? null;
    }
    if (target === "turnover") {
      return rankings.turnover[timeframe as Timeframe]?.find((r) => r.symbol === symbol)?.value ?? null;
    }
    return null;
  }

  const rankListForCurrent = useMemo<RankRow[]>(() => {
    if (sortMode !== "rank" || target === "all" || filter === "all") return [];
    const tf = filter;
    if (target === "market_cap") {
      return rankings.market_cap.map((r) => ({
        rank: r.rank,
        symbol: r.gate_symbol ?? r.cmc_symbol,
        displaySymbol: r.gate_symbol ?? r.cmc_symbol,
        name: r.name,
        gateListed: r.gate_listed,
        value: r.market_cap ?? null,
        timeframe: tf,
      }));
    }
    const table = target === "volatility" ? rankings.volatility : rankings.turnover;
    const items = table[tf] ?? [];
    return items.map((r) => ({
      rank: r.rank,
      symbol: r.symbol,
      displaySymbol: r.symbol,
      name: "",
      gateListed: true,
      value: r.value,
      timeframe: tf,
    }));
  }, [sortMode, target, filter, rankings]);

  const isRankMode = sortMode === "rank" && target !== "all" && filter !== "all";
  const visibleCount = isRankMode ? rankListForCurrent.length : filtered.length;

  return (
    <div className="signal-feed">
      <div className="feed-header">
        <h2>실시간 시그널</h2>
        <span className="feed-count">{visibleCount}개</span>
      </div>

      <div className="feed-controls">
        <div className="target-selector" role="tablist">
          {(["all", "market_cap", "volatility", "turnover"] as Target[]).map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={target === t}
              className={`target-btn ${target === t ? "active" : ""}`}
              onClick={() => onTargetChange(t)}
            >
              {TARGET_LABEL[t]}
            </button>
          ))}
        </div>
        <div className="sort-selector">
          <button
            className={`sort-btn ${sortMode === "latest" ? "active" : ""}`}
            onClick={() => onSortModeChange("latest")}
          >
            최신순
          </button>
          <button
            className={`sort-btn ${sortMode === "rank" ? "active" : ""}`}
            disabled={target === "all"}
            title={target === "all" ? "전체코인일 땐 순위순 사용 불가" : ""}
            onClick={() => onSortModeChange("rank")}
          >
            순위순
          </button>
        </div>
      </div>

      <TimeframeSelector
        selected={filter}
        onChange={setFilter}
        showAll={allEnabled}
      />

      <div className="feed-list">
        {isRankMode ? (
          rankListForCurrent.length === 0 ? (
            <div className="feed-empty">순위 데이터 로딩중...</div>
          ) : (
            rankListForCurrent.map((row) => (
              <RankSlot
                key={`${row.rank}:${row.displaySymbol}`}
                row={row}
                target={target}
                signal={signalLookup.get(`${row.symbol}|${row.timeframe}`) ?? null}
                onJump={onJump}
                tick={tick}
              />
            ))
          )
        ) : filtered.length === 0 ? (
          <div className="feed-empty">시그널 대기중...</div>
        ) : (
          filtered.map((sig) => {
            const rank = getRank(sig.symbol, sig.timeframe);
            const value = getRankValue(sig.symbol, sig.timeframe);
            if (rank === undefined) {
              return (
                <SignalBadge
                  key={sig.id}
                  signal={sig}
                  onClick={(s) => onJump(s.symbol, s.timeframe as Timeframe)}
                  tick={tick}
                />
              );
            }
            return (
              <div key={sig.id} className="rank-row">
                <span className="rank-num">{rank}</span>
                <div className="rank-signal-wrap">
                  <SignalBadge
                    signal={sig}
                    onClick={(s) => onJump(s.symbol, s.timeframe as Timeframe)}
                    tick={tick}
                  />
                </div>
                {value !== null && (
                  <span className="rank-metric">{formatRankValue(target, value)}</span>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// ── Rank slot ───────────────────────────────────────────────────────

interface RankRow {
  rank: number;
  symbol: string;         // matching key for signalLookup (Gate symbol or CMC-side fallback)
  displaySymbol: string;  // shown to user
  name: string;           // CMC full name (mcap only)
  gateListed: boolean;
  value: number | null;   // volatility%/turnover, null for mcap
  timeframe: Timeframe;
}

interface RankSlotProps {
  row: RankRow;
  target: Target;
  signal: EnrichedSignal | null;
  onJump: (symbol: string, timeframe: Timeframe) => void;
  tick?: number;
}

function formatRankValue(target: Target, value: number | null): string {
  if (value === null) return "";
  if (target === "volatility") return `${value.toFixed(2)}%`;
  if (target === "turnover" || target === "market_cap") {
    if (value >= 1_000_000_000_000) return `$${(value / 1_000_000_000_000).toFixed(2)}T`;
    if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(2)}B`;
    if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
    if (value >= 1_000) return `$${(value / 1_000).toFixed(2)}K`;
    return `$${value.toFixed(2)}`;
  }
  return "";
}

function RankSlot({ row, target, signal, onJump, tick }: RankSlotProps) {
  if (signal && row.gateListed) {
    return (
      <div className="rank-slot active">
        <span className="rank-num">{row.rank}</span>
        <div className="rank-signal-wrap">
          <SignalBadge
            signal={signal}
            onClick={(s) => onJump(s.symbol, s.timeframe as Timeframe)}
            compact
            tick={tick}
          />
        </div>
        {row.value !== null && (
          <span className="rank-metric">{formatRankValue(target, row.value)}</span>
        )}
      </div>
    );
  }

  const canJump = row.gateListed;
  const handleClick = canJump ? () => onJump(row.symbol, row.timeframe) : undefined;
  const reason = !row.gateListed ? "Gate 미상장" : "시그널 없음";

  return (
    <div
      className={`rank-slot empty ${!row.gateListed ? "not-listed" : ""} ${canJump ? "clickable" : ""}`}
      onClick={handleClick}
      role={canJump ? "button" : undefined}
      tabIndex={canJump ? 0 : undefined}
      onKeyDown={canJump ? (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handleClick?.();
        }
      } : undefined}
    >
      <span className="rank-num">{row.rank}</span>
      <div className="rank-empty-body">
        <span className="rank-symbol">{row.displaySymbol.replace("_", "/")}</span>
        {row.name && <span className="rank-name">{row.name}</span>}
        <span className="rank-status">{reason}</span>
      </div>
      {row.value !== null && (
        <span className="rank-metric">{formatRankValue(target, row.value)}</span>
      )}
    </div>
  );
}
