import { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';

const AuthContext = createContext(null);

const ONBOARDING_KEY = 'myairouter_onboarding_done';

/** Parse the nested error shape: { error: { message: "...", type: "..." } } */
function parseApiError(data, fallback) {
  if (!data) return fallback;
  if (data.error?.message) return data.error.message;
  if (typeof data.error === 'string') return data.error;
  if (typeof data.message === 'string') return data.message;
  return fallback;
}

export function AuthProvider({ children }) {
  const [status, setStatus] = useState(null);
  const [onboardingDone, setOnboardingDone] = useState(false);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/status');
      if (res.ok) {
        const data = await res.json();
        setStatus(data);
      }
    } catch {
      setStatus({ requireLogin: false, authenticated: true });
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    setOnboardingDone(localStorage.getItem(ONBOARDING_KEY) === 'true');
  }, [fetchStatus]);

  const completeOnboarding = useCallback(() => {
    localStorage.setItem(ONBOARDING_KEY, 'true');
    setOnboardingDone(true);
  }, []);

  const login = useCallback(async (password) => {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      throw new Error(parseApiError(d, 'Invalid password'));
    }
    await fetchStatus();
  }, [fetchStatus]);

  const logout = useCallback(async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    await fetchStatus();
  }, [fetchStatus]);

  const changePassword = useCallback(async (currentPassword, newPassword) => {
    const res = await fetch('/api/auth/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      throw new Error(parseApiError(d, 'Failed to change password'));
    }
  }, []);

  const value = useMemo(() => ({
    status,
    login,
    logout,
    changePassword,
    refetch: fetchStatus,
    onboardingDone,
    completeOnboarding,
  }), [status, login, logout, changePassword, fetchStatus, onboardingDone, completeOnboarding]);

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
