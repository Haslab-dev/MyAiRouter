import { useState } from 'react'
import { ArrowRight, Check, Eye, EyeOff, KeyRound, LayoutDashboard, MonitorCog, ShieldCheck, Workflow } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { api } from '@/lib/api'
import { Button, Field, Input, Toggle } from '@/components/ui'
import { cn } from '@/lib/cn'

const STEPS = [
  { id: 'welcome', label: 'Welcome' },
  { id: 'security', label: 'Security' },
  { id: 'connect', label: 'Connect' },
  { id: 'done', label: 'Done' },
]

const PROVIDERS = [
  { id: 'openai', label: 'OpenAI', isCore: true },
  { id: 'anthropic', label: 'Anthropic', isCore: true },
  { id: 'gemini', label: 'Gemini', isCore: true },
  { id: 'openai-compatible', label: 'OpenAI Compatible', isCore: false },
]

function StepWelcome({ onNext }: { onNext: () => void }) {
  return (
    <div className="text-center">
      <h1 className="mb-3 text-xl font-semibold tracking-tight text-text">Welcome to myAiRouter</h1>
      <p className="mx-auto mb-8 max-w-sm text-[13px] leading-relaxed text-muted">
        Your self-hosted AI gateway. Route requests across multiple providers, manage keys, and monitor traffic — all from one place.
      </p>

      <div className="mx-auto mb-8 grid max-w-sm grid-cols-3 gap-2.5">
        {[
          { icon: Workflow, label: 'Smart Routing', desc: 'Fallback across providers' },
          { icon: MonitorCog, label: 'Pass-through', desc: 'No forced rewriting' },
          { icon: LayoutDashboard, label: 'Analytics', desc: 'Full traffic visibility' },
        ].map(({ icon: Icon, label, desc }) => (
          <div key={label} className="rounded-lg border border-border bg-surface-2 p-3 text-center">
            <Icon size={18} className="mx-auto mb-1.5 text-accent" />
            <div className="text-xs font-semibold text-text">{label}</div>
            <div className="mt-0.5 text-[10px] text-muted">{desc}</div>
          </div>
        ))}
      </div>

      <Button variant="primary" onClick={onNext}>
        Get started <ArrowRight size={14} />
      </Button>
    </div>
  )
}

