import { useEffect, useRef, useState } from "react";
import {
  createChart,
  type IChartApi,
  ColorType,
  CrosshairMode,
  type SeriesMarker,
  type Time,
  CandlestickSeries,
  HistogramSeries,
  createSeriesMarkers,
} from "lightweight-charts";
import type { Candle, Signal, Timeframe } from "../api/types";
import { fetchCandles } from "../api/rest";
import { connectCandlesWs, type ManagedWs } from "../api/ws";

interface Props {
  symbol: string;
  timeframe: Timeframe;
}

interface OhlcvInfo {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  change: number;
  changePercent: number;
}

function calcPrecision(candles: Candle[]): { precision: number; minMove: number } {
  let maxDecimals = 0;
  for (const c of candles) {
    for (const v of [c.open, c.high, c.low, c.close]) {
      const s = v.toString();
      const dot = s.indexOf(".");
      if (dot !== -1) {
        maxDecimals = Math.max(maxDecimals, s.length - dot - 1);
      }
    }
  }
  const precision = Math.min(maxDecimals, 10);
  return { precision, minMove: Number(`1e-${precision}`) };
}

// UTC+9 (KST) offset in seconds
const KST_OFFSET = 9 * 3600;

/** Shift UTC timestamp to KST for lightweight-charts (which renders as UTC) */
function toKST(utcSec: number): Time {
  return (utcSec + KST_OFFSET) as unknown as Time;
}

function signalsToMarkers(signals: Signal[]): SeriesMarker<Time>[] {
  return signals
    .sort((a, b) => a.time - b.time)
    .map((s) => ({
      time: toKST(s.time),
      position: s.marker_position,
      shape: s.marker_shape === "arrowUp" ? ("arrowUp" as const) : ("arrowDown" as const),
      color: s.type === "BUY" ? "#26a69a" : "#ef5350",
      text: `${s.type} (${s.score})`,
    }));
}

