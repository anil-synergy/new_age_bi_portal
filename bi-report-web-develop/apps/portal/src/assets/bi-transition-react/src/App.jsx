import { useState } from "react";
import BITransition from "./BITransition";

// Minimal demo. Replace this state with your app's real loading state and route.
export default function App() {
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState("overview");

  function simulateRefresh() {
    setLoading(true);
    window.setTimeout(() => setLoading(false), 1800); // Demo only.
  }

  function goTo(nextPage) {
    if (nextPage !== page) setPage(nextPage);
  }

  return (
    <BITransition
      loading={loading}
      transitionKey={page}
      label={loading ? "REFRESHING BUSINESS INTELLIGENCE" : "PREPARING YOUR DASHBOARD"}
    >
      <main style={styles.app}>
        <header style={styles.header}>
          <div>
            <div style={styles.eyebrow}>SYNERGY / ANALYTICS</div>
            <h1 style={styles.heading}>Intelligence workspace</h1>
          </div>
          <button style={styles.button} onClick={simulateRefresh}>Refresh data</button>
        </header>

        <nav style={styles.nav} aria-label="Dashboard pages">
          {["overview", "spend", "incidents"].map((item) => (
            <button
              key={item}
              onClick={() => goTo(item)}
              aria-current={page === item ? "page" : undefined}
              style={{ ...styles.navItem, ...(page === item ? styles.activeNav : {}) }}
            >
              {item[0].toUpperCase() + item.slice(1)}
            </button>
          ))}
        </nav>

        <section style={styles.grid}>
          {[
            ["Total spend", "$2.48M", "+8.2%"],
            ["Open incidents", "124", "-12.4%"],
            ["Compliance", "96.8%", "+2.1%"],
          ].map(([label, value, change]) => (
            <article key={label} style={styles.card}>
              <div style={styles.cardLabel}>{label}</div>
              <div style={styles.metric}>{page === "overview" ? value : page === "spend" && label === "Total spend" ? "$2.71M" : value}</div>
              <div style={styles.change}>{change} vs previous period</div>
            </article>
          ))}
        </section>

        <section style={styles.panel}>
          <div>
            <div style={styles.cardLabel}>CURRENT VIEW</div>
            <h2 style={styles.panelHeading}>{page[0].toUpperCase() + page.slice(1)} dashboard</h2>
            <p style={styles.copy}>Connect this layout to your real KPI cards, charts, and business data.</p>
          </div>
          <div style={styles.chart} aria-label="Decorative sample chart">
            {[35, 54, 43, 75, 60, 88, 69, 96, 78, 100, 84, 112].map((height, i) => (
              <span key={i} style={{ ...styles.bar, height }} />
            ))}
          </div>
        </section>
      </main>
    </BITransition>
  );
}

const styles = {
  app: { minHeight: "100vh", padding: "clamp(20px, 5vw, 56px)", color: "#e3f9ed", background: "#07100b", fontFamily: "Inter, system-ui, sans-serif" },
  header: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 20, flexWrap: "wrap" },
  eyebrow: { color: "#51e9a1", fontSize: 11, letterSpacing: ".18em", fontWeight: 700 },
  heading: { fontSize: "clamp(24px, 4vw, 38px)", margin: "10px 0 0" },
  button: { border: "1px solid #2c9564", background: "#0c2a1b", color: "#b8ffda", padding: "11px 16px", borderRadius: 8, cursor: "pointer" },
  nav: { display: "flex", gap: 8, margin: "30px 0 22px", flexWrap: "wrap" },
  navItem: { color: "#8da99a", background: "transparent", border: "1px solid #20382b", borderRadius: 7, padding: "9px 14px", cursor: "pointer" },
  activeNav: { color: "#75ffb6", borderColor: "#36bc7a", background: "#0b2619" },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 210px), 1fr))", gap: 14 },
  card: { border: "1px solid #1a3928", background: "linear-gradient(145deg, #0d1c13, #09130d)", borderRadius: 12, padding: 20 },
  cardLabel: { color: "#8aa996", fontSize: 12 },
  metric: { color: "#e6fff0", fontSize: 30, fontWeight: 650, margin: "13px 0 8px" },
  change: { color: "#50e9a0", fontSize: 12 },
  panel: { marginTop: 18, minHeight: 260, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 30, flexWrap: "wrap", border: "1px solid #1a3928", background: "#09150e", borderRadius: 12, padding: 24 },
  panelHeading: { margin: "10px 0", fontSize: 23 },
  copy: { color: "#91aa9a", maxWidth: 450, lineHeight: 1.6 },
  chart: { display: "flex", alignItems: "end", gap: 7, height: 130, padding: 10, flex: "1 1 220px", minWidth: 180 },
  bar: { flex: 1, minWidth: 5, maxWidth: 22, borderRadius: "4px 4px 0 0", background: "linear-gradient(0deg, #1b9e63, #42f4a0)", boxShadow: "0 0 12px #27ff8b20" },
};
