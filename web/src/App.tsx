import { useEffect, useState } from "react";
import type { HealthStatus } from "@fig/shared";
import "./App.css";

// Phase 1 placeholder. The real dashboard (KPI row, comparison table,
// time series, drill-down, Myntra upload, attribution banner) is built in
// Phase 7. This just proves the web -> server -> shared-types wiring works.
function App() {
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then(setHealth)
      .catch((e) => setError(String(e)));
  }, []);

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "#0b0d10",
        color: "#e6e8eb",
        fontFamily: "system-ui, sans-serif",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "0.75rem",
      }}
    >
      <h1 style={{ fontSize: "1.5rem", fontWeight: 600 }}>FIG Living — Ads Dashboard</h1>
      <p style={{ color: "#9aa0a6" }}>Phase 1 scaffold. Dashboard UI arrives in Phase 7.</p>
      {health && (
        <p style={{ color: "#7ee787" }}>
          server ok — {health.service} @ {health.time}
        </p>
      )}
      {error && <p style={{ color: "#f87171" }}>server unreachable: {error}</p>}
    </main>
  );
}

export default App;