function formatTime(ts: number): string {
  const d = new Date(ts * 1000);
  return d.toLocaleString("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatPrice(v: number, prec: number): string {
  return v.toFixed(prec);
}

function formatVolume(v: number): string {
  if (v >= 1_000_000_000) return (v / 1_000_000_000).toFixed(2) + "B";
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(2) + "M";
  if (v >= 1_000) return (v / 1_000).toFixed(2) + "K";
  return v.toFixed(2);
}

function OhlcvLegend({ info, precision }: { info: OhlcvInfo | null; precision: number }) {
  if (!info) return null;

  // change/changePercent are pre-calculated as (close - prevClose)
  const isUp = info.change >= 0;
  const color = isUp ? "#26a69a" : "#ef5350";
  const sign = info.change >= 0 ? "+" : "";

  return (
    <div className="ohlcv-legend">
      <span className="ohlcv-time">{info.time}</span>
      <span className="ohlcv-label">O</span>
      <span className="ohlcv-value" style={{ color }}>{formatPrice(info.open, precision)}</span>
      <span className="ohlcv-label">H</span>
      <span className="ohlcv-value" style={{ color }}>{formatPrice(info.high, precision)}</span>
      <span className="ohlcv-label">L</span>
      <span className="ohlcv-value" style={{ color }}>{formatPrice(info.low, precision)}</span>
      <span className="ohlcv-label">C</span>
      <span className="ohlcv-value" style={{ color }}>{formatPrice(info.close, precision)}</span>
      <span className={`ohlcv-change ${isUp ? "up" : "down"}`}>
        {sign}{formatPrice(info.change, precision)} ({sign}{info.changePercent.toFixed(2)}%)
      </span>
      <span className="ohlcv-label">Vol</span>
      <span className="ohlcv-vol">{formatVolume(info.volume)}</span>
    </div>
  );
}

export default function Chart({ symbol, timeframe }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const wsRef = useRef<ManagedWs | null>(null);
  const [ohlcv, setOhlcv] = useState<OhlcvInfo | null>(null);
  const [pricePrecision, setPricePrecision] = useState(2);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    el.innerHTML = "";
    let disposed = false;

    // Map to look up candle data by KST-shifted time
    const candleMap = new Map<number, Candle>();
    // Sorted keys for finding previous candle (maintained via binary insert)
    let sortedKeys: number[] = [];

    function binaryInsertKey(key: number) {
      let lo = 0, hi = sortedKeys.length;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (sortedKeys[mid] < key) lo = mid + 1; else hi = mid;
      }
      if (lo < sortedKeys.length && sortedKeys[lo] === key) return; // already exists
      sortedKeys.splice(lo, 0, key);
    }

    function rebuildSortedKeys() {
      sortedKeys = Array.from(candleMap.keys()).sort((a, b) => a - b);
    }

    function getPrevClose(kstTime: number): number | null {
      // Binary search for kstTime
      let lo = 0, hi = sortedKeys.length;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (sortedKeys[mid] < kstTime) lo = mid + 1; else hi = mid;
      }
      // lo is now the index of kstTime (or where it would be)
      if (lo > 0) {
        const prevCandle = candleMap.get(sortedKeys[lo - 1]);
        return prevCandle ? prevCandle.close : null;
      }
      return null;
    }

    function makeOhlcv(c: Candle, kstTime: number): OhlcvInfo {
      const prevClose = getPrevClose(kstTime);
      // Change = current close - previous candle's close (same as Gate.io)
      const ref = prevClose ?? c.open;
      const change = c.close - ref;
      return {
        time: formatTime(c.time),
        open: c.open, high: c.high, low: c.low, close: c.close,
        volume: c.volume, change,
        changePercent: ref !== 0 ? (change / ref) * 100 : 0,
      };
    }

    const chart = createChart(el, {
      layout: {
        background: { type: ColorType.Solid, color: "#131722" },
        textColor: "#d1d4dc",
      },
      grid: {
        vertLines: { color: "#1e222d" },
        horzLines: { color: "#1e222d" },
      },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: "#2a2e39" },
      timeScale: {
        borderColor: "#2a2e39",
        timeVisible: true,
        secondsVisible: false,
      },
      autoSize: true,
    });
    chartRef.current = chart;

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#26a69a",
      downColor: "#ef5350",
      borderDownColor: "#ef5350",
      borderUpColor: "#26a69a",
      wickDownColor: "#ef5350",
      wickUpColor: "#26a69a",
    });

    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "volume",
    });
    chart.priceScale("volume").applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
    });

    const markersPlugin = createSeriesMarkers(candleSeries, []);

    // Crosshair move → update OHLCV legend
    // candleMap is keyed by KST-shifted time (matching chart axis)
    chart.subscribeCrosshairMove((param) => {
      if (disposed) return;

      if (!param.time) {
        // Mouse left chart → show latest candle
        if (sortedKeys.length > 0) {
          const lastKey = sortedKeys[sortedKeys.length - 1];
          const c = candleMap.get(lastKey);
          if (c) setOhlcv(makeOhlcv(c, lastKey));
        }
        return;
      }

      const kstTime = param.time as number;
      const c = candleMap.get(kstTime);
      if (c) setOhlcv(makeOhlcv(c, kstTime));
    });

    // Fetch initial data
    fetchCandles(symbol, timeframe)
      .then((res) => {
        if (disposed) return;

        const { precision, minMove } = calcPrecision(res.candles);
        setPricePrecision(precision);
        candleSeries.applyOptions({
          priceFormat: { type: "price", precision, minMove },
        });

        // Populate candle map (keyed by KST-shifted time)
        for (const c of res.candles) {
          candleMap.set(c.time + KST_OFFSET, c);
        }
        rebuildSortedKeys();

        candleSeries.setData(
          res.candles.map((c) => ({
            time: toKST(c.time),
            open: c.open,
            high: c.high,
            low: c.low,
            close: c.close,
          }))
        );

        volumeSeries.setData(
          res.candles.map((c) => ({
            time: toKST(c.time),
            value: c.volume,
            color: c.close >= c.open ? "rgba(38,166,154,0.3)" : "rgba(239,83,80,0.3)",
          }))
        );

        if (res.signals.length > 0) {
          addSignals(res.signals);
        }

        // Show latest candle info by default
        if (sortedKeys.length > 0) {
          const lastKey = sortedKeys[sortedKeys.length - 1];
          const last = candleMap.get(lastKey);
          if (last) setOhlcv(makeOhlcv(last, lastKey));
        }

        chart.timeScale().fitContent();
      })
      .catch(console.error);

    // Signal marker state — deduplicate by signal ID
    const signalMap = new Map<string, Signal>();

    function syncMarkers() {
      const markers = signalsToMarkers(Array.from(signalMap.values()));
      markersPlugin.setMarkers(markers);
    }

    function addSignals(signals: Signal[]) {
      let changed = false;
      for (const s of signals) {
        if (!signalMap.has(s.id)) {
          signalMap.set(s.id, s);
          changed = true;
        }
      }
      if (changed) syncMarkers();
    }

    // Connect WebSocket for real-time updates
    const ws = connectCandlesWs(symbol, timeframe, (msg: unknown) => {
      if (disposed) return;

      const data = msg as {
        event: string;
        data?: Candle;
        candles?: Candle[];
        signals?: Signal[];
      };

      if (data.event === "snapshot") {
        if (data.signals && data.signals.length > 0) {
          addSignals(data.signals);
        }
      } else if (data.event === "candle_update" && data.data) {
        const c = data.data;
        const kst = c.time + KST_OFFSET;
        const isNew = !candleMap.has(kst);
        candleMap.set(kst, c);
        if (isNew) binaryInsertKey(kst);
        candleSeries.update({
          time: toKST(c.time),
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
        });
        volumeSeries.update({
          time: toKST(c.time),
          value: c.volume,
          color: c.close >= c.open ? "rgba(38,166,154,0.3)" : "rgba(239,83,80,0.3)",
        });
      } else if (data.event === "signal" && data.data) {
        addSignals([data.data as unknown as Signal]);
      }
    });
    wsRef.current = ws;

    return () => {
      disposed = true;
      ws.close();
      wsRef.current = null;
      chart.remove();
      chartRef.current = null;
    };
  }, [symbol, timeframe]);

  return (
    <div className="chart-wrapper">
      <div className="chart-area">
        <OhlcvLegend info={ohlcv} precision={pricePrecision} />
        <div className="chart-container" ref={containerRef} />
      </div>
    </div>
  );
}
