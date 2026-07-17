import { useState, useEffect } from 'react';
import { Routes, Route, NavLink, Navigate } from 'react-router-dom';
import EndpointPage from './pages/EndpointPage';
import ProvidersPage from './pages/ProvidersPage';
import CombosPage from './pages/CombosPage';
import UsagePage from './pages/UsagePage';
import TokenSaverPage from './pages/TokenSaverPage';
import SkillsPage from './pages/SkillsPage';
import QuotaPage from './pages/QuotaPage';
import ConsoleLogPage from './pages/ConsoleLogPage';
import TracesPage from './pages/TracesPage';
import LoginPage from './pages/LoginPage';
import OnboardingPage from './pages/OnboardingPage';
import UserMenu from './components/UserMenu';
import { AuthProvider, useAuth } from './contexts/AuthContext';

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

function AppShell() {
  const { status, onboardingDone } = useAuth();
  const [providerCount, setProviderCount] = useState(0);
  const [modelCount, setModelCount] = useState(0);

  useEffect(() => {
    const fetchCounts = async () => {
      try {
        const res = await fetch('/api/providers');
        if (res.ok) {
          const conns = await res.json();
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
        minHeight: '100vh', background: '#0B0F14',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: '#9AA5B5', fontSize: '14px', gap: '10px',
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
            <span className="logo-text-top">myAiRouter</span>
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
        </main>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppShell />
    </AuthProvider>
  );
}
