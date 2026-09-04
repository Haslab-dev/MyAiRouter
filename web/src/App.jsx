import { useState, useEffect, lazy, Suspense } from "react";
import { Routes, Route, NavLink, Navigate } from "react-router-dom";
import UserMenu from "./components/UserMenu";
import Snackbar from "./components/Snackbar";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import { ThemeProvider, useTheme } from "./contexts/ThemeContext";

const EndpointPage = lazy(() => import("./pages/EndpointPage"));
const ProvidersPage = lazy(() => import("./pages/ProvidersPage"));
const CombosPage = lazy(() => import("./pages/CombosPage"));
const UsagePage = lazy(() => import("./pages/UsagePage"));
const ModelsPage = lazy(() => import("./pages/ModelsPage"));
const SkillsPage = lazy(() => import("./pages/SkillsPage"));
const QuotaPage = lazy(() => import("./pages/QuotaPage"));
const ConsoleLogPage = lazy(() => import("./pages/ConsoleLogPage"));
const TracesPage = lazy(() => import("./pages/TracesPage"));
const ChatPage = lazy(() => import("./pages/ChatPage"));
const BenchmarkPage = lazy(() => import("./pages/BenchmarkPage"));
const LoginPage = lazy(() => import("./pages/LoginPage"));
const OnboardingPage = lazy(() => import("./pages/OnboardingPage"));

const NAV_ITEMS = [
  { to: "/usage", label: "Overview", icon: "dashboard" },
  { to: "/chat", label: "Chat", icon: "forum" },
  { to: "/benchmark", label: "Benchmark", icon: "compare" },
  { to: "/endpoint", label: "Gateway", icon: "explore" },
  { to: "/providers", label: "Providers", icon: "dns" },
  { to: "/combos", label: "Routes", icon: "alt_route" },
  { to: "/models", label: "Models", icon: "settings_suggest" },
  { to: "/traces", label: "Traces", icon: "history_toggle_off" },
  { to: "/quota", label: "Health", icon: "health_and_safety" },
  { to: "/skills", label: "Skills", icon: "conversion_path" },
  { to: "/console-log", label: "Traffic", icon: "insights" },
];

function formatBytes(bytes) {
  if (!bytes || bytes < 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let val = bytes;
  let unitIdx = 0;
  while (val >= 1024 && unitIdx < units.length - 1) {
    val /= 1024;
    unitIdx++;
  }
  return val.toFixed(unitIdx === 0 ? 0 : 1) + " " + units[unitIdx];
}

function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === "dark";

  return (
    <button
      onClick={toggleTheme}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: "32px",
        height: "32px",
        borderRadius: "8px",
        border: "1px solid var(--border-color)",
        background: "transparent",
        cursor: "pointer",
        color: "var(--text-muted)",
        transition: "all 0.2s ease",
      }}
      title={isDark ? "Switch to light mode" : "Switch to dark mode"}
    >
      {isDark ? (
        <span
          className="material-symbols-outlined"
          style={{ fontSize: "18px" }}
        >
          light_mode
        </span>
      ) : (
        <span
          className="material-symbols-outlined"
          style={{ fontSize: "18px" }}
        >
          dark_mode
        </span>
      )}
    </button>
  );
}

