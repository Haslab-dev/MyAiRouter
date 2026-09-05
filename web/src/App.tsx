import { Suspense, lazy, useEffect, useState } from 'react'
import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import {
  Activity,
  ChevronsLeft,
  CircuitBoard,
  GitCompare,
  Gauge,
  HardDrive,
  LayoutDashboard,
  MessagesSquare,
  Network,
  Route as RouteIcon,
  ScanSearch,
  Sun,
  Moon,
  Workflow,
} from 'lucide-react'
import { useAuth, AuthProvider } from '@/contexts/AuthContext'
import { useTheme, ThemeProvider } from '@/contexts/ThemeContext'
import { api } from '@/lib/api'
import { formatBytes, type SystemMetrics } from '@/lib/types'
import { cn } from '@/lib/cn'
import { IconButton, Spinner } from '@/components/ui'
import Snackbar from '@/components/Snackbar'
import UserMenu from '@/components/UserMenu'

const EndpointPage = lazy(() => import('@/pages/EndpointPage'))
const ProvidersPage = lazy(() => import('@/pages/ProvidersPage'))
const CombosPage = lazy(() => import('@/pages/CombosPage'))
const UsagePage = lazy(() => import('@/pages/UsagePage'))
const ModelsPage = lazy(() => import('@/pages/ModelsPage'))
const SkillsPage = lazy(() => import('@/pages/SkillsPage'))
const QuotaPage = lazy(() => import('@/pages/QuotaPage'))
const ConsoleLogPage = lazy(() => import('@/pages/ConsoleLogPage'))
const TracesPage = lazy(() => import('@/pages/TracesPage'))
const ChatPage = lazy(() => import('@/pages/ChatPage'))
const BenchmarkPage = lazy(() => import('@/pages/BenchmarkPage'))
const LoginPage = lazy(() => import('@/pages/LoginPage'))
const OnboardingPage = lazy(() => import('@/pages/OnboardingPage'))

const NAV_ITEMS = [
  { to: '/usage', label: 'Overview', icon: LayoutDashboard },
  { to: '/chat', label: 'Chat', icon: MessagesSquare },
  { to: '/benchmark', label: 'Benchmark', icon: GitCompare },
  { to: '/endpoint', label: 'Gateway', icon: Network },
  { to: '/providers', label: 'Providers', icon: HardDrive },
  { to: '/combos', label: 'Routes', icon: RouteIcon },
  { to: '/models', label: 'Models', icon: Workflow },
  { to: '/traces', label: 'Traces', icon: ScanSearch },
  { to: '/quota', label: 'Health', icon: Gauge },
  { to: '/skills', label: 'Skills', icon: CircuitBoard },
  { to: '/console-log', label: 'Traffic', icon: Activity },
] as const

function ThemeToggle() {
  const { theme, toggleTheme } = useTheme()
  const isDark = theme === 'dark'
  return (
    <IconButton label={isDark ? 'Switch to light mode' : 'Switch to dark mode'} onClick={toggleTheme}>
      {isDark ? <Sun size={15} /> : <Moon size={15} />}
    </IconButton>
  )
}

function MetricBar({ label, icon: Icon, used, total }: { label: string; icon: typeof HardDrive; used: number; total?: number }) {
  const pct = Math.min(100, Math.max(0, used))
  const tone = pct > 90 ? 'bg-danger' : pct > 80 ? 'bg-warning' : 'bg-accent'
  return (
    <div>
      <div className="flex items-center justify-between text-[10px] text-muted">
        <span className="inline-flex items-center gap-1">
          <Icon size={11} />
          {label}
        </span>
        <span className="tnum">{pct.toFixed(0)}%</span>
      </div>
      <div className="mt-1 h-1 w-full rounded-full bg-surface-2 overflow-hidden">
        <div className={`h-full rounded-full ${tone} transition-[width] duration-500`} style={{ width: `${pct}%` }} />
      </div>
      {total !== undefined && total > 0 && (
        <div className="mt-0.5 text-[9px] text-subtle tnum">{formatBytes(total * (pct / 100))} / {formatBytes(total)}</div>
      )}
    </div>
  )
}

