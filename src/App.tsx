import { useEffect, useState } from "react";
import type { SortMode, Target, Timeframe } from "./api/types";
import SignalFeed from "./components/SignalFeed";
import SymbolList from "./components/SymbolList";
import Chart from "./components/Chart";
import TimeframeSelector from "./components/TimeframeSelector";
import StatusBar from "./components/StatusBar";

type Theme = "dark" | "light";

const THEME_STORAGE_KEY = "superhero-theme";
const TARGET_STORAGE_KEY = "superhero-target";
const SORT_STORAGE_KEY = "superhero-sort";

function getInitialTheme(): Theme {
  if (typeof window === "undefined") return "dark";
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  if (stored === "dark" || stored === "light") return stored;
  return "dark";
}

function getInitialTarget(): Target {
  if (typeof window === "undefined") return "all";
  const v = window.localStorage.getItem(TARGET_STORAGE_KEY);
  if (v === "all" || v === "market_cap" || v === "volatility" || v === "turnover") return v;
  return "all";
}

function getInitialSortMode(): SortMode {
  if (typeof window === "undefined") return "latest";
  const v = window.localStorage.getItem(SORT_STORAGE_KEY);
  if (v === "latest" || v === "rank") return v;
  return "latest";
}

export default function App() {
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);
  const [chartTimeframe, setChartTimeframe] = useState<Timeframe>("1m");
  const [showSymbolList, setShowSymbolList] = useState(false);
  const [mobileTab, setMobileTab] = useState<"signals" | "chart">("signals");
  const [theme, setTheme] = useState<Theme>(getInitialTheme);
  const [target, setTarget] = useState<Target>(getInitialTarget);
  const [sortMode, setSortMode] = useState<SortMode>(getInitialSortMode);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch { /* ignore quota / private mode errors */ }
  }, [theme]);

  useEffect(() => {
    try { window.localStorage.setItem(TARGET_STORAGE_KEY, target); } catch { /* ignore */ }
  }, [target]);

  useEffect(() => {
    try { window.localStorage.setItem(SORT_STORAGE_KEY, sortMode); } catch { /* ignore */ }
  }, [sortMode]);

  // 순위순은 대상=전체일 땐 불가능. 자동 fallback.
  useEffect(() => {
    if (target === "all" && sortMode === "rank") setSortMode("latest");
  }, [target, sortMode]);

  const toggleTheme = () => setTheme((t) => (t === "dark" ? "light" : "dark"));

  const handleJump = (symbol: string, timeframe: Timeframe) => {
    setSelectedSymbol(symbol);
    setChartTimeframe(timeframe);
    setMobileTab("chart");
  };

  const handleSymbolSelect = (symbol: string) => {
    setSelectedSymbol(symbol);
    setShowSymbolList(false);
    setMobileTab("chart");
  };

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-left">
          <h1>SUPERHERO Signal Alerts</h1>
          <span className="header-subtitle">Gate.io USDT Futures</span>
        </div>
        <div className="header-right">
          <StatusBar />
          <button
            className="theme-toggle"
            onClick={toggleTheme}
            aria-label="테마 전환"
            title={theme === "dark" ? "라이트 모드로 전환" : "다크 모드로 전환"}
          >
            {theme === "dark" ? "☀" : "☾"}
          </button>
        </div>
      </header>

      {/* Mobile tab bar */}
      <nav className="mobile-tabs">
        <button
          className={`mobile-tab ${mobileTab === "signals" ? "active" : ""}`}
          onClick={() => setMobileTab("signals")}
        >
          시그널
        </button>
        <button
          className={`mobile-tab ${mobileTab === "chart" ? "active" : ""}`}
          onClick={() => setMobileTab("chart")}
        >
          차트
        </button>
      </nav>

      <main className="app-main">
        {/* Left: Signal Feed */}
        <aside className={`panel-left ${mobileTab === "signals" ? "mobile-show" : "mobile-hide"}`}>
          <SignalFeed
            onJump={handleJump}
            target={target}
            sortMode={sortMode}
            onTargetChange={setTarget}
            onSortModeChange={setSortMode}
          />
        </aside>

        {/* Center: Chart */}
        <section className={`panel-center ${mobileTab === "chart" ? "mobile-show" : "mobile-hide"}`}>
          <div className="chart-controls">
            <button
              className="btn-symbol-picker"
              onClick={() => setShowSymbolList(!showSymbolList)}
            >
              {selectedSymbol ? selectedSymbol.replace("_", "/") : "코인 선택"} ▾
            </button>
            <TimeframeSelector
              selected={chartTimeframe}
              onChange={(tf) => setChartTimeframe(tf as Timeframe)}
              showAll={false}
            />
          </div>

          {showSymbolList && (
            <div className="symbol-dropdown">
              <SymbolList selected={selectedSymbol} onSelect={handleSymbolSelect} />
            </div>
          )}

          {selectedSymbol ? (
            <Chart symbol={selectedSymbol} timeframe={chartTimeframe} theme={theme} />
          ) : (
            <div className="chart-placeholder">
              <div className="placeholder-content">
                <p className="placeholder-icon">📊</p>
                <p>코인을 선택하거나 시그널을 클릭하세요</p>
                <p className="placeholder-sub">
                  시그널 탭에서 시그널을 클릭하면 해당 코인의 차트가 열립니다
                </p>
              </div>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
