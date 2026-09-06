import { Suspense, lazy, useEffect, useRef, useState } from 'react'
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import {
  Activity,
  ChevronsLeft,
  ChevronDown,
  CircuitBoard,
  Download,
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
  X,
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

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

function ThemeToggle() {
  const { theme, toggleTheme } = useTheme()
  const isDark = theme === 'dark'
  return (
    <IconButton label={isDark ? 'Switch to light mode' : 'Switch to dark mode'} onClick={toggleTheme}>
      {isDark ? <Sun size={15} /> : <Moon size={15} />}
    </IconButton>
  )
}

function PwaInstallButton() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [isInstalled, setIsInstalled] = useState(false)

  useEffect(() => {
    // Check if already in standalone display mode
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      ('standalone' in window.navigator && Boolean((window.navigator as unknown as { standalone?: boolean }).standalone))
    if (isStandalone) {
      setIsInstalled(true)
      return
    }

    const handleBeforeInstall = (e: Event) => {
      e.preventDefault()
      setDeferredPrompt(e as BeforeInstallPromptEvent)
    }

    const handleAppInstalled = () => {
      setIsInstalled(true)
      setDeferredPrompt(null)
    }

    window.addEventListener('beforeinstallprompt', handleBeforeInstall)
    window.addEventListener('appinstalled', handleAppInstalled)

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall)
      window.removeEventListener('appinstalled', handleAppInstalled)
    }
  }, [])

  if (isInstalled || !deferredPrompt) return null

  const handleInstallClick = async () => {
    if (!deferredPrompt) return
    await deferredPrompt.prompt()
    const choice = await deferredPrompt.userChoice
    if (choice.outcome === 'accepted') {
      setIsInstalled(true)
    }
    setDeferredPrompt(null)
  }

  return (
    <button
      onClick={handleInstallClick}
      title="Install standalone app viewer"
      aria-label="Install standalone app viewer"
      className="inline-flex h-8 items-center gap-1.5 rounded-md border border-accent bg-accent-subtle px-2.5 text-xs font-medium text-accent transition-colors hover:brightness-105"
    >
      <Download size={13} />
      <span className="hidden xs:inline">Install App</span>
    </button>
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
  const location = useLocation()
  const navigate = useNavigate()
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem('sidebarCollapsed') === 'true')
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const mobileMenuRef = useRef<HTMLDivElement>(null)
  const metrics = useSystemMetrics()

  // Close mobile dropdown menu whenever route changes
  useEffect(() => {
    setMobileMenuOpen(false)
  }, [location.pathname])

  // Close mobile menu on outside click or escape key
  useEffect(() => {
    if (!mobileMenuOpen) return
    const handleClickOutside = (e: MouseEvent) => {
      if (mobileMenuRef.current && !mobileMenuRef.current.contains(e.target as Node)) {
        setMobileMenuOpen(false)
      }
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobileMenuOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [mobileMenuOpen])

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

  const currentNav = NAV_ITEMS.find((item) => location.pathname === item.to || location.pathname.startsWith(`${item.to}/`)) ?? NAV_ITEMS[0]
  const CurrentNavIcon = currentNav.icon

  return (
    <div className="flex h-dvh flex-col bg-bg">
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-border bg-surface px-3 pt-safe">
        <div className="flex items-center gap-2">
          {/* Mobile menu dropdown trigger */}
          <button
            type="button"
            onClick={() => setMobileMenuOpen((v) => !v)}
            className="flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface-2 px-2 text-xs font-medium text-text md:hidden transition-colors hover:bg-surface"
            aria-label="Navigation menu"
            aria-expanded={mobileMenuOpen}
          >
            {mobileMenuOpen ? <X size={15} /> : <CurrentNavIcon size={15} className="text-accent" />}
            <span className="max-w-[85px] truncate font-medium">{currentNav.label}</span>
            <ChevronDown size={13} className={cn('text-muted transition-transform duration-200', mobileMenuOpen && 'rotate-180')} />
          </button>

          {/* Brand Logo & Name */}
          <div
            onClick={() => navigate('/usage')}
            className="flex cursor-pointer items-center gap-2 select-none"
          >
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-accent text-on-accent shadow-xs">
              <RouteIcon size={15} />
            </div>
            <span className="text-sm font-semibold tracking-tight">myAiRouter</span>
            {version && <span className="tnum hidden text-[10px] text-subtle sm:inline">{version}</span>}
          </div>
        </div>

        <div className="flex items-center gap-1.5 sm:gap-2">
          <PwaInstallButton />
          <ThemeToggle />
          <UserMenu />
        </div>
      </header>

      {/* Mobile navigation dropdown menu */}
      {mobileMenuOpen && (
        <div
          ref={mobileMenuRef}
          className="border-b border-border bg-surface shadow-xl md:hidden z-50 animate-[slide-up_150ms_ease-out]"
        >
          <div className="p-2 border-b border-border bg-surface-2/40">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-subtle px-2 py-1">
              Select page
            </div>
            <div className="grid grid-cols-2 gap-1 mt-1">
              {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
                <NavLink
                  key={to}
                  to={to}
                  onClick={() => setMobileMenuOpen(false)}
                  className={({ isActive }) =>
                    cn(
                      'flex items-center gap-2 rounded-md px-2.5 py-2 text-xs transition-colors',
                      isActive ? 'bg-accent-subtle font-semibold text-accent' : 'text-muted hover:bg-surface hover:text-text',
                    )
                  }
                >
                  <Icon size={15} className="shrink-0" />
                  <span className="truncate">{label}</span>
                </NavLink>
              ))}
            </div>
          </div>

          {/* Mobile metrics footer */}
          <div className="p-3 bg-surface">
            <SidebarFooter metrics={metrics} collapsed={false} />
          </div>
        </div>
      )}

      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Desktop sidebar */}
        <aside
          className={cn(
            'hidden md:flex shrink-0 flex-col justify-between border-r border-border bg-surface py-3 transition-[width] duration-200',
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

        {/* Main page content area */}
        <main className="min-w-0 flex-1 overflow-y-auto pb-safe">
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