function AppShell() {
  const { status, onboardingDone } = useAuth();
  const [providerCount, setProviderCount] = useState(0);
  const [modelCount, setModelCount] = useState(0);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    return localStorage.getItem("sidebarCollapsed") === "true";
  });
  const [systemMetrics, setSystemMetrics] = useState(null);
  useEffect(() => {
    const fetchCounts = async () => {
      try {
        const res = await fetch("/api/providers");
        if (res.ok) {
          const conns = (await res.json()) || [];
          const activeConns = conns.filter((c) => c.isActive);
          setProviderCount(activeConns.length);
        }
        const mRes = await fetch("/v1/models");
        if (mRes.ok) {
          const modelsData = await mRes.json();
          setModelCount(modelsData.data?.length || 0);
        }
      } catch (err) {
        console.error("Error fetching count statistics:", err);
      }
    };
    fetchCounts();
  }, []);

  useEffect(() => {
    const fetchMetrics = async () => {
      try {
        const res = await fetch("/api/system/metrics");
        if (res.ok) {
          setSystemMetrics(await res.json());
        }
      } catch (err) {
        console.error("Error fetching system metrics:", err);
      }
    };
    fetchMetrics();
    const interval = setInterval(fetchMetrics, 30000);
    return () => clearInterval(interval);
  }, []);
  // Loading state
  if (status === null) {
    return (
      <div
        style={{
          minHeight: "100vh",
          background: "var(--bg-color)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--text-muted)",
          fontSize: "14px",
          gap: "10px",
        }}
      >
        <span
          className="material-symbols-outlined"
          style={{ fontSize: "20px", animation: "spin 1s linear infinite" }}
        >
          progress_activity
        </span>
        Connecting to gateway...
        <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  // First-ever visit → onboarding wizard
  if (!onboardingDone) {
    return <OnboardingPage />;
  }

  // Onboarding done but auth is required and session is invalid → login
  if (status.requireLogin && !status.authenticated) {
    return <LoginPage />;
  }

  return (
    <div className="app-layout">
      {/* Top Header Bar */}
      <header className="top-bar">
        <div className="top-bar-left">
          <div className="logo-section-top">
            <span className="material-symbols-outlined logo-icon-top">
              router
            </span>
            <div className="logo-text-wrapper">
              <span className="logo-text-top">myAiRouter</span>
              <span className="logo-version">v0.2.4</span>
            </div>
          </div>
        </div>

        <div className="top-bar-center">
          <div className="search-wrapper">
            <span className="material-symbols-outlined search-icon">
              search
            </span>
            <input
              type="text"
              placeholder="Search request traces, connections, settings..."
              className="search-input"
            />
            <span className="search-shortcut">⌘K</span>
          </div>
        </div>

        <div className="top-bar-right">
          <ThemeToggle />
          <div className="status-indicator">
            <span className="status-dot"></span>
            <span>Gateway Active</span>
          </div>
          <UserMenu />
        </div>
      </header>

      {/* Main split container */}
      <div className="app-container">
        <aside className={`sidebar ${sidebarCollapsed ? "collapsed" : ""}`}>
          <nav className="nav-links">
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `nav-item ${isActive ? "active" : ""}`
                }
                title={sidebarCollapsed ? item.label : undefined}
              >
                <span
                  className="material-symbols-outlined"
                  style={{ fontSize: "18px" }}
                >
                  {item.icon}
                </span>
                {!sidebarCollapsed && (
                  <span className="nav-label">{item.label}</span>
                )}
              </NavLink>
            ))}
          </nav>
          <div className="sidebar-toggle-wrap" style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
            <button
              className="sidebar-toggle"
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              <span
                className="material-symbols-outlined"
                style={{
                  fontSize: "18px",
                  transition: "transform 0.2s ease",
                  transform: sidebarCollapsed ? "rotate(180deg)" : "none",
                }}
              >
                chevron_left
              </span>
            </button>
          </div>
          <div
            className="sidebar-footer"
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "4px",
              textAlign: sidebarCollapsed ? "center" : "left",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: sidebarCollapsed ? "center" : "space-between",
                padding: "2px 2px",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  fontWeight: "600",
                  fontSize: "11px",
                  color:
                    systemMetrics?.health?.status === "healthy"
                      ? "var(--color-success)"
                      : systemMetrics?.health?.status === "degraded"
                      ? "var(--color-warning)"
                      : "var(--color-danger)",
                }}
                title={`System Health: ${systemMetrics?.health?.status || "online"}`}
              >
                <span className="status-dot"></span>
                {!sidebarCollapsed && (
                  <span>
                    Gateway{" "}
                    {systemMetrics?.health?.status
                      ? systemMetrics.health.status.charAt(0).toUpperCase() +
                        systemMetrics.health.status.slice(1)
                      : "Online"}
                  </span>
                )}
              </div>
            </div>

            {!sidebarCollapsed && systemMetrics && (
              <div className="metrics-container">
                {/* Storage */}
                <div className="metric-item">
                  <div className="metric-header">
                    <span className="metric-label">
                      <span className="material-symbols-outlined" style={{ fontSize: "12px" }}>
                        hard_drive
                      </span>
                      Storage
                    </span>
                    <span className="metric-value">
                      {systemMetrics.storage?.used?.toFixed(0) || 0}%
                    </span>
                  </div>
                  <div className="metric-bar-bg">
                    <div
                      className="metric-bar-fill"
                      style={{
                        width: `${Math.min(100, Math.max(0, systemMetrics.storage?.used || 0))}%`,
                        backgroundColor:
                          (systemMetrics.storage?.used || 0) > 90
                            ? "var(--color-danger)"
                            : (systemMetrics.storage?.used || 0) > 80
                            ? "var(--color-warning)"
                            : "var(--color-primary)",
                      }}
                    />
                  </div>
                  <div className="metric-subtext">
                    {formatBytes(systemMetrics.storage?.used_bytes)} / {formatBytes(systemMetrics.storage?.total)}
                  </div>
                </div>

                {/* Memory */}
                <div className="metric-item">
                  <div className="metric-header">
                    <span className="metric-label">
                      <span className="material-symbols-outlined" style={{ fontSize: "12px" }}>
                        memory
                      </span>
                      Memory
                    </span>
                    <span className="metric-value">
                      {systemMetrics.memory?.used?.toFixed(0) || 0}%
                    </span>
                  </div>
                  <div className="metric-bar-bg">
                    <div
                      className="metric-bar-fill"
                      style={{
                        width: `${Math.min(100, Math.max(0, systemMetrics.memory?.used || 0))}%`,
                        backgroundColor:
                          (systemMetrics.memory?.used || 0) > 90
                            ? "var(--color-danger)"
                            : (systemMetrics.memory?.used || 0) > 80
                            ? "var(--color-warning)"
                            : "var(--color-primary)",
                      }}
                    />
                  </div>
                  <div className="metric-subtext">
                    {formatBytes(systemMetrics.memory?.used_bytes)} / {formatBytes(systemMetrics.memory?.total)}
                  </div>
                </div>

                {/* CPU */}
                <div className="metric-item">
                  <div className="metric-header">
                    <span className="metric-label">
                      <span className="material-symbols-outlined" style={{ fontSize: "12px" }}>
                        speed
                      </span>
                      CPU
                    </span>
                    <span className="metric-value">
                      {systemMetrics.cpu?.usage?.toFixed(0) || 0}%
                    </span>
                  </div>
                  <div className="metric-bar-bg">
                    <div
                      className="metric-bar-fill"
                      style={{
                        width: `${Math.min(100, Math.max(0, systemMetrics.cpu?.usage || 0))}%`,
                        backgroundColor:
                          (systemMetrics.cpu?.usage || 0) > 90
                            ? "var(--color-danger)"
                            : (systemMetrics.cpu?.usage || 0) > 80
                            ? "var(--color-warning)"
                            : "var(--color-primary)",
                      }}
                    />
                  </div>
                  <div className="metric-subtext">
                    {systemMetrics.cpu?.count || 1} Cores
                  </div>
                </div>
              </div>
            )}

            {!sidebarCollapsed && !systemMetrics && (
              <div style={{ color: "var(--text-subtle)", fontSize: "10px", marginTop: "4px" }}>
                Loading metrics...
              </div>
            )}
          </div>
        </aside>

        <main className="main-content">
          <Suspense
            fallback={
              <div
                style={{
                  padding: "24px",
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  color: "var(--text-muted)",
                }}
              >
                <span
                  className="material-symbols-outlined"
                  style={{ animation: "spin 1s linear infinite" }}
                >
                  progress_activity
                </span>
                Loading page module...
              </div>
            }
          >
            <Routes>
              <Route path="/" element={<Navigate to="/usage" replace />} />
              <Route path="/usage" element={<UsagePage />} />
              <Route path="/endpoint" element={<EndpointPage />} />
              <Route path="/providers" element={<ProvidersPage />} />
              <Route path="/combos" element={<CombosPage />} />
              <Route path="/models" element={<ModelsPage />} />
              <Route path="/chat" element={<ChatPage />} />
              <Route path="/benchmark" element={<BenchmarkPage />} />
              <Route path="/traces" element={<TracesPage />} />
              <Route path="/quota" element={<QuotaPage />} />
              <Route path="/skills" element={<SkillsPage />} />
              <Route path="/console-log" element={<ConsoleLogPage />} />
            </Routes>
          </Suspense>
        </main>
      </div>
      <Snackbar />
    </div>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <AppShell />
      </AuthProvider>
    </ThemeProvider>
  );
}