function StepPassword({ onNext, onSkip }: { onNext: () => void; onSkip: () => void }) {
  const { login, changePassword } = useAuth()
  const [pw, setPw] = useState('')
  const [confirm, setConfirm] = useState('')
  const [enableAuth, setEnableAuth] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [showPw, setShowPw] = useState(false)

  const handleContinue = async () => {
    setError('')
    if (enableAuth) {
      if (pw.length < 6) {
        setError('Password must be at least 6 characters')
        return
      }
      if (pw !== confirm) {
        setError('Passwords do not match')
        return
      }
      setLoading(true)
      try {
        await changePassword('123456789', pw)
        await api.patch('/api/settings', { requireLogin: true })
        await login(pw)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
        setLoading(false)
        return
      }
    }
    setLoading(false)
    onNext()
  }

  return (
    <div>
      <div className="mb-7 text-center">
        <span className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-lg border border-border bg-surface-2 text-warning">
          <ShieldCheck size={20} />
        </span>
        <h2 className="text-lg font-semibold text-text">Secure your gateway</h2>
        <p className="mx-auto mt-1 max-w-xs text-[13px] text-muted">
          Optionally protect the dashboard with a password. You can change this later in settings.
        </p>
      </div>

      <div
        className="mb-5 flex cursor-pointer items-center justify-between rounded-lg border border-border bg-surface-2 px-4 py-3"
        onClick={() => setEnableAuth((v) => !v)}
      >
        <div>
          <div className="text-[13px] font-medium text-text">Enable password protection</div>
          <div className="mt-0.5 text-[11px] text-muted">Require login to access the dashboard</div>
        </div>
        <Toggle checked={enableAuth} onChange={setEnableAuth} label="Enable password protection" />
      </div>

      {enableAuth && (
        <div className="mb-5 flex flex-col gap-3">
          <Field label="New password">
            <div className="relative">
              <Input type={showPw ? 'text' : 'password'} value={pw} onChange={(e) => setPw(e.target.value)} placeholder="At least 6 characters" />
              <button
                type="button"
                onClick={() => setShowPw((v) => !v)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted hover:text-text"
                aria-label={showPw ? 'Hide password' : 'Show password'}
              >
                {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </Field>
          <Field label="Confirm password">
            <Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Repeat password" />
          </Field>
          {error && <p className="text-xs text-danger">{error}</p>}
        </div>
      )}

      <div className="flex gap-2">
        <Button variant="primary" className="flex-1" loading={loading} onClick={handleContinue}>
          {loading ? 'Saving…' : 'Continue'}
        </Button>
        {!enableAuth && <Button onClick={onSkip}>Skip</Button>}
      </div>
    </div>
  )
}

function StepProvider({ onNext }: { onNext: () => void }) {
  const [nodeType, setNodeType] = useState('')
  const [url, setUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const selected = PROVIDERS.find((p) => p.id === nodeType)

  const handleConnect = async () => {
    if (!nodeType || !apiKey) {
      setError('Select a provider and enter an API key')
      return
    }
    setLoading(true)
    setError('')
    try {
      await api.post('/api/providers', {
        provider: nodeType,
        name: `${selected?.label ?? 'Provider'} Key`,
        data: { apiKey, baseUrl: url || undefined },
        isActive: true,
        priority: 1,
      })
      onNext()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <div className="mb-7 text-center">
        <span className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-lg border border-border bg-surface-2 text-success">
          <KeyRound size={20} />
        </span>
        <h2 className="text-lg font-semibold text-text">Connect your first provider</h2>
        <p className="mx-auto mt-1 max-w-xs text-[13px] text-muted">Add an AI provider API key to start routing requests. You can add more later.</p>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-2">
        {PROVIDERS.map((p) => (
          <button
            key={p.id}
            onClick={() => setNodeType(p.id)}
            className={cn(
              'rounded-lg border px-3 py-2.5 text-left text-[13px] font-medium transition-colors',
              nodeType === p.id ? 'border-accent bg-accent-subtle text-accent' : 'border-border bg-surface-2 text-muted hover:text-text',
            )}
          >
            {p.label}
          </button>
        ))}
      </div>

      {nodeType && (
        <div className="mb-4 flex flex-col gap-3">
          {!selected?.isCore && (
            <Field label="Base URL">
              <Input type="text" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://api.example.com/v1" />
            </Field>
          )}
          <Field label="API key">
            <Input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="sk-…" />
          </Field>
          {error && <p className="text-xs text-danger">{error}</p>}
        </div>
      )}

      <div className="flex gap-2">
        <Button variant="primary" className="flex-1" loading={loading} disabled={!nodeType} onClick={handleConnect}>
          Connect provider
        </Button>
        <Button onClick={onNext}>Skip</Button>
      </div>
    </div>
  )
}

function StepDone({ onFinish }: { onFinish: () => void }) {
  return (
    <div className="text-center">
      <span className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-success text-on-accent">
        <Check size={26} />
      </span>
      <h2 className="mb-2 text-xl font-semibold text-text">You're all set</h2>
      <p className="mx-auto mb-7 max-w-sm text-[13px] leading-relaxed text-muted">
        Your gateway is ready. Head to the dashboard to route requests, watch traffic, and manage providers.
      </p>
      <Button variant="primary" className="mx-auto min-w-48" onClick={onFinish}>
        Open dashboard
      </Button>
    </div>
  )
}

export default function OnboardingPage() {
  const { completeOnboarding } = useAuth()
  const [step, setStep] = useState(0)

  const next = () => setStep((s) => Math.min(s + 1, STEPS.length - 1))

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-5 py-10">
      <div className="w-full max-w-md">
        <div className="mb-8 flex items-center justify-center">
          {STEPS.map((s, i) => (
            <div key={s.id} className="flex items-center">
              <span
                className={cn(
                  'flex h-7 w-7 items-center justify-center rounded-full border-2 text-[11px] font-semibold',
                  i < step
                    ? 'border-success bg-success text-on-accent'
                    : i === step
                      ? 'border-accent text-accent'
                      : 'border-border bg-surface-2 text-subtle',
                )}
              >
                {i < step ? <Check size={13} /> : i + 1}
              </span>
              <span className={cn('mx-2 whitespace-nowrap text-[11px]', i === step ? 'font-medium text-text' : 'text-subtle')}>{s.label}</span>
              {i < STEPS.length - 1 && <span className={cn('mr-2 h-px w-7', i < step ? 'bg-success' : 'bg-border')} />}
            </div>
          ))}
        </div>

        <div className="rounded-xl border border-border bg-surface p-8">{step === 0 && <StepWelcome onNext={next} />}</div>
        {step === 1 && (
          <div className="rounded-xl border border-border bg-surface p-8">
            <StepPassword onNext={next} onSkip={next} />
          </div>
        )}
        {step === 2 && (
          <div className="rounded-xl border border-border bg-surface p-8">
            <StepProvider onNext={next} />
          </div>
        )}
        {step === 3 && (
          <div className="rounded-xl border border-border bg-surface p-8">
            <StepDone onFinish={() => completeOnboarding()} />
          </div>
        )}
      </div>
    </div>
  )
}
