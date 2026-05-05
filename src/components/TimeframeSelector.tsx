import type { Timeframe } from "../api/types";

const TIMEFRAMES: { value: Timeframe | "all"; label: string }[] = [
  { value: "all", label: "ALL" },
  { value: "1m", label: "1분" },
  { value: "3m", label: "3분" },
  { value: "5m", label: "5분" },
  { value: "15m", label: "15분" },
  { value: "30m", label: "30분" },
  { value: "1h", label: "1시간" },
];

interface Props {
  selected: Timeframe | "all";
  onChange: (tf: Timeframe | "all") => void;
  showAll?: boolean;
}

export default function TimeframeSelector({ selected, onChange, showAll = true }: Props) {
  const items = showAll ? TIMEFRAMES : TIMEFRAMES.filter((t) => t.value !== "all");
  return (
    <div className="tf-selector">
      {items.map((tf) => (
        <button
          key={tf.value}
          className={`tf-btn ${selected === tf.value ? "active" : ""}`}
          onClick={() => onChange(tf.value)}
        >
          {tf.label}
        </button>
      ))}
    </div>
  );
}
