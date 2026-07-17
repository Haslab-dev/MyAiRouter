import { Routes, Route, NavLink, Navigate } from 'react-router-dom';
import EndpointPage from './pages/EndpointPage';
import ProvidersPage from './pages/ProvidersPage';
import CombosPage from './pages/CombosPage';
import UsagePage from './pages/UsagePage';
import TokenSaverPage from './pages/TokenSaverPage';
import SkillsPage from './pages/SkillsPage';
import QuotaPage from './pages/QuotaPage';
import ConsoleLogPage from './pages/ConsoleLogPage';

const NAV_ITEMS = [
  { to: '/endpoint', label: 'Endpoint', icon: 'explore' },
  { to: '/providers', label: 'Providers', icon: 'dns' },
  { to: '/combos', label: 'Combos', icon: 'layers' },
  { to: '/usage', label: 'Usage', icon: 'bar_chart' },
  { to: '/quota', label: 'Quota', icon: 'hourglass_empty' },
  { to: '/token-saver', label: 'Token Saver', icon: 'offline_bolt' },
  { to: '/skills', label: 'Skills', icon: 'extension' },
  { to: '/console-log', label: 'Console Log', icon: 'list_alt' },
];

export default function App() {
  return (
    <div className="app-container">
      <aside className="sidebar">
        <div className="logo-section">
          <div className="logo-icon">
            <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>router</span>
          </div>
          <div>
            <div className="logo-text">myAiRouter</div>
            <div style={{ fontSize: '10px', color: 'var(--text-subtle)', marginTop: '1px' }}>v0.2.0 · local gateway</div>
          </div>
        </div>

        <div style={{ flexGrow: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '2px' }}>
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
        </div>

        <div style={{ marginTop: 'auto', paddingTop: '16px', borderTop: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', gap: '10px', fontSize: '11px', color: 'var(--text-subtle)' }}>
          <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>circle</span>
          Gateway Active
        </div>
      </aside>

      <main className="main-content">
        <Routes>
          <Route path="/" element={<Navigate to="/usage" replace />} />
          <Route path="/endpoint" element={<EndpointPage />} />
          <Route path="/providers" element={<ProvidersPage />} />
          <Route path="/combos" element={<CombosPage />} />
          <Route path="/usage" element={<UsagePage />} />
          <Route path="/quota" element={<QuotaPage />} />
          <Route path="/token-saver" element={<TokenSaverPage />} />
          <Route path="/skills" element={<SkillsPage />} />
          <Route path="/console-log" element={<ConsoleLogPage />} />
        </Routes>
      </main>
    </div>
  );
}
