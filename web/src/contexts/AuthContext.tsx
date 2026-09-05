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

  const fetchStatus = useCallback(async () => {
    try {
      const data = await api.get<AuthStatus>('/api/auth/status')
      setStatus(data)
    } catch {
      setStatus({ requireLogin: false, authenticated: true })
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
      await fetchStatus()
    },
    [fetchStatus],
  )

  const logout = useCallback(async () => {
    await api.post('/api/auth/logout')
    await fetchStatus()
  }, [fetchStatus])

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
