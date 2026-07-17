import { createContext, useContext, useState, useEffect, useCallback } from 'react';

const AuthContext = createContext(null);

const ONBOARDING_KEY = 'myairouter_onboarding_done';

/** Parse the nested error shape: { error: { message: "...", type: "..." } } */
function parseApiError(data, fallback) {
  if (!data) return fallback;
  // Handle { error: { message: "..." } }
  if (data.error?.message) return data.error.message;
  // Handle { error: "string" }
  if (typeof data.error === 'string') return data.error;
  // Handle { message: "string" }
  if (typeof data.message === 'string') return data.message;
  return fallback;
}

export function AuthProvider({ children }) {
  const [status, setStatus] = useState(null); // null = loading
  const [onboardingDone, setOnboardingDone] = useState(false);
  // status: { requireLogin: bool, authenticated: bool }

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

  const completeOnboarding = () => {
    localStorage.setItem(ONBOARDING_KEY, 'true');
    setOnboardingDone(true);
  };

  const login = async (password) => {
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
  };

  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    await fetchStatus();
  };

  const changePassword = async (currentPassword, newPassword) => {
    const res = await fetch('/api/auth/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      throw new Error(parseApiError(d, 'Failed to change password'));
    }
  };

  return (
    <AuthContext.Provider value={{ status, login, logout, changePassword, refetch: fetchStatus, onboardingDone, completeOnboarding }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
