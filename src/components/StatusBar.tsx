import { useEffect, useState } from "react";
import { fetchStatus } from "../api/rest";
import type { StatusResponse } from "../api/types";

export default function StatusBar() {
  const [status, setStatus] = useState<StatusResponse | null>(null);

  useEffect(() => {
    const load = () => {
      fetchStatus().then(setStatus).catch(console.error);
    };
    load();
    const iv = setInterval(load, 30000);
    return () => clearInterval(iv);
  }, []);

  if (!status) return null;

  return (
    <div className="status-bar">
      <span className={`status-dot ${status.ok ? "ok" : "err"}`} />
      <span className="status-detail">코인 {status.symbols_loaded}개</span>
      <span className="status-detail">|</span>
      <span className="status-detail">시그널 {status.recent_signals}개</span>
      <span className="status-detail">|</span>
      <span className="status-detail">{status.scanner_running ? "스캔중..." : "대기"}</span>
      {status.last_scan_finished_at && (
        <>
          <span className="status-detail">|</span>
          <span className="status-detail">
            최근 스캔{" "}
            {new Date(status.last_scan_finished_at * 1000).toLocaleTimeString("ko-KR", {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
        </>
      )}
    </div>
  );
}