function SidebarFooter({ metrics, collapsed }: { metrics: SystemMetrics | null; collapsed: boolean }) {
  const health = metrics?.health?.status ?? 'online'
  const healthTone = health === 'healthy' ? 'text-success' : health === 'degraded' ? 'text-warning' : 'text-success'

  return (
    <div className={cn('flex flex-col gap-2', collapsed && 'items-center')}>
      <div className={cn('flex items-center gap-1.5 text-[11px] font-medium', healthTone)} title={`System health: ${health}`}>
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-current" />
        {!collapsed && <span>Gateway {health.charAt(0).toUpperCase() + health.slice(1)}</span>}
      </div>

      {!collapsed && metrics && (
        <div className="flex flex-col gap-2 border-t border-border pt-2">
          <MetricBar label="Storage" icon={HardDrive} used={metrics.storage?.used ?? 0} total={metrics.storage?.total} />
          <MetricBar label="Memory" icon={Gauge} used={metrics.memory?.used ?? 0} total={metrics.memory?.total} />
          <MetricBar label="CPU" icon={Gauge} used={metrics.cpu?.usage ?? 0} />
        </div>
      )}
      {!collapsed && !metrics && <div className="text-[10px] text-subtle">Loading metrics…</div>}
    </div>
  )
}

function useSystemMetrics() {
  const [metrics, setMetrics] = useState<SystemMetrics | null>(null)
  useEffect(() => {
    let cancelled = false
    const fetchMetrics = async () => {
      try {
        const data = await api.get<SystemMetrics>('/api/system/metrics')
        if (!cancelled) setMetrics(data)
      } catch {
        /* transient */
      }
    }
    fetchMetrics()
    const interval = setInterval(fetchMetrics, 30_000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [])
  return metrics
}

function AppShell() {
  const { status, onboardingDone } = useAuth()
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem('sidebarCollapsed') === 'true')
  const metrics = useSystemMetrics()

  if (status === null) {
    return (
      <div className="flex min-h-screen items-center justify-center gap-2.5 bg-bg text-sm text-muted">
        <Spinner />
        Connecting to gateway…
      </div>
    )
  }

  if (!onboardingDone) return <OnboardingPage />
  if (status.requireLogin && !status.authenticated) return <LoginPage />

  // /api/auth/status returns the version already prefixed with "v".
  const version = status.version ?? ''

  return (
    <div className="flex h-screen flex-col bg-bg">
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-border bg-surface px-3">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-accent text-on-accent">
            <RouteIcon size={15} />
          </div>
          <span className="text-sm font-semibold tracking-tight">myAiRouter</span>
          {version && <span className="tnum text-[10px] text-subtle">{version}</span>}
        </div>

        <div className="flex items-center gap-2">
          <ThemeToggle />
          <UserMenu />
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside
          className={cn(
            'flex shrink-0 flex-col justify-between border-r border-border bg-surface py-3 transition-[width] duration-200',
            sidebarCollapsed ? 'w-14 items-center' : 'w-48',
          )}
        >
          <nav className={cn('flex flex-1 flex-col gap-0.5 px-2', sidebarCollapsed && 'px-1.5')}>
            {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                title={sidebarCollapsed ? label : undefined}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] transition-colors',
                    isActive ? 'bg-accent-subtle text-accent font-medium' : 'text-muted hover:bg-surface-2 hover:text-text',
                    sidebarCollapsed && 'justify-center px-0',
                  )
                }
              >
                <Icon size={16} className="shrink-0" />
                {!sidebarCollapsed && <span>{label}</span>}
              </NavLink>
            ))}
          </nav>

          <div className={cn('flex flex-col gap-3 px-2', sidebarCollapsed && 'px-0 items-center')}>
            <SidebarFooter metrics={metrics} collapsed={sidebarCollapsed} />
            <button
              onClick={() => {
                setSidebarCollapsed(!sidebarCollapsed)
                localStorage.setItem('sidebarCollapsed', String(!sidebarCollapsed))
              }}
              className="flex w-full items-center justify-center rounded-md border border-border py-1 text-muted transition-colors hover:bg-surface-2 hover:text-text"
              title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              <ChevronsLeft size={14} className={cn('transition-transform', sidebarCollapsed && 'rotate-180')} />
            </button>
          </div>
        </aside>

        <main className="min-w-0 flex-1 overflow-y-auto">
          <Suspense
            fallback={
              <div className="flex items-center gap-2 p-6 text-sm text-muted">
                <Spinner />
                Loading page…
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
  )
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <AppShell />
      </AuthProvider>
    </ThemeProvider>
  )
}
