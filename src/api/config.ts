const BACKENDS = [
  "https://api.1zz1.uk",
  "https://v3-udbot-backend-production.up.railway.app",
] as const;

let currentIdx = Math.floor(Math.random() * BACKENDS.length);
console.log(`[backend] initial pick: ${BACKENDS[currentIdx]}`);

export function getApiBase(): string {
  return BACKENDS[currentIdx];
}

export function getWsBase(): string {
  return BACKENDS[currentIdx].replace(/^http/, "ws");
}

export async function healthCheck(idx: number, timeoutMs = 3000): Promise<boolean> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${BACKENDS[idx]}/health`, { signal: ctrl.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

let healthCheckInFlight: Promise<string> | null = null;

export function ensureHealthyBackend(): Promise<string> {
  if (healthCheckInFlight) return healthCheckInFlight;
  healthCheckInFlight = (async () => {
    const cur = currentIdx;
    if (await healthCheck(cur)) return BACKENDS[cur];
    const other = (cur + 1) % BACKENDS.length;
    if (await healthCheck(other)) {
      currentIdx = other;
      console.warn(`[failover] ${BACKENDS[cur]} dead → switched to ${BACKENDS[other]}`);
    } else {
      console.error(`[failover] both backends unreachable`);
    }
    return BACKENDS[currentIdx];
  })().finally(() => {
    healthCheckInFlight = null;
  });
  return healthCheckInFlight;
}
