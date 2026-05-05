import { useEffect, useState } from "react";
import { fetchSymbols } from "../api/rest";

interface Props {
  selected: string | null;
  onSelect: (symbol: string) => void;
}

export default function SymbolList({ selected, onSelect }: Props) {
  const [symbols, setSymbols] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchSymbols()
      .then((res) => setSymbols(res.symbols))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const filtered = search
    ? symbols.filter((s) => s.toLowerCase().includes(search.toLowerCase()))
    : symbols;

  return (
    <div className="symbol-list">
      <div className="symbol-search">
        <input
          type="text"
          placeholder="코인 검색..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      {loading ? (
        <div className="symbol-loading">로딩중...</div>
      ) : (
        <div className="symbol-items">
          {filtered.map((sym) => (
            <button
              key={sym}
              className={`symbol-item ${selected === sym ? "active" : ""}`}
              onClick={() => onSelect(sym)}
            >
              {sym.replace("_", "/")}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
