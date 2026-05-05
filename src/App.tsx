import { useState } from "react";
import type { Signal, Timeframe } from "./api/types";
import SignalFeed from "./components/SignalFeed";
import SymbolList from "./components/SymbolList";
import Chart from "./components/Chart";
import TimeframeSelector from "./components/TimeframeSelector";
import StatusBar from "./components/StatusBar";

export default function App() {
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);
  const [chartTimeframe, setChartTimeframe] = useState<Timeframe>("1m");
  const [showSymbolList, setShowSymbolList] = useState(false);
  const [mobileTab, setMobileTab] = useState<"signals" | "chart">("signals");

  const handleSignalClick = (signal: Signal) => {
    setSelectedSymbol(signal.symbol);
    setChartTimeframe(signal.timeframe as Timeframe);
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
        <StatusBar />
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
          <SignalFeed onSignalClick={handleSignalClick} />
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
            <Chart symbol={selectedSymbol} timeframe={chartTimeframe} />
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
