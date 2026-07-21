import { useState, useEffect, lazy, Suspense } from 'react';
import { Routes, Route, NavLink, Navigate } from 'react-router-dom';
import UserMenu from './components/UserMenu';
import Snackbar from './components/Snackbar';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ThemeProvider, useTheme } from './contexts/ThemeContext';

const EndpointPage = lazy(() => import('./pages/EndpointPage'));
const ProvidersPage = lazy(() => import('./pages/ProvidersPage'));
const CombosPage = lazy(() => import('./pages/CombosPage'));
const UsagePage = lazy(() => import('./pages/UsagePage'));
const TokenSaverPage = lazy(() => import('./pages/TokenSaverPage'));
const SkillsPage = lazy(() => import('./pages/SkillsPage'));
const QuotaPage = lazy(() => import('./pages/QuotaPage'));
const ConsoleLogPage = lazy(() => import('./pages/ConsoleLogPage'));
const TracesPage = lazy(() => import('./pages/TracesPage'));
const LoginPage = lazy(() => import('./pages/LoginPage'));
const OnboardingPage = lazy(() => import('./pages/OnboardingPage'));

const NAV_ITEMS = [
  { to: '/usage', label: 'Overview', icon: 'dashboard' },
  { to: '/endpoint', label: 'Gateway', icon: 'explore' },
  { to: '/providers', label: 'Providers', icon: 'dns' },
  { to: '/combos', label: 'Routes', icon: 'alt_route' },
  { to: '/token-saver', label: 'Compression', icon: 'compress' },
  { to: '/traces', label: 'Traces', icon: 'history_toggle_off' },
  { to: '/quota', label: 'Health', icon: 'health_and_safety' },
  { to: '/skills', label: 'Skills', icon: 'conversion_path' },
  { to: '/console-log', label: 'Traffic', icon: 'insights' },
];

function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === 'dark';

  return (
    <button
      onClick={toggleTheme}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '32px',
        height: '32px',
        borderRadius: '8px',
        border: '1px solid var(--border-color)',
        background: 'transparent',
        cursor: 'pointer',
        color: 'var(--text-muted)',
        transition: 'all 0.2s ease',
      }}
      title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
    >
      {isDark ? (
        <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>light_mode</span>
      ) : (
        <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>dark_mode</span>
      )}
    </button>
  );
}

function AppShell() {
  const { status, onboardingDone } = useAuth();
  const [providerCount, setProviderCount] = useState(0);
  const [modelCount, setModelCount] = useState(0);

  useEffect(() => {
    const fetchCounts = async () => {
      try {
        const res = await fetch('/api/providers');
        if (res.ok) {
const conns = (await res.json()) || [];
const activeConns = conns.filter(c => c.isActive);
          setProviderCount(activeConns.length);
        }
        const mRes = await fetch('/v1/models');
        if (mRes.ok) {
          const modelsData = await mRes.json();
          setModelCount(modelsData.data?.length || 0);
        }
      } catch (err) {
        console.error('Error fetching count statistics:', err);
      }
    };
    fetchCounts();
  }, []);

  // Loading state
  if (status === null) {
    return (
      <div style={{
        minHeight: '100vh', background: 'var(--bg-color)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: 'var(--text-muted)', fontSize: '14px', gap: '10px',
      }}>
        <span className="material-symbols-outlined" style={{ fontSize: '20px', animation: 'spin 1s linear infinite' }}>progress_activity</span>
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
            <span className="material-symbols-outlined logo-icon-top">router</span>
            <div className="logo-text-wrapper">
              <span className="logo-text-top">myAiRouter</span>
              <span className="logo-version">v0.2.4</span>
            </div>
          </div>
        </div>

        <div className="top-bar-center">
          <div className="search-wrapper">
            <span className="material-symbols-outlined search-icon">search</span>
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
        <aside className="sidebar">
          <nav className="nav-links">
            {NAV_ITEMS.map(item => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
              >
                <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>{item.icon}</span>
                {item.label}
              </NavLink>
            ))}
          </nav>
          <div className="sidebar-footer" style={{ display: 'flex', flexDirection: 'column', gap: '6px', textAlign: 'left', fontSize: '10px', color: 'var(--text-muted)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--color-success)', fontWeight: '600', marginBottom: '2px' }}>
              <span className="status-dot"></span>
              Gateway Online
            </div>
            <div>{providerCount} Active Providers</div>
            <div>{modelCount} Live Models</div>
          </div>
        </aside>

        <main className="main-content">
          <Suspense fallback={
            <div style={{ padding: '24px', display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-muted)' }}>
              <span className="material-symbols-outlined" style={{ animation: 'spin 1s linear infinite' }}>progress_activity</span>
              Loading page module...
            </div>
          }>
            <Routes>
              <Route path="/" element={<Navigate to="/usage" replace />} />
              <Route path="/usage" element={<UsagePage />} />
              <Route path="/endpoint" element={<EndpointPage />} />
              <Route path="/providers" element={<ProvidersPage />} />
              <Route path="/combos" element={<CombosPage />} />
              <Route path="/token-saver" element={<TokenSaverPage />} />
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
