import { useState } from 'react'
import { Eye, EyeOff, LockKeyhole, Route as RouteIcon } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { Button, Input } from '@/components/ui'

export default function LoginPage() {
  const { login } = useAuth()
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [showPw, setShowPw] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await login(password)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-5">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-accent text-on-accent">
            <RouteIcon size={24} />
          </div>
          <h1 className="text-xl font-semibold tracking-tight text-text">myAiRouter</h1>
          <p className="mt-1.5 text-[13px] text-muted">Enter your password to access the gateway</p>
        </div>

        <form onSubmit={handleSubmit} className="rounded-lg border border-border bg-surface p-6">
          <label className="mb-1.5 block text-xs font-medium text-muted">Password</label>
          <div className="relative">
            <Input
              type={showPw ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter gateway password"
              autoFocus
              className={error ? 'border-danger' : ''}
            />
            <button
              type="button"
              onClick={() => setShowPw((v) => !v)}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted transition-colors hover:text-text"
              aria-label={showPw ? 'Hide password' : 'Show password'}
            >
              {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </div>
          {error && <p className="mt-2 text-xs text-danger">{error}</p>}

          <Button
            type="submit"
            variant="primary"
            loading={loading}
            disabled={!password}
            className="mt-4 h-10 w-full text-sm"
          >
            {!loading && <LockKeyhole size={14} />}
            {loading ? 'Authenticating…' : 'Sign in'}
          </Button>
        </form>

        <p className="mt-4 text-center text-[11px] text-subtle">
          Default password: <code className="font-mono text-muted">123456789</code> — change it after first login.
        </p>
      </div>
    </div>
  )
}
