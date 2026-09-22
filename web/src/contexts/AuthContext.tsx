import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api } from '@/lib/api'
import type { AuthStatus } from '@/lib/types'

const AuthContext = createContext<{
  status: AuthStatus | null
  login: (password: string) => Promise<void>
  logout: () => Promise<void>
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>
  refetch: () => Promise<void>
  onboardingDone: boolean
  completeOnboarding: () => void
} | null>(null)

const ONBOARDING_KEY = 'myairouter_onboarding_done'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus | null>(null)
  const [onboardingDone, setOnboardingDone] = useState(false)

  // Per-tab session verification. A valid cookie in another tab must NOT
  // grant this tab access: opening the dashboard in a fresh tab/browser
  // always requires the password. sessionStorage is per-tab by design, so a
  // missing flag here means this tab never completed a login.
  const TAB_AUTH_KEY = 'myairouter_tab_authenticated'

  const fetchStatus = useCallback(async () => {
  	try {
  		let data = await api.get<AuthStatus>('/api/auth/status')
  		if (data.requireLogin && data.authenticated && sessionStorage.getItem(TAB_AUTH_KEY) !== 'true') {
  			// A session cookie from another tab does NOT grant this tab access.
  			// Suppress locally only — calling the logout endpoint here would
  			// also kill the session of the tab that legitimately logged in.
  			data = { ...data, authenticated: false }
  		}
  		setStatus(data)
  	} catch {
  		// Fail-safe: if the status probe fails we cannot prove the dashboard is
  		// open, so land on the login screen rather than exposing admin routes.
  		setStatus({ requireLogin: true, authenticated: false })
  	}
  }, [])

  useEffect(() => {
    fetchStatus()
    setOnboardingDone(localStorage.getItem(ONBOARDING_KEY) === 'true')
  }, [fetchStatus])

  const completeOnboarding = useCallback(() => {
    localStorage.setItem(ONBOARDING_KEY, 'true')
    setOnboardingDone(true)
  }, [])

  const login = useCallback(
    async (password: string) => {
      await api.post('/api/auth/login', { password })
      sessionStorage.setItem(TAB_AUTH_KEY, 'true')
      await fetchStatus()
    },
    [fetchStatus],
  )

  const logout = useCallback(async () => {
    try {
      await api.post('/api/auth/logout')
    } finally {
      sessionStorage.removeItem(TAB_AUTH_KEY)
      setStatus((prev) => ({
        requireLogin: prev?.requireLogin ?? true,
        authenticated: false,
        version: prev?.version,
      }))
    }
  }, [])

  const changePassword = useCallback(async (currentPassword: string, newPassword: string) => {
    await api.post('/api/auth/change-password', { currentPassword, newPassword })
  }, [])

  const value = useMemo(
    () => ({ status, login, logout, changePassword, refetch: fetchStatus, onboardingDone, completeOnboarding }),
    [status, login, logout, changePassword, fetchStatus, onboardingDone, completeOnboarding],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider')
  return ctx
}
